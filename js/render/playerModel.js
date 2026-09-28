import * as THREE from 'three';

const numberTexCache = new Map();
function numberTexture(num, fg, bg) {
  const key = `${num}|${fg}|${bg}`;
  if (numberTexCache.has(key)) return numberTexCache.get(key);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
  g.font = '900 86px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.strokeText(String(num), 64, 70);
  g.fillStyle = fg; g.fillText(String(num), 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  numberTexCache.set(key, t);
  return t;
}

const matCache = new Map();
function mat(color, rough = 0.7, metal = 0.0) {
  const key = `${color}|${rough}|${metal}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(key);
}

const G = {
  torso: new THREE.CylinderGeometry(0.27, 0.22, 0.62, 10),
  pads: new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  hips: new THREE.CylinderGeometry(0.22, 0.2, 0.22, 10),
  thigh: new THREE.CylinderGeometry(0.1, 0.08, 0.42, 8),
  shin: new THREE.CylinderGeometry(0.075, 0.06, 0.42, 8),
  shoe: new THREE.BoxGeometry(0.12, 0.08, 0.26),
  arm: new THREE.CylinderGeometry(0.07, 0.06, 0.36, 8),
  forearm: new THREE.CylinderGeometry(0.06, 0.05, 0.32, 8),
  helmet: new THREE.SphereGeometry(0.17, 16, 12),
  mask: new THREE.TorusGeometry(0.12, 0.018, 6, 12, Math.PI),
  numPlate: new THREE.PlaneGeometry(0.3, 0.3),
  shadow: new THREE.CircleGeometry(0.42, 16),
};

function limb(geo, material, len) {
  // pivot at the top of the limb
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(geo, material);
  m.position.y = -len / 2;
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

export function createPlayerMesh(player, team) {
  const c = team.colors;
  const jersey = mat(c.primary, 0.75);
  const pants = mat(c.pants || '#dddddd', 0.8);
  const helmet = mat(c.helmet || c.primary, 0.25, 0.3);
  const skin = mat(['#8d5524', '#c68642', '#e0ac69', '#6b4423', '#f1c27d'][player.num % 5], 0.8);
  const sock = mat(c.secondary, 0.8);
  const shoe = mat('#111111', 0.6);

  const root = new THREE.Group();          // placed at player position, rotated by facing
  const body = new THREE.Group();          // animated (lean, fall)
  root.add(body);
  const scale = (player.height || 74) / 74;
  const bulk = 0.85 + ((player.weight || 230) - 180) / 600;
  body.scale.set(bulk, scale, bulk);

  const hips = new THREE.Mesh(G.hips, pants);
  hips.position.y = 1.02; hips.castShadow = true;
  body.add(hips);

  const upper = new THREE.Group();         // pivots at hips for leaning
  upper.position.y = 1.08;
  body.add(upper);
  const torso = new THREE.Mesh(G.torso, jersey);
  torso.position.y = 0.33; torso.castShadow = true;
  upper.add(torso);
  const pads = new THREE.Mesh(G.pads, jersey);
  pads.position.y = 0.6; pads.scale.set(1.25, 0.55, 0.9);
  upper.add(pads);
  // numbers (front and back)
  const ntex = numberTexture(player.num, c.secondary, c.primary);
  const nm = new THREE.MeshBasicMaterial({ map: ntex, transparent: false });
  const back = new THREE.Mesh(G.numPlate, nm);
  back.position.set(0, 0.36, -0.235); back.rotation.y = Math.PI;
  upper.add(back);
  const front = new THREE.Mesh(G.numPlate, nm);
  front.position.set(0, 0.36, 0.235); front.scale.setScalar(0.7);
  upper.add(front);
  // head
  const head = new THREE.Group();
  head.position.y = 0.86;
  upper.add(head);
  const hm = new THREE.Mesh(G.helmet, helmet);
  hm.scale.set(1, 1.05, 1.12); hm.castShadow = true;
  head.add(hm);
  const mask = new THREE.Mesh(G.mask, mat('#bbbbbb', 0.4, 0.6));
  mask.position.set(0, -0.04, 0.15); mask.rotation.set(0, 0, Math.PI);
  head.add(mask);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.36), mat(c.secondary, 0.4));
  stripe.position.set(0, 0.175, 0);
  head.add(stripe);

  // arms (shoulder pivots)
  const armL = limb(G.arm, jersey, 0.36), armR = limb(G.arm, jersey, 0.36);
  armL.position.set(0.33, 0.58, 0); armR.position.set(-0.33, 0.58, 0);
  const foreL = limb(G.forearm, skin, 0.32), foreR = limb(G.forearm, skin, 0.32);
  foreL.position.y = -0.36; foreR.position.y = -0.36;
  armL.add(foreL); armR.add(foreR);
  upper.add(armL, armR);

  // legs (hip pivots)
  const mkLeg = (x) => {
    const thigh = limb(G.thigh, pants, 0.42);
    thigh.position.set(x, 0.98, 0);
    const shin = limb(G.shin, sock, 0.42);
    shin.position.y = -0.42;
    thigh.add(shin);
    const s = new THREE.Mesh(G.shoe, shoe);
    s.position.set(0, -0.45, 0.05); s.castShadow = true;
    shin.add(s);
    body.add(thigh);
    return { thigh, shin };
  };
  const legL = mkLeg(0.12), legR = mkLeg(-0.12);

  // blob shadow for readability at distance
  const sh = new THREE.Mesh(G.shadow, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02;
  root.add(sh);

  root.userData = { body, upper, head, armL, armR, foreL, foreR, legL, legR, phase: Math.random() * 6, fall: 0, fallDir: 0 };
  return root;
}

// Pose the rig. anim: 'stand' | 'stance' | 'run' | 'block' | 'throw' | 'kick' | 'down' | 'dive' | 'tackle' | 'kneel' | 'carry'
export function animatePlayer(root, a, speed, dt, opts = {}) {
  const u = root.userData;
  const { body, upper, armL, armR, foreL, foreR, legL, legR } = u;
  const run = Math.min(1, speed / 7);
  u.phase += dt * (3 + speed * 1.15);
  const s = Math.sin(u.phase), c2 = Math.cos(u.phase);
  // defaults
  let lean = 0.08 + run * 0.3, crouch = 0;
  let aL = s * 0.9 * run, aR = -s * 0.9 * run, fL = -0.4 - run * 0.6, fR = -0.4 - run * 0.6;
  let tL = -s * 0.8 * run, tR = s * 0.8 * run, kL = Math.max(0, c2) * 1.1 * run, kR = Math.max(0, -c2) * 1.1 * run;
  let armSpread = 0;
  const anim = a.anim;
  if (speed < 0.4 && (anim === 'run' || anim === 'stand' || anim === 'carry')) {
    aL = 0.05; aR = 0.05; tL = 0; tR = 0; kL = 0.05; kR = 0.05; lean = 0.05; fL = -0.2; fR = -0.2;
  }
  if (anim === 'stance') {
    const lineman = a.pos === 'OL' || a.pos === 'DT' || a.pos === 'DE' || a.slot === 'LS';
    if (lineman) { lean = 1.1; crouch = 0.32; tL = -1.0; tR = -0.6; kL = 1.4; kR = 1.0; aL = -0.2; aR = -1.3; fR = 0; fL = -0.4; }
    else if (a.pos === 'QB' || a.slot === 'H' && a.special) { lean = 0.3; crouch = 0.12; tL = -0.4; tR = -0.4; kL = 0.6; kR = 0.6; aL = -0.7; aR = -0.7; fL = -0.6; fR = -0.6; }
    else { lean = 0.45; crouch = 0.15; tL = -0.5; tR = -0.3; kL = 0.7; kR = 0.5; aL = -0.3; aR = -0.3; fL = -0.5; fR = -0.5; }
  } else if (anim === 'block') {
    lean = 0.55; crouch = 0.12; aL = -1.35; aR = -1.35; fL = -0.2; fR = -0.2; armSpread = 0.15;
    tL = -s * 0.5 * Math.max(run, 0.3) - 0.3; tR = s * 0.5 * Math.max(run, 0.3) - 0.3; kL = 0.5; kR = 0.5;
  } else if (anim === 'throw') {
    const t = Math.min(1, a.animT / 0.35);
    aR = -2.6 + t * 3.2; fR = -1.2 + t * 1.0; aL = -0.9; lean = 0.2 + t * 0.2;
  } else if (anim === 'kick') {
    const t = Math.min(1, a.animT / 0.4);
    tR = 0.6 - t * 2.2; kR = 0.4 - t * 0.4; aL = -1.0; aR = 0.6; lean = -0.1;
  } else if (anim === 'kneel') {
    crouch = 0.45; tL = -1.4; kL = 1.6; tR = 0.2; kR = 1.9; lean = 0.2; aL = -0.8; aR = -0.8;
  } else if (anim === 'tackle') {
    lean = 0.9; aL = -1.5; aR = -1.5; armSpread = -0.25;
  }
  if (a.hasBall && anim !== 'throw') { aR = -0.35; fR = -1.7; }
  // falling / lying
  const target = a.down ? 1 : 0;
  u.fall += (target - u.fall) * Math.min(1, dt * 7);
  if (a.down && u.fall > 0.02 && !u.fallSet) { u.fallSet = true; u.fallDir = opts.fallForward === false ? -1 : 1; }
  if (!a.down) u.fallSet = false;
  body.rotation.x = u.fall * u.fallDir * 1.45;
  body.position.y = -crouch - u.fall * 0.55;

  upper.rotation.x = lean;
  armL.rotation.x = aL; armR.rotation.x = aR;
  armL.rotation.z = armSpread; armR.rotation.z = -armSpread;
  foreL.rotation.x = fL; foreR.rotation.x = fR;
  legL.thigh.rotation.x = tL; legR.thigh.rotation.x = tR;
  legL.shin.rotation.x = kL; legR.shin.rotation.x = kR;
}
