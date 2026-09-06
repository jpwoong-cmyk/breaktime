import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

const gameEl = document.querySelector('#game');
const startScreen = document.querySelector('#startScreen');
const deathScreen = document.querySelector('#deathScreen');
const startBtn = document.querySelector('#startBtn');
const restartBtn = document.querySelector('#restartBtn');
const healthFill = document.querySelector('#healthFill');
const healthText = document.querySelector('#healthText');
const heldItemEl = document.querySelector('#heldItem');
const messageEl = document.querySelector('#message');
const damageFlash = document.querySelector('#damageFlash');
const fpsEl = document.querySelector('#fps');
const bloodToggle = document.querySelector('#bloodToggle');
const attackBtn = document.querySelector('#attackBtn');
const pickupBtn = document.querySelector('#pickupBtn');
const movePad = document.querySelector('#movePad');
const moveKnob = document.querySelector('#moveKnob');

const isTouch = matchMedia('(pointer: coarse)').matches;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8c887d);
scene.fog = new THREE.Fog(0x8c887d, 18, 62);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 100);
camera.position.set(0, 1.68, 8);
scene.add(camera);

// -----------------------------------------------------------------------------
// First-person feedback layer. Created from JS so game.js remains the only
// changed file. No extra HTML/CSS assets are required.
// -----------------------------------------------------------------------------
const feedbackStyle = document.createElement('style');
feedbackStyle.textContent = `
  #lowHealthFX,#impactFX{position:fixed;inset:0;pointer-events:none;z-index:28}
  #lowHealthFX{opacity:0;background:radial-gradient(circle at center,transparent 42%,rgba(105,0,0,.16) 66%,rgba(55,0,0,.78) 100%);mix-blend-mode:multiply}
  #lowHealthFX.critical{animation:btPulse .82s ease-in-out infinite}
  #impactFX{opacity:0;background:radial-gradient(circle at center,rgba(255,245,220,.22) 0,rgba(190,25,10,.10) 20%,transparent 52%)}
  #impactFX.pop{animation:btImpact .16s ease-out}
  @keyframes btImpact{0%{opacity:.95;transform:scale(.985)}100%{opacity:0;transform:scale(1.035)}}
  @keyframes btPulse{0%,100%{filter:brightness(.9);transform:scale(1)}50%{filter:brightness(1.14);transform:scale(1.012)}}
`;
document.head.appendChild(feedbackStyle);
const lowHealthFX = document.createElement('div');
lowHealthFX.id = 'lowHealthFX';
document.body.appendChild(lowHealthFX);
const impactFX = document.createElement('div');
impactFX.id = 'impactFX';
document.body.appendChild(impactFX);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
gameEl.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xd8d2bf, 0x3e443f, 1.6));
const sun = new THREE.DirectionalLight(0xfff0cf, 2.2);
sun.position.set(-10, 22, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -28;
sun.shadow.camera.right = 28;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
scene.add(sun);

const world = new THREE.Group(); scene.add(world);
const npcGroup = new THREE.Group(); scene.add(npcGroup);
const pickupGroup = new THREE.Group(); scene.add(pickupGroup);
const breakableGroup = new THREE.Group(); scene.add(breakableGroup);
const effectsGroup = new THREE.Group(); scene.add(effectsGroup);

// Lightweight 2D obstacle map used by NPC steering. We deliberately avoid a
// full physics engine here so the game stays small and mobile-friendly.
const staticObstacles = [];
function addRectObstacle(x, z, width, depth, padding = 0.35) {
  staticObstacles.push({ x, z, halfW: width / 2 + padding, halfD: depth / 2 + padding });
}

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 90),
  new THREE.MeshStandardMaterial({ color: 0x343634, roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
world.add(floor);

function material(color, roughness = 0.86, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function meshFrom(geometry, x, y, z, color, group = world, roughness = 0.86, metalness = 0) {
  const mesh = new THREE.Mesh(geometry, material(color, roughness, metalness));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function box(x, y, z, w, h, d, color, group = world, roughness = 0.86, metalness = 0) {
  return meshFrom(new THREE.BoxGeometry(w, h, d), x, y, z, color, group, roughness, metalness);
}

function cylinder(x, y, z, radiusTop, radiusBottom, height, color, group = world, segments = 8, roughness = 0.75, metalness = 0.05) {
  return meshFrom(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), x, y, z, color, group, roughness, metalness);
}

// -----------------------------------------------------------------------------
// Procedural first-person arms/hands.
// Built entirely from Three.js geometry so BREAKTIME does not need a hand GLTF.
// The silhouette is intentionally low-poly/PS2-ish, but anatomical enough that
// it reads as a hand instead of a camera-attached rubber block.
// -----------------------------------------------------------------------------
const viewModel = new THREE.Group();
viewModel.position.set(0, 0, 0);
camera.add(viewModel);

const skinMat = new THREE.MeshStandardMaterial({
  color: 0xb98566,
  roughness: 0.9,
  metalness: 0
});
const skinShadowMat = new THREE.MeshStandardMaterial({
  color: 0x9d6d55,
  roughness: 0.94,
  metalness: 0
});
const sleeveMat = new THREE.MeshStandardMaterial({
  color: 0x242725,
  roughness: 1
});

function vmMesh(geometry, material, parent) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function makeFinger(parent, x, y, z, scale = 1) {
  const root = new THREE.Group();
  root.position.set(x, y, z);
  parent.add(root);

  const proximal = vmMesh(
    new THREE.CapsuleGeometry(0.022 * scale, 0.052 * scale, 3, 5),
    skinMat,
    root
  );
  proximal.rotation.x = Math.PI / 2;
  proximal.position.z = -0.027 * scale;

  const tipJoint = new THREE.Group();
  tipJoint.position.z = -0.072 * scale;
  root.add(tipJoint);

  const distal = vmMesh(
    new THREE.CapsuleGeometry(0.020 * scale, 0.043 * scale, 3, 5),
    skinMat,
    tipJoint
  );
  distal.rotation.x = Math.PI / 2;
  distal.position.z = -0.021 * scale;

  root.userData.tipJoint = tipJoint;
  return root;
}

function makeViewArm(side) {
  const sx = side;
  const arm = new THREE.Group();
  arm.position.set(sx * 0.30, -0.37, -0.37);
  viewModel.add(arm);

  // Sleeve/forearm. The taper is wider toward the camera and narrows at wrist.
  const sleeve = vmMesh(
    new THREE.CylinderGeometry(0.082, 0.115, 0.46, 8),
    sleeveMat,
    arm
  );
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.set(sx * 0.015, -0.01, 0.03);

  const forearm = vmMesh(
    new THREE.CylinderGeometry(0.062, 0.078, 0.21, 8),
    skinMat,
    arm
  );
  forearm.rotation.x = Math.PI / 2;
  forearm.position.set(sx * -0.005, -0.004, -0.285);

  const wrist = vmMesh(
    new THREE.CylinderGeometry(0.057, 0.063, 0.075, 8),
    skinShadowMat,
    arm
  );
  wrist.rotation.x = Math.PI / 2;
  wrist.position.z = -0.41;

  const handRoot = new THREE.Group();
  handRoot.position.set(sx * -0.006, 0.0, -0.47);
  arm.add(handRoot);

  // Rounded low-poly palm. Scaled sphere avoids the old rectangular mitten.
  const palm = vmMesh(
    new THREE.SphereGeometry(0.105, 8, 6),
    skinMat,
    handRoot
  );
  palm.scale.set(0.92, 0.58, 1.22);
  palm.position.z = -0.055;

  // Back-of-hand ridge gives the silhouette some structure.
  const handRidge = vmMesh(
    new THREE.SphereGeometry(0.072, 7, 5),
    skinShadowMat,
    handRoot
  );
  handRidge.scale.set(1.0, 0.28, 0.70);
  handRidge.position.set(0, 0.047, -0.072);

  const fingerXs = [-0.064, -0.022, 0.022, 0.064];
  const fingers = fingerXs.map((fx, i) =>
    makeFinger(handRoot, fx, -0.005, -0.125, 1 - i * 0.025)
  );

  // Thumb is angled across the fist instead of pretending to be a fifth finger.
  const thumbRoot = new THREE.Group();
  thumbRoot.position.set(sx * 0.093, -0.018, -0.055);
  thumbRoot.rotation.z = sx * -0.72;
  thumbRoot.rotation.y = sx * -0.26;
  handRoot.add(thumbRoot);

  const thumb = vmMesh(
    new THREE.CapsuleGeometry(0.025, 0.066, 3, 5),
    skinMat,
    thumbRoot
  );
  thumb.rotation.x = Math.PI / 2;
  thumb.position.z = -0.033;

  // Low-poly knuckle caps, subtle rather than three giant beads.
  fingerXs.forEach((fx) => {
    const knuckle = vmMesh(
      new THREE.SphereGeometry(0.027, 6, 4),
      skinShadowMat,
      handRoot
    );
    knuckle.scale.set(1.0, 0.72, 0.92);
    knuckle.position.set(fx, 0.054, -0.122);
  });

  arm.userData.handRoot = handRoot;
  arm.userData.fingers = fingers;
  arm.userData.thumbRoot = thumbRoot;
  arm.userData.side = side;
  return arm;
}

const leftViewArm = makeViewArm(-1);
const rightViewArm = makeViewArm(1);
let nextPunchSide = 1;

function setFingerCurl(arm, curl) {
  const c = THREE.MathUtils.clamp(curl, 0, 1);
  for (const finger of arm.userData.fingers) {
    finger.rotation.x = -0.18 - c * 1.12;
    finger.userData.tipJoint.rotation.x = -0.08 - c * 1.18;
  }
  arm.userData.thumbRoot.rotation.x = -0.15 - c * 0.38;
  arm.userData.thumbRoot.rotation.y =
    arm.userData.side * (-0.20 - c * 0.30);
}

function startHandSwing(kind = 'punch') {
  player.handSwing = 1;
  player.handSwingKind = kind;

  if (kind === 'punch') {
    player.handSide = nextPunchSide;
    nextPunchSide *= -1;
  } else {
    player.handSide = 1;
  }
}

function impactKick(strength = 1) {
  player.shake = Math.max(player.shake, 0.055 * strength);
  player.hitStop = Math.max(player.hitStop, 0.025 + 0.018 * strength);
  impactFX.classList.remove('pop');
  void impactFX.offsetWidth;
  impactFX.classList.add('pop');
}

function updateViewModel(dt) {
  const now = performance.now();
  const walkBob = running ? Math.sin(now * 0.008) * 0.008 : 0;
  const walkSway = running ? Math.sin(now * 0.004) * 0.012 : 0;

  viewModel.position.y = walkBob + (player.held ? -0.022 : 0);
  viewModel.position.x = walkSway * 0.35;
  viewModel.rotation.z = -walkSway * 0.20;

  if (player.handSwing > 0) {
    player.handSwing = Math.max(
      0,
      player.handSwing - dt * (player.handSwingKind === 'weapon' ? 4.8 : 6.3)
    );
  }

  const active = player.handSwing > 0;
  const progress = 1 - player.handSwing;
  const strike = active ? Math.sin(Math.min(1, progress) * Math.PI) : 0;
  const snap = active ? Math.sin(Math.min(1, progress) * Math.PI * 0.72) : 0;

  const punchingRight = player.handSide !== -1;
  const attackArm = punchingRight ? rightViewArm : leftViewArm;
  const supportArm = punchingRight ? leftViewArm : rightViewArm;

  // Reset both anchors every frame so the animation never accumulates drift.
  leftViewArm.position.set(-0.30, -0.37, -0.37);
  rightViewArm.position.set(0.30, -0.37, -0.37);
  leftViewArm.rotation.set(0.03, 0.09, -0.07);
  rightViewArm.rotation.set(0.03, -0.09, 0.07);

  // Relaxed fingers are never perfectly straight. Holding an object closes
  // both hands more firmly, while a punch clenches the striking fist fully.
  const restingCurl = player.held ? 0.83 : 0.34;
  setFingerCurl(leftViewArm, restingCurl);
  setFingerCurl(rightViewArm, restingCurl);

  if (active && player.handSwingKind === 'punch') {
    setFingerCurl(attackArm, 1);

    // Punch travels forward, slightly inward, with shoulder roll and wrist turn.
    attackArm.position.z -= 0.34 * strike;
    attackArm.position.y += 0.065 * strike;
    attackArm.position.x += -attackArm.userData.side * 0.075 * strike;
    attackArm.rotation.x = -0.50 * strike;
    attackArm.rotation.y += attackArm.userData.side * 0.17 * strike;
    attackArm.rotation.z += -attackArm.userData.side * 0.32 * snap;

    // The other hand stays up like a crude guard rather than mirroring the hit.
    supportArm.position.z -= 0.055 * strike;
    supportArm.position.y += 0.018 * strike;
    setFingerCurl(supportArm, 0.70);
  } else if (active && player.handSwingKind === 'weapon') {
    // Weapon swing is driven by the right arm: cock back, cut across, recover.
    setFingerCurl(rightViewArm, 0.95);
    rightViewArm.position.z -= 0.17 * strike;
    rightViewArm.position.y += 0.07 * strike;
    rightViewArm.position.x -= 0.09 * strike;
    rightViewArm.rotation.x = -0.58 * strike;
    rightViewArm.rotation.y = -0.40 * strike;
    rightViewArm.rotation.z = -0.72 * snap;

    leftViewArm.position.z -= 0.035 * strike;
    setFingerCurl(leftViewArm, 0.62);
  }
}

// -----------------------------------------------------------------------------
// Gritty low-poly street: grounded proportions, dirty concrete, hard silhouettes.
// -----------------------------------------------------------------------------

// Road, pavements and raised kerbs.
box(0, -0.035, 0, 8.2, 0.07, 90, 0x292b2a, world, 1);
box(-8, 0.09, 0, 7.5, 0.18, 90, 0x66645f, world, 1);
box(8, 0.09, 0, 7.5, 0.18, 90, 0x66645f, world, 1);
box(-4.18, 0.18, 0, 0.18, 0.22, 90, 0x89847a, world, 0.98);
box(4.18, 0.18, 0, 0.18, 0.22, 90, 0x89847a, world, 0.98);

// Faded lane markings, deliberately imperfect rather than bright arcade stripes.
for (let z = -40; z < 40; z += 7) {
  const stripe = box(0, 0.012, z, 0.12, 0.022, 3.0, 0xa7a18a, world, 1);
  stripe.rotation.y = (Math.random() - 0.5) * 0.012;
}

const buildingColors = [0x4c4b47, 0x5a554d, 0x454b4a, 0x574b46, 0x555650];
const trimColors = [0x2e302f, 0x393936, 0x302c29];
const windowColors = [0x546267, 0x44545a, 0x66645b, 0x39484e];

function makeBuilding(side, i) {
  const z = -34 + i * 11.5;
  const w = 6.4 + Math.random() * 3.2;
  const h = 6.8 + Math.random() * 7.2;
  const depth = 9;
  const x = side * (13.0 + Math.random() * 1.0);
  const facadeX = x - side * (depth / 2 + 0.015);
  const wall = buildingColors[i % buildingColors.length];
  const trim = trimColors[(i + (side > 0 ? 1 : 0)) % trimColors.length];

  // Main shell plus a slightly darker ground floor. The offset blocks stop the
  // skyline from reading as seven identical shoeboxes.
  box(x, h / 2, z, w, h, depth, wall, world, 0.98);
  box(facadeX - side * 0.055, 1.15, z, 0.14, 2.3, w * 0.94, trim, world, 0.96);

  if (i % 3 !== 1) {
    const upperH = 1.0 + Math.random() * 1.4;
    const upperW = w * (0.55 + Math.random() * 0.2);
    box(x + side * 0.15, h + upperH / 2, z + (Math.random() - 0.5) * 1.2, upperW, upperH, depth * 0.62, trim, world, 0.98);
  }

  // Roof lip / parapet.
  box(x - side * 0.03, h + 0.18, z, w + 0.12, 0.36, depth + 0.12, trim, world, 0.95);

  // Recessed-looking entrance, shallow awning and service step.
  const doorZ = z + (i % 2 ? -w * 0.22 : w * 0.22);
  box(facadeX - side * 0.105, 1.05, doorZ, 0.12, 1.95, 1.0, 0x242725, world, 0.8, 0.05);
  const awning = box(facadeX - side * 0.5, 2.35, doorZ, 0.82, 0.12, 1.35, 0x343330, world, 0.8, 0.12);
  awning.rotation.z = side * -0.08;
  box(facadeX - side * 0.18, 0.2, doorZ, 0.34, 0.22, 1.25, 0x77736b, world, 1);

  // Window rows: smaller panes with dark framing, irregular missing/dark units.
  let windowIndex = 0;
  for (let wy = 3.1; wy < h - 0.8; wy += 2.15) {
    for (let wz = z - w / 2 + 1.05; wz < z + w / 2 - 0.7; wz += 1.65) {
      if ((windowIndex + i) % 7 === 0) {
        windowIndex++;
        continue;
      }

      box(facadeX - side * 0.075, wy, wz, 0.10, 1.05, 1.05, 0x252a2b, world, 0.88);
      const panel = box(
        facadeX - side * 0.135,
        wy,
        wz,
        0.055,
        0.86,
        0.86,
        windowColors[(windowIndex + i) % windowColors.length],
        breakableGroup,
        0.34,
        0.08
      );
      panel.userData = { type: 'breakable', hp: 1, label: 'WINDOW' };
      windowIndex++;
    }
  }

  // Utility clutter: AC compressors and pipes make the facade less sterile.
  if (i % 2 === 0) {
    const acZ = z - w * 0.28;
    box(facadeX - side * 0.34, 3.0, acZ, 0.52, 0.58, 0.78, 0x777870, world, 0.86, 0.12);
    cylinder(facadeX - side * 0.42, 3.0, acZ, 0.23, 0.23, 0.08, 0x343735, world, 10, 0.85, 0.08).rotation.z = Math.PI / 2;
  }

  const pipeZ = z + w * 0.34;
  cylinder(facadeX - side * 0.18, h * 0.47, pipeZ, 0.045, 0.055, Math.max(2.8, h * 0.7), 0x3d403e, world, 6, 0.65, 0.32);

  addRectObstacle(x, z, w, depth, 0.5);
}

for (const side of [-1, 1]) {
  for (let i = 0; i < 7; i++) makeBuilding(side, i);
}


// -----------------------------------------------------------------------------
// Roadside lighting.
// All loose street clutter has been removed. Buildings remain, and these lamps
// are the only freestanding street furniture.
// -----------------------------------------------------------------------------

function makeLampPost(x, z, side, index) {
  const lamp = new THREE.Group();
  lamp.position.set(x, 0, z);
  world.add(lamp);

  // Concrete footing and slightly tapered steel mast.
  cylinder(0, 0.10, 0, 0.22, 0.27, 0.20, 0x575954, lamp, 8, 0.95, 0.08);
  cylinder(0, 1.75, 0, 0.055, 0.085, 3.35, 0x3f4442, lamp, 8, 0.56, 0.62);

  // Short road-facing arm. side = -1 on left pavement, +1 on right.
  const arm = cylinder(0, 3.26, 0, 0.04, 0.05, 0.86, 0x3f4442, lamp, 8, 0.54, 0.64);
  arm.rotation.z = Math.PI / 2;
  arm.position.x = -side * 0.37;

  // Low-poly luminaire with a dull warm lens.
  const housing = box(-side * 0.76, 3.24, 0, 0.50, 0.13, 0.27, 0x2c302f, lamp, 0.58, 0.55);
  housing.rotation.z = side * 0.035;
  box(-side * 0.76, 3.17, 0, 0.38, 0.035, 0.20, 0xb9a66f, lamp, 0.5, 0.1);

  // Small inspection collar breaks the perfectly straight silhouette.
  cylinder(0, 0.55, 0, 0.095, 0.095, 0.16, 0x303432, lamp, 8, 0.62, 0.5);

  // Slight imperfection so the row does not feel copy-pasted.
  lamp.rotation.y = ((index % 3) - 1) * 0.012;

  addRectObstacle(x, z, 0.22, 0.22, 0.48);
}

// Place lamps exactly along the road/pavement boundary, but slightly onto the
// pavement so they do not sit in the driving lane.
for (const side of [-1, 1]) {
  for (let i = 0; i < 8; i++) {
    const z = -35 + i * 10;
    makeLampPost(side * 4.48, z, side, i);
  }
}

// -----------------------------------------------------------------------------
// Smoking bay. A deliberately plain yellow floor box marks one social spot.
// Pedestrians on the right pavement may randomly detour here, smoke, then leave.
// -----------------------------------------------------------------------------
const SMOKE_ZONE = { x: 7.15, z: 10.0, halfW: 1.15, halfD: 1.35 };
const smokeZoneGroup = new THREE.Group();
world.add(smokeZoneGroup);
const smokeY = 0.194;
box(SMOKE_ZONE.x, smokeY, SMOKE_ZONE.z - SMOKE_ZONE.halfD, SMOKE_ZONE.halfW * 2, 0.026, 0.08, 0xd0a819, smokeZoneGroup, 0.88);
box(SMOKE_ZONE.x, smokeY, SMOKE_ZONE.z + SMOKE_ZONE.halfD, SMOKE_ZONE.halfW * 2, 0.026, 0.08, 0xd0a819, smokeZoneGroup, 0.88);
box(SMOKE_ZONE.x - SMOKE_ZONE.halfW, smokeY, SMOKE_ZONE.z, 0.08, 0.026, SMOKE_ZONE.halfD * 2, 0xd0a819, smokeZoneGroup, 0.88);
box(SMOKE_ZONE.x + SMOKE_ZONE.halfW, smokeY, SMOKE_ZONE.z, 0.08, 0.026, SMOKE_ZONE.halfD * 2, 0xd0a819, smokeZoneGroup, 0.88);

// -----------------------------------------------------------------------------
// Usable street objects. These are sparse gameplay props, not decorative clutter.
// Each has its own impact damage and durability.
// -----------------------------------------------------------------------------
function makeUsableObject(label, x, z, kind, damage, durability) {
  let obj;
  if (kind === 'bottle') {
    obj = cylinder(x, 0.44, z, 0.07, 0.105, 0.52, 0x506657, pickupGroup, 8, 0.45, 0.02);
  } else if (kind === 'can') {
    obj = cylinder(x, 0.35, z, 0.10, 0.10, 0.34, 0x777b78, pickupGroup, 10, 0.38, 0.45);
  } else if (kind === 'pipe') {
    obj = cylinder(x, 0.28, z, 0.055, 0.055, 1.25, 0x555b59, pickupGroup, 8, 0.42, 0.62);
    obj.rotation.z = Math.PI / 2;
  } else if (kind === 'plank') {
    obj = box(x, 0.26, z, 0.22, 0.12, 1.28, 0x6e5942, pickupGroup, 0.9, 0.0);
    obj.rotation.y = (Math.random() - 0.5) * 0.7;
  } else {
    obj = box(x, 0.29, z, 0.42, 0.22, 0.62, 0x744b3d, pickupGroup, 0.96, 0.0);
    obj.rotation.y = Math.random() * Math.PI;
  }
  obj.userData = { type: 'pickup', label, damage, durability, maxDurability: durability, kind };
  return obj;
}

const usableDefs = [
  ['BOTTLE', 'bottle', 17, 2],
  ['BRICK', 'brick', 27, 5],
  ['CAN', 'can', 12, 2],
  ['PLANK', 'plank', 23, 7],
  ['PIPE', 'pipe', 30, 9]
];
for (let i = 0; i < 15; i++) {
  const [label, kind, damage, durability] = usableDefs[i % usableDefs.length];
  const side = i % 2 === 0 ? -1 : 1;
  let z = -31 + (i * 4.7) % 62;
  // Keep the smoking bay itself clear.
  if (side > 0 && Math.abs(z - SMOKE_ZONE.z) < 2.2) z += 4.0;
  const x = side * (5.15 + (i % 3) * 0.95);
  makeUsableObject(label, x, z, kind, damage, durability);
}

const player = {
  health: 100,
  yaw: 0,
  pitch: 0,
  held: null,
  attackCooldown: 0,
  dodgeCooldown: 0,
  dodgeTime: 0,
  dodgeDir: 0,
  shake: 0,
  alive: true,
  handSwing: 0,
  handSwingKind: 'punch',
  handSide: 1,
  hitStop: 0
};

const keys = new Set();
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);
const clock = new THREE.Clock();
let running = false;
let lastTime = performance.now();
let fpsFrames = 0;
let fpsAccum = 0;
let msgTimer = 0;

function vib(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function showMsg(text, ms = 650) {
  messageEl.textContent = text;
  messageEl.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => messageEl.classList.remove('show'), ms);
}

function setHealth(v) {
  player.health = Math.max(0, Math.min(100, v));
  healthFill.style.width = `${player.health}%`;
  healthText.textContent = Math.ceil(player.health);

  // Peripheral warning grows smoothly as health drops. Below 25 HP it pulses
  // so danger is readable without staring at the number.
  const danger = THREE.MathUtils.clamp((55 - player.health) / 55, 0, 1);
  lowHealthFX.style.opacity = (danger * 0.88).toFixed(2);
  lowHealthFX.classList.toggle('critical', player.health > 0 && player.health <= 25);

  if (player.health <= 0) die();
}

function die() {
  if (!player.alive) return;
  player.alive = false;
  running = false;
  deathScreen.classList.add('open');
  document.exitPointerLock?.();
  vib([120, 60, 180]);
}

// -----------------------------------------------------------------------------
// Quaternius NPCs
// -----------------------------------------------------------------------------

const loader = new GLTFLoader();

// Keep this pool modest for mobile startup. Add more uploaded files here later.
const CHARACTER_FILES = [
  './assets/characters/male/Casual_Hoodie.gltf',
  './assets/characters/male/Casual_2.gltf',
  './assets/characters/male/Punk.gltf',
  './assets/characters/male/Worker.gltf',
  './assets/characters/female/Casual.gltf',
  './assets/characters/female/Punk.gltf',
  './assets/characters/female/Formal.gltf',
  './assets/characters/female/Worker.gltf'
];

const characterSources = [];
const NPC_HEIGHT = 1.82;
const MODEL_FACING_OFFSET = 0; // Change to Math.PI if your pack appears to walk backwards.

async function loadCharacterSource(url) {
  const gltf = await loader.loadAsync(url);
  const source = gltf.scene;

  source.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material) obj.material.side = THREE.FrontSide;
    }
  });

  // Normalize characters to roughly human height regardless of source scale.
  source.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(source);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  if (initialSize.y > 0.001) source.scale.setScalar(NPC_HEIGHT / initialSize.y);

  source.updateMatrixWorld(true);
  const normalizedBox = new THREE.Box3().setFromObject(source);
  source.position.y -= normalizedBox.min.y;
  source.updateMatrixWorld(true);

  return {
    url,
    scene: source,
    animations: gltf.animations
  };
}

