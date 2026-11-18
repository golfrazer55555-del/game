// 배경: 하늘, 해, 땅(도로·인도·부지), 멀리 보이는 도시
import * as THREE from 'three';
import { VS, GX, GZ, SITE } from './config.js';
import { Rng, hash3 } from './util.js';

export function createEnvironment(scene, quality) {
  const env = {};
  const W = GX * VS, D = GZ * VS;
  const center = new THREE.Vector3(W / 2, 0, D / 2);
  env.center = center;

  // 하늘 돔
  const skyGeo = new THREE.SphereGeometry(900, 24, 12);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x4f8fd6) }, mid: { value: new THREE.Color(0xa9cbe8) }, bottom: { value: new THREE.Color(0xe7dfcf) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bottom, smoothstep(0.0, -0.2, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.copy(center);
  sky.renderOrder = -1;
  scene.add(sky);
  env.sky = sky;
  scene.fog = new THREE.Fog(0xb9d0e4, 70, 330);

  // 빛
  const hemi = new THREE.HemisphereLight(0xdce9ff, 0x7a705e, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.65);
  sun.position.set(center.x - 34, 62, center.z - 46);
  sun.target.position.copy(center);
  scene.add(sun, sun.target);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 190;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  env.sun = sun; env.hemi = hemi;

  // 부지 바닥 텍스처 (블록 하나 = 2픽셀)
  const PX = 2;
  const cv = document.createElement('canvas');
  cv.width = GX * PX; cv.height = GZ * PX;
  const g = cv.getContext('2d');
  const img = g.createImageData(cv.width, cv.height);
  const L = SITE.lot;
  const put = (px, pz, r, gg, b) => { const o = (pz * cv.width + px) * 4; img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255; };
  for (let pz = 0; pz < cv.height; pz++) for (let px = 0; px < cv.width; px++) {
    const x = px / PX, z = pz / PX;
    const n = hash3(px >> 1, 7, pz >> 1);
    let c;
    if (z < SITE.roadZ1) {
      c = [62, 64, 66];
      // 중앙선 (노란 점선)
      if (z >= 9 && z < 10 && (Math.floor(x / 6) % 2 === 0)) c = [222, 178, 52];
      if (z >= 0 && z < 1) c = [200, 200, 196];
    } else if (z < SITE.walkZ1) {
      const tx = Math.floor(x) % 4 === 0, tz = Math.floor(z) % 4 === 2;
      c = tx || tz ? [150, 146, 138] : [184, 180, 170];
    } else if (x >= L.x0 - 1 && x <= L.x1 + 1 && z >= L.z0 - 1 && z <= L.z1 + 1) {
      c = [134, 108, 78];
      if (hash3(px >> 2, 3, pz >> 2) > 0.8) c = [118, 94, 68];
    } else {
      c = [150, 150, 144];
      if (hash3(px >> 3, 9, pz >> 3) > 0.86) c = [112, 136, 84];
    }
    const k = 0.92 + n * 0.12;
    put(px, pz, c[0] * k, c[1] * k, c[2] * k);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, 0, D / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  env.ground = ground;

  // 바깥 땅과 도로 연장
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ color: 0x8e8d86 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.set(W / 2, -0.02, D / 2);
  outer.receiveShadow = quality.shadows;
  scene.add(outer);
  // 왕복 도로와 건너편 인도 (부지 텍스처 바깥으로 이어짐)
  const roadW = SITE.roadZ1 * VS + 16;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(1400, roadW), new THREE.MeshLambertMaterial({ color: 0x3e4042 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(W / 2, -0.012, SITE.roadZ1 * VS - roadW / 2);
  road.receiveShadow = quality.shadows;
  scene.add(road);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(1400, 4), new THREE.MeshLambertMaterial({ color: 0xa9a59b }));
  walk.rotation.x = -Math.PI / 2;
  walk.position.set(W / 2, -0.011, SITE.roadZ1 * VS - roadW - 2);
  scene.add(walk);
  // 차선
  const lines = new THREE.Mesh(new THREE.PlaneGeometry(1400, 0.15), new THREE.MeshBasicMaterial({ color: 0xdeb234 }));
  lines.rotation.x = -Math.PI / 2;
  lines.position.set(W / 2, -0.008, SITE.roadZ1 * VS - 8);
  scene.add(lines);

  // 먼 도시
  env.city = createCity(center);
  scene.add(env.city);
  return env;
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#6d7f8f'; g.fillRect(3, 4, 10, 7);
  g.fillStyle = '#93a8b8'; g.fillRect(3, 4, 10, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function createCity(center) {
  const rng = new Rng(4242);
  const pos = [], uv = [], col = [], nor = [], idx = [];
  const palette = [[0.82, 0.8, 0.74], [0.75, 0.72, 0.66], [0.62, 0.45, 0.38], [0.58, 0.66, 0.74], [0.86, 0.84, 0.78], [0.7, 0.74, 0.7]];
  const addBox = (x0, z0, w, d, h, c) => {
    const x1 = x0 + w, z1 = z0 + d;
    const faces = [
      [[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], w],
      [[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], w],
      [[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], d],
      [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], d],
      [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], 0],
    ];
    for (const [a, b, cc, dd, n, len] of faces) {
      const base = pos.length / 3;
      pos.push(...a, ...b, ...cc, ...dd);
      for (let k = 0; k < 4; k++) nor.push(...n);
      if (len) uv.push(0, 0, len / 3, 0, len / 3, h / 3, 0, h / 3); else uv.push(0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02);
      const shade = n[1] ? 1.05 : 1;
      for (let k = 0; k < 4; k++) col.push(c[0] * shade, c[1] * shade, c[2] * shade);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  const W = GX * VS, D = GZ * VS;
  const blocks = [];
  // 길 건너편 (넓은 도로 너머)
  for (let x = -120; x < W + 120; x += 0) { const w = 9 + rng.next() * 14, d = 12 + rng.next() * 12; blocks.push([x, -22 - d, w, d]); x += w + 2 + rng.next() * 4; }
  // 뒤쪽
  for (let x = -120; x < W + 120; x += 0) { const w = 10 + rng.next() * 16; blocks.push([x, D + 14 + rng.next() * 8, w, 12 + rng.next() * 14]); x += w + 3 + rng.next() * 5; }
  // 양옆
  for (let z = 10; z < D + 10; z += 0) { const d = 10 + rng.next() * 12; blocks.push([-20 - (12 + rng.next() * 10), z, 12 + rng.next() * 8, d]); blocks.push([W + 18 + rng.next() * 4, z, 12 + rng.next() * 8, d]); z += d + 4; }
  // 더 먼 곳
  for (let k = 0; k < 70; k++) {
    const a = rng.next() * Math.PI * 2, r = 110 + rng.next() * 160;
    blocks.push([center.x + Math.cos(a) * r, center.z + Math.sin(a) * r, 14 + rng.next() * 22, 14 + rng.next() * 22, true]);
  }
  for (const [x, z, w, d, far] of blocks) {
    const h = far ? 16 + rng.next() * 46 : 6 + rng.next() * (rng.next() < 0.15 ? 26 : 14);
    addBox(x, z, w, d, h, rng.pick(palette));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshLambertMaterial({ map: windowTexture(), vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  return mesh;
}
