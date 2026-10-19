#!/usr/bin/env node
// Runs the mock Inox backend.
//   node tools/mock-inox/src/cli.mjs [--port 18090] [--host 127.0.0.1] [--public-url http://HOST:18090]
//                                    [--control] [--no-rate-limit] [--fixtures DIR]
// Control API (with --control): POST /__control/{drop-sockets|expire-sessions|latency?ms=|malformed|
//   send?type=&t=|make-leader?user=|slow-hls?ms=|hls-404|reset}, GET /__control/events.
//   POST /__control/permissions?user=<id|username|email>&can_send_messages=false (any permission flag,
//   true|false) edits a member's permissions, as a host would in the web UI; reset restores role defaults.
//   Chat is fanned out even from a muted member but only saved when allowed (ws/hub.go, room/chat_service.go).
import { DEFAULT_PORT, startMock } from './mock.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const mock = await startMock({
  port: Number(opt('--port', DEFAULT_PORT)),
  host: opt('--host', '127.0.0.1'),
  publicBaseUrl: opt('--public-url', undefined),
  fixturesDir: opt('--fixtures', undefined),
  control: args.includes('--control'),
  rateLimit: !args.includes('--no-rate-limit'),
});

console.log(`[mock-inox] API     ${mock.apiUrl}`);
console.log(`[mock-inox] WS      ${mock.wsUrl}/rooms/${mock.roomId}/ws`);
console.log(`[mock-inox] users   ${mock.users.host.email} (owner) · ${mock.users.tv.email} (member)`);
console.log(`[mock-inox] password: the MOCK_PASSWORD env var, else "mock-only-password" (mock only; guards nothing)`);
console.log(`[mock-inox] control ${args.includes('--control') ? `${mock.url}/__control/<scenario>` : 'disabled (pass --control)'}`);

const stop = async () => {
  await mock.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
