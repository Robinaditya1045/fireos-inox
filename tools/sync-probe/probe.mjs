#!/usr/bin/env node
// Scripted room participant for the local stack (docs/dev/testing.md).
//   node tools/sync-probe/probe.mjs [--as host|tv] listen
//   node tools/sync-probe/probe.mjs [--as host|tv] send <TYPE> '<json payload>'
//     e.g. send CHAT_MESSAGE '{"message":"😂"}'   (a reaction, D17; any CHAT_MESSAGE text works)
//   node tools/sync-probe/probe.mjs [--as host|tv] script <file.json>   # [{"at":ms,"type":..,"payload":..}]
//   node tools/sync-probe/probe.mjs role member|moderator [--mute]   # as host: set the TV user's role;
//     --mute also takes away can_send_messages (re-enter the room on the TV to pick it up)
// Credentials and room come from .devstack/seed-credentials.json and .devstack/seed-output.json.
// Each received event is printed as "<recvEpochMs> <json>".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = process.env.INOX_API ?? 'http://127.0.0.1:18080/api/v1';
const args = process.argv.slice(2);
let who = 'host';
if (args[0] === '--as') {
  who = args[1];
  args.splice(0, 2);
}
const [cmd, ...rest] = args;
const creds = JSON.parse(readFileSync(join(root, '.devstack', 'seed-credentials.json'), 'utf8'))[who];
const seed = JSON.parse(readFileSync(join(root, '.devstack', 'seed-output.json'), 'utf8'));
const roomId = process.env.ROOM_ID ?? seed.room_id;

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
if (!login.ok) throw new Error(`login failed: ${login.status} ${await login.text()}`);
const session = (await login.json()).id;

if (cmd === 'role') {
  // PUT /rooms/{id}/members/{user_id}/role (api/handler/room.go AssignRole) needs can_manage_roles,
  // so it runs as the host. Without `permissions` Inox applies the role's defaults; --mute sends those
  // defaults (domain/room.go DefaultPermissionsForRole) with can_send_messages turned off.
  const role = rest[0];
  const defaults = {
    member: { can_control_playback: false, can_stream_audio: true, can_stream_video: true, can_share_screen: false, can_send_messages: true, can_invite_users: false, can_kick_users: false, can_manage_roles: false },
    moderator: { can_control_playback: true, can_stream_audio: true, can_stream_video: true, can_share_screen: true, can_send_messages: true, can_invite_users: true, can_kick_users: true, can_manage_roles: false },
  }[role];
  if (!defaults) {
    console.error('usage: probe.mjs role member|moderator [--mute]');
    process.exit(1);
  }
  const tv = JSON.parse(readFileSync(join(root, '.devstack', 'seed-credentials.json'), 'utf8')).tv;
  const tvLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: tv.email, password: tv.password }) });
  if (!tvLogin.ok) throw new Error(`tv login failed: ${tvLogin.status}`);
  const tvUserId = (await tvLogin.json()).user_id;
  const body = { role, ...(rest.includes('--mute') ? { permissions: { ...defaults, can_send_messages: false } } : {}) };
  const res = await fetch(`${API}/rooms/${roomId}/members/${tvUserId}/role`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` }, body: JSON.stringify(body) });
  console.log(`${res.status} ${await res.text()}`);
  process.exit(res.ok ? 0 : 1);
}

const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/rooms/${roomId}/ws?session_id=${session}`);
const send = (type, payload) => {
  ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
  console.log(`${Date.now()} SENT ${type} ${JSON.stringify(payload)}`);
};
ws.onmessage = ({ data }) => console.log(`${Date.now()} ${data}`);
ws.onclose = (e) => console.log(`${Date.now()} CLOSED ${e.code}`);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('socket error'));
});

if (cmd === 'send') {
  send(rest[0], JSON.parse(rest[1] ?? '{}'));
  setTimeout(() => ws.close(), 1500);
} else if (cmd === 'script') {
  const steps = JSON.parse(readFileSync(rest[0], 'utf8'));
  const t0 = Date.now();
  for (const step of steps) {
    await new Promise((r) => setTimeout(r, Math.max(0, t0 + step.at - Date.now())));
    send(step.type, step.payload);
  }
  setTimeout(() => ws.close(), 3000);
} else if (cmd !== 'listen') {
  console.error('usage: probe.mjs [--as host|tv] listen | send TYPE JSON | script FILE | role member|moderator [--mute]');
  process.exit(1);
}
