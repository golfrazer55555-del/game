// 화면(DOM) 제어: 메뉴, HUD, 가상 조이스틱, 발파 패널, 정산
import { won } from './config.js';
import { CONTRACTS, FREE_SITES, goalText, goalValue, goalMet } from './contracts.js';
import { BUILDINGS } from './site.js';
import { UPGRADES, owns } from './save.js';
import { CHARGES, DELAYS, DELAY_COLORS } from './machines/explosives.js';
import { formatTime } from './util.js';

const $ = (id) => document.getElementById(id);

// 픽셀 아이콘
const ICONS = {
  pause: ['............', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '..###..###..', '............', '............'],
  cam: ['............', '....####....', '.##########.', '.#........#.', '.#..####..#.', '.#.#....#.#.', '.#.#....#.#.', '.#..####..#.', '.#........#.', '.##########.', '............', '............'],
  struct: ['............', '...######...', '...#.##.#...', '...######...', '...#.##.#...', '...######...', '...#.##.#...', '...######...', '..########..', '.##########.', '............', '............'],
  help: ['....####....', '...##..##...', '.......##...', '......##....', '.....##.....', '.....##.....', '............', '.....##.....', '.....##.....', '............', '............', '............'],
  crane: ['..........##', '.........##.', '........##.#', '.......##..#', '......##...#', '.....##....#', '....##.....#', '...##.....###', '.####.....###', '.####.......', '######......', '######......'],
  excavator: ['......####..', '.....##..##.', '....##....#.', '...##.....##', '..##......##', '.###......#.', '#####.......', '######......', '############', '#..........#', '############', '.#.#.#.#.#..'],
  blast: ['.......#....', '......#.#...', '.....#......', '....##......', '...####.....', '..######....', '..######....', '..######....', '..######....', '..######....', '..######....', '............'],
};
function icon(name, color = 'currentColor') {
  const rows = ICONS[name];
  let r = '';
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; });
  return `<svg viewBox="0 0 12 12" fill="${color}" aria-hidden="true">${r}</svg>`;
}

const MACHINE_NAMES = { crane: '크레인', excavator: '굴착기', blast: '발파' };

export class UI {
  constructor(game) {
    this.g = game;
    this.screen = 'boot';
    this.toastsEl = $('toasts');
    this.lastToast = {};
    this.bind();
  }

  // ───────────── 화면 전환 ─────────────
  show(id) {
    for (const s of ['boot', 'title', 'board', 'brief', 'free', 'garage', 'settings', 'pause', 'result', 'help']) $(s).hidden = s !== id;
    this.screen = id;
    if (id === 'title') this.renderTitle();
    if (id === 'board') this.renderBoard();
    if (id === 'free') this.renderFree();
    if (id === 'garage') this.renderGarage();
    if (id === 'settings') this.renderSettings();
  }
  hideAllScreens() { for (const s of ['boot', 'title', 'board', 'brief', 'free', 'garage', 'settings', 'pause', 'result', 'help']) $(s).hidden = true; this.screen = 'play'; }
  setBoot(p, msg) { $('boot-bar').style.width = Math.round(p * 100) + '%'; if (msg) $('boot-msg').textContent = msg; }

