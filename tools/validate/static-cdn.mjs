// A stand-in CDN for testing Custom URL playback (D16) without the internet: serves one directory
// over HTTP with byte ranges (players seek in MP4/MKV with Range requests) and open CORS.
//   node tools/validate/static-cdn.mjs [--dir .devstack/cdn] [--port 18100] [--tls <dir with cert.pem, key.pem>] [--host 127.0.0.1]
// Binds to loopback by default (the VVD reaches it through the reverse forward below); pass
// --host 0.0.0.0 only if another device on the LAN must fetch from it.
// On VVD, reach it with `vega device start-port-forwarding --port <port> --forward false`, then the
// same localhost URL works on the TV and on the host. The TV's URL-mode player refuses http:// files
// (MediaError 4, D16), so file playback on the TV needs --tls.
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const root = resolve(opt('--dir', '.devstack/cdn'));
const port = Number(opt('--port', 18100));
const tls = opt('--tls');
const host = opt('--host', '127.0.0.1');
const TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

const handler = (req, res) => {
  let path = req.url ?? '/';
  let file;
  let size;
  try {
    path = decodeURIComponent(new URL(path, 'http://cdn').pathname); // throws on a malformed %-escape
    file = normalize(join(root, path));
    if (!file.startsWith(root + sep)) throw new Error('outside root');
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file'); // a directory (even "/") would crash the read stream
    size = st.size;
  } catch {
    res.writeHead(404).end();
    console.log(req.method, path, 404);
    return;
  }
  const head = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = size - 1;
  if (range) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { ...head, 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  } else {
    res.writeHead(200, { ...head, 'Content-Length': size });
  }
  console.log(req.method, path, range ? `${start}-${end}` : 'full');
  if (req.method === 'HEAD') res.end();
  else
    createReadStream(file, { start, end })
      .on('error', (err) => {
        console.log(req.method, path, `read error ${err.code ?? err.message}`);
        res.destroy();
      })
      .pipe(res);
};

const server = tls
  ? createTlsServer({ cert: readFileSync(join(tls, 'cert.pem')), key: readFileSync(join(tls, 'key.pem')) }, handler)
  : createServer(handler);
server.listen(port, host, () => console.log(`static-cdn: ${root} on ${tls ? 'https' : 'http'}://${host}:${port}/ (use localhost on the VVD)`));
