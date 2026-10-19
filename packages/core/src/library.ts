// The room's media library, after Inox's picker at commit 321f83b:
// frontend/src/components/player/MediaLibraryPicker.tsx, frontend/src/hooks/useMediaLibrary.ts,
// frontend/src/utils/liveSync.ts (isLiveMediaUrl), frontend/src/components/player/WatchPartyPlayer.tsx
// (isHLS) and frontend/src/utils/roomActivity.ts (titleFromUrl). The Uploads and Custom URL tabs;
// live channels are out of scope on TV (D8, D16).
import type { MediaAsset } from './protocol';

/**
 * The URL the room plays for an asset: the HLS master for ABR, else the source. It is broadcast in
 * CHANGE_MEDIA and persisted on the room, so it stays exactly as the server gave it.
 */
export function playUrl(asset: MediaAsset): string {
  return asset.hls_master_url || asset.source_url;
}

export function isLiveMediaUrl(url: string): boolean {
  return url.includes('/api/v1/live/') && url.endsWith('master.m3u8');
}

/**
 * Whether a URL is an HLS stream (played through hls.js) rather than a single file such as an MP4
 * or MKV (played by the media element itself). The same test as Inox's WatchPartyPlayer.tsx.
 */
export function isHlsUrl(url: string): boolean {
  return url.includes('.m3u8') || url.includes('/hls/') || url.includes('hls_master');
}

/**
 * Whether the TV can play this URL at all: Vega's player plays single files only over https (an
 * http:// file fails at once with MediaError 4 on VVD, D16), while HLS over http works because hls.js
 * fetches it from JS.
 */
export function isTvPlayableScheme(url: string): boolean {
  return /^https:/i.test(url) || isHlsUrl(url);
}

export type CustomUrlCheck = { ok: true; url: string } | { ok: false; reason: 'empty' | 'invalid' | 'live' | 'insecure' };

/**
 * Checks a hand-entered media URL. Inox's Custom URL tab sends any non-empty trimmed text; the TV
 * also requires an http(s) link without spaces (a remote makes typos easy and there is no browser
 * validation), refuses live channel URLs (D8) and plain-http files it could not play itself.
 */
export function checkCustomUrl(input: string): CustomUrlCheck {
  const url = input.trim();
  if (!url) return { ok: false, reason: 'empty' };
  if (!/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(url)) return { ok: false, reason: 'invalid' };
  if (isLiveMediaUrl(url)) return { ok: false, reason: 'live' };
  if (!isTvPlayableScheme(url)) return { ok: false, reason: 'insecure' };
  return { ok: true, url };
}

// The stream every new Inox room starts on (ws/hub.go default). Without this it would be "movie".
const KNOWN_TITLES: Record<string, string> = {
  'https://media.w3.org/2010/05/bunny/movie.mp4': 'Big Buck Bunny',
};

// File names that say what a file is for rather than what is in it.
const GENERIC_NAME = /^(master|index|playlist|stream|movie|video|output|media)\.[a-z0-9]{2,5}$/i;

/** The display name of a well-known stream that is not a library entry, if this is one. */
export function knownTitle(url: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(KNOWN_TITLES, url) ? KNOWN_TITLES[url] : undefined;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // a malformed escape such as "50%off.mp4"
  }
}

/** "…/bunny/movie.mp4" → "movie"; "…/big-buck-bunny/master.m3u8" → "big buck bunny". */
export function titleFromUrl(url: string): string {
  const known = knownTitle(url);
  if (known) return known;
  const path = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(url)?.[1];
  if (path === undefined) return url;
  const segments = path.split('/').filter(Boolean);
  let name = decode(segments.pop() ?? '');
  if (GENERIC_NAME.test(name) && segments.length) name = decode(segments.pop() ?? '');
  return (
    name
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim() || url
  );
}

/** What the TV offers: ready, playable uploads in server order. */
export function libraryEntries(assets: MediaAsset[]): MediaAsset[] {
  return assets.filter((a) => a.status === 'ready' && a.kind !== 'live' && !!playUrl(a) && !isLiveMediaUrl(playUrl(a)));
}

/** 1:02:03 / 4:05; an unknown duration is "—". */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Highest rendition as "1080p", or null when the asset lists none (Inox sends null for none). */
export function maxResolution(asset: MediaAsset): string | null {
  const heights = (asset.renditions ?? []).map((r) => parseInt(r.resolution, 10) || 0);
  const max = heights.length ? Math.max(...heights) : 0;
  return max > 0 ? `${max}p` : null;
}
