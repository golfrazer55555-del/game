// 효과음: 음원 파일 없이 Web Audio로 합성한다 (설치 용량 절약, 오프라인 동작)
import { CLS } from './materials.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.last = {};
    this.loops = {};
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp);
    comp.connect(c.destination);
    // 야외 반향 (폭발·붕괴용)
    this.verb = c.createConvolver();
    const len = c.sampleRate * 1.8, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.verb.buffer = ir;
    this.verbSend = c.createGain(); this.verbSend.gain.value = 0.22;
    this.verbSend.connect(this.verb); this.verb.connect(this.master);
    const nlen = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, nlen, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    // 갈색 잡음 (굉음용)
    this.brownBuf = c.createBuffer(1, nlen, c.sampleRate);
    const bd = this.brownBuf.getChannelData(0);
    let l = 0;
    for (let i = 0; i < nlen; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = l * 3.5; }
    this.startLoops();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.volume; }

  ok(key, gap) {
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    if (this.last[key] && t - this.last[key] < gap) return false;
    this.last[key] = t;
    return true;
  }

  out(pan = 0, verb = 0) {
    const c = this.ctx;
    const p = c.createStereoPanner ? c.createStereoPanner() : c.createGain();
    if (p.pan) p.pan.value = Math.max(-1, Math.min(1, pan * 0.8));
    p.connect(this.master);
    if (verb) { const s = c.createGain(); s.gain.value = verb; p.connect(s); s.connect(this.verbSend); }
    return p;
  }

  noise(dur, { type = 'lowpass', f0 = 1000, f1 = 200, q = 0.8, gain = 0.5, attack = 0.004, delay = 0, pan = 0, verb = 0, brown = false } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = brown ? this.brownBuf : this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out(pan, verb));
    src.start(t, Math.random() * 1.2, dur + 0.05);
  }

  tone(f0, f1, dur, { type = 'sine', gain = 0.3, attack = 0.005, delay = 0, pan = 0, verb = 0 } = {}) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out(pan, verb));
    o.start(t); o.stop(t + dur + 0.05);
  }

  att(dist) { return Math.max(0.12, Math.min(1, 14 / (dist + 6))); }

  // ───── 파괴음 ─────
  breakSound(cls, vol, pan, dist, mode) {
    if (!this.ok('break', 0.035)) return;
    const a = vol * this.att(dist);
    const total = cls.reduce((s, v) => s + v, 0) || 1;
    const w = (k) => cls[k] / total;
    if (w(CLS.concrete) > 0.15) {
      this.noise(0.35 + a * 0.3, { f0: 900, f1: 160, gain: 0.5 * a * (0.5 + w(CLS.concrete)), pan });
      for (let i = 0; i < 4; i++) this.noise(0.05, { type: 'bandpass', f0: 1800 + Math.random() * 2500, f1: 900, q: 2, gain: 0.18 * a, delay: Math.random() * 0.22, pan });
    }
    if (w(CLS.brick) > 0.15) {
      this.noise(0.4, { type: 'bandpass', f0: 1300, f1: 400, q: 0.9, gain: 0.45 * a * (0.5 + w(CLS.brick)), pan });
      for (let i = 0; i < 5; i++) this.noise(0.04, { type: 'bandpass', f0: 2200 + Math.random() * 2000, f1: 1200, q: 3, gain: 0.15 * a, delay: Math.random() * 0.3, pan });
    }
    if (w(CLS.wood) > 0.1) {
      this.noise(0.18, { type: 'bandpass', f0: 1600, f1: 500, q: 1.5, gain: 0.4 * a, pan });
      this.tone(210, 120, 0.12, { type: 'triangle', gain: 0.25 * a, pan });
    }
    if (w(CLS.glass) > 0.05 && this.ok('glass', 0.06)) {
      this.noise(0.3, { type: 'highpass', f0: 4200, f1: 2500, gain: 0.35 * a, pan });
      for (let i = 0; i < 7; i++) this.tone(2600 + Math.random() * 3800, 2400, 0.12 + Math.random() * 0.2, { gain: 0.07 * a, delay: Math.random() * 0.25, pan });
    }
    if (w(CLS.metal) > 0.1 && this.ok('metal', 0.08)) {
      const f = 280 + Math.random() * 80;
      for (const m of [1, 2.41, 3.93]) this.tone(f * m, f * m * 0.97, 0.7, { type: 'sine', gain: 0.12 * a / m, pan });
    }
    if (mode === 'blast' || mode === 'fail') this.noise(0.8, { f0: 400, f1: 60, gain: 0.35 * a, pan, brown: true, verb: 0.4 });
  }

  thud(i, pan, dist) {
    if (!this.ok('thud', 0.05)) return;
    const a = (0.3 + i * 0.7) * this.att(dist);
    this.tone(70, 32, 0.45, { gain: 0.55 * a, pan });
    this.noise(0.5, { f0: 500, f1: 70, gain: 0.45 * a, pan, brown: true, verb: 0.3 });
  }

  ballHit(E, cls, pan, dist) {
    const i = Math.min(1, E / 200000);
    this.thud(i, pan, dist);
    if (cls === CLS.metal && this.ok('clang', 0.1)) for (const m of [1, 2.7, 4.2]) this.tone(190 * m, 185 * m, 1.1, { gain: 0.14 * this.att(dist) / m, pan });
  }

  crack(i, pan = 0) {
    if (!this.ok('crack', 0.07)) return;
    this.noise(0.09, { type: 'highpass', f0: 2600, f1: 1200, gain: 0.5 * i, pan });
    this.tone(95, 38, 0.55, { gain: 0.45 * i, pan, verb: 0.3 });
    this.noise(0.6, { f0: 700, f1: 90, gain: 0.3 * i, pan, brown: true });
  }

  collapse(i) {
    if (!this.ok('collapse', 0.4)) return;
    this.crack(0.6 + i * 0.4);
    this.noise(2.6 + i * 2, { f0: 600, f1: 50, gain: 0.5 + i * 0.4, attack: 0.08, brown: true, verb: 0.5 });
  }

  creak(i) {
    if (!this.ok('creak', 0.5)) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f = 70 + Math.random() * 50;
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * (1.2 + Math.random() * 0.4), t + 0.7);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(500, t); bp.frequency.linearRampToValueAtTime(900, t + 0.7);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * (0.3 + i), t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(bp); bp.connect(g); g.connect(this.out(0, 0.3));
    o.start(t); o.stop(t + 0.85);
    if (i > 0.5) this.noise(0.25, { type: 'bandpass', f0: 2000, f1: 900, q: 1.2, gain: 0.08, delay: 0.3 });
  }

  explosion(i, pan, dist) {
    if (!this.ok('boom', 0.06)) return;
    const a = (0.5 + 0.5 * i) * Math.max(0.35, this.att(dist));
    this.noise(0.12, { type: 'highpass', f0: 3000, f1: 1500, gain: 0.6 * a, pan });
    this.noise(1.8, { f0: 3200, f1: 90, gain: 0.9 * a, attack: 0.003, pan, verb: 0.6 });
    this.tone(80, 26, 1.4, { gain: 0.8 * a, pan });
    this.noise(1.2, { f0: 800, f1: 60, gain: 0.4 * a, delay: 0.35, brown: true, pan: -pan, verb: 0.5 });
  }

  crunch(v, pan) {
    if (!this.ok('crunch', 0.09)) return;
    this.noise(0.16, { type: 'bandpass', f0: 700, f1: 300, q: 1.1, gain: 0.35 * v, pan });
    for (let i = 0; i < 3; i++) this.noise(0.03, { type: 'bandpass', f0: 2500 + Math.random() * 2000, f1: 1500, q: 3, gain: 0.12 * v, delay: Math.random() * 0.12, pan });
  }

  hammer(pan, hit) {
    if (!this.ok('hammer', 0.05)) return;
    this.noise(0.035, { type: 'bandpass', f0: 3200, f1: 2000, q: 4, gain: 0.3, pan });
    this.tone(150, 80, 0.08, { type: 'square', gain: hit ? 0.2 : 0.08, pan });
    if (hit) this.noise(0.12, { f0: 900, f1: 200, gain: 0.25, pan });
  }

  dump(n) {
    if (!this.ok('dump', 0.3)) return;
    for (let i = 0; i < Math.min(14, 4 + n / 20); i++) this.noise(0.05, { type: 'bandpass', f0: 900 + Math.random() * 1600, f1: 600, q: 2, gain: 0.18, delay: Math.random() * 0.7 });
    this.noise(0.7, { f0: 500, f1: 120, gain: 0.25, brown: true });
  }

  beep(f = 880, dur = 0.12, gain = 0.25) { if (this.ctx) this.tone(f, f, dur, { type: 'square', gain, attack: 0.002 }); }
  ui() { if (this.ctx && this.ok('ui', 0.03)) this.tone(1400, 1100, 0.04, { type: 'square', gain: 0.06, attack: 0.001 }); }

  // ───── 지속음: 굉음, 엔진, 유압, 윈치, 사이렌, 경보 ─────
  startLoops() {
    const c = this.ctx;
    const loopNoise = (brown, type, freq, q) => {
      const src = c.createBufferSource(); src.buffer = brown ? this.brownBuf : this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return { src, f, g };
    };
    this.loops.rumble = loopNoise(true, 'lowpass', 220, 0.7);
    // 디젤 엔진
    const eo = c.createOscillator(); eo.type = 'sawtooth'; eo.frequency.value = 36;
    const eo2 = c.createOscillator(); eo2.type = 'square'; eo2.frequency.value = 72;
    const ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 320; ef.Q.value = 2;
    const eg = c.createGain(); eg.gain.value = 0;
    const eg2 = c.createGain(); eg2.gain.value = 0.35;
    eo.connect(ef); eo2.connect(eg2); eg2.connect(ef); ef.connect(eg); eg.connect(this.master);
    eo.start(); eo2.start();
    this.loops.engine = { o: eo, o2: eo2, f: ef, g: eg };
    this.loops.hyd = loopNoise(false, 'bandpass', 950, 4);
    const wo = c.createOscillator(); wo.type = 'sawtooth'; wo.frequency.value = 200;
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 600; wf.Q.value = 2;
    const wg = c.createGain(); wg.gain.value = 0;
    wo.connect(wf); wf.connect(wg); wg.connect(this.master); wo.start();
    this.loops.winch = { o: wo, f: wf, g: wg };
    const so = c.createOscillator(); so.type = 'sine'; so.frequency.value = 700;
    const sg = c.createGain(); sg.gain.value = 0;
    so.connect(sg); sg.connect(this.master); so.start();
    this.loops.siren = { o: so, g: sg, on: false, t: 0 };
    this.loops.alarm = { on: false, t: 0 };
  }

  set(param, v, k = 0.08) { if (this.ctx) param.setTargetAtTime(v, this.ctx.currentTime, k); }
  setRumble(level) { if (this.loops.rumble) { this.set(this.loops.rumble.g.gain, level * 0.9, 0.2); this.set(this.loops.rumble.f.frequency, 120 + level * 260, 0.3); } }
  setEngine(on, rpm = 0.3, load = 0) {
    const e = this.loops.engine; if (!e) return;
    this.set(e.g.gain, on ? 0.05 + load * 0.08 : 0, 0.15);
    this.set(e.o.frequency, 30 + rpm * 34, 0.2); this.set(e.o2.frequency, 60 + rpm * 68, 0.2);
    this.set(e.f.frequency, 260 + load * 700, 0.2);
  }
  setHydraulic(level) { const h = this.loops.hyd; if (h) { this.set(h.g.gain, level * 0.07, 0.06); this.set(h.f.frequency, 800 + level * 600, 0.1); } }
  setWinch(speed) { const w = this.loops.winch; if (w) { const s = Math.min(1, Math.abs(speed)); this.set(w.g.gain, s * 0.06, 0.05); this.set(w.o.frequency, 150 + s * 320, 0.05); } }
  setSiren(on) { if (this.loops.siren) this.loops.siren.on = on; }
  setAlarm(on) { if (this.loops.alarm) this.loops.alarm.on = on; }

  update(dt) {
    if (!this.ctx) return;
    const s = this.loops.siren;
    if (s) {
      s.t += dt;
      if (s.on) { this.set(s.g.gain, 0.09, 0.05); this.set(s.o.frequency, 650 + 450 * (0.5 + 0.5 * Math.sin(s.t * 3.4)), 0.05); }
      else this.set(s.g.gain, 0, 0.05);
    }
    const a = this.loops.alarm;
    if (a && a.on) { a.t -= dt; if (a.t <= 0) { a.t = 0.32; this.beep(2300, 0.14, 0.08); } }
  }
}
