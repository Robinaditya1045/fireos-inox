#!/usr/bin/env node
// Seeds the local Inox stack: a host (admin) and a TV user, an openly licensed clip transcoded to
// HLS, and a public "Movie Night" room playing it. Idempotent: re-running reuses what exists.
// Credentials are generated once into .devstack/seed-credentials.json (git-ignored).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, openAsBlob, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const devstack = join(root, '.devstack');
const API = process.env.INOX_API ?? 'http://127.0.0.1:18080/api/v1';
const WS = API.replace(/^http/, 'ws');
const CLIP_TITLE = 'Big Buck Bunny';
const ROOM_NAME = 'Movie Night';
const SOURCE_URL = 'https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4.zip';

const credPath = join(devstack, 'seed-credentials.json');
const creds = existsSync(credPath)
  ? JSON.parse(readFileSync(credPath, 'utf8'))
  : {
      host: { username: 'host', email: 'admin@fireos-inox.test', password: randomBytes(9).toString('base64url') },
      tv: { username: 'couch', email: 'tv@fireos-inox.test', password: randomBytes(9).toString('base64url') },
    };
writeFileSync(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });

async function api(method, path, { session, body, form } = {}) {
  const headers = {};
  if (session) headers.Authorization = `Bearer ${session}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: form ?? (body && JSON.stringify(body)) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status} ${text}`), { status: res.status });
  return data;
}

// Login first so a re-run never trips the 5/min auth rate limit with redundant signups.
async function account({ username, email, password }) {
  try {
    return await api('POST', '/auth/login', { body: { email, password } });
  } catch (err) {
    if (err.status !== 401) throw err;
    return api('POST', '/auth/signup', { body: { username, email, password } });
  }
}

async function ensureClip(adminSession) {
  const existing = (await api('GET', '/media?limit=100')).find((m) => m.title === CLIP_TITLE);
  if (existing?.status === 'ready') return existing;

  const src = join(devstack, 'media-src', 'extracted', 'bbb_sunflower_1080p_30fps_normal.mp4');
  const clip = join(devstack, 'media-src', 'clip-stereo.mp4');
  if (!existsSync(src)) throw new Error(`missing ${src}; download ${SOURCE_URL} and unzip into media-src/extracted`);
  if (!existsSync(clip)) {
    // Keep the source's stereo track as AAC. Its other track is AC-3 5.1(side); Inox does not
    // downmix, and 5.1(side) AAC (channel config 0 / PCE) fails to decode on Vega (MEDIA_ERR_DECODE).
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '0', '-t', '150', '-i', src,
      '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-b:a', '160k', clip]);
  }

  let asset = existing;
  if (!asset) {
    const form = new FormData();
    form.set('title', CLIP_TITLE);
    form.set('description', 'Big Buck Bunny © Blender Foundation, CC-BY 3.0 — first 150 s, stereo');
    form.set('file', await openAsBlob(clip, { type: 'video/mp4' }), 'clip.mp4');
    asset = await api('POST', '/admin/media/upload', { session: adminSession, form });
    console.log(`uploaded ${asset.id}; waiting for transcode`);
  }
  for (let i = 0; i < 180; i++) {
    asset = await api('GET', `/media/${asset.id}`);
    if (asset.status === 'ready') return asset;
    if (asset.status === 'failed') throw new Error(`transcode failed for ${asset.id}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('transcode did not finish within 15 minutes');
}

async function ensureRoom(adminSession) {
  const rooms = await api('GET', '/rooms', { session: adminSession });
  const found = rooms.find((r) => r.name === ROOM_NAME);
  if (found) return found;
  return (await api('POST', '/rooms', { session: adminSession, body: { name: ROOM_NAME, is_private: false } })).room;
}

// Room media is only settable over the room socket (CHANGE_MEDIA), which also persists it.
function setRoomMedia(roomId, adminSession, mediaUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/rooms/${roomId}/ws?session_id=${adminSession}`);
    const timer = setTimeout(() => { ws.close(); reject(new Error('room socket timed out')); }, 15000);
    ws.onerror = () => { clearTimeout(timer); reject(new Error('room socket error')); };
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.type === 'SYNC_PLAYBACK' && msg.payload?.media_url === mediaUrl) {
        clearTimeout(timer); ws.close(); resolve('already set');
      } else if (msg.type === 'SYNC_PLAYBACK') {
        ws.send(JSON.stringify({ type: 'CHANGE_MEDIA', payload: { media_url: mediaUrl, media_time_seconds: 0 }, timestamp: Date.now() }));
      } else if (msg.type === 'CHANGE_MEDIA') {
        clearTimeout(timer); setTimeout(() => { ws.close(); resolve('changed'); }, 500);
      }
    };
  });
}

const host = await account(creds.host);
const tv = await account(creds.tv);
const clip = await ensureClip(host.id);
const room = await ensureRoom(host.id);
await api('POST', `/rooms/${room.id}/join`, { session: tv.id });
const media = await setRoomMedia(room.id, host.id, clip.hls_master_url);

const out = {
  room_id: room.id,
  room_name: room.name,
  media_url: clip.hls_master_url,
  renditions: (clip.renditions ?? []).map((r) => r.resolution),
  users: { host: creds.host.email, tv: creds.tv.email },
  credentials_file: credPath,
};
writeFileSync(join(devstack, 'seed-output.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, room_media: media }, null, 2));