async function loadCharacters() {
  const results = await Promise.allSettled(CHARACTER_FILES.map(loadCharacterSource));
  for (const result of results) {
    if (result.status === 'fulfilled') characterSources.push(result.value);
    else console.warn('Character failed to load:', result.reason);
  }

  if (!characterSources.length) {
    startBtn.textContent = 'ASSETS FAILED - REFRESH';
    showMsg('NO CHARACTER MODELS LOADED', 1800);
    return;
  }

  spawnNPCPopulation(8);
  startBtn.disabled = false;
  startBtn.textContent = 'ENTER STREET';
}

function clipByNames(source, names) {
  for (const name of names) {
    const clip = THREE.AnimationClip.findByName(source.animations, name);
    if (clip) return clip;
  }
  return null;
}

function makeActionMap(mixer, source) {
  const definitions = {
    idle: ['Idle_Neutral', 'Idle'],
    walk: ['Walk'],
    run: ['Run'],
    hit: ['HitRecieve', 'HitRecieve_2'],
    punchLeft: ['Punch_Left'],
    punchRight: ['Punch_Right'],
    kickLeft: ['Kick_Left'],
    kickRight: ['Kick_Right'],
    smoke: ['Interact', 'Idle'],
    death: ['Death']
  };

  const actions = {};
  for (const [key, names] of Object.entries(definitions)) {
    const clip = clipByNames(source, names);
    if (clip) actions[key] = mixer.clipAction(clip);
  }
  return actions;
}

