// 개발용 정적 서버 (추가 설치 불필요). 같은 와이파이의 휴대폰에서도 접속할 수 있다.
//   npm start  →  http://localhost:8080
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = normalize(join(root, url === '/' ? 'index.html' : url));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`포화의 전선 개발 서버: http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`휴대폰(같은 와이파이): http://${n.address}:${port}`);
  }
});
