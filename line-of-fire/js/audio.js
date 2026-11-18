// 효과음: 파일 없이 Web Audio로 합성 (앱 용량 절약)
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.chargeOsc = null;
    this.engine = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  noiseBurst(dur, { type = 'lowpass', f0 = 1000, f1 = 200, q = 0.7, gain = 1, attack = 0.005, delay = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const flt = c.createBiquadFilter();
    flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone(f0, f1, dur, { type = 'sine', gain = 0.5, attack = 0.005, delay = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  cannon() {
    this.noiseBurst(0.7, { f0: 2600, f1: 110, gain: 1 });
    this.tone(120, 36, 0.5, { gain: 0.9 });
    this.noiseBurst(0.09, { type: 'highpass', f0: 3200, f1: 1500, gain: 0.35 });
  }

  explosion(vol = 1) {
    vol = Math.max(0.08, Math.min(1, vol));
    this.noiseBurst(1.8, { f0: 1500, f1: 50, gain: vol, attack: 0.01 });
    this.tone(72, 26, 1.1, { gain: 0.9 * vol });
    this.noiseBurst(0.3, { type: 'bandpass', f0: 900, f1: 260, q: 1.2, gain: 0.45 * vol, delay: 0.04 });
  }

  whistle(dur) {
    this.tone(1500, 480, Math.max(0.4, dur), { gain: 0.05, attack: 0.25 });
  }

  clang() {
    this.tone(540, 500, 0.35, { type: 'square', gain: 0.07 });
    this.tone(812, 760, 0.3, { type: 'triangle', gain: 0.08 });
  }

  radio() {
    this.noiseBurst(0.16, { type: 'bandpass', f0: 1900, f1: 1700, q: 2, gain: 0.08 });
    this.tone(1180, 1180, 0.06, { type: 'square', gain: 0.035, delay: 0.02 });
    this.tone(1180, 1180, 0.06, { type: 'square', gain: 0.035, delay: 0.12 });
  }

  click() { this.tone(900, 620, 0.04, { type: 'square', gain: 0.03 }); }

  chargeStart() {
    if (!this.ctx || this.chargeOsc) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 120;
    g.gain.value = 0.025;
    o.connect(g); g.connect(this.master); o.start();
    this.chargeOsc = { o, g };
  }

  chargeSet(power) {
    if (this.chargeOsc) this.chargeOsc.o.frequency.setTargetAtTime(110 + power * 5, this.ctx.currentTime, 0.02);
  }

  chargeStop() {
    if (!this.chargeOsc) return;
    const { o, g } = this.chargeOsc;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    o.stop(this.ctx.currentTime + 0.1);
    this.chargeOsc = null;
  }

  engineOn(on) {
    if (!this.ctx) return;
    const c = this.ctx;
    if (on && !this.engine) {
      const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = 46;
      lfo.frequency.value = 11; lg.gain.value = 6;
      lfo.connect(lg); lg.connect(o.frequency);
      f.type = 'lowpass'; f.frequency.value = 380;
      g.gain.value = 0;
      g.gain.setTargetAtTime(0.12, c.currentTime, 0.1);
      o.connect(f); f.connect(g); g.connect(this.master);
      o.start(); lfo.start();
      this.engine = { o, lfo, g };
    } else if (!on && this.engine) {
      const { o, lfo, g } = this.engine;
      g.gain.setTargetAtTime(0, c.currentTime, 0.12);
      o.stop(c.currentTime + 0.6); lfo.stop(c.currentTime + 0.6);
      this.engine = null;
    }
  }

  // 나팔 소리
  victory() {
    const notes = [392, 523, 659, 784, 659, 784];
    const at = [0, 0.18, 0.36, 0.54, 0.9, 1.08];
    notes.forEach((f, i) => {
      this.tone(f, f, i === 5 ? 0.9 : 0.2, { type: 'triangle', gain: 0.18, delay: at[i] });
      this.tone(f * 2, f * 2, i === 5 ? 0.9 : 0.2, { type: 'square', gain: 0.025, delay: at[i] });
    });
  }

  defeat() {
    [392, 370, 330, 262].forEach((f, i) => this.tone(f, f * 0.98, 0.5, { type: 'triangle', gain: 0.16, delay: i * 0.45 }));
  }
}
