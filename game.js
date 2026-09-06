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

function makePickup(type, x, z, color, shape = 'box', damage = 18) {
  let root;

  if (type === 'BOTTLE') {
    // Chunky glass bottle with neck and cap. Root body remains raycastable.
    root = cylinder(x, 0.28, z, 0.13, 0.16, 0.48, color, pickupGroup, 8, 0.42, 0.04);
    const neck = cylinder(0, 0.31, 0, 0.065, 0.085, 0.24, 0x486352, root, 8, 0.4, 0.04);
    neck.position.y = 0.28;
    cylinder(0, 0.43, 0, 0.07, 0.07, 0.055, 0x343935, root, 8, 0.5, 0.18);
  } else if (type === 'BRICK') {
    root = box(x, 0.17, z, 0.52, 0.28, 0.88, 0x7a4638, pickupGroup, 1);
    // Mortar/groove cuts represented by dark shallow strips.
    box(0, 0.145, 0, 0.535, 0.025, 0.04, 0x4d3029, root, 1);
    box(0, 0.145, -0.27, 0.535, 0.025, 0.035, 0x4d3029, root, 1);
    box(0, 0.145, 0.27, 0.535, 0.025, 0.035, 0x4d3029, root, 1);
  } else if (type === 'CONE') {
    // Proper traffic cone: square rubber foot, tapered body and faded band.
    root = box(x, 0.055, z, 0.62, 0.11, 0.62, 0x292b29, pickupGroup, 0.98);
    const cone = meshFrom(new THREE.CylinderGeometry(0.075, 0.25, 0.72, 10), 0, 0.42, 0, color, root, 0.85);
    cone.castShadow = true;
    cylinder(0, 0.49, 0, 0.145, 0.18, 0.13, 0xd3c9ae, root, 10, 0.8);
  } else if (type === 'CAN') {
    root = cylinder(x, 0.18, z, 0.12, 0.12, 0.34, 0x777b79, pickupGroup, 12, 0.34, 0.55);
    cylinder(0, 0.175, 0, 0.103, 0.103, 0.012, 0x313432, root, 12, 0.45, 0.6);
    const label = cylinder(0, 0, 0, 0.122, 0.122, 0.13, color, root, 12, 0.7, 0.05);
    label.position.y = 0;
  } else {
    // Rough plank with a second narrow board underneath to break the perfect box silhouette.
    root = box(x, 0.12, z, 0.22, 0.16, 1.95, 0x695441, pickupGroup, 1);
    const splinter = box(0.08, -0.06, 0.18, 0.09, 0.08, 1.55, 0x4d4034, root, 1);
    splinter.rotation.y = 0.045;
  }

  root.rotation.y = Math.random() * Math.PI;
  root.castShadow = true;
  root.userData = { type: 'pickup', label: type, damage };
  return root;
}

const pickupDefs = [
  ['BOTTLE', 0x4b6858, 'cyl', 22],
  ['BRICK', 0x7b483b, 'box', 30],
  ['CONE', 0xb85a2c, 'cone', 18],
  ['CAN', 0x676f70, 'cyl', 14],
  ['PLANK', 0x66513e, 'box', 26]
];

for (let i = 0; i < 18; i++) {
  const d = pickupDefs[i % pickupDefs.length];
  makePickup(d[0], (Math.random() < 0.5 ? -1 : 1) * (4.8 + Math.random() * 4), -34 + Math.random() * 68, d[1], d[2], d[3]);
}