function playNPCAnimation(npc, name, { once = false, fade = 0.12 } = {}) {
  const next = npc.actions?.[name];
  if (!next || npc.activeAction === next) return;

  const previous = npc.activeAction;
  if (previous) previous.fadeOut(fade);

  next.reset();
  next.enabled = true;
  next.setEffectiveTimeScale(1);
  next.setEffectiveWeight(1);

  if (once) {
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
  } else {
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
  }

  next.fadeIn(fade).play();
  npc.activeAction = next;
  npc.activeAnimation = name;
}

const SIDEWALK_TOP_Y = 0.18;
const ROAD_TOP_Y = 0;

function groundHeightAt(x) {
  // Sidewalk slabs run outside the kerbs. NPC feet must stand on the slab top,
  // not at world Y=0 underneath it. The road remains at Y=0.
  return Math.abs(x) >= 4.18 ? SIDEWALK_TOP_Y : ROAD_TOP_Y;
}

function makeNPC(x, z, variant = 0) {
  const source = characterSources[variant % characterSources.length];
  if (!source) return null;

  const root = new THREE.Group();
  root.position.set(x, groundHeightAt(x), z);
  root.rotation.y = MODEL_FACING_OFFSET;

  const visual = cloneSkeleton(source.scene);
  root.add(visual);

  // Invisible gameplay hitbox. The visible model remains fully animated.
  const hitbox = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 1.15, 4, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  hitbox.position.y = 0.92;
  root.add(hitbox);

  const mixer = new THREE.AnimationMixer(visual);
  const data = {
    type: 'npc',
    hp: 50 + Math.random() * 25,
    state: 'wander',
    speed: 0.72 + Math.random() * 0.5,
    dir: Math.random() < 0.5 ? 1 : -1,
    anger: 0,
    attackTimer: 0,
    actionLock: 0,
    stagger: 0,
    laneX: x,
    avoidSide: Math.random() < 0.5 ? -1 : 1,
    avoidTime: 0,
    smokePlan: x > 0 && Math.random() < 0.34,
    smokeState: 'none',
    smokeTimer: 0,
    smokePuffTimer: 0,
    variant,
    source,
    mixer,
    actions: null,
    activeAction: null,
    activeAnimation: '',
    root,
    visual,
    hitbox
  };

  data.actions = makeActionMap(mixer, source);
  root.userData = data;
  hitbox.userData = data;

  visual.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) obj.userData.npcRoot = root;
  });

  npcGroup.add(root);
  playNPCAnimation(data, 'walk', { fade: 0 });
  return root;
}


