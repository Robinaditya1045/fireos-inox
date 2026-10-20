import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, StyleSheet, View, type LayoutChangeEvent} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {
  correction,
  createRoomSession,
  DRIFT_SEEK_THRESHOLD_S,
  expectedPosition,
  isReaction,
  isTvPlayableScheme,
  mediaTitle,
  RoomSocket,
  SETTLE_MS,
  syncStatus,
  trimChat,
  type ChatMessage,
  type MediaAsset,
  type PlaybackState,
  type Room,
  type RoomSession,
  type RoomSessionState,
  type Session,
  type WebSocketCtor,
} from '../../../../packages/core/src';
import {LibraryPanel} from '../components/LibraryPanel';
import {ChatBubbles, type ChatBubblesHandle} from '../components/room/ChatBubbles';
import {authorColor, ChatPanel} from '../components/room/ChatPanel';
import {ConnectionBanner, type ConnectionMode} from '../components/room/ConnectionBanner';
import {ControlBar, type PlaybackProgress} from '../components/room/ControlBar';
import {DevHud} from '../components/room/DevHud';
import {FloatingReactions, type FloatingReactionsHandle} from '../components/room/FloatingReactions';
import {NoticeCard} from '../components/room/NoticeCard';
import {ReactionTray} from '../components/room/ReactionTray';
import {StatusBanner} from '../components/room/StatusBanner';
import {Dialog} from '../components/ui/Dialog';
import {Toast, type ToastMessage, type Tone} from '../components/ui/Toast';
import {useTimedValue} from '../components/ui/useTimedValue';
import {config} from '../platform/config';
import {logger} from '../platform/logger';
import {api, auth} from '../platform/services';
import {VegaPlayer, type LevelInfo} from '../player/VegaPlayer';
import {layer, motion, space} from '../theme/tokens';

const DRIFT_CHECK_MS = 1000;
/** A paused player further off than this is re-pinned. */
const PAUSED_REPIN_S = 1.5;
const SEEK_STEP_S = 10;
const LEVEL_CYCLE = [-1, 0, 1, 2];

/**
 * Seconds from a seek until the player has data to play (EWMA). It is a property of the
 * device/player — measured 1–2.3 s on VVD — so it outlives a room screen.
 */
const seekReady = {ewma: 2.0};
/**
 * R17/F6: on VVD, a plain play() on a paused player may race the playhead seconds ahead and then
 * wedge it (player lab: 1 in 3 plain resumes after a 20 s pause; in the room, a resume 0.2 s after a
 * paused seek still raced). A hold — seek, wait for buffer, then play — never did (6/6 in the lab,
 * every hold in the room). So a paused player is only ever started through a hold.
 */
const PAUSED_PIN_TOLERANCE_S = 0.1;
const HOLD_POLL_MS = 100;
/** Seconds buffered ahead of the playhead before playback may (re)start without stalling. */
const MIN_BUFFER_AHEAD_S = 2;
const HOLD_TIMEOUT_MS = 10_000;
/** Grace after starting playback before drift is measured again. */
const START_SETTLE_MS = 1000;
/**
 * R17 watchdog. A racing playhead (far faster than the wall clock) wedges next; a wedged one
 * (playing, buffered, frozen) is not cleared by seeks. Either way the media element is rebuilt
 * (VegaPlayer.reset), the only recovery that worked every time in the player lab.
 */
const STALL_MS = 2000;
const RACE_EXCESS_S = 1.0;

const LIVE_NOTICE = "Live channels aren't available on TV yet";
/**
 * F10: on VVD, URL-mode MKV playback ignores every seek (the playhead carries on from where it was)
 * while `seekable` still claims the whole file, so it is detected from playback: a hold whose
 * playhead continued from its old place instead of the seek target is a miss.
 */
const SEEK_MISS_S = 2;
const SEEK_MISSES_UNSEEKABLE = 2;
/** URLs found unseekable this app session; a re-entered room skips the detection. */
const unseekableUrls = new Set<string>();
const UNSEEKABLE_NOTICE = "This video can't skip on TV, so it may be out of step with the room";
/** MediaError codes (HTMLMediaElement): 2 network, 3 decode, 4 source not supported. */
const MEDIA_ERRORS: Record<number, string> = {
  2: "Couldn't download this video",
  3: "This video's format isn't supported on TV",
  4: "This video's format isn't supported on TV",
};
const MEDIA_ERROR_TITLE = "This video can't play on TV";
/**
 * Media URLs the player may load. Another member's CHANGE_MEDIA reaches ensureMedia unchecked (the
 * hub relays payloads verbatim), so anything else (file:, content:, javascript:, …) is refused.
 */
const LOADABLE_URL = /^https?:\/\//i;
const REFUSED_URL = 'Only http:// and https:// links can play';

/**
 * Overlays that own focus. One at a time: opening another replaces it, back closes it. While one
 * is open the global key handler ignores navigation keys, so they only move focus inside it.
 */
