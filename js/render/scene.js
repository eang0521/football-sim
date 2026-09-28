import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { drawField } from './fieldTexture.js';
import { createPlayerMesh, animatePlayer } from './playerModel.js';

const W = 53.33, MID = W / 2;
// frame (offense-relative) -> world. dir = +1 if offense attacks +X.
export function toWorld(x, y, dir) {
  const X = dir > 0 ? x : 100 - x, Y = dir > 0 ? y : W - y;
  return { x: X - 50, z: MID - Y };
}

export class FieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1624);
    scene.fog = new THREE.Fog(0x0d1624, 160, 380);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1000);
    this.camera.position.set(0, 30, 60);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 6; this.controls.maxDistance = 220;
    this.camMode = 'broadcast';
    this.camPos = new THREE.Vector3(0, 30, 60);
    this.camLook = new THREE.Vector3();

    // lights
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a4020, 0.9));
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-40, 90, 50);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 40; sc.bottom = -40; sc.near = 10; sc.far = 250;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    scene.add(sun.target);

    this.buildStadium();
    this.players = new Map();
    this.overlay = new THREE.Group();
    scene.add(this.overlay);
    this.art = new THREE.Group();
    scene.add(this.art);
    this.showArt = true;
    this.showNames = false;
    this.labels = new Map();

    // Ball
    const bg = new THREE.SphereGeometry(0.1, 16, 12);
    const ball = this.ball = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x7a3b12, roughness: 0.55 }));
    ball.scale.set(1.55, 1, 1);
    ball.castShadow = true;
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lace.position.y = 0.1;
    ball.add(lace);
    scene.add(ball);
    const bs = this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.18, 12), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
    bs.rotation.x = -Math.PI / 2; bs.position.y = 0.025;
    scene.add(bs);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  buildStadium() {
    const s = this.scene;
    // surrounding turf + track
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(170, 100), new THREE.MeshStandardMaterial({ color: 0x255f2a, roughness: 1 }));
    apron.rotation.x = -Math.PI / 2; apron.position.y = -0.02; apron.receiveShadow = true;
    s.add(apron);
    const track = new THREE.Mesh(new THREE.RingGeometry(1, 1, 4), new THREE.MeshBasicMaterial());
    track.visible = false;
    // stands: tiered boxes on all four sides
    const standMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.95 });
    const seatMats = [0x3b4a6b, 0x6b2f35, 0x2f5b4a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
    const crowd = this.crowdTexture();
    const crowdMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 });
    const addTier = (len, depth, x, z, rotY, tier) => {
      const h = 5;
      const g = new THREE.BoxGeometry(len, h, depth);
      const m = new THREE.Mesh(g, [standMat, standMat, crowdMat, standMat, crowdMat, standMat]);
      m.position.set(x, tier * 4.5 + h / 2 - 0.5, z);
      m.rotation.y = rotY;
      m.receiveShadow = true;
      s.add(m);
    };
    for (let t = 0; t < 5; t++) {
      const off = 42 + t * 6;
      addTier(150 + t * 10, 6, 0, off, 0, t);
      addTier(150 + t * 10, 6, 0, -off, 0, t);
      addTier(70 + t * 10, 6, -(76 + t * 6), 0, Math.PI / 2, t);
      addTier(70 + t * 10, 6, 76 + t * 6, 0, Math.PI / 2, t);
    }
    // light towers
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.4 });
    for (const [x, z] of [[-70, 70], [70, 70], [-70, -70], [70, -70]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 55, 8), poleMat);
      pole.position.set(x, 27, z);
      s.add(pole);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 1), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
      bank.position.set(x, 55, z); bank.lookAt(0, 0, 0);
      s.add(bank);
    }
    // goal posts
    const gp = new THREE.MeshStandardMaterial({ color: 0xf2d027, roughness: 0.4, metalness: 0.2 });
    for (const x of [-60, 60]) {
      const grp = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.33, 8), gp);
      base.position.set(x + Math.sign(x) * 0.8, 1.66, 0);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8), gp);
      arm.rotation.z = Math.PI / 2; arm.position.set(x + Math.sign(x) * 0.4, 3.33, 0);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.17, 8), gp);
      bar.rotation.x = Math.PI / 2; bar.position.set(x, 3.33, 0);
      grp.add(base, arm, bar);
      for (const z of [-3.08, 3.08]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 11.7, 8), gp);
        up.position.set(x, 3.33 + 5.85, z);
        grp.add(up);
      }
      grp.traverse((m) => { m.castShadow = true; });
      s.add(grp);
    }
    // field plane (texture set per game)
    this.fieldMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, W), this.fieldMat);
    field.rotation.x = -Math.PI / 2; field.receiveShadow = true;
    s.add(field);
    // pylons
    const pyl = new THREE.MeshStandardMaterial({ color: 0xff7a00 });
    for (const x of [-50, 50, -60, 60]) for (const z of [-MID, MID]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), pyl);
      p.position.set(x, 0.25, z); s.add(p);
    }
  }

  crowdTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#222833'; g.fillRect(0, 0, 512, 64);
    const cols = ['#c9c9c9', '#8a2b2b', '#2b4a8a', '#e0c341', '#3a7a3a', '#dddddd', '#555', '#a05a2c'];
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.fillRect(Math.random() * 512, Math.random() * 64, 3, 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 1);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  setTeams(home, away) {
    const cv = drawField(home, away);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    tex.generateMipmaps = true;
    if (this.fieldMat.map) this.fieldMat.map.dispose();
    this.fieldMat.map = tex;
    this.fieldMat.needsUpdate = true;
    this.teams = { home, away };
    for (const [, m] of this.players) this.scene.remove(m);
    this.players.clear();
    for (const [, l] of this.labels) l.remove();
    this.labels.clear();
  }

  meshFor(agent, team) {
    let m = this.players.get(agent.id);
    if (!m) {
      m = createPlayerMesh(agent.p, team);
      this.scene.add(m);
      this.players.set(agent.id, m);
    }
    return m;
  }

  setCamera(mode) {
    this.camMode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') {
      this.controls.target.copy(this.camLook);
      this.controls.update();
    }
  }

  // Line of scrimmage / first down overlays, and play art
  updateOverlays(sim, game) {
    this.overlay.clear();
    if (!sim || !game) return;
    const dir = sim.meta.dir;
    const mk = (x, color, width = 0.18) => {
      const w = toWorld(x, MID, dir);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, W), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(w.x, 0.03, 0);
      this.overlay.add(m);
    };
    if (sim.kind === 'scrimmage' || sim.kind === 'punt' || sim.kind === 'kneel') {
      mk(sim.los, 0x2e7bff);
      if (sim.firstDownX < 100 && sim.meta.type !== 'conversion') mk(sim.firstDownX, 0xffd400, 0.22);
    }
  }

  buildArt(sim) {
    this.art.clear();
    if (!sim || !this.showArt || sim.kind !== 'scrimmage') return;
    const dir = sim.meta.dir;
    const P = (x, y, h = 0.05) => { const w = toWorld(x, y, dir); return new THREE.Vector3(w.x, h, w.z); };
    const line = (pts, color, dashed = false) => {
      if (pts.length < 2 || pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return null;
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.9 })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const l = new THREE.Line(g, m);
      if (dashed) l.computeLineDistances();
      this.art.add(l);
      return l;
    };
    const arrowHead = (a, b, color) => {
      if (!a || !b || a.distanceTo(b) < 1e-3) return;
      const d = new THREE.Vector3().subVectors(b, a).normalize();
      const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(0.5);
      const back = d.clone().multiplyScalar(-0.8);
      const g = new THREE.BufferGeometry().setFromPoints([b.clone().add(back).add(side), b, b.clone().add(back).sub(side)]);
      this.art.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color })));
    };
    for (const a of sim.off) {
      if (a.role === 'route' && a.d.route) {
        const pts = [P(a.ax, a.ay), ...a.d.route.pts.map((p) => P(Math.min(p.x, a.x + 25), p.y))];
        // trim long final legs for readability
        const trimmed = [pts[0]];
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
          const seg = pts[i].distanceTo(pts[i - 1]);
          if (seg < 1e-3) continue;
          if (len + seg > 22) { trimmed.push(pts[i - 1].clone().lerp(pts[i], (22 - len) / seg)); break; }
          len += seg; trimmed.push(pts[i]);
        }
        const col = a.d.route.delay ? 0xffe066 : 0xffd000;
        line(trimmed, col);
        arrowHead(trimmed[trimmed.length - 2], trimmed[trimmed.length - 1], col);
      } else if (a.role === 'carrier' && sim.run) {
        const hole = P(sim.los + 2, sim.run.holeY);
        line([P(a.ax, a.ay), hole], 0xff5a36);
        arrowHead(P(a.ax, a.ay), hole, 0xff5a36);
      }
    }
    for (const d of sim.def) {
      if (d.role === 'zone' && d.d.zone) {
        const z = d.d.zone;
        const c = z.deep ? 0x3aa0ff : 0xa56bff;
        const ring = new THREE.Mesh(new THREE.RingGeometry(Math.min(z.r, 7) * 0.55 - 0.15, Math.min(z.r, 7) * 0.55, 32),
          new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
        const w = toWorld(z.x, z.y, dir);
        ring.rotation.x = -Math.PI / 2; ring.position.set(w.x, 0.04, w.z);
        this.art.add(ring);
        line([P(d.ax, d.ay), P(z.x, z.y)], c, true);
      } else if (d.role === 'man' && d.d.man) {
        line([P(d.ax, d.ay, 0.06), P(d.d.man.ax, d.d.man.ay, 0.06)], 0xff4fa3, true);
      } else if (d.role === 'rush' && d.d.blitz) {
        const qb = sim.qb();
        const tip = P(sim.los - 1, d.ay + (qb ? (qb.ay - d.ay) * 0.3 : 0));
        line([P(d.ax, d.ay), tip], 0xff3030);
        arrowHead(P(d.ax, d.ay), tip, 0xff3030);
      }
    }
    this.artBornAt = performance.now();
  }

  // Per-frame update from sim state
  update(sim, game, dt, now) {
    if (!sim || !this.teams) { this.renderer.render(this.scene, this.camera); return; }
    const dir = sim.meta.dir;
    const offTeam = this.teams[sim.meta.off], defTeam = this.teams[sim.meta.def];
    const seen = new Set();
    const B = sim.ball;
    const holder = B.state === 'held' ? B.holder : null;
    for (const a of sim.agents) {
      const team = a.side === 'O' ? offTeam : defTeam;
      const m = this.meshFor(a, team);
      seen.add(a.id);
      m.visible = true;
      const w = toWorld(a.x, a.y, dir);
      m.position.set(w.x, 0, w.z);
      const fx = Math.cos(a.face) * dir, fy = Math.sin(a.face) * dir;
      m.rotation.y = Math.atan2(fx, -fy);
      a.hasBall = holder === a;
      const spd = Math.hypot(a.vx, a.vy);
      animatePlayer(m, a, spd, dt);
      if (this.showNames) this.updateLabel(a, m);
    }
    for (const [id, m] of this.players) if (!seen.has(id)) m.visible = false;
    for (const [id, l] of this.labels) if (!seen.has(id) || !this.showNames) l.style.display = 'none';

    // ball
    const bw = toWorld(B.x, B.y, dir);
    this.ball.position.set(bw.x, Math.max(0.1, B.z), bw.z);
    if (B.state === 'air' || B.state === 'dead-air') {
      const vx = B.vx * dir, vz = -B.vy * dir;
      this.ball.rotation.set(0, Math.atan2(-vz, vx), 0);
      this.ball.rotateZ(Math.atan2(B.vz, Math.hypot(B.vx, B.vy)));
      this.ball.rotateX(B.rot || 0);
    } else if (holder) {
      const m = this.players.get(holder.id);
      if (m) this.ball.rotation.set(0, m.rotation.y + Math.PI / 2, 0.5);
    } else if (B.state === 'roll') {
      this.ball.rotation.x = B.rot;
    }
    this.ballShadow.position.set(bw.x, 0.025, bw.z);
    this.ballShadow.scale.setScalar(1 / (1 + B.z * 0.15));

    // penalty flags on the turf where the foul happened
    this.updateFlags(sim, dir);

    // fade play art after the snap
    if (this.art.children.length) {
      let op = 1;
      if (sim.phase === 'live') op = Math.max(0, 1 - sim.t / 1.2);
      else if (sim.phase === 'dead') op = 0;
      this.art.visible = op > 0.01;
      for (const c of this.art.children) if (c.material) c.material.opacity = 0.9 * op;
    }

    this.updateCamera(sim, dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateFlags(sim, dir) {
    if (!this.flagGroup) {
      this.flagGroup = new THREE.Group();
      this.scene.add(this.flagGroup);
      this.flagGeo = new THREE.BoxGeometry(0.6, 0.05, 0.5);
      this.flagMat = new THREE.MeshStandardMaterial({ color: 0xffd600, roughness: 0.6, emissive: 0x332a00 });
    }
    const fouls = (sim.fouls || []).filter((f) => sim.phase === 'dead' || sim.t >= f.t + 0.25);
    while (this.flagGroup.children.length < fouls.length) {
      const m = new THREE.Mesh(this.flagGeo, this.flagMat);
      m.castShadow = true;
      this.flagGroup.add(m);
    }
    this.flagGroup.children.forEach((m, i) => {
      const f = fouls[i];
      m.visible = !!f;
      if (!f) return;
      // flags are thrown a couple yards from the infraction
      const w = toWorld(f.x + ((i * 37) % 5 - 2) * 0.4, f.y + 1.2, dir);
      m.position.set(w.x, 0.04, w.z);
      m.rotation.y = i * 1.3;
    });
  }

  updateLabel(a, m) {
    let el = this.labels.get(a.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'plabel';
      document.getElementById('labels').appendChild(el);
      this.labels.set(a.id, el);
    }
    const v = new THREE.Vector3(m.position.x, 2.6, m.position.z).project(this.camera);
    if (v.z > 1) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = `${a.p.num} ${a.p.last}`;
    el.className = 'plabel ' + (a.side === 'O' ? 'off' : 'def') + (a.hasBall ? ' ball' : '');
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
  }

  // Where the "action" is, in frame coordinates
  focusFrame(sim) {
    const B = sim.ball;
    const holder = B.state === 'held' ? B.holder : null;
    if (sim.phase === 'lineup' || sim.phase === 'set') return { x: sim.los + (sim.kind === 'kickoff' ? 22 : 5), y: MID };
    if (sim.phase === 'dead') return this.lastFocus || { x: sim.los, y: MID };
    let f;
    if (holder && holder.d.runner) f = { x: holder.x, y: holder.y };
    else if (B.state === 'air' && B.pass && !B.pass.snap && !B.pass.pitch && B.pass.land) {
      const P = B.pass, k = Math.min(1, (sim.t - P.t0) / Math.max(0.3, P.T));
      const lx = Math.min(Math.max(P.land.x, -8), 108);
      f = { x: sim.los + 5 + (lx - sim.los - 5) * k, y: MID + (P.land.y - MID) * 0.5 * k };
    } else if (B.state === 'roll') f = { x: B.x, y: B.y };
    else if (sim.kind === 'scrimmage' || sim.kind === 'kneel') f = { x: sim.los + (sim.isRun ? 2 : 6), y: MID };
    else f = { x: B.x, y: B.y };
    this.lastFocus = f;
    return f;
  }

  updateCamera(sim, dt) {
    const dir = sim.meta.dir;
    const d = dir > 0 ? 1 : -1;
    const ff = this.focusFrame(sim);
    const fw = toWorld(ff.x, ff.y, dir);
    const holder = sim.ball.state === 'held' ? sim.ball.holder : null;
    const k = 1 - Math.exp(-dt * 2.4);
    if (!this.focus) this.focus = new THREE.Vector3(fw.x, 0, fw.z);
    this.focus.lerp(new THREE.Vector3(fw.x, 0, fw.z), 1 - Math.exp(-dt * 3.5));
    const fx = this.focus.x, fz = this.focus.z;
    const pos = new THREE.Vector3(), look = new THREE.Vector3();
    switch (this.camMode) {
      case 'broadcast': pos.set(fx, 20, fz * 0.3 + 46); look.set(fx, 0, fz * 0.55 - 2); break;
      case 'high': pos.set(fx - d * 30, 36, fz * 0.3); look.set(fx + d * 10, 0, fz * 0.5); break;
      case 'endzone': {
        const lx = toWorld(sim.los, MID, dir).x;
        const bx = sim.phase === 'lineup' || sim.phase === 'set' || !(holder && holder.d.runner) ? lx : fx;
        pos.set(bx - d * 16, 7.5, fz * 0.4); look.set(bx + d * 14, 1, fz * 0.6);
        break;
      }
      case 'follow': pos.set(fx - d * 11, 6, fz + 7); look.set(fx + d * 5, 1, fz); break;
      case 'sky': pos.set(fx, 80, fz + 0.5); look.set(fx, 0, fz); break;
      case 'free': {
        this.controls.target.lerp(new THREE.Vector3(fx, 0, fz), k * 0.6);
        this.controls.update();
        this.camLook.copy(this.controls.target);
        return;
      }
    }
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  snapCamera() { this.camPos.copy(this.camera.position); }
}
