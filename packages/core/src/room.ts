import type { Api } from './api';
import type { Logger } from './logger';
import {
  isChatPayload,
  isLiveLeaderPayload,
  isPlaybackPayload,
  isSfuPeersPayload,
  type ChatMessage,
  type Room,
  type RoomMember,
  type SfuPeer,
  type WSMessage,
} from './protocol';
import type { RoomSocket, SocketState } from './roomSocket';
import {
  applyLocal,
  applyRemote,
  clockOffsetFromSync,
  declineLeadershipPayload,
  fromSync,
  isOwnEcho,
  shouldDeclineLeadership,
  type PlaybackState,
} from './sync';

/** Chat kept in memory: history plus live, oldest first. */
export const CHAT_CAP = 200;

export type NoticeKind = 'live-unsupported' | 'enter-failed';

export interface RoomNotice {
  kind: NoticeKind;
  message: string;
}

export interface RoomSessionState {
  roomId: string;
  me: { userId: string; username: string };
  room?: Room;
  member?: RoomMember;
  /** member.permissions.can_control_playback. The server never enforces it (contract §4), so the client must. */
  canControl: boolean;
  /** Undefined until the first SYNC_PLAYBACK. */
  playback?: PlaybackState;
  /** Device clock minus server clock, refreshed from each SYNC_PLAYBACK. */
  clockOffsetMs: number;
  chat: ChatMessage[];
  roster: SfuPeer[];
  /** User IDs seen via JOIN_ROOM/LEAVE_ROOM. Best effort: the hub only announces joins after ours. */
  viewers: string[];
  connection: SocketState;
  notice?: RoomNotice;
}

export type RoomAction =
  | { type: 'entered'; room: Room; member: RoomMember; history: ChatMessage[] }
  | { type: 'enter-failed'; message: string }
  | { type: 'connection'; state: SocketState }
  | { type: 'ws'; msg: WSMessage; localNowMs: number }
  | { type: 'local-playback'; isPlaying: boolean; position: number; localNowMs: number };

const LIVE_NOTICE: RoomNotice = { kind: 'live-unsupported', message: "Live channels aren't available on TV yet" };

export function initialRoomState(roomId: string, me: { userId: string; username: string }): RoomSessionState {
  return { roomId, me, canControl: false, clockOffsetMs: 0, chat: [], roster: [], viewers: [], connection: 'idle' };
}

/**
 * Whether an inbound frame has the payload its type requires. Frames that fail are dropped (and
 * logged by the caller), never thrown: the hub relays client payloads verbatim (ws/hub.go).
 */
export function isWellFormed(msg: WSMessage): boolean {
  switch (msg.type) {
    case 'SYNC_PLAYBACK':
    case 'PLAY':
    case 'PAUSE':
    case 'SEEK':
      return isPlaybackPayload(msg.payload);
    case 'CHANGE_MEDIA':
      return isPlaybackPayload(msg.payload) && typeof msg.payload.media_url === 'string';
    case 'CHAT_MESSAGE':
      return isChatPayload(msg.payload);
    case 'SFU_PEERS':
      return isSfuPeersPayload(msg.payload);
    case 'LIVE_LEADER':
      return isLiveLeaderPayload(msg.payload);
    default:
      return true;
  }
}

function mergeChat(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const merged = existing.slice();
  for (const m of incoming) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    merged.push(m);
  }
  return merged.length > CHAT_CAP ? merged.slice(-CHAT_CAP) : merged;
}

/** A live CHAT_MESSAGE carries no message ID; sender + sender timestamp identifies it. */
function chatFromWs(msg: WSMessage<{ message: string }>, roomId: string): ChatMessage {
  return {
    id: `ws:${msg.sender_id ?? '?'}:${msg.timestamp}`,
    room_id: msg.room_id ?? roomId,
    user_id: msg.sender_id ?? '',
    username: msg.sender_name ?? '?',
    message: msg.payload?.message ?? '',
    created_at: new Date(msg.timestamp || 0).toISOString(),
  };
}

function withPlayback(s: RoomSessionState, playback: PlaybackState): RoomSessionState {
  const notice = playback.kind === 'live' ? LIVE_NOTICE : s.notice?.kind === 'live-unsupported' ? undefined : s.notice;
  return { ...s, playback, notice };
}

export function roomReducer(s: RoomSessionState, a: RoomAction): RoomSessionState {
  switch (a.type) {
    case 'entered':
      return {
        ...s,
        room: a.room,
        member: a.member,
        canControl: a.member.permissions.can_control_playback,
        chat: mergeChat(s.chat, a.history),
        notice: s.notice?.kind === 'enter-failed' ? undefined : s.notice,
      };
    case 'enter-failed':
      return { ...s, notice: { kind: 'enter-failed', message: a.message } };
    case 'connection':
      return s.connection === a.state ? s : { ...s, connection: a.state };
    case 'local-playback':
      return s.playback ? withPlayback(s, applyLocal(s.playback, a.isPlaying, a.position, a.localNowMs)) : s;
    case 'ws':
      return reduceWs(s, a.msg, a.localNowMs);
  }
}