  bind() {
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { this.g.audio.ui(); this.show(b.dataset.go); }));
    $('brief-go').addEventListener('click', () => { this.g.audio.ui(); this.g.startContract(this.briefContract); });
    $('btn-install').addEventListener('click', () => this.g.pwa.install());
    $('settings-back').addEventListener('click', () => { this.g.audio.ui(); this.show(this.settingsReturn || 'title'); });
    // HUD 버튼
    $('btn-pause').innerHTML = icon('pause'); $('btn-cam').innerHTML = icon('cam'); $('btn-struct').innerHTML = icon('struct'); $('btn-help').innerHTML = icon('help');
    $('btn-pause').addEventListener('click', () => this.g.pause(true));
    $('btn-cam').addEventListener('click', () => this.g.cycleCamera());
    $('btn-struct').addEventListener('click', () => this.g.toggleStruct());
    $('btn-help').addEventListener('click', () => this.openHelp('play'));
    $('btn-finish').addEventListener('click', () => this.g.finish());
    $('pause-resume').addEventListener('click', () => this.g.pause(false));
    $('pause-help').addEventListener('click', () => this.openHelp('pause'));
    $('pause-settings').addEventListener('click', () => { this.settingsReturn = 'pause'; this.show('settings'); });
    $('pause-restart').addEventListener('click', () => this.g.restart());
    $('pause-quit').addEventListener('click', () => this.g.quit());
    $('help-close').addEventListener('click', () => { if (this.helpReturn === 'play') { this.hideAllScreens(); this.g.paused = false; } else this.show(this.helpReturn); });
    $('res-retry').addEventListener('click', () => this.g.restart());
    $('res-next').addEventListener('click', () => this.g.quit(this.g.session && this.g.session.free ? 'free' : 'board'));
    $('res-keep').addEventListener('click', () => { this.hideAllScreens(); this.g.paused = false; });
    $('res-replay').addEventListener('click', () => { this.hideAllScreens(); this.g.paused = false; this.g.replay(); });
    this.bindStick($('stick-l'), 'l');
    this.bindStick($('stick-r'), 'r');
    const a = $('btn-a');
    const setA = (v) => { this.g.input.touch.a = v; a.classList.toggle('held', v); };
    a.addEventListener('pointerdown', (e) => { e.preventDefault(); try { a.setPointerCapture(e.pointerId); } catch { /* */ } setA(true); });
    a.addEventListener('pointerup', () => setA(false));
    a.addEventListener('pointercancel', () => setA(false));
    $('btn-travel').addEventListener('click', () => this.g.input.edges.add('KeyR'));
  }

  bindStick(el, side) {
    const knob = el.querySelector('.knob');
    let id = null;
    const set = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width * 0.42;
      let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const T = this.g.input.touch;
      T[side + 'x'] = dz(dx); T[side + 'y'] = -dz(dy);
    };
    const reset = () => { id = null; knob.style.transform = ''; const T = this.g.input.touch; T[side + 'x'] = 0; T[side + 'y'] = 0; };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; try { el.setPointerCapture(id); } catch { /* */ } set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    el.addEventListener('pointerup', (e) => { if (e.pointerId === id) reset(); });
    el.addEventListener('pointercancel', reset);
  }

  // ───────────── 타이틀 / 목록 ─────────────
  renderTitle() {
    const s = this.g.save;
    $('title-money').textContent = won(s.money);
    const st = Object.values(s.stars).reduce((a, b) => a + b, 0);
    $('title-stars').textContent = `★ ${st} / ${CONTRACTS.length * 3}`;
    this.g.pwa.refreshButton();
  }

  starStr(n) { return '★'.repeat(n) + `<span class="off">${'★'.repeat(3 - n)}</span>`; }

  renderBoard() {
    const s = this.g.save;
    $('board-money').textContent = won(s.money);
    const wrap = $('board-cards');
    wrap.innerHTML = '';
    CONTRACTS.forEach((c, k) => {
      const unlocked = k === 0 || (s.stars[CONTRACTS[k - 1].id] || 0) > 0;
      const b = document.createElement('button');
      b.className = 'card';
      b.disabled = !unlocked;
      const B = BUILDINGS[c.building];
      b.innerHTML = `<div class="row"><span class="ttl">${k + 1}. ${c.title}</span><span class="stars">${this.starStr(s.stars[c.id] || 0)}</span></div>
        <div class="dim">${c.client} · ${B.name} · 높이 ${B.height} m</div>
        <div class="row"><span>${c.machines.map((m) => MACHINE_NAMES[m]).join(' · ')}</span><span class="money">${won(c.fee)}</span></div>
        ${unlocked ? '' : '<div class="dim">앞 의뢰를 끝내면 열립니다</div>'}`;
      b.addEventListener('click', () => { this.g.audio.ui(); this.openBrief(c); });
      wrap.appendChild(b);
    });
  }

  openBrief(c) {
    this.briefContract = c;
    const B = BUILDINGS[c.building];
    $('brief-title').textContent = c.title;
    $('brief-client').textContent = `의뢰인: ${c.client}`;
    $('brief-text').textContent = c.brief;
    $('brief-goals').innerHTML = c.goals.map((g) => `<li>${goalText(g)}</li>`).join('') + `<li>권장 시간 ${formatTime(c.time)} (★3 조건)</li>`;
    $('brief-kv').innerHTML = `<span class="dim">건물</span><b>${B.name}</b><span class="dim">높이</span><b>${B.height} m</b><span class="dim">계약금</span><b class="money">${won(c.fee)}</b>
      <span class="dim">크레인 가동비</span><b>${won(32000)}/분</b><span class="dim">굴착기 가동비</span><b>${won(26000)}/분</b>`;
    $('brief-machines').innerHTML = c.machines.map((m) => `<span class="tag">${MACHINE_NAMES[m]}</span>`).join('');
    this.show('brief');
  }

  renderFree() {
    const wrap = $('free-cards');
    wrap.innerHTML = '';
    for (const key of FREE_SITES) {
      const B = BUILDINGS[key];
      const b = document.createElement('button');
      b.className = 'card';
      b.innerHTML = `<span class="ttl">${B.name}</span><span class="dim">${B.desc}</span><span>높이 ${B.height} m</span>`;
      b.addEventListener('click', () => { this.g.audio.ui(); this.g.startFree(key); });
      wrap.appendChild(b);
    }
  }

  renderGarage() {
    const s = this.g.save;
    $('garage-money').textContent = won(s.money);
    const wrap = $('garage-list');
    wrap.innerHTML = '';
    for (const u of UPGRADES) {
      const have = owns(s, u.id);
      const locked = u.needs && !owns(s, u.needs);
      const row = document.createElement('div');
      row.className = 'upg' + (have ? ' owned' : '');
      row.innerHTML = `<div><div class="nm">${u.name}</div><div class="dim">${u.desc}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'px-btn' + (have ? '' : ' primary');
      btn.textContent = have ? '보유' : locked ? '앞 단계 필요' : won(u.price);
      btn.disabled = have || locked || s.money < u.price;
      btn.addEventListener('click', () => { this.g.buy(u); this.renderGarage(); });
      row.appendChild(btn);
      wrap.appendChild(row);
    }
  }

  renderSettings() {
    const s = this.g.save.settings;
    const body = $('settings-body');
    const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    body.innerHTML = `
      <div class="set-row"><div>화면 품질<div class="dim">블록이 많이 부서질 때 느리면 낮추세요</div></div>${seg('quality', [['auto', '자동'], ['low', '낮음'], ['medium', '보통'], ['high', '높음']])}</div>
      <div class="set-row"><div>소리 크기</div><input type="range" min="0" max="1" step="0.05" value="${s.volume}" id="set-vol"></div>
      <div class="set-row"><div>진동 (안드로이드)</div>${seg('haptics', [['true', '켜기'], ['false', '끄기']])}</div>
      <div class="set-row"><div>화면 흔들림</div>${seg('shake', [['true', '켜기'], ['false', '끄기']])}</div>
      <div class="set-row"><div>굴착기 붐 레버<div class="dim">실제식(ISO): 오른쪽 레버를 앞으로 밀면 붐이 내려갑니다</div></div>${seg('iso', [['false', '쉬운 방식'], ['true', '실제식(ISO)']])}</div>
      <div class="set-row"><div>화면 조이스틱</div>${seg('touch', [['auto', '자동'], ['on', '항상'], ['off', '숨기기']])}</div>
      <div class="set-row"><div>카메라 드래그 반전</div>${seg('invertCam', [['false', '보통'], ['true', '반전']])}</div>
      <div class="set-row"><div>진행 초기화<div class="dim">자금·별·장비가 모두 처음으로 돌아갑니다</div></div><button class="px-btn danger small" id="set-reset">초기화</button></div>
      <p class="dim" style="line-height:1.7">픽셀 글꼴: 갈무리(Galmuri) · SIL Open Font License 1.1 · 3D: three.js (MIT) · 물리: Rapier (Apache-2.0)</p>`;
    body.querySelectorAll('.seg').forEach((el) => el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      let v = b.dataset.v;
      if (v === 'true') v = true; else if (v === 'false') v = false;
      this.g.setSetting(el.dataset.key, v);
      this.renderSettings();
    })));
    $('set-vol').addEventListener('input', (e) => this.g.setSetting('volume', +e.target.value));
    $('set-reset').addEventListener('click', () => { if (confirm('진행 상황을 모두 지울까요?')) { this.g.resetProgress(); this.renderSettings(); } });
  }

  openHelp(from) {
    this.helpReturn = from;
    if (from === 'play') this.g.paused = true;
    const touch = this.g.touchUI;
    const k = (s) => `<kbd>${s}</kbd>`;
    $('help-body').innerHTML = `<div class="help-cols">
      <div><h3>크롤러 크레인 · 쇠공</h3><ul>
        <li>${touch ? '왼쪽 레버 ←→' : k('A') + k('D')} 선회 (붐이 좌우로 돈다)</li>
        <li>${touch ? '왼쪽 레버 ↑↓' : k('W') + k('S')} 붐 올리기 / 내리기</li>
        <li>${touch ? '오른쪽 레버 ↑↓' : k('↑') + k('↓')} 윈치: 쇠공 올리기 / 내리기</li>
        <li>${touch ? '빨간 버튼' : k('Space')} 누르는 동안 자유낙하 (위에서 떨어뜨리기)</li>
        <li><b>흔들기</b>: 선회를 좌우로 박자 맞춰 반복하면 진자처럼 점점 크게 흔들린다</li>
        <li>과부하(LMI) 100%를 넘으면 붐 내리기·윈치 풀기가 막히고 안전 위반이 기록된다</li></ul></div>
      <div><h3>굴착기</h3><ul>
        <li>${touch ? '왼쪽 레버 ←→' : k('A') + k('D')} 선회, ${touch ? '↑↓' : k('W') + k('S')} 암 펴기 / 접기</li>
        <li>${touch ? '오른쪽 레버 ↑↓' : k('↑') + k('↓')} 붐 올리기 / 내리기 (설정에서 실제식으로)</li>
        <li>${touch ? '오른쪽 레버 ←→' : k('←') + k('→')} 버킷·집게 오므리기 / 펴기</li>
        <li>${touch ? '빨간 버튼' : k('Space')} 압쇄기 물기 · 브레이커 타격</li>
        <li>버킷으로 잔해를 퍼서 덤프트럭 짐칸 위에서 펴면 실린다 (고철 판매)</li>
        <li>압쇄기는 벽 모서리를 턱 사이에 넣고 물어야 잘 부서진다</li></ul></div>
      <div><h3>발파</h3><ul>
        <li>건물을 ${touch ? '눌러' : '클릭해'} 장약 설치, 다시 눌러 선택</li>
        <li>지연 시간(0~3초)을 다르게 하면 무너지는 방향을 설계할 수 있다</li>
        <li>쓰러뜨릴 쪽 기둥을 먼저(짧은 지연) 끊으면 그쪽으로 넘어간다</li>
        <li>구조 보기로 하중이 몰린 층과 무게중심을 확인하자</li></ul></div>
      <div><h3>공통</h3><ul>
        <li>${touch ? '주행 버튼' : k('R')} 작업 ↔ 주행 전환 (주행: 왼쪽 레버로 이동)</li>
        <li>${touch ? '빈 화면 끌기 / 두 손가락' : '마우스 끌기 / 휠'} 카메라 돌리기 / 확대</li>
        <li>${touch ? '' : k('C') + ' 카메라 · ' + k('V') + ' 구조 보기 · ' + k('1') + k('2') + k('3') + ' 장비 · ' + k('Shift') + ' 미세 조작 · ' + k('Esc') + ' 일시정지'}</li>
        <li>게임패드: 스틱 2개 = 레버, A/RT = 동작, X = 주행, Y = 카메라, LB/RB = 장비</li></ul></div>
    </div>`;
    this.show('help');
  }

  // ───────────── HUD ─────────────
  setupHUD(session) {
    $('hud').hidden = false;
    $('hud-title').textContent = session.title;
    const mach = $('hud-mach');
    mach.innerHTML = '';
    for (const m of session.available) {
      const b = document.createElement('button');
      b.dataset.m = m;
      b.innerHTML = icon(m === 'blast' ? 'blast' : m) + `<span>${MACHINE_NAMES[m]}</span>`;
      b.addEventListener('click', () => this.g.selectMachine(m));
      mach.appendChild(b);
    }
    const att = $('hud-att');
    att.innerHTML = '';
    for (const [k, l] of [['crusher', '압쇄기'], ['breaker', '브레이커'], ['bucket', '버킷']]) {
      const b = document.createElement('button');
      b.dataset.a = k; b.textContent = l;
      b.addEventListener('click', () => this.g.setAttachment(k));
      att.appendChild(b);
    }
    this.applyTouchVisibility();
    this.lastObj = '';
  }
  hideHUD() { $('hud').hidden = true; }

  applyTouchVisibility() {
    const on = this.g.touchUI;
    for (const id of ['stick-l', 'stick-r', 'btn-a', 'btn-travel']) $(id).hidden = !on;
    $('hud-hint').hidden = on;
  }

  machineChanged(session) {
    const m = session.activeKind;
    document.querySelectorAll('#hud-mach button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    $('hud-att').hidden = m !== 'excavator';
    const blast = m === 'blast';
    $('blast-panel').hidden = !blast;
    $('hud-gauges').hidden = blast;
    $('hud-hint').hidden = blast || this.g.touchUI;
    const touch = this.g.touchUI;
    for (const id of ['stick-l', 'stick-r', 'btn-a', 'btn-travel']) $(id).hidden = !touch || blast;
    this.updateLabels(session);
    if (blast) this.renderBlast(session);
  }

  updateLabels(session) {
    const m = session.activeKind;
    const mc = session.active;
    const travel = mc && mc.s && mc.s.travel;
    const L = $('stick-l').querySelector('.lbl'), R = $('stick-r').querySelector('.lbl');
    const A = $('btn-a');
    $('btn-travel').classList.toggle('on', !!travel);
    let hint = '';
    if (m === 'crane') {
      L.innerHTML = travel ? '↑↓ 전진·후진<br>←→ 방향' : '←→ 선회<br>↑↓ 붐';
      R.innerHTML = travel ? '-' : '↑↓ 윈치<br>(쇠공)';
      A.textContent = '자유낙하';
      hint = travel ? 'W/S 전진·후진 · A/D 방향 · R 작업 모드' : 'A/D 선회 · W/S 붐 · ↑/↓ 윈치 · Space 자유낙하 · R 주행 · Shift 미세 · C 카메라 · V 구조';
    } else if (m === 'excavator') {
      const at = mc.s.att_type;
      L.innerHTML = travel ? '↑↓ 전진·후진<br>←→ 방향' : '←→ 선회<br>↑↓ 암';
      R.innerHTML = travel ? '-' : '↑↓ 붐<br>←→ 버킷';
      A.textContent = at === 'crusher' ? '물기' : at === 'breaker' ? '타격' : '-';
      hint = travel ? 'W/S 전진·후진 · A/D 방향 · R 작업 모드' : `A/D 선회 · W/S 암 · ↑/↓ 붐 · ←/→ 버킷 · Space ${at === 'crusher' ? '물기' : at === 'breaker' ? '타격' : '-'} · R 주행 · Q/E 어태치먼트`;
      document.querySelectorAll('#hud-att button').forEach((b) => b.classList.toggle('on', b.dataset.a === at));
    } else hint = '건물 클릭: 장약 설치·선택 · Delete 선택 삭제 · Enter 발파 · 마우스 끌기 카메라';
    $('hud-hint').textContent = hint;
  }

  updateHUD(session, m) {
    const c = session.contract;
    $('hud-time').textContent = formatTime(m.time) + (session.free ? '' : ` / ${formatTime(c.time)}`);
    const key = c.goals.map((g) => goalValue(g, m) + goalMet(g, m)).join('|');
    if (key !== this.lastObj) {
      this.lastObj = key;
      $('hud-obj').innerHTML = c.goals.map((g) => `<li class="${goalMet(g, m) ? 'ok' : ''}"><span class="ic">${goalMet(g, m) ? '✔' : '✖'}</span><span>${goalText(g)}</span><span class="v">${goalValue(g, m)}</span></li>`).join('');
    }
    $('btn-finish').hidden = !goalMet(c.goals[0], m) || session.finished;
    const mc = session.active;
    if (mc && mc.hud) {
      const h = mc.hud();
      const html = `<div class="head"><span>${h.title}</span><span class="mode">${h.mode}</span></div><div class="rows">${h.gauges.map((gg) =>
        `<div class="g ${gg.warn ? 'warn' : ''}"><span class="dim">${gg.k}</span><b>${gg.v}</b></div>${gg.bar !== undefined ? `<div class="gbar ${gg.warn ? 'warn' : ''}"><i style="width:${Math.min(100, gg.bar * 100 / 1.2 * (gg.k.includes('LMI') ? 1 : 1.2))}%"></i></div>` : ''}`).join('')}</div>`;
      if (html !== this.lastGauge) { $('hud-gauges').innerHTML = html; this.lastGauge = html; }
      const travel = mc.s.travel;
      if (travel !== this.lastTravel) { this.lastTravel = travel; this.updateLabels(session); }
    }
    $('danger').hidden = !(this.g.presenter.warnLevel > 0.78);
  }

  // ───────────── 발파 패널 ─────────────
  renderBlast(session) {
    const ex = session.explosives;
    const el = $('blast-panel');
    if (!ex) { el.innerHTML = ''; return; }
    const sel = ex.list.find((c) => c.id === session.selCharge && !c.fired);
    const big = session.free || this.g.hasBigCharge();
    const st = ex.state;
    const cost = ex.totalCost();
    let html = '';
    if (st === 'plan') {
      html += `<div class="row"><b>장약</b>
        <button class="chip ${session.chargeType === 'std' ? 'on' : ''}" data-ct="std" style="${session.chargeType === 'std' ? 'background:#fff' : ''}">${CHARGES.std.name}</button>
        <button class="chip ${session.chargeType === 'big' ? 'on' : ''}" data-ct="big" ${big ? '' : 'disabled'} style="${session.chargeType === 'big' ? 'background:#fff' : ''}">${CHARGES.big.name}${big ? '' : ' (차고)'}</button>
        <span class="dim" style="margin-left:auto">${ex.list.length}개 · ${session.free ? '무료' : won(cost)}</span></div>`;
      html += `<div class="row"><b>지연</b>${DELAYS.map((d, i) => `<button class="chip ${sel && sel.delay === d ? 'on' : ''}" data-d="${d}" style="border-color:#${DELAY_COLORS[i].toString(16).padStart(6, '0')};${sel && sel.delay === d ? 'background:#' + DELAY_COLORS[i].toString(16).padStart(6, '0') : ''}">${d}s</button>`).join('')}</div>`;
      html += `<div class="row"><span class="dim">${sel ? `선택한 장약: ${CHARGES[sel.type].name}, ${sel.delay}초 뒤 폭발` : '건물을 눌러 장약을 설치하세요 (기둥·내력벽 밑동이 효과적)'}</span></div>`;
      html += `<div class="row"><button class="px-btn small" data-act="del" ${sel ? '' : 'disabled'}>선택 삭제</button><button class="px-btn small" data-act="clear" ${ex.list.length ? '' : 'disabled'}>모두 삭제</button>
        <button class="px-btn danger fire" data-act="fire" ${ex.list.length ? '' : 'disabled'}>발파!</button></div>`;
    } else if (st === 'countdown') {
      html += `<div class="row"><b style="font-size:18px">발파 준비 — 대피 완료</b><button class="px-btn small fire" data-act="cancel">취소</button></div>`;
    } else if (st === 'firing' || session.replaying) {
      html += `<div class="row"><b style="font-size:18px">${session.replaying ? '다시 보기 (슬로모션)' : '발파 중…'}</b></div>`;
    } else {
      html += `<div class="row"><b>발파 완료</b><button class="px-btn small" data-act="replay" ${session.blastSnap ? '' : 'disabled'}>다시 보기</button><button class="px-btn small primary" data-act="again">추가 발파 준비</button></div>`;
    }
    el.innerHTML = html;
    el.querySelectorAll('[data-ct]').forEach((b) => b.addEventListener('click', () => { session.chargeType = b.dataset.ct; if (sel) ex.setType(sel.id, b.dataset.ct); this.renderBlast(session); }));
    el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => { session.chargeDelay = +b.dataset.d; if (sel) ex.setDelay(sel.id, +b.dataset.d); this.renderBlast(session); }));
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.g.blastAction(b.dataset.act)));
  }

  setCount(n) {
    const el = $('count');
    if (n === null || n === undefined) { el.hidden = true; return; }
    el.hidden = false; el.textContent = n;
  }

  setStructButton(on) { $('btn-struct').classList.toggle('on', on); $('struct-legend').hidden = !on; }

  // ───────────── 알림 ─────────────
  toast(text, kind = '', ms = 2600) {
    const now = performance.now();
    if (this.lastToast[text] && now - this.lastToast[text] < 3000) return;
    this.lastToast[text] = now;
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.toastsEl.appendChild(d);
    while (this.toastsEl.children.length > 3) this.toastsEl.firstChild.remove();
    setTimeout(() => d.remove(), ms);
  }
  flashMessage(t, kind) { this.toast(t, kind, 1800); }

  // ───────────── 정산 ─────────────
  showResult(session, r) {
    $('res-title').textContent = session.free ? '자유 철거 결과' : r.success ? '철거 완료' : '철거 미완료';
    $('res-stars').innerHTML = session.free ? '' : this.starStr(r.stars);
    const c = session.contract;
    $('res-goals').innerHTML = c.goals.map((g, k) => `<li class="${r.met[k] ? 'ok' : ''}"><span class="ic">${r.met[k] ? '✔' : '✖'}</span><span>${goalText(g)}</span><span class="v">${goalValue(g, r.m)}</span></li>`).join('');
    $('res-kv').innerHTML = `<span class="dim">작업 시간</span><b>${formatTime(r.m.time)}</b><span class="dim">부순 블록</span><b>${Math.round(session.blocksBroken()).toLocaleString('ko-KR')}개</b>`;
    $('res-lines').innerHTML = session.free ? '<div class="dim">자유 철거는 정산하지 않습니다</div>' :
      r.lines.map(([k, v]) => `<div class="${v < 0 ? 'neg' : 'pos'}"><span>${k}</span><span>${v < 0 ? '-' : '+'}${won(Math.abs(v)).replace('₩', '₩')}</span></div>`).join('');
    $('res-total').textContent = session.free ? '-' : won(r.profit);
    $('res-total').style.color = r.profit >= 0 ? 'var(--yel)' : 'var(--red)';
    $('res-replay').hidden = !session.blastSnap;
    $('res-next').textContent = session.free ? '건물 고르기' : '의뢰 목록';
    this.show('result');
  }
}

export { icon };
