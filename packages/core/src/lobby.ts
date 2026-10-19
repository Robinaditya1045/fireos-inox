// The TV lobby, after Inox's web lobby at commit 321f83b: frontend/src/pages/DashboardPage.tsx and
// frontend/src/utils/roomActivity.ts (describeMedia, viewersOf).
import { knownTitle, titleFromUrl } from './library';
import type { MediaAsset, Room } from './protocol';

export interface LobbyCard {
  room: Room;
  title: string | null;
  mediaUrl: string | null;
  status: 'playing' | 'paused' | 'idle';
  viewers: number;
}

const stripQuery = (url: string) => url.split(/[?#]/)[0] ?? url;

/**
 * Names what a room is playing, as describeMedia does: a room's URL is exactly what the library
 * picker sent (hls_master_url || source_url), so a library entry is found by URL (query ignored);
 * anything pasted by hand is named after its file. Null when the room has no media.
 */
export function mediaTitle(url: string | null | undefined, media: MediaAsset[]): string | null {
  if (!url) return null;
  const target = stripQuery(url);
  const known = knownTitle(target);
  if (known) return known;
  const asset = media.find(
    (a) => (a.hls_master_url && stripQuery(a.hls_master_url) === target) || (a.source_url && stripQuery(a.source_url) === target),
  );
  return asset ? asset.title : titleFromUrl(url);
}

function card(room: Room, media: MediaAsset[]): LobbyCard {
  const a = room.activity;
  const mediaUrl = a?.media_url || room.current_media_url || null;
  return {
    room,
    title: mediaTitle(mediaUrl, media),
    mediaUrl,
    status: a ? (a.is_playing ? 'playing' : 'paused') : 'idle',
    viewers: a?.viewers ?? 0,
  };
}

/**
 * Rows for the lobby. `activity` is present only while someone is connected (domain/room.go), so
 * "Now Streaming" is every occupied room, paused or not. Unlike the web lobby, which sorts by
 * viewers, server order is kept within each row so D-pad focus doesn't jump between polls.
 */
export function lobbyRows(rooms: Room[], media: MediaAsset[]): { nowStreaming: LobbyCard[]; allRooms: LobbyCard[] } {
  const nowStreaming: LobbyCard[] = [];
  const allRooms: LobbyCard[] = [];
  for (const room of rooms) (room.activity ? nowStreaming : allRooms).push(card(room, media));
  return { nowStreaming, allRooms };
}
