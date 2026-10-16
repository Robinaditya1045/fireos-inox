import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, RoomSocket, type SocketDeps, type SocketState } from '../src';
import { FakeWebSocket, fakeLogger } from './helpers';

function makeSocket(over: Partial<SocketDeps> = {}) {
  const { logger, lines } = fakeLogger();
  const deps: SocketDeps = {
    wsBaseUrl: 'ws://inox.test:18080/api/v1',
    WebSocketImpl: FakeWebSocket,
    getSessionId: () => 'sess-abcdef123',
    authMode: 'query',
    logger,
    random: () => 0.5, // no jitter
    ...over,
  };
  const socket = new RoomSocket('room-1', deps);
  const states: SocketState[] = [];
  socket.onState((s) => states.push(s));
  return { socket, states, lines };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('backoffDelay', () => {
  it('doubles from 1 s to a 15 s cap', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((a) => backoffDelay(a, () => 0.5))).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });

  it('jitters within ±20%', () => {
    expect(backoffDelay(1, () => 0)).toBe(800);
    expect(backoffDelay(1, () => 1)).toBe(1200);
    expect(backoffDelay(9, () => 0)).toBe(12000);
    expect(backoffDelay(9, () => 1)).toBe(18000);
  });
});

describe('RoomSocket', () => {
  it('authenticates with ?session_id= in query mode', () => {
    makeSocket().socket.connect();
    expect(FakeWebSocket.last().url).toBe('ws://inox.test:18080/api/v1/rooms/room-1/ws?session_id=sess-abcdef123');
    expect(FakeWebSocket.last().options).toBeUndefined();
  });

  it('authenticates with a Bearer header in header mode', () => {
    makeSocket({ authMode: 'header' }).socket.connect();
    expect(FakeWebSocket.last().url).toBe('ws://inox.test:18080/api/v1/rooms/room-1/ws');
    expect(FakeWebSocket.last().options).toEqual({ headers: { Authorization: 'Bearer sess-abcdef123' } });
  });

  it('never logs the full session ID', () => {
    const { socket, lines } = makeSocket();
    socket.connect();
    expect(JSON.stringify(lines)).not.toContain('sess-abcdef123');
    expect(JSON.stringify(lines)).toContain('sess-a…');
  });

  it('reconnects with backoff 1, 2, 4, 8, 15 s and never gives up', () => {
    const { socket, states } = makeSocket();
    socket.connect();
    expect(states).toEqual(['idle', 'connecting']);
    const delays = [1000, 2000, 4000, 8000, 15000, 15000, 15000];
    for (const d of delays) {
      const before = FakeWebSocket.instances.length;
      FakeWebSocket.last().serverDrop();
      vi.advanceTimersByTime(d - 1);
      expect(FakeWebSocket.instances.length).toBe(before);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances.length).toBe(before + 1);
    }
    expect(states.at(-1)).toBe('reconnecting');
  });

  it('resets the backoff after staying open for 10 s', () => {
    const { socket, states } = makeSocket();
    socket.connect();
    FakeWebSocket.last().serverDrop();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.last().serverDrop();
    vi.advanceTimersByTime(2000);
    FakeWebSocket.last().serverOpen();
    expect(states.at(-1)).toBe('open');
    vi.advanceTimersByTime(10_000);
    FakeWebSocket.last().serverDrop();
    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('does not reset the backoff when the socket drops within 10 s', () => {
    const { socket } = makeSocket();
    socket.connect();
    FakeWebSocket.last().serverDrop();
    vi.advanceTimersByTime(1000);
    FakeWebSocket.last().serverOpen();
    vi.advanceTimersByTime(9_000);
    FakeWebSocket.last().serverDrop();
    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(before);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
  });

  it('goes unauthorized instead of reconnecting when the session check fails', async () => {
    const { socket, states } = makeSocket({ checkSession: async () => false });
    socket.connect();
    FakeWebSocket.last().serverDrop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toBe('unauthorized');
    expect(FakeWebSocket.instances.length).toBe(1);
  });

  it('keeps reconnecting when the session check itself fails (offline)', async () => {
    const { socket } = makeSocket({ checkSession: async () => Promise.reject(new Error('offline')) });
    socket.connect();
    FakeWebSocket.last().serverDrop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('drops a malformed frame with a warning, never throws', () => {
    const { socket, lines } = makeSocket();
    const got = vi.fn();
    socket.onMessage(got);
    socket.connect();
    FakeWebSocket.last().serverOpen();
    expect(() => FakeWebSocket.last().serverSend('{not json')).not.toThrow();
    expect(() => FakeWebSocket.last().serverSend('{"payload":1}')).not.toThrow();
    expect(got).not.toHaveBeenCalled();
    expect(lines.filter((l) => l.level === 'warn' && l.msg === 'dropped malformed frame')).toHaveLength(2);
    FakeWebSocket.last().serverSend({ type: 'PLAY', payload: { media_time_seconds: 1 }, timestamp: 5 });
    expect(got).toHaveBeenCalledWith({ type: 'PLAY', payload: { media_time_seconds: 1 }, timestamp: 5 });
  });

  it('send returns false unless open; never queues', () => {
    const { socket } = makeSocket();
    socket.connect();
    expect(socket.send('PLAY', { media_time_seconds: 1 })).toBe(false);
    FakeWebSocket.last().serverOpen();
    expect(socket.send('PLAY', { media_time_seconds: 1 })).toBe(true);
    expect(JSON.parse(FakeWebSocket.last().sent[0]!)).toMatchObject({ type: 'PLAY', payload: { media_time_seconds: 1 } });
    expect(FakeWebSocket.last().sent).toHaveLength(1);
  });

  it('close stops reconnecting', () => {
    const { socket, states } = makeSocket();
    socket.connect();
    FakeWebSocket.last().serverOpen();
    socket.close();
    expect(states.at(-1)).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);
  });
});