const NPC_DESPAWN_Z = 47;
const NPC_SPAWN_Z = 45.5;
const NPC_MAX_POPULATION = 14;
let npcSpawnTimer = 1.5 + Math.random() * 2.5;

function randomSidewalkLane() {
  const side = Math.random() < 0.5 ? -1 : 1;
  return side * (5.1 + Math.random() * 3.2);
}

function spawnNPCPopulation(count) {
  for (let i = 0; i < count; i++) {
    const x = randomSidewalkLane();
    const root = makeNPC(x, -31 + Math.random() * 62, i);
    if (!root) continue;
    // Initial crowd can already be travelling either direction.
    root.userData.dir = Math.random() < 0.5 ? 1 : -1;
    root.userData.laneX = x;
  }
}

function spawnFlowNPC() {
  if (!characterSources.length || npcGroup.children.length >= NPC_MAX_POPULATION) return;

  const enterFromNorth = Math.random() < 0.5;
  const z = enterFromNorth ? -NPC_SPAWN_Z : NPC_SPAWN_Z;
  const x = randomSidewalkLane();
  const variant = Math.floor(Math.random() * characterSources.length);
  const root = makeNPC(x, z, variant);
  if (!root) return;

  // Walk through the scene rather than spawning and turning around.
  root.userData.dir = enterFromNorth ? 1 : -1;
  root.userData.laneX = x;
}

