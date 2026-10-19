import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../src';

const BASE = 'http://inox.test:18080/api/v1';

function respond(status: number, body: unknown) {
  return new Response(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function setup(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, session: string | null = 'sess-abcdef123') {
  const fetch = vi.fn(fetchImpl);
  const onUnauthorized = vi.fn();
  const api = createApi({ baseUrl: BASE, fetch: fetch as unknown as typeof globalThis.fetch, getSessionId: () => session, onUnauthorized, timeoutMs: 1000 });
  return { api, fetch, onUnauthorized };
}

afterEach(() => vi.useRealTimers());

describe('createApi', () => {
  it('sends the Bearer header and JSON body', async () => {
    const { api, fetch } = setup(async () => respond(200, { id: 's' }));
    await api.login('a@b.c', 'pw');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/auth/login`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sess-abcdef123', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ email: 'a@b.c', password: 'pw' });
  });

  it('omits Authorization without a session', async () => {
    const { api, fetch } = setup(async () => respond(200, []), null);
    await api.listMedia();
    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty('Authorization');
  });

  it('maps {"error":"x"} with 401 to ApiError(401, "x") and calls onUnauthorized', async () => {
    const { api, onUnauthorized } = setup(async () => respond(401, { error: 'x' }));
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: 'x' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('a 401 to a request without a session (wrong password) is not a session end', async () => {
    const { api, onUnauthorized } = setup(async () => respond(401, { error: 'invalid email or password' }), null);
    await expect(api.login('a@b.c', 'wrong')).rejects.toMatchObject({ status: 401, message: 'invalid email or password' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps a non-JSON error body as the message, without onUnauthorized for other statuses', async () => {
    const { api, onUnauthorized } = setup(async () => respond(502, 'Bad Gateway'));
    await expect(api.listRooms()).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('times out with ApiError(0)', async () => {
    vi.useFakeTimers();
    const { api } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const p = api.me().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ name: 'ApiError', status: 0 });
  });

  it('maps a network failure to ApiError(0)', async () => {
    const { api } = setup(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(api.me()).rejects.toMatchObject({ status: 0, message: 'fetch failed' });
  });

  it('normalises Inox null lists to [] (contract §6)', async () => {
    const { api } = setup(async (url) => respond(200, url.includes('/messages') ? { room_id: 'r', messages: null, count: 0 } : null));
    expect(await api.listRooms()).toEqual([]);
    expect(await api.listMedia()).toEqual([]);
    expect(await api.getMessages('r')).toEqual([]);
  });

  it('calls /healthz at the server root', async () => {
    const { api, fetch } = setup(async () => respond(200, { status: 'ok' }));
    await api.health();
    expect(fetch.mock.calls[0]![0]).toBe('http://inox.test:18080/healthz');
  });
});
