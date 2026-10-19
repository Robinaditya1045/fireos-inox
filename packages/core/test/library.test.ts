import { describe, expect, it } from 'vitest';
import {
  checkCustomUrl,
  formatDuration,
  isHlsUrl,
  isLiveMediaUrl,
  isTvPlayableScheme,
  libraryEntries,
  maxResolution,
  playUrl,
  titleFromUrl,
  type MediaAsset,
} from '../src';

const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'a',
  kind: 'vod',
  title: 'Big Buck Bunny',
  description: '',
  source_url: 'http://h/media/stream/raw/a.mp4',
  status: 'ready',
  duration_seconds: 596,
  thumbnail_url: '',
  hls_master_url: 'http://h/media/stream/hls/a/master.m3u8',
  ...over,
});

describe('library', () => {
  it('plays the HLS master, falling back to the source', () => {
    expect(playUrl(asset())).toBe('http://h/media/stream/hls/a/master.m3u8');
    expect(playUrl(asset({ hls_master_url: '' }))).toBe('http://h/media/stream/raw/a.mp4');
  });

  it('offers only ready, non-live uploads, in server order', () => {
    const list = [
      asset({ id: '1' }),
      asset({ id: '2', status: 'processing' }),
      asset({ id: '3', kind: 'live' }),
      asset({ id: '4', kind: undefined as unknown as 'vod', hls_master_url: 'http://h/api/v1/live/bbc/master.m3u8' }),
      asset({ id: '5', status: 'failed' }),
      asset({ id: '6', hls_master_url: '', source_url: '' }),
      asset({ id: '7' }),
    ];
    expect(libraryEntries(list).map((a) => a.id)).toEqual(['1', '7']);
  });

  it('recognises live URLs as Inox does (liveSync.ts isLiveMediaUrl)', () => {
    expect(isLiveMediaUrl('http://h/api/v1/live/bbc/master.m3u8')).toBe(true);
    expect(isLiveMediaUrl('http://h/media/stream/hls/a/master.m3u8')).toBe(false);
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('reports the highest rendition; none for null or empty', () => {
    const r = (resolution: string) => ({ id: resolution, resolution, bitrate_kbps: 1, playlist_url: '' });
    expect(maxResolution(asset({ renditions: [r('480p'), r('1080p'), r('720p')] }))).toBe('1080p');
    expect(maxResolution(asset({ renditions: null }))).toBeNull();
    expect(maxResolution(asset({ renditions: [] }))).toBeNull();
  });

  it('tells HLS streams from single files as Inox does (WatchPartyPlayer.tsx isHLS)', () => {
    expect(isHlsUrl('http://h/media/stream/hls/a/master.m3u8')).toBe(true);
    expect(isHlsUrl('https://cdn.example/x/index.m3u8?token=1')).toBe(true);
    expect(isHlsUrl('https://cdn.example/hls/abc')).toBe(true);
    expect(isHlsUrl('https://media.w3.org/2010/05/bunny/movie.mp4')).toBe(false);
    expect(isHlsUrl('https://cdn.example/films/Sintel.mkv')).toBe(false);
  });

  it('plays files over https only, HLS over either (D16)', () => {
    expect(isTvPlayableScheme('https://cdn.example/a.mkv')).toBe(true);
    expect(isTvPlayableScheme('HTTPS://cdn.example/a.mp4')).toBe(true);
    expect(isTvPlayableScheme('http://cdn.example/a.mp4')).toBe(false);
    expect(isTvPlayableScheme('http://localhost:18080/media/stream/hls/a/master.m3u8')).toBe(true);
  });

  it('accepts trimmed http(s) links and explains what it refuses', () => {
    expect(checkCustomUrl('  https://cdn.example/a.mkv \n')).toEqual({ ok: true, url: 'https://cdn.example/a.mkv' });
    expect(checkCustomUrl('https://localhost:18101/fixture.mp4?x=1#t')).toEqual({ ok: true, url: 'https://localhost:18101/fixture.mp4?x=1#t' });
    expect(checkCustomUrl('http://cdn.example/a/index.m3u8')).toEqual({ ok: true, url: 'http://cdn.example/a/index.m3u8' });
    expect(checkCustomUrl('http://cdn.example/a.mp4')).toEqual({ ok: false, reason: 'insecure' });
    expect(checkCustomUrl('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(checkCustomUrl('cdn.example/a.mp4')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkCustomUrl('ftp://cdn.example/a.mp4')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkCustomUrl('https://')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkCustomUrl('https://cdn.example/my film.mp4')).toEqual({ ok: false, reason: 'invalid' });
    expect(checkCustomUrl('http://h/api/v1/live/bbc/master.m3u8')).toEqual({ ok: false, reason: 'live' });
  });

  it('names a URL after its file, like Inox (roomActivity.ts titleFromUrl)', () => {
    expect(titleFromUrl('https://media.w3.org/2010/05/bunny/movie.mp4')).toBe('Big Buck Bunny');
    expect(titleFromUrl('https://cdn.example/films/Sintel_2010-1080p.mkv?sig=abc')).toBe('Sintel 2010 1080p');
    expect(titleFromUrl('https://cdn.example/big-buck-bunny/master.m3u8')).toBe('big buck bunny');
    expect(titleFromUrl('https://cdn.example/a/My%20Film.mp4')).toBe('My Film');
    expect(titleFromUrl('https://cdn.example/50%off.mp4')).toBe('50%off');
    expect(titleFromUrl('https://cdn.example/')).toBe('https://cdn.example/');
    expect(titleFromUrl('not a url')).toBe('not a url');
  });
});
