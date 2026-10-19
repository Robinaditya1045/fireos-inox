// Types text on the room's Custom URL keyboard (apps/vega/src/components/UrlKeyboard.tsx) with remote
// keys only, closed-loop: it reads the focused key from the app log, steps toward the next key and
// presses select. Needs the app running against Metro with tools/devlog/devlog.mjs writing the log.
//   node tools/validate/vvd-type-url.mjs <text> [--log .devstack/logs/app-all.log] [--play]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const text = args[0];
const log = opt('--log', '.devstack/logs/app-all.log');
if (text === undefined) throw new Error('usage: vvd-type-url.mjs <text> [--log file] [--play]');

// Keep in step with UrlKeyboard.tsx.
const SNIPPETS = ['https://', 'www.', '.com', '.mp4', '.mkv', '.m3u8'];
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_./', ':?=&%~#+@,'];
const ACTIONS = ['url-shift', 'url-delete', 'url-clear', 'url-play'];
const pos = new Map();
SNIPPETS.forEach((s, c) => pos.set(`url-snippet-${s}`, [0, c]));
ROWS.forEach((row, r) => [...row].forEach((ch, c) => pos.set(`url-key-${ch}`, [r + 1, c])));
ACTIONS.forEach((id, c) => pos.set(id, [ROWS.length + 1, c]));

const press = (key) => execFileSync('scripts/vvd.sh', ['key', key]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function focused() {
  const lines = readFileSync(log, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /\[focus\] button \{"id":"([^"]+)"\}/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}
async function goTo(id) {
  const [tr, tc] = pos.get(id);
  for (let steps = 0; steps < 40; steps++) {
    await sleep(250);
    const cur = focused();
    if (cur === id) return;
    const here = pos.get(cur);
    if (!here) throw new Error(`focus is on ${cur}, not on the URL keyboard`);
    const [r, c] = here;
    press(r !== tr ? (r < tr ? 'KEY_DOWN' : 'KEY_UP') : c < tc ? 'KEY_RIGHT' : 'KEY_LEFT');
  }
  throw new Error(`could not reach ${id}`);
}

// Greedy: use a snippet where the text continues with one, else one character.
let upper = false;
for (let i = 0; i < text.length; ) {
  const snippet = SNIPPETS.find((s) => text.startsWith(s, i));
  let id;
  if (snippet) {
    id = `url-snippet-${snippet}`;
    i += snippet.length;
  } else {
    const ch = text[i];
    const lower = ch.toLowerCase();
    if (!pos.has(`url-key-${lower}`)) throw new Error(`no key for ${JSON.stringify(ch)}`);
    const wantUpper = ch !== lower;
    if (wantUpper !== upper) {
      await goTo('url-shift');
      press('KEY_ENTER');
      upper = wantUpper;
    }
    id = `url-key-${lower}`;
    i += 1;
  }
  await goTo(id);
  press('KEY_ENTER');
}
if (args.includes('--play')) {
  await goTo('url-play');
  press('KEY_ENTER');
}
console.log(`typed ${JSON.stringify(text)}`);