function removeNPC(root) {
  const npc = root?.userData;
  if (npc?.mixer) {
    npc.mixer.stopAllAction();
    npc.mixer.uncacheRoot(npc.visual);
  }
  npcGroup.remove(root);
}

function updateNPCSpawner(dt) {
  npcSpawnTimer -= dt;
  if (npcSpawnTimer > 0) return;

  // RNG cadence. Sometimes the pavement stays quiet for a few seconds,
  // sometimes another pedestrian enters quickly after the previous one.
  npcSpawnTimer = 1.4 + Math.random() * 4.8;
  if (npcGroup.children.length < NPC_MAX_POPULATION) spawnFlowNPC();
}

function findNPCData(obj) {
  let current = obj;
  while (current && current !== scene) {
    if (current.userData?.type === 'npc') return current.userData;
    if (current.userData?.npcRoot?.userData?.type === 'npc') return current.userData.npcRoot.userData;
    current = current.parent;
  }
  return null;
}

function beginSmokingDetour(npc) {
  if (!npc || !npc.smokePlan || npc.smokeState !== 'none') return;
  npc.smokeState = 'approach';
}

function smokePuff(npc) {
  const p = new THREE.Mesh(
    new THREE.SphereGeometry(0.045 + Math.random() * 0.025, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x999999, transparent: true, opacity: 0.42, depthWrite: false })
  );
  p.position.set(npc.root.position.x, npc.root.position.y + 1.55, npc.root.position.z);
  p.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 0.08, 0.22 + Math.random() * 0.08, (Math.random() - 0.5) * 0.08);
  p.userData.life = 1.4;
  effectsGroup.add(p);
}

function knockDownNPC(npc) {
  if (!npc || npc.state === 'down') return;
  npc.state = 'down';
  npc.actionLock = 999;
  npc.hitbox.visible = false;
  playNPCAnimation(npc, 'death', { once: true, fade: 0.08 });
}

function faceNPCToPlayer(npc, dt = 0, snap = false) {
  if (!npc?.root) return;

  const dx = camera.position.x - npc.root.position.x;
  const dz = camera.position.z - npc.root.position.z;
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;

  const targetYaw = Math.atan2(dx, dz) + MODEL_FACING_OFFSET;

  if (snap || dt <= 0) {
    npc.root.rotation.y = targetYaw;
    return;
  }

  // Turn through the shortest angle so NPCs don't spin the long way around.
  const current = npc.root.rotation.y;
  const delta = Math.atan2(Math.sin(targetYaw - current), Math.cos(targetYaw - current));
  const turnAmount = Math.min(1, dt * 14);
  npc.root.rotation.y = current + delta * turnAmount;
}

function reactToHit(npc, stagger = 0.32) {
  npc.smokeState = 'done';
  npc.smokePlan = false;
  npc.state = 'angry';
  npc.anger = 7;
  npc.stagger = stagger;
  npc.actionLock = stagger;

  // The attacker immediately gets the NPC's attention. Movement remains locked
  // by the hit reaction, but their body now turns toward the player at once.
  faceNPCToPlayer(npc, 0, true);
  playNPCAnimation(npc, 'hit', { once: true, fade: 0.04 });
}

function bloodBurst(pos) {
  if (!bloodToggle.checked) return;
  for (let i = 0; i < 10; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.035 + Math.random() * 0.035, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x8f1212 })
    );
    p.position.copy(pos);
    p.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 2.5, 0.6 + Math.random() * 2, (Math.random() - 0.5) * 2.5);
    p.userData.life = 0.45 + Math.random() * 0.4;
    effectsGroup.add(p);
  }
}

const bloodPuddles = [];
function makeBloodPuddle(npc, strength = 1) {
  if (!bloodToggle.checked || !npc?.root) return;

  const groundY = groundHeightAt(npc.root.position.x) + 0.006;
  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(0.34 + Math.random() * 0.22, 14),
    new THREE.MeshBasicMaterial({
      color: 0x5a0707,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2
    })
  );
  puddle.rotation.x = -Math.PI / 2;
  puddle.rotation.z = Math.random() * Math.PI;
  puddle.scale.set(0.65 + Math.random() * 0.7, 0.80 + Math.random() * 0.65, 1);
  puddle.position.set(
    npc.root.position.x + (Math.random() - 0.5) * 0.18,
    groundY,
    npc.root.position.z + (Math.random() - 0.5) * 0.18
  );
  puddle.userData.puddle = true;
  puddle.userData.growTo = 1 + Math.min(0.9, strength * 0.28);
  puddle.userData.age = 0;
  world.add(puddle);
  bloodPuddles.push(puddle);

  // Cap persistent decals so long sessions do not quietly eat memory.
  if (bloodPuddles.length > 34) {
    const oldest = bloodPuddles.shift();
    world.remove(oldest);
    oldest.geometry.dispose();
    oldest.material.dispose();
  }
}

function updateBloodPuddles(dt) {
  for (const p of bloodPuddles) {
    p.userData.age += dt;
    const target = p.userData.growTo || 1;
    p.scale.x = THREE.MathUtils.lerp(p.scale.x, target, Math.min(1, dt * 2.4));
    p.scale.y = THREE.MathUtils.lerp(p.scale.y, target * 0.82, Math.min(1, dt * 2.4));
    // Fresh puddles are dark glossy-looking marks, then settle slightly.
    p.material.opacity = THREE.MathUtils.lerp(p.material.opacity, 0.58, Math.min(1, dt * 0.18));
  }
}

function debrisBurst(pos, color = 0x889090) {
  for (let i = 0; i < 8; i++) {
    const p = box(pos.x, pos.y, pos.z, 0.06, 0.06, 0.06, color, effectsGroup);
    p.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3);
    p.userData.life = 0.6 + Math.random() * 0.3;
  }
}

function doAttack() {
  if (!running || !player.alive || player.attackCooldown > 0) return;
  if (player.held) {
    doHeldMeleeAttack();
    return;
  }

  player.attackCooldown = 0.32;
  startHandSwing('punch');
  player.shake = Math.max(player.shake, 0.035);
  vib(28);

  raycaster.setFromCamera(center, camera);
  raycaster.far = 2.35;
  const hits = raycaster.intersectObjects(npcGroup.children, true);

  if (!hits.length) {
    showMsg('SWISH', 220);
    return;
  }

  const npc = findNPCData(hits[0].object);
  if (!npc || npc.state === 'down') return;

  npc.hp -= 10 + Math.random() * 8;
  reactToHit(npc, 0.3);

  const shove = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  npc.root.position.addScaledVector(shove, 0.16);
  bloodBurst(hits[0].point);
  impactKick(0.75);
  showMsg('WHACK', 280);

  if (npc.hp <= 0) {
    knockDownNPC(npc);
    showMsg('FLOORED', 700);
  }
}

function updateHeldHUD() {
  if (!player.held) {
    heldItemEl.textContent = 'EMPTY HANDS';
    pickupBtn.textContent = 'PICK UP';
    return;
  }
  const d = player.held.userData;
  heldItemEl.textContent = `${d.label} ${d.durability}/${d.maxDurability}`;
  pickupBtn.textContent = 'THROW';
}

