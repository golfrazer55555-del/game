// 게임 진행: 턴, 사격, 착탄, 피해, 이동, 승패
import * as THREE from 'three';
import { VoxelWorld } from './voxel.js';
import { Tank } from './tank.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { AIGunner } from './ai.js';
import { launchVelocity, step, testHit, predict } from './ballistics.js';
import { DIFFICULTY, TURN_TIME, MOVE_RANGE, BLAST_RADIUS, DAMAGE_RADIUS, MAX_DAMAGE, M_PER_UNIT, WIND_ACC, CHARGE_SPEED, DEG } from './config.js';
import { bearingTo, angleDiff, normDeg, clamp, loadPref, savePref } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const NO_WIND = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Game {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.world = new VoxelWorld(scene);
    this.fx = new Effects(scene, this.world);
    this.rig = new CameraRig(camera);
    this.sound = new Sound();
    this.sound.setMuted(loadPref('muted', false));
    this.ui = new UI(this.handlers());
    this.diffKey = DIFFICULTY[loadPref('diff', 'normal')] ? loadPref('diff', 'normal') : 'normal';
    this.diff = DIFFICULTY[this.diffKey];
    this.state = 'title';
    this.time = 0;
    this.timers = [];
    this.wind = new THREE.Vector3();
    this.windSpeed = 0; this.windBearing = 45;
    this.tanks = [];
    this.impacts = [];
    this.raycaster = new THREE.Raycaster();
    this.makeProps();
    this.newBattlefield();
    this.ui.showTitle(this.diffKey, loadPref('best', {}));
    this.updateMuteIcon();
  }

  makeProps() {
    this.shellMesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.66), new THREE.MeshLambertMaterial({ color: 0x2a2620 }));
    const tracer = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false }));
    tracer.position.z = -0.38;
    this.shellMesh.add(tracer);
    this.shellMesh.visible = false;
    this.scene.add(this.shellMesh);
    this.guideMax = 70;
    this.guide = new THREE.InstancedMesh(new THREE.BoxGeometry(0.17, 0.17, 0.17),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85, toneMapped: false }), this.guideMax);
    this.guide.count = 0;
    this.guide.frustumCulled = false;
    this.scene.add(this.guide);
    this.moveRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72),
      new THREE.MeshBasicMaterial({ color: 0xf0c45a, transparent: true, opacity: 0.85, depthTest: false }));
    this.moveRing.rotation.x = -Math.PI / 2;
    this.moveRing.renderOrder = 10;
    this.moveRing.visible = false;
    this.scene.add(this.moveRing);
  }

  handlers() {
    return {
      onDrag: (dx, dy) => {
        if (this.state !== 'player' || this.moveMode || this.driving) return;
        if (this.bino) this.toggleBino(false);
        this.adjustAim(dx * 0.16, -dy * 0.1);
        if (this.turnNo === 1 && this.hintStage === 0) {
          this.hintStage = 1;
          this.ui.hint('발사 버튼을 길게 눌러 장약을 모으고, 손을 떼면 발사됩니다');
        }
      },
      onStep: (axis, d) => {
        if (this.state !== 'player' || this.moveMode || this.driving) return;
        this.adjustAim(axis === 'az' ? d : 0, axis === 'el' ? d : 0);
        this.sound.click();
      },
      onTap: (x, y) => { if (this.state === 'player' && this.moveMode) this.tapMove(x, y); },
      onFireDown: () => {
        if (this.state !== 'player' || this.moveMode || this.driving || this.charging) return;
        this.charging = true; this.power = 0; this.powerDir = 1;
        if (this.bino) this.toggleBino(false);
        this.sound.chargeStart();
      },
      onFireUp: () => {
        if (!this.charging) return;
        this.charging = false;
        this.sound.chargeStop();
        this.playerFire();
      },
      onMove: () => this.toggleMove(!this.moveMode),
      onBino: () => this.toggleBino(!this.bino),
      onMute: () => {
        this.sound.init();
        this.sound.setMuted(!this.sound.muted);
        savePref('muted', this.sound.muted);
        this.updateMuteIcon();
      },
      onStart: (key) => this.startMatch(key),
      onAgain: () => { this.newBattlefield(); this.startMatch(this.diffKey); },
      onMenu: () => {
        this.newBattlefield();
        this.state = 'title';
        this.rig.orbit = true;
        this.ui.showTitle(this.diffKey, loadPref('best', {}));
      },
      onPick: (key) => { this.diffKey = key; },
    };
  }

  updateMuteIcon() {
    const m = this.sound.muted, b = this.ui.el.btnMute;
    b.setAttribute('aria-label', m ? '소리 켜기' : '소리 끄기');
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>${m
      ? '<path d="M16 9l5 6M21 9l-5 6" fill="none"/>' : '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none"/>'}</svg>`;
  }

  // ───────── 전장 준비 ─────────
  newBattlefield(seed = Math.floor(Math.random() * 1e9)) {
    for (const t of this.tanks) t.dispose();
    this.fx.clear();
    this.ui.clearFloaters();
    this.timers = [];
    this.shell = null;
    this.shellMesh.visible = false;
    this.driving = null;
    this.world.generate(seed);
    const [ps, es] = this.world.spawns;
    this.player = new Tank(this.scene, this.world, { isPlayer: true, name: '연합 전선군', main: 0x56682f, dark: 0x3d4a22, accent: 0xd9d2b8, flag: 0x86a83f });
    this.enemy = new Tank(this.scene, this.world, { isPlayer: false, name: '북부 제국군', main: 0x5f6468, dark: 0x45494c, accent: 0x9a2f22, flag: 0xa33326 });
    this.player.place(ps.x, ps.z, bearingTo(ps, es));
    this.enemy.place(es.x, es.z, bearingTo(es, ps));
    this.player.aimAz = Math.round(this.player.hullYaw * 2) / 2;
    this.player.aimEl = 40;
    this.enemy.aimAz = this.enemy.hullYaw;
    this.enemy.aimEl = 18;
    this.player.snapAim(); this.enemy.snapAim();
    this.tanks = [this.player, this.enemy];
    for (const t of this.tanks) t.onLand = (tk, dist) => this.onTankLand(tk, dist);
    this.impacts = [];
  }

  startMatch(diffKey) {
    this.diffKey = diffKey;
    this.diff = DIFFICULTY[diffKey];
    savePref('diff', diffKey);
    this.sound.init();
    this.ai = new AIGunner(this.diff);
    this.stats = { shots: 0, hits: 0, dealt: 0, best: 0, taken: 0, turns: 0 };
    this.prevShot = null; this.turnNo = 0; this.hintStage = 0; this.windInit = false;
    this.charging = false; this.moveMode = false; this.bino = false; this.endOrbit = null;
    this.ui.showHUD();
    this.ui.setHP(true, this.player.hp); this.ui.setHP(false, this.enemy.hp);
    this.ui.setPrev(null); this.ui.setGuide(this.diff.guide); this.ui.hint(''); this.ui.setTimer(null);
    this.ui.setControls(false); this.ui.setTurn('작전 개시', true); this.ui.setModes(false, false);
    this.ui.setPower(0, null, false);
    this.updateWind();
    this.state = 'intro';
    const p = this.player.center(), e = this.enemy.center(), mid = p.clone().lerp(e, 0.5);
    this.rig.set(new THREE.Vector3(p.x - 26, 46, mid.z + 56), mid, 1.3);
    this.ui.radio('사령부: 능선 너머에 적 전차 포착. 포격으로 격파하라.', 'info', 3.5);
    this.sound.radio();
    this.after(2.8, () => this.beginPlayerTurn(true));
  }

  after(t, fn) { this.timers.push({ t, fn }); }

  updateWind() {
    const max = this.diff.windMax;
    if (!this.windInit) {
      this.windInit = true;
      this.windSpeed = Math.round(Math.random() * max * 0.7);
      this.windBearing = Math.random() * 360;
    } else {
      this.windSpeed = Math.round(clamp(this.windSpeed + (Math.random() * 2 - 1) * max * 0.4, 0, max));
      this.windBearing = normDeg(this.windBearing + (Math.random() * 2 - 1) * 55);
    }
    const a = this.windBearing * DEG, acc = this.windSpeed * WIND_ACC;
    this.wind.set(Math.sin(a) * acc, 0, -Math.cos(a) * acc);
  }

  // ───────── 플레이어 턴 ─────────
  beginPlayerTurn(keepWind = false) {
    this.state = 'player';
    this.turnNo++; this.stats.turns++;
    if (!keepWind) this.updateWind();
    this.timeLeft = TURN_TIME; this.fuel = 1;
    this.moveMode = false; this.bino = false; this.charging = false; this.power = 0;
    this.rig.zoom = 1;
    this.moveRing.visible = false;
    this.guideDirty = true;
    this.ui.setTurn('나의 차례', true);
    this.ui.setControls(true);
    this.ui.setFuel(1);
    this.ui.setModes(false, false);
    this.ui.setPower(0, this.prevShot ? this.prevShot.power : null, false);
    if (this.turnNo === 1) this.ui.hint('화면을 좌우로 끌어 포탑을, 위아래로 끌어 고각을 맞추세요');
    else if (this.turnNo === 2) this.ui.hint('관측 보고를 보고 보정하세요. 이동하면 적의 조준이 흐트러집니다');
    else this.ui.hint('');
    if (this.turnNo > 1) this.ui.radio(`나의 차례 · ${this.windSpeed ? `바람 ${this.windSpeed}m/s` : '무풍'}`, 'info', 2.5);
    this.sound.radio();
  }

  adjustAim(dAz, dEl) {
    const p = this.player;
    p.aimAz = normDeg(p.aimAz + dAz);
    p.aimEl = clamp(p.aimEl + dEl, 0, 85);
    this.guideDirty = true;
  }

  updatePlayer(dt) {
    if (!this.driving) {
      this.timeLeft -= dt;
      this.ui.setTimer(this.timeLeft);
      if (this.timeLeft <= 0) {
        if (this.charging) { this.charging = false; this.sound.chargeStop(); this.playerFire(); }
        else this.timeUp();
        return;
      }
    }
    if (this.charging) {
      this.power += this.powerDir * CHARGE_SPEED * dt;
      if (this.power > 100) { this.power = 200 - this.power; this.powerDir = -1; }
      if (this.power < 0) { this.power = -this.power; this.powerDir = 1; }
      this.ui.setPower(this.power, this.prevShot ? this.prevShot.power : null, true);
      this.sound.chargeSet(this.power);
    }
    const p = this.player;
    if (this.bino) {
      const c = p.center(), e = this.enemy.center(), dir = e.clone().sub(c).setY(0).normalize();
      const eye = c.clone().addScaledVector(dir, -2);
      eye.y = this.binoH;
      this.rig.set(eye, e, 5);
    } else if (this.moveMode || this.driving) {
      const c = p.center(), a = p.visAz * DEG;
      this.rig.set(new THREE.Vector3(c.x - Math.sin(a) * 8, c.y + 19, c.z + Math.cos(a) * 8), c, 4);
    } else {
      this.rig.aimAt(p, p.visAz, p.visEl);
    }
    this.updateGuide();
  }

  updateGuide() {
    const show = this.state === 'player' && this.diff.guide > 0 && !this.moveMode && !this.driving && !this.bino;
    if (!show) { this.guide.count = 0; return; }
    if (!this.guideDirty && !this.charging) return;
    this.guideDirty = false;
    const p = this.player, az = p.aimAz, el = p.aimEl;
    const power = this.charging ? this.power : (this.prevShot ? this.prevShot.power : 60);
    const path = [];
    predict(p.muzzleFor(az, el), launchVelocity(az, el, Math.max(1, power)), NO_WIND, this.world, this.tanks, p, 1 / 90, path, 3);
    const n = Math.min(this.guideMax, Math.floor(path.length * this.diff.guide));
    for (let i = 0; i < n; i++) {
      _m.makeTranslation(path[i].x, path[i].y, path[i].z);
      this.guide.setMatrixAt(i, _m);
    }
    this.guide.count = n;
    this.guide.instanceMatrix.needsUpdate = true;
  }

  timeUp() {
    this.state = 'skip';
    this.ui.setControls(false);
    this.ui.setTimer(null);
    this.ui.hint('');
    this.guide.count = 0;
    this.ui.radio('시간 초과! 사격 기회를 놓쳤습니다', 'bad');
    this.sound.radio();
    this.after(1.4, () => this.endTurn(this.player));
  }

  playerFire() {
    if (this.state !== 'player') return;
    const p = this.player;
    const power = Math.round(this.power);
    if (power < 3) {
      this.ui.setPower(0, this.prevShot ? this.prevShot.power : null, false);
      this.ui.hint('장약이 너무 약합니다. 발사 버튼을 길게 누르세요');
      return;
    }
    const az = Math.round(p.aimAz * 10) / 10, el = Math.round(p.aimEl * 10) / 10;
    this.prevShot = { az, el, power };
    this.ui.setPrev(this.prevShot);
    this.ui.setPower(power, power, false);
    this.ui.hint('');
    this.hintStage = 2;
    this.ui.setControls(false);
    this.ui.setTimer(null);
    this.guide.count = 0;
    this.fire(p, az, el, power);
  }

  // ───────── 이동 / 쌍안경 ─────────
  toggleMove(on) {
    if (this.state !== 'player' || this.charging || this.driving) return;
    if (on && this.fuel <= 0.03) return;
    this.moveMode = on;
    if (on) { this.bino = false; this.rig.zoom = 1; }
    this.moveRing.visible = on;
    this.ui.setModes(this.moveMode, this.bino);
    this.ui.hint(on ? '노란 원 안에서 이동할 지점을 터치하세요' : '');
    this.guideDirty = true;
  }

  toggleBino(on) {
    if (this.state !== 'player' || this.moveMode || this.driving) return;
    this.bino = on;
    this.rig.zoom = on ? 3.2 : 1;
    if (on) {
      // 나무·능선 너머가 보이도록 시선 위 장애물보다 높은 곳에서 관측
      const c = this.player.center(), e = this.enemy.center();
      let h = c.y + 8;
      for (let i = 1; i < 18; i++) {
        const t = i / 20;
        h = Math.max(h, this.world.topHeight(Math.floor(c.x + (e.x - c.x) * t), Math.floor(c.z + (e.z - c.z) * t)) + 3);
      }
      this.binoH = h;
    }
    this.ui.setModes(this.moveMode, on);
    this.guideDirty = true;
  }

  tapMove(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.group.children, false)[0];
    if (!hit) return;
    const p = this.player;
    let dx = hit.point.x - p.base.x, dz = hit.point.z - p.base.z, dist = Math.hypot(dx, dz);
    const maxD = this.fuel * MOVE_RANGE;
    if (dist < 0.8) return;
    if (dist > maxD) { dx *= maxD / dist; dz *= maxD / dist; }
    const tx = p.base.x + dx, tz = p.base.z + dz;
    let yaw = bearingTo(p.base, { x: tx, z: tz });
    if (Math.abs(angleDiff(p.hullYaw, yaw)) > 100) yaw = normDeg(yaw + 180);
    this.driving = { tx, tz, yaw, startFuel: this.fuel, traveled: 0, dustT: 0 };
    this.moveMode = false;
    this.moveRing.visible = false;
    this.ui.setModes(false, false);
    this.ui.hint('');
    this.sound.engineOn(true);
  }

  updateDrive(dt) {
    const d = this.driving, p = this.player;
    const turn = angleDiff(p.hullYaw, d.yaw);
    if (Math.abs(turn) > 0.5) {
      const yaw = normDeg(p.hullYaw + Math.sign(turn) * Math.min(Math.abs(turn), 90 * dt));
      const g = p.standHeight(p.base.x, p.base.z, yaw, p.targetY);
      if (g == null) { this.stopDrive('회전할 공간이 없습니다'); return; }
      p.hullYaw = yaw; p.targetY = g;
      return;
    }
    p.hullYaw = d.yaw;
    const remain = Math.hypot(d.tx - p.base.x, d.tz - p.base.z);
    if (remain < 0.05 || this.fuel <= 0) { this.stopDrive(); return; }
    const sp = Math.min(remain, 3.8 * dt);
    const nx = p.base.x + ((d.tx - p.base.x) / remain) * sp, nz = p.base.z + ((d.tz - p.base.z) / remain) * sp;
    const g = p.standHeight(nx, nz, p.hullYaw, p.targetY);
    if (g == null) { this.stopDrive('지형에 막혀 멈췄습니다'); return; }
    p.base.x = nx; p.base.z = nz;
    d.traveled += sp;
    this.fuel = Math.max(0, d.startFuel - d.traveled / MOVE_RANGE);
    this.ui.setFuel(this.fuel);
    d.dustT -= dt;
    if (d.dustT <= 0) { d.dustT = 0.07; this.fx.dust(p.base); }
    if (g < p.targetY - 1.5) {
      p.falling = true; p.vy = 0; p.fallFrom = p.base.y; p.targetY = g;
      this.stopDrive();
    } else p.targetY = g;
  }

  stopDrive(msg) {
    this.driving = null;
    this.sound.engineOn(false);
    this.guideDirty = true;
    if (msg) this.ui.radio(msg, 'miss', 2);
  }

  // ───────── AI 턴 ─────────
  beginAITurn() {
    this.state = 'ai';
    this.updateWind();
    this.ui.setTurn('적의 차례', false);
    this.ui.setControls(false);
    this.ui.setTimer(null);
    this.ui.hint('');
    this.bino = false; this.moveMode = false; this.rig.zoom = 1;
    this.moveRing.visible = false;
    this.ui.setModes(false, false);
    const e = this.enemy, p = this.player;
    const plan = this.ai.plan(e, p, this.wind, this.world, this.tanks);
    e.aimAz = plan.az; e.aimEl = plan.el;
    const c = e.center(), dir = p.center().sub(c).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.rig.set(c.clone().addScaledVector(side, 9).addScaledVector(dir, -5).addScaledVector(UP, 4), c.clone().addScaledVector(dir, 6).addScaledVector(UP, 1), 2.5);
    this.ui.radio('적 전차가 포탑을 돌리고 있다!', 'bad', 2.2);
    this.sound.radio();
    this.after(2.4, () => { if (this.state === 'ai') this.fire(e, plan.az, plan.el, plan.power); });
  }

  // ───────── 사격 / 착탄 ─────────
  fire(shooter, az, el, power) {
    shooter.aimAz = az; shooter.aimEl = el;
    shooter.snapAim();
    const start = shooter.muzzleFor(az, el);
    const vel = launchVelocity(az, el, power);
    this.shell = { p: start.clone(), v: vel, t: 0, shooter, trailT: 0, whistled: false };
    this.shellMesh.position.copy(start);
    this.shellMesh.visible = true;
    this.fx.muzzle(start, vel.clone().normalize());
    shooter.recoil = 1;
    this.sound.cannon();
    this.rig.shake(shooter.isPlayer ? 0.5 : 0.25);
    this.state = 'flight';
    if (shooter.isPlayer) this.stats.shots++;
  }

  updateShell(dt) {
    const s = this.shell;
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      step(s.p, s.v, this.wind, h);
      s.t += h;
      const hit = testHit(s.p, this.world, this.tanks, s.shooter, s.t);
      if (hit || s.t > 14) { this.impact(hit || { kind: 'out' }, s.p.clone(), s.shooter); return; }
    }
    s.trailT -= dt;
    if (s.trailT <= 0) { s.trailT = 0.025; this.fx.trail(s.p); }
    if (!s.whistled && s.v.y < -6) {
      s.whistled = true;
      this.sound.whistle(clamp(s.p.y / Math.abs(s.v.y), 0.5, 2.2));
    }
    this.shellMesh.position.copy(s.p);
    this.shellMesh.lookAt(s.p.x + s.v.x, s.p.y + s.v.y, s.p.z + s.v.z);
    const vd = s.v.clone().normalize(), side = new THREE.Vector3(-vd.z, 0, vd.x).normalize();
    this.rig.set(s.p.clone().addScaledVector(vd, -8).addScaledVector(UP, 3).addScaledVector(side, 2.5), s.p.clone().addScaledVector(vd, 4), 7);
  }

  impact(hit, point, shooter) {
    this.shell = null;
    this.shellMesh.visible = false;
    const target = shooter === this.player ? this.enemy : this.player;
    if (hit.kind === 'out') {
      this.ui.radio(shooter.isPlayer ? '관측: 포탄이 전장 밖으로 벗어났습니다' : '적 포탄이 전장 밖으로 빗나갔습니다', 'miss');
      this.sound.radio();
      this.after(1.0, () => this.endTurn(shooter));
      return;
    }
    const removed = this.world.explode(point.x, point.y, point.z, BLAST_RADIUS);
    this.world.rebuildDirty();
    this.fx.explosion(point, BLAST_RADIUS, removed);
    const camD = this.camera.position.distanceTo(point);
    this.sound.explosion(1.25 - camD / 110);
    this.rig.shake(Math.max(0.2, 1.6 - camD / 30));
    this.impacts.push({ x: point.x, z: point.z, mine: shooter.isPlayer });
    if (this.impacts.length > 6) this.impacts.shift();

    let toTarget = 0, toSelf = 0;
    const direct = hit.kind === 'tank' && hit.tank === target;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      let d = t.center().distanceTo(point);
      if (hit.kind === 'tank' && hit.tank === t) d = Math.min(d, 0.5);
      if (d >= DAMAGE_RADIUS) continue;
      const dmg = Math.round(MAX_DAMAGE * Math.pow(1 - d / DAMAGE_RADIUS, 1.2));
      if (dmg <= 0) continue;
      this.applyDamage(t, dmg, shooter);
      if (t === target) toTarget = dmg; else toSelf = dmg;
    }
    for (const t of this.tanks) t.checkSupport();
    this.report(shooter, target, point, toTarget, toSelf, direct);
    const back = shooter.base.clone().sub(point).setY(0).normalize();
    this.rig.set(point.clone().addScaledVector(back, 16).addScaledVector(UP, 10), point.clone(), 3);
    this.after(1.9, () => this.endTurn(shooter));
  }

  applyDamage(t, dmg, shooter) {
    t.damage(dmg);
    this.ui.setHP(t.isPlayer, t.hp);
    this.ui.float(`-${dmg}`, t.center().addScaledVector(UP, 2), t.isPlayer ? 'bad' : 'good');
    if (t.isPlayer) this.stats.taken += dmg;
    else if (shooter === this.player) { this.stats.dealt += dmg; this.stats.hits++; this.stats.best = Math.max(this.stats.best, dmg); }
    this.sound.clang();
    if (t.hp <= 0 && t.alive) this.killTank(t);
  }

  killTank(t) {
    t.destroy();
    const c = t.center();
    this.after(0.3, () => {
      const rem = this.world.explode(c.x, c.y - 0.6, c.z, 2.4);
      this.world.rebuildDirty();
      this.fx.explosion(c, 3, rem, true);
      this.sound.explosion(1);
      this.rig.shake(1.6);
      for (const o of this.tanks) o.checkSupport();
    });
  }

  onTankLand(t, dist) {
    this.rig.shake(0.4);
    if (!t.alive || dist < 3) return;
    const dmg = Math.round((dist - 2) * 5);
    this.ui.radio(`${t.isPlayer ? '아군' : '적'} 전차 추락! 피해 ${dmg}`, t.isPlayer ? 'bad' : 'hit', 2.5);
    this.applyDamage(t, dmg, null);
  }

  report(shooter, target, point, toTarget, toSelf, direct) {
    let msg, tone;
    if (shooter.isPlayer) {
      if (toTarget > 0) {
        tone = 'hit';
        msg = this.enemy.hp <= 0 ? '적 전차 격파!' : `${direct ? '직격!' : '명중!'} 적 전차 피해 ${toTarget}`;
      } else {
        tone = 'miss';
        const a = bearingTo(shooter.base, target.base) * DEG;
        const dx = point.x - target.base.x, dz = point.z - target.base.z;
        const long = Math.round((dx * Math.sin(a) - dz * Math.cos(a)) * M_PER_UNIT);
        const right = Math.round((dx * Math.cos(a) + dz * Math.sin(a)) * M_PER_UNIT);
        const parts = [];
        if (Math.abs(long) >= 4) parts.push(long > 0 ? `${long}m 멀리` : `${-long}m 짧게`);
        if (Math.abs(right) >= 4) parts.push(right > 0 ? `${right}m 우측` : `${-right}m 좌측`);
        msg = `관측: 목표보다 ${parts.join(', ') || '아주 가까이'} 착탄`;
      }
      if (toSelf) msg += ` · 아군 피해 ${toSelf}`;
    } else if (toTarget > 0) {
      tone = 'bad';
      msg = this.player.hp <= 0 ? '아군 전차 피격… 전차를 잃었습니다' : `피격! 아군 전차 피해 ${toTarget}`;
    } else {
      tone = 'miss';
      const d = Math.round(Math.hypot(point.x - this.player.base.x, point.z - this.player.base.z) * M_PER_UNIT);
      msg = `적 포탄이 아군 ${d}m 옆에 착탄`;
    }
    this.ui.radio(msg, tone);
    this.sound.radio();
  }

  endTurn(shooter) {
    if (this.state === 'over') return;
    if (this.player.falling || this.enemy.falling) { this.after(0.3, () => this.endTurn(shooter)); return; }
    const pDead = !this.player.alive, eDead = !this.enemy.alive;
    if (pDead || eDead) {
      this.state = 'over';
      this.after(1.0, () => this.gameOver(pDead && eDead ? 'draw' : eDead ? 'win' : 'lose'));
      return;
    }
    if (shooter.isPlayer) this.beginAITurn(); else this.beginPlayerTurn();
  }

  gameOver(result) {
    this.sound.engineOn(false);
    this.sound.chargeStop();
    if (result === 'win') this.sound.victory(); else this.sound.defeat();
    const wreck = result === 'win' ? this.enemy : this.player;
    this.endOrbit = { c: wreck.center(), a: 0 };
    const stars = result === 'win' ? 1 + (this.stats.shots <= 6 ? 1 : 0) + (this.player.hp >= 50 ? 1 : 0) : 0;
    const best = loadPref('best', {});
    if (stars > (best[this.diffKey] || 0)) { best[this.diffKey] = stars; savePref('best', best); }
    const acc = this.stats.shots ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
    this.after(2.4, () => this.ui.showEnd({
      result, stars, diffLabel: this.diff.label,
      stats: [['발사', `${this.stats.shots}발`], ['명중', `${this.stats.hits}발 · ${acc}%`], ['최대 피해', `${this.stats.best}`],
        ['받은 피해', `${this.stats.taken}`], ['진행 턴', `${this.stats.turns}`]],
    }));
  }

  // ───────── 매 프레임 ─────────
  update(dt) {
    this.time += dt;
    if (this.timers.length) {
      const due = [];
      this.timers = this.timers.filter((t) => ((t.t -= dt) > 0 ? true : (due.push(t), false)));
      for (const t of due) t.fn();
    }
    if (this.state === 'player') this.updatePlayer(dt);
    if (this.driving) this.updateDrive(dt);
    if (this.shell) this.updateShell(dt);
    if (this.state === 'over' && this.endOrbit) {
      const o = this.endOrbit;
      o.a += dt * 0.35;
      this.rig.set(new THREE.Vector3(o.c.x + Math.cos(o.a) * 15, o.c.y + 7, o.c.z + Math.sin(o.a) * 15), o.c, 1.5);
    }
    for (const t of this.tanks) {
      t.update(dt, this.time, this.windBearing, this.windSpeed);
      if (t.hp < 50) {
        t.smokeT = (t.smokeT ?? 0) - dt;
        if (t.smokeT <= 0) {
          const heavy = t.hp < 25;
          t.smokeT = heavy ? 0.1 : 0.28;
          this.fx.tankSmoke(new THREE.Vector3(t.base.x, t.base.y + 1.4, t.base.z), heavy);
        }
      }
    }
    this.fx.ambient(dt, this.wind, this.windSpeed, this.rig.look);
    this.fx.update(dt, this.wind);
    this.rig.update(dt, this.time);
    if (this.state !== 'title') this.updateHUD();
    this.ui.update(dt, this.camera);
  }

  updateHUD() {
    const p = this.player, e = this.enemy;
    this.ui.setWind(this.windSpeed, this.windBearing, bearingTo(this.camera.position, this.rig.look));
    this.ui.setAim(p.aimAz, p.aimEl);
    this.ui.drawMinimap(this.world, p, e, p.aimAz, this.impacts);
    const dist = Math.hypot(e.base.x - p.base.x, e.base.z - p.base.z) * M_PER_UNIT;
    this.ui.setDistance(Math.round(dist / 10) * 10, Math.round((e.base.y - p.base.y) * M_PER_UNIT));
    if (this.moveRing.visible) {
      this.moveRing.position.set(p.base.x, p.base.y + 0.15, p.base.z);
      const r = Math.max(0.5, this.fuel * MOVE_RANGE);
      this.moveRing.scale.set(r, r, 1);
    }
  }
}
