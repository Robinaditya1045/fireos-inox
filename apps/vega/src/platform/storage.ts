// Persistent app state: the signed-in session (M2, risk R12) and the last room entered (lobby focus).
//
// Vega's ported AsyncStorage package. The legacy AsyncStorage that react-native-kepler still exports
// is not enough: on VVD a saved session survived a JS reload but not an app restart (2026-10-20).
import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';
import type {Session} from '../../../../packages/core/src';
import {logger} from './logger';

const KEY = {session: 'fireosinox.session.v1', lastRoomId: 'fireosinox.lastRoomId.v1'} as const;

/** Session IDs are logged by their first 6 characters only (CLAUDE.md rule 7). */
export const redactId = (id: string) => `${id.slice(0, 6)}…`;

function describe(err: unknown, secret?: string): string {
  const text = err instanceof Error ? err.message : String(err);
  return secret ? text.split(secret).join(redactId(secret)) : text;
}

/** Copies the Session fields out of an untrusted value; null when a field the app relies on is missing. */
function toSession(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const text = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : null);
  const id = text('id');
  const userId = text('user_id');
  const username = text('username');
  const expiresAt = text('expires_at');
  if (!id || !userId || !username || !expiresAt) return null;
  return {
    id,
    user_id: userId,
    username,
    email: text('email') ?? '',
    role: text('role') ?? '',
    avatar_url: text('avatar_url'),
    created_at: text('created_at') ?? '',
    expires_at: expiresAt,
  };
}

/**
 * True when `expires_at` is in the past. Go writes RFC 3339 with up to 9 fractional digits, while
 * Date.parse is only specified for 3, so the fraction is cut first. An unparseable date counts as
 * not expired: the server decides (GET /users/me).
 */
export function isExpired(s: Session, nowMs = Date.now()): boolean {
  const t = Date.parse(s.expires_at.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(t) && t <= nowMs;
}

export async function loadSession(): Promise<Session | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(KEY.session);
  } catch (err) {
    logger.warn('storage', 'session read failed', {err: describe(err)});
    return null;
  }
  if (!raw) {
    logger.info('storage', 'no stored session');
    return null;
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // not JSON: treated as corrupt below
  }
  const session = toSession(parsed);
  if (!session) {
    logger.warn('storage', 'stored session is corrupt, clearing it');
    await clearSession();
    return null;
  }
  logger.info('storage', 'session loaded', {session: redactId(session.id), user: session.username, expires_at: session.expires_at});
  return session;
}

/** Stores the Session fields only (never a password or anything else passed along). */
export async function saveSession(s: Session): Promise<void> {
  const stored = toSession(s);
  if (!stored) {
    logger.warn('storage', 'refusing to store an incomplete session');
    return;
  }
  try {
    await AsyncStorage.setItem(KEY.session, JSON.stringify(stored));
    logger.info('storage', 'session saved', {session: redactId(s.id)});
  } catch (err) {
    logger.warn('storage', 'session write failed', {err: describe(err, s.id)});
  }
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY.session);
    logger.info('storage', 'session cleared');
  } catch (err) {
    logger.warn('storage', 'session clear failed', {err: describe(err)});
  }
}

export async function loadLastRoomId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(KEY.lastRoomId);
    // Room IDs are UUIDs; anything else is ignored rather than trusted.
    return id && /^[\w-]{1,64}$/.test(id) ? id : null;
  } catch (err) {
    logger.warn('storage', 'last room read failed', {err: describe(err)});
    return null;
  }
}

export async function saveLastRoomId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY.lastRoomId, id);
  } catch (err) {
    logger.warn('storage', 'last room write failed', {err: describe(err)});
  }
}
