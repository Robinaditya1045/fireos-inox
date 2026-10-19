import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_CAP,
  createRoomSession,
  initialRoomState,
  roomReducer,
  type ChatMessage,
  type RoomEvent,
  type RoomMember,
  type RoomSessionState,
  type SocketState,
  type WSMessage,
} from '../src';
import { fakeLogger, msg } from './helpers';

const NOW = 1_760_000_000_000;
const ME = { userId: 'me', username: 'couch' };

const member = (canControl: boolean, canChat = true): RoomMember => ({
  room_id: 'r1',
  user_id: 'me',
  role: canControl ? 'moderator' : 'member',
  joined_at: '',
  permissions: {
    can_control_playback: canControl,
    can_stream_audio: true,
    can_stream_video: true,
    can_share_screen: false,
    can_send_messages: canChat,
    can_invite_users: false,
    can_kick_users: false,
    can_manage_roles: false,
  },
});
const room = { id: 'r1', name: 'Movie Night', owner_id: 'host', is_private: false, current_media_url: 'u', created_at: '', updated_at: '' };
const chatMsg = (id: string, text: string): ChatMessage => ({ id, room_id: 'r1', user_id: 'host', username: 'host', message: text, created_at: '' });
const sync = (over: Record<string, unknown> = {}) =>
  msg('SYNC_PLAYBACK', { media_url: 'u', is_playing: false, media_time_seconds: 10, last_updated: NOW, kind: 'vod', ...over }, { timestamp: NOW });

function ws(s: RoomSessionState, m: WSMessage, localNowMs = NOW) {
  return roomReducer(s, { type: 'ws', msg: m, localNowMs });
}

const synced = () => ws(initialRoomState('r1', ME), sync());

