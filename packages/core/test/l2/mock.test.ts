// L2 (docs/dev/testing.md): core against tools/mock-inox over real HTTP + WebSocket on localhost,
// with Node's own fetch and WebSocket standing in for the platform's.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startMock } from '../../../../tools/mock-inox/src/mock.mjs';
import {
  createApi,
  createRoomSession,
  isReaction,
  libraryEntries,
  playUrl,
  RoomSocket,
  type ChatMessage,
  type RoomEvent,
  type RoomSession,
  type Session,
  type WebSocketCtor,
} from '../../src';
import { fakeLogger } from '../helpers';

type Mock = Awaited<ReturnType<typeof startMock>>;
let mock: Mock;

beforeAll(async () => {
  mock = await startMock({ port: 0, control: true, rateLimit: false, quiet: true });
});
afterAll(async () => {
  await mock.close();
});

const open: RoomSession[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) s.leave();
  await control('reset');
  // Room playback state lives in the mock (as in Inox's hub) and outlives a test: park it paused.
  await control('send', '?type=PAUSE&t=0');
});

async function control(scenario: string, query = ''): Promise<Record<string, unknown>> {
  const res = await fetch(`${mock.url}/__control/${scenario}${query}`, { method: 'POST' });
  return (await res.json()) as Record<string, unknown>;
}

async function waitFor<T>(probe: () => T | undefined | false, timeoutMs = 5000, what = 'condition'): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Signs in and enters the room, wired exactly as the app does (RoomScreen / platform/services). */
async function participant(email: string) {
  const { logger, lines } = fakeLogger();
  let session: Session | null = null;
  const onUnauthorized = vi.fn(() => {
    session = null;
  });
  const api = createApi({ baseUrl: mock.apiUrl, fetch: (...a) => fetch(...a), getSessionId: () => session?.id ?? null, onUnauthorized, timeoutMs: 3000 });
  session = await api.login(email, mock.password);
  const me = { userId: session.user_id, username: session.username };
  const rs = createRoomSession(mock.roomId, me, {
    api,
    createSocket: (roomId) =>
      new RoomSocket(roomId, {
        wsBaseUrl: mock.wsUrl,
        WebSocketImpl: WebSocket as unknown as WebSocketCtor,
        getSessionId: () => session?.id ?? null,
        checkSession: async () => {
          try {
            await api.me();
            return true;
          } catch (err) {
            return (err as { status?: number }).status !== 401;
          }
        },
        authMode: 'query',
        logger,
      }),
    now: () => Date.now(),
    logger,
  });
  const events: RoomEvent[] = [];
  rs.subscribe((_s, e) => events.push(e));
  open.push(rs);
  expect(await rs.enter()).toBe(true);
  await waitFor(() => rs.getState().playback, 5000, 'first SYNC_PLAYBACK');
  return { rs, api, me, lines, events, onUnauthorized };
}

const tvEmail = () => mock.users.tv.email;
const hostEmail = () => mock.users.host.email;

