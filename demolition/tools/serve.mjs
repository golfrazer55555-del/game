// 개발용 정적 서버. 같은 와이파이의 휴대폰에서도 접속할 수 있다.
//   npm start            → 소스 그대로 (http://localhost:8090)
//   npm run preview      → 빌드 결과(dist) 확인. localhost에서는 크롬 설치(PWA)도 시험할 수 있다.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = process.argv.includes('--dist');
const root = normalize(join(here, '..', dist ? 'dist' : ''));
const port = Number(process.env.PORT) || (dist ? 8091 : 8090);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (url.endsWith('/')) url += 'index.html';
  const file = normalize(join(root, url));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const st = await stat(file);
    if (st.isDirectory()) { res.writeHead(302, { Location: url + '/' }).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '0.0.0.0', () => {
  console.log(`철거왕 ${dist ? '빌드 미리보기' : '개발 서버'}: http://localhost:${port}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`휴대폰(같은 와이파이): http://${n.address}:${port}`);
  }
});