function breakHeldObject() {
  const obj = player.held;
  if (!obj) return;
  const label = obj.userData.label;
  scene.remove(obj);
  player.held = null;
  updateHeldHUD();
  debrisBurst(camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.8)), 0x66615b);
  vib([35, 25, 45]);
  showMsg(`${label} BROKE`, 600);
}

function useHeldDurability(amount = 1) {
  if (!player.held) return false;
  player.held.userData.durability = Math.max(0, player.held.userData.durability - amount);
  if (player.held.userData.durability <= 0) {
    breakHeldObject();
    return false;
  }
  updateHeldHUD();
  return true;
}

function doHeldMeleeAttack() {
  if (!player.held || player.attackCooldown > 0) return;
  const weapon = player.held;
  player.attackCooldown = 0.42;
  startHandSwing('weapon');
  player.shake = Math.max(player.shake, 0.055);
  vib(34);

  raycaster.setFromCamera(center, camera);
  raycaster.far = 2.65;
  const hits = raycaster.intersectObjects(npcGroup.children, true);
  if (!hits.length) {
    showMsg('SWING', 240);
    return;
  }

  const npc = findNPCData(hits[0].object);
  if (!npc) return;

  const wasDown = npc.state === 'down';
  bloodBurst(hits[0].point);
  makeBloodPuddle(npc, wasDown ? 1.25 : 1);
  impactKick(wasDown ? 1.15 : 1.0);
  useHeldDurability(1);

  if (wasDown) {
    // Downed bodies can still receive object impacts. Keep the death pose,
    // but reward the hit with visible feedback and a growing puddle.
    showMsg(`${weapon.userData.label} IMPACT`, 330);
    return;
  }

  npc.hp -= weapon.userData.damage;
  reactToHit(npc, 0.4);
  const shove = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
  npc.root.position.addScaledVector(shove, 0.24);
  showMsg(`${weapon.userData.label} WHACK`, 330);
  if (npc.hp <= 0) {
    knockDownNPC(npc);
    makeBloodPuddle(npc, 1.4);
  }
}

function nearestPickup() {
  raycaster.setFromCamera(center, camera);
  raycaster.far = 2.7;
  const hits = raycaster.intersectObjects(pickupGroup.children, false);
  return hits[0]?.object || null;
}

function pickup() {
  if (!running || !player.alive) return;
  if (player.held) {
    dropHeld();
    return;
  }

  const obj = nearestPickup();
  if (!obj) {
    showMsg('NOTHING TO GRAB', 450);
    return;
  }

  player.held = obj;
  pickupGroup.remove(obj);
  scene.add(obj);
  obj.rotation.set(0.2, 0.3, 0.15);
  updateHeldHUD();
  vib(20);
  showMsg(`GRABBED ${obj.userData.label}`, 400);
}

function dropHeld() {
  if (!player.held) return;
  const obj = player.held;
  const dir = camera.getWorldDirection(new THREE.Vector3());
  obj.position.copy(camera.position).add(dir.multiplyScalar(1));
  obj.position.y = 0.35;
  scene.remove(obj);
  pickupGroup.add(obj);
  player.held = null;
  updateHeldHUD();
}

function throwHeld() {
  const obj = player.held;
  if (!obj) return;

  const { label, damage, durability, maxDurability, kind } = obj.userData;
  player.held = null;
  updateHeldHUD();
  scene.remove(obj);
  world.add(obj);

  obj.userData = {
    type: 'thrown',
    label,
    damage,
    durability,
    maxDurability,
    kind,
    vel: camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(new THREE.Vector3(0, 1.1, 0)),
    life: 4,
    impacted: false
  };
  obj.position.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.75));

  player.attackCooldown = 0.5;
  player.shake = 0.05;
  vib(45);
  showMsg('THROW', 260);
}

function dodge(dir) {
  if (!running || player.dodgeCooldown > 0) return;
  player.dodgeCooldown = 0.7;
  player.dodgeTime = 0.24;
  player.dodgeDir = dir;
  player.shake = 0.03;
  vib(18);
  showMsg(dir < 0 ? 'DODGE LEFT' : 'DODGE RIGHT', 260);
}

function playerHit(amount) {
  if (player.dodgeTime > 0) {
    showMsg('PERFECT DODGE', 500);
    vib(12);
    return;
  }

  setHealth(player.health - amount);
  player.shake = 0.13;
  impactKick(0.65);
  damageFlash.classList.add('on');
  setTimeout(() => damageFlash.classList.remove('on'), 120);
  vib([70, 35, 70]);
  showMsg('HIT', 250);
}


function pointInsideStaticObstacle(x, z, radius = 0.36) {
  for (const o of staticObstacles) {
    if (Math.abs(x - o.x) <= o.halfW + radius && Math.abs(z - o.z) <= o.halfD + radius) return true;
  }
  return false;
}


function dynamicObstacleAt(x, z, radius = 0.36) {
  // No loose street objects remain. NPC-vs-NPC spacing is handled separately
  // by crowdRepulsion(), while buildings and lampposts live in staticObstacles.
  return false;
}

function blockedAt(x, z, radius = 0.36) {
  return pointInsideStaticObstacle(x, z, radius) || dynamicObstacleAt(x, z, radius);
}

function crowdRepulsion(root) {
  const push = new THREE.Vector3();
  for (const other of npcGroup.children) {
    if (other === root) continue;
    const dx = root.position.x - other.position.x;
    const dz = root.position.z - other.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 0.0001 || distSq > 1.35 * 1.35) continue;
    const dist = Math.sqrt(distSq);
    const strength = (1.35 - dist) / 1.35;
    push.x += (dx / dist) * strength;
    push.z += (dz / dist) * strength;
  }
  return push;
}

function steerAroundObstacles(npc, desired, dt) {
  const root = npc.root;
  const dir = desired.clone().setY(0);
  if (dir.lengthSq() < 0.0001) return { dir, avoiding: false };
  dir.normalize();

  const left = new THREE.Vector3(-dir.z, 0, dir.x);
  const probeDistance = npc.state === 'angry' ? 1.25 : 1.05;
  const probeX = root.position.x + dir.x * probeDistance;
  const probeZ = root.position.z + dir.z * probeDistance;
  const obstacleAhead = blockedAt(probeX, probeZ, 0.42);

  if (obstacleAhead && npc.avoidTime <= 0) {
    // Test both shoulders. Prefer the side with clear space, randomise ties so
    // crowds do not all perform the exact same robotic sidestep.
    const testForward = 0.55;
    const sideDistance = 1.0;
    const lx = root.position.x + dir.x * testForward + left.x * sideDistance;
    const lz = root.position.z + dir.z * testForward + left.z * sideDistance;
    const rx = root.position.x + dir.x * testForward - left.x * sideDistance;
    const rz = root.position.z + dir.z * testForward - left.z * sideDistance;
    const leftBlocked = blockedAt(lx, lz, 0.38);
    const rightBlocked = blockedAt(rx, rz, 0.38);

    if (leftBlocked && !rightBlocked) npc.avoidSide = -1;
    else if (!leftBlocked && rightBlocked) npc.avoidSide = 1;
    else npc.avoidSide = Math.random() < 0.5 ? -1 : 1;
    npc.avoidTime = 0.7 + Math.random() * 0.35;
  }

  if (npc.avoidTime > 0) npc.avoidTime = Math.max(0, npc.avoidTime - dt);

  const steering = dir.clone();
  const avoiding = obstacleAhead || npc.avoidTime > 0;
  if (avoiding) {
    steering.multiplyScalar(0.55);
    steering.addScaledVector(left, npc.avoidSide * 1.2);
  }

  // People also give each other a little personal space instead of occupying
  // the same coordinates like layered cardboard cut-outs.
  steering.addScaledVector(crowdRepulsion(root), 1.25);
  if (steering.lengthSq() > 0.0001) steering.normalize();
  return { dir: steering, avoiding };
}

