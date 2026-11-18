// 시작점
import { Game } from './game.js';

function fail(e) {
  console.error(e);
  const msg = document.getElementById('boot-msg');
  if (msg) msg.textContent = '시작하지 못했습니다: ' + (e && e.message ? e.message : e) + ' — WebGL을 지원하는 최신 크롬에서 열어 주세요.';
}

try {
  const game = new Game();
  game.boot().catch(fail);
} catch (e) { fail(e); }
