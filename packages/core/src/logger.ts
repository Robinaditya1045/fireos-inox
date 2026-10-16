export interface Logger {
  debug(tag: string, msg: string, ctx?: Record<string, unknown>): void;
  info(tag: string, msg: string, ctx?: Record<string, unknown>): void;
  warn(tag: string, msg: string, ctx?: Record<string, unknown>): void;
  error(tag: string, msg: string, ctx?: Record<string, unknown>): void;
}

/** Session IDs are long-lived credentials: only ever log a prefix. */
export function redact(sessionId: string | null | undefined): string {
  return sessionId ? `${sessionId.slice(0, 6)}…` : '∅';
}
