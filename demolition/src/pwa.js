// 설치형 웹앱(PWA): 서비스 워커 등록, 크롬 설치 버튼, 전체 화면·가로 고정
/* global __PROD__ */
export class Pwa {
  constructor(game) {
    this.g = game;
    this.deferred = null;
    this.immersiveTried = false;
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.deferred = e; this.refreshButton(); });
    addEventListener('appinstalled', () => { this.deferred = null; this.refreshButton(); game.ui.toast('설치 완료! 홈 화면이나 앱 목록에서 실행하세요', 'good', 4000); });
    this.register();
  }

  get standalone() {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  }
  get ios() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

  register() {
    const prod = typeof __PROD__ !== 'undefined' && __PROD__;
    if (!prod || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시 없이 동작 */ }));
  }

  refreshButton() {
    const btn = document.getElementById('btn-install'), tip = document.getElementById('install-tip');
    if (!btn) return;
    btn.hidden = !this.deferred || this.standalone;
    if (!this.standalone && !this.deferred && this.ios) {
      tip.hidden = false;
      tip.textContent = '아이폰·아이패드: Safari 공유 버튼 → "홈 화면에 추가"로 설치할 수 있어요.';
    } else tip.hidden = true;
  }

  async install() {
    if (!this.deferred) return;
    this.deferred.prompt();
    try { await this.deferred.userChoice; } catch { /* */ }
    this.deferred = null;
    this.refreshButton();
  }

  // 휴대폰 브라우저에서 처음 터치하면 전체 화면 + 가로 고정 시도
  enterImmersive() {
    if (this.immersiveTried || this.standalone) return;
    if (!matchMedia('(pointer: coarse)').matches) return;
    this.immersiveTried = true;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    Promise.resolve(req.call(el, { navigationUI: 'hide' }))
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'))
      .catch(() => { /* 지원하지 않으면 그냥 진행 */ });
  }
}
