import { describe, expect, it } from 'vitest';
import {
  applyRemote,
  clockOffsetFromSync,
  correction,
  declineLeadershipPayload,
  driftAction,
  expectedPosition,
  fromSync,
  isOwnEcho,
  nextLead,
  shouldDeclineLeadership,
  type PlaybackState,
} from '../src';
import { msg } from './helpers';

const NOW = 1_760_000_000_000;
const playing: PlaybackState = { mediaUrl: 'u', kind: 'vod', isPlaying: true, anchorTime: 10, anchorLocalMs: NOW };
const paused: PlaybackState = { ...playing, isPlaying: false };

describe('fromSync', () => {
  it('paused: position is media_time_seconds', () => {
    const s = fromSync(msg('SYNC_PLAYBACK', { media_url: 'u', is_playing: false, media_time_seconds: 42, last_updated: NOW - 5000 }), NOW);
    expect(s).toMatchObject({ isPlaying: false, anchorTime: 42, anchorLocalMs: NOW, kind: 'vod', mediaUrl: 'u' });
  });

  it('playing: adds the time elapsed since last_updated', () => {
    const s = fromSync(msg('SYNC_PLAYBACK', { is_playing: true, media_time_seconds: 42, last_updated: NOW - 2500 }), NOW);
    expect(s?.anchorTime).toBeCloseTo(44.5);
  });

  it('playing: applies the device−server clock offset to last_updated', () => {
    // Device clock 900 ms behind the server: last_updated (server clock) is 900 ms "in the future".
    const s = fromSync(msg('SYNC_PLAYBACK', { is_playing: true, media_time_seconds: 42, last_updated: NOW - 1000 + 900 }), NOW, -900);
    expect(s?.anchorTime).toBeCloseTo(43);
  });

  it('clamps negative elapsed time to 0', () => {
    const s = fromSync(msg('SYNC_PLAYBACK', { is_playing: true, media_time_seconds: 42, last_updated: NOW + 3000 }), NOW);
    expect(s?.anchorTime).toBe(42);
  });

  it('keeps kind live and rejects a malformed payload', () => {
    expect(fromSync(msg('SYNC_PLAYBACK', { media_time_seconds: 0, kind: 'live' }), NOW)?.kind).toBe('live');
    expect(fromSync(msg('SYNC_PLAYBACK', 'oops'), NOW)).toBeNull();
  });
});

describe('clockOffsetFromSync', () => {
  it('is device minus server clock, from SYNC_PLAYBACK only', () => {
    expect(clockOffsetFromSync(msg('SYNC_PLAYBACK', {}, { timestamp: NOW + 900 }), NOW)).toBe(-900);
    expect(clockOffsetFromSync(msg('PLAY', {}, { timestamp: NOW + 900 }), NOW)).toBe(0);
    expect(clockOffsetFromSync(msg('SYNC_PLAYBACK', {}, { timestamp: 0 }), NOW)).toBe(0);
  });
});

describe('applyRemote', () => {
  it('PLAY adds sender latency of 0.3 s', () => {
    const s = applyRemote(paused, msg('PLAY', { media_time_seconds: 20 }, { timestamp: NOW - 300 }), NOW);
    expect(s.isPlaying).toBe(true);
    expect(s.anchorTime).toBeCloseTo(20.3);
  });

  it('PLAY ignores a latency of 7 s, like the web client (5 s rule)', () => {
    expect(applyRemote(paused, msg('PLAY', { media_time_seconds: 20 }, { timestamp: NOW - 7000 }), NOW).anchorTime).toBe(20);
  });

  it('PAUSE pins the position', () => {
    const s = applyRemote(playing, msg('PAUSE', { media_time_seconds: 33 }, { timestamp: NOW - 300 }), NOW);
    expect(s).toMatchObject({ isPlaying: false, anchorTime: 33, anchorLocalMs: NOW });
  });

  it('SEEK keeps the play state', () => {
    expect(applyRemote(playing, msg('SEEK', { media_time_seconds: 60 }), NOW)).toMatchObject({ isPlaying: true, anchorTime: 60 });
    expect(applyRemote(paused, msg('SEEK', { media_time_seconds: 60 }), NOW)).toMatchObject({ isPlaying: false, anchorTime: 60 });
  });

  it('CHANGE_MEDIA resets to 0, paused, and sets the kind', () => {
    const s = applyRemote(playing, msg('CHANGE_MEDIA', { media_url: 'live.m3u8', media_time_seconds: 0, kind: 'live' }), NOW);
    expect(s).toEqual({ mediaUrl: 'live.m3u8', kind: 'live', isPlaying: false, anchorTime: 0, anchorLocalMs: NOW });
  });

  it('leaves the state alone for a malformed payload or another event type', () => {
    expect(applyRemote(playing, msg('PLAY', 'oops'), NOW)).toBe(playing);
    expect(applyRemote(playing, msg('CHANGE_MEDIA', { media_time_seconds: 0 }), NOW)).toBe(playing);
    expect(applyRemote(playing, msg('CHAT_MESSAGE', { message: 'hi' }), NOW)).toBe(playing);
  });
});

