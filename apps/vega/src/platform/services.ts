import {ApiError, createApi, type Session} from '../../../../packages/core/src';
import {config} from './config';
import {logger} from './logger';
import {clearSession, redactId, saveSession} from './storage';

/** `expired`: the server rejected the session (401). `signed-out`: the user chose Sign out. */
export type SignedOutReason = 'expired' | 'signed-out';

/** How long Sign out waits for POST /auth/logout before leaving anyway. */
const LOGOUT_WAIT_MS = 3000;

// The session lives in memory for API calls and is mirrored to storage (platform/storage.ts).
let session: Session | null = null;
let signedOutListener: ((reason: SignedOutReason) => void) | null = null;
let signingOut = false;

export const auth = {
  get: () => session,
  /** Holds the session for API calls and persists it; null forgets it in memory and in storage. */
  set: (s: Session | null) => {
    session = s;
    // Storage calls never reject: failures are logged in storage.ts and the app carries on.
    if (s) saveSession(s);
    else clearSession();
  },
  /** Uses a session read from storage (Boot) without writing it back. */
  restore: (s: Session) => {
    session = s;
  },
  /** Best-effort server logout, then forget the session everywhere and tell the app. */
  signOut: async () => {
    if (signingOut) return;
    signingOut = true;
    const s = session;
    try {
      if (s) {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const result = await Promise.race([
          api.logout().then(
            () => 'ok',
            (err: unknown) => (err instanceof ApiError ? `http ${err.status}` : 'failed'),
          ),
          new Promise<string>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), LOGOUT_WAIT_MS);
          }),
        ]);
        if (timer) clearTimeout(timer);
        logger.info('auth', 'logout', {session: redactId(s.id), result});
      }
    } finally {
      session = null;
      await clearSession();
      signingOut = false;
    }
    signedOutListener?.('signed-out');
  },
  /** One listener (the App); returns an unsubscribe for effect cleanup. */
  onSignedOut: (cb: (reason: SignedOutReason) => void) => {
    signedOutListener = cb;
    return () => {
      if (signedOutListener === cb) signedOutListener = null;
    };
  },
};

export const api = createApi({
  baseUrl: config.apiBaseUrl,
  fetch: (...args) => fetch(...args),
  getSessionId: () => session?.id ?? null,
  // Core calls this only for requests that carried a session. A 401 from logout, or from a request
  // still in flight after Sign out, is not a session ending.
  onUnauthorized: () => {
    if (signingOut || !session) return;
    logger.warn('auth', 'session rejected (401)', {session: redactId(session.id)});
    session = null;
    clearSession();
    signedOutListener?.('expired');
  },
});
