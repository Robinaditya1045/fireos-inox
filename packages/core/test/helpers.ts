import { vi } from 'vitest';
import type { Logger, WSMessage } from '../src';

export function fakeLogger() {
  const lines: { level: string; tag: string; msg: string; ctx?: Record<string, unknown> }[] = [];
  const at = (level: string) => (tag: string, msg: string, ctx?: Record<string, unknown>) => void lines.push({ level, tag, msg, ctx });
  const logger: Logger = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { logger, lines };
}

/** In-memory WebSocket: the test drives open/message/close; sent frames are recorded. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols?: string | string[],
    readonly options?: { headers?: Record<string, string> },
  ) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  });
  serverOpen() {
    this.readyState = 1;
    this.onopen?.({});
  }
  serverSend(frame: string | Partial<WSMessage>) {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }
  serverDrop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  static last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('no socket opened');
    return ws;
  }
}

export function msg<T>(type: string, payload: T, extra: Partial<Omit<WSMessage, 'payload'>> = {}): WSMessage<T> {
  return { type, payload, timestamp: 0, ...extra };
}