describe('L2: core against mock-inox', () => {
  it('enters the room: join → details + history → socket → SYNC_PLAYBACK', async () => {
    const tv = await participant(tvEmail());
    const s = tv.rs.getState();
    expect(s.connection).toBe('open');
    expect(s.canControl).toBe(false);
    expect(s.member?.role).toBe('member');
    expect(s.playback?.mediaUrl).toMatch(/\/media\/stream\/hls\/fixture\/master\.m3u8$/);
    expect(s.chat).toEqual([]); // the mock answers messages:null, like Inox
    expect(tv.events).toContainEqual({ type: 'playback', reason: 'SYNC_PLAYBACK' });
  });

  it('follows the host; the host ignores its own echo', async () => {
    const tv = await participant(tvEmail());
    const host = await participant(hostEmail());
    expect(host.rs.sendPlayback('PLAY', 30)).toBe('sent');
    const pb = await waitFor(() => (tv.rs.getState().playback?.isPlaying ? tv.rs.getState().playback : undefined), 3000, 'TV to play');
    expect(pb.anchorTime).toBeGreaterThanOrEqual(30);
    expect(pb.anchorTime).toBeLessThan(30.5);
    // The host's echo must not re-apply: its playback object is the one from the optimistic send.
    const hostPb = host.rs.getState().playback;
    await new Promise((r) => setTimeout(r, 200));
    expect(host.rs.getState().playback).toBe(hostPb);
    expect(host.events.filter((e) => e.type === 'playback' && e.reason === 'PLAY')).toEqual([]);
  });

  it('a member is not allowed to control playback and sends nothing', async () => {
    const tv = await participant(tvEmail());
    expect(tv.rs.sendPlayback('PAUSE', 5)).toBe('forbidden');
    const { events } = (await control('events')) as { events: { user_id: string; type: string }[] };
    expect(events.filter((e) => e.user_id === tv.me.userId && ['PLAY', 'PAUSE', 'SEEK'].includes(e.type))).toEqual([]);
  });

  it('a promoted moderator controls playback and the room follows', async () => {
    mock.setRole('couch', 'moderator');
    try {
      const host = await participant(hostEmail());
      const tv = await participant(tvEmail());
      expect(tv.rs.getState().canControl).toBe(true);
      expect(tv.rs.sendPlayback('SEEK', 42)).toBe('sent');
      await waitFor(() => host.rs.getState().playback?.anchorTime === 42, 3000, 'host to follow the TV seek');
    } finally {
      mock.setRole('couch', 'member');
    }
  });

  it('library: a moderator switches the media from the list and the room restarts paused at 0', async () => {
    mock.setRole('couch', 'moderator');
    try {
      const host = await participant(hostEmail());
      const tv = await participant(tvEmail());
      expect(host.rs.sendPlayback('PLAY', 20)).toBe('sent');
      await waitFor(() => tv.rs.getState().playback?.isPlaying, 3000, 'TV to play');
      const entries = libraryEntries(await tv.api.listMedia());
      expect(entries.map((a) => a.title)).toEqual(['Test Pattern (mock fixture)']);
      const url = playUrl(entries[0]!);
      expect(tv.rs.changeMedia(url)).toBe('sent');
      const pb = await waitFor(() => (host.events.some((e) => e.type === 'playback' && e.reason === 'CHANGE_MEDIA') ? host.rs.getState().playback : undefined), 3000, 'host to get CHANGE_MEDIA');
      expect(pb).toMatchObject({ mediaUrl: url, isPlaying: false, anchorTime: 0 });
      const { room } = await host.api.getRoom(mock.roomId);
      expect(room.current_media_url).toBe(url);
    } finally {
      mock.setRole('couch', 'member');
    }
  });

  it('library: a member cannot switch the media and sends nothing', async () => {
    const since = Date.now();
    const tv = await participant(tvEmail());
    expect(tv.rs.changeMedia('http://elsewhere/master.m3u8')).toBe('forbidden');
    // The mock's event log outlives a test (the previous one sent a CHANGE_MEDIA as moderator).
    const { events } = (await control('events')) as { events: { at: number; user_id: string; type: string }[] };
    expect(events.filter((e) => e.at >= since && e.user_id === tv.me.userId && e.type === 'CHANGE_MEDIA')).toEqual([]);
  });

  it('drop-sockets: reconnects with backoff and resyncs from a fresh SYNC_PLAYBACK', async () => {
    const tv = await participant(tvEmail());
    await control('send', '?type=PLAY&t=12');
    await waitFor(() => tv.rs.getState().playback?.isPlaying, 3000, 'PLAY');
    const syncsBefore = tv.events.filter((e) => e.type === 'playback' && e.reason === 'SYNC_PLAYBACK').length;
    const states: string[] = [];
    tv.rs.subscribe((s) => states.push(s.connection));

    await control('drop-sockets');
    await waitFor(() => tv.rs.getState().connection === 'reconnecting', 2000, 'reconnecting');
    await waitFor(() => tv.rs.getState().connection === 'open', 4000, 'reopen');
    await waitFor(() => tv.events.filter((e) => e.type === 'playback' && e.reason === 'SYNC_PLAYBACK').length > syncsBefore, 2000, 'resync');
    expect(states).toContain('reconnecting');
    // The room kept playing server-side while the TV was away.
    const pb = tv.rs.getState().playback!;
    expect(pb.isPlaying).toBe(true);
    expect(pb.anchorTime).toBeGreaterThan(12.5);
    expect(tv.lines.some((l) => l.msg === 'reconnect scheduled')).toBe(true);
  });

  it('expire-sessions: the next reconnect finds a 401 and stops as unauthorized', async () => {
    const tv = await participant(tvEmail());
    await control('expire-sessions');
    await control('drop-sockets');
    await waitFor(() => tv.rs.getState().connection === 'unauthorized', 4000, 'unauthorized');
    expect(tv.onUnauthorized).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 1500));
    expect(tv.rs.getState().connection).toBe('unauthorized');
    const { connected } = (await control('events')) as { connected: string[] };
    expect(connected).not.toContain('couch');
  });

  it('malformed: a bad payload is logged and dropped, the session carries on', async () => {
    const tv = await participant(tvEmail());
    const before = tv.rs.getState();
    await control('malformed');
    await waitFor(() => tv.lines.find((l) => l.msg === 'dropped malformed payload'), 2000, 'drop log');
    expect(tv.rs.getState()).toBe(before);
    await control('send', '?type=SEEK&t=77');
    await waitFor(() => tv.rs.getState().playback?.anchorTime === 77, 2000, 'next event still applied');
  });

  it('make-leader: the TV declines live leadership within 2 s', async () => {
    const tv = await participant(tvEmail());
    const res = await control('make-leader', '?user=couch&timeout=2000');
    expect(res).toMatchObject({ leader: 'couch', declined: true });
    expect(res.ms as number).toBeLessThan(2000);
    expect(tv.lines.some((l) => l.msg === 'declined live leadership')).toBe(true);
  });

  it('latency: PLAY is compensated by the delivery delay (sender clock, < 5 s)', async () => {
    const tv = await participant(tvEmail());
    const host = await participant(hostEmail());
    await control('latency', '?ms=800');
    const sentAt = Date.now();
    expect(host.rs.sendPlayback('PLAY', 10)).toBe('sent');
    const pb = await waitFor(() => (tv.rs.getState().playback?.isPlaying ? tv.rs.getState().playback : undefined), 3000, 'delayed PLAY');
    const deliveredAfterS = (pb.anchorLocalMs - sentAt) / 1000;
    expect(deliveredAfterS).toBeGreaterThanOrEqual(0.75);
    // anchorTime = 10 + measured latency, so the TV lands where the host is now, not 0.8 s behind.
    expect(pb.anchorTime).toBeCloseTo(10 + deliveredAfterS, 1);
  });

  it('chat: live messages arrive, and history is there on the next entry', async () => {
    const tv = await participant(tvEmail());
    const host = await participant(hostEmail());
    // The host speaks through the raw socket envelope, as Inox's web client does.
    const ws = new WebSocket(`${mock.wsUrl}/rooms/${mock.roomId}/ws?session_id=${await loginId(hostEmail())}`);
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', payload: { message: 'popcorn?' }, timestamp: Date.now() }));
    await waitFor(() => tv.rs.getState().chat.find((m) => m.message === 'popcorn?'), 2000, 'live chat');
    await waitFor(() => host.rs.getState().chat.find((m) => m.message === 'popcorn?'), 2000, 'host echo');
    ws.close();
    tv.rs.leave();
    const again = await participant(tvEmail());
    expect(again.rs.getState().chat.filter((m) => m.message === 'popcorn?')).toHaveLength(1);
  });
});