function reduceWs(s: RoomSessionState, msg: WSMessage, now: number): RoomSessionState {
  if (!isWellFormed(msg)) return s;
  switch (msg.type) {
    case 'SYNC_PLAYBACK': {
      const clockOffsetMs = clockOffsetFromSync(msg, now);
      const playback = fromSync(msg, now, clockOffsetMs);
      return playback ? withPlayback({ ...s, clockOffsetMs }, playback) : s;
    }
    case 'PLAY':
    case 'PAUSE':
    case 'SEEK':
    case 'CHANGE_MEDIA':
      // Before the first SYNC_PLAYBACK there is nothing to apply a delta to; the sync supersedes it.
      if (!s.playback || isOwnEcho(msg, s.me.userId)) return s;
      return withPlayback(s, applyRemote(s.playback, msg, now, s.clockOffsetMs));
    case 'CHAT_MESSAGE':
      // Own messages are rendered from the echo too (contract §4, Chat).
      return { ...s, chat: mergeChat(s.chat, [chatFromWs(msg as WSMessage<{ message: string }>, s.roomId)]) };
    case 'SFU_PEERS':
      return { ...s, roster: ((msg.payload as { peers: SfuPeer[] | null }).peers ?? []).slice() };
    case 'JOIN_ROOM':
      return !msg.sender_id || s.viewers.includes(msg.sender_id) ? s : { ...s, viewers: [...s.viewers, msg.sender_id] };
    case 'LEAVE_ROOM':
      return msg.sender_id && s.viewers.includes(msg.sender_id) ? { ...s, viewers: s.viewers.filter((v) => v !== msg.sender_id) } : s;
    default:
      return s;
  }
}

/** What happened, for the UI: `playback` means the player should be re-aligned (RoomScreen.applyNow). */
export type RoomEvent = { type: 'state' } | { type: 'playback'; reason: string };

export type SendResult = 'sent' | 'forbidden' | 'offline' | 'not-ready';

type SocketLike = Pick<RoomSocket, 'connect' | 'close' | 'send' | 'onMessage' | 'onState'>;

export interface RoomSessionDeps {
  api: Pick<Api, 'joinRoom' | 'getRoom' | 'getMessages'>;
  /** Builds the room's socket; the app supplies RoomSocket with its platform WebSocket. */
  createSocket(roomId: string): SocketLike;
  now(): number;
  logger: Logger;
}

/**
 * One visit to a room: membership → details + history → socket, then every inbound frame through
 * roomReducer. Leaving closes the socket but keeps the membership (architecture §3.5).
 */
export function createRoomSession(roomId: string, me: { userId: string; username: string }, deps: RoomSessionDeps) {
  let state = initialRoomState(roomId, me);
  let socket: SocketLike | null = null;
  let left = false;
  const listeners = new Set<(s: RoomSessionState, e: RoomEvent) => void>();

  function dispatch(action: RoomAction, reason: string = action.type): void {
    const next = roomReducer(state, action);
    if (next === state) return;
    const event: RoomEvent = next.playback !== state.playback ? { type: 'playback', reason } : { type: 'state' };
    state = next;
    for (const cb of listeners) cb(state, event);
  }

  function onMessage(msg: WSMessage): void {
    if (!isWellFormed(msg)) {
      deps.logger.warn('room', 'dropped malformed payload', { type: msg.type });
      return;
    }
    if (shouldDeclineLeadership(msg, me.userId)) {
      const sent = socket?.send('LIVE_POSITION', declineLeadershipPayload()) ?? false;
      deps.logger.info('room', 'declined live leadership', { sent });
    }
    dispatch({ type: 'ws', msg, localNowMs: deps.now() }, msg.type);
  }

  return {
    getState: () => state,

    subscribe(cb: (s: RoomSessionState, e: RoomEvent) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    async enter(): Promise<boolean> {
      try {
        // The WS handshake requires membership, so join first (contract §4, Handshake).
        await deps.api.joinRoom(roomId);
        const [{ room, member }, history] = await Promise.all([deps.api.getRoom(roomId), deps.api.getMessages(roomId)]);
        if (left) return false;
        dispatch({ type: 'entered', room, member, history });
      } catch (err) {
        deps.logger.error('room', 'enter failed', { room: roomId, err: String(err) });
        if (!left) dispatch({ type: 'enter-failed', message: "Couldn't open this room" });
        return false;
      }
      const s = deps.createSocket(roomId);
      socket = s;
      s.onState((st) => dispatch({ type: 'connection', state: st }));
      s.onMessage(onMessage);
      s.connect();
      return true;
    },

    leave(): void {
      left = true;
      socket?.close();
      socket = null;
    },

    /** A local playback key. Applied optimistically; the echo is dropped by sender_id. */
    sendPlayback(type: 'PLAY' | 'PAUSE' | 'SEEK', position: number): SendResult {
      const playback = state.playback;
      if (!playback) return 'not-ready';
      if (!state.canControl) return 'forbidden';
      if (!socket?.send(type, { media_time_seconds: position })) return 'offline';
      const isPlaying = type === 'PLAY' ? true : type === 'PAUSE' ? false : playback.isPlaying;
      dispatch({ type: 'local-playback', isPlaying, position, localNowMs: deps.now() }, `local ${type}`);
      return 'sent';
    },
  };
}

export type RoomSession = ReturnType<typeof createRoomSession>;