function moveNPC(npc, desired, speed, dt) {
  const { dir, avoiding } = steerAroundObstacles(npc, desired, dt);
  if (dir.lengthSq() < 0.0001) return { dir, avoiding };

  const root = npc.root;
  const oldX = root.position.x;
  const oldZ = root.position.z;
  root.position.addScaledVector(dir, speed * dt);

  // Safety net: anticipation should do most of the work, but never allow a
  // frame-rate spike to teleport a pedestrian through solid geometry.
  if (blockedAt(root.position.x, root.position.z, 0.34)) {
    root.position.x = oldX;
    root.position.z = oldZ;
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(npc.avoidSide);
    const tryX = oldX + side.x * speed * dt;
    const tryZ = oldZ + side.z * speed * dt;
    if (!blockedAt(tryX, tryZ, 0.34)) {
      root.position.x = tryX;
      root.position.z = tryZ;
    } else {
      npc.avoidSide *= -1;
      npc.avoidTime = Math.max(npc.avoidTime, 0.45);
    }
  }

  return { dir, avoiding };
}

function faceNPCAlongDirection(npc, dir, dt) {
  if (!npc?.root || dir.lengthSq() < 0.0001) return;
  const targetYaw = Math.atan2(dir.x, dir.z) + MODEL_FACING_OFFSET;
  const current = npc.root.rotation.y;
  const delta = Math.atan2(Math.sin(targetYaw - current), Math.cos(targetYaw - current));
  npc.root.rotation.y = current + delta * Math.min(1, dt * 11);
}

function startNPCAttack(npc) {
  const options = ['punchLeft', 'punchRight', 'kickLeft', 'kickRight'].filter((name) => npc.actions[name]);
  const attackName = options.length ? options[Math.floor(Math.random() * options.length)] : 'punchRight';

  // Always square up before throwing the attack.
  faceNPCToPlayer(npc, 0, true);
  npc.actionLock = 0.48;
  playNPCAnimation(npc, attackName, { once: true, fade: 0.06 });

  setTimeout(() => {
    if (!running || !player.alive || npc.state === 'down') return;
    const dist = new THREE.Vector2(
      camera.position.x - npc.root.position.x,
      camera.position.z - npc.root.position.z
    ).length();
    if (dist < 1.75) playerHit(6 + Math.random() * 9);
  }, 220);
}

function updateNPCs(dt) {
  for (const root of npcGroup.children) {
    const npc = root.userData;
    if (!npc?.mixer) continue;

    npc.mixer.update(dt);
    if (npc.state === 'down') continue;

    // Keep the soles planted on whichever surface the NPC is crossing.
    // This also lets an angry NPC step down from pavement to road instead of
    // floating or sinking when their X position changes.
    const targetGroundY = groundHeightAt(root.position.x);
    root.position.y = THREE.MathUtils.lerp(root.position.y, targetGroundY, Math.min(1, dt * 18));

    if (npc.actionLock > 0) {
      npc.actionLock -= dt;
      if (npc.stagger > 0) npc.stagger -= dt;

      // Animation locks stop locomotion, not awareness. An angry NPC should
      // keep turning toward the player while recoiling or swinging.
      if (npc.state === 'angry' || npc.anger > 0) faceNPCToPlayer(npc, dt);
      continue;
    }

    const toPlayer = new THREE.Vector3(
      camera.position.x - root.position.x,
      0,
      camera.position.z - root.position.z
    );
    const dist = toPlayer.length();

    // A subset of right-side pedestrians make one spontaneous smoking stop.
    if (npc.smokePlan && npc.smokeState === 'none' && Math.abs(root.position.z - SMOKE_ZONE.z) < 12) {
      beginSmokingDetour(npc);
    }

    if (npc.smokeState === 'approach' && npc.state !== 'angry') {
      const toSmoke = new THREE.Vector3(SMOKE_ZONE.x - root.position.x, 0, SMOKE_ZONE.z - root.position.z);
      const smokeDist = toSmoke.length();
      if (smokeDist > 0.55) {
        const movement = moveNPC(npc, toSmoke.normalize(), npc.speed * 0.92, dt);
        faceNPCAlongDirection(npc, movement.dir, dt);
        playNPCAnimation(npc, 'walk');
      } else {
        npc.smokeState = 'smoking';
        npc.smokeTimer = 4.5 + Math.random() * 5.5;
        npc.smokePuffTimer = 0.2;
        playNPCAnimation(npc, 'smoke', { fade: 0.12 });
      }
      continue;
    }

    if (npc.smokeState === 'smoking' && npc.state !== 'angry') {
      npc.smokeTimer -= dt;
      npc.smokePuffTimer -= dt;
      if (npc.smokePuffTimer <= 0) {
        smokePuff(npc);
        npc.smokePuffTimer = 0.75 + Math.random() * 0.7;
      }
      playNPCAnimation(npc, 'smoke');
      if (npc.smokeTimer <= 0) {
        npc.smokeState = 'done';
        npc.smokePlan = false;
        playNPCAnimation(npc, 'walk');
      }
      continue;
    }

    if (npc.state === 'angry' || npc.anger > 0) {
      npc.anger = Math.max(0, npc.anger - dt);
      npc.state = 'angry';

      if (dist > 1.42) {
        const desired = toPlayer.normalize();
        const movement = moveNPC(npc, desired, npc.speed * 1.8, dt);
        if (movement.avoiding) faceNPCAlongDirection(npc, movement.dir, dt);
        else faceNPCToPlayer(npc, dt);
        playNPCAnimation(npc, 'run');
      } else {
        // Keep tracking the player at melee range so circling around an NPC
        // doesn't leave them attacking empty air while facing the old angle.
        faceNPCToPlayer(npc, dt);
        npc.attackTimer -= dt;
        if (npc.attackTimer <= 0) {
          npc.attackTimer = 0.85 + Math.random() * 0.6;
          startNPCAttack(npc);
        } else {
          playNPCAnimation(npc, 'idle');
        }
      }

      if (npc.anger <= 0 && dist > 6) npc.state = 'wander';
    } else {
      // Pedestrians continue beyond the visible street instead of bouncing at
      // an invisible wall. Once outside the space, remove them completely.
      if (Math.abs(root.position.z) > NPC_DESPAWN_Z) {
        removeNPC(root);
        continue;
      }

      // Walk generally along the street, softly returning to the assigned
      // pavement lane after detouring around another person or a lamppost.
      const laneCorrection = THREE.MathUtils.clamp((npc.laneX - root.position.x) * 0.45, -0.7, 0.7);
      const desired = new THREE.Vector3(laneCorrection, 0, npc.dir).normalize();
      const movement = moveNPC(npc, desired, npc.speed, dt);
      faceNPCAlongDirection(npc, movement.dir, dt);
      playNPCAnimation(npc, 'walk');
    }
  }
}

