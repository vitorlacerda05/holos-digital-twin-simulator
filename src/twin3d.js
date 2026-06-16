import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { POSE_CONNECTIONS } from './pose.js';

const NUM = 33;
const UP = new THREE.Vector3(0, 1, 0);
const GHOST_LEAD = 0.40;
const MAX_PEOPLE = 1;

// paleta por pessoa: { base, emissive, node, ghost }
const PALETTE = [
  { base: 0x0a2e3a, emi: 0x22d3ee, hot: 0x67e8f9, ghost: 0x8b5cf6, rim: [0.13, 0.82, 0.95] },
  { base: 0x0a3a2a, emi: 0x34d399, hot: 0x86efac, ghost: 0x22d3ee, rim: [0.20, 0.92, 0.60] },
  { base: 0x241a3a, emi: 0xa78bfa, hot: 0xc4b5fd, ghost: 0xf472b6, rim: [0.65, 0.55, 0.98] },
];

const LIMBS = [
  [11, 13, 0.058, 0.046], [13, 15, 0.046, 0.032],
  [12, 14, 0.058, 0.046], [14, 16, 0.046, 0.032],
  [23, 25, 0.090, 0.062], [25, 27, 0.062, 0.045],
  [24, 26, 0.090, 0.062], [26, 28, 0.062, 0.045],
  [27, 29, 0.042, 0.036], [29, 31, 0.036, 0.030], [27, 31, 0.042, 0.030],
  [28, 30, 0.042, 0.036], [30, 32, 0.036, 0.030], [28, 32, 0.042, 0.030],
];
const JOINT_OVERRIDE = { 15: 0.052, 16: 0.052 };
const SYNC_IDX = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const SPHERE = new THREE.SphereGeometry(1, 18, 18);

