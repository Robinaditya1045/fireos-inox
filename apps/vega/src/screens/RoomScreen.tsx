import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, View} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {
  correction,
  createRoomSession,
  DRIFT_SEEK_THRESHOLD_S,
  expectedPosition,
  isTvPlayableScheme,
  RoomSocket,
  SETTLE_MS,
  type PlaybackState,
  type Room,
  type RoomSession,
  type RoomSessionState,
  type Session,
  type WebSocketCtor,
} from '../../../../packages/core/src';
import {LibraryPanel} from '../components/LibraryPanel';
import {config} from '../platform/config';
import {logger} from '../platform/logger';
import {api, auth} from '../platform/services';
import {VegaPlayer, type LevelInfo} from '../player/VegaPlayer';
import {color, font, radius, space} from '../theme/tokens';

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

  const [view, setView] = useState<RoomSessionState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** Read by the key handler: while the library is open, keys move focus in it and nothing else. */
  const libraryOpenRef = useRef(false);
  libraryOpenRef.current = libraryOpen;
  const [hud, setHud] = useState({expected: 0, actual: 0, drift: 0, playing: false});
  const [level, setLevel] = useState<LevelInfo | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

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
    if (!player.current || !url || loadedUrl.current === url) return;
    loadedUrl.current = url;
    seekCheck.current = null;
    seekMisses.current = 0;
    setMediaNotice(unseekableUrls.has(url) ? UNSEEKABLE_NOTICE : null);
    void player.current.switchTo(url);
  }, []);

  // Mount: player, then the room session (join → details + history → socket).
  useEffect(() => {
    const p = new VegaPlayer();
    player.current = p;
    loadedUrl.current = null; // a new player has nothing loaded, even if the ref survived a remount
    p.onReady(() => applyNow('player-ready'));
    p.onLevel(setLevel);
    p.onBuffering((b) => {
      if (b) settleUntil.current = Date.now() + SETTLE_MS;
    });
    p.onError((code) => {
      const url = state.current?.mediaUrl ?? '';
      // Someone else may have picked an http:// file, which Vega's player refuses (D16).
      if (url && !isTvPlayableScheme(url)) showToast('The TV plays video files only from https:// links');
      else showToast(MEDIA_ERRORS[code ?? 0] ?? "Couldn't play this video");
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

    (async () => {
      await p.init();
      if (pendingSurface.current) p.attachSurface(pendingSurface.current);
      if (await rs.enter()) {
        const m = rs.getState().member;
        logger.info('room', 'entered', {room: room.name, role: m?.role, canControl: rs.getState().canControl});
      }
    })();

    return () => {
      rs.leave();
      roomSession.current = null;
      void p.destroy();
      player.current = null;
    };
  }, [applyNow, ensureMedia, showToast, room.id, room.name, session.id, session.user_id, session.username]);

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

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (libraryOpen) {
        setLibraryOpen(false);
      } else if (chatOpen) {
        setChatOpen(false);
      } else {
        logger.info('room', 'back → lobby');
        onLeave();
      }
      return true;
    });
    return () => sub.remove();
  }, [chatOpen, libraryOpen, onLeave]);

  const sendPlayback = useCallback(
    (type: 'PLAY' | 'PAUSE' | 'SEEK', position: number) => {
      const rs = roomSession.current;
      if (!rs) return;
      const result = rs.sendPlayback(type, position);
      if (result === 'forbidden') {
        logger.info('room', 'control blocked (no permission)', {type});
        showToast('Only the host can control playback');
      } else if (result === 'offline') {
        showToast('Not connected — try again in a moment');
      } else if (result === 'sent') {
        logger.info('room', `sent ${type}`, {position});
      }
      // 'sent' re-anchors the session, whose playback event runs applyNow.
    },
    [showToast],
  );

  const chooseMedia = useCallback(
    (url: string, title: string) => {
      const rs = roomSession.current;
      if (!rs) return;
      // Re-picking the current title would restart it for everyone; on a remote that is a mis-press.
      if (url === state.current?.mediaUrl) {
        setLibraryOpen(false);
        showToast('Already playing');
        return;
      }
      const result = rs.changeMedia(url);
      if (result === 'forbidden') {
        setLibraryOpen(false);
        showToast("Only the host can change what's playing");
      } else if (result === 'offline' || result === 'not-ready') {
        showToast('Not connected — try again in a moment');
      } else {
        logger.info('room', 'sent CHANGE_MEDIA', {title});
        setLibraryOpen(false);
        showToast(`Now playing: ${title}`);
      }
      // 'sent' re-anchors the session at 0, paused; its playback event loads the URL (ensureMedia).
    },
    [showToast],
  );

  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== undefined && evt.eventKeyAction !== 0) return; // act on key-down only
    const p = player.current;
    const s = state.current;
    logger.debug('keys', 'event', {type: evt.eventType});
    if (libraryOpenRef.current) return;
    switch (evt.eventType) {
      // VVD delivers KEY_PLAYPAUSE as 'play' (not 'playpause' as TVTypes.d.ts documents).
      case 'playpause':
      case 'play':
      case 'pause':
        if (p && s) sendPlayback(s.isPlaying ? 'PAUSE' : 'PLAY', p.currentTime());
        break;
      case 'rewind':
      case 'skip_backward':
        if (p) sendPlayback('SEEK', Math.max(0, p.currentTime() - SEEK_STEP_S));
        break;
      case 'forward':
      case 'fastforward':
      case 'skip_forward':
        if (p) sendPlayback('SEEK', p.currentTime() + SEEK_STEP_S);
        break;
      case 'menu':
      case 'context_menu':
        setChatOpen((o) => !o);
        break;
      case 'down':
        // Inox only offers the library to members who can control playback.
        if (roomSession.current?.getState().canControl) setLibraryOpen(true);
        else showToast("Only the host can change what's playing");
        break;
      case 'up':
        // Debug: cycle the rendition (auto → 0 → 1 → 2) to prove ABR level switching.
        levelCycle.current = (levelCycle.current + 1) % LEVEL_CYCLE.length;
        p?.setLevel(LEVEL_CYCLE[levelCycle.current]);
        showToast(`Quality: ${LEVEL_CYCLE[levelCycle.current] === -1 ? 'auto' : `level ${LEVEL_CYCLE[levelCycle.current]}`}`);
        break;
      default:
        break;
    }
  });

  const connection = view?.connection ?? 'idle';
  const chat = view?.chat ?? [];
  const roster = view?.roster ?? [];
  const notice = view?.notice ? (view.notice.kind === 'live-unsupported' ? LIVE_NOTICE : view.notice.message) : null;
  const ownerName = room.owner_id === session.user_id ? 'you' : 'the host';
  const controlLine = view?.canControl ? 'You control playback' : `Following ${ownerName}`;

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
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>{room.name}</Text>
        <Text style={styles.bannerSub}>
          {controlLine}
          {roster.length > 0 ? `  ·  🎧 ${roster.length} in voice` : ''}
        </Text>
      </View>
      {connection === 'reconnecting' || connection === 'connecting' ? (
        <View style={styles.connection}>
          <Text style={styles.connectionText}>{connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</Text>
        </View>
      ) : null}
      {__DEV__ ? (
        <View style={styles.hud}>
          <Text style={styles.hudText}>
            {`ws ${connection} · ${hud.playing ? 'playing' : 'paused'} · room ${hud.expected.toFixed(1)}s · tv ${hud.actual.toFixed(1)}s · drift ${hud.drift.toFixed(2)}s`}
          </Text>
          <Text style={styles.hudText}>{level ? `rendition ${level.height}p (level ${level.index})` : 'rendition —'}</Text>
        </View>
      ) : null}
      {chatOpen ? (
        <View style={styles.chat}>
          <Text style={styles.chatTitle}>Chat</Text>
          {chat.slice(-12).map((m) => (
            <Text key={m.id} style={styles.chatLine}>
              <Text style={styles.chatName}>{m.username}: </Text>
              {m.message}
            </Text>
          ))}
          {chat.length === 0 ? <Text style={styles.chatLine}>No messages yet</Text> : null}
        </View>
      ) : null}
      {libraryOpen ? <LibraryPanel currentUrl={view?.playback?.mediaUrl ?? ''} onChoose={chooseMedia} /> : null}
      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : mediaNotice ? (
        <View style={styles.mediaNotice}>
          <Text style={styles.noticeText}>{mediaNotice}</Text>
        </View>
      ) : null}
      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000'},
  surface: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0},
  banner: {position: 'absolute', top: space.safeY, left: space.safeX, backgroundColor: color.overlay, borderRadius: radius.md, padding: space.md, zIndex: 2},
  bannerTitle: {color: color.text, fontSize: font.heading, fontWeight: '700'},
  bannerSub: {color: color.textMuted, fontSize: font.caption, marginTop: space.xs},
  connection: {position: 'absolute', top: space.safeY, alignSelf: 'center', backgroundColor: color.overlay, borderRadius: radius.md, padding: space.md, zIndex: 3},
  connectionText: {color: color.text, fontSize: font.body},
  hud: {position: 'absolute', bottom: space.safeY, left: space.safeX, backgroundColor: color.overlay, borderRadius: radius.sm, padding: space.sm, zIndex: 2},
  hudText: {color: color.text, fontSize: font.caption},
  chat: {position: 'absolute', top: 0, right: 0, bottom: 0, width: '30%', backgroundColor: color.overlay, padding: space.lg, zIndex: 3},
  chatTitle: {color: color.text, fontSize: font.heading, fontWeight: '700', marginBottom: space.md},
  chatLine: {color: color.text, fontSize: font.caption, marginBottom: space.sm},
  chatName: {color: color.accent, fontWeight: '700'},
  notice: {position: 'absolute', top: '45%', alignSelf: 'center', backgroundColor: color.overlay, borderRadius: radius.md, padding: space.lg, zIndex: 4},
  noticeText: {color: color.text, fontSize: font.body},
  mediaNotice: {position: 'absolute', top: space.safeY, right: space.safeX, maxWidth: '40%', backgroundColor: color.overlay, borderRadius: radius.md, padding: space.md, zIndex: 2},
  toast: {position: 'absolute', bottom: space.xxl * 2, alignSelf: 'center', backgroundColor: color.surfaceRaised, borderRadius: radius.md, padding: space.md, zIndex: 5},
  toastText: {color: color.text, fontSize: font.body},
});