function updateThrown(dt) {
  for (const obj of [...world.children]) {
    if (obj.userData?.type !== 'thrown') continue;

    obj.userData.life -= dt;
    obj.userData.vel.y -= 9.8 * dt;
    obj.position.addScaledVector(obj.userData.vel, dt);
    obj.rotation.x += 8 * dt;
    obj.rotation.z += 6 * dt;

    for (const root of npcGroup.children) {
      const npc = root.userData;
      if (!npc) continue;

      const wasDown = npc.state === 'down';
      const chestY = root.position.y + (wasDown ? 0.30 : 1.0);
      const chest = new THREE.Vector3(root.position.x, chestY, root.position.z);
      if (obj.position.distanceTo(chest) < (wasDown ? 1.02 : 0.85)) {
        if (!wasDown) {
          npc.hp -= obj.userData.damage;
          reactToHit(npc, 0.48);
        }
        bloodBurst(obj.position);
        makeBloodPuddle(npc, wasDown ? 1.35 : 1.05);
        debrisBurst(obj.position, 0x754337);
        impactKick(wasDown ? 1.25 : 1.05);
        showMsg(wasDown ? 'GROUND SMASH' : 'SMASH', 450);
        obj.userData.life = 0;
        obj.userData.impacted = true;
        obj.userData.durability = Math.max(0, obj.userData.durability - 1);

        if (!wasDown && npc.hp <= 0) {
          knockDownNPC(npc);
          makeBloodPuddle(npc, 1.5);
        }
        break;
      }
    }

    for (const b of [...breakableGroup.children]) {
      if (obj.position.distanceTo(b.position) < 1.15) {
        b.userData.hp--;
        debrisBurst(b.position, b.material.color.getHex());
        vib(55);
        if (b.userData.hp <= 0) {
          breakableGroup.remove(b);
          showMsg(`${b.userData.label} BROKE`, 520);
        } else {
          showMsg('CRACK', 320);
        }
        obj.userData.life = 0;
        obj.userData.impacted = true;
        obj.userData.durability = Math.max(0, obj.userData.durability - 1);
        break;
      }
    }

    if (obj.position.y < 0.15 || obj.userData.life <= 0) {
      if (obj.userData.durability <= 0) {
        debrisBurst(obj.position, 0x66615b);
        world.remove(obj);
        continue;
      }
      obj.position.y = Math.abs(obj.position.x) >= 4.18 ? SIDEWALK_TOP_Y + 0.12 : 0.12;
      obj.userData.type = 'pickup';
      obj.userData.label ||= 'JUNK';
      obj.userData.damage ||= 18;
      obj.userData.maxDurability ||= obj.userData.durability || 1;
      world.remove(obj);
      pickupGroup.add(obj);
    }
  }
}

function updateEffects(dt) {
  for (const p of [...effectsGroup.children]) {
    p.userData.life -= dt;
    p.userData.vel.y -= 4 * dt;
    p.position.addScaledVector(p.userData.vel, dt);
    if (p.userData.life <= 0) effectsGroup.remove(p);
  }
}

function updatePlayer(dt) {
  if (player.attackCooldown > 0) player.attackCooldown -= dt;
  if (player.dodgeCooldown > 0) player.dodgeCooldown -= dt;
  if (player.dodgeTime > 0) player.dodgeTime -= dt;

  // Camera facing is the one source of truth for movement direction.
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = 0;

  const fwd = camera.getWorldDirection(new THREE.Vector3());
  fwd.y = 0;
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();

  let x = 0;
  let z = 0;
  if (keys.has('KeyW')) z += 1;
  if (keys.has('KeyS')) z -= 1;
  if (keys.has('KeyA')) x -= 1;
  if (keys.has('KeyD')) x += 1;
  x += mobileMove.x;
  z += mobileMove.y;

  const move = new THREE.Vector3();
  move.addScaledVector(fwd, z).addScaledVector(right, x);
  if (move.lengthSq() > 1) move.normalize();

  camera.position.addScaledVector(move, 4.2 * dt);
  if (player.dodgeTime > 0) camera.position.addScaledVector(right, player.dodgeDir * 9 * dt);

  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -9.1, 9.1);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -41, 41);
  camera.position.y = 1.68;

  if (player.shake > 0) {
    player.shake = Math.max(0, player.shake - dt * 0.45);
    camera.rotation.z += (Math.random() - 0.5) * player.shake;
    camera.rotation.x += (Math.random() - 0.5) * player.shake * 0.45;
  }

  if (player.held) {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const target = camera.position.clone()
      .add(dir.multiplyScalar(0.8))
      .add(right.clone().multiplyScalar(0.45))
      .add(new THREE.Vector3(0, -0.35, 0));
    player.held.position.lerp(target, 0.35);
  }

  updateViewModel(dt);
}

let mobileMove = { x: 0, y: 0 };
let movePointer = null;
let lookPointer = null;
let lookLast = { x: 0, y: 0 };
let lookStart = { x: 0, y: 0, t: 0 };

function pointerMoveLook(dx, dy) {
  player.yaw -= dx * 0.0032;
  player.pitch -= dy * 0.003;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.15, 1.15);
}

renderer.domElement.addEventListener('click', () => {
  if (running && !isTouch && document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

document.addEventListener('mousemove', (e) => {
  if (running && document.pointerLockElement === renderer.domElement) pointerMoveLook(e.movementX, e.movementY);
});

document.addEventListener('mousedown', (e) => {
  if (running && document.pointerLockElement === renderer.domElement && e.button === 0) doAttack();
});

document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyE') pickup();
  if (e.code === 'KeyQ' && player.held) throwHeld();
});

document.addEventListener('keyup', (e) => keys.delete(e.code));

const lastAD = { KeyA: 0, KeyD: 0 };
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyA' || e.code === 'KeyD') {
    const now = performance.now();
    if (now - lastAD[e.code] < 260) dodge(e.code === 'KeyA' ? -1 : 1);
    lastAD[e.code] = now;
  }
});

movePad.addEventListener('pointerdown', (e) => {
  movePointer = e.pointerId;
  movePad.setPointerCapture(e.pointerId);
  updatePad(e);
});
movePad.addEventListener('pointermove', (e) => {
  if (e.pointerId === movePointer) updatePad(e);
});
movePad.addEventListener('pointerup', (e) => {
  if (e.pointerId === movePointer) {
    movePointer = null;
    mobileMove = { x: 0, y: 0 };
    moveKnob.style.transform = 'translate(-50%,-50%)';
  }
});

function updatePad(e) {
  const r = movePad.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2);
  const dy = e.clientY - (r.top + r.height / 2);
  const max = r.width * 0.34;
  const len = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, max / len);
  const nx = dx * k;
  const ny = dy * k;
  moveKnob.style.transform = `translate(calc(-50% + ${nx}px),calc(-50% + ${ny}px))`;
  mobileMove = { x: nx / max, y: -ny / max };
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!running || !isTouch || e.clientX < innerWidth * 0.42) return;
  lookPointer = e.pointerId;
  lookLast = { x: e.clientX, y: e.clientY };
  lookStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookPointer) return;
  const dx = e.clientX - lookLast.x;
  const dy = e.clientY - lookLast.y;
  pointerMoveLook(dx, dy);
  lookLast = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.pointerId !== lookPointer) return;
  const dx = e.clientX - lookStart.x;
  const dy = e.clientY - lookStart.y;
  const elapsed = performance.now() - lookStart.t;
  if (elapsed < 330 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) dodge(dx < 0 ? -1 : 1);
  lookPointer = null;
});

attackBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doAttack();
});
pickupBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (player.held) throwHeld();
  else pickup();
});

function start() {
  if (!characterSources.length) return;
  player.health = 100;
  player.alive = true;
  setHealth(100);
  player.yaw = 0;
  player.pitch = 0;
  player.handSwing = 0;
  player.hitStop = 0;
  lowHealthFX.classList.remove('critical');
  lowHealthFX.style.opacity = '0';
  camera.position.set(0, 1.68, 8);
  running = true;
  startScreen.classList.remove('open');
  deathScreen.classList.remove('open');
  if (!isTouch) setTimeout(() => renderer.domElement.requestPointerLock?.(), 80);
}

startBtn.addEventListener('click', start);
restartBtn.addEventListener('click', () => location.reload());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.033, clock.getDelta());

  // Tiny impact freeze gives hits weight without turning combat sluggish.
  if (player.hitStop > 0) {
    player.hitStop = Math.max(0, player.hitStop - dt);
    dt *= 0.16;
  }

  if (running) {
    updatePlayer(dt);
    updateNPCSpawner(dt);
    updateNPCs(dt);
    updateThrown(dt);
    updateEffects(dt);
    updateBloodPuddles(dt);
  }

  renderer.render(scene, camera);

  fpsFrames++;
  fpsAccum += now - lastTime;
  lastTime = now;
  if (fpsAccum > 650) {
    fpsEl.textContent = `${Math.round(fpsFrames / (fpsAccum / 1000))} FPS`;
    fpsFrames = 0;
    fpsAccum = 0;
  }
}

loadCharacters();
requestAnimationFrame(loop);
