#!/usr/bin/env node
// Drives the real Inox web client (headless Chrome) as the room host and runs a timed script of
// UI actions, while sampling the browser's own <video>.currentTime once per second.
//   node tools/validate/browser-host.mjs <script.json> [--web http://localhost:15173]
// script.json: [{"at": ms, "do": "play" | "pause" | "seek", "t": seconds}, ...]
// Output lines: "<hostEpochMs> WEB {...}" samples and "<hostEpochMs> ACTION {...}".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const steps = JSON.parse(readFileSync(args[0], 'utf8'));
const webIdx = args.indexOf('--web');
const WEB = webIdx >= 0 ? args[webIdx + 1] : 'http://localhost:15173';
const creds = JSON.parse(readFileSync(join(root, '.devstack', 'seed-credentials.json'), 'utf8')).host;
const seed = JSON.parse(readFileSync(join(root, '.devstack', 'seed-output.json'), 'utf8'));
const out = (kind, obj) => console.log(`${Date.now()} ${kind} ${JSON.stringify(obj)}`);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => out('PAGEERROR', { message: e.message }));

await page.goto(`${WEB}/login`, { waitUntil: 'networkidle2' });
await page.type('input[name=email]', creds.email);
await page.type('input[name=password]', creds.password);
await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => undefined), page.click('button[type=submit]')]);
await page.goto(`${WEB}/room/${seed.room_id}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('video', { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1, { timeout: 30000 });
out('READY', { url: page.url() });

const sampler = setInterval(async () => {
  try {
    const v = await page.evaluate(() => {
      const el = document.querySelector('video');
      return { t: el.currentTime, paused: el.paused, rs: el.readyState };
    });
    out('WEB', v);
  } catch {
    // page navigating; skip this sample
  }
}, 1000);

async function act(step) {
  if (step.do === 'play' || step.do === 'pause') {
    const label = step.do === 'play' ? 'Play Video' : 'Pause Video';
    // The control bar is hover-revealed; move the mouse over the player first.
    await page.hover('video');
    await page.click(`button[aria-label="${label}"]`);
  } else if (step.do === 'seek') {
    await page.hover('video');
    await page.evaluate((t) => {
      const input = document.querySelector('input[aria-label="Video Playback Scrubber"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, String(t));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, step.t);
  } else if (step.do === 'screenshot') {
    await page.screenshot({ path: join(root, '.devstack', 'evidence', `${step.name}.png`) });
  }
  out('ACTION', step);
}

const t0 = Date.now();
for (const step of steps) {
  await new Promise((r) => setTimeout(r, Math.max(0, t0 + step.at - Date.now())));
  await act(step).catch((e) => out('ACTION_FAILED', { step, error: e.message }));
}
clearInterval(sampler);
await browser.close();