type Overlay = 'none' | 'controls' | 'reactions' | 'chat' | 'library';
/** VVD reports the centre key (KEY_ENTER) as 'enter'; TVTypes.d.ts documents 'select'. Both count. */
const SELECT_KEYS = new Set(['select', 'enter']);
const NAV_KEYS = new Set(['up', 'down', 'left', 'right', ...SELECT_KEYS]);
/**
 * The select press that opens an overlay must not also press the button that takes focus in it,
 * nor may the press that closes one reopen the control bar. Whether Vega delivers a Pressable's
 * press on key-down or key-up is [U], so presses this soon after an overlay change are dropped.
 */
const PRESS_GUARD_MS = 350;
/** Continuous time without an open socket before the banner says "Can't reach Inox" (tv-ux.md). */
const OFFLINE_AFTER_MS = 30_000;
const NOT_CONNECTED = 'Not connected — try again in a moment';
const CHAT_OFF = 'Chat is turned off for you in this room';

export const RoomScreen = ({room, session, onLeave}: {room: Room; session: Session; onLeave: () => void}) => {
  const player = useRef<VegaPlayer | null>(null);
  const roomSession = useRef<RoomSession | null>(null);
  const state = useRef<PlaybackState | null>(null);
  const loadedUrl = useRef<string | null>(null);
  const settleUntil = useRef(0);
  const pendingSurface = useRef<string | null>(null);
  const levelCycle = useRef(0);
  /** Bumped by every align(); a stale hold sequence checks it and stops. */
  const alignGen = useRef(0);
  /** True while a seek-ahead-and-hold is in progress; the drift loop stays out of the way. */
  const aligning = useRef(false);
  /** Last time the playhead was seen moving while playing, for the stall watchdog. */
  const progress = useRef({t: 0, at: 0});
  /** The last hold-start on a file: where the playhead was before the seek and where it should be. */
  const seekCheck = useRef<{from: number; target: number; at: number} | null>(null);
  const seekMisses = useRef(0);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  /** Why the current video can't play (media element error); cleared by a media change or a ready player. */
  const [mediaError, setMediaError] = useState<string | null>(null);
  /** The player failed to start, so the room was never entered: shown like a failed enter. */
  const [initFailed, setInitFailed] = useState(false);
  /** The same, for the key handler (set together). */
  const initFailedRef = useRef(false);

  const [view, setView] = useState<RoomSessionState | null>(null);
  /** drift is NaN until the drift loop has measured one, so the sync pill starts hidden. */
  const [hud, setHud] = useState({expected: 0, actual: 0, drift: NaN, playing: false});
  const [level, setLevel] = useState<LevelInfo | null>(null);
  const [toast, showToastMessage] = useTimedValue<ToastMessage>(motion.toastMs);

  const [overlay, setOverlayState] = useState<Overlay>('none');
  /** Read by the key and back handlers; updated before the re-render so a press in flight sees it. */
  const overlayRef = useRef<Overlay>('none');
  const overlayChangedAt = useRef(0);
  /** Bumped on every remote key: re-shows the status banner and restarts the overlays' hide timers. */
  const [keyTick, setKeyTick] = useState(0);
  /** Height taken by the open bottom overlay (control bar, tray); bubbles, reactions and toasts sit above it. */
  const [bottomInset, setBottomInset] = useState(0);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  /** The socket has been open at least once: later outages say "Reconnecting…", not "Connecting…". */
  const [everOpen, setEverOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [retryEpoch, setRetryEpoch] = useState(0);
  /** Since when the socket has not been open (mount counts); null while open. */
  const downSince = useRef<number | null>(Date.now());
  const lastRetryAt = useRef(0);
  const left = useRef(false);
  const floats = useRef<FloatingReactionsHandle>(null);
  const bubbles = useRef<ChatBubblesHandle>(null);

  const showToast = useCallback((text: string, tone: Tone = 'info') => showToastMessage({text, tone}), [showToastMessage]);

  const setOverlay = useCallback((next: Overlay) => {
    if (overlayRef.current === next) return;
    overlayRef.current = next;
    overlayChangedAt.current = Date.now();
    if (next !== 'controls' && next !== 'reactions') setBottomInset(0);
    if (next === 'chat') bubbles.current?.clear(); // the panel shows them
    setOverlayState(next);
    logger.info('ui', 'overlay', {overlay: next});
  }, []);
  const closeOverlay = useCallback(() => setOverlay('none'), [setOverlay]);

  /** False (and logged) for a press that arrives right after an overlay opened or closed. */
  const pressReady = useCallback((what: string) => {
    if (Date.now() - overlayChangedAt.current >= PRESS_GUARD_MS) return true;
    logger.debug('keys', 'press guarded', {what});
    return false;
  }, []);

  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    logger.info('room', 'back → lobby');
    onLeave();
  }, [onLeave]);

  /**
   * Moves the player to where the room is right now.
   *  - paused room: pause and pin the exact position (a paused seek is cheap and refreshes the pipeline);
   *  - playing room, already close and freshly seeked: just play (near-instant from a buffered pause);
   *  - otherwise: seek AHEAD by the learned seek-ready time, hold paused until the player has data,
   *    then start exactly when the room's timeline reaches that frame. Seeking straight to the room
   *    position would land late by a variable 1–2.3 s rebuffer on VVD.
   */
  const applyNow = useCallback((reason: string, retried = false) => {
    const p = player.current;
    const s = state.current;
    if (!p || !s || !p.isReady() || s.kind === 'live') return;
    const gen = ++alignGen.current;
    const now = Date.now();
    const expected = expectedPosition(s, now);
    const gap = expected - p.currentTime();
    p.setRate(1);
    progress.current = {t: p.currentTime(), at: now};

    // A file that can't seek (F10) can only follow play and pause; a seek or rebuild would not help.
    if (loadedUrl.current && unseekableUrls.has(loadedUrl.current)) {
      aligning.current = false;
      const ended = p.duration() > 0 && expected >= p.duration() - 0.5;
      if (s.isPlaying && !ended) {
        if (p.isPaused()) p.play();
      } else {
        p.pause();
      }
      settleUntil.current = now + START_SETTLE_MS;
      logger.info('sync', 'APPLIED', {reason, mode: 'unseekable', gap: +gap.toFixed(3), localNowMs: now});
      return;
    }

    // The room can keep "playing" past the end (Inox has no ended state); show the last frame.
    const duration = p.duration();
    if (duration > 0 && expected >= duration - 0.5) {
      aligning.current = false;
      p.pause();
      if (p.currentTime() < duration - 1) p.seek(Math.max(0, duration - 0.1));
      settleUntil.current = now + START_SETTLE_MS;
      logger.info('sync', 'APPLIED', {reason, mode: 'ended', expected: +expected.toFixed(3), duration});
      return;
    }

    if (!s.isPlaying) {
      aligning.current = false;
      p.pause();
      if (Math.abs(gap) > PAUSED_PIN_TOLERANCE_S) p.seek(expected);
      settleUntil.current = now + START_SETTLE_MS;
      logger.info('sync', 'APPLIED', {reason, mode: 'pin', target: +expected.toFixed(3), localNowMs: now});
      return;
    }
    // Already playing and close: carry on. A paused player is never started with a plain play()
    // (R17), only through the hold below.
    const buffered = !p.isSeeking() && p.bufferedAhead() >= MIN_BUFFER_AHEAD_S;
    if (!p.isPaused() && Math.abs(gap) <= DRIFT_SEEK_THRESHOLD_S && buffered) {
      aligning.current = false;
      settleUntil.current = now + START_SETTLE_MS;
      logger.info('sync', 'APPLIED', {reason, mode: 'continue', gap: +gap.toFixed(3), localNowMs: now});
      return;
    }

    aligning.current = true;
    const lead = Math.min(6, Math.max(1, seekReady.ewma * 1.3 + 0.3));
    const target = expected + lead;
    const from = p.currentTime();
    p.pause();
    p.seek(target);
    logger.info('sync', 'APPLIED', {reason, mode: 'hold', target: +target.toFixed(3), lead: +lead.toFixed(3), localNowMs: now});

    const poll = () => {
      if (gen !== alignGen.current) return;
      const pp = player.current;
      const ss = state.current;
      if (!pp || !ss) return;
      const ready = !pp.isSeeking() && pp.bufferedAhead() >= Math.min(MIN_BUFFER_AHEAD_S, Math.max(0.1, pp.duration() - pp.currentTime()));
      if (!ready && Date.now() - now < HOLD_TIMEOUT_MS) {
        setTimeout(poll, HOLD_POLL_MS);
        return;
      }
      const readyS = (Date.now() - now) / 1000;
      // A timed-out hold measured nothing about seek latency; don't let it teach the estimate.
      if (ready) seekReady.ewma = 0.6 * seekReady.ewma + 0.4 * readyS;
      if (!ss.isPlaying) {
        aligning.current = false;
        return;
      }
      const wait = target - expectedPosition(ss, Date.now());
      logger.info('sync', 'HOLD_READY', {readyS: +readyS.toFixed(3), wait: +wait.toFixed(3), ewma: +seekReady.ewma.toFixed(3)});
      const begin = () => {
        if (gen !== alignGen.current) return;
        player.current?.play();
        aligning.current = false;
        settleUntil.current = Date.now() + START_SETTLE_MS;
        progress.current = {t: player.current?.currentTime() ?? 0, at: Date.now()};
        if (player.current?.playsFile() && Math.abs(target - from) > SEEK_MISS_S) seekCheck.current = {from, target, at: Date.now()};
        logger.info('sync', 'HOLD_START', {at: +(player.current?.currentTime() ?? 0).toFixed(3), localNowMs: Date.now()});
      };
      if (wait > 0) setTimeout(begin, wait * 1000);
      else if (wait > -DRIFT_SEEK_THRESHOLD_S) begin(); // slightly late: within tolerance
      else if (!retried) {
        aligning.current = false;
        applyNow('hold-retry', true); // ready took far longer than the lead; ewma has adapted
      } else {
        begin(); // second miss: start anyway and let the drift loop take over
      }
    };
    setTimeout(poll, HOLD_POLL_MS);
  }, []);

  const ensureMedia = useCallback((url: string) => {
    if (url && !LOADABLE_URL.test(url)) {
      // Never loaded. Clearing the playback ref keeps applyNow (called right after this) and the drift
      // loop idle, so the previous video stays paused instead of following this one's timeline; the
      // next playback event for a loadable URL sets it again and switches as usual.
      state.current = null;
      player.current?.pause();
      if (loadedUrl.current !== url) {
        loadedUrl.current = url;
        seekCheck.current = null;
        seekMisses.current = 0;
        setMediaNotice(null);
        setMediaError(REFUSED_URL);
        logger.warn('room', 'refused media url', {scheme: url.slice(0, Math.max(0, url.indexOf(':'))).slice(0, 16), length: url.length});
      }
      return;
    }
    if (!player.current || !url || loadedUrl.current === url) return;
    loadedUrl.current = url;
    seekCheck.current = null;
    seekMisses.current = 0;
    setMediaNotice(unseekableUrls.has(url) ? UNSEEKABLE_NOTICE : null);
    setMediaError(null);
    void player.current.switchTo(url);
  }, []);

  /** Live chat (not history): reactions float, other people's lines show as bubbles (D17). */
  const onChatMessage = useCallback(
    (m: ChatMessage) => {
      const own = m.user_id === session.user_id;
      if (isReaction(m.message)) {
        floats.current?.push({id: m.id, emoji: trimChat(m.message), name: own ? 'You' : m.username, nameColor: authorColor(m.user_id)});
      } else if (!own && overlayRef.current !== 'chat') {
        bubbles.current?.push({id: m.id, name: m.username, nameColor: authorColor(m.user_id), text: trimChat(m.message)});
      }
    },
    [session.user_id],
  );
  const onChatRef = useRef(onChatMessage);
  useEffect(() => {
    onChatRef.current = onChatMessage;
  }, [onChatMessage]);

  // Mount: player, then the room session (join → details + history → socket).
  useEffect(() => {
    const p = new VegaPlayer();
    player.current = p;
    loadedUrl.current = null; // a new player has nothing loaded, even if the ref survived a remount
    p.onReady(() => applyNow('player-ready'));
    p.onReady(() => setMediaError(null)); // a rebuilt or recovered element plays again
    p.onLevel(setLevel);
    p.onBuffering((b) => {
      if (b) settleUntil.current = Date.now() + SETTLE_MS;
    });
    p.onError((code) => {
      const url = state.current?.mediaUrl ?? '';
      // Someone else may have picked an http:// file, which Vega's player refuses (D16).
      if (url && !isTvPlayableScheme(url)) setMediaError('The TV plays video files only from https:// links');
      else setMediaError(MEDIA_ERRORS[code ?? 0] ?? "Couldn't play this video");
    });

    const rs = createRoomSession(room.id, {userId: session.user_id, username: session.username}, {
      api,
      createSocket: (roomId) =>
        new RoomSocket(roomId, {
          wsBaseUrl: config.wsBaseUrl,
          WebSocketImpl: WebSocket as unknown as WebSocketCtor,
          getSessionId: () => auth.get()?.id ?? session.id,
          checkSession: async () => {
            try {
              await api.me();
              return true;
            } catch (err) {
              return (err as {status?: number}).status !== 401;
            }
          },
          authMode: 'query',
          logger,
        }),
      now: () => Date.now(),
      logger,
    });
    roomSession.current = rs;

    let wasOpen = false;
    let lastConnection = rs.getState().connection;
    rs.subscribe((st, event) => {
      setView(st);
      if (st.connection !== lastConnection) {
        lastConnection = st.connection;
        logger.info('socket', 'state', {state: st.connection});
        // A reconnect usually follows a network outage, during which hls.js may have given up.
        if (st.connection === 'open' && wasOpen) player.current?.recoverNetwork();
        if (st.connection === 'open') wasOpen = true;
      }
      if (event.type !== 'playback' || !st.playback) return;
      state.current = st.playback;
      logger.info('sync', event.reason, {anchor: +st.playback.anchorTime.toFixed(3), playing: st.playback.isPlaying, kind: st.playback.kind, clockOffsetMs: st.clockOffsetMs});
      if (st.playback.kind === 'live') return;
      ensureMedia(st.playback.mediaUrl);
      applyNow(event.reason);
    });
    rs.subscribe((_st, event) => {
      if (event.type === 'chat') onChatRef.current(event.message);
    });

    (async () => {
      await p.init();
      if (pendingSurface.current) p.attachSurface(pendingSurface.current);
      if (await rs.enter()) {
        const m = rs.getState().member;
        logger.info('room', 'entered', {room: room.name, role: m?.role, canControl: rs.getState().canControl});
      }
    })().catch((err) => {
      // rs.enter() reports its own failures; this is the player (init/attach) failing first.
      logger.error('room', 'init failed', {err: String(err)});
      initFailedRef.current = true;
      setInitFailed(true);
    });

    return () => {
      rs.leave();
      roomSession.current = null;
      void p.destroy();
      player.current = null;
      alignGen.current += 1; // pending hold polls/starts see a new generation and stop
    };
  }, [applyNow, ensureMedia, room.id, room.name, session.id, session.user_id, session.username]);

  /**
   * Drift loop, every second: R17 watchdog first, then seek-only correction through a hold.
   * No playbackRate ladder: on VVD, setting playbackRate on a stalled pipeline blocked the JS thread
   * for 5–13 s (sync run r17-c), and rate changes preceded the worst resumes in the player lab.
   */
  useEffect(() => {
    const t = setInterval(() => {
      const p = player.current;
      const s = state.current;
      if (!p || !s || !p.isReady() || s.kind === 'live') return;
      const now = Date.now();
      const expected = expectedPosition(s, now);
      const actual = p.currentTime();
      if (aligning.current) return;
      // Past the end (Inox has no ended state): applyNow already parked the player on the last frame.
      if (p.duration() > 0 && expected >= p.duration() - 0.5) return;
      const drift = expected - actual;
      setHud({expected, actual, drift, playing: s.isPlaying});
      logger.info('sync', 'POS', {expected: +expected.toFixed(3), actual: +actual.toFixed(3), drift: +drift.toFixed(3), playing: s.isPlaying, buffered: +p.bufferedAhead().toFixed(1), readyState: p.readyState(), localNowMs: now});
      const check = seekCheck.current;
      if (check && now - check.at >= 1000) {
        seekCheck.current = null;
        const elapsed = (now - check.at) / 1000;
        // Far from where the seek should have put it, but right where it would be without the seek.
        const missed = Math.abs(actual - (check.target + elapsed)) > SEEK_MISS_S && Math.abs(actual - (check.from + elapsed)) < SEEK_MISS_S;
        if (missed) {
          seekMisses.current += 1;
          logger.warn('sync', 'SEEK_MISSED', {from: +check.from.toFixed(3), target: +check.target.toFixed(3), actual: +actual.toFixed(3), misses: seekMisses.current});
          if (seekMisses.current >= SEEK_MISSES_UNSEEKABLE && loadedUrl.current) {
            unseekableUrls.add(loadedUrl.current);
            setMediaNotice(UNSEEKABLE_NOTICE);
            logger.warn('sync', 'UNSEEKABLE', {url: loadedUrl.current});
          }
        } else {
          seekMisses.current = 0;
        }
      }
      if (loadedUrl.current && unseekableUrls.has(loadedUrl.current)) {
        // No watchdog or seek correction: a rebuild would restart the file at 0. Follow play/pause only.
        if (s.isPlaying === p.isPaused() && now >= settleUntil.current) applyNow('unseekable-state');
        return;
      }
      // R17 watchdog, ahead of the settle window: a race shows on the first tick after a start, and
      // the player's own 'waiting' events would otherwise keep extending the settle window.
      if (s.isPlaying && !p.isPaused() && !p.isSeeking()) {
        const moved = actual - progress.current.t;
        const wallS = (now - progress.current.at) / 1000;
        const frozen = Math.abs(moved) < 0.1 && wallS * 1000 > STALL_MS && p.bufferedAhead() >= 1;
        const racing = moved > wallS * 1.2 + RACE_EXCESS_S;
        if (frozen || racing) {
          logger.warn('sync', frozen ? 'STALL' : 'RACE', {at: +actual.toFixed(3), moved: +moved.toFixed(3), wallS: +wallS.toFixed(3)});
          progress.current = {t: actual, at: now};
          settleUntil.current = now + SETTLE_MS;
          void p.reset(); // onReady → applyNow('player-ready') re-aligns through a hold
          return;
        }
        if (Math.abs(moved) >= 0.1) progress.current = {t: actual, at: now};
      }
      const settling = now < settleUntil.current;
      if (!s.isPlaying) {
        if (!settling && (Math.abs(drift) > PAUSED_REPIN_S || !p.isPaused())) applyNow('pin-drift');
        return;
      }
      if (p.isPaused()) {
        if (!settling) applyNow('resume-stalled');
        return;
      }
      if (correction(expected, actual, settling).seek) {
        logger.info('sync', 'DRIFT_SEEK', {drift: +drift.toFixed(3)});
        applyNow('drift');
      }
    }, DRIFT_CHECK_MS);
    return () => clearInterval(t);
  }, [applyNow]);

  // Library titles, once, to name what is playing; the banner falls back to a URL-derived title.
  useEffect(() => {
    let alive = true;
    api
      .listMedia()
      .then((list) => {
        if (alive) setMedia(list);
      })
      .catch((err) => logger.debug('room', 'media titles unavailable', {err: String(err)}));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (overlayRef.current !== 'none') setOverlay('none');
      else leave();
      return true;
    });
    return () => sub.remove();
  }, [leave, setOverlay]);

  const sendPlayback = useCallback(
    (type: 'PLAY' | 'PAUSE' | 'SEEK', position: number) => {
      const rs = roomSession.current;
      if (!rs) return;
      const result = rs.sendPlayback(type, position);
      if (result === 'forbidden') {
        logger.info('room', 'control blocked (no permission)', {type});
        showToast('Only the host can control playback', 'warning');
      } else if (result === 'offline') {
        showToast(NOT_CONNECTED, 'warning');
      } else if (result === 'sent') {
        logger.info('room', `sent ${type}`, {position});
      }
      // 'sent' re-anchors the session, whose playback event runs applyNow.
    },
    [showToast],
  );

  /** Play/pause key and the control bar's Play/Pause. */
  const togglePlayback = useCallback(() => {
    const p = player.current;
    const s = state.current;
    if (p && s) sendPlayback(s.isPlaying ? 'PAUSE' : 'PLAY', p.currentTime());
  }, [sendPlayback]);

  /** Rewind/fast-forward keys and the control bar's −/+ buttons. */
  const seekBy = useCallback(
    (deltaS: number) => {
      const p = player.current;
      if (p) sendPlayback('SEEK', Math.max(0, p.currentTime() + deltaS));
    },
    [sendPlayback],
  );

  const chooseMedia = useCallback(
    (url: string, title: string) => {
      const rs = roomSession.current;
      if (!rs) return;
      // Re-picking the current title would restart it for everyone; on a remote that is a mis-press.
      if (url === state.current?.mediaUrl) {
        setOverlay('none');
        showToast('Already playing');
        return;
      }
      const result = rs.changeMedia(url);
      if (result === 'forbidden') {
        setOverlay('none');
        showToast("Only the host can change what's playing", 'warning');
      } else if (result === 'offline' || result === 'not-ready') {
        showToast(NOT_CONNECTED, 'warning');
      } else {
        logger.info('room', 'sent CHANGE_MEDIA', {title});
        setOverlay('none');
        showToast(`Now playing: ${title}`, 'success');
      }
      // 'sent' re-anchors the session at 0, paused; its playback event loads the URL (ensureMedia).
    },
    [setOverlay, showToast],
  );

  /** Inox only offers the library to members who can control playback. */
  const openLibrary = useCallback(() => {
    if (roomSession.current?.getState().canControl) setOverlay('library');
    else showToast("Only the host can change what's playing", 'warning');
  }, [setOverlay, showToast]);

  /** The tray only opens for members who may chat; the hub would relay a muted member's message (D17). */
  const openReactions = useCallback(() => {
    const st = roomSession.current?.getState();
    if (!st?.member) showToast(NOT_CONNECTED, 'warning');
    else if (!st.canChat) showToast(CHAT_OFF, 'warning');
    else setOverlay('reactions');
  }, [setOverlay, showToast]);

  /** Debug: cycle the rendition (auto → 0 → 1 → 2) to prove ABR level switching. */
  const cycleQuality = useCallback(() => {
    levelCycle.current = (levelCycle.current + 1) % LEVEL_CYCLE.length;
    player.current?.setLevel(LEVEL_CYCLE[levelCycle.current]);
    showToast(`Quality: ${LEVEL_CYCLE[levelCycle.current] === -1 ? 'auto' : `level ${LEVEL_CYCLE[levelCycle.current]}`}`);
  }, [showToast]);

  /** A reaction or quick reply (D17). Not optimistic: it appears (and floats) from the server echo. */
  const sendChat = useCallback(
    (text: string, kind: 'reaction' | 'reply', from: 'tray' | 'panel') => {
      const rs = roomSession.current;
      if (!rs) return;
      const result = rs.sendChat(text);
      switch (result) {
        case 'sent':
          logger.info('room', 'sent CHAT_MESSAGE', {kind, from, text});
          if (kind === 'reply' && from === 'tray') {
            setOverlay('none');
            showToast(`Sent: ${text}`, 'success');
          }
          break;
        case 'forbidden':
          logger.info('room', 'chat blocked (no permission)', {kind});
          showToast(CHAT_OFF, 'warning');
          break;
        case 'offline':
        case 'not-ready':
          showToast(NOT_CONNECTED, 'warning');
          break;
        case 'throttled':
          logger.debug('room', 'chat throttled', {kind}); // a held key: stay quiet
          break;
        default:
          logger.warn('room', 'chat refused', {result});
      }
    },
    [setOverlay, showToast],
  );

  // Overlay actions, guarded against the press that opened the overlay.
  const barPlayPause = useCallback(() => pressReady('playpause') && togglePlayback(), [pressReady, togglePlayback]);
  const barSeekBy = useCallback((d: number) => pressReady('seek') && seekBy(d), [pressReady, seekBy]);
  const barReact = useCallback(() => pressReady('react') && openReactions(), [pressReady, openReactions]);
  const barChat = useCallback(() => pressReady('chat') && setOverlay('chat'), [pressReady, setOverlay]);
  const barLibrary = useCallback(() => pressReady('library') && openLibrary(), [pressReady, openLibrary]);
  const barQuality = useCallback(() => pressReady('quality') && cycleQuality(), [pressReady, cycleQuality]);
  const trayReaction = useCallback((emoji: string) => pressReady('reaction') && sendChat(emoji, 'reaction', 'tray'), [pressReady, sendChat]);
  const trayReply = useCallback((text: string) => pressReady('reply') && sendChat(text, 'reply', 'tray'), [pressReady, sendChat]);
  const panelReaction = useCallback((emoji: string) => pressReady('reaction') && sendChat(emoji, 'reaction', 'panel'), [pressReady, sendChat]);
  const panelReply = useCallback((text: string) => pressReady('reply') && sendChat(text, 'reply', 'panel'), [pressReady, sendChat]);
  const panelClose = useCallback(() => pressReady('close') && setOverlay('none'), [pressReady, setOverlay]);

  const hudRef = useRef(hud);
  hudRef.current = hud;
  const getProgress = useCallback(
    (): PlaybackProgress => ({
      position: player.current?.currentTime() ?? 0,
      duration: player.current?.duration() ?? 0,
      playing: state.current?.isPlaying ?? false,
      driftS: hudRef.current.drift,
    }),
    [],
  );

  // What the room is doing, for the banner: re-read twice a second rather than from the drift loop,
  // which stays untouched (R17) and stops sampling once the room runs past the end of the media.
  const [phase, setPhase] = useState<'playing' | 'paused' | 'ended' | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const s = state.current;
      const p = player.current;
      const next = !s || s.kind === 'live' ? null : p && p.duration() > 0 && expectedPosition(s, Date.now()) >= p.duration() - 0.5 ? 'ended' : s.isPlaying ? 'playing' : 'paused';
      setPhase((prev) => (prev === next ? prev : next));
    }, 500);
    return () => clearInterval(t);
  }, []);
  const onBottomLayout = useCallback((e: LayoutChangeEvent) => setBottomInset(e.nativeEvent.layout.height + space.md), []);

  const connection = view?.connection ?? 'idle';
  const enterFailed = initFailed || view?.notice?.kind === 'enter-failed';

  // Socket banner: "Can't reach Inox" + Retry after OFFLINE_AFTER_MS without an open socket.
  useEffect(() => {
    if (connection === 'open') {
      downSince.current = null;
      setEverOpen(true);
      setOffline(false);
      return;
    }
    if (downSince.current === null) downSince.current = Date.now();
    // Not while the room is still being joined (no socket to retry yet) or after it ended.
    if (connection === 'idle' || connection === 'closed' || connection === 'unauthorized') return;
    const t = setTimeout(() => setOffline(true), Math.max(0, OFFLINE_AFTER_MS - (Date.now() - downSince.current)));
    return () => clearTimeout(t);
  }, [connection, retryEpoch]);

  const retry = useCallback(() => {
    if (Date.now() - lastRetryAt.current < PRESS_GUARD_MS) return; // the button and the key handler both see one press
    lastRetryAt.current = Date.now();
    logger.info('room', 'retry connection');
    downSince.current = Date.now();
    setOffline(false);
    setRetryEpoch((n) => n + 1);
    roomSession.current?.retryConnection();
  }, []);

  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== undefined && evt.eventKeyAction !== 0) return; // act on key-down only
    logger.debug('keys', 'event', {type: evt.eventType});
    setKeyTick((n) => n + 1);
    if (initFailedRef.current || roomSession.current?.getState().notice?.kind === 'enter-failed') {
      if (SELECT_KEYS.has(evt.eventType)) leave(); // the dialog's only action; back works as well
      return;
    }
    const open = overlayRef.current;
    if (open !== 'none' && NAV_KEYS.has(evt.eventType)) return; // focus moves inside the overlay
    switch (evt.eventType) {
      // VVD delivers KEY_PLAYPAUSE as 'play' (not 'playpause' as TVTypes.d.ts documents).
      case 'playpause':
      case 'play':
      case 'pause':
        togglePlayback();
        break;
      case 'rewind':
      case 'skip_backward':
        seekBy(-SEEK_STEP_S);
        break;
      case 'forward':
      case 'fastforward':
      case 'skip_forward':
        seekBy(SEEK_STEP_S);
        break;
      case 'menu':
      case 'context_menu':
        setOverlay(open === 'chat' ? 'none' : 'chat');
        break;
      case 'select':
      case 'enter':
        if (Date.now() - overlayChangedAt.current < PRESS_GUARD_MS) break; // the press that just closed an overlay
        if (offline) retry();
        else setOverlay('controls');
        break;
      case 'up':
        openReactions();
        break;
      case 'down':
        openLibrary();
        break;
      default:
        break;
    }
  });

  const mediaUrl = view?.playback?.mediaUrl ?? '';
  // A new video has no drift measured yet: hide the sync pill until the drift loop has one.
  useEffect(() => {
    setHud((h) => (Number.isNaN(h.drift) ? h : {...h, drift: NaN}));
  }, [mediaUrl]);

  const title = useMemo(() => mediaTitle(mediaUrl, media), [mediaUrl, media]);
  const chat = view?.chat ?? [];
  const roster = view?.roster ?? [];
  const canControl = view?.canControl ?? false;
  const viewers = view?.viewers;
  const hereCount = useMemo(() => new Set([...(viewers ?? []), session.user_id]).size, [viewers, session.user_id]);
  const live = view?.playback?.kind === 'live';
  const sync = !view?.playback || live || mediaNotice || mediaError ? null : syncStatus(hud.drift);
  const connectionMode: ConnectionMode | null =
    enterFailed || connection === 'open' || connection === 'closed' || connection === 'unauthorized'
      ? null
      : offline
        ? 'offline'
        : connection === 'idle'
          ? null
          : everOpen
            ? 'reconnecting'
            : 'connecting';
  const centreNotice = live ? {title: LIVE_NOTICE, detail: null, tone: 'info' as const} : mediaError ? {title: MEDIA_ERROR_TITLE, detail: mediaError, tone: 'danger' as const} : null;

  return (
    <View style={styles.root}>
      <KeplerVideoSurfaceView
        style={styles.surface}
        onSurfaceViewCreated={(h: string) => {
          pendingSurface.current = h;
          player.current?.attachSurface(h);
        }}
        onSurfaceViewDestroyed={(h: string) => player.current?.detachSurface(h)}
      />
      <StatusBanner
        roomName={room.name}
        mediaTitle={title}
        canControl={canControl}
        sync={sync}
        voiceCount={roster.length}
        libraryHint={canControl}
        wakeKey={keyTick}
        pinned={overlay === 'controls' || phase === 'paused' || phase === 'ended'}
        phase={phase}
        reactHint={view?.canChat ?? false}
      />
      {__DEV__ || mediaNotice ? (
        <View style={styles.topRight} pointerEvents="none">
          {/* Dev diagnostics only with the control bar, so nothing extra sits on the video. */}
          {__DEV__ && overlay === 'controls' ? <DevHud connection={connection} hud={hud} level={level} /> : null}
          {mediaNotice ? <NoticeCard title={mediaNotice} tone="warning" placement="inline" /> : null}
        </View>
      ) : null}
      {centreNotice ? <NoticeCard title={centreNotice.title} detail={centreNotice.detail} tone={centreNotice.tone} placement="center" /> : null}
      <ChatBubbles ref={bubbles} bottomInset={bottomInset} />
      <FloatingReactions ref={floats} right={overlay === 'chat' ? '32%' : space.safeX} bottomInset={bottomInset} />
      {connectionMode ? <ConnectionBanner key={`conn-${overlay}`} mode={connectionMode} showRetry={overlay === 'none'} onRetry={retry} /> : null}
      {!enterFailed && overlay === 'controls' ? (
        <ControlBar
          getProgress={getProgress}
          canControl={canControl}
          seekStep={SEEK_STEP_S}
          wakeKey={keyTick}
          onIdle={closeOverlay}
          onPlayPause={barPlayPause}
          onSeekBy={barSeekBy}
          onReact={barReact}
          onChat={barChat}
          onLibrary={canControl ? barLibrary : undefined}
          onQuality={__DEV__ ? barQuality : undefined}
          onLayout={onBottomLayout}
        />
      ) : null}
      {!enterFailed && overlay === 'reactions' ? (
        <ReactionTray wakeKey={keyTick} onIdle={closeOverlay} onReaction={trayReaction} onQuickReply={trayReply} onLayout={onBottomLayout} />
      ) : null}
      {!enterFailed && overlay === 'chat' ? (
        <ChatPanel
          messages={chat}
          meId={session.user_id}
          hereCount={hereCount}
          voiceCount={roster.length}
          canChat={view?.canChat ?? false}
          onReaction={panelReaction}
          onQuickReply={panelReply}
          onClose={panelClose}
        />
      ) : null}
      {!enterFailed && overlay === 'library' ? <LibraryPanel currentUrl={mediaUrl} onChoose={chooseMedia} /> : null}
      {enterFailed ? (
        <Dialog
          title={view?.notice?.message ?? "Couldn't open this room"}
          message={initFailed ? "The TV's video player didn't start. Go back and try again." : 'Go back and pick the room again.'}
          actions={[{label: 'Back to rooms', onPress: leave, variant: 'primary', testID: 'room-back-to-rooms'}]}
        />
      ) : null}
      {toast ? (
        <View style={[styles.toastLayer, {bottom: bottomInset}]} pointerEvents="none">
          <Toast message={toast} />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  surface: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: layer.video},
  topRight: {position: 'absolute', top: space.safeY, right: space.safeX, maxWidth: '40%', alignItems: 'flex-end', gap: space.sm, zIndex: layer.banner},
  toastLayer: {position: 'absolute', top: 0, left: 0, right: 0, zIndex: layer.toast},
});