// ============ um avatar (uma pessoa) ============
class Avatar {
  constructor(scene, pal, clip) {
    this.pal = pal;
    this.group = new THREE.Group(); scene.add(this.group);
    this.active = false; this.hasPose = false; this._havePred = false;
    this.syncError = 0; this.smooth = 0.55; this.ghostOn = false; this._lastT = performance.now();

    this.points = mk(); this.prev = mk(); this.vel = mk(); this.pred = mk(); this.predNow = mk();
    this.tmpV = new THREE.Vector3(); this.tmpR = new THREE.Vector3(); this.tmpF = new THREE.Vector3(); this.tmpM = new THREE.Matrix4();

    // materiais próprios (cor por pessoa)
    this._rimCol = { value: new THREE.Color(pal.rim[0], pal.rim[1], pal.rim[2]) };
    this._rimBoost = { value: 2.4 };
    const flesh = new THREE.MeshStandardMaterial({ color: pal.base, emissive: pal.emi, emissiveIntensity: 0.55, metalness: 0.55, roughness: 0.35, transparent: true, opacity: 0.94 });
    flesh.clippingPlanes = [clip];
    flesh.onBeforeCompile = (sh) => {
      sh.uniforms.uRimCol = this._rimCol; sh.uniforms.uRimBoost = this._rimBoost;
      sh.fragmentShader = 'uniform vec3 uRimCol;\nuniform float uRimBoost;\n' + sh.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float _fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
         totalEmissiveRadiance += uRimCol * _fres * uRimBoost;`);
    };
    const node = new THREE.MeshStandardMaterial({ color: pal.hot, emissive: pal.emi, emissiveIntensity: 2.4, roughness: 0.3, metalness: 0.2 });
    node.clippingPlanes = [clip];
    const ghost = new THREE.MeshStandardMaterial({ color: 0x141229, emissive: pal.ghost, emissiveIntensity: 1.3, transparent: true, opacity: 0.22, depthWrite: false, metalness: 0.2, roughness: 0.5 });
    ghost.clippingPlanes = [clip];
    this.flesh = flesh;

    // membros (real + fantasma)
    this.limbs = []; this.gLimbs = [];
    for (const [a, b, ra, rb] of LIMBS) {
      const geo = new THREE.CylinderGeometry(rb, ra, 1, 16, 1, false); geo.translate(0, 0.5, 0);
      this.limbs.push(addMesh(this.group, geo, flesh, { a, b }));
      this.gLimbs.push(addMesh(this.group, geo, ghost, { a, b }));
    }
    // juntas (real + fantasma)
    const jr = {};
    for (const [a, b, ra, rb] of LIMBS) { jr[a] = Math.max(jr[a] || 0, ra * 1.05); jr[b] = Math.max(jr[b] || 0, rb * 1.05); }
    Object.assign(jr, JOINT_OVERRIDE);
    this.bodyJoints = []; this.gJoints = [];
    for (const k of Object.keys(jr)) {
      const i = +k;
      const m = addMesh(this.group, SPHERE, flesh, { i }); m.mesh.scale.setScalar(jr[k]); this.bodyJoints.push(m);
      const g = addMesh(this.group, SPHERE, ghost, { i }); g.mesh.scale.setScalar(jr[k]); this.gJoints.push(g);
    }
    // nós de energia
    this.nodes = [];
    for (const i of [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const m = addMesh(this.group, SPHERE, node, { i }); m.mesh.scale.setScalar(0.022); this.nodes.push(m);
    }
    this.torso = addMesh(this.group, SPHERE, flesh, {}).mesh; this.torso.matrixAutoUpdate = false;
    const neckGeo = new THREE.CylinderGeometry(0.04, 0.052, 1, 14); neckGeo.translate(0, 0.5, 0);
    this.neck = addMesh(this.group, neckGeo, flesh, {}).mesh;
    this.head = addMesh(this.group, SPHERE, flesh, {}).mesh;
  }

  setSmoothing(v) { this.smooth = v; }
  setGhost(v) { this.ghostOn = v; if (!v) { this.gLimbs.forEach(g => g.mesh.visible = false); this.gJoints.forEach(g => g.mesh.visible = false); } }
  setAlarm(t) {
    t = Math.max(0, Math.min(1, t));
    const r = this.pal.rim;
    this._rimCol.value.setRGB(r[0] + (1 - r[0]) * t, r[1] - r[1] * t, r[2] - r[2] * t);
    this._rimBoost.value = 2.4 + t * 2.5;
  }

  update(world, mirror) {
    const a = 1 - this.smooth, mx = mirror ? -1 : 1;
    const reactivate = !this.active;
    for (let i = 0; i < NUM; i++) {
      const lm = world[i];
      this.tmpV.set(lm.x * mx, -lm.y, -lm.z);
      if (reactivate) this.points[i].copy(this.tmpV); else this.points[i].lerp(this.tmpV, a);
    }
    this.active = true; this.hasPose = true;

    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.008, (now - this._lastT) / 1000)); this._lastT = now;
    if (this._havePred && !reactivate) {
      let e = 0; for (const i of SYNC_IDX) e += this.points[i].distanceTo(this.predNow[i]);
      this.syncError = e / SYNC_IDX.length;
    }
    const va = Math.max(0.05, a * 0.7);
    for (let i = 0; i < NUM; i++) {
      if (reactivate) this.vel[i].set(0, 0, 0);
      else { this.tmpV.subVectors(this.points[i], this.prev[i]).multiplyScalar(1 / dt); this.vel[i].lerp(this.tmpV, va); }
      this.prev[i].copy(this.points[i]);
      this.pred[i].copy(this.points[i]).addScaledVector(this.vel[i], GHOST_LEAD);
      this.predNow[i].copy(this.points[i]).addScaledVector(this.vel[i], dt);
    }
    this._havePred = true;
    this._apply();
  }

  _orient(item, A, B) {
    this.tmpV.subVectors(B, A); const len = this.tmpV.length();
    if (len < 1e-4) { item.mesh.visible = false; return; }
    item.mesh.visible = true; item.mesh.position.copy(A);
    item.mesh.quaternion.setFromUnitVectors(UP, this.tmpV.normalize()); item.mesh.scale.set(1, len, 1);
  }
  _mid(i, j, o) { return o.copy(this.points[i]).add(this.points[j]).multiplyScalar(0.5); }

  _apply() {
    const P = this.points;
    for (const L of this.limbs) this._orient(L, P[L.a], P[L.b]);
    for (const J of this.bodyJoints) { J.mesh.position.copy(P[J.i]); J.mesh.visible = true; }
    for (const N of this.nodes) { N.mesh.position.copy(P[N.i]); N.mesh.visible = true; }
    if (this.ghostOn) {
      for (const L of this.gLimbs) this._orient(L, this.pred[L.a], this.pred[L.b]);
      for (const J of this.gJoints) { J.mesh.position.copy(this.pred[J.i]); J.mesh.visible = true; }
    }
    const midSh = this._mid(11, 12, new THREE.Vector3());
    const midHip = this._mid(23, 24, new THREE.Vector3());
    const up = this.tmpV.subVectors(midSh, midHip); const tl = up.length() || 0.001; up.normalize();
    this.tmpR.subVectors(P[12], P[11]); const sw = this.tmpR.length() || 0.3; this.tmpR.normalize();
    this.tmpF.crossVectors(this.tmpR, up).normalize(); this.tmpR.crossVectors(up, this.tmpF).normalize();
    const c = midSh.clone().add(midHip).multiplyScalar(0.5);
    this.tmpM.makeBasis(this.tmpR, up, this.tmpF);
    this.torso.matrix.copy(this.tmpM).scale(new THREE.Vector3(sw * 0.44, tl * 0.58, sw * 0.26)).setPosition(c);
    this.torso.visible = true;
    const headC = this._mid(7, 8, new THREE.Vector3());
    this.head.position.copy(headC); this.head.scale.set(0.105, 0.125, 0.115); this.head.visible = true;
    this._orient({ mesh: this.neck }, midSh, headC.clone().addScaledVector(up, -0.07));
    this._midSh = midSh; this._right = this.tmpR.clone(); this._sw = sw; // p/ rótulos
  }

  hide() {
    this.active = false; this.hasPose = false; this._havePred = false;
    for (const L of this.limbs) L.mesh.visible = false;
    for (const J of this.bodyJoints) J.mesh.visible = false;
    for (const N of this.nodes) N.mesh.visible = false;
    for (const L of this.gLimbs) L.mesh.visible = false;
    for (const J of this.gJoints) J.mesh.visible = false;
    this.torso.visible = this.neck.visible = this.head.visible = false;
  }
}

function mk() { return Array.from({ length: NUM }, () => new THREE.Vector3()); }
function addMesh(group, geo, mat, extra) {
  const mesh = new THREE.Mesh(geo, mat); mesh.visible = false; mesh.frustumCulled = false; group.add(mesh);
  return Object.assign({ mesh }, extra);
}

// ============ cena + pool de avatares ============
export class Twin3D {
  constructor(canvas) {
    this.canvas = canvas; this.mirror = true; this.trailOn = false; this.labelsOn = true;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.15;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene(); this.scene.fog = new THREE.FogExp2(0x04070d, 0.07);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); this.camera.position.set(0.3, 0.35, 3.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0); this.controls.minDistance = 1.3; this.controls.maxDistance = 9;
    this.controls.autoRotateSpeed = 1.2;

    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100); this.scanning = false;
    this._buildEnvironment(); this._buildTrail(); this._buildLabels();

    this.avatars = [];
    for (let i = 0; i < MAX_PEOPLE; i++) this.avatars.push(new Avatar(this.scene, PALETTE[i], this.clip));
    this.activeCount = 0;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.95, 0.6, 0.55);
    this.composer.addPass(this.bloom);
    this.resize();
  }

  _buildEnvironment() {
    this.scene.add(new THREE.AmbientLight(0x3a5a80, 0.7));
    const key = new THREE.PointLight(0x22d3ee, 28, 30); key.position.set(2, 3, 3); this.scene.add(key);
    const rim = new THREE.PointLight(0x6366f1, 22, 30); rim.position.set(-3, 2, -2); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4); fill.position.set(0, 2, 4); this.scene.add(fill);
    const grid = new THREE.GridHelper(20, 40, 0x22d3ee, 0x14304a);
    grid.material.transparent = true; grid.material.opacity = 0.35; grid.position.y = -1.0; this.scene.add(grid);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.35, 64),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.13, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.99; this.scene.add(ring);
    this.scanDisc = new THREE.Mesh(new THREE.RingGeometry(0.0, 0.85, 48),
      new THREE.MeshBasicMaterial({ color: 0x9bf6ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
    this.scanDisc.rotation.x = -Math.PI / 2; this.scanDisc.visible = false; this.scene.add(this.scanDisc);
  }

  _buildTrail() {
    this.trail = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POSE_CONNECTIONS.length * 2 * 3), 3));
    for (let i = 0; i < 10; i++) {
      const seg = new THREE.LineSegments(geo.clone(), new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0 }));
      seg.visible = false; this.scene.add(seg); this.trail.push(seg);
    }
    this.trailHead = 0; this.trailTick = 0;
  }

  _buildLabels() {
    this.labelRenderer = new CSS2DRenderer();
    const el = this.labelRenderer.domElement;
    el.style.position = 'absolute'; el.style.top = '0'; el.style.left = '0'; el.style.pointerEvents = 'none';
    this.canvas.parentElement.appendChild(el);
    const mkl = (name, i) => { const d = document.createElement('div'); d.className = 'tw-label'; const o = new CSS2DObject(d); this.scene.add(o); return { name, i, el: d, obj: o }; };
    this.labelDefs = [mkl('elbowL', 13), mkl('elbowR', 14), mkl('kneeL', 25), mkl('kneeR', 26), mkl('torso', -1)];
  }

  setMirror(v) { this.mirror = v; }
  setAutoRotate(v) { this.controls.autoRotate = v; }
  setSmoothing(v) { this.avatars.forEach(a => a.setSmoothing(v)); }
  setGhost(v) { this.avatars.forEach(a => a.setGhost(v)); }
  setTrail(v) { this.trailOn = v; if (!v) this.trail.forEach(s => (s.visible = false)); }
  setAnnotationsVisible(v) { this.labelsOn = v; this.labelDefs.forEach(l => (l.el.style.display = v ? '' : 'none')); }
  setAnnotations(map) { for (const l of this.labelDefs) if (map[l.name] != null) l.el.textContent = map[l.name]; }
  setAlarm(t) { this.avatars[0].setAlarm(t); this.labelDefs.forEach(l => l.el.classList.toggle('alarm', t > 0.4)); }
  get syncError() { return this.avatars[0].syncError; }

  startScan() { this.scanning = true; this._scanStart = performance.now(); this.clip.constant = -1.2; }

  // worldList: array de poses (uma por pessoa)
  updatePoses(worldList) {
    const n = Math.min(MAX_PEOPLE, worldList ? worldList.length : 0);
    const firstEver = this.activeCount === 0 && n > 0;
    for (let i = 0; i < MAX_PEOPLE; i++) {
      if (i < n && worldList[i] && worldList[i].length >= NUM) this.avatars[i].update(worldList[i], this.mirror);
      else this.avatars[i].hide();
    }
    this.activeCount = n;
    if (firstEver) this.startScan();
    this._updateLabels();
  }

  _updateLabels() {
    const a = this.avatars[0];
    if (!a.active) { for (const l of this.labelDefs) l.el.textContent = ''; return; }
    for (const l of this.labelDefs) {
      if (l.i === -1) l.obj.position.copy(a._midSh).addScaledVector(a._right, a._sw * 0.6);
      else l.obj.position.copy(a.points[l.i]).add(new THREE.Vector3(0.05, 0.05, 0));
    }
  }

  _captureTrail() {
    const a = this.avatars[0];
    if (!this.trailOn || !a.active) return;
    if (++this.trailTick % 4 !== 0) return;
    const seg = this.trail[this.trailHead]; const pos = seg.geometry.getAttribute('position');
    for (let k = 0; k < POSE_CONNECTIONS.length; k++) {
      const [i, j] = POSE_CONNECTIONS[k];
      pos.setXYZ(k * 2, a.points[i].x, a.points[i].y, a.points[i].z);
      pos.setXYZ(k * 2 + 1, a.points[j].x, a.points[j].y, a.points[j].z);
    }
    pos.needsUpdate = true; seg.visible = true; seg.material.opacity = 0.45;
    this.trailHead = (this.trailHead + 1) % this.trail.length;
  }

  render() {
    const now = performance.now();
    if (this.scanning) {
      const t = (now - this._scanStart) / 1500;
      if (t >= 1) { this.scanning = false; this.clip.constant = 100; this.scanDisc.visible = false; }
      else { const y = THREE.MathUtils.lerp(-1.2, 0.95, t); this.clip.constant = y; this.scanDisc.position.y = y; this.scanDisc.visible = true; this.scanDisc.scale.setScalar(1 + 0.12 * Math.sin(now * 0.02)); }
    }
    for (const s of this.trail) if (s.visible) { s.material.opacity *= 0.92; if (s.material.opacity < 0.02) s.visible = false; }
    this._captureTrail();
    this.controls.update();
    this.composer.render();
    if (this.labelsOn) this.labelRenderer.render(this.scene, this.camera);
  }

  hidePose() { this.avatars.forEach(a => a.hide()); this.activeCount = 0; for (const l of this.labelDefs) l.el.textContent = ''; }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.bloom.setSize(w, h); this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
}
