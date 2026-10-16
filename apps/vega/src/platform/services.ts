import {createApi, type Session} from '../../../../packages/core/src';
import {config} from './config';

// Session is held in memory for now; persistence (AsyncStorage) is milestone M2.
let session: Session | null = null;
let onSignedOut: (() => void) | null = null;

export const auth = {
  get: () => session,
  set: (s: Session | null) => {
    session = s;
  },
  onSignedOut: (cb: () => void) => {
    onSignedOut = cb;
  },
};

export const api = createApi({
  baseUrl: config.apiBaseUrl,
  fetch: (...args) => fetch(...args),
  getSessionId: () => session?.id ?? null,
  onUnauthorized: () => {
    session = null;
    onSignedOut?.();
  },
});
