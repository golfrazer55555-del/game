// 배포본 만들기: dist/ 에 HTML + 번들 JS + 서비스 워커 + 아이콘 + 글꼴
//   npm run build
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --publish: 저장소 맨 위에 바로 내보낸다 (GitHub Pages "브랜치에서 배포" 설정에서도 바로 보이도록)
const publish = process.argv.includes('--publish');
const dist = publish ? path.resolve(root, '..') : path.join(root, 'dist');

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  legalComments: 'none',
  write: false,
  define: { __PROD__: 'true' },
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;
const hash = createHash('sha256').update(js).digest('hex').slice(0, 10);
const jsName = `app.${hash}.js`;

if (publish) {
  for (const f of await readdir(dist)) if (/^app\.[0-9a-f]+\.js$/.test(f)) await rm(path.join(dist, f));
  await rm(path.join(dist, 'assets'), { recursive: true, force: true });
} else {
  await rm(dist, { recursive: true, force: true });
}
await mkdir(dist, { recursive: true });
await writeFile(path.join(dist, jsName), js);

let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<!-- build:js -->[\s\S]*?<!-- \/build:js -->/, `<script type="module" src="${jsName}"></script>`);
await writeFile(path.join(dist, 'index.html'), html);

await cp(path.join(root, 'manifest.webmanifest'), path.join(dist, 'manifest.webmanifest'));
await cp(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });
await writeFile(path.join(dist, '.nojekyll'), '');

const assets = ['./', './index.html', `./${jsName}`, './manifest.webmanifest',
  './assets/fonts/Galmuri11.woff2', './assets/fonts/Galmuri11-Bold.woff2',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/maskable-512.png', './assets/icons/apple-touch-icon.png'];
let sw = await readFile(path.join(root, 'tools/sw-template.js'), 'utf8');
sw = sw.replace('__VERSION__', hash).replace('__ASSETS__', JSON.stringify(assets));
await writeFile(path.join(dist, 'sw.js'), sw);

console.log(`${publish ? '(저장소 루트) ' : 'dist/'}${jsName} ${(js.length / 1024).toFixed(0)} KB`);
console.log('dist/ 준비 완료. 미리보기: npm run preview');
