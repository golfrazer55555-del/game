// 게임 전체: 렌더러, 화면 전환, 현장 세션, 설정·저장
import * as THREE from 'three';
import { QUALITY } from './config.js';
import { loadPhysics } from './physics.js';
import { createVoxelMaterial } from './render.js';
import { createEnvironment } from './env.js';
import { Presenter } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { UI } from './ui.js';
import { Session } from './session.js';
import { CONTRACTS, settle } from './contracts.js';
import { BUILDINGS } from './site.js';
import { loadSave, writeSave, owns, resetSave } from './save.js';
import { isTouchDevice } from './util.js';
import { Pwa } from './pwa.js';

THREE.ColorManagement.enabled = false;

export class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.save = loadSave();
    this.audio = new Audio();
    this.audio.setVolume(this.save.settings.volume);
    this.input = new Input();
    this.ui = new UI(this);
    this.pwa = new Pwa(this);
    this.session = null;
    this.paused = false;
    this.structOn = false;
    this.frameTimes = [];
    this.autoQ = null;
  }

  get touchUI() {
    const t = this.save.settings.touch;
    return t === 'on' || (t === 'auto' && isTouchDevice());
  }

  pickQuality() {
    const q = this.save.settings.quality;
    if (q !== 'auto') return q;
    if (this.autoQ) return this.autoQ;
    const mobile = isTouchDevice();
    const mem = navigator.deviceMemory || 4;
    return mobile ? (mem >= 6 ? 'medium' : 'low') : 'high';
  }

  async boot() {
    this.ui.setBoot(0.1, '물리 엔진 준비 중…');
    await loadPhysics();
    this.ui.setBoot(0.45, '글꼴 불러오는 중…');
    try { await Promise.race([document.fonts.load('12px Galmuri11'), new Promise((r) => setTimeout(r, 2500))]); } catch { /* */ }
    this.ui.setBoot(0.6, '현장 준비 중…');
    this.qualityKey = this.pickQuality();
    this.quality = QUALITY[this.qualityKey];
    this.createRenderer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1400);
    this.rig = new CameraRig(this.camera, this.canvas);
    this.rig.shakeEnabled = this.save.settings.shake;
    this.rig.invert = this.save.settings.invertCam;
    this.rig.onTap = (x, y) => this.onTap(x, y);
    this.env = createEnvironment(this.scene, this.quality);
    this.voxMat = createVoxelMaterial();
    this.presenter = new Presenter(this.scene, this.quality);
    this.presenter.audio = this.audio;
    this.presenter.camera = this.rig;
    this.presenter.ui = this.ui;
    this.presenter.haptics = (p) => { if (this.save.settings.haptics && navigator.vibrate) try { navigator.vibrate(p); } catch { /* */ } };
    addEventListener('resize', () => this.resize());
    this.resize();
    this.input.onKey = (k) => this.onKey(k);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.session && !this.session.demo && this.ui.screen === 'play') this.pause(true); });
    // 첫 터치에서 소리 시작 (브라우저 정책)
    const unlock = () => { this.audio.init(); this.pwa.enterImmersive(); };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
    this.ui.setBoot(0.8, '현장 준비 중…');
    this.startDemo();
    this.ui.setBoot(1, '');
    this.ui.show('title');
    this.checkOrientation();
    addEventListener('orientationchange', () => setTimeout(() => this.checkOrientation(), 200));
    addEventListener('resize', () => this.checkOrientation());
    this.last = performance.now();
    this.hudT = 0;
    const loop = (t) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    window.__game = this;
  }

  createRenderer() {
    const q = this.quality;
    if (this.renderer) { this.renderer.dispose(); }
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q.antialias, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.pixelRatio));
  }

  resize() {
    if (!this.renderer) return;
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  checkOrientation() {
    const portrait = innerHeight > innerWidth * 1.05;
    document.getElementById('rotate').hidden = !(portrait && isTouchDevice());
  }

  // ───── 세션 ─────
  startDemo() {
    this.endSession();
    const c = { id: 'demo', title: '', building: 'warehouse', machines: ['crane'], goals: [{ k: 'demolish', v: 1 }], time: 9999, fee: 0, cars: 3 };
    this.session = new Session(this, c, { demo: true, seed: 3 });
    this.rig.setMode('follow');
    this.rig.yaw = -0.5; this.rig.pitch = 0.3; this.rig.dist = 30;
    this.ui.hideHUD();
  }

  startContract(c) {
    this.endSession();
    this.ui.hideAllScreens();
    this.session = new Session(this, c, {});
    this.afterStart();
    this.ui.toast(`${c.client} 의뢰: ${c.title}`, 'tip');
  }

  startFree(building) {
    this.endSession();
    this.ui.hideAllScreens();
    const B = BUILDINGS[building];
    const c = { id: 'free-' + building, title: `자유 철거 · ${B.name}`, building, machines: ['crane', 'excavator', 'blast'], goals: [{ k: 'demolish', v: 0.9 }], time: 99999, fee: 0, cars: 4, truck: true };
    this.session = new Session(this, c, { free: true });
    this.afterStart();
  }

  afterStart() {
    const s = this.session;
    this.paused = false;
    this.structOn = false;
    this.rig.setMode(s.activeKind === 'blast' ? 'site' : 'follow');
    this.rig.yaw = 0.55; this.rig.pitch = 0.42; this.rig.dist = s.activeKind === 'blast' ? 52 : 26;
    this.ui.setupHUD(s);
    s.selectMachine(s.activeKind);
    this.ui.setStructButton(false);
    this.input.zero();
  }

  endSession() {
    if (this.session) { this.session.dispose(); this.session = null; }
    this.audio.setSiren(false); this.audio.setAlarm(false); this.audio.setEngine(false); this.audio.setWinch(0); this.audio.setHydraulic(0); this.audio.setRumble(0);
    this.ui.setCount(null);
  }

  restart() {
    const s = this.session;
    if (!s) return;
    if (s.free) this.startFree(s.contract.building); else this.startContract(s.contract);
  }

  quit(to = 'board') {
    this.paused = false;
    this.startDemo();
    this.ui.show(to);
  }

  pause(on) {
    if (!this.session || this.session.demo) return;
    this.paused = on;
    this.input.zero();
    if (on) this.ui.show('pause'); else this.ui.hideAllScreens();
  }

  finish() {
    const s = this.session;
    if (!s || s.demo) return;
    const r = settle(s);
    s.finished = true;
    if (!s.free) {
      const c = s.contract;
      this.save.money += r.profit;
      this.save.stars[c.id] = Math.max(this.save.stars[c.id] || 0, r.stars);
      this.save.stats.contracts++;
    }
    this.save.stats.blocks += s.blocksBroken();
    writeSave(this.save);
    this.paused = true;
    this.ui.showResult(s, r);
  }

  replay() {
    const s = this.session;
    if (!s || !s.blastSnap) return;
    if (s.activeKind !== 'blast') s.selectMachine('blast');
    s.startReplay();
  }

  selectMachine(m) { if (this.session) { this.audio.ui(); this.session.selectMachine(m); } }
  setAttachment(t) { if (this.session) { this.audio.ui(); this.session.setAttachment(t); } }
  blastAction(a) { if (this.session) { this.audio.ui(); this.session.blastAction(a); } }
  hasBigCharge() { return owns(this.save, 'bigcharge'); }

  cycleCamera() {
    const s = this.session;
    if (!s) return;
    const order = s.activeKind === 'blast' ? ['site'] : ['follow', 'cab', 'site'];
    const cur = this.rig.mode === 'cine' ? 'site' : this.rig.mode;
    const next = order[(order.indexOf(cur) + 1) % order.length];
    this.rig.setMode(next);
    this.ui.toast({ follow: '카메라: 장비 따라가기', cab: '카메라: 운전석 시점', site: '카메라: 현장 전체' }[next], '', 1200);
  }

  toggleStruct() {
    const s = this.session;
    if (!s) return;
    this.structOn = !this.structOn;
    s.structGroup.visible = this.structOn;
    s.structVersion = null;
    this.ui.setStructButton(this.structOn);
  }

  buy(u) {
    if (this.save.money < u.price || owns(this.save, u.id)) return;
    this.save.money -= u.price;
    this.save.owned.push(u.id);
    writeSave(this.save);
    this.audio.ui();
  }

  setSetting(k, v) {
    this.save.settings[k] = v;
    writeSave(this.save);
    if (k === 'volume') this.audio.setVolume(v);
    if (k === 'shake') this.rig.shakeEnabled = v;
    if (k === 'invertCam') this.rig.invert = v;
    if (k === 'touch') this.ui.applyTouchVisibility();
    if (k === 'quality') { this.autoQ = null; this.applyQuality(this.pickQuality()); }
  }

  applyQuality(key) {
    if (key === this.qualityKey) return;
    this.qualityKey = key;
    this.quality = QUALITY[key];
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.quality.pixelRatio));
    this.resize();
    this.env.sun.castShadow = this.quality.shadows;
    if (this.env.sun.shadow.map) { this.env.sun.shadow.map.dispose(); this.env.sun.shadow.map = null; }
    this.env.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    this.presenter.setQuality(this.quality);
    if (this.session) { this.session.chunkView.setShadows(this.quality.shadows); this.session.bodyView.shadows = this.quality.shadows; }
    this.voxMat.needsUpdate = true;
  }

  resetProgress() { this.save = resetSave(); writeSave(this.save); }

  // ───── 입력 ─────
  onKey(k) {
    const s = this.session;
    if (!s || s.demo) return;
    if (k === 'Escape') { if (this.ui.screen === 'play') this.pause(true); else if (this.ui.screen === 'pause') this.pause(false); return; }
    if (this.ui.screen !== 'play') return;
    if (k === 'KeyC') this.cycleCamera();
    else if (k === 'KeyV') this.toggleStruct();
    else if (k === 'KeyH') this.ui.openHelp('play');
    else if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { const m = s.available[+k.slice(-1) - 1]; if (m) this.selectMachine(m); }
    else if (k === 'BracketLeft' || k === 'BracketRight') { const i = s.available.indexOf(s.activeKind); const n = s.available.length; this.selectMachine(s.available[(i + (k === 'BracketRight' ? 1 : n - 1)) % n]); }
    else if ((k === 'KeyQ' || k === 'KeyE') && s.activeKind === 'excavator') {
      const order = ['crusher', 'breaker', 'bucket'];
      const i = order.indexOf(s.machines.excavator.s.att_type);
      this.setAttachment(order[(i + (k === 'KeyE' ? 1 : 2)) % 3]);
    } else if (s.activeKind === 'blast') {
      if (k === 'Delete' || k === 'Backspace') this.blastAction('del');
      else if (k === 'Enter') this.blastAction(s.explosives.state === 'plan' ? 'fire' : s.explosives.state === 'done' ? 'again' : 'cancel');
    }
  }

  onTap(x, y) {
    const s = this.session;
    if (!s || s.demo || this.ui.screen !== 'play') return;
    const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    s.tapWorld(rc.ray);
  }

  // ───── 프레임 ─────
  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const s = this.session;
    this.input.update(this.save.settings.iso);
    this.input.enabled = this.ui.screen === 'play' && !this.paused;
    if (s) {
      if (!this.paused || s.demo) s.update(dt);
      else this.input.clearEdges();
      this.presenter.consume(s.sim);
      this.presenter.update(s.sim, this.paused && !s.demo ? 0 : dt * s.timeScale);
      s.sync(t / 1000, this.quality.meshBudgetMs);
      // 장비 소리
      const mc = s.active;
      if (mc && !s.demo && !this.paused) {
        this.audio.setEngine(true, mc.s.engine, Math.min(1, mc.s.engine));
        if (mc.kind === 'crane') { this.audio.setWinch(mc.s.ropeVel / 3); this.audio.setAlarm(mc.s.lmi > 0.92); this.audio.setHydraulic(Math.min(1, Math.abs(mc.s.slewVel) * 2 + Math.abs(mc.s.luffVel) * 8)); }
        else { this.audio.setWinch(0); this.audio.setAlarm(false); this.audio.setHydraulic(Math.min(1, Math.abs(mc.s.boomV) * 3 + Math.abs(mc.s.armV) * 3 + Math.abs(mc.s.attV) * 2 + Math.abs(mc.s.swingV))); }
      } else if (!s.demo) { this.audio.setEngine(false); this.audio.setWinch(0); this.audio.setAlarm(false); this.audio.setHydraulic(0); }
      const cab = s.active ? () => s.active.cabView() : null;
      if (s.demo) this.rig.yaw += dt * 0.04;
      this.rig.update(dt, s.focusPoint(), cab);
      this.hudT -= dt;
      if (this.hudT <= 0 && !s.demo && this.ui.screen === 'play') {
        this.hudT = 0.12;
        this.ui.updateHUD(s, s.measure());
      }
    }
    this.audio.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.trackPerf(dt);
  }

  // 자동 품질: 계속 느리면 한 단계 낮춘다
  trackPerf(dt) {
    if (this.save.settings.quality !== 'auto') return;
    const f = this.frameTimes;
    f.push(dt);
    if (f.length < 150) return;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    if (avg > 0.034) {
      const next = this.qualityKey === 'high' ? 'medium' : this.qualityKey === 'medium' ? 'low' : null;
      if (next) { this.autoQ = next; this.applyQuality(next); }
    }
  }
}

export { CONTRACTS };
