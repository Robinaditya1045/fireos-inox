// Mock Inox backend: the REST + WebSocket subset the TV app uses (docs/dev/inox-contract.md §2, §4),
// plus a control API for failure injection (docs/dev/testing.md, L2). It is also the backend a
// reviewer can run without the Go stack.
//
// Every faked behaviour names the Inox file it mirrors (paths under backend/internal/, commit 321f83b).
// When Inox and this file disagree, Inox is right: fix this file.
import { randomUUID } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = resolve(here, '..', 'fixtures');
export const DEFAULT_PORT = 18090;
export const ROOM_ID = '00000000-0000-4000-8000-000000000001';
const MEDIA_ID = '00000000-0000-4000-8000-0000000000a1';
const FIXTURE_MASTER = 'hls/fixture/master.m3u8';

// api/middleware/ratelimit.go: 5 requests/min per IP on the auth endpoints.
const AUTH_LIMIT = 5;
const AUTH_WINDOW_MS = 60_000;
// ws/client.go: ping every 54 s, drop if no pong within 60 s.
const PING_MS = 54_000;
const PONG_WAIT_MS = 60_000;

const ALL_PERMISSIONS = {
  can_control_playback: true,
  can_stream_audio: true,
  can_stream_video: true,
  can_share_screen: true,
  can_send_messages: true,
  can_invite_users: true,
  can_kick_users: true,
  can_manage_roles: true,
};

// domain/room.go DefaultPermissionsForRole.
export function permissionsForRole(role) {
  switch (role) {
    case 'owner':
      return { ...ALL_PERMISSIONS };
    case 'moderator':
      return { ...ALL_PERMISSIONS, can_manage_roles: false };
    case 'member':
      return { ...ALL_PERMISSIONS, can_control_playback: false, can_share_screen: false, can_invite_users: false, can_kick_users: false, can_manage_roles: false };
    default:
      return { ...Object.fromEntries(Object.keys(ALL_PERMISSIONS).map((k) => [k, false])), can_send_messages: true };
  }
}

const CONTENT_TYPES = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4' };

/**
 * Starts the mock. Options: port (0 = any), host, control (enable /__control), rateLimit,
 * fixturesDir, publicBaseUrl (the address clients use for media URLs), password, quiet.
 */
