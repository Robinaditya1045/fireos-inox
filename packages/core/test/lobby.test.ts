import { describe, expect, it } from 'vitest';
import { lobbyRows, mediaTitle, type MediaAsset, type Room } from '../src';

const asset = (over: Partial<MediaAsset> = {}): MediaAsset => ({
  id: 'a',
  kind: 'vod',
  title: 'Sintel',
  description: '',
  source_url: 'http://h/media/stream/raw/a.mp4',
  status: 'ready',
  duration_seconds: 888,
  thumbnail_url: '',
  hls_master_url: 'http://h/media/stream/hls/a/master.m3u8',
  ...over,
});

const room = (id: string, over: Partial<Room> = {}): Room => ({
  id,
  name: `Room ${id}`,
  owner_id: 'o',
  is_private: false,
  current_media_url: '',
  created_at: '',
  updated_at: '',
  ...over,
});

describe('mediaTitle (roomActivity.ts describeMedia)', () => {
  const lib = [asset(), asset({ id: 'b', title: 'Raw only', hls_master_url: '', source_url: 'https://cdn/x/raw.mp4' })];

  it('is null without a URL', () => {
    expect(mediaTitle(null, lib)).toBeNull();
    expect(mediaTitle(undefined, lib)).toBeNull();
    expect(mediaTitle('', lib)).toBeNull();
  });

  it('names a library entry by its HLS master or source URL, ignoring the query', () => {
    expect(mediaTitle('http://h/media/stream/hls/a/master.m3u8', lib)).toBe('Sintel');
    expect(mediaTitle('http://h/media/stream/raw/a.mp4?t=1', lib)).toBe('Sintel');
    expect(mediaTitle('https://cdn/x/raw.mp4#frag', lib)).toBe('Raw only');
  });

  it('knows the default room stream, even with a query', () => {
    expect(mediaTitle('https://media.w3.org/2010/05/bunny/movie.mp4?x=1', [])).toBe('Big Buck Bunny');
  });

  it('falls back to the file name for a pasted URL', () => {
    expect(mediaTitle('https://cdn.example/big-buck-bunny/master.m3u8', lib)).toBe('big buck bunny');
    expect(mediaTitle('https://cdn.example/films/Tears_of_Steel.mkv?sig=abc', lib)).toBe('Tears of Steel');
  });
});

describe('lobbyRows', () => {
  const lib = [asset()];
  const rooms = [
    room('idle-1', { current_media_url: 'https://media.w3.org/2010/05/bunny/movie.mp4' }),
    room('paused', { current_media_url: 'old', activity: { viewers: 1, is_playing: false, media_url: 'http://h/media/stream/hls/a/master.m3u8', kind: 'vod' } }),
    room('idle-2'),
    room('playing', { current_media_url: 'https://cdn/z/Movie_Night.mp4', activity: { viewers: 3, is_playing: true } }),
  ];

  it('puts occupied rooms in Now Streaming and the rest in All Rooms, in server order', () => {
    const { nowStreaming, allRooms } = lobbyRows(rooms, lib);
    expect(nowStreaming.map((c) => c.room.id)).toEqual(['paused', 'playing']);
    expect(allRooms.map((c) => c.room.id)).toEqual(['idle-1', 'idle-2']);
  });

  it('builds cards: activity media first, status and viewers from activity', () => {
    const { nowStreaming, allRooms } = lobbyRows(rooms, lib);
    expect(nowStreaming[0]).toMatchObject({ title: 'Sintel', mediaUrl: 'http://h/media/stream/hls/a/master.m3u8', status: 'paused', viewers: 1 });
    // activity without media_url falls back to current_media_url
    expect(nowStreaming[1]).toMatchObject({ title: 'Movie Night', mediaUrl: 'https://cdn/z/Movie_Night.mp4', status: 'playing', viewers: 3 });
    expect(allRooms[0]).toMatchObject({ title: 'Big Buck Bunny', status: 'idle', viewers: 0 });
    expect(allRooms[1]).toMatchObject({ title: null, mediaUrl: null, status: 'idle', viewers: 0 });
  });

  it('handles no rooms', () => {
    expect(lobbyRows([], [])).toEqual({ nowStreaming: [], allRooms: [] });
  });
});
