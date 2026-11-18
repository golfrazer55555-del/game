// 조작 입력 통합: 키보드, 가상 조이스틱(터치), 게임패드 → 두 개의 레버(lx,ly / rx,ry)와 버튼
export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { lx: 0, ly: 0, rx: 0, ry: 0, a: false, b: false };
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, a: false, b: false };
    this.edges = new Set();     // 이번 프레임에 눌린 버튼 (한 번만 처리)
    this.state = { lx: 0, ly: 0, rx: 0, ry: 0, a: false, b: false, travelToggle: false, iso: false };
    this.enabled = true;
    this.padPrev = [];
    this.onKey = null;
    addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) { this.edges.add(k); if (this.onKey) this.onKey(k, e); }
      this.keys.add(k);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  key(k) { return this.keys.has(k); }
  axis(neg, pos) { return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0); }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const g = pads && [...pads].find((p) => p && p.connected);
    const P = this.pad;
    if (!g) { P.lx = P.ly = P.rx = P.ry = 0; P.a = P.b = false; return; }
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : (v - Math.sign(v) * 0.14) / 0.86);
    P.lx = dz(g.axes[0] || 0); P.ly = -dz(g.axes[1] || 0); P.rx = dz(g.axes[2] || 0); P.ry = -dz(g.axes[3] || 0);
    const btn = (i) => !!(g.buttons[i] && g.buttons[i].pressed);
    P.a = btn(0) || btn(7); P.b = btn(1);
    // 버튼 → 키처럼 한 번씩 (X: 주행, Y: 카메라, LB/RB: 장비, Start: 일시정지)
    const map = { 2: 'KeyR', 3: 'KeyC', 4: 'BracketLeft', 5: 'BracketRight', 9: 'Escape', 12: 'KeyV', 6: 'KeyF' };
    for (const [i, code] of Object.entries(map)) {
      const now = btn(+i);
      if (now && !this.padPrev[i]) { this.edges.add(code); if (this.onKey) this.onKey(code, null); }
      this.padPrev[i] = now;
    }
  }

  // 프레임마다 한 번: 모든 입력을 합친다
  update(iso) {
    this.pollGamepad();
    const s = this.state;
    const kb = {
      lx: this.axis('KeyA', 'KeyD'), ly: this.axis('KeyS', 'KeyW'),
      rx: this.axis('ArrowLeft', 'ArrowRight'), ry: this.axis('ArrowDown', 'ArrowUp'),
    };
    // Shift를 누르면 레버를 반만 (미세 조작)
    const fine = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 0.35 : 1;
    const c = (v) => Math.max(-1, Math.min(1, v));
    s.lx = c(kb.lx * fine + this.touch.lx + this.pad.lx);
    s.ly = c(kb.ly * fine + this.touch.ly + this.pad.ly);
    s.rx = c(kb.rx * fine + this.touch.rx + this.pad.rx);
    s.ry = c(kb.ry * fine + this.touch.ry + this.pad.ry);
    s.a = this.keys.has('Space') || this.touch.a || this.pad.a;
    s.b = this.touch.b || this.pad.b;
    s.iso = iso;
    if (!this.enabled) { s.lx = s.ly = s.rx = s.ry = 0; s.a = s.b = false; }
  }

  takeEdge(code) { if (this.edges.has(code)) { this.edges.delete(code); return true; } return false; }
  clearEdges() { this.edges.clear(); }
  zero() { this.touch.lx = this.touch.ly = this.touch.rx = this.touch.ry = 0; this.touch.a = this.touch.b = false; this.keys.clear(); }
}