export async function startMock(opts = {}) {
  const host = opts.host ?? '127.0.0.1';
  const password = opts.password ?? process.env.MOCK_PASSWORD ?? 'mock-only-password';
  const fixturesDir = resolve(opts.fixturesDir ?? DEFAULT_FIXTURES_DIR);
  const rateLimit = opts.rateLimit ?? true;
  const log = opts.quiet ? () => undefined : (...a) => console.log('[mock-inox]', ...a);

  const now = () => Date.now();
  const iso = (ms = now()) => new Date(ms).toISOString();
  const startedAt = iso();

  const hostUser = { id: '00000000-0000-4000-8000-0000000000b1', username: 'host', email: 'admin@fireos-inox.test' };
  const tvUser = { id: '00000000-0000-4000-8000-0000000000c2', username: 'couch', email: 'tv@fireos-inox.test' };
  const users = [hostUser, tvUser];
  /** session id → user id. api/middleware/auth.go resolves Bearer, ?session_id= and the cookie. */
  const sessions = new Map();
  const authHits = new Map();

  const roomMembers = new Map([[hostUser.id, { role: 'owner', joined_at: startedAt }]]);
  let publicBase = '';
  const mediaUrl = () => `${publicBase}/media/stream/${FIXTURE_MASTER}`;
  const room = { id: ROOM_ID, name: 'Movie Night', owner_id: hostUser.id, is_private: false, created_at: startedAt, updated_at: startedAt };
  /** ws/hub.go PlaybackState for the one room. */
  const playback = { media_url: '', kind: 'vod', is_playing: false, media_time_seconds: 0, last_updated: now() };
  const chat = [];
  /** Inbound client events, newest last, for assertions (GET /__control/events). */
  const events = [];
  const declines = [];
  /** @type {Set<{ws: import('ws').WebSocket, userId: string, username: string}>} */
  const clients = new Set();

  const faults = { latencyMs: 0, slowHlsMs: 0, hls404: false };
  const resetFaults = () => Object.assign(faults, { latencyMs: 0, slowHlsMs: 0, hls404: false });

  // ---------- helpers ----------
  function send(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(text);
  }
  // api/respond: every error is {"error": "..."}.
  const fail = (res, status, message, headers) => send(res, status, { error: message }, headers);

  async function readJson(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    } catch {
      return undefined;
    }
  }

  function sessionIdFrom(req, url) {
    const auth = req.headers.authorization ?? '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    const q = url.searchParams.get('session_id');
    if (q) return q;
    const cookie = /(?:^|;\s*)inox_session=([^;]+)/.exec(req.headers.cookie ?? '');
    return cookie?.[1] ?? null;
  }

  /** api/middleware/auth.go: no credentials → "authentication required"; unknown → "session expired or invalid". */
  function authenticate(req, res, url) {
    const id = sessionIdFrom(req, url);
    if (!id) {
      fail(res, 401, 'authentication required');
      return null;
    }
    const userId = sessions.get(id);
    const user = userId && users.find((u) => u.id === userId);
    if (!user) {
      fail(res, 401, 'session expired or invalid');
      return null;
    }
    return user;
  }

  function memberJson(userId) {
    const m = roomMembers.get(userId);
    if (!m) return null;
    const user = users.find((u) => u.id === userId);
    return { room_id: ROOM_ID, user_id: userId, username: user?.username, role: m.role, permissions: permissionsForRole(m.role), joined_at: m.joined_at };
  }

  function roomJson() {
    const viewers = new Set([...clients].map((c) => c.userId)).size;
    const r = { ...room, current_media_url: playback.media_url };
    // domain/room.go: `activity` is present only while someone is connected.
    if (viewers > 0) r.activity = { viewers, is_playing: playback.is_playing, media_url: playback.media_url, kind: playback.kind };
    return r;
  }

  function mediaJson() {
    let ready = true;
    try {
      statSync(join(fixturesDir, FIXTURE_MASTER));
    } catch {
      ready = false;
    }
    return {
      id: MEDIA_ID,
      kind: 'vod',
      title: 'Test Pattern (mock fixture)',
      description: 'Synthetic HLS ladder generated by scripts/make-hls-fixture.sh',
      source_url: mediaUrl(),
      status: ready ? 'ready' : 'failed',
      duration_seconds: 60,
      progress: ready ? 100 : 0,
      thumbnail_url: '',
      hls_master_url: mediaUrl(),
      created_by: hostUser.id,
      created_at: startedAt,
      updated_at: startedAt,
      renditions: null,
    };
  }

  function rateLimited(req, res) {
    if (!rateLimit) return false;
    const ip = req.socket.remoteAddress ?? '?';
    const t = now();
    const hits = (authHits.get(ip) ?? []).filter((h) => t - h < AUTH_WINDOW_MS);
    if (hits.length >= AUTH_LIMIT) {
      const retryAfter = Math.ceil((AUTH_WINDOW_MS - (t - hits[0])) / 1000);
      fail(res, 429, 'rate limit exceeded: too many requests, please try again later', { 'Retry-After': String(retryAfter) });
      authHits.set(ip, hits);
      return true;
    }
    hits.push(t);
    authHits.set(ip, hits);
    return false;
  }

  // ---------- WebSocket fan-out (ws/hub.go) ----------
  function deliver(event, filter = () => true) {
    const frame = typeof event === 'string' ? event : JSON.stringify(event);
    const targets = [...clients].filter((c) => (event.target_id ? c.userId === event.target_id : true) && filter(c));
    const go = () => {
      for (const c of targets) if (c.ws.readyState === c.ws.OPEN) c.ws.send(frame);
    };
    if (faults.latencyMs > 0) setTimeout(go, faults.latencyMs);
    else go();
  }

  function envelope(type, payload, extra = {}) {
    // ws/event.go: omitempty on everything but type and timestamp.
    const e = { type, room_id: ROOM_ID, ...extra, timestamp: extra.timestamp ?? 0 };
    if (payload !== undefined) e.payload = payload;
    return e;
  }

  function syncPayload() {
    return { media_url: playback.media_url, kind: playback.kind, is_playing: playback.is_playing, media_time_seconds: playback.media_time_seconds, last_updated: playback.last_updated, age_ms: 0 };
  }

  /** ws/hub.go handleEvent: state effects of PLAY/PAUSE/SEEK/CHANGE_MEDIA. */
  function applyToState(type, payload) {
    const t = typeof payload?.media_time_seconds === 'number' ? payload.media_time_seconds : 0;
    if (type === 'PLAY') Object.assign(playback, { is_playing: true, media_time_seconds: t, last_updated: now() });
    else if (type === 'PAUSE') Object.assign(playback, { is_playing: false, media_time_seconds: t, last_updated: now() });
    else if (type === 'SEEK') Object.assign(playback, { media_time_seconds: t, last_updated: now() });
    else if (type === 'CHANGE_MEDIA') {
      const url = typeof payload?.media_url === 'string' ? payload.media_url : '';
      // ws/hub.go kindForMediaURL: the mock only knows its VOD fixture; anything under /live/ is live.
      Object.assign(playback, { media_url: url, kind: url.includes('/live/') ? 'live' : 'vod', is_playing: false, media_time_seconds: 0, last_updated: now() });
    }
  }

  function onClientFrame(client, raw) {
    let parsed;
    try {
      parsed = JSON.parse(String(raw));
    } catch {
      return; // ws/client.go readPump drops undecodable frames
    }
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') return;
    // ws/hub.go: the membership of the sender is checked on every event; kicked users are dropped silently.
    if (!roomMembers.has(client.userId)) return;
    events.push({ at: now(), user_id: client.userId, type: parsed.type, payload: parsed.payload });
    if (events.length > 500) events.shift();

    if (parsed.type === 'LIVE_POSITION') {
      // ws/live.go MarkCannotLead: `unable` hands leadership on; positions are not fanned out.
      if (parsed.payload?.unable) declines.push({ at: now(), user_id: client.userId });
      return;
    }
    if (parsed.type === 'CHAT_MESSAGE' && typeof parsed.payload?.message === 'string') {
      chat.push({ id: randomUUID(), room_id: ROOM_ID, user_id: client.userId, username: client.username, message: parsed.payload.message, created_at: iso() });
    }
    applyToState(parsed.type, parsed.payload);
    // The server overwrites sender_id/sender_name/room_id and fans out to everyone, sender included.
    deliver({ ...parsed, room_id: ROOM_ID, sender_id: client.userId, sender_name: client.username, timestamp: parsed.timestamp ?? 0 });
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  wss.on('connection', (ws, req, user) => {
    const client = { ws, userId: user.id, username: user.username };
    clients.add(client);
    log('ws open', user.username, `(${clients.size} connected)`);
    // ws/hub.go registerClient: JOIN_ROOM to the room, then SYNC_PLAYBACK targeted at the newcomer
    // with the server clock; SFU_PEERS only when someone is in voice (never, in the mock).
    deliver(envelope('JOIN_ROOM', undefined, { sender_id: user.id, sender_name: user.username }));
    deliver(envelope('SYNC_PLAYBACK', syncPayload(), { target_id: user.id, timestamp: now() }));

    let lastPong = now();
    ws.on('pong', () => (lastPong = now()));
    const ping = setInterval(() => {
      if (now() - lastPong > PONG_WAIT_MS) ws.terminate();
      else ws.ping();
    }, PING_MS);
    ws.on('message', (data) => onClientFrame(client, data));
    ws.on('close', () => {
      clearInterval(ping);
      clients.delete(client);
      log('ws close', user.username);
      deliver(envelope('LEAVE_ROOM', undefined, { sender_id: user.id, sender_name: user.username }));
    });
  });

  // ---------- control API (mock only) ----------
  async function control(scenario, url, res) {
    const userParam = url.searchParams.get('user');
    const pick = (v) => users.find((u) => u.id === v || u.username === v);
    switch (scenario) {
      case 'drop-sockets':
        // terminate() closes without a close frame, so clients see 1006 like a network loss.
        for (const c of clients) c.ws.terminate();
        return send(res, 200, { dropped: clients.size });
      case 'expire-sessions': {
        const n = sessions.size;
        sessions.clear(); // like FLUSHDB on Inox's Redis session store
        return send(res, 200, { expired: n });
      }
      case 'latency':
        faults.latencyMs = Number(url.searchParams.get('ms') ?? 800);
        return send(res, 200, { latencyMs: faults.latencyMs });
      case 'malformed':
        deliver('{"type":"PLAY","payload":"oops"}');
        return send(res, 200, { sent: true });
      case 'send': {
        // A server-injected playback event, attributed to the host so clients treat it as remote.
        const type = url.searchParams.get('type') ?? 'PLAY';
        const raw = url.searchParams.get('payload');
        const payload = raw ? JSON.parse(raw) : { media_time_seconds: Number(url.searchParams.get('t') ?? 0) };
        const from = pick(userParam ?? 'host') ?? hostUser;
        applyToState(type, payload);
        deliver(envelope(type, payload, { sender_id: from.id, sender_name: from.username, timestamp: now() }));
        return send(res, 200, { sent: type, payload });
      }
      case 'make-leader': {
        // ws/live.go: LIVE_LEADER goes to the room; a client that can't lead answers LIVE_POSITION {unable:true}.
        const leader = pick(userParam ?? 'couch') ?? tvUser;
        const timeoutMs = Number(url.searchParams.get('timeout') ?? 2000);
        const since = now();
        deliver(envelope('LIVE_LEADER', { leader_id: leader.id, leader_name: leader.username }, { timestamp: since }));
        const declined = await new Promise((done) => {
          const tick = setInterval(() => {
            const hit = declines.find((d) => d.user_id === leader.id && d.at >= since);
            if (hit || now() - since > timeoutMs) {
              clearInterval(tick);
              done(hit ? hit.at - since : null);
            }
          }, 20);
        });
        return send(res, 200, { leader: leader.username, declined: declined !== null, ms: declined });
      }
      case 'slow-hls':
        faults.slowHlsMs = Number(url.searchParams.get('ms') ?? 3000);
        return send(res, 200, { slowHlsMs: faults.slowHlsMs });
      case 'hls-404':
        faults.hls404 = true;
        return send(res, 200, { hls404: true });
      case 'reset':
        resetFaults();
        return send(res, 200, { reset: true });
      case 'events':
        return send(res, 200, { events, playback: { ...playback }, connected: [...clients].map((c) => c.username) });
      default:
        return fail(res, 404, `unknown control scenario: ${scenario}`);
    }
  }

  // ---------- HTTP ----------
  function serveStream(rel, res) {
    const file = normalize(join(fixturesDir, rel));
    if (!file.startsWith(fixturesDir + sep)) return fail(res, 404, 'not found');
    if (faults.hls404 && rel.endsWith('master.m3u8')) return fail(res, 404, 'object not found');
    let size;
    try {
      size = statSync(file).size;
    } catch {
      return fail(res, 404, 'object not found');
    }
    const start = () => {
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': size, 'Access-Control-Allow-Origin': '*' });
      createReadStream(file).pipe(res);
    };
    if (faults.slowHlsMs > 0 && !rel.endsWith('.m3u8')) setTimeout(start, faults.slowHlsMs);
    else start();
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://mock');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    let m;

    if (method === 'GET' && path === '/healthz') return send(res, 200, { status: 'ok', database: 'ok', redis: 'ok' });
    if ((method === 'GET' || method === 'HEAD') && path.startsWith('/media/stream/')) return serveStream(decodeURIComponent(path.slice('/media/stream/'.length)), res);
    if (path.startsWith('/__control/')) {
      if (!opts.control) return fail(res, 404, 'control API disabled (start with --control)');
      return control(path.slice('/__control/'.length), url, res);
    }

    if (method === 'POST' && path === '/api/v1/auth/login') {
      if (rateLimited(req, res)) return;
      const body = await readJson(req);
      if (!body || typeof body !== 'object') return fail(res, 400, 'invalid request json payload');
      const user = users.find((u) => u.email === body.email);
      if (!user || body.password !== password) return fail(res, 401, 'invalid email or password');
      const id = randomUUID();
      sessions.set(id, user.id);
      return send(res, 200, { id, user_id: user.id, username: user.username, email: user.email, role: 'user', avatar_url: null, created_at: iso(), expires_at: iso(now() + 7 * 86_400_000) });
    }

    // GET /media is public (api/router.go).
    if (method === 'GET' && path === '/api/v1/media') return send(res, 200, [mediaJson()]);
    if (method === 'GET' && (m = /^\/api\/v1\/media\/([^/]+)$/.exec(path))) return m[1] === MEDIA_ID ? send(res, 200, mediaJson()) : fail(res, 404, 'media asset not found');

    const user = authenticate(req, res, url);
    if (!user) return;

    if (method === 'POST' && path === '/api/v1/auth/logout') {
      sessions.delete(sessionIdFrom(req, url));
      return send(res, 200, { message: 'logged out successfully' });
    }
    if (method === 'GET' && path === '/api/v1/users/me') return send(res, 200, { id: user.id, username: user.username, email: user.email, avatar_url: null, created_at: startedAt });
    if (method === 'GET' && path === '/api/v1/rooms') return send(res, 200, [roomJson()]);

    if ((m = /^\/api\/v1\/rooms\/([^/]+)(\/.*)?$/.exec(path))) {
      const [, roomId, rest = ''] = m;
      if (method === 'POST' && rest === '/join') {
        if (roomId !== ROOM_ID) return fail(res, 500, 'failed to join room');
        // api/handler/room.go JoinRoom: idempotent, new members get role "member".
        if (!roomMembers.has(user.id)) roomMembers.set(user.id, { role: 'member', joined_at: iso() });
        return send(res, 200, memberJson(user.id));
      }
      // api/middleware/rbac.go RequireRoomMembership.
      if (roomId !== ROOM_ID || !roomMembers.has(user.id)) return fail(res, 403, 'access denied: not a member of this room');
      if (method === 'GET' && rest === '') return send(res, 200, { room: roomJson(), member: memberJson(user.id) });
      if (method === 'GET' && rest === '/messages') {
        const limitParam = Number(url.searchParams.get('limit') ?? 50);
        const limit = limitParam >= 1 && limitParam <= 100 ? limitParam : 50;
        const recent = chat.slice(-limit); // room/chat_repository.go: newest N, returned oldest first
        // Go encodes an empty slice as null (contract §6).
        return send(res, 200, { room_id: ROOM_ID, messages: recent.length ? recent : null, count: recent.length });
      }
    }
    return fail(res, 404, 'not found');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log('handler error', err);
      if (!res.headersSent) fail(res, 500, 'internal error');
    });
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const m = /^\/api\/v1\/rooms\/([^/]+)\/ws$/.exec(url.pathname);
    const reject = (status, message) => {
      const body = JSON.stringify({ error: message });
      socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not Found'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    };
    if (!m) return reject(404, 'not found');
    // The mock accepts any Origin; Inox checks it against CORS_ALLOWED_ORIGINS (api/handler/ws.go, decision D13).
    const id = sessionIdFrom(req, url);
    const user = id && users.find((u) => u.id === sessions.get(id));
    if (!user) return reject(401, 'authentication required');
    if (m[1] !== ROOM_ID || !roomMembers.has(user.id)) return reject(403, 'access denied: not a member of this room');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, user));
  });

  await new Promise((done, failStart) => {
    server.once('error', failStart);
    server.listen(opts.port ?? DEFAULT_PORT, host, done);
  });
  const port = server.address().port;
  publicBase = opts.publicBaseUrl ?? `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  playback.media_url = mediaUrl();

  return {
    port,
    url: publicBase,
    apiUrl: `${publicBase}/api/v1`,
    wsUrl: `${publicBase.replace(/^http/, 'ws')}/api/v1`,
    roomId: ROOM_ID,
    password,
    users: { host: { ...hostUser }, tv: { ...tvUser } },
    /** Test hook: set a member's role, as a host promoting someone in the web UI would. */
    setRole(username, role) {
      const u = users.find((x) => x.username === username);
      if (u) roomMembers.set(u.id, { role, joined_at: roomMembers.get(u.id)?.joined_at ?? iso() });
    },
    async close() {
      for (const c of clients) c.ws.terminate();
      wss.close();
      server.closeAllConnections?.();
      await new Promise((done) => server.close(() => done()));
    },
  };
}
