// three.js view of the rat in MuJoCo coordinates (z up): primitives posed
// from geom_xpos / geom_xmat, a fading ghost trail and a root trace colored by
// the commanded symbol, and a camera that follows the body.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Frame, GeomInfo } from '../sim/protocol';

const GEOM_SPHERE = 2, GEOM_CAPSULE = 3, GEOM_ELLIPSOID = 4, GEOM_CYLINDER = 5, GEOM_BOX = 6;
const N_GHOSTS = 5;
const GHOST_EVERY = 30; // control steps between ghosts (as on the project page)
const TRACE_LEN = 3000;

function geometryFor(g: GeomInfo): THREE.BufferGeometry {
  const [a, b, c] = g.size;
  switch (g.type) {
    case GEOM_SPHERE: return new THREE.SphereGeometry(a, 16, 12);
    case GEOM_ELLIPSOID: return new THREE.SphereGeometry(1, 16, 12).scale(a, b, c);
    case GEOM_CAPSULE: return new THREE.CapsuleGeometry(a, 2 * b, 6, 12).rotateX(Math.PI / 2);
    case GEOM_CYLINDER: return new THREE.CylinderGeometry(a, a, 2 * b, 12).rotateX(Math.PI / 2);
    case GEOM_BOX: return new THREE.BoxGeometry(2 * a, 2 * b, 2 * c);
    default: return new THREE.SphereGeometry(Math.max(a, 1e-3), 8, 6);
  }
}

function checkerTexture(): THREE.Texture {
  // MuJoCo arena: builtin checker rgb1 (.1 .2 .3), rgb2 (.2 .3 .4), 1 m tile.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 2;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgb(26,51,77)'; ctx.fillRect(0, 0, 2, 2);
  ctx.fillStyle = 'rgb(51,77,102)'; ctx.fillRect(0, 0, 1, 1); ctx.fillRect(1, 1, 1, 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class Body {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private meshes: THREE.Mesh[];

  constructor(geometries: THREE.BufferGeometry[], opacity = 1) {
    this.material = new THREE.MeshStandardMaterial({
      color: 0x1e8092, roughness: 0.55, metalness: 0.05,
      transparent: opacity < 1, opacity, depthWrite: opacity === 1,
    });
    this.meshes = geometries.map((geo) => {
      const m = new THREE.Mesh(geo, this.material);
      m.matrixAutoUpdate = false;
      m.castShadow = opacity === 1;
      this.group.add(m);
      return m;
    });
  }

  pose(xpos: Float32Array, xmat: Float32Array): void {
    this.meshes.forEach((m, i) => {
      const r = xmat.subarray(9 * i, 9 * i + 9), p = xpos.subarray(3 * i, 3 * i + 3);
      m.matrix.set(r[0], r[1], r[2], p[0], r[3], r[4], r[5], p[1], r[6], r[7], r[8], p[2],
        0, 0, 0, 1);
      m.matrixWorldNeedsUpdate = true;
    });
  }
}

export class RatScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
  private controls: OrbitControls;
  private live: Body;
  private ghosts: Body[] = [];
  private trace: THREE.Line;
  private tracePos = new Float32Array(TRACE_LEN * 3);
  private traceCol = new Float32Array(TRACE_LEN * 3);
  private traceN = 0;
  private lastStep = -1;
  private target = new THREE.Vector3();
  private colors: THREE.Color[];
  private raf = 0;
  private resizeObs: ResizeObserver;

  constructor(private host: HTMLElement, geoms: GeomInfo[], palette: number[][]) {
    this.colors = palette.map((c) => new THREE.Color(c[0], c[1], c[2]));
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0e1a26);
    this.scene.fog = new THREE.Fog(0x0e1a26, 2.5, 7);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(0.55, -0.55, 0.38);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 3;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x1a2633, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.4, -0.3, 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -0.6, right: 0.6, top: 0.6, bottom: -0.6 });
    this.scene.add(sun, sun.target);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.9 }));
    floor.receiveShadow = true;
    this.scene.add(floor);

    const geometries = geoms.map(geometryFor);
    this.live = new Body(geometries);
    this.scene.add(this.live.group);
    for (let i = 0; i < N_GHOSTS; i++) {
      const g = new Body(geometries, 0.4 * (1 - i / N_GHOSTS) + 0.08);
      g.group.visible = false;
      this.ghosts.push(g);
      this.scene.add(g.group);
    }

    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracePos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(this.traceCol, 3));
    tg.setDrawRange(0, 0);
    this.trace = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.trace.frustumCulled = false;
    this.scene.add(this.trace);

    // Keep the sun and its shadow frustum over the body.
    this.scene.userData.sun = sun;
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.host;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(f: Frame): void {
    if (f.step < this.lastStep) this.clearHistory();
    const color = this.colors[f.code] ?? this.colors[8];
    this.live.pose(f.xpos, f.xmat);
    this.live.material.color.lerp(color, 0.15);

    // Ghost trail: a frozen copy every GHOST_EVERY control steps.
    if (f.step > 0 && Math.floor(f.step / GHOST_EVERY) > Math.floor(this.lastStep / GHOST_EVERY)) {
      const g = this.ghosts.pop()!;
      g.pose(f.xpos, f.xmat);
      g.material.color.copy(color);
      g.group.visible = true;
      this.ghosts.unshift(g);
      this.ghosts.forEach((b, i) => { b.material.opacity = 0.4 * (1 - i / N_GHOSTS) + 0.08; });
    }

    // Root trace on the floor.
    if (f.step !== this.lastStep) {
      if (this.traceN === TRACE_LEN) {
        this.tracePos.copyWithin(0, 3); this.traceCol.copyWithin(0, 3); this.traceN -= 1;
      }
      const k = 3 * this.traceN;
      this.tracePos.set([f.root[0], f.root[1], 0.001], k);
      this.traceCol.set([color.r, color.g, color.b], k);
      this.traceN += 1;
      const geo = this.trace.geometry;
      geo.setDrawRange(0, this.traceN);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
    this.lastStep = f.step;

    // Follow: move camera and orbit target together.
    this.target.set(f.root[0], f.root[1], 0.04);
    const delta = this.target.clone().sub(this.controls.target).multiplyScalar(0.08);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    const sun = this.scene.userData.sun as THREE.DirectionalLight;
    sun.position.set(f.root[0] + 0.4, f.root[1] - 0.3, 2);
    sun.target.position.set(f.root[0], f.root[1], 0);
  }

  clearHistory(): void {
    this.ghosts.forEach((g) => { g.group.visible = false; });
    this.traceN = 0;
    this.trace.geometry.setDrawRange(0, 0);
    this.lastStep = -1;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
