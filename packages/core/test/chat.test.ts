import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, checkChatText, colorIndex, isReaction, QUICK_REPLIES, REACTIONS, trimChat, utf8Length } from '../src';

describe('isReaction', () => {
  it('is true for exactly one reaction emoji, trimmed', () => {
    for (const r of REACTIONS) expect(isReaction(r)).toBe(true);
    expect(isReaction('  🔥\n')).toBe(true);
  });

  it('ignores the U+FE0F variation selector on either side', () => {
    expect(isReaction('❤')).toBe(true); // ❤ as many keyboards send it
    expect(isReaction('❤️')).toBe(true);
    expect(isReaction('😂️')).toBe(true);
  });

  it('is false for text, two emoji, other emoji and quick replies', () => {
    for (const t of ['', ' ', 'lol', '😂😂', '😂 lol', '👍', '👏🏽', ...QUICK_REPLIES]) expect(isReaction(t)).toBe(false);
  });
});

describe('trimChat (Go strings.TrimSpace)', () => {
  it('strips Go whitespace, including NEL and NBSP, but not U+FEFF', () => {
    expect(trimChat(' \t\n \u0085hi　\r ')).toBe('hi');
    expect(trimChat('﻿')).toBe('﻿');
    expect(trimChat('a b')).toBe('a b');
  });
});

describe('utf8Length (Go len)', () => {
  it('counts UTF-8 bytes', () => {
    expect(utf8Length('')).toBe(0);
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😂')).toBe(4);
    expect(utf8Length('❤️')).toBe(6);
    expect(utf8Length('\uD800')).toBe(3); // lone surrogate → U+FFFD
  });
});

describe('checkChatText', () => {
  it('trims and returns the text to send', () => {
    expect(checkChatText('  LOL  ')).toEqual({ ok: true, text: 'LOL' });
  });

  it('refuses blank text', () => {
    expect(checkChatText('')).toEqual({ ok: false, reason: 'empty' });
    expect(checkChatText(' \n\t ')).toEqual({ ok: false, reason: 'empty' });
  });

  it(`allows ${CHAT_MAX_LENGTH} bytes, measured after trimming, and refuses more`, () => {
    expect(checkChatText(`  ${'a'.repeat(CHAT_MAX_LENGTH)}  `)).toMatchObject({ ok: true });
    expect(checkChatText('a'.repeat(CHAT_MAX_LENGTH + 1))).toEqual({ ok: false, reason: 'too-long' });
    // 500 emoji are 500 code points but 2000 bytes; 501 are over, as Go's len() sees it.
    expect(checkChatText('😂'.repeat(500))).toMatchObject({ ok: true });
    expect(checkChatText('😂'.repeat(501))).toEqual({ ok: false, reason: 'too-long' });
    expect(checkChatText('é'.repeat(1001))).toEqual({ ok: false, reason: 'too-long' });
  });
});

describe('colorIndex', () => {
  it('is stable and in range', () => {
    const ids = ['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c2', 'x', '', 'a much longer id that overflows the 32-bit hash'];
    for (const id of ids) {
      const i = colorIndex(id, 6);
      expect(i).toBe(colorIndex(id, 6));
      expect(Number.isInteger(i) && i >= 0 && i < 6).toBe(true);
    }
  });

  it("uses Inox's avatar hash (avatarHue.ts hueFor)", () => {
    // hash('ab') = 97 * 31 + 98 = 3105; 3105 % 8 = 1
    expect(colorIndex('ab', 8)).toBe(1);
  });

  it('spreads users over the palette', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => colorIndex(`user-${i}`, 6)));
    expect(seen.size).toBeGreaterThan(3);
  });

  it('returns 0 for an empty palette', () => {
    expect(colorIndex('x', 0)).toBe(0);
    expect(colorIndex('x', NaN)).toBe(0);
  });
});
