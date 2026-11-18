// 화면 UI: HUD, 입력(드래그/버튼/키보드), 미니맵, 무전 메시지, 타이틀·결과 화면
import * as THREE from 'three';
import { DIFFICULTY, W, D, H, PALETTE } from './config.js';

const $ = (id) => document.getElementById(id);
const RING = 2 * Math.PI * 54;
const IDS = ['hud', 'hpAlly', 'hpAllyNum', 'hpEnemy', 'hpEnemyNum', 'turnLabel', 'windArrow', 'windText', 'timer', 'radio',
  'minimap', 'distText', 'azOut', 'elOut', 'prevOut', 'btnMove', 'btnBino', 'fuelBar', 'btnFire', 'ringFill', 'ringPrev',
  'powOut', 'powHint', 'hint', 'btnMute', 'floaters', 'title', 'ranks', 'btnStart', 'end', 'endEyebrow', 'endTitle',
  'endStars', 'endStats', 'btnAgain', 'btnMenu', 'guideTag'];

export const fmtAz = (az) => az.toFixed(1).padStart(5, '0') + '°';

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {};
    for (const id of IDS) this.el[id] = $(id);
    this.view = $('view');
    this.radioT = 0;
    this.floaters = [];
    this.mapImg = document.createElement('canvas');
    this.mapImg.width = W; this.mapImg.height = D;
    this.mapVersion = -1;
    this.diffKey = 'normal';
    this.bindPointer();
    this.bindButtons();
    this.bindKeys();
  }

  bindPointer() {
    const v = this.view;
    let a = null;
    v.addEventListener('pointerdown', (e) => {
      if (a) return;
      a = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
      try { v.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    });
    v.addEventListener('pointermove', (e) => {
      if (!a || e.pointerId !== a.id) return;
      const dx = e.clientX - a.x, dy = e.clientY - a.y;
      a.x = e.clientX; a.y = e.clientY;
      if (Math.abs(e.clientX - a.sx) + Math.abs(e.clientY - a.sy) > 8) a.moved = true;
      if (a.moved) this.h.onDrag(dx, dy);
    });
    v.addEventListener('pointerup', (e) => {
      if (!a || e.pointerId !== a.id) return;
      if (!a.moved && performance.now() - a.t < 450) this.h.onTap(e.clientX, e.clientY);
      a = null;
    });
    v.addEventListener('pointercancel', () => { a = null; });
    v.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  bindButtons() {
    const f = this.el.btnFire;
    f.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { f.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
      this.h.onFireDown();
    });
    f.addEventListener('pointerup', () => this.h.onFireUp());
    f.addEventListener('pointercancel', () => this.h.onFireUp());
    f.addEventListener('contextmenu', (e) => e.preventDefault());

    for (const b of document.querySelectorAll('.step')) {
      let rep = null, first = null;
      const stop = () => { clearTimeout(first); clearInterval(rep); rep = first = null; };
      const go = () => this.h.onStep(b.dataset.axis, parseFloat(b.dataset.d));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        go();
        first = setTimeout(() => { rep = setInterval(go, 60); }, 340);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.el.btnMove.addEventListener('click', () => this.h.onMove());
    this.el.btnBino.addEventListener('click', () => this.h.onBino());
    this.el.btnMute.addEventListener('click', () => this.h.onMute());
    this.el.btnStart.addEventListener('click', () => this.h.onStart(this.diffKey));
    this.el.btnAgain.addEventListener('click', () => this.h.onAgain());
    this.el.btnMenu.addEventListener('click', () => this.h.onMenu());
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
      const fine = e.shiftKey ? 0.1 : 0.5;
      if (e.key === 'ArrowLeft') this.h.onStep('az', -fine);
      else if (e.key === 'ArrowRight') this.h.onStep('az', fine);
      else if (e.key === 'ArrowUp') this.h.onStep('el', fine);
      else if (e.key === 'ArrowDown') this.h.onStep('el', -fine);
      else if (e.key === ' ') { if (!e.repeat) this.h.onFireDown(); }
      else if (e.key === 'm' || e.key === 'M') this.h.onMove();
      else if (e.key === 'b' || e.key === 'B') this.h.onBino();
      else return;
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { if (e.key === ' ') { this.h.onFireUp(); e.preventDefault(); } });
  }

  // ───────── 타이틀 / 결과 ─────────
  showTitle(diffKey, best) {
    this.diffKey = diffKey;
    this.el.title.hidden = false;
    this.el.end.hidden = true;
    this.el.hud.hidden = true;
    const r = this.el.ranks;
    r.innerHTML = '';
    Object.entries(DIFFICULTY).forEach(([key, d], i) => {
      const b = document.createElement('button');
      b.className = 'rank';
      b.id = 'rank-' + key;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', key === diffKey ? 'true' : 'false');
      const chev = '<svg viewBox="0 0 24 10" aria-hidden="true"><path d="M2 9 L12 2 L22 9"/></svg>'.repeat(i + 1);
      const stars = best[key] || 0;
      b.innerHTML = `<span class="chev">${chev}</span><span class="rank-text"><b>${d.label}</b><small>${d.desc}</small></span>`
        + `<span class="rank-best" aria-label="최고 기록 별 ${stars}개">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>`;
      b.addEventListener('click', () => {
        this.diffKey = key;
        for (const o of r.children) o.setAttribute('aria-checked', o === b ? 'true' : 'false');
        this.h.onPick?.(key);
      });
      r.appendChild(b);
    });
  }

  showHUD() {
    this.el.title.hidden = true;
    this.el.end.hidden = true;
    this.el.hud.hidden = false;
  }

  showEnd({ result, stars, stats, diffLabel }) {
    const e = this.el;
    e.end.hidden = false;
    e.hud.hidden = true;
    e.end.dataset.result = result;
    e.endEyebrow.textContent = `전투 보고서 · ${diffLabel}`;
    e.endTitle.textContent = result === 'win' ? '작전 성공' : result === 'draw' ? '동시 격파' : '작전 실패';
    e.endStars.innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
    e.endStats.innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  // ───────── HUD ─────────
  setHP(isPlayer, hp) {
    const bar = isPlayer ? this.el.hpAlly : this.el.hpEnemy;
    bar.style.width = hp + '%';
    (isPlayer ? this.el.hpAllyNum : this.el.hpEnemyNum).textContent = hp;
    bar.parentElement.classList.toggle('low', hp <= 30);
  }

  setTurn(text, mine) {
    this.el.turnLabel.textContent = text;
    this.el.hud.classList.toggle('enemy-turn', !mine);
  }

  setTimer(s) {
    const t = this.el.timer;
    t.textContent = s == null ? '' : String(Math.max(0, Math.ceil(s)));
    t.hidden = s == null;
    t.classList.toggle('urgent', s != null && s <= 5);
  }

  setWind(speed, bearing, camYaw) {
    this.el.windArrow.style.transform = `rotate(${bearing - camYaw}deg)`;
    this.el.windArrow.style.opacity = speed === 0 ? 0.25 : 1;
    this.el.windText.textContent = speed === 0 ? '무풍' : `바람 ${speed}m/s`;
  }

  setAim(az, el) {
    this.el.azOut.textContent = fmtAz(az);
    this.el.elOut.textContent = el.toFixed(1) + '°';
  }

  setPrev(p) {
    this.el.prevOut.textContent = p ? `이전 사격  ${fmtAz(p.az)} · ${p.el.toFixed(1)}° · 장약 ${Math.round(p.power)}` : '이전 사격 없음';
  }

  setPower(power, prevPower, charging) {
    this.el.ringFill.style.strokeDasharray = `${(RING * power) / 100} ${RING}`;
    this.el.powOut.textContent = charging ? String(Math.round(power)) : '발사';
    this.el.powHint.textContent = charging ? '떼면 발사' : '길게 눌러 장약';
    const rp = this.el.ringPrev;
    rp.style.display = prevPower == null ? 'none' : '';
    if (prevPower != null) rp.setAttribute('transform', `rotate(${prevPower * 3.6} 60 60)`);
    this.el.btnFire.classList.toggle('charging', charging);
  }

  setFuel(f) {
    this.el.fuelBar.style.width = Math.round(f * 100) + '%';
    this.el.btnMove.disabled = f <= 0.03;
  }

  setModes(move, bino) {
    this.el.btnMove.classList.toggle('on', move);
    this.el.btnBino.classList.toggle('on', bino);
    this.el.hud.classList.toggle('moving', move);
  }

  setControls(on) { this.el.hud.classList.toggle('locked', !on); }

  setDistance(m, dh) {
    const sign = dh > 0 ? '+' : dh < 0 ? '−' : '±';
    this.el.distText.textContent = `적까지 약 ${m}m · 고저차 ${sign}${Math.abs(dh)}m`;
  }

  setGuide(frac) {
    this.el.guideTag.textContent = frac > 0 ? `궤적 가이드 ${Math.round(frac * 100)}%` : '가이드 없음';
  }

  radio(msg, tone = 'info', secs = 4.5) {
    const r = this.el.radio;
    r.textContent = msg;
    r.dataset.tone = tone;
    r.classList.add('show');
    this.radioT = secs;
  }

  hint(text) {
    this.el.hint.hidden = !text;
    if (text) this.el.hint.textContent = text;
  }

  float(text, pos, cls) {
    const el = document.createElement('div');
    el.className = 'floater ' + (cls || '');
    el.textContent = text;
    this.el.floaters.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0 });
  }

  update(dt, camera) {
    if (this.radioT > 0) {
      this.radioT -= dt;
      if (this.radioT <= 0) this.el.radio.classList.remove('show');
    }
    const v = new THREE.Vector3(), w = window.innerWidth, h = window.innerHeight;
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      if (f.t > 1.6) { f.el.remove(); return false; }
      v.copy(f.pos); v.y += f.t * 2.2;
      v.project(camera);
      const vis = v.z < 1;
      f.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
      f.el.style.opacity = vis ? String(Math.min(1, (1.6 - f.t) * 2)) : '0';
      return true;
    });
  }

  clearFloaters() {
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
  }

  // ───────── 미니맵 ─────────
  renderTerrain(world) {
    const ctx = this.mapImg.getContext('2d');
    const img = ctx.createImageData(W, D);
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const top = world.topHeight(x, z);
      const t = world.get(x, top - 1, z);
      const hex = PALETTE[t] ?? 0x444444;
      const nw = x > 0 && z > 0 ? world.topHeight(x - 1, z - 1) : top;
      const s = Math.max(0.35, Math.min(1.5, 0.62 + (top / H) * 0.7 + (top - nw) * 0.09));
      const i = (x + z * W) * 4;
      img.data[i] = Math.min(255, ((hex >> 16) & 255) * s);
      img.data[i + 1] = Math.min(255, ((hex >> 8) & 255) * s);
      img.data[i + 2] = Math.min(255, (hex & 255) * s);
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mapVersion = world.version;
  }

  drawMinimap(world, player, enemy, aimAz, impacts) {
    if (world.version !== this.mapVersion) this.renderTerrain(world);
    const cv = this.el.minimap, ctx = cv.getContext('2d');
    const sx = cv.width / W, sz = cv.height / D;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mapImg, 0, 0, cv.width, cv.height);
    const a = (aimAz * Math.PI) / 180;
    ctx.save();
    ctx.strokeStyle = 'rgba(240, 200, 110, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(player.base.x * sx, player.base.z * sz);
    ctx.lineTo((player.base.x + Math.sin(a) * 150) * sx, (player.base.z - Math.cos(a) * 150) * sz);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 2;
    for (const im of impacts) {
      const x = im.x * sx, y = im.z * sz;
      ctx.strokeStyle = im.mine ? 'rgba(255, 236, 170, 0.9)' : 'rgba(255, 120, 90, 0.9)';
      ctx.beginPath();
      ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    }
    for (const [t, fill] of [[player, '#a9d05c'], [enemy, '#e2553a']]) {
      if (!t) continue;
      ctx.fillStyle = t.alive ? fill : '#222';
      ctx.strokeStyle = '#10120c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.base.x * sx, t.base.z * sz, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}
