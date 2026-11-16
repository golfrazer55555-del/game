// 모든 코드를 HTML 한 파일에 담은 배포본을 만든다.
//   npm run build          → dist/index.html  (그대로 열거나 웹 게임 포털·앱 포장에 사용)
//   npm run build:embed    → dist/embed.html  (<html>/<head>/<body> 없이 본문만. 페이지를 대신 감싸 주는 호스팅용)
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const embed = process.argv.includes('--embed');

const result = await build({
  entryPoints: [path.join(root, 'js/main.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  write: false,
  alias: { three: path.join(root, 'js/lib/three.module.min.js') },
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<!-- build:js -->[\s\S]*?<!-- \/build:js -->/, () => `<script>${js}</script>`);
if (embed) {
  html = html
    .replace(/<!-- build:strip -->[\s\S]*?<!-- \/build:strip -->\n?/, '')
    .replace(/<!doctype html>\n?/i, '')
    .replace(/<\/?html[^>]*>\n?/g, '')
    .replace(/<\/?head>\n?/g, '')
    .replace(/<\/?body>\n?/g, '');
}

await mkdir(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', embed ? 'embed.html' : 'index.html');
await writeFile(out, html);
console.log(`${path.relative(root, out)} (${Math.round(html.length / 1024)} KB)`);
