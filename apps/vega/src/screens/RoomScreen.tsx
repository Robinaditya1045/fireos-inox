import React, {useCallback, useEffect, useRef, useState} from 'react';
import {BackHandler, StyleSheet, Text, View} from 'react-native';
import {KeplerVideoSurfaceView} from '@amazon-devices/react-native-w3cmedia';
import {useTVEventHandler, type HWEvent} from '@amazon-devices/react-native-kepler';
import {
  applyLocal,
  applyRemote,
  clockOffsetFromSync,
  declineLeadershipPayload,
  driftAction,
  expectedPosition,
  fromSync,
  isChatPayload,
  isOwnEcho,
  RoomSocket,
  SETTLE_MS,
  type LiveLeaderPayload,
  type PlaybackState,
  type Room,
  type Session,
  type SfuPeer,
  type SocketState,
  type WSMessage,
} from '../../../../packages/core/src';
import {config} from '../platform/config';
import {logger} from '../platform/logger';
import {api, auth} from '../platform/services';
import {VegaPlayer, type LevelInfo} from '../player/VegaPlayer';
import {color, font, radius, space} from '../theme/tokens';

const DRIFT_CHECK_MS = 1000;
/** Resume in place (rate ladder closes the rest) when within this; beyond it, seek-ahead-and-hold. */
const APPLY_SEEK_TOLERANCE_S = 1.5;
const SEEK_STEP_S = 10;
const LEVEL_CYCLE = [-1, 0, 1, 2];

/**
 * Seconds from a seek until the player has data to play (EWMA). It is a property of the
 * device/player — measured 1–2.3 s on VVD — so it outlives a room screen.
 */
const seekReady = {ewma: 2.0};
/**
 * On VVD a seek made while paused, followed by play() seconds later, resumes ~5.6 s AHEAD of the
 * seek target and then stalls — even inside a buffered range (seen 3×: 79.2 → 84.8/85.0 s). A
 * hold (pause → seek → play ~1 s later) is fine. So pausing never seeks unless the TV is far off;
 * the small remaining gap is closed by the rate ladder after resume.
 */
const PAUSED_PIN_TOLERANCE_S = 1.5;
const HOLD_POLL_MS = 100;
/** Seconds buffered ahead of the playhead before playback may (re)start without stalling. */
const MIN_BUFFER_AHEAD_S = 2;
const HOLD_TIMEOUT_MS = 10_000;
/** Grace after starting playback before drift is measured again. */
const START_SETTLE_MS = 1000;

interface ChatLine {
  id: string;
  name: string;
  text: string;
}

