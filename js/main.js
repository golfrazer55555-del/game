// 진입점: 렌더러, 조명, 하늘, 게임 루프
import * as THREE from 'three';
import { Game } from './game.js';
import { W, D } from './config.js';

function start() {
  const canvas = document.getElementById('view');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    document.getElementById('nogl').hidden = false;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const HAZE = 0xc4b99f;
  scene.background = new THREE.Color(HAZE);
  scene.fog = new THREE.Fog(HAZE, 120, 340);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(450, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x6f8797) },
        mid: { value: new THREE.Color(HAZE) },
        low: { value: new THREE.Color(0x7d725d) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.02, 0.6, h)) : mix(mid, low, smoothstep(0.0, -0.25, h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xdde4e6, 0x5a4934, 1.3);
  const sun = new THREE.DirectionalLight(0xfff0d4, 2.7);
  sun.position.set(W / 2 - 70, 110, D / 2 + 55);
  sun.target.position.set(W / 2, 0, D / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -100; sc.right = 100; sc.top = 100; sc.bottom = -100; sc.near = 10; sc.far = 330;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(hemi, sun, sun.target);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 700);
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  const game = new Game(scene, camera);
  window.__game = game; // 디버그·테스트용
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    game.update(dt);
    sky.position.copy(camera.position);
    renderer.render(scene, camera);
  });
}

const hot = window.claude && window.claude.hot;
if (hot && hot.ready) hot.ready(() => start());
else start();