describe('expectedPosition', () => {
  it('extrapolates only while playing', () => {
    expect(expectedPosition(playing, NOW + 1500)).toBeCloseTo(11.5);
    expect(expectedPosition(paused, NOW + 1500)).toBe(10);
  });
});

describe('echo suppression', () => {
  it('matches own playback events only', () => {
    for (const t of ['PLAY', 'PAUSE', 'SEEK', 'CHANGE_MEDIA']) {
      expect(isOwnEcho(msg(t, {}, { sender_id: 'me' }), 'me')).toBe(true);
      expect(isOwnEcho(msg(t, {}, { sender_id: 'host' }), 'me')).toBe(false);
    }
    expect(isOwnEcho(msg('CHAT_MESSAGE', { message: 'x' }, { sender_id: 'me' }), 'me')).toBe(false);
  });
});

describe('drift policy (architecture §3.4.1)', () => {
  it('driftAction: dead band, rate ladder, then seek', () => {
    expect(driftAction(0.1)).toEqual({ rate: 1, seek: false });
    expect(driftAction(0.3)).toEqual({ rate: 1.05, seek: false });
    expect(driftAction(-0.3)).toEqual({ rate: 0.95, seek: false });
    expect(driftAction(1.0)).toEqual({ rate: 1.15, seek: false });
    expect(driftAction(-1.4)).toEqual({ rate: 0.85, seek: false });
    expect(driftAction(1.6)).toEqual({ rate: 1, seek: true });
    expect(driftAction(-5)).toEqual({ rate: 1, seek: true });
  });

  it('correction (seek-only fallback): 0.5 s threshold, nothing while settling', () => {
    expect(correction(10.4, 10, false).seek).toBe(false);
    expect(correction(10.6, 10, false)).toEqual({ seek: true, drift: expect.closeTo(0.6) });
    expect(correction(15, 10, true).seek).toBe(false);
  });

  it('nextLead learns from residual drift within [0, 2] s', () => {
    expect(nextLead(1, 0.5)).toBeCloseTo(1.4);
    expect(nextLead(1.9, 1)).toBe(2);
    expect(nextLead(0.1, -1)).toBe(0);
  });
});

describe('live leadership', () => {
  it('declines only when named as leader', () => {
    expect(shouldDeclineLeadership(msg('LIVE_LEADER', { leader_id: 'me', leader_name: 'couch' }), 'me')).toBe(true);
    expect(shouldDeclineLeadership(msg('LIVE_LEADER', { leader_id: 'host', leader_name: 'host' }), 'me')).toBe(false);
    expect(shouldDeclineLeadership(msg('LIVE_LEADER', 'oops'), 'me')).toBe(false);
    expect(shouldDeclineLeadership(msg('LIVE_STATUS', { leader_id: 'me' }), 'me')).toBe(false);
  });

  it('payload matches inox-contract.md §4', () => {
    expect(declineLeadershipPayload()).toEqual({ position: { sn: 0, cc: 0, offset: 0 }, age_ms: 0, unable: true });
  });
});
