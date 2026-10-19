// A stand-in CDN for testing Custom URL playback (D16) without the internet: serves one directory
// over HTTP with byte ranges (players seek in MP4/MKV with Range requests) and open CORS.
//   node tools/validate/static-cdn.mjs [--dir .devstack/cdn] [--port 18100] [--tls <dir with cert.pem, key.pem>]
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
const TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
};

const handler = (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://cdn').pathname);
  const file = normalize(join(root, path));
  const head = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' };
  let size;
  try {
    if (!file.startsWith(root + sep)) throw new Error('outside root');
    size = statSync(file).size;
  } catch {
    res.writeHead(404).end();
    console.log(req.method, path, 404);
    return;
  }
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
  else createReadStream(file, { start, end }).pipe(res);
};

const server = tls
  ? createTlsServer({ cert: readFileSync(join(tls, 'cert.pem')), key: readFileSync(join(tls, 'key.pem')) }, handler)
  : createServer(handler);
server.listen(port, () => console.log(`static-cdn: ${root} on ${tls ? 'https' : 'http'}://localhost:${port}/`));
