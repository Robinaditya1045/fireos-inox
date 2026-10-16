#!/usr/bin/env node
// Cross-client sync analysis: browser <video>.currentTime (host clock) vs TV player position
// (VVD clock, converted with the clock offset the TV logged at SYNC_PLAYBACK).
//   node tools/validate/analyze-sync.mjs <web-run.log> <app-all.log> [--settle 3000]
// Pass criteria (docs/dev/testing.md): within 3 s of each action |offset| ≤ 1.0 s, and in steady
// state |offset| ≤ 0.5 s for ≥95 % of samples.
import { readFileSync } from 'node:fs';

const [webPath, appPath, ...rest] = process.argv.slice(2);
const settleMs = rest.includes('--settle') ? Number(rest[rest.indexOf('--settle') + 1]) : 3000;
const parse = (line) => {
  const i = line.indexOf('{');
  return i < 0 ? null : JSON.parse(line.slice(i));
};

const web = [];
const actions = [];
let t0 = Infinity;
for (const line of readFileSync(webPath, 'utf8').split('\n')) {
  const host = Number(line.split(' ')[0]);
  if (line.includes(' WEB ')) web.push({ host, ...parse(line) });
  if (line.includes(' ACTION ') && !line.includes('screenshot')) actions.push({ host, ...parse(line) });
  if (line.includes(' READY ')) t0 = host;
}

const app = readFileSync(appPath, 'utf8').replace(/\0/g, '').split('\n');
let offset = null;
const tv = [];
const remote = [];
for (const line of app) {
  if (!line.includes('FOI')) continue;
  const host = Number(line.split(' ')[0]);
  if (host < t0 - 60000) continue;
  const ctx = parse(line);
  if (line.includes('SYNC_PLAYBACK') && ctx) offset = ctx.clockOffsetMs;
  if (line.includes('"POS"') || line.includes('[sync] POS')) tv.push(ctx);
  if (line.includes('REMOTE ') && ctx) remote.push({ type: line.match(/REMOTE (\w+)/)[1], ...ctx });
}
if (offset === null) throw new Error('no SYNC_PLAYBACK with clockOffsetMs in app log');
const tvHost = tv.filter((s) => s && s.localNowMs).map((s) => ({ ...s, host: s.localNowMs - offset }));

// TV position at host time h: extrapolate from the nearest earlier TV sample.
function tvAt(h) {
  let best = null;
  for (const s of tvHost) if (s.host <= h && (!best || s.host > best.host)) best = s;
  if (!best || h - best.host > 1500) return null;
  return best.playing ? best.actual + (h - best.host) / 1000 : best.actual;
}

const rows = web
  .filter((w) => w.host >= t0)
  .map((w) => {
    const tvPos = tvAt(w.host);
    return tvPos === null ? null : { host: w.host, web: w.t, tv: tvPos, offset: w.t - tvPos, paused: w.paused };
  })
  .filter(Boolean);

const sinceAction = (h) => Math.min(...actions.filter((a) => a.host <= h).map((a) => h - a.host), Infinity);
const steady = rows.filter((r) => sinceAction(r.host) > settleMs);
const abs = steady.map((r) => Math.abs(r.offset)).sort((a, b) => a - b);
const pct = (p) => abs[Math.min(abs.length - 1, Math.floor((p / 100) * abs.length))] ?? NaN;

console.log(`clock offset (device − server): ${offset} ms`);
console.log(`samples: ${rows.length} total, ${steady.length} steady-state (>${settleMs} ms after an action)`);
console.log(`steady |offset|: p50 ${pct(50).toFixed(3)} s · p95 ${pct(95).toFixed(3)} s · max ${abs.at(-1)?.toFixed(3)} s · ≤0.5 s: ${((abs.filter((x) => x <= 0.5).length / abs.length) * 100).toFixed(1)} %`);

// The browser is not a perfect reference: Inox's web client never corrects its own VOD drift, so
// after a seek it stays behind the room by its rebuffer time. The TV's drift against the room's
// authoritative position (expected − actual, from its POS lines) isolates the TV's own accuracy.
const tvDrift = tvHost
  .filter((s) => s.playing && s.host >= t0 && sinceAction(s.host) > settleMs)
  .map((s) => Math.abs(s.drift))
  .sort((a, b) => a - b);
const tvPct = (p) => tvDrift[Math.min(tvDrift.length - 1, Math.floor((p / 100) * tvDrift.length))] ?? NaN;
console.log(`TV vs room (playing, steady): n=${tvDrift.length} p50 ${tvPct(50).toFixed(3)} s · p95 ${tvPct(95).toFixed(3)} s · max ${tvDrift.at(-1)?.toFixed(3)} s`);

console.log('\nper action (host ms → TV received → offset ≤ 1.0 s):');
for (const a of actions) {
  const type = { play: 'PLAY', pause: 'PAUSE', seek: 'SEEK' }[a.do];
  const rec = remote.find((r) => r.type === type && r.localNowMs - offset >= a.host - 200);
  const deliveryMs = rec ? rec.localNowMs - offset - a.host : NaN;
  const within = rows.filter((r) => r.host > a.host && r.host <= a.host + 3000);
  const converged = rows.find((r) => r.host > a.host + 300 && Math.abs(r.offset) <= 1.0);
  console.log(
    `  ${a.do}${a.t !== undefined ? ' ' + a.t : ''}: delivered ${isNaN(deliveryMs) ? 'NOT SEEN' : deliveryMs + ' ms'}; ` +
      `first |offset|≤1 s at +${converged ? converged.host - a.host : '∞'} ms; ` +
      `within 3 s: ${within.map((r) => r.offset.toFixed(2)).join(', ') || '—'}`,
  );
}

console.log('\ntimeline (every 5th sample): host+s  web  tv  offset');
rows.forEach((r, i) => {
  if (i % 5 === 0) console.log(`  +${((r.host - t0) / 1000).toFixed(0).padStart(3)}  ${r.web.toFixed(2).padStart(7)} ${r.tv.toFixed(2).padStart(7)} ${r.offset.toFixed(3).padStart(7)}${r.paused ? '  (paused)' : ''}`);
});
