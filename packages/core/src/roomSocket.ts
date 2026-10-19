import type { Logger } from './logger';
import { redact } from './logger';
import { parseMessage, type WSEventType, type WSMessage } from './protocol';

export type SocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'unauthorized';

interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketCtor = new (url: string, protocols?: string | string[], options?: { headers?: Record<string, string> }) => WebSocketLike;

export interface SocketDeps {
  wsBaseUrl: string;
  WebSocketImpl: WebSocketCtor;
  getSessionId(): string | null;
  /** Called before each reconnect; resolve false when the session is no longer valid (HTTP 401). */
  checkSession?(): Promise<boolean>;
  /** 'query' is what Inox's web client uses; 'header' needs a WebSocket that accepts custom headers. */
  authMode: 'query' | 'header';
  logger: Logger;
  random?: () => number;
}

const OPEN = 1;
const BACKOFF_START_MS = 1000;
const BACKOFF_CAP_MS = 15_000;
const STABLE_OPEN_MS = 10_000;

/** Backoff for the given attempt (1-based): 1 s doubling to a 15 s cap, ±20% jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * One room's WebSocket. Unlike Inox's web client, which gives up after a few attempts, this
 * reconnects for as long as it is open: a TV left on a room screen must recover on its own.
 * Every successful (re)connect makes the server send a fresh SYNC_PLAYBACK (ws/hub.go
 * registerClient), so resync needs no extra protocol.
 */
export class RoomSocket {
  private ws: WebSocketLike | null = null;
  private state: SocketState = 'idle';
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private readonly messageListeners = new Set<(m: WSMessage) => void>();
  private readonly stateListeners = new Set<(s: SocketState) => void>();

  constructor(private readonly roomId: string, private readonly deps: SocketDeps) {}

  connect(): void {
    this.stopped = false;
    this.open();
  }

  close(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      // A frame or error arriving during the close must not reach a room screen that is gone.
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onopen = null;
      ws.close(1000, 'leaving room');
    }
    this.setState('closed');
  }

  /**
   * Skips the rest of the backoff wait (a Retry button). The attempt count is kept, so a failed
   * retry backs off as it would have. No-op unless a reconnect timer is pending: not while open or
   * connecting, during the pre-reconnect session check, after close() or once unauthorized.
   */
  retryNow(): void {
    if (this.stopped || this.state !== 'reconnecting' || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.deps.logger.info('socket', 'retrying now', { attempt: this.attempt });
    this.open();
  }

  /** Returns false when the socket is not open; playback events are never queued. */
  send<T>(type: WSEventType, payload: T): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    this.ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
    return true;
  }

  onMessage(cb: (m: WSMessage) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onState(cb: (s: SocketState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.state);
    return () => this.stateListeners.delete(cb);
  }

  getState(): SocketState {
    return this.state;
  }

  private open(): void {
    const session = this.deps.getSessionId();
    const base = `${this.deps.wsBaseUrl}/rooms/${this.roomId}/ws`;
    const useQuery = this.deps.authMode === 'query';
    const url = useQuery && session ? `${base}?session_id=${encodeURIComponent(session)}` : base;
    const headers = !useQuery && session ? { Authorization: `Bearer ${session}` } : undefined;

    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');
    this.deps.logger.info('socket', 'opening', { room: this.roomId, attempt: this.attempt, auth: this.deps.authMode, session: redact(session) });

    const ws = new this.deps.WebSocketImpl(url, undefined, headers ? { headers } : undefined);
    this.ws = ws;

    ws.onopen = () => {
      this.setState('open');
      this.stableTimer = setTimeout(() => {
        this.attempt = 0;
      }, STABLE_OPEN_MS);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = parseMessage(ev.data);
      if (!msg) {
        this.deps.logger.warn('socket', 'dropped malformed frame');
        return;
      }
      for (const cb of this.messageListeners) cb(msg);
    };
    ws.onerror = () => {
      this.deps.logger.warn('socket', 'error');
    };
    ws.onclose = (ev) => {
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.ws = null;
      if (this.stopped) return;
      this.deps.logger.warn('socket', 'closed', { code: ev?.code, reason: ev?.reason });
      void this.scheduleReconnect();
    };
  }

  private async scheduleReconnect(): Promise<void> {
    this.attempt += 1;
    this.setState('reconnecting');
    if (this.deps.checkSession) {
      const valid = await this.deps.checkSession().catch(() => true); // network errors: keep trying
      if (!valid) {
        this.setState('unauthorized');
        return;
      }
    }
    if (this.stopped) return;
    const delay = backoffDelay(this.attempt, this.deps.random);
    this.deps.logger.info('socket', 'reconnect scheduled', { attempt: this.attempt, delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null; // pending-ness is what retryNow() checks
      this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.retryTimer = null;
    this.stableTimer = null;
  }

  private setState(s: SocketState): void {
    if (this.state === s) return;
    this.state = s;
    for (const cb of this.stateListeners) cb(s);
  }
}