function makeStreetPole(x, z, index) {
  const poleGroup = new THREE.Group();
  poleGroup.position.set(x, 0, z);
  world.add(poleGroup);

  // Heavy concrete/metal footing, tapered mast, clamp and short street-facing arm.
  cylinder(0, 0.10, 0, 0.24, 0.29, 0.20, 0x4b4d49, poleGroup, 8, 0.95, 0.08);
  cylinder(0, 1.08, 0, 0.055, 0.085, 1.85, 0x484b49, poleGroup, 8, 0.58, 0.55);
  cylinder(0, 1.82, 0, 0.09, 0.09, 0.12, 0x2f3231, poleGroup, 8, 0.5, 0.58);

  const arm = cylinder(0, 1.92, 0, 0.035, 0.045, 0.78, 0x464a48, poleGroup, 8, 0.52, 0.6);
  arm.rotation.z = Math.PI / 2;
  arm.position.x = -Math.sign(x) * 0.31;

  // Breakable weathered sign panel. Keep the panel itself as the breakable root.
  const sign = box(-Math.sign(x) * 0.18, 2.18, 0, 0.07, 0.62, 1.02, 0x696658, breakableGroup, 0.88, 0.06);
  sign.position.x += x;
  sign.position.z += z;
  sign.rotation.z = (index % 3 - 1) * 0.035;
  sign.userData = { type: 'breakable', hp: 2, label: 'SIGN' };

  // Dark back plate / bracket gives the sign actual thickness from oblique angles.
  const bracket = box(-Math.sign(x) * 0.12, 2.18, 0, 0.05, 0.16, 0.34, 0x303230, poleGroup, 0.7, 0.38);
  bracket.rotation.x = 0.04;

  addRectObstacle(x, z, 0.18, 0.18, 0.5);
}

for (let i = 0; i < 7; i++) {
  const x = (i % 2 ? -1 : 1) * 6.1;
  const z = -30 + i * 10;
  makeStreetPole(x, z, i);
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
  alive: true
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

  spawnNPCPopulation(13);
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

function spawnNPCPopulation(count) {
  for (let i = 0; i < count; i++) {
    makeNPC(
      (Math.random() < 0.5 ? -1 : 1) * (3.5 + Math.random() * 5),
      -35 + Math.random() * 70,
      i
    );
  }
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
    throwHeld();
    return;
  }

  player.attackCooldown = 0.32;
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
  showMsg('WHACK', 280);

  if (npc.hp <= 0) {
    knockDownNPC(npc);
    showMsg('FLOORED', 700);
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
  heldItemEl.textContent = `HELD: ${obj.userData.label}`;
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
  heldItemEl.textContent = 'EMPTY HANDS';
}

function throwHeld() {
  const obj = player.held;
  if (!obj) return;

  const label = obj.userData.label;
  const damage = obj.userData.damage;
  player.held = null;
  heldItemEl.textContent = 'EMPTY HANDS';
  scene.remove(obj);
  world.add(obj);

  obj.userData = {
    type: 'thrown',
    label,
    damage,
    vel: camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10).add(new THREE.Vector3(0, 1.1, 0)),
    life: 4
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
  // Loose street items and breakable signs should feel solid to pedestrians.
  for (const obj of pickupGroup.children) {
    const extra = obj.userData?.label === 'PLANK' ? 0.65 : 0.42;
    if (Math.hypot(x - obj.position.x, z - obj.position.z) < radius + extra) return true;
  }
  for (const obj of breakableGroup.children) {
    // Windows live on the building facade and are already covered by the
    // building collider. Small sign panels still count as street obstacles.
    if (obj.userData?.label !== 'SIGN') continue;
    if (Math.hypot(x - obj.position.x, z - obj.position.z) < radius + 0.52) return true;
  }
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
      if (root.position.z > 39 || root.position.z < -39) npc.dir *= -1;

      // Walk generally along the street, but softly return to the NPC's
      // original lane after detouring around clutter.
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
      if (!npc || npc.state === 'down') continue;

      const chest = new THREE.Vector3(root.position.x, 1, root.position.z);
      if (obj.position.distanceTo(chest) < 0.85) {
        npc.hp -= obj.userData.damage;
        reactToHit(npc, 0.48);
        bloodBurst(obj.position);
        debrisBurst(obj.position, 0x754337);
        showMsg('SMASH', 450);
        obj.userData.life = 0;

        if (npc.hp <= 0) knockDownNPC(npc);
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
        break;
      }
    }

    if (obj.position.y < 0.15 || obj.userData.life <= 0) {
      obj.position.y = 0.24;
      obj.userData.type = 'pickup';
      obj.userData.label ||= 'JUNK';
      obj.userData.damage ||= 18;
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
  if (e.code === 'KeyQ') dropHeld();
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
  pickup();
});

function start() {
  if (!characterSources.length) return;
  player.health = 100;
  player.alive = true;
  setHealth(100);
  player.yaw = 0;
  player.pitch = 0;
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
  const dt = Math.min(0.033, clock.getDelta());

  if (running) {
    updatePlayer(dt);
    updateNPCs(dt);
    updateThrown(dt);
    updateEffects(dt);
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
