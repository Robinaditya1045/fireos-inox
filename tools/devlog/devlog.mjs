#!/usr/bin/env node
// Streams the app's console output from the Metro inspector (React Native 0.83 no longer prints
// JS logs in the Metro terminal). Each line is prefixed with the host receive time in epoch ms,
// which is the clock shared with the VVD.
//   node tools/devlog/devlog.mjs [--filter FOI] [--metro http://127.0.0.1:8081]
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const metro = opt('--metro', 'http://127.0.0.1:8081');
const filter = opt('--filter', '');

async function connect() {
  const targets = await (await fetch(`${metro}/json/list`)).json();
  const target = targets.find((t) => t.appId === 'com.fireosinox.tv') ?? targets[0];
  if (!target) throw new Error('no debug target — is the app running against Metro?');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: ++id, method: 'Runtime.enable' }));
    console.error(`devlog: attached to ${target.title}`);
  };
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.method !== 'Runtime.consoleAPICalled') return;
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (filter && !text.includes(filter)) return;
    process.stdout.write(`${Date.now()} ${text}\n`);
  };
  ws.onclose = () => {
    console.error('devlog: detached; retrying in 2 s');
    setTimeout(() => connect().catch(retry), 2000);
  };
}
const retry = (err) => {
  console.error(`devlog: ${err.message}; retrying in 2 s`);
  setTimeout(() => connect().catch(retry), 2000);
};
connect().catch(retry);