describe('L2: Couch Reactions (D17)', () => {
  type LoggedEvent = { at: number; user_id: string; type: string; payload: unknown };
  const chatEventsSince = async (since: number, userId: string) =>
    ((await control('events')) as { events: LoggedEvent[] }).events.filter((e) => e.at >= since && e.user_id === userId && e.type === 'CHAT_MESSAGE');
  const chatEvents = (events: RoomEvent[]) => events.flatMap((e) => (e.type === 'chat' ? [e.message] : []));

  it('a TV reaction reaches the host with the TV as sender, and is saved', async () => {
    const tv = await participant(tvEmail());
    const host = await participant(hostEmail());
    const mine = (list: ChatMessage[]) => list.filter((m) => m.user_id === tv.me.userId && m.message === '😂').length;
    const savedBefore = mine(await host.api.getMessages(mock.roomId, 100));
    const sentAt = Date.now();
    expect(tv.rs.getState().canChat).toBe(true); // a member, without playback control
    expect(tv.rs.sendChat('😂')).toBe('sent');
    const got = await waitFor(() => chatEvents(host.events).find((m) => m.message === '😂'), 2000, 'host to get the reaction');
    expect(Date.now() - sentAt).toBeLessThan(1000);
    expect(got).toMatchObject({ user_id: tv.me.userId, username: 'couch' });
    // Not optimistic: the TV shows its own reaction from the echo.
    await waitFor(() => chatEvents(tv.events).find((m) => m.message === '😂' && m.user_id === tv.me.userId), 2000, 'own echo');
    expect(mine(await host.api.getMessages(mock.roomId, 100))).toBe(savedBefore + 1);
  });

  it('a host reaction floats on the TV', async () => {
    const tv = await participant(tvEmail());
    const host = await participant(hostEmail());
    expect(host.rs.sendChat('🔥')).toBe('sent');
    const got = await waitFor(() => chatEvents(tv.events).find((m) => m.user_id === host.me.userId), 2000, 'TV to get the reaction');
    expect(got).toMatchObject({ username: 'host', message: '🔥' });
    expect(isReaction(got.message)).toBe(true);
  });

  it('two quick sends: the second is throttled and never reaches the server', async () => {
    const since = Date.now();
    const tv = await participant(tvEmail());
    expect(tv.rs.sendChat('👏')).toBe('sent');
    expect(tv.rs.sendChat('😮')).toBe('throttled');
    await waitFor(() => chatEvents(tv.events).find((m) => m.message === '👏'), 2000, 'the echo of the first send');
    await new Promise((r) => setTimeout(r, 200));
    expect((await chatEventsSince(since, tv.me.userId)).map((e) => e.payload)).toEqual([{ message: '👏' }]);
  });

  it('a muted member gets forbidden and sends nothing', async () => {
    const since = Date.now();
    expect(await control('permissions', `?user=${encodeURIComponent(tvEmail())}&can_send_messages=false`)).toMatchObject({ user: 'couch', permissions: { can_send_messages: false } });
    const tv = await participant(tvEmail());
    expect(tv.rs.getState().canChat).toBe(false);
    expect(tv.rs.sendChat('😂')).toBe('forbidden');
    await new Promise((r) => setTimeout(r, 200));
    expect(await chatEventsSince(since, tv.me.userId)).toEqual([]);
  });

  it('mock mirrors Inox: chat Inox would not save is still broadcast (why the client enforces the rules)', async () => {
    const host = await participant(hostEmail());
    await participant(tvEmail()); // joins the room
    await control('permissions', '?user=couch&can_send_messages=false');
    const raw = new WebSocket(`${mock.wsUrl}/rooms/${mock.roomId}/ws?session_id=${await loginId(tvEmail())}`);
    await new Promise((r) => raw.addEventListener('open', r, { once: true }));
    const tag = `muted-${Date.now()}`;
    const long = `long-${Date.now()}-${'é'.repeat(1000)}`; // > 2000 UTF-8 bytes
    raw.send(JSON.stringify({ type: 'CHAT_MESSAGE', payload: { message: tag }, timestamp: Date.now() }));
    await waitFor(() => host.rs.getState().chat.find((m) => m.message === tag), 2000, 'muted chat to be broadcast');
    await control('permissions', '?user=couch&can_send_messages=true');
    raw.send(JSON.stringify({ type: 'CHAT_MESSAGE', payload: { message: long }, timestamp: Date.now() + 1 }));
    raw.send(JSON.stringify({ type: 'CHAT_MESSAGE', payload: { message: `  ${tag}-ok  ` }, timestamp: Date.now() + 2 }));
    await waitFor(() => host.rs.getState().chat.find((m) => m.message === `  ${tag}-ok  `), 2000, 'untrimmed broadcast');
    // The long frame was relayed ahead of the -ok one (same socket, in order); the session drops it
    // because Inox won't save it either.
    expect(host.rs.getState().chat.some((m) => m.message === long)).toBe(false);
    raw.close();
    const saved = (await host.api.getMessages(mock.roomId, 100)).map((m) => m.message);
    expect(saved).not.toContain(tag);
    expect(saved).not.toContain(long);
    expect(saved).toContain(`${tag}-ok`); // saved trimmed
  });
});

async function loginId(email: string): Promise<string> {
  const api = createApi({ baseUrl: mock.apiUrl, fetch: (...a) => fetch(...a), getSessionId: () => null });
  return (await api.login(email, mock.password)).id;
}
