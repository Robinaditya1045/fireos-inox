import type { ChatMessage, MediaAsset, Room, RoomMember, Session, User } from './protocol';

export class ApiError extends Error {
  /** HTTP status, or 0 for a network failure or timeout. */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface ApiDeps {
  baseUrl: string;
  fetch: typeof fetch;
  getSessionId(): string | null;
  onUnauthorized?(): void;
  timeoutMs?: number;
}

export function createApi(deps: ApiDeps) {
  const timeoutMs = deps.timeoutMs ?? 10_000;

  // /healthz lives at the server root, outside /api/v1.
  const rootUrl = deps.baseUrl.replace(/\/api\/v1\/?$/, '');

  async function request<T>(method: string, path: string, body?: unknown, absolute = false): Promise<T> {
    const headers: Record<string, string> = {};
    const session = deps.getSessionId();
    if (session) headers.Authorization = `Bearer ${session}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await deps.fetch(absolute ? `${rootUrl}${path}` : `${deps.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ApiError(0, err instanceof Error ? err.message : 'network error');
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) {
      // Inox errors are always {"error": "..."} (api/respond).
      let message = text || res.statusText;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        // non-JSON body: keep the raw text
      }
      // A 401 ends a session only if the request carried one: a wrong password at sign-in is also a 401.
      if (res.status === 401 && session) deps.onUnauthorized?.();
      throw new ApiError(res.status, message);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    health: () => request<Record<string, string>>('GET', '/healthz', undefined, true),
    login: (email: string, password: string) => request<Session>('POST', '/auth/login', { email, password }),
    me: () => request<User>('GET', '/users/me'),
    logout: () => request<unknown>('POST', '/auth/logout'),
    // Inox encodes empty Go slices as JSON null, so every list endpoint is normalised to [].
    listRooms: async () => (await request<Room[] | null>('GET', '/rooms')) ?? [],
    getRoom: (id: string) => request<{ room: Room; member: RoomMember }>('GET', `/rooms/${id}`),
    joinRoom: (id: string) => request<RoomMember>('POST', `/rooms/${id}/join`),
    listMedia: async () => (await request<MediaAsset[] | null>('GET', '/media?limit=100')) ?? [],
    getMessages: async (roomId: string, limit = 50) =>
      (await request<{ messages: ChatMessage[] | null }>('GET', `/rooms/${roomId}/messages?limit=${limit}`)).messages ?? [],
  };
}

export type Api = ReturnType<typeof createApi>;