describe('roomReducer', () => {
  it('entered: takes permissions and history', () => {
    expect(initialRoomState('r1', ME).canChat).toBe(false);
    const s = roomReducer(initialRoomState('r1', ME), { type: 'entered', room, member: member(true), history: [chatMsg('1', 'a'), chatMsg('2', 'b')] });
    expect(s.canControl).toBe(true);
    expect(s.canChat).toBe(true);
    expect(roomReducer(initialRoomState('r1', ME), { type: 'entered', room, member: member(true, false), history: [] }).canChat).toBe(false);
    expect(s.chat.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('SYNC_PLAYBACK sets playback and the clock offset', () => {
    const s = ws(initialRoomState('r1', ME), sync(), NOW - 900);
    expect(s.clockOffsetMs).toBe(-900);
    expect(s.playback).toMatchObject({ anchorTime: 10, isPlaying: false, mediaUrl: 'u' });
  });

  it('ignores playback deltas before the first SYNC_PLAYBACK', () => {
    const s0 = initialRoomState('r1', ME);
    expect(ws(s0, msg('PLAY', { media_time_seconds: 5 }, { sender_id: 'host' }))).toBe(s0);
  });

  it('drops own PLAY/PAUSE/SEEK/CHANGE_MEDIA echoes', () => {
    const s = synced();
    for (const t of ['PLAY', 'PAUSE', 'SEEK']) expect(ws(s, msg(t, { media_time_seconds: 99 }, { sender_id: 'me' }))).toBe(s);
    expect(ws(s, msg('CHANGE_MEDIA', { media_url: 'v', media_time_seconds: 0 }, { sender_id: 'me' }))).toBe(s);
  });

  it('applies remote playback from others', () => {
    const s = ws(synced(), msg('PLAY', { media_time_seconds: 20 }, { sender_id: 'host', timestamp: NOW }));
    expect(s.playback).toMatchObject({ isPlaying: true, anchorTime: 20 });
  });

  it('renders own chat from the echo, and de-duplicates', () => {
    const echo = msg('CHAT_MESSAGE', { message: 'hi' }, { sender_id: 'me', sender_name: 'couch', timestamp: NOW });
    const s1 = ws(synced(), echo);
    expect(s1.chat).toHaveLength(1);
    expect(s1.chat[0]).toMatchObject({ user_id: 'me', username: 'couch', message: 'hi' });
    expect(ws(s1, echo)).toBe(s1);
  });

  it('skips blank chat frames, as the web client does', () => {
    const s = synced();
    expect(ws(s, msg('CHAT_MESSAGE', { message: '' }, { sender_id: 'host', timestamp: NOW }))).toBe(s);
    expect(ws(s, msg('CHAT_MESSAGE', { message: ' \n ' }, { sender_id: 'host', timestamp: NOW }))).toBe(s);
  });

  it(`caps chat at ${CHAT_CAP}, keeping the newest`, () => {
    let s = synced();
    for (let i = 0; i < CHAT_CAP + 5; i++) s = ws(s, msg('CHAT_MESSAGE', { message: `m${i}` }, { sender_id: 'host', timestamp: NOW + i }));
    expect(s.chat).toHaveLength(CHAT_CAP);
    expect(s.chat.at(-1)?.message).toBe(`m${CHAT_CAP + 4}`);
    expect(s.chat[0]?.message).toBe('m5');
  });

  it('live media raises the live-unsupported notice; vod clears it', () => {
    const live = ws(synced(), msg('CHANGE_MEDIA', { media_url: 'live', media_time_seconds: 0, kind: 'live' }, { sender_id: 'host' }));
    expect(live.notice?.kind).toBe('live-unsupported');
    const back = ws(live, msg('CHANGE_MEDIA', { media_url: 'vod', media_time_seconds: 0 }, { sender_id: 'host' }));
    expect(back.notice).toBeUndefined();
    expect(ws(initialRoomState('r1', ME), sync({ kind: 'live' })).notice?.kind).toBe('live-unsupported');
  });

  it('SFU_PEERS replaces the roster; null means empty', () => {
    const peer = { user_id: 'host', username: 'host', is_muted: false, is_camera_on: false, is_screen_sharing: false };
    const s = ws(synced(), msg('SFU_PEERS', { peers: [peer] }));
    expect(s.roster).toEqual([peer]);
    expect(ws(s, msg('SFU_PEERS', { peers: null })).roster).toEqual([]);
  });

  it('tracks viewers from JOIN_ROOM/LEAVE_ROOM', () => {
    let s = ws(synced(), msg('JOIN_ROOM', undefined, { sender_id: 'host' }));
    s = ws(s, msg('JOIN_ROOM', undefined, { sender_id: 'host' }));
    s = ws(s, msg('JOIN_ROOM', undefined, { sender_id: 'guest' }));
    expect(s.viewers).toEqual(['host', 'guest']);
    expect(ws(s, msg('LEAVE_ROOM', undefined, { sender_id: 'host' })).viewers).toEqual(['guest']);
  });

  it('ignores malformed payloads without throwing', () => {
    const s = synced();
    for (const t of ['SYNC_PLAYBACK', 'PLAY', 'PAUSE', 'SEEK', 'CHANGE_MEDIA', 'CHAT_MESSAGE', 'SFU_PEERS', 'LIVE_LEADER']) {
      expect(ws(s, msg(t, 'oops', { sender_id: 'host' }))).toBe(s);
    }
  });
});

function fakeSocket() {
  const sent: { type: string; payload: unknown }[] = [];
  let onMsg: (m: WSMessage) => void = () => undefined;
  let onState: (s: SocketState) => void = () => undefined;
  let open = false;
  return {
    sent,
    socket: {
      retryNow: vi.fn(),
      connect: vi.fn(() => {
        open = true;
        onState('open');
      }),
      close: vi.fn(() => {
        open = false;
        onState('closed');
      }),
      send: vi.fn((type: string, payload: unknown) => {
        if (!open) return false;
        sent.push({ type, payload });
        return true;
      }),
      onMessage: (cb: (m: WSMessage) => void) => {
        onMsg = cb;
        return () => undefined;
      },
      onState: (cb: (s: SocketState) => void) => {
        onState = cb;
        return () => undefined;
      },
    },
    deliver: (m: WSMessage) => onMsg(m),
    drop: () => {
      open = false;
      onState('reconnecting');
    },
  };
}

function session(canControl = false, over: Partial<{ joinRoom: () => Promise<unknown>; canChat: boolean }> = {}) {
  const fs = fakeSocket();
  const clock = { now: NOW };
  const canChat = over.canChat ?? true;
  const { logger, lines } = fakeLogger();
  const calls: string[] = [];
  const api = {
    joinRoom: vi.fn(async () => {
      calls.push('join');
      if (over.joinRoom) await over.joinRoom();
      return member(canControl, canChat);
    }),
    getRoom: vi.fn(async () => {
      calls.push('getRoom');
      return { room, member: member(canControl, canChat) };
    }),
    getMessages: vi.fn(async () => {
      calls.push('getMessages');
      return [chatMsg('1', 'hello')];
    }),
  };
  const rs = createRoomSession('r1', ME, {
    api,
    createSocket: () => {
      calls.push('socket');
      return fs.socket;
    },
    now: () => clock.now,
    logger,
  });
  const events: RoomEvent[] = [];
  rs.subscribe((_s, e) => events.push(e));
  return { rs, fs, calls, lines, events, clock };
}

describe('createRoomSession', () => {
  it('joins before reading the room and opening the socket', async () => {
    const { rs, calls } = session();
    expect(await rs.enter()).toBe(true);
    expect(calls[0]).toBe('join');
    expect(calls.slice(1, 3).sort()).toEqual(['getMessages', 'getRoom']);
    expect(calls[3]).toBe('socket');
    expect(rs.getState()).toMatchObject({ connection: 'open', chat: [{ message: 'hello' }] });
  });

  it('reports enter failure as a notice and opens no socket', async () => {
    const { rs, calls } = session(false, { joinRoom: () => Promise.reject(new Error('404')) });
    expect(await rs.enter()).toBe(false);
    expect(rs.getState().notice?.kind).toBe('enter-failed');
    expect(calls).not.toContain('socket');
  });

  it('opens no socket when left during enter', async () => {
    const { rs, calls } = session();
    const p = rs.enter();
    rs.leave();
    expect(await p).toBe(false);
    expect(calls).not.toContain('socket');
  });

  it('emits playback events with the cause, state events otherwise', async () => {
    const { rs, fs, events } = session();
    await rs.enter();
    events.length = 0;
    fs.deliver(sync());
    fs.deliver(msg('CHAT_MESSAGE', { message: 'x' }, { sender_id: 'host', timestamp: 1 }));
    fs.deliver(msg('SEEK', { media_time_seconds: 50 }, { sender_id: 'host' }));
    expect(events).toEqual([
      { type: 'playback', reason: 'SYNC_PLAYBACK' },
      { type: 'chat', message: expect.objectContaining({ message: 'x' }) },
      { type: 'playback', reason: 'SEEK' },
    ]);
  });

  it('declines live leadership when named leader', async () => {
    const { rs, fs, lines } = session();
    await rs.enter();
    fs.deliver(msg('LIVE_LEADER', { leader_id: 'host', leader_name: 'host' }));
    expect(fs.sent).toHaveLength(0);
    fs.deliver(msg('LIVE_LEADER', { leader_id: 'me', leader_name: 'couch' }));
    expect(fs.sent).toEqual([{ type: 'LIVE_POSITION', payload: { position: { sn: 0, cc: 0, offset: 0 }, age_ms: 0, unable: true } }]);
    expect(lines.some((l) => l.msg === 'declined live leadership')).toBe(true);
  });

  it('logs and drops a malformed payload', async () => {
    const { rs, fs, lines, events } = session();
    await rs.enter();
    fs.deliver(sync());
    const before = rs.getState();
    events.length = 0;
    expect(() => fs.deliver(msg('PLAY', 'oops', { sender_id: 'host' }))).not.toThrow();
    expect(rs.getState()).toBe(before);
    expect(events).toEqual([]);
    expect(lines).toContainEqual(expect.objectContaining({ level: 'warn', msg: 'dropped malformed payload', ctx: { type: 'PLAY' } }));
  });

  describe('sendPlayback', () => {
    it('is forbidden without can_control_playback, and sends nothing', async () => {
      const { rs, fs } = session(false);
      await rs.enter();
      fs.deliver(sync());
      expect(rs.sendPlayback('PLAY', 10)).toBe('forbidden');
      expect(fs.sent).toEqual([]);
    });

    it('is not-ready before SYNC_PLAYBACK', async () => {
      const { rs } = session(true);
      await rs.enter();
      expect(rs.sendPlayback('PLAY', 10)).toBe('not-ready');
    });

    it('is offline while the socket is down', async () => {
      const { rs, fs } = session(true);
      await rs.enter();
      fs.deliver(sync());
      fs.drop();
      expect(rs.sendPlayback('PAUSE', 10)).toBe('offline');
      expect(rs.getState().playback?.isPlaying).toBe(false);
    });

    it('sends and applies optimistically; the echo is then ignored', async () => {
      const { rs, fs, events } = session(true);
      await rs.enter();
      fs.deliver(sync());
      events.length = 0;
      expect(rs.sendPlayback('PLAY', 12)).toBe('sent');
      expect(fs.sent).toEqual([{ type: 'PLAY', payload: { media_time_seconds: 12 } }]);
      expect(rs.getState().playback).toMatchObject({ isPlaying: true, anchorTime: 12 });
      expect(events).toEqual([{ type: 'playback', reason: 'local PLAY' }]);
      const after = rs.getState();
      fs.deliver(msg('PLAY', { media_time_seconds: 12 }, { sender_id: 'me', timestamp: NOW - 4000 }));
      expect(rs.getState()).toBe(after);
    });
  });

  describe('changeMedia', () => {
    it('is forbidden without can_control_playback, and sends nothing', async () => {
      const { rs, fs } = session(false);
      await rs.enter();
      fs.deliver(sync());
      expect(rs.changeMedia('v')).toBe('forbidden');
      expect(fs.sent).toEqual([]);
      expect(rs.getState().playback?.mediaUrl).toBe('u');
    });

    it('is not-ready before SYNC_PLAYBACK, offline while the socket is down', async () => {
      const { rs, fs } = session(true);
      await rs.enter();
      expect(rs.changeMedia('v')).toBe('not-ready');
      fs.deliver(sync());
      fs.drop();
      expect(rs.changeMedia('v')).toBe('offline');
      expect(rs.getState().playback?.mediaUrl).toBe('u');
    });

    it('sends the web client payload and restarts locally paused at 0; the echo is ignored', async () => {
      const { rs, fs, events } = session(true);
      await rs.enter();
      fs.deliver(sync({ is_playing: true, media_time_seconds: 300 }));
      events.length = 0;
      expect(rs.changeMedia('v')).toBe('sent');
      expect(fs.sent).toEqual([{ type: 'CHANGE_MEDIA', payload: { media_url: 'v', media_time_seconds: 0, is_playing: false } }]);
      expect(rs.getState().playback).toMatchObject({ mediaUrl: 'v', kind: 'vod', isPlaying: false, anchorTime: 0 });
      expect(events).toEqual([{ type: 'playback', reason: 'local CHANGE_MEDIA' }]);
      const after = rs.getState();
      fs.deliver(msg('CHANGE_MEDIA', { media_url: 'v', media_time_seconds: 0, is_playing: false }, { sender_id: 'me' }));
      expect(rs.getState()).toBe(after);
    });
  });

  describe('sendChat', () => {
    const chatFrame = (text: string, sender = 'host', timestamp = NOW) => msg('CHAT_MESSAGE', { message: text }, { sender_id: sender, sender_name: sender, timestamp });

    it('is not-ready before entering', () => {
      const { rs, fs } = session();
      expect(rs.sendChat('hi')).toBe('not-ready');
      expect(fs.sent).toEqual([]);
    });

    it('is forbidden without can_send_messages, before looking at the text', async () => {
      const { rs, fs } = session(false, { canChat: false });
      await rs.enter();
      expect(rs.getState().canChat).toBe(false);
      expect(rs.sendChat('😂')).toBe('forbidden');
      expect(rs.sendChat('')).toBe('forbidden');
      expect(fs.sent).toEqual([]);
    });

    it('checks the text: empty, too long (UTF-8 bytes)', async () => {
      const { rs, fs } = session();
      await rs.enter();
      expect(rs.sendChat('   ')).toBe('empty');
      expect(rs.sendChat('😂'.repeat(501))).toBe('too-long');
      expect(fs.sent).toEqual([]);
    });

    it('needs no playback control and no SYNC_PLAYBACK; sends the trimmed text and is not optimistic', async () => {
      const { rs, fs, events } = session(false);
      await rs.enter();
      events.length = 0;
      expect(rs.sendChat('  Pause please!  ')).toBe('sent');
      expect(fs.sent).toEqual([{ type: 'CHAT_MESSAGE', payload: { message: 'Pause please!' } }]);
      expect(rs.getState().chat.map((m) => m.message)).toEqual(['hello']);
      expect(events).toEqual([]);
    });

    it('throttles to one send per second, counting only sends that went out', async () => {
      const { rs, fs, clock } = session();
      await rs.enter();
      expect(rs.sendChat('😂')).toBe('sent');
      clock.now += 999;
      expect(rs.sendChat('🔥')).toBe('throttled');
      // A refused text does not restart the window either.
      expect(rs.sendChat('')).toBe('empty');
      clock.now += 1;
      expect(rs.sendChat('🔥')).toBe('sent');
      fs.drop();
      clock.now += 5000;
      expect(rs.sendChat('👏')).toBe('offline');
      expect(fs.sent.map((f) => f.payload)).toEqual([{ message: '😂' }, { message: '🔥' }]);
    });

    it('offline does not start the throttle window', async () => {
      const { rs, fs, clock } = session();
      await rs.enter();
      fs.drop();
      expect(rs.sendChat('a')).toBe('offline');
      fs.socket.connect();
      clock.now += 10;
      expect(rs.sendChat('a')).toBe('sent');
    });

    it("emits 'chat' once per new live message, including the own echo; not for history or duplicates", async () => {
      const { rs, fs, events } = session();
      await rs.enter();
      // The history ('hello') arrived as a plain state change.
      expect(events.filter((e) => e.type === 'chat')).toEqual([]);
      events.length = 0;
      fs.deliver(chatFrame('😂'));
      fs.deliver(chatFrame('😂')); // same sender + timestamp: a duplicate
      fs.deliver(chatFrame('🔥', 'me', NOW + 5)); // own echo
      fs.deliver(chatFrame('  ', 'host', NOW + 6)); // blank: dropped
      expect(events).toEqual([
        { type: 'chat', message: expect.objectContaining({ user_id: 'host', message: '😂' }) },
        { type: 'chat', message: expect.objectContaining({ user_id: 'me', username: 'me', message: '🔥' }) },
      ]);
    });

    it("still emits 'chat' when the chat is at its cap", async () => {
      const { rs, fs, events } = session();
      await rs.enter();
      for (let i = 0; i < CHAT_CAP; i++) fs.deliver(chatFrame(`m${i}`, 'host', NOW + i));
      events.length = 0;
      fs.deliver(chatFrame('last', 'host', NOW + CHAT_CAP));
      expect(events).toEqual([{ type: 'chat', message: expect.objectContaining({ message: 'last' }) }]);
    });

    it("keeps 'playback' and 'state' as they were around chat", async () => {
      const { rs, fs, events } = session();
      await rs.enter();
      events.length = 0;
      fs.deliver(sync());
      fs.deliver(chatFrame('x'));
      fs.deliver(msg('JOIN_ROOM', undefined, { sender_id: 'guest' }));
      expect(events.map((e) => e.type)).toEqual(['playback', 'chat', 'state']);
    });
  });

  it('retryConnection asks the socket to retry; a no-op before enter and after leave', async () => {
    const { rs, fs } = session();
    rs.retryConnection();
    await rs.enter();
    rs.retryConnection();
    expect(fs.socket.retryNow).toHaveBeenCalledOnce();
    rs.leave();
    rs.retryConnection();
    expect(fs.socket.retryNow).toHaveBeenCalledOnce();
  });

  it('leave closes the socket', async () => {
    const { rs, fs } = session();
    await rs.enter();
    rs.leave();
    expect(fs.socket.close).toHaveBeenCalledOnce();
    expect(rs.getState().connection).toBe('closed');
  });
});