export const RoomScreen = ({room, session, onLeave}: {room: Room; session: Session; onLeave: () => void}) => {
  const player = useRef<VegaPlayer | null>(null);
  const socket = useRef<RoomSocket | null>(null);
  const state = useRef<PlaybackState | null>(null);
  const loadedUrl = useRef<string | null>(null);
  const settleUntil = useRef(0);
  const canControlRef = useRef(false);
  const pendingSurface = useRef<string | null>(null);
  const levelCycle = useRef(0);
  /** Device clock minus server clock, refreshed from every SYNC_PLAYBACK. */
  const clockOffset = useRef(0);
  /** Bumped by every align(); a stale hold sequence checks it and stops. */
  const alignGen = useRef(0);
  /** True while a seek-ahead-and-hold is in progress; the drift loop stays out of the way. */
  const aligning = useRef(false);

  const [connection, setConnection] = useState<SocketState>('idle');
  const [canControl, setCanControl] = useState(false);
  const [ownerName, setOwnerName] = useState('the host');
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [roster, setRoster] = useState<SfuPeer[]>([]);
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
   *  - paused room: pin the exact position (a paused seek costs nothing);
   *  - playing room, already close: just play (resuming from a buffered pause is near-instant);
   *  - playing room, far off: seek AHEAD by the learned seek-ready time, hold paused until the
   *    player has data, then start exactly when the room's timeline reaches that frame. Seeking
   *    straight to the room position would land late by a variable 1–2.3 s rebuffer on VVD.
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
    // Resuming is near-instant only from a buffered position; otherwise hold like a seek.
    const buffered = !p.isSeeking() && p.bufferedAhead() >= MIN_BUFFER_AHEAD_S;
    if (Math.abs(gap) <= APPLY_SEEK_TOLERANCE_S && buffered) {
      aligning.current = false;
      p.play();
      settleUntil.current = now + START_SETTLE_MS;
      logger.info('sync', 'APPLIED', {reason, mode: 'resume', gap: +gap.toFixed(3), localNowMs: now});
      return;
    }

    aligning.current = true;
    const lead = Math.min(6, Math.max(1, seekReady.ewma * 1.3 + 0.3));
    const target = expected + lead;
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
        logger.info('sync', 'HOLD_START', {at: +(player.current?.currentTime() ?? 0).toFixed(3), localNowMs: Date.now()});
      };
      if (wait > 0) setTimeout(begin, wait * 1000);
      else if (wait > -1) begin(); // slightly late: the rate ladder closes the rest
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
    player.current.load(url);
  }, []);

  const handleMessage = useCallback(
    (msg: WSMessage) => {
      const now = Date.now();
      switch (msg.type) {
        case 'SYNC_PLAYBACK': {
          clockOffset.current = clockOffsetFromSync(msg, now);
          const s = fromSync(msg, now, clockOffset.current);
          if (!s) return;
          state.current = s;
          logger.info('sync', 'SYNC_PLAYBACK', {anchor: s.anchorTime, playing: s.isPlaying, kind: s.kind, clockOffsetMs: clockOffset.current});
          if (s.kind === 'live') {
            setNotice("Live channels aren't available on TV yet");
            return;
          }
          setNotice(null);
          ensureMedia(s.mediaUrl);
          applyNow('SYNC_PLAYBACK');
          return;
        }
        case 'PLAY':
        case 'PAUSE':
        case 'SEEK':
        case 'CHANGE_MEDIA': {
          if (!state.current || isOwnEcho(msg, session.user_id)) return;
          state.current = applyRemote(state.current, msg, now, clockOffset.current);
          logger.info('sync', `REMOTE ${msg.type}`, {from: msg.sender_name, payload: msg.payload, localNowMs: now});
          if (msg.type === 'CHANGE_MEDIA') {
            if (state.current.kind === 'live') {
              setNotice("Live channels aren't available on TV yet");
              return;
            }
            setNotice(null);
            ensureMedia(state.current.mediaUrl);
          }
          applyNow(msg.type);
          return;
        }
        case 'CHAT_MESSAGE':
          if (isChatPayload(msg.payload)) {
            const line = {id: `${msg.timestamp}-${msg.sender_id}`, name: msg.sender_name ?? '?', text: msg.payload.message};
            setChat((c) => [...c.slice(-49), line]);
          }
          return;
        case 'SFU_PEERS':
          setRoster(((msg.payload as {peers?: SfuPeer[]})?.peers ?? []).slice());
          return;
        case 'LIVE_LEADER': {
          const p = msg.payload as LiveLeaderPayload | undefined;
          if (p?.leader_id === session.user_id) {
            // The TV can't produce live positions; hand leadership back or the live room stalls.
            socket.current?.send('LIVE_POSITION', declineLeadershipPayload());
            logger.info('sync', 'declined live leadership');
          }
          return;
        }
        default:
          return;
      }
    },
    [applyNow, ensureMedia, session.user_id],
  );

  // Mount: player, membership, room details, chat history, socket.
  useEffect(() => {
    let cancelled = false;
    const p = new VegaPlayer();
    player.current = p;
    loadedUrl.current = null; // a new player has nothing loaded, even if the ref survived a remount
    p.onReady(() => applyNow('player-ready'));
    p.onLevel(setLevel);
    p.onBuffering((b) => {
      if (b) settleUntil.current = Date.now() + SETTLE_MS;
    });

    (async () => {
      await p.init();
      if (pendingSurface.current) p.attachSurface(pendingSurface.current);
      try {
        await api.joinRoom(room.id);
        const [{member}, history] = await Promise.all([api.getRoom(room.id), api.getMessages(room.id)]);
        if (cancelled) return;
        canControlRef.current = member.permissions.can_control_playback;
        setCanControl(member.permissions.can_control_playback);
        logger.info('room', 'entered', {room: room.name, role: member.role, canControl: member.permissions.can_control_playback});
        setChat(history.map((m) => ({id: m.id, name: m.username, text: m.message})).slice(-50));
      } catch (err) {
        logger.error('room', 'enter failed', {err: String(err)});
        if (!cancelled) setNotice("Couldn't open this room");
        return;
      }
      api.listRooms()
        .then(() => setOwnerName(room.owner_id === session.user_id ? 'you' : 'the host'))
        .catch(() => undefined);

      const s = new RoomSocket(room.id, {
        wsBaseUrl: config.wsBaseUrl,
        WebSocketImpl: WebSocket as never,
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
      });
      socket.current = s;
      let wasOpen = false;
      s.onState((st) => {
        setConnection(st);
        logger.info('socket', 'state', {state: st});
        // A reconnect usually follows a network outage, during which hls.js may have given up.
        if (st === 'open' && wasOpen) player.current?.recoverNetwork();
        if (st === 'open') wasOpen = true;
      });
      s.onMessage(handleMessage);
      s.connect();
    })();

    return () => {
      cancelled = true;
      socket.current?.close();
      socket.current = null;
      void p.destroy();
      player.current = null;
    };
  }, [applyNow, handleMessage, room.id, room.name, room.owner_id, session.id, session.user_id]);

  // Drift loop: measure every second, seek when off by more than the threshold.
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
      const settling = now < settleUntil.current;
      const drift = expected - actual;
      setHud({expected, actual, drift, playing: s.isPlaying});
      logger.info('sync', 'POS', {expected: +expected.toFixed(3), actual: +actual.toFixed(3), drift: +drift.toFixed(3), rate: p.rate(), playing: s.isPlaying, localNowMs: now});
      if (settling) return;
      if (!s.isPlaying) {
        if (Math.abs(drift) > PAUSED_PIN_TOLERANCE_S || !p.isPaused()) applyNow('pin-drift');
        return;
      }
      const action = driftAction(drift);
      if (action.seek) {
        logger.info('sync', 'DRIFT_SEEK', {drift: +drift.toFixed(3)});
        applyNow('drift');
        return;
      }
      p.setRate(action.rate);
      if (p.isPaused()) applyNow('resume-stalled');
    }, DRIFT_CHECK_MS);
    return () => clearInterval(t);
  }, [applyNow]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (chatOpen) {
        setChatOpen(false);
      } else {
        logger.info('room', 'back → lobby');
        onLeave();
      }
      return true;
    });
    return () => sub.remove();
  }, [chatOpen, onLeave]);

  const sendPlayback = useCallback(
    (type: 'PLAY' | 'PAUSE' | 'SEEK', position: number) => {
      const s = state.current;
      if (!s) return;
      if (!canControlRef.current) {
        logger.info('room', 'control blocked (no permission)', {type});
        showToast('Only the host can control playback');
        return;
      }
      const playing = type === 'PLAY' ? true : type === 'PAUSE' ? false : s.isPlaying;
      if (!socket.current?.send(type, {media_time_seconds: position})) {
        showToast('Not connected — try again in a moment');
        return;
      }
      state.current = applyLocal(s, playing, position, Date.now());
      logger.info('room', `sent ${type}`, {position});
      applyNow(`local ${type}`);
    },
    [applyNow, showToast],
  );

  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== undefined && evt.eventKeyAction !== 0) return; // act on key-down only
    const p = player.current;
    const s = state.current;
    logger.debug('keys', 'event', {type: evt.eventType});
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

  const controlLine = canControl ? 'You control playback' : `Following ${ownerName}`;

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
          {chat.slice(-12).map((l) => (
            <Text key={l.id} style={styles.chatLine}>
              <Text style={styles.chatName}>{l.name}: </Text>
              {l.text}
            </Text>
          ))}
          {chat.length === 0 ? <Text style={styles.chatLine}>No messages yet</Text> : null}
        </View>
      ) : null}
      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
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
  toast: {position: 'absolute', bottom: space.xxl * 2, alignSelf: 'center', backgroundColor: color.surfaceRaised, borderRadius: radius.md, padding: space.md, zIndex: 5},
  toastText: {color: color.text, fontSize: font.body},
});
