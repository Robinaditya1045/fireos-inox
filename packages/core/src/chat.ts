// Couch Reactions (decision D17): reactions and quick replies are ordinary CHAT_MESSAGE frames, so
// the rules here are Inox's chat rules (backend/internal/room/chat_service.go SaveMessage, commit
// 321f83b) plus what a remote needs on top (a fixed set to pick from, a send throttle).

export const REACTIONS = ['😂', '😮', '🔥', '👏', '❤️', '😢'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const QUICK_REPLIES = ['Pause please!', 'Back in a minute', 'LOL', 'Wait, what?', 'Ready when you are', 'This is great'] as const;

/** chat_service.go SaveMessage: 1..2000 after strings.TrimSpace, measured by Go's len(), i.e. UTF-8 bytes. */
export const CHAT_MAX_LENGTH = 2000;
/** Client-side throttle: a held or bouncing remote key must not flood the room. */
export const CHAT_MIN_INTERVAL_MS = 1000;

// Go's unicode.IsSpace set, which strings.TrimSpace strips. JS trim() differs at the edges: it
// also strips U+FEFF and keeps U+0085.
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const GO_TRIM = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'g');

/** strings.TrimSpace. */
export function trimChat(text: string): string {
  return text.replace(GO_TRIM, '');
}

/** UTF-8 length, as Go's len() measures a string. A lone surrogate counts 3 (Go decodes it to U+FFFD). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export type ChatCheck = { ok: true; text: string } | { ok: false; reason: 'empty' | 'too-long' };

/** Whether Inox would save this message, and the trimmed text to send. */
export function checkChatText(text: string): ChatCheck {
  const trimmed = trimChat(text);
  if (!trimmed) return { ok: false, reason: 'empty' };
  if (utf8Length(trimmed) > CHAT_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  return { ok: true, text: trimmed };
}

// '❤' and '❤️' differ only by the emoji-presentation selector, and keyboards send either.
const stripVariation = (s: string) => s.replace(/\uFE0F/g, '');
const REACTION_KEYS = new Set<string>(REACTIONS.map(stripVariation));

/** A message that is exactly one reaction emoji floats over the video, whoever sent it (D17). */
export function isReaction(message: string): boolean {
  return REACTION_KEYS.has(stripVariation(trimChat(message)));
}

/**
 * A stable colour slot in 0..n-1 for an author, with the same hash as Inox's avatar hues
 * (frontend/src/utils/avatarHue.ts hueFor).
 */
export function colorIndex(userId: string, n: number): number {
  if (!(n >= 1)) return 0;
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return Math.abs(hash) % Math.floor(n);
}
