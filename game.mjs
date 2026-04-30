import * as THREE from 'three';

const screenEl = document.getElementById('screen');
const startScreenEl = document.getElementById('startScreen');
const restartPromptEl = document.getElementById('restartPrompt');
const messageEl = document.getElementById('message');
const damageFlashEl = document.getElementById('damageFlash');
const boomFlashEl = document.getElementById('boomFlash');
const crosshairEl = document.getElementById('crosshair');
const minimapCanvas = document.getElementById('minimap');
const weaponPreviewCanvas = document.getElementById('weaponPreview');
const minimapCtx = minimapCanvas.getContext('2d');
minimapCtx.imageSmoothingEnabled = false;
const hud = {
  health: document.getElementById('hudHealth'),
  weapon: document.getElementById('weaponName'),
  ammo: document.getElementById('hudAmmo'),
  grenades: document.getElementById('hudGrenades'),
  time: document.getElementById('hudTime'),
  kills: document.getElementById('hudKills'),
  score: document.getElementById('hudScore'),
  best: document.getElementById('hudBest'),
};

const MAP_W = 72;
const MAP_H = 72;
const CELL = 3;
const WALL_HEIGHT_MIN = 3.6;
const WALL_HEIGHT_MAX = 5.4;
const PLAYER_RADIUS = 0.82;
const HALF_WORLD_X = MAP_W * CELL * 0.5;
const HALF_WORLD_Z = MAP_H * CELL * 0.5;
const MAX_HEALTH = 100;
const WORLD_FLOOR_Y = 0;
const FLOOR_REPEAT = 18;
const VISION_RADIUS_TILES = 11;
const FLOOR_LIGHT_TEXEL_SCALE = 8;
const ENEMY_SPEED_SCALE = 0.46;

const keys = new Map();
const handledInputEvents = new WeakSet();
const START_LOADOUT_CODE = String.fromCharCode(103, 111, 100, 109, 111, 100, 101);
const mouse = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5, down: false, right: false, ndc: new THREE.Vector2() };
const tmpVec3 = new THREE.Vector3();
const tmpVec3B = new THREE.Vector3();
const tmpVec2 = new THREE.Vector2();
const tmpQuat = new THREE.Quaternion();
const tmpMat = new THREE.Matrix4();
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const shaderTime = { value: 0 };
const torchConeUniforms = {
  uTime: shaderTime,
  uPlayer: { value: new THREE.Vector2() },
  uAim: { value: new THREE.Vector2(1, 0) },
  uReveal: { value: null },
};

function normalizeInputKey(key) {
  if (!key) return null;
  if (key === ' ') return 'space';
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

function getLegacyKeyAlias(event) {
  switch (event.keyCode) {
    case 32: return 'space';
    case 49: return '1';
    case 50: return '2';
    case 51: return '3';
    case 52: return '4';
    case 53: return '5';
    case 65: return 'a';
    case 68: return 'd';
    case 82: return 'r';
    case 81: return 'q';
    case 83: return 's';
    case 87: return 'w';
    default: return null;
  }
}

function getEventInputAliases(event) {
  const aliases = new Set();
  if (event.code) aliases.add(event.code);
  const normalizedKey = normalizeInputKey(event.key);
  if (normalizedKey) aliases.add(normalizedKey);
  const legacyAlias = getLegacyKeyAlias(event);
  if (legacyAlias) aliases.add(legacyAlias);
  return aliases;
}

function setInputState(event, pressed) {
  for (const alias of getEventInputAliases(event)) {
    keys.set(alias, pressed);
  }
}

function isInputDown(...aliases) {
  return aliases.some((alias) => keys.get(alias));
}

function eventMatchesInput(event, ...aliases) {
  for (const alias of getEventInputAliases(event)) {
    if (aliases.includes(alias)) return true;
  }
  return false;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06080d);
scene.fog = new THREE.FogExp2(0x06080d, 0.0225);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 100);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.64;
screenEl.prepend(renderer.domElement);

const worldGroup = new THREE.Group();
const actorsGroup = new THREE.Group();
const fxGroup = new THREE.Group();
scene.add(worldGroup, actorsGroup, fxGroup);

const ambient = new THREE.AmbientLight(0x161d29, 0.44);
const hemi = new THREE.HemisphereLight(0x3a4657, 0x05060a, 0.3);
scene.add(ambient, hemi);

const torchTarget = new THREE.Object3D();
const torch = new THREE.SpotLight(0xffd39d, 74, 72, Math.PI * 0.27, 0.78, 1.12);
torch.castShadow = true;
torch.shadow.mapSize.set(1024, 1024);
torch.shadow.bias = -0.0004;
torch.shadow.normalBias = 0.03;
torch.shadow.camera.near = 0.5;
torch.shadow.camera.far = 50;
torch.shadow.focus = 0.9;
scene.add(torch, torchTarget);
torch.target = torchTarget;

const lanternTarget = new THREE.Object3D();
const lantern = new THREE.SpotLight(0xffc690, 12, 20, Math.PI * 0.42, 0.88, 1.85);
lantern.castShadow = false;
lantern.shadow.mapSize.set(768, 768);
lantern.shadow.bias = -0.00035;
lantern.shadow.normalBias = 0.045;
lantern.shadow.camera.near = 0.5;
lantern.shadow.camera.far = 36;
lantern.shadow.focus = 0.78;
scene.add(lantern, lanternTarget);
lantern.target = lanternTarget;

const haloLight = new THREE.PointLight(0xffb55f, 0.95, 8.5, 2.25);
scene.add(haloLight);

const muzzleLights = [];
const blastLights = [];

const floorTexture = createFloorTexture();
const particleTexture = createParticleTexture();
const ringTexture = createRingTexture();
const explorationLayer = createExplorationLayer();
torchConeUniforms.uReveal.value = explorationLayer.texture;

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL),
  createDungeonFloorMaterial()
);
floor.rotation.x = -Math.PI * 0.5;
floor.receiveShadow = false;
floor.position.y = WORLD_FLOOR_Y;
worldGroup.add(floor);

const floorGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL),
  createFloorGlowMaterial()
);
floorGlow.rotation.x = -Math.PI * 0.5;
floorGlow.position.y = WORLD_FLOOR_Y + 0.018;
worldGroup.add(floorGlow);

const torchCone = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL),
  createTorchConeMaterial()
);
torchCone.rotation.x = -Math.PI * 0.5;
torchCone.position.y = WORLD_FLOOR_Y + 0.032;
worldGroup.add(torchCone);

const decalFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL),
  new THREE.MeshBasicMaterial({ color: 0x0a0b0f, transparent: true, opacity: 0.11 })
);
decalFloor.rotation.x = -Math.PI * 0.5;
decalFloor.position.y = WORLD_FLOOR_Y + 0.01;
worldGroup.add(decalFloor);

const dungeon = generateDungeon(0x5eedc0de);
const walkableTiles = [];
for (let y = 0; y < MAP_H; y += 1) {
  for (let x = 0; x < MAP_W; x += 1) {
    if (dungeon.grid[y][x] === 0) walkableTiles.push({ x, y });
  }
}

buildWalls(dungeon.grid);

const player = createPlayer();
actorsGroup.add(player.group);

const enemies = [];
const pickups = [];
const grenades = [];
const particles = [];
const traces = [];
const shockwaves = [];
const floatingTexts = [];
const exploration = createExplorationState();

const WEAPONS = {
  sidearm: {
    name: 'Torch Revolver',
    ammoLabel: '∞',
    fireRate: 3.2,
    damage: 19,
    spread: 0.03,
    pellets: 1,
    range: 24,
    recoil: 0.12,
    shake: 0.1,
    tracerColor: 0xe9efff,
    hitColor: 0xffc36b,
    hitSpark: 4,
    sound: 'sidearm',
  },
  carbine: {
    name: 'Blackout Carbine',
    ammoLabel: '∞',
    fireRate: 10.6,
    damage: 9.5,
    spread: 0.16,
    pellets: 5,
    range: 34,
    recoil: 0.16,
    shake: 0.12,
    tracerColor: 0xffd18a,
    hitColor: 0xffcb71,
    hitSpark: 5,
    sound: 'carbine',
  },
  shotgun: {
    name: 'Crypt Shotgun',
    ammoLabel: 'shells',
    fireRate: 1.15,
    damage: 10,
    spread: 0.24,
    pellets: 8,
    range: 16,
    recoil: 0.26,
    shake: 0.18,
    tracerColor: 0xffd78f,
    hitColor: 0xffaf47,
    hitSpark: 8,
    sound: 'shotgun',
  },
  flamethrower: {
    name: 'Cinder Hose',
    ammoLabel: 'fuel',
    fireRate: 12,
    damage: 3.6,
    spread: 0.34,
    pellets: 10,
    range: 10.5,
    recoil: 0.1,
    shake: 0.08,
    tracerColor: 0xff8a4d,
    hitColor: 0xffb35b,
    hitSpark: 8,
    sound: 'flamethrower',
  },
  nova: {
    name: 'Halo Pulse',
    ammoLabel: 'cells',
    fireRate: 1.36,
    damage: 48,
    spread: 0,
    pellets: 1,
    range: 11.5,
    recoil: 0.08,
    shake: 0.34,
    tracerColor: 0x79ffd6,
    hitColor: 0x79ffd6,
    hitSpark: 11,
    sound: 'nova',
  },
  lightning: {
    name: 'Storm Lash',
    ammoLabel: 'charge',
    fireRate: 8.2,
    damage: 18,
    spread: 0.045,
    pellets: 1,
    range: 20,
    recoil: 0.06,
    shake: 0.12,
    tracerColor: 0x9dc8ff,
    hitColor: 0xd9f0ff,
    hitSpark: 6,
    sound: 'lightning',
  },
};

const WEAPON_ORDER = ['carbine', 'shotgun', 'flamethrower', 'nova', 'lightning'];
const WEAPON_PICKUP_AMOUNTS = {
  shotgun: 28,
  flamethrower: 110,
  nova: 10,
  lightning: 70,
};

const weaponPreview = createWeaponPreview();

const playerState = {
  health: MAX_HEALTH,
  grenades: 3,
  currentWeapon: 'carbine',
  unlocked: {
    carbine: true,
    shotgun: false,
    flamethrower: false,
    nova: false,
    lightning: false,
  },
  ammo: {
    carbine: Infinity,
    shotgun: 0,
    flamethrower: 0,
    nova: 0,
    lightning: 0,
  },
  fireCooldown: 0,
  throwCooldown: 0,
  hurtCooldown: 0,
  hurtFlash: 0,
};

const ENEMY_TYPES = {
  skitter: {
    name: 'skitter',
    hp: 24,
    speed: 7.6 * ENEMY_SPEED_SCALE,
    damage: 6,
    radius: 0.56,
    attackCooldown: 0.85,
    score: 10,
    color: 0x16181d,
    eye: 0xff4e63,
    scale: 0.8,
    movement: 'direct',
  },
  stalker: {
    name: 'stalker',
    hp: 52,
    speed: 5.15 * ENEMY_SPEED_SCALE,
    damage: 9,
    radius: 0.82,
    attackCooldown: 1.05,
    score: 20,
    color: 0x1a1d25,
    eye: 0xff5b74,
    scale: 1.0,
    movement: 'direct',
  },
  viper: {
    name: 'viper',
    hp: 38,
    speed: 6.25 * ENEMY_SPEED_SCALE,
    damage: 8,
    radius: 0.66,
    attackCooldown: 0.95,
    score: 18,
    color: 0x172822,
    eye: 0x79ffd6,
    scale: 0.92,
    movement: 'slither',
  },
  zigzag: {
    name: 'zigzag',
    hp: 44,
    speed: 6.7 * ENEMY_SPEED_SCALE,
    damage: 8,
    radius: 0.7,
    attackCooldown: 0.92,
    score: 22,
    color: 0x182033,
    eye: 0xffd18a,
    scale: 0.95,
    movement: 'zigzag',
  },
  brute: {
    name: 'brute',
    hp: 120,
    speed: 3.45 * ENEMY_SPEED_SCALE,
    damage: 15,
    radius: 1.08,
    attackCooldown: 1.18,
    score: 45,
    color: 0x242830,
    eye: 0xff7a5c,
    scale: 1.28,
    movement: 'direct',
  },
};

const audio = createAudioEngine();

const game = {
  started: false,
  over: false,
  elapsed: 0,
  score: 0,
  kills: 0,
  best: Number(localStorage.getItem('dungeon-blackout-best') || 0),
  spawnAccumulator: 0,
  swarmTimer: 13,
  messageTimer: 0,
  screenShake: 0,
  boomFlash: 0,
  spawnFlash: 0,
  startCodeBuffer: '',
  bonusLoadout: false,
};

hud.best.textContent = String(game.best);
let lastAimWorld = new THREE.Vector3(player.group.position.x + 8, 0, player.group.position.z - 8);

showMessage('Torch online');
resetGame();
animate();

function createAudioEngine() {
  const SFX_GAIN = 5.2;
  const MAX_VOICE_GAIN = 3.2;
  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 1.35;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -4;
      limiter.knee.value = 10;
      limiter.ratio.value = 3;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      master.connect(limiter);
      limiter.connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1.2, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function osc(freq, duration, type, volume, slideTo = null, when = 0) {
    ensure();
    const t0 = ctx.currentTime + when;
    const gain = ctx.createGain();
    const o = ctx.createOscillator();
    const peak = Math.min(MAX_VOICE_GAIN, volume * SFX_GAIN);
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    o.connect(gain);
    gain.connect(master);
    o.start(t0);
    o.stop(t0 + duration + 0.02);
  }

  function noise(duration, volume, highpassFreq, lowpassFreq) {
    ensure();
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = highpassFreq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpassFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.min(MAX_VOICE_GAIN, volume * SFX_GAIN), t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(gain);
    gain.connect(master);
    src.start(t0);
    src.stop(t0 + duration);
  }

  return {
    unlock() { ensure(); },
    shot(kind) {
      if (!ctx) return;
      if (kind === 'sidearm') {
        osc(240, 0.08, 'square', 0.07, 90);
        osc(960, 0.035, 'triangle', 0.022, 360);
      } else if (kind === 'carbine') {
        osc(180, 0.06, 'sawtooth', 0.052, 65);
        osc(640, 0.035, 'square', 0.016, 260);
      } else if (kind === 'shotgun') {
        noise(0.2, 0.1, 90, 1800);
        osc(96, 0.14, 'triangle', 0.058, 34);
        osc(260, 0.045, 'square', 0.025, 110, 0.01);
      } else if (kind === 'flamethrower') {
        noise(0.13, 0.075, 120, 2800);
        osc(118, 0.09, 'sawtooth', 0.03, 78);
        osc(310, 0.035, 'triangle', 0.014, 180, 0.02);
      } else if (kind === 'nova') {
        osc(230, 0.2, 'triangle', 0.065, 72);
        osc(760, 0.14, 'sine', 0.034, 190);
        osc(1180, 0.1, 'square', 0.015, 420, 0.025);
      } else if (kind === 'lightning') {
        noise(0.075, 0.07, 450, 5200);
        osc(460, 0.07, 'square', 0.035, 170);
        osc(920, 0.045, 'sawtooth', 0.018, 340, 0.015);
      }
    },
    hit() {
      if (!ctx) return;
      osc(680, 0.045, 'sine', 0.024, 360);
      osc(220, 0.035, 'triangle', 0.01, 110);
    },
    pickup() {
      if (!ctx) return;
      osc(520, 0.08, 'triangle', 0.04, 900);
      osc(900, 0.12, 'sine', 0.036, 1500, 0.03);
      osc(1320, 0.08, 'sine', 0.018, 1900, 0.07);
    },
    hurt() {
      if (!ctx) return;
      osc(80, 0.16, 'sawtooth', 0.07, 52);
    },
    explosion(big = false) {
      if (!ctx) return;
      noise(big ? 0.46 : 0.26, big ? 0.14 : 0.095, 60, big ? 920 : 1600);
      osc(big ? 56 : 86, big ? 0.38 : 0.2, 'triangle', big ? 0.085 : 0.052, 24);
      osc(big ? 180 : 260, 0.08, 'square', big ? 0.028 : 0.018, 90, 0.02);
    },
    swarm() {
      if (!ctx) return;
      osc(210, 0.24, 'sawtooth', 0.038, 120);
      osc(160, 0.28, 'triangle', 0.028, 90, 0.06);
      noise(0.18, 0.025, 220, 1600);
    },
  };
}

function createWeaponPreview() {
  const renderer = new THREE.WebGLRenderer({ canvas: weaponPreviewCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 0.15, 5.1);

  const root = new THREE.Group();
  scene.add(root);

  const ambient = new THREE.AmbientLight(0xf1efe8, 1.45);
  const keyLight = new THREE.DirectionalLight(0xffe0b2, 2.8);
  keyLight.position.set(2.6, 3.2, 4.4);
  const rimLight = new THREE.DirectionalLight(0x8ec5ff, 1.6);
  rimLight.position.set(-3.2, 1.4, 1.8);
  scene.add(ambient, keyLight, rimLight);

  const models = {};
  for (const key of WEAPON_ORDER) {
    const model = createWeaponPreviewModel(key);
    model.visible = false;
    root.add(model);
    models[key] = model;
  }

  syncWeaponPreviewSize({ renderer, camera });
  return { renderer, scene, camera, root, models, activeKey: null, spin: 0 };
}

function createWeaponPreviewModel(key) {
  const group = new THREE.Group();
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x252c37, roughness: 0.72, metalness: 0.16 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xbec7d3, roughness: 0.32, metalness: 0.82 });
  const glowMat = new THREE.MeshStandardMaterial({ color: getPickupColor('weapon', key), emissive: getPickupColor('weapon', key), emissiveIntensity: 0.8, roughness: 0.28, metalness: 0.3 });
  const warmMat = new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.84, metalness: 0.06 });

  if (key === 'carbine') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.34, 0.34), darkMat);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.28, 0.42), darkMat);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 12), metalMat);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.62, 0.16), glowMat);
    stock.position.set(-1.08, -0.16, 0);
    barrel.rotation.z = Math.PI * 0.5;
    barrel.position.set(1.35, 0.02, 0);
    mag.position.set(-0.12, -0.46, 0);
    group.add(body, stock, barrel, mag);
  } else if (key === 'shotgun') {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.28, 0.36), warmMat);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.38), darkMat);
    const barrelA = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.55, 12), metalMat);
    const barrelB = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.55, 12), metalMat);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.42), glowMat);
    stock.position.set(-1.12, -0.14, 0);
    receiver.position.set(-0.35, 0, 0);
    barrelA.rotation.z = barrelB.rotation.z = Math.PI * 0.5;
    barrelA.position.set(0.82, 0.1, -0.08);
    barrelB.position.set(0.82, -0.1, 0.08);
    pump.position.set(0.28, -0.28, 0);
    group.add(stock, receiver, barrelA, barrelB, pump);
  } else if (key === 'flamethrower') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.32, 0.34), darkMat);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.4, 12), glowMat);
    const tankA = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 14), metalMat);
    const tankB = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.9, 14), metalMat);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.62, 0.18), warmMat);
    nozzle.rotation.z = Math.PI * 0.5;
    nozzle.position.set(0.82, 0.02, 0);
    tankA.rotation.z = tankB.rotation.z = Math.PI * 0.5;
    tankA.position.set(-0.64, -0.44, -0.18);
    tankB.position.set(-0.64, -0.44, 0.18);
    handle.position.set(-0.1, -0.38, 0);
    group.add(body, nozzle, tankA, tankB, handle);
  } else if (key === 'nova') {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 10), darkMat);
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), glowMat);
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 10, 26), metalMat);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 10, 26), metalMat);
    grip.position.set(-0.82, -0.12, 0);
    grip.rotation.z = 0.4;
    core.position.set(0.08, 0.08, 0);
    ringA.rotation.x = Math.PI * 0.5;
    ringB.rotation.y = Math.PI * 0.5;
    group.add(grip, core, ringA, ringB);
  } else if (key === 'lightning') {
    const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 12), darkMat);
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.48, 12), glowMat);
    const prongA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.14), metalMat);
    const prongB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.14), metalMat);
    const prongC = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.14), glowMat);
    haft.rotation.z = 0.32;
    coil.position.set(0.44, 0.52, 0);
    coil.rotation.z = 0.32;
    prongA.position.set(0.98, 0.98, -0.14);
    prongB.position.set(1.12, 0.76, 0.14);
    prongC.position.set(0.9, 0.72, 0);
    prongA.rotation.z = 0.5;
    prongB.rotation.z = -0.15;
    prongC.rotation.z = 0.2;
    group.add(haft, coil, prongA, prongB, prongC);
  }

  group.rotation.set(-0.35, 0.9, 0.08);
  return group;
}

function syncWeaponPreviewSize(preview = weaponPreview) {
  const width = Math.max(1, Math.floor(weaponPreviewCanvas.clientWidth || 280));
  const height = Math.max(1, Math.floor(weaponPreviewCanvas.clientHeight || 150));
  preview.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  preview.renderer.setSize(width, height, false);
  preview.camera.aspect = width / height;
  preview.camera.updateProjectionMatrix();
}

function setActiveWeaponPreview(key) {
  if (weaponPreview.activeKey === key) return;
  weaponPreview.activeKey = key;
  for (const previewKey of WEAPON_ORDER) {
    weaponPreview.models[previewKey].visible = previewKey === key;
  }
}

function renderWeaponPreview(dt) {
  weaponPreview.spin += dt;
  const model = weaponPreview.models[playerState.currentWeapon];
  if (model) {
    model.rotation.y = 0.9 + Math.sin(weaponPreview.spin * 0.8) * 0.18;
    model.rotation.x = -0.35 + Math.sin(weaponPreview.spin * 0.55) * 0.05;
    model.position.y = Math.sin(weaponPreview.spin * 1.3) * 0.08;
  }
  weaponPreview.renderer.render(weaponPreview.scene, weaponPreview.camera);
}

function createDungeonFloorMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x22272f,
    map: floorTexture,
    roughness: 0.98,
    metalness: 0.04,
    emissive: new THREE.Color(0xf2cd92),
    emissiveIntensity: 0.34,
    emissiveMap: explorationLayer.texture,
  });
}

function createFloorGlowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shaderTime,
      uTintA: { value: new THREE.Color(0xffd18a) },
      uTintB: { value: new THREE.Color(0x79ffd6) },
      uReveal: { value: explorationLayer.texture },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uTintA;
      uniform vec3 uTintB;
      uniform sampler2D uReveal;
      varying vec2 vUv;
      float lineGrid(vec2 uv, float scale, float width) {
        vec2 cell = abs(fract(uv * scale) - 0.5);
        float d = min(cell.x, cell.y);
        return smoothstep(width, 0.0, d);
      }
      void main() {
        vec2 centered = vUv - 0.5;
        float radius = length(centered);
        float pulse = 0.5 + 0.5 * sin(uTime * 0.75 + radius * 24.0);
        float grid = lineGrid(vUv + vec2(uTime * 0.006, -uTime * 0.004), 28.0, 0.02);
        float sigil = smoothstep(0.018, 0.0, abs(sin((atan(centered.y, centered.x) * 6.0) + radius * 52.0 - uTime * 1.7))) * smoothstep(0.48, 0.05, radius);
        vec3 revealSample = texture2D(uReveal, vUv).rgb;
        float reveal = smoothstep(0.015, 0.22, max(max(revealSample.r, revealSample.g), revealSample.b));
        float alpha = (grid * 0.075 + sigil * 0.13) * (0.55 + pulse * 0.45);
        vec3 color = mix(uTintB, uTintA, pulse);
        gl_FragColor = vec4(color, alpha * reveal);
      }
    `,
  });
}

function createTorchConeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: torchConeUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      varying vec2 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec2 uPlayer;
      uniform vec2 uAim;
      uniform sampler2D uReveal;
      varying vec2 vUv;
      varying vec2 vWorld;
      void main() {
        vec2 toPixel = vWorld - uPlayer;
        float dist = length(toPixel);
        vec2 dir = dist > 0.001 ? toPixel / dist : uAim;
        vec2 aim = normalize(uAim);
        float forward = dot(dir, aim);
        float cone = smoothstep(0.42, 0.94, forward) * smoothstep(58.0, 5.0, dist);
        float hotCore = smoothstep(0.88, 1.0, forward) * smoothstep(34.0, 3.0, dist);
        float sideFeather = smoothstep(0.02, 0.62, forward) * smoothstep(24.0, 0.0, dist) * 0.16;
        float rearSpill = smoothstep(9.0, 0.0, dist) * 0.08;
        float pulse = 0.9 + sin(uTime * 17.0 + dist * 0.24) * 0.04;
        vec3 revealSample = texture2D(uReveal, vUv).rgb;
        float reveal = smoothstep(0.01, 0.16, max(max(revealSample.r, revealSample.g), revealSample.b));
        float alpha = (cone * 0.18 + hotCore * 0.08 + sideFeather + rearSpill) * reveal * pulse;
        vec3 color = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.86, 0.48), hotCore);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function createFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#21262f';
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 32) {
      const tone = 30 + ((x + y) % 64 === 0 ? 10 : 0) + Math.floor(Math.random() * 12);
      ctx.fillStyle = `rgb(${tone}, ${tone + 4}, ${tone + 8})`;
      ctx.fillRect(x, y, 31, 31);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.strokeRect(x + 0.5, y + 0.5, 31, 31);
    }
  }

  for (let i = 0; i < 3200; i += 1) {
    const alpha = Math.random() * 0.11;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2.6, 1 + Math.random() * 2.6);
  }

  for (let i = 0; i < 22; i += 1) {
    ctx.strokeStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.06})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(Math.random() * 256, Math.random() * 256);
    ctx.lineTo(Math.random() * 256, Math.random() * 256);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(FLOOR_REPEAT, FLOOR_REPEAT);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createRingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 28, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.46, 'rgba(255,255,255,0)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}


function createExplorationLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * FLOOR_LIGHT_TEXEL_SCALE;
  canvas.height = MAP_H * FLOOR_LIGHT_TEXEL_SCALE;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return { canvas, ctx, texture, scale: FLOOR_LIGHT_TEXEL_SCALE };
}

function createExplorationState() {
  return {
    exploredFloor: Array.from({ length: MAP_H }, () => new Uint8Array(MAP_W)),
    exploredWall: Array.from({ length: MAP_H }, () => new Uint8Array(MAP_W)),
    visibleFloor: Array.from({ length: MAP_H }, () => new Float32Array(MAP_W)),
    visibleWall: Array.from({ length: MAP_H }, () => new Float32Array(MAP_W)),
    revealAccumulator: 0,
    lastPlayerX: Infinity,
    lastPlayerZ: Infinity,
    lastAimX: Infinity,
    lastAimY: Infinity,
  };
}

function clearVisibility(field) {
  for (const row of field) row.fill(0);
}

function markWallVisible(tx, ty, intensity) {
  if (!isInsideMap(tx, ty) || dungeon.grid[ty][tx] === 0) return;
  exploration.exploredWall[ty][tx] = 1;
  exploration.visibleWall[ty][tx] = Math.max(exploration.visibleWall[ty][tx], intensity);
}

function markTileVisible(tx, ty, intensity) {
  if (!isInsideMap(tx, ty)) return;
  if (dungeon.grid[ty][tx] !== 0) {
    markWallVisible(tx, ty, intensity);
    return;
  }
  exploration.exploredFloor[ty][tx] = 1;
  exploration.visibleFloor[ty][tx] = Math.max(exploration.visibleFloor[ty][tx], intensity);
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      markWallVisible(tx + ox, ty + oy, intensity * (Math.abs(ox) + Math.abs(oy) === 2 ? 0.7 : 0.92));
    }
  }
}

function canSeeWorldPoint(origin, target, padding = CELL * 0.42) {
  const dx = target.x - origin.x;
  const dz = target.z - origin.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= CELL * 0.86) return true;
  const dir = { x: dx / dist, z: dz / dist };
  return stepRayToWall(origin, dir, dist + padding) + CELL * 0.18 >= dist;
}

function resetExploration() {
  for (const row of exploration.exploredFloor) row.fill(0);
  for (const row of exploration.exploredWall) row.fill(0);
  clearVisibility(exploration.visibleFloor);
  clearVisibility(exploration.visibleWall);
  exploration.revealAccumulator = 0;
  exploration.lastPlayerX = Infinity;
  exploration.lastPlayerZ = Infinity;
  exploration.lastAimX = Infinity;
  exploration.lastAimY = Infinity;
  updateExploration(0, true);
}

function drawExplorationTexture() {
  const { canvas, ctx, texture, scale } = explorationLayer;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      if (!exploration.exploredFloor[y][x]) continue;
      const visible = exploration.visibleFloor[y][x];
      const base = 18 + Math.round(visible * 82);
      const g = 12 + Math.round(visible * 52);
      const b = 8 + Math.round(visible * 24);
      ctx.fillStyle = `rgb(${base}, ${g}, ${b})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  const px = ((player.group.position.x + HALF_WORLD_X) / (MAP_W * CELL)) * canvas.width;
  const py = ((player.group.position.z + HALF_WORLD_Z) / (MAP_H * CELL)) * canvas.height;
  const glow = ctx.createRadialGradient(px, py, scale * 1.4, px, py, scale * 8.4);
  glow.addColorStop(0, 'rgba(255, 226, 170, 0.58)');
  glow.addColorStop(0.22, 'rgba(255, 204, 132, 0.32)');
  glow.addColorStop(0.68, 'rgba(110, 70, 35, 0.06)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(px, py, scale * 8.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  texture.needsUpdate = true;
}

function drawMinimap() {
  const ctx = minimapCtx;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  const cw = w / MAP_W;
  const ch = h / MAP_H;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, w, h);

  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const vx = x * cw;
      const vy = y * ch;
      if (exploration.exploredWall[y][x]) {
        const vis = exploration.visibleWall[y][x];
        const color = vis > 0
          ? `rgb(${70 + Math.round(vis * 130)}, ${78 + Math.round(vis * 110)}, ${92 + Math.round(vis * 90)})`
          : '#3b434f';
        ctx.fillStyle = color;
        ctx.fillRect(vx, vy, Math.ceil(cw), Math.ceil(ch));
      } else if (exploration.exploredFloor[y][x]) {
        const vis = exploration.visibleFloor[y][x];
        const color = vis > 0
          ? `rgb(${110 + Math.round(vis * 120)}, ${88 + Math.round(vis * 86)}, ${56 + Math.round(vis * 42)})`
          : '#18212a';
        ctx.fillStyle = color;
        ctx.fillRect(vx, vy, Math.ceil(cw), Math.ceil(ch));
      }
    }
  }

  for (const pickup of pickups) {
    const tile = worldToTile(pickup.group.position.x, pickup.group.position.z);
    if (!isInsideMap(tile.tx, tile.ty)) continue;
    if (!exploration.exploredFloor[tile.ty][tile.tx]) continue;
    ctx.fillStyle = pickup.kind === 'health'
      ? '#79ffd6'
      : pickup.kind === 'ammo'
        ? '#ffd18a'
        : pickup.kind === 'grenade'
          ? '#ff8a66'
          : pickup.meta === 'flamethrower'
            ? '#ff7f4f'
            : pickup.meta === 'nova'
              ? '#79ffd6'
              : pickup.meta === 'lightning'
                ? '#9dc8ff'
                : '#ffbf73';
    ctx.fillRect(tile.tx * cw + cw * 0.22, tile.ty * ch + ch * 0.22, Math.max(2, cw * 0.56), Math.max(2, ch * 0.56));
  }

  for (const enemy of enemies) {
    const tile = worldToTile(enemy.group.position.x, enemy.group.position.z);
    if (!isInsideMap(tile.tx, tile.ty)) continue;
    if (exploration.visibleFloor[tile.ty][tile.tx] <= 0.02) continue;
    ctx.fillStyle = enemy.typeKey === 'viper'
      ? '#79ffd6'
      : enemy.typeKey === 'zigzag'
        ? '#ffd18a'
        : enemy.typeKey === 'brute'
          ? '#ff8a66'
          : '#ff5f74';
    ctx.beginPath();
    ctx.arc(tile.tx * cw + cw * 0.5, tile.ty * ch + ch * 0.5, Math.max(1.5, Math.min(cw, ch) * 0.28), 0, Math.PI * 2);
    ctx.fill();
  }

  const px = ((player.group.position.x + HALF_WORLD_X) / (MAP_W * CELL)) * w;
  const py = ((player.group.position.z + HALF_WORLD_Z) / (MAP_H * CELL)) * h;
  const ax = px + player.aimDir.x * 9;
  const ay = py + player.aimDir.y * 9;
  ctx.strokeStyle = 'rgba(255, 230, 180, 0.88)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(ax, ay);
  ctx.stroke();
  ctx.fillStyle = '#79ffd6';
  ctx.beginPath();
  ctx.arc(px, py, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

function updateExploration(dt, force = false) {
  exploration.revealAccumulator += dt;
  const dx = player.group.position.x - exploration.lastPlayerX;
  const dz = player.group.position.z - exploration.lastPlayerZ;
  const movedEnough = dx * dx + dz * dz > 0.18;
  const aimChanged = Math.abs(player.aimDir.x - exploration.lastAimX) + Math.abs(player.aimDir.y - exploration.lastAimY) > 0.085;
  if (!force && exploration.revealAccumulator < 0.05 && !movedEnough && !aimChanged) return;

  exploration.revealAccumulator = 0;
  exploration.lastPlayerX = player.group.position.x;
  exploration.lastPlayerZ = player.group.position.z;
  exploration.lastAimX = player.aimDir.x;
  exploration.lastAimY = player.aimDir.y;
  clearVisibility(exploration.visibleFloor);
  clearVisibility(exploration.visibleWall);

  const origin = player.group.position;
  const tile = worldToTile(origin.x, origin.z);
  const radiusWorld = VISION_RADIUS_TILES * CELL;

  for (let ty = tile.ty - VISION_RADIUS_TILES; ty <= tile.ty + VISION_RADIUS_TILES; ty += 1) {
    for (let tx = tile.tx - VISION_RADIUS_TILES; tx <= tile.tx + VISION_RADIUS_TILES; tx += 1) {
      if (!isInsideMap(tx, ty)) continue;
      const pos = tileToWorld(tx, ty);
      const dist = Math.hypot(pos.x - origin.x, pos.z - origin.z);
      if (dist > radiusWorld) continue;
      if (!canSeeWorldPoint(origin, pos)) continue;
      const intensity = clamp(1 - dist / radiusWorld, 0.16, 1);
      markTileVisible(tx, ty, intensity);
    }
  }

  const forward = new THREE.Vector2(player.aimDir.x, player.aimDir.y);
  for (let i = 1; i <= 18; i += 1) {
    const sample = origin.clone().add(new THREE.Vector3(forward.x * i * 1.75, 0, forward.y * i * 1.75));
    const targetTile = worldToTile(sample.x, sample.z);
    if (!isInsideMap(targetTile.tx, targetTile.ty)) break;
    if (!canSeeWorldPoint(origin, tileToWorld(targetTile.tx, targetTile.ty), CELL * 0.6)) break;
    markTileVisible(targetTile.tx, targetTile.ty, clamp(1 - i / 21, 0.18, 0.86));
    if (dungeon.grid[targetTile.ty][targetTile.tx] !== 0) break;
  }

  drawExplorationTexture();
  drawMinimap();
}

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rotate2(vx, vz, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: vx * c - vz * s, z: vx * s + vz * c };
}

function angleForNegativeZFacing(dirX, dirZ) {
  return Math.atan2(-dirX, -dirZ);
}

function lerpAngle(from, to, amount) {
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * amount;
}

function formatTime(seconds) {
  const s = Math.floor(seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function showMessage(text, duration = 1.65) {
  messageEl.textContent = text;
  messageEl.style.opacity = '1';
  game.messageTimer = duration;
}

function getEnemySpeedMultiplier() {
  return 1 + game.elapsed * 0.00055;
}

function generateDungeon(seed) {
  const rng = mulberry32(seed);
  const grid = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(1));
  const rooms = [];

  function carveRoom(x, y, w, h) {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        grid[yy][xx] = 0;
      }
    }
  }

  function overlaps(x, y, w, h) {
    for (const room of rooms) {
      if (
        x < room.x + room.w + 2 &&
        x + w + 2 > room.x &&
        y < room.y + room.h + 2 &&
        y + h + 2 > room.y
      ) {
        return true;
      }
    }
    return false;
  }

  for (let attempts = 0; attempts < 220 && rooms.length < 22; attempts += 1) {
    const w = randInt(rng, 6, 12);
    const h = randInt(rng, 6, 12);
    const x = randInt(rng, 2, MAP_W - w - 3);
    const y = randInt(rng, 2, MAP_H - h - 3);
    if (overlaps(x, y, w, h)) continue;
    const room = { x, y, w, h, cx: x + Math.floor(w * 0.5), cy: y + Math.floor(h * 0.5) };
    rooms.push(room);
    carveRoom(x, y, w, h);
  }

  function carveCorridor(x1, y1, x2, y2) {
    const wide = randInt(rng, 1, 2);
    if (rng() < 0.5) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
        for (let o = -wide; o <= wide; o += 1) {
          const yy = clamp(y1 + o, 1, MAP_H - 2);
          grid[yy][x] = 0;
        }
      }
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
        for (let o = -wide; o <= wide; o += 1) {
          const xx = clamp(x2 + o, 1, MAP_W - 2);
          grid[y][xx] = 0;
        }
      }
    } else {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
        for (let o = -wide; o <= wide; o += 1) {
          const xx = clamp(x1 + o, 1, MAP_W - 2);
          grid[y][xx] = 0;
        }
      }
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
        for (let o = -wide; o <= wide; o += 1) {
          const yy = clamp(y2 + o, 1, MAP_H - 2);
          grid[yy][x] = 0;
        }
      }
    }
  }

  for (let i = 1; i < rooms.length; i += 1) {
    carveCorridor(rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);
  }
  for (let i = 0; i < Math.floor(rooms.length * 0.45); i += 1) {
    const a = rooms[randInt(rng, 0, rooms.length - 1)];
    const b = rooms[randInt(rng, 0, rooms.length - 1)];
    if (a !== b) carveCorridor(a.cx, a.cy, b.cx, b.cy);
  }

  for (const room of rooms) {
    if (room.w < 8 || room.h < 8 || rng() < 0.25) continue;
    const pillars = randInt(rng, 1, 4);
    for (let i = 0; i < pillars; i += 1) {
      const pw = randInt(rng, 1, 2);
      const ph = randInt(rng, 1, 2);
      const px = randInt(rng, room.x + 1, room.x + room.w - pw - 2);
      const py = randInt(rng, room.y + 1, room.y + room.h - ph - 2);
      if (Math.abs(px + pw * 0.5 - room.cx) < 2 && Math.abs(py + ph * 0.5 - room.cy) < 2) continue;
      for (let yy = py; yy < py + ph; yy += 1) {
        for (let xx = px; xx < px + pw; xx += 1) {
          grid[yy][xx] = 2;
        }
      }
    }
  }

  return { grid, rooms };
}

function tileToWorld(tx, ty) {
  return {
    x: (tx - MAP_W * 0.5 + 0.5) * CELL,
    z: (ty - MAP_H * 0.5 + 0.5) * CELL,
  };
}

function worldToTile(x, z) {
  return {
    tx: Math.floor((x + HALF_WORLD_X) / CELL),
    ty: Math.floor((z + HALF_WORLD_Z) / CELL),
  };
}

function isInsideMap(tx, ty) {
  return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;
}

function isWalkable(tx, ty) {
  return isInsideMap(tx, ty) && dungeon.grid[ty][tx] === 0;
}

function buildWalls(grid) {
  const exposed = [];
  const colors = [];
  const capColors = [];
  const rng = mulberry32(0x9a11ed33);
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      if (grid[y][x] === 0) continue;
      const neighbors = [
        isWalkable(x + 1, y),
        isWalkable(x - 1, y),
        isWalkable(x, y + 1),
        isWalkable(x, y - 1),
      ];
      if (!neighbors.some(Boolean)) continue;
      exposed.push({ x, y, t: grid[y][x] });
      const shade = grid[y][x] === 2 ? 0x465061 : (rng() < 0.5 ? 0x3e4653 : 0x4a5361);
      const color = new THREE.Color(shade);
      colors.push(color);
      capColors.push(color.clone().multiplyScalar(1.18));
    }
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.04,
    vertexColors: true,
    emissive: 0x07090d,
    emissiveIntensity: 0.3,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, exposed.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const capMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.05,
    vertexColors: true,
    emissive: 0x0a0d12,
    emissiveIntensity: 0.32,
  });
  const capMesh = new THREE.InstancedMesh(geometry, capMaterial, exposed.length);
  capMesh.castShadow = true;
  capMesh.receiveShadow = true;

  for (let i = 0; i < exposed.length; i += 1) {
    const cell = exposed[i];
    const pos = tileToWorld(cell.x, cell.y);
    const h = cell.t === 2 ? WALL_HEIGHT_MAX - 0.2 : lerp(WALL_HEIGHT_MIN, WALL_HEIGHT_MAX, rng());
    tmpMat.compose(
      new THREE.Vector3(pos.x, h * 0.5, pos.z),
      tmpQuat.identity(),
      new THREE.Vector3(CELL * 0.98, h, CELL * 0.98)
    );
    mesh.setMatrixAt(i, tmpMat);
    mesh.setColorAt(i, colors[i]);

    tmpMat.compose(
      new THREE.Vector3(pos.x, h - 0.12, pos.z),
      tmpQuat.identity(),
      new THREE.Vector3(CELL * 0.9, 0.22, CELL * 0.9)
    );
    capMesh.setMatrixAt(i, tmpMat);
    capMesh.setColorAt(i, capColors[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  capMesh.instanceMatrix.needsUpdate = true;
  if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
  worldGroup.add(mesh, capMesh);

  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x08090d, transparent: true, opacity: 0.28 });
  for (let i = 0; i < 110; i += 1) {
    const tile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    const pos = tileToWorld(tile.x, tile.y);
    const stain = new THREE.Mesh(
      new THREE.CircleGeometry(0.4 + Math.random() * 1.5, 18),
      edgeMaterial
    );
    stain.rotation.x = -Math.PI * 0.5;
    stain.position.set(pos.x + (Math.random() - 0.5) * 1.4, 0.015, pos.z + (Math.random() - 0.5) * 1.4);
    stain.scale.setScalar(1 + Math.random() * 1.8);
    worldGroup.add(stain);
  }
}

function createPlayer() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7a7f8c, roughness: 0.62, metalness: 0.18 });
  const coatMat = new THREE.MeshStandardMaterial({ color: 0x252933, roughness: 0.88, metalness: 0.02 });
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x383d49, roughness: 0.55, metalness: 0.35 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xffd18a, emissive: 0xffa550, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.22 });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0x9dc8ff });
  const torchMat = new THREE.MeshStandardMaterial({ color: 0x3d2f1e, emissive: 0xffa550, emissiveIntensity: 0.8, roughness: 0.5, metalness: 0.25 });

  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 1.2, 12), coatMat);
  legs.position.y = 0.6;
  const bootLeft = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.54), gunMat);
  const bootRight = bootLeft.clone();
  bootLeft.position.set(-0.23, 0.1, -0.08);
  bootRight.position.set(0.23, 0.1, -0.08);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.58, 1.25, 14), bodyMat);
  torso.position.y = 1.55;
  const coatPanel = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.9, 0.08), coatMat);
  coatPanel.position.set(0, 1.5, -0.52);
  const chestGlow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.08), trimMat);
  chestGlow.position.set(0, 1.72, -0.58);
  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 14), coatMat);
  shoulders.scale.set(1.2, 0.65, 1.0);
  shoulders.position.y = 2.2;
  const armLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.76, 10), coatMat);
  const armRight = armLeft.clone();
  armLeft.rotation.x = 0.78;
  armRight.rotation.x = 0.78;
  armLeft.position.set(-0.55, 1.85, -0.32);
  armRight.position.set(0.55, 1.85, -0.32);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 16), bodyMat);
  head.position.set(0, 2.68, 0.05);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 14), coatMat);
  hood.scale.set(1.05, 0.95, 1.05);
  hood.position.set(0, 2.68, -0.04);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.06), lensMat);
  visor.position.set(0, 2.74, -0.42);
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.055, 8, 24), trimMat);
  scarf.position.set(0, 2.34, -0.02);
  scarf.rotation.x = Math.PI * 0.5;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 1.25), gunMat);
  gun.position.set(0.42, 1.8, -0.55);
  gun.rotation.x = 0.12;
  const gunCore = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.8), trimMat);
  gunCore.position.set(0.42, 1.91, -0.6);
  gunCore.rotation.x = 0.12;
  const torchMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), torchMat);
  torchMesh.rotation.z = Math.PI * 0.5;
  torchMesh.position.set(-0.36, 1.9, -0.55);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: particleTexture,
    color: 0xffc87a,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  glow.position.set(-0.55, 1.9, -0.68);
  glow.scale.setScalar(0.65);

  group.add(legs, bootLeft, bootRight, torso, coatPanel, chestGlow, shoulders, armLeft, armRight, head, hood, visor, scarf, gun, gunCore, torchMesh, glow);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = true;
    }
  });

  const start = tileToWorld(dungeon.rooms[0].cx, dungeon.rooms[0].cy);
  group.position.set(start.x, 0, start.z);

  return {
    group,
    velocity: new THREE.Vector2(),
    aimDir: new THREE.Vector2(1, 0),
    bob: 0,
  };
}

function createEnemy(typeKey, x, z) {
  const type = ENEMY_TYPES[typeKey];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.86, metalness: 0.04, emissive: type.color, emissiveIntensity: 0.16 });
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4c, roughness: 0.65, metalness: 0.12, emissive: 0x151a24, emissiveIntensity: 0.36 });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x5c6675, roughness: 0.58, metalness: 0.16, emissive: 0x101722, emissiveIntensity: 0.25 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: type.eye });
  const animatedParts = { segments: [], fins: [], wings: [] };

  if (typeKey === 'viper') {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42 * type.scale, 16, 14), bodyMat);
    head.scale.set(1.05, 0.72, 1.38);
    head.position.set(0, 0.66 * type.scale, -0.46 * type.scale);
    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.16 * type.scale, 0.5 * type.scale, 9), spikeMat);
    crest.rotation.x = -0.75;
    crest.position.set(0, 1.02 * type.scale, -0.48 * type.scale);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.54 * type.scale, 0.12 * type.scale, 0.34 * type.scale), shellMat);
    jaw.position.set(0, 0.54 * type.scale, -0.72 * type.scale);

    const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.075 * type.scale, 10, 10), eyeMat);
    const eyeRight = eyeLeft.clone();
    eyeLeft.position.set(-0.16 * type.scale, 0.78 * type.scale, -0.84 * type.scale);
    eyeRight.position.set(0.16 * type.scale, 0.78 * type.scale, -0.84 * type.scale);
    group.add(head, crest, jaw, eyeLeft, eyeRight);

    for (let i = 0; i < 7; i += 1) {
      const segmentScale = 1 - i * 0.055;
      const segment = new THREE.Mesh(new THREE.SphereGeometry(0.36 * type.scale * segmentScale, 14, 12), i % 2 ? shellMat : bodyMat);
      segment.scale.set(1.0, 0.52, 1.42);
      segment.position.set(0, 0.48 * type.scale, (0.02 + i * 0.38) * type.scale);
      group.add(segment);
      animatedParts.segments.push(segment);

      if (i < 5) {
        const finLeft = new THREE.Mesh(new THREE.ConeGeometry(0.07 * type.scale, 0.32 * type.scale, 7), spikeMat);
        const finRight = finLeft.clone();
        finLeft.rotation.z = -0.92;
        finRight.rotation.z = 0.92;
        finLeft.position.set(-0.34 * type.scale * segmentScale, 0.7 * type.scale, segment.position.z - 0.02 * type.scale);
        finRight.position.set(0.34 * type.scale * segmentScale, 0.7 * type.scale, segment.position.z - 0.02 * type.scale);
        group.add(finLeft, finRight);
        animatedParts.fins.push(finLeft, finRight);
      }
    }

    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.24 * type.scale, 0.72 * type.scale, 10), bodyMat);
    tail.rotation.x = Math.PI * 0.5;
    tail.position.set(0, 0.44 * type.scale, 2.85 * type.scale);
    group.add(tail);
    animatedParts.segments.push(tail);
  } else {
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.7 * type.scale, 16, 14), bodyMat);
    base.scale.set(typeKey === 'zigzag' ? 0.88 : 1.18, typeKey === 'skitter' ? 0.58 : 0.82, typeKey === 'zigzag' ? 1.34 : 1.0);
    base.position.y = 0.72 * type.scale;

    const upper = new THREE.Mesh(new THREE.SphereGeometry(0.42 * type.scale, 14, 12), shellMat);
    upper.scale.set(typeKey === 'zigzag' ? 0.74 : 1.0, 0.88, typeKey === 'zigzag' ? 1.38 : 1.1);
    upper.position.set(0, 1.15 * type.scale, -0.08);

    const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.1 * type.scale, 10, 10), eyeMat);
    const eyeRight = eyeLeft.clone();
    eyeLeft.position.set(-0.16 * type.scale, 1.17 * type.scale, -0.46 * type.scale);
    eyeRight.position.set(0.16 * type.scale, 1.17 * type.scale, -0.46 * type.scale);

    group.add(base, upper, eyeLeft, eyeRight);

    const legCount = typeKey === 'skitter' ? 6 : 4;
    for (let i = 0; i < legCount; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055 * type.scale, 0.075 * type.scale, 0.72 * type.scale, 7), shellMat);
      leg.rotation.z = side * 0.95;
      leg.rotation.x = 0.18;
      leg.position.set(side * (0.54 + row * 0.06) * type.scale, 0.42 * type.scale, (-0.18 + row * 0.26) * type.scale);
      group.add(leg);
    }

    const spineCount = typeKey === 'brute' ? 5 : 3;
    for (let i = 0; i < spineCount; i += 1) {
      const spine = new THREE.Mesh(new THREE.ConeGeometry(0.09 * type.scale, 0.32 * type.scale, 8), spikeMat);
      spine.rotation.x = -0.55;
      spine.position.set((i - (spineCount - 1) * 0.5) * 0.22 * type.scale, (1.46 + Math.sin(i) * 0.04) * type.scale, 0.02 * type.scale);
      group.add(spine);
    }

    if (typeKey === 'brute') {
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.35, 0.55), shellMat);
      shoulder.position.set(0, 1.42, 0.02);
      const hornLeft = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.48, 9), spikeMat);
      const hornRight = hornLeft.clone();
      hornLeft.rotation.z = -0.62;
      hornRight.rotation.z = 0.62;
      hornLeft.position.set(-0.36, 1.72, -0.28);
      hornRight.position.set(0.36, 1.72, -0.28);
      group.add(shoulder, hornLeft, hornRight);
    }

    if (typeKey === 'zigzag') {
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x52637d, roughness: 0.5, metalness: 0.22, emissive: 0x1a3355, emissiveIntensity: 0.52 });
      for (let i = 0; i < 2; i += 1) {
        const side = i === 0 ? -1 : 1;
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.16 * type.scale, 0.9 * type.scale, 4), bladeMat);
        wing.rotation.z = side * 0.88;
        wing.rotation.x = 0.22;
        wing.position.set(side * 0.58 * type.scale, 0.86 * type.scale, -0.02 * type.scale);
        group.add(wing);
        animatedParts.wings.push(wing);
      }
    }
  }

  const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: particleTexture,
    color: type.eye,
    transparent: true,
    opacity: typeKey === 'viper' ? 0.68 : 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  eyeGlow.position.set(0, typeKey === 'viper' ? 0.8 * type.scale : 1.18 * type.scale, typeKey === 'viper' ? -0.92 * type.scale : -0.52 * type.scale);
  eyeGlow.scale.setScalar((typeKey === 'viper' ? 0.55 : 0.72) * type.scale);
  group.add(eyeGlow);

  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = false;
      obj.receiveShadow = true;
    }
  });

  group.position.set(x, 0, z);
  actorsGroup.add(group);

  return {
    typeKey,
    type,
    group,
    health: type.hp,
    maxHealth: type.hp,
    radius: type.radius,
    cooldown: 0.3,
    wobble: Math.random() * Math.PI * 2,
    spawnRise: 1,
    hitFlash: 0,
    animatedParts,
    facingY: 0,
  };
}

function getPickupColor(kind, meta = null) {
  if (kind === 'health') return 0x79ffd6;
  if (kind === 'ammo') return 0xffd18a;
  if (kind === 'grenade') return 0xff8a66;
  const colorMap = {
    shotgun: 0xffbf73,
    flamethrower: 0xff7f4f,
    nova: 0x79ffd6,
    lightning: 0x9dc8ff,
    carbine: 0x9d8cff,
  };
  return colorMap[meta] || 0x9d8cff;
}

function getWeaponAmmoReward(key) {
  return WEAPON_PICKUP_AMOUNTS[key] || 24;
}

function createPickup(kind, x, z, meta = null) {
  const group = new THREE.Group();
  const color = getPickupColor(kind, meta);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.08, 10, 24),
    new THREE.MeshBasicMaterial({ color })
  );
  ring.rotation.x = Math.PI * 0.5;
  group.add(ring);

  let icon;
  if (kind === 'health') {
    icon = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.15 });
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), mat);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.18), mat);
    a.castShadow = b.castShadow = true;
    icon.add(a, b);
  } else if (kind === 'ammo') {
    const brassMat = new THREE.MeshStandardMaterial({ color, emissive: 0xffb95a, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.55 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x473528, roughness: 0.78, metalness: 0.1 });
    icon = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.48, 10), brassMat);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.07, 10), capMat);
      shell.position.set((i - 1.5) * 0.14, Math.abs(i - 1.5) * 0.03, (i % 2 === 0 ? -1 : 1) * 0.04);
      shell.rotation.z = (i - 1.5) * 0.12;
      cap.position.copy(shell.position);
      cap.position.y -= 0.21;
      shell.castShadow = cap.castShadow = true;
      icon.add(shell, cap);
    }
  } else if (kind === 'grenade') {
    icon = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0x56606f, roughness: 0.62, metalness: 0.45 })
    );
    body.scale.set(1, 1.18, 1);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.16, 0.12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 })
    );
    cap.position.y = 0.22;
    const pin = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.02, 8, 18),
      new THREE.MeshStandardMaterial({ color: 0xcfd4df, roughness: 0.3, metalness: 0.8 })
    );
    pin.rotation.y = Math.PI * 0.5;
    pin.position.set(0.12, 0.23, 0);
    body.castShadow = cap.castShadow = true;
    pin.castShadow = true;
    icon.add(body, cap, pin);
  } else {
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x2b3240, roughness: 0.66, metalness: 0.2 });
    const glowMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.25, metalness: 0.4 });
    icon = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.3, 0.52), crateMat);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.18), glowMat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10), glowMat);
    core.rotation.z = Math.PI * 0.5;
    strip.position.y = 0.03;
    core.position.y = 0.18;
    crate.castShadow = strip.castShadow = core.castShadow = true;
    icon.add(crate, strip);
    if (meta === 'shotgun') {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.6), glowMat);
      barrel.position.set(0, 0.18, 0.05);
      barrel.castShadow = true;
      icon.add(core, barrel);
    } else if (meta === 'flamethrower') {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 10), glowMat);
      tank.position.set(-0.12, 0.14, 0);
      const nozzle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.42), glowMat);
      nozzle.position.set(0.14, 0.18, 0.08);
      tank.castShadow = nozzle.castShadow = true;
      icon.add(tank, nozzle);
    } else if (meta === 'nova') {
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), glowMat);
      const haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.03, 8, 20), glowMat);
      orb.position.y = 0.2;
      haloRing.position.y = 0.2;
      haloRing.rotation.x = Math.PI * 0.5;
      orb.castShadow = haloRing.castShadow = true;
      icon.add(orb, haloRing);
    } else if (meta === 'lightning') {
      const shardA = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.12), glowMat);
      const shardB = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.12), glowMat);
      shardA.position.set(-0.05, 0.22, -0.04);
      shardB.position.set(0.05, 0.08, 0.05);
      shardA.rotation.z = 0.45;
      shardB.rotation.z = -0.38;
      shardA.castShadow = shardB.castShadow = true;
      icon.add(shardA, shardB);
    }
  }

  icon.position.y = 0.56;
  group.add(icon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: particleTexture, color, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.y = 0.6;
  halo.scale.setScalar(kind === 'weapon' ? 1.6 : 1.2);
  group.add(halo);
  group.position.set(x, 0, z);
  actorsGroup.add(group);

  pickups.push({ kind, meta, color, group, icon, halo, ring, life: 24, bob: Math.random() * Math.PI * 2, phase: Math.random() * Math.PI * 2 });
}

function spawnParticleSprite(color, position, velocity, size, life, gravity = 0, opacity = 1) {
  const material = new THREE.SpriteMaterial({
    map: particleTexture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.setScalar(size);
  fxGroup.add(sprite);
  particles.push({ sprite, velocity: velocity.clone(), life, maxLife: life, gravity });
}

function spawnGlowOrb(position, color, size, life = 0.28, opacity = 0.9) {
  spawnParticleSprite(color, position, new THREE.Vector3(0, 0.08, 0), size, life, 0, opacity);
}

function spawnBurst(position, color, count, speed, size, life, spreadY = 0.9) {
  for (let i = 0; i < count; i += 1) {
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * spreadY, Math.random() * 2 - 1).normalize();
    const vel = dir.multiplyScalar(speed * (0.45 + Math.random() * 0.9));
    const p = position.clone().addScaledVector(dir, 0.25 + Math.random() * 0.25);
    spawnParticleSprite(color, p, vel, size * (0.7 + Math.random() * 0.7), life * (0.7 + Math.random() * 0.5), speed * 0.25, 0.95);
  }
}

function spawnSpellImpact(position, color, scale = 1, accent = 0xffffff) {
  const core = position.clone().add(new THREE.Vector3(0, 0.18, 0));
  spawnGlowOrb(core, accent, 1.35 * scale, 0.16, 0.96);
  spawnGlowOrb(core, color, 2.25 * scale, 0.28, 0.82);
  spawnShockwave(core.clone(), color, 1.3 * scale, 0.28, 15 * scale, 0.95);
  spawnShockwave(core.clone().add(new THREE.Vector3(0, 0.02, 0)), accent, 0.7 * scale, 0.2, 10 * scale, 0.46);
  spawnBurst(core, color, Math.ceil(10 * scale), 3.2 * scale, 0.24 * scale, 0.24, 0.75);
}

function createProjectileRibbonMaterial(color, alpha = 0.75) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shaderTime,
      uColor: { value: new THREE.Color(color) },
      uAlpha: { value: alpha },
      uSeed: { value: Math.random() * 20 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uSeed;
      varying vec2 vUv;
      void main() {
        float center = abs(vUv.y - 0.5);
        float core = smoothstep(0.5, 0.035, center);
        float aura = smoothstep(0.5, 0.22, center);
        float head = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.45, vUv.x);
        float streak = 0.58 + 0.42 * sin(vUv.x * 34.0 - uTime * 24.0 + uSeed);
        float rune = 0.5 + 0.5 * sin((vUv.x + center) * 72.0 + uTime * 10.0 + uSeed);
        float edge = (pow(core, 2.0) * 1.35 + aura * 0.34 + rune * core * 0.18) * head;
        vec3 hot = mix(vec3(1.0), uColor, 0.38);
        vec3 color = mix(uColor, hot, core) * (1.28 + streak * 0.72);
        gl_FragColor = vec4(color, edge * uAlpha);
      }
    `,
  });
}

function spawnTrace(start, end, color, thickness = 0.08, life = 0.1) {
  const delta = end.clone().sub(start);
  const distance = delta.length();
  const dir = distance > 0.0001 ? delta.clone().multiplyScalar(1 / distance) : new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  if (side.lengthSq() < 0.0001) side.set(1, 0, 0);
  side.normalize();

  const sprites = [];
  const sparks = [];
  const count = clamp(Math.ceil(distance / 1.6), 4, 11);
  const group = new THREE.Group();
  const auraBeam = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.01, distance), thickness * 15.5),
    createProjectileRibbonMaterial(color, 0.28)
  );
  auraBeam.position.copy(start).add(end).multiplyScalar(0.5);
  auraBeam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
  group.add(auraBeam);

  const beam = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.01, distance), thickness * 9.6),
    createProjectileRibbonMaterial(color, 0.78)
  );
  beam.position.copy(start).add(end).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.clone().normalize());
  group.add(beam);

  const coreBeam = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.01, distance), thickness * 3.2),
    createProjectileRibbonMaterial(0xffffff, 0.58)
  );
  coreBeam.position.copy(beam.position);
  coreBeam.quaternion.copy(beam.quaternion);
  group.add(coreBeam);

  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 1 : i / (count - 1);
    const pulse = i === count - 1 || i === Math.floor(count * 0.55);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: particleTexture,
      color: pulse ? 0xffffff : color,
      transparent: true,
      opacity: pulse ? 0.95 : 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    sprite.position.lerpVectors(start, end, t);
    const baseScale = thickness * (pulse ? 13 : 7.4) * (0.85 + Math.random() * 0.45);
    sprite.scale.setScalar(baseScale);
    group.add(sprite);
    sprites.push(sprite);
    sparks.push({
      t,
      baseScale,
      drift: (Math.random() * 2 - 1) * thickness * 3.4,
      rise: thickness * (0.3 + Math.random() * 1.3),
      advance: 0.015 + Math.random() * 0.1,
    });
  }

  const head = new THREE.Sprite(new THREE.SpriteMaterial({
    map: particleTexture,
    color,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  head.position.copy(end);
  head.scale.setScalar(thickness * 16.5);

  const ring = new THREE.Sprite(new THREE.SpriteMaterial({
    map: ringTexture,
    color,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  ring.position.copy(end);
  ring.position.y += 0.04;
  ring.scale.setScalar(thickness * 9.5);

  group.add(head, ring);
  fxGroup.add(group);
  traces.push({ group, beams: [auraBeam, beam, coreBeam], beam, sprites, sparks, head, ring, start: start.clone(), end: end.clone(), side, life, maxLife: life, thickness });
}

function spawnFlameTrail(start, end, color, density = 6) {
  const dir = end.clone().sub(start);
  const count = Math.max(3, density);
  for (let i = 0; i < count; i += 1) {
    const t = (i + Math.random() * 0.4) / count;
    const pos = start.clone().lerp(end, t);
    pos.x += (Math.random() * 2 - 1) * 0.18;
    pos.z += (Math.random() * 2 - 1) * 0.18;
    const velocity = new THREE.Vector3(
      dir.x * 0.3 + (Math.random() * 2 - 1) * 0.9,
      1.2 + Math.random() * 1.2,
      dir.z * 0.3 + (Math.random() * 2 - 1) * 0.9
    );
    spawnParticleSprite(color, pos, velocity, 0.28 + Math.random() * 0.3, 0.2 + Math.random() * 0.16, 1.25, 0.9);
    if (i % 3 === 0) spawnParticleSprite(0xfff0c2, pos.clone().add(new THREE.Vector3(0, 0.08, 0)), velocity.clone().multiplyScalar(0.45), 0.14 + Math.random() * 0.12, 0.14, 0.6, 0.82);
  }
}

function spawnPickupCollectEffect(pickup) {
  const origin = pickup.group.position.clone().add(new THREE.Vector3(0, 0.45, 0));
  spawnBurst(origin, pickup.color, 11, 2.6, pickup.kind === 'weapon' ? 0.34 : 0.26, 0.32, 1.1);
  spawnShockwave(origin.clone(), pickup.color, pickup.kind === 'weapon' ? 1.4 : 0.95);
  for (let i = 0; i < 6; i += 1) {
    const target = player.group.position.clone().add(new THREE.Vector3((Math.random() * 2 - 1) * 0.25, 1.1 + Math.random() * 0.8, (Math.random() * 2 - 1) * 0.25));
    spawnTrace(origin, target, pickup.color, 0.06 + Math.random() * 0.04, 0.12 + Math.random() * 0.04);
  }
}

function spawnShockwave(position, color = 0xffd18a, radius = 1.2, life = 0.34, grow = 20, opacity = 0.9) {
  const mat = new THREE.SpriteMaterial({
    map: ringTexture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(position);
  sprite.position.y = 0.15;
  sprite.scale.set(radius, radius, 1);
  fxGroup.add(sprite);
  shockwaves.push({ sprite, life, maxLife: life, grow, baseOpacity: opacity });
}

function spawnExpandingRing(position, color, startRadius, endRadius, life, delay = 0, opacity = 0.9) {
  const mat = new THREE.MeshBasicMaterial({
    map: ringTexture,
    color,
    transparent: true,
    opacity: delay > 0 ? 0 : opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  sprite.position.copy(position);
  sprite.position.y = 0.24;
  sprite.rotation.x = -Math.PI * 0.5;
  sprite.scale.set(startRadius, startRadius, 1);
  sprite.renderOrder = 18;
  fxGroup.add(sprite);
  shockwaves.push({ sprite, life, maxLife: life, delay, startRadius, endRadius, baseOpacity: opacity, disposeGeometry: true });
}

function addBlastLight(position, color, intensity, distance, life) {
  const light = new THREE.PointLight(color, intensity, distance, 2);
  light.position.copy(position);
  light.position.y += 1.2;
  scene.add(light);
  blastLights.push({ light, intensity, life, maxLife: life });
}

function addMuzzleLight(position, color, intensity, distance, life) {
  const light = new THREE.PointLight(color, intensity, distance, 2);
  light.position.copy(position);
  scene.add(light);
  muzzleLights.push({ light, intensity, life, maxLife: life });
}

function spawnFloatingText(text, position, color = '#ffffff') {
  const div = document.createElement('div');
  div.textContent = text;
  div.style.position = 'absolute';
  div.style.left = '0px';
  div.style.top = '0px';
  div.style.transform = 'translate(-50%, -50%)';
  div.style.fontWeight = '800';
  div.style.fontSize = '14px';
  div.style.pointerEvents = 'none';
  div.style.textShadow = '0 4px 14px rgba(0,0,0,0.65)';
  div.style.color = color;
  div.style.letterSpacing = '0.03em';
  document.getElementById('hud').appendChild(div);
  floatingTexts.push({ div, pos: position.clone(), life: 0.7, maxLife: 0.7 });
}

function updateFloatingTexts(dt) {
  for (let i = floatingTexts.length - 1; i >= 0; i -= 1) {
    const ft = floatingTexts[i];
    ft.life -= dt;
    ft.pos.y += dt * 1.8;
    if (ft.life <= 0) {
      ft.div.remove();
      floatingTexts.splice(i, 1);
      continue;
    }
    tmpVec3.copy(ft.pos);
    tmpVec3.project(camera);
    const x = (tmpVec3.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tmpVec3.y * 0.5 + 0.5) * window.innerHeight;
    ft.div.style.left = `${x}px`;
    ft.div.style.top = `${y}px`;
    ft.div.style.opacity = String(ft.life / ft.maxLife);
  }
}

function getAimWorld() {
  mouse.ndc.x = (mouse.x / window.innerWidth) * 2 - 1;
  mouse.ndc.y = -(mouse.y / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse.ndc, camera);
  const point = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, point)) {
    lastAimWorld = point;
  }
  return lastAimWorld;
}

function circleIntersectsRect(x, z, radius, minX, minZ, maxX, maxZ) {
  const cx = clamp(x, minX, maxX);
  const cz = clamp(z, minZ, maxZ);
  const dx = x - cx;
  const dz = z - cz;
  return dx * dx + dz * dz < radius * radius;
}

function collidesWithDungeon(x, z, radius) {
  const min = worldToTile(x - radius, z - radius);
  const max = worldToTile(x + radius, z + radius);
  for (let ty = min.ty - 1; ty <= max.ty + 1; ty += 1) {
    for (let tx = min.tx - 1; tx <= max.tx + 1; tx += 1) {
      if (!isInsideMap(tx, ty)) return true;
      if (dungeon.grid[ty][tx] === 0) continue;
      const minX = (tx - MAP_W * 0.5) * CELL;
      const maxX = minX + CELL;
      const minZ = (ty - MAP_H * 0.5) * CELL;
      const maxZ = minZ + CELL;
      if (circleIntersectsRect(x, z, radius, minX, minZ, maxX, maxZ)) return true;
    }
  }
  return false;
}

function moveCircle(entity, dx, dz, radius) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.45));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let i = 0; i < steps; i += 1) {
    const ox = entity.group.position.x;
    entity.group.position.x += sx;
    if (collidesWithDungeon(entity.group.position.x, entity.group.position.z, radius)) entity.group.position.x = ox;
    const oz = entity.group.position.z;
    entity.group.position.z += sz;
    if (collidesWithDungeon(entity.group.position.x, entity.group.position.z, radius)) entity.group.position.z = oz;
  }
}

function stepRayToWall(origin, dir, maxDist) {
  const EPS = 1e-6;
  let x = origin.x;
  let z = origin.z;
  const start = worldToTile(x, z);
  let tx = start.tx;
  let ty = start.ty;
  if (!isInsideMap(tx, ty)) return 0;

  const dx = Math.abs(dir.x) < EPS ? EPS : dir.x;
  const dz = Math.abs(dir.z) < EPS ? EPS : dir.z;

  const stepX = dx > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const tileBoundaryX = (stepX > 0 ? (tx + 1) : tx) * CELL - HALF_WORLD_X;
  const tileBoundaryZ = (stepZ > 0 ? (ty + 1) : ty) * CELL - HALF_WORLD_Z;
  let tMaxX = (tileBoundaryX - x) / dx;
  let tMaxZ = (tileBoundaryZ - z) / dz;
  const tDeltaX = CELL / Math.abs(dx);
  const tDeltaZ = CELL / Math.abs(dz);

  let dist = 0;
  while (dist < maxDist) {
    if (tMaxX < tMaxZ) {
      tx += stepX;
      dist = tMaxX;
      tMaxX += tDeltaX;
    } else {
      ty += stepZ;
      dist = tMaxZ;
      tMaxZ += tDeltaZ;
    }
    if (!isInsideMap(tx, ty)) return Math.min(maxDist, dist);
    if (dungeon.grid[ty][tx] !== 0) return Math.min(maxDist, dist);
  }
  return maxDist;
}

function hasLineOfSight(origin, target, padding = 0.18) {
  const delta = target.clone().sub(origin);
  delta.y = 0;
  const dist = delta.length();
  if (dist <= 0.001) return true;
  const dir = delta.multiplyScalar(1 / dist);
  return stepRayToWall(origin, dir, dist + padding) + padding >= dist;
}

function pickSpawnTile(minDist = 20, maxDist = 42) {
  const px = player.group.position.x;
  const pz = player.group.position.z;
  for (let i = 0; i < 120; i += 1) {
    const tile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
    const pos = tileToWorld(tile.x, tile.y);
    const dist = Math.hypot(pos.x - px, pos.z - pz);
    if (dist < minDist || dist > maxDist) continue;
    let crowded = false;
    for (const enemy of enemies) {
      if (enemy.group.position.distanceToSquared(new THREE.Vector3(pos.x, 0, pos.z)) < 9) { crowded = true; break; }
    }
    if (crowded) continue;
    return pos;
  }
  const tile = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
  return tileToWorld(tile.x, tile.y);
}

function spawnEnemyPack(count, forceType = null) {
  for (let i = 0; i < count; i += 1) {
    const pos = pickSpawnTile(22, 38);
    const difficulty = 1 + game.elapsed * 0.025;
    let type = forceType;
    if (!type) {
      const roll = Math.random();
      const bruteThreshold = Math.max(0.62, 0.9 - game.elapsed * 0.00022);
      const zigzagThreshold = Math.max(0.44, 0.72 - game.elapsed * 0.00016);
      const viperThreshold = Math.max(0.28, 0.5 - game.elapsed * 0.00012);
      if (difficulty > 1.8 && roll > bruteThreshold) type = 'brute';
      else if (difficulty > 1.35 && roll > zigzagThreshold) type = 'zigzag';
      else if (difficulty > 1.12 && roll > viperThreshold) type = 'viper';
      else if (difficulty > 1.2 && roll > 0.24) type = 'stalker';
      else type = Math.random() < 0.5 ? 'skitter' : 'viper';
    }
    const enemy = createEnemy(type, pos.x, pos.z);
    enemy.group.position.y = -1.2;
    enemies.push(enemy);
    spawnBurst(new THREE.Vector3(pos.x, 0.08, pos.z), 0xff667f, 3, 1.6, 0.32, 0.25, 0.45);
  }
}

function applyBonusLoadout() {
  for (const key of WEAPON_ORDER) {
    playerState.unlocked[key] = true;
    playerState.ammo[key] = Infinity;
  }
  playerState.grenades = 8;
  updateHud();
}

function resetGame() {
  game.over = false;
  game.elapsed = 0;
  game.score = 0;
  game.kills = 0;
  game.spawnAccumulator = 0;
  game.swarmTimer = 18 + Math.random() * 7;
  game.screenShake = 0;
  game.boomFlash = 0;
  game.spawnFlash = 0;
  playerState.health = MAX_HEALTH;
  playerState.grenades = 3;
  playerState.currentWeapon = 'carbine';
  playerState.fireCooldown = 0;
  playerState.throwCooldown = 0;
  playerState.hurtCooldown = 0;
  playerState.hurtFlash = 0;
  playerState.unlocked.shotgun = false;
  playerState.unlocked.flamethrower = false;
  playerState.unlocked.nova = false;
  playerState.unlocked.lightning = false;
  playerState.ammo.carbine = Infinity;
  playerState.ammo.shotgun = 0;
  playerState.ammo.flamethrower = 0;
  playerState.ammo.nova = 0;
  playerState.ammo.lightning = 0;
  if (game.bonusLoadout) applyBonusLoadout();

  for (const enemy of enemies) actorsGroup.remove(enemy.group);
  enemies.length = 0;
  for (const pickup of pickups) actorsGroup.remove(pickup.group);
  pickups.length = 0;
  for (const grenade of grenades) actorsGroup.remove(grenade.mesh);
  grenades.length = 0;
  for (const particle of particles) { fxGroup.remove(particle.sprite); particle.sprite.material.dispose(); }
  particles.length = 0;
  for (const trace of traces) {
    fxGroup.remove(trace.group);
    for (const beam of trace.beams || [trace.beam]) {
      beam.geometry.dispose();
      beam.material.dispose();
    }
    for (const sprite of trace.sprites) sprite.material.dispose();
    trace.head.material.dispose();
    trace.ring.material.dispose();
  }
  traces.length = 0;
  for (const wave of shockwaves) {
    fxGroup.remove(wave.sprite);
    if (wave.disposeGeometry) wave.sprite.geometry.dispose();
    wave.sprite.material.dispose();
  }
  shockwaves.length = 0;
  for (const ft of floatingTexts) ft.div.remove();
  floatingTexts.length = 0;
  for (const entry of muzzleLights) scene.remove(entry.light);
  muzzleLights.length = 0;
  for (const entry of blastLights) scene.remove(entry.light);
  blastLights.length = 0;

  const start = tileToWorld(dungeon.rooms[0].cx, dungeon.rooms[0].cy);
  player.group.position.set(start.x, 0, start.z);
  player.velocity.set(0, 0);
  player.aimDir.set(1, 0);
  resetExploration();

  spawnEnemyPack(4);
  createPickup('health', start.x + 4, start.z + 3);
  createPickup('ammo', start.x - 4, start.z + 2);
  createPickup('grenade', start.x + 1.5, start.z - 4);

  updateHud();
  restartPromptEl.style.display = 'none';
  showMessage('Enter the blackout');
}

function switchWeapon(key) {
  if (!playerState.unlocked[key]) return;
  if (WEAPONS[key].ammoLabel !== '∞' && playerState.ammo[key] <= 0) return;
  playerState.currentWeapon = key;
  showMessage(`${WEAPONS[key].name}`);
  updateHud();
}

function cycleWeapon(direction = 1) {
  const startIndex = WEAPON_ORDER.indexOf(playerState.currentWeapon);
  if (startIndex < 0) return;
  let found = false;
  for (let step = 1; step <= WEAPON_ORDER.length; step += 1) {
    const index = (startIndex + direction * step + WEAPON_ORDER.length) % WEAPON_ORDER.length;
    const key = WEAPON_ORDER[index];
    if (!playerState.unlocked[key]) continue;
    if (WEAPONS[key].ammoLabel !== '∞' && playerState.ammo[key] <= 0) continue;
    switchWeapon(key);
    found = true;
    break;
  }
  if (!found) showMessage('No alternate weapon ready');
}

function grantWeapon(key, ammoAmount) {
  playerState.unlocked[key] = true;
  if (WEAPONS[key].ammoLabel !== '∞') playerState.ammo[key] += ammoAmount;
  playerState.currentWeapon = key;
  showMessage(`${WEAPONS[key].name} acquired`);
  spawnFloatingText(`+${WEAPONS[key].name}`, player.group.position.clone().add(new THREE.Vector3(0, 2.6, 0)), '#ffd18a');
  updateHud();
}

function updateHud() {
  hud.health.textContent = String(Math.max(0, Math.ceil(playerState.health)));
  const weapon = WEAPONS[playerState.currentWeapon];
  hud.weapon.textContent = weapon.name;
  const ammo = playerState.ammo[playerState.currentWeapon];
  hud.ammo.textContent = weapon.ammoLabel === '∞' || ammo === Infinity ? '∞' : String(ammo);
  hud.grenades.textContent = String(playerState.grenades);
  hud.time.textContent = formatTime(game.elapsed);
  hud.kills.textContent = String(game.kills);
  hud.score.textContent = String(Math.floor(game.score));
  hud.best.textContent = String(game.best);
  hud.health.className = playerState.health < 28 ? 'danger' : (playerState.health < 55 ? 'accent' : 'good');
  setActiveWeaponPreview(playerState.currentWeapon);
}

function damagePlayer(amount, sourcePos = null) {
  if (game.over) return;
  if (playerState.hurtCooldown > 0) return;
  playerState.health = Math.max(0, playerState.health - amount);
  playerState.hurtCooldown = 0.34;
  playerState.hurtFlash = 0.6;
  damageFlashEl.style.opacity = '1';
  game.screenShake = Math.max(game.screenShake, 0.32);
  audio.hurt();
  if (sourcePos) {
    spawnBurst(player.group.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 0xff5b74, 7, 2.8, 0.38, 0.22, 0.25);
  }
  updateHud();
  if (playerState.health <= 0) {
    endGame();
  }
}

function endGame() {
  game.over = true;
  game.best = Math.max(game.best, Math.floor(game.score));
  localStorage.setItem('dungeon-blackout-best', String(game.best));
  hud.best.textContent = String(game.best);
  startScreenEl.style.display = 'grid';
  restartPromptEl.style.display = 'block';
  showMessage('Run ended');
}

function traceEnemyHit(origin, dir, maxDist) {
  const wallDist = stepRayToWall(origin, dir, maxDist);
  let hitEnemy = null;
  let enemyDist = wallDist;
  let hitPoint = origin.clone().addScaledVector(dir, wallDist);

  for (const enemy of enemies) {
    const center = enemy.group.position.clone();
    center.y = 1;
    const to = center.clone().sub(origin);
    const proj = to.dot(dir);
    if (proj <= 0 || proj >= enemyDist) continue;
    const closest = origin.clone().addScaledVector(dir, proj);
    closest.y = 1;
    const distSq = closest.distanceToSquared(center);
    const hitRadius = enemy.radius + 0.14;
    if (distSq <= hitRadius * hitRadius) {
      hitEnemy = enemy;
      enemyDist = proj;
      hitPoint = closest;
    }
  }

  return { hitEnemy, enemyDist, hitPoint };
}

function fireFlamethrower(weapon, muzzle, baseDir) {
  for (let i = 0; i < weapon.pellets; i += 1) {
    const spread = (Math.random() * 2 - 1) * weapon.spread;
    const dir2 = rotate2(baseDir.x, baseDir.y, spread);
    const dir = new THREE.Vector3(dir2.x, 0, dir2.z).normalize();
    const reach = weapon.range * (0.58 + Math.random() * 0.42);
    const { hitEnemy, enemyDist, hitPoint } = traceEnemyHit(muzzle, dir, reach);
    const trailEnd = muzzle.clone().lerp(hitPoint, 0.92);
    spawnFlameTrail(muzzle, trailEnd, weapon.tracerColor, 10);
    spawnGlowOrb(trailEnd.clone().add(new THREE.Vector3(0, 0.18, 0)), weapon.hitColor, 0.75, 0.16, 0.62);
    spawnBurst(trailEnd, weapon.hitColor, 5, 2.0, 0.24, 0.16, 1.0);

    if (hitEnemy) {
      const scale = 1 - clamp(enemyDist / weapon.range, 0, 0.78);
      damageEnemy(hitEnemy, weapon.damage * scale, hitPoint, weapon);
    }
  }
}

function fireNovaWeapon(weapon, muzzle) {
  const origin = player.group.position.clone().add(new THREE.Vector3(0, 0.25, 0));
  const lifted = origin.clone().add(new THREE.Vector3(0, 0.28, 0));
  spawnGlowOrb(lifted.clone().add(new THREE.Vector3(0, 0.1, 0)), 0xffffff, 2.35, 0.28, 0.95);
  spawnGlowOrb(lifted, weapon.tracerColor, 5.1, 0.62, 0.74);
  spawnExpandingRing(origin.clone(), 0xffffff, 0.35, weapon.range * 0.38, 0.36, 0, 0.72);
  spawnExpandingRing(origin.clone().add(new THREE.Vector3(0, 0.02, 0)), 0xc7fff7, 0.8, weapon.range * 0.62, 0.6, 0.04, 0.95);
  spawnExpandingRing(origin.clone().add(new THREE.Vector3(0, 0.04, 0)), 0x9dfff0, 1.2, weapon.range * 0.86, 0.76, 0.1, 0.82);
  spawnExpandingRing(origin.clone().add(new THREE.Vector3(0, 0.06, 0)), weapon.tracerColor, 1.6, weapon.range * 1.08, 0.94, 0.17, 0.66);
  spawnBurst(lifted, weapon.tracerColor, 24, 4.8, 0.38, 0.48, 0.22);
  addBlastLight(origin.clone(), weapon.tracerColor, 16, weapon.range * 1.4, 0.42);

  for (let i = 0; i < 32; i += 1) {
    const angle = (i / 32) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const ring = 0.46 + (i % 4) * 0.17 + Math.random() * 0.08;
    const reach = weapon.range * ring;
    const wallLimitedReach = stepRayToWall(origin, dir, reach);
    const pos = origin.clone().addScaledVector(dir, wallLimitedReach);
    const tangent = new THREE.Vector3(-dir.z, 0, dir.x);
    const vel = dir.clone().multiplyScalar(2.5 + Math.random() * 2.6).addScaledVector(tangent, (Math.random() * 2 - 1) * 0.8);
    spawnParticleSprite(i % 5 === 0 ? 0xffffff : weapon.tracerColor, pos, vel, 0.16 + Math.random() * 0.18, 0.22 + Math.random() * 0.14, 0.15, 0.9);
  }

  for (const enemy of enemies.slice()) {
    const point = enemy.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    const dist = point.distanceTo(origin);
    if (dist > weapon.range) continue;
    if (!hasLineOfSight(origin, point, 0.28)) continue;
    const proximity = 1 - dist / weapon.range;
    const damageScale = 0.22 + Math.pow(proximity, 1.85) * 1.28;
    spawnSpellImpact(point, weapon.tracerColor, 0.45 + proximity * 1.05, 0xffffff);
    damageEnemy(enemy, weapon.damage * damageScale, point, weapon);
  }
}

function fireLightningWeapon(weapon, muzzle, baseDir) {
  const aimDir = new THREE.Vector3(baseDir.x, 0, baseDir.y).normalize();
  let primary = null;
  let primaryScore = Infinity;

  for (const enemy of enemies) {
    const center = enemy.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    const to = center.clone().sub(muzzle);
    const dist = to.length();
    if (dist > weapon.range) continue;
    const dir = to.clone().normalize();
    const alignment = aimDir.dot(dir);
    if (alignment < 0.72) continue;
    const score = dist - alignment * 4;
    if (score < primaryScore) {
      primaryScore = score;
      primary = enemy;
    }
  }

  if (!primary) {
    const missPoint = muzzle.clone().add(aimDir.multiplyScalar(stepRayToWall(muzzle, aimDir, weapon.range)));
    spawnTrace(muzzle, missPoint, weapon.tracerColor, 0.13, 0.16);
    spawnSpellImpact(missPoint, weapon.hitColor, 0.58, weapon.tracerColor);
    return;
  }

  let anchor = muzzle.clone();
  let damageScale = 1;
  const chained = new Set();
  let current = primary;

  for (let jumps = 0; jumps < 3 && current; jumps += 1) {
    const point = current.group.position.clone().add(new THREE.Vector3(0, 1, 0));
    spawnTrace(anchor, point, weapon.tracerColor, 0.13 + jumps * 0.025, 0.17);
    spawnSpellImpact(point, weapon.hitColor, 0.72 + jumps * 0.16, weapon.tracerColor);
    damageEnemy(current, weapon.damage * damageScale, point, weapon);
    chained.add(current);
    anchor = point;
    damageScale *= 0.62;

    let next = null;
    let nextDist = Infinity;
    for (const enemy of enemies) {
      if (chained.has(enemy)) continue;
      const dist = enemy.group.position.distanceTo(current.group.position);
      if (dist > 6.2 || dist >= nextDist) continue;
      next = enemy;
      nextDist = dist;
    }
    current = next;
  }
}

function fireCurrentWeapon() {
  if (game.over) return;
  const key = playerState.currentWeapon;
  const weapon = WEAPONS[key];
  if (playerState.fireCooldown > 0) return;
  if (weapon.ammoLabel !== '∞' && playerState.ammo[key] <= 0) {
    playerState.currentWeapon = 'carbine';
    showMessage('Carbine online');
    updateHud();
    return;
  }

  const muzzle = player.group.position.clone().add(new THREE.Vector3(player.aimDir.x * 0.75, 1.65, player.aimDir.y * 0.75));
  const baseDir = new THREE.Vector2(player.aimDir.x, player.aimDir.y).normalize();

  if (key === 'flamethrower') {
    fireFlamethrower(weapon, muzzle, baseDir);
  } else if (key === 'nova') {
    fireNovaWeapon(weapon, muzzle);
  } else if (key === 'lightning') {
    fireLightningWeapon(weapon, muzzle, baseDir);
  } else {
    const traceThickness = key === 'shotgun' ? 0.18 : 0.145;
    const traceLife = key === 'shotgun' ? 0.16 : 0.13;

    for (let i = 0; i < weapon.pellets; i += 1) {
      const spread = (Math.random() * 2 - 1) * weapon.spread;
      const dir2 = rotate2(baseDir.x, baseDir.y, spread);
      const dir = new THREE.Vector3(dir2.x, 0, dir2.z).normalize();
      const { hitEnemy, enemyDist, hitPoint } = traceEnemyHit(muzzle, dir, weapon.range);

      spawnTrace(muzzle, hitPoint, weapon.tracerColor, traceThickness * (0.9 + Math.random() * 0.24), traceLife + Math.random() * 0.04);

      if (hitEnemy) {
        const dmg = weapon.damage * (key === 'shotgun' ? 1 - clamp(enemyDist / weapon.range, 0, 0.5) : 1);
        damageEnemy(hitEnemy, dmg, hitPoint, weapon);
      } else {
        spawnSpellImpact(hitPoint.clone().add(new THREE.Vector3(0, 0.15, 0)), weapon.hitColor, key === 'shotgun' ? 0.72 : 0.48, weapon.tracerColor);
      }
    }
  }

  if (weapon.ammoLabel !== '∞') {
    playerState.ammo[key] -= 1;
    if (playerState.ammo[key] <= 0) {
      playerState.ammo[key] = 0;
      if (playerState.currentWeapon === key) {
        playerState.currentWeapon = 'carbine';
        showMessage(`${WEAPONS[key].name} drained — carbine ready`);
      }
    }
  }

  playerState.fireCooldown = 1 / weapon.fireRate;
  game.screenShake = Math.max(game.screenShake, weapon.shake);
  addMuzzleLight(muzzle, weapon.tracerColor, key === 'shotgun' ? 7.5 : key === 'nova' ? 12 : key === 'lightning' ? 7 : key === 'flamethrower' ? 5.5 : 4.8, key === 'shotgun' ? 11 : key === 'nova' ? 18 : 9, 0.08);
  spawnGlowOrb(muzzle, weapon.tracerColor, key === 'nova' ? 1.55 : key === 'shotgun' ? 1.25 : 0.95, 0.12, 0.86);
  spawnBurst(muzzle, weapon.tracerColor, key === 'flamethrower' ? 10 : key === 'nova' ? 18 : key === 'shotgun' ? 14 : 7, key === 'nova' ? 4.6 : 3.1, key === 'shotgun' ? 0.44 : 0.32, 0.2, 0.38);
  audio.shot(weapon.sound);
  updateHud();
}

function damageEnemy(enemy, amount, point, weapon) {
  enemy.health -= amount;
  enemy.hitFlash = 0.12;
  const impactScale = clamp(0.38 + amount * 0.018, 0.48, 1.25);
  spawnSpellImpact(point.clone(), weapon.hitColor, impactScale, weapon.tracerColor || 0xffffff);
  spawnBurst(point.clone(), weapon.hitColor, 8, 3.2, 0.32, 0.25, 0.55);
  spawnBurst(point.clone(), 0xff5b74, 4, 2.2, 0.29, 0.22, 0.35);
  audio.hit();
  if (enemy.health <= 0) {
    killEnemy(enemy, point);
  }
}

function killEnemy(enemy, point) {
  const idx = enemies.indexOf(enemy);
  if (idx >= 0) enemies.splice(idx, 1);
  actorsGroup.remove(enemy.group);
  game.kills += 1;
  game.score += enemy.type.score + game.elapsed * 0.35;
  spawnGlowOrb(point.clone().add(new THREE.Vector3(0, 0.48, 0)), enemy.type.eye, 2.4 * enemy.type.scale, 0.26, 0.86);
  spawnShockwave(point.clone().add(new THREE.Vector3(0, 0.18, 0)), enemy.type.eye, 1.65 * enemy.type.scale, 0.34, 18, 0.9);
  spawnShockwave(point.clone().add(new THREE.Vector3(0, 0.2, 0)), 0xffd18a, 0.9 * enemy.type.scale, 0.22, 12, 0.55);
  spawnBurst(point.clone(), 0xff697d, 20, 5.4, 0.48, 0.42, 0.9);
  spawnBurst(point.clone(), 0xffd18a, 10, 3.0, 0.4, 0.3, 0.45);
  addBlastLight(point.clone(), enemy.type.eye, 8 * enemy.type.scale, 10 * enemy.type.scale, 0.18);
  spawnFloatingText(`+${enemy.type.score}`, point.clone().add(new THREE.Vector3(0, 1.8, 0)), '#ffd18a');
  if (Math.random() < 0.11) {
    const lootRoll = Math.random();
    if (lootRoll < 0.38) createPickup('ammo', enemy.group.position.x, enemy.group.position.z);
    else if (lootRoll < 0.62) createPickup('health', enemy.group.position.x, enemy.group.position.z);
    else if (lootRoll < 0.82) createPickup('grenade', enemy.group.position.x, enemy.group.position.z);
    else {
      const pool = ['shotgun', 'flamethrower', 'nova', 'lightning'];
      createPickup('weapon', enemy.group.position.x, enemy.group.position.z, pool[Math.floor(Math.random() * pool.length)]);
    }
  }
  updateHud();
}

function throwGrenade() {
  if (game.over || playerState.throwCooldown > 0 || playerState.grenades <= 0) return;
  const aim = getAimWorld();
  tmpVec2.set(aim.x - player.group.position.x, aim.z - player.group.position.z);
  if (tmpVec2.lengthSq() < 0.001) return;
  tmpVec2.normalize();
  const vel = new THREE.Vector2(tmpVec2.x, tmpVec2.y).multiplyScalar(11.5);
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0x677182, roughness: 0.6, metalness: 0.55 })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.copy(player.group.position).add(new THREE.Vector3(tmpVec2.x * 0.9, 1.0, tmpVec2.y * 0.9));
  actorsGroup.add(mesh);
  grenades.push({ mesh, velocity: vel, vertical: 4.6, yVelocity: 3.8, timer: 1.15, bounced: 0 });
  playerState.grenades -= 1;
  playerState.throwCooldown = 0.35;
  showMessage('Grenade out');
  updateHud();
}

function explode(position, radius, damage, big = true, color = 0xffb566) {
  const lifted = position.clone().add(new THREE.Vector3(0, 0.38, 0));
  spawnGlowOrb(lifted, 0xffffff, big ? 3.8 : 2.1, big ? 0.18 : 0.14, 0.95);
  spawnGlowOrb(lifted, color, big ? 6.8 : 3.8, big ? 0.46 : 0.3, 0.86);
  spawnShockwave(position.clone().add(new THREE.Vector3(0, 0.22, 0)), color, radius * 0.92, big ? 0.48 : 0.34, big ? 30 : 18, 1);
  spawnShockwave(position.clone().add(new THREE.Vector3(0, 0.24, 0)), 0xffffff, radius * 0.45, big ? 0.24 : 0.18, big ? 18 : 12, 0.5);
  spawnBurst(position.clone().add(new THREE.Vector3(0, 0.5, 0)), color, big ? 42 : 22, big ? 8.8 : 5.8, big ? 0.7 : 0.5, big ? 0.62 : 0.4, 1.25);
  spawnBurst(position.clone(), 0xfff0c2, big ? 18 : 8, big ? 4.8 : 2.8, 0.62, 0.3, 0.5);
  addBlastLight(position.clone(), color, big ? 22 : 9, big ? 24 : 14, big ? 0.42 : 0.24);
  if (big) {
    game.screenShake = Math.max(game.screenShake, 0.86);
    game.boomFlash = 0.42;
    boomFlashEl.style.opacity = '1';
  }
  audio.explosion(big);

  for (const enemy of enemies.slice()) {
    const dist = enemy.group.position.distanceTo(position);
    if (dist > radius) continue;
    const scale = 1 - dist / radius;
    damageEnemy(enemy, damage * scale, enemy.group.position.clone().add(new THREE.Vector3(0, 1, 0)), { hitColor: color, hitSpark: 8 });
  }
  const playerDist = player.group.position.distanceTo(position);
  if (playerDist < radius * 0.86) {
    const scale = 1 - playerDist / (radius * 0.86);
    damagePlayer(Math.max(6, damage * 0.35 * scale), position);
  }
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const grenade = grenades[i];
    grenade.timer -= dt;
    grenade.velocity.multiplyScalar(1 - dt * 0.7);
    grenade.yVelocity -= dt * 12;
    grenade.vertical = Math.max(0, grenade.vertical + grenade.yVelocity * dt);

    const nextX = grenade.mesh.position.x + grenade.velocity.x * dt;
    const nextZ = grenade.mesh.position.z + grenade.velocity.y * dt;
    const bouncedX = collidesWithDungeon(nextX, grenade.mesh.position.z, 0.24);
    const bouncedZ = collidesWithDungeon(grenade.mesh.position.x, nextZ, 0.24);

    if (bouncedX) {
      grenade.velocity.x *= -0.56;
      grenade.bounced += 1;
    } else {
      grenade.mesh.position.x = nextX;
    }
    if (bouncedZ) {
      grenade.velocity.y *= -0.56;
      grenade.bounced += 1;
    } else {
      grenade.mesh.position.z = nextZ;
    }

    grenade.mesh.position.y = 0.3 + grenade.vertical * 0.16;
    grenade.mesh.rotation.x += dt * 7;
    grenade.mesh.rotation.z += dt * 6.2;

    if (grenade.timer <= 0) {
      const pos = grenade.mesh.position.clone();
      actorsGroup.remove(grenade.mesh);
      grenades.splice(i, 1);
      explode(new THREE.Vector3(pos.x, 0.15, pos.z), 5.4, 62, true, 0xffb566);
    }
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i -= 1) {
    const pickup = pickups[i];
    pickup.life -= dt;
    pickup.bob += dt * 2.8;
    pickup.phase += dt * (pickup.kind === 'weapon' ? 2.2 : 3.2);
    pickup.group.position.y = Math.sin(pickup.bob) * 0.16 + (pickup.kind === 'grenade' ? Math.abs(Math.sin(pickup.phase * 1.8)) * 0.08 : 0);
    pickup.group.rotation.y += dt * (pickup.kind === 'weapon' ? 1.65 : 1.05);
    pickup.icon.rotation.y -= dt * (pickup.kind === 'ammo' ? 2.4 : 1.8);
    pickup.halo.scale.setScalar((pickup.kind === 'weapon' ? 1.6 : 1.2) + Math.sin(pickup.phase * 2.1) * 0.16);
    pickup.halo.material.opacity = 0.35 + Math.sin(pickup.phase * 2.1) * 0.12;
    pickup.ring.scale.setScalar(1 + Math.sin(pickup.phase * (pickup.kind === 'health' ? 4 : 2.7)) * 0.08);
    if (pickup.kind === 'health') {
      pickup.icon.scale.setScalar(1 + Math.sin(pickup.phase * 4.2) * 0.12);
    } else if (pickup.kind === 'ammo') {
      pickup.icon.rotation.z = Math.sin(pickup.phase * 1.8) * 0.18;
    } else if (pickup.kind === 'grenade') {
      pickup.icon.rotation.x = Math.sin(pickup.phase * 2.4) * 0.22;
      pickup.icon.rotation.z = Math.cos(pickup.phase * 2.1) * 0.12;
    } else {
      pickup.icon.rotation.x = Math.sin(pickup.phase * 1.4) * 0.16;
      pickup.icon.scale.setScalar(1 + Math.sin(pickup.phase * 2.8) * 0.08);
    }

    if (pickup.life <= 0) {
      actorsGroup.remove(pickup.group);
      pickups.splice(i, 1);
      continue;
    }

    const dist = pickup.group.position.distanceTo(player.group.position);
    if (dist > 1.25) continue;

    if (pickup.kind === 'health') {
      playerState.health = Math.min(MAX_HEALTH, playerState.health + 25);
      showMessage('Life up');
      spawnFloatingText('+25 HP', player.group.position.clone().add(new THREE.Vector3(0, 2.4, 0)), '#79ffd6');
    } else if (pickup.kind === 'ammo') {
      playerState.ammo.shotgun += 14;
      playerState.ammo.flamethrower += 55;
      playerState.ammo.nova += 4;
      playerState.ammo.lightning += 32;
      showMessage('Ammo stockpiled');
      spawnFloatingText('+Ammo', player.group.position.clone().add(new THREE.Vector3(0, 2.4, 0)), '#ffd18a');
    } else if (pickup.kind === 'grenade') {
      playerState.grenades = Math.min(8, playerState.grenades + 2);
      showMessage('Grenades replenished');
      spawnFloatingText('+2 Grenades', player.group.position.clone().add(new THREE.Vector3(0, 2.4, 0)), '#ff8a66');
    } else {
      grantWeapon(pickup.meta, getWeaponAmmoReward(pickup.meta));
    }

    spawnPickupCollectEffect(pickup);
    audio.pickup();
    actorsGroup.remove(pickup.group);
    pickups.splice(i, 1);
    updateHud();
  }
}

function animateEnemyParts(enemy) {
  const scale = enemy.type.scale;
  if (enemy.animatedParts.segments.length) {
    for (let i = 0; i < enemy.animatedParts.segments.length; i += 1) {
      const segment = enemy.animatedParts.segments[i];
      if (segment.userData.baseY === undefined) segment.userData.baseY = segment.position.y;
      const wave = Math.sin(enemy.wobble * 3.8 - i * 0.72);
      segment.position.x = wave * 0.16 * scale * (1 - i * 0.045);
      segment.position.y = segment.userData.baseY + Math.cos(enemy.wobble * 4.1 - i * 0.55) * 0.025 * scale;
      segment.rotation.y = wave * 0.28;
    }
  }

  if (enemy.animatedParts.fins.length) {
    for (let i = 0; i < enemy.animatedParts.fins.length; i += 1) {
      const fin = enemy.animatedParts.fins[i];
      const side = fin.position.x < 0 ? -1 : 1;
      fin.rotation.z = side * (0.8 + Math.sin(enemy.wobble * 5.4 + i) * 0.18);
    }
  }

  if (enemy.animatedParts.wings.length) {
    for (let i = 0; i < enemy.animatedParts.wings.length; i += 1) {
      const wing = enemy.animatedParts.wings[i];
      const side = wing.position.x < 0 ? -1 : 1;
      wing.rotation.z = side * (0.82 + Math.sin(enemy.wobble * 8.0) * 0.24);
      wing.rotation.y = Math.sin(enemy.wobble * 5.8 + i) * 0.22;
    }
  }
}

function updateEnemies(dt) {
  const playerPos = player.group.position;
  const enemySpeedMultiplier = getEnemySpeedMultiplier();
  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const enemy = enemies[i];
    const enemySpeed = enemy.type.speed * enemySpeedMultiplier;
    enemy.cooldown -= dt;
    enemy.spawnRise = Math.max(0, enemy.spawnRise - dt * 2.2);
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt * 4.5);

    const toPlayerX = playerPos.x - enemy.group.position.x;
    const toPlayerZ = playerPos.z - enemy.group.position.z;
    const dist = Math.hypot(toPlayerX, toPlayerZ) || 0.0001;
    const nx = toPlayerX / dist;
    const nz = toPlayerZ / dist;

    let steerX = nx;
    let steerZ = nz;

    if (enemy.type.movement === 'slither') {
      const sway = Math.sin(enemy.wobble * 2.7 + dist * 0.17) * 0.68;
      steerX = nx * 0.86 + -nz * sway;
      steerZ = nz * 0.86 + nx * sway;
    } else if (enemy.type.movement === 'zigzag') {
      const sideStep = Math.sin(enemy.wobble * 3.9) * (dist > 4.2 ? 0.92 : 0.36);
      steerX = nx * 0.72 + -nz * sideStep;
      steerZ = nz * 0.72 + nx * sideStep;
    }

    for (const other of enemies) {
      if (other === enemy) continue;
      const ox = enemy.group.position.x - other.group.position.x;
      const oz = enemy.group.position.z - other.group.position.z;
      const od = Math.hypot(ox, oz);
      if (od > 0 && od < enemy.radius + other.radius + 0.55) {
        steerX += (ox / od) * 0.95;
        steerZ += (oz / od) * 0.95;
      }
    }

    const len = Math.hypot(steerX, steerZ) || 1;
    steerX /= len;
    steerZ /= len;

    const tryAngles = [0, 0.35, -0.35, 0.72, -0.72, 1.12, -1.12];
    let chosenX = steerX;
    let chosenZ = steerZ;
    let foundPath = false;

    for (const a of tryAngles) {
      const dir = rotate2(steerX, steerZ, a);
      const probeX = enemy.group.position.x + dir.x * enemySpeed * dt * 2.2;
      const probeZ = enemy.group.position.z + dir.z * enemySpeed * dt * 2.2;
      if (!collidesWithDungeon(probeX, probeZ, enemy.radius)) {
        chosenX = dir.x;
        chosenZ = dir.z;
        foundPath = true;
        break;
      }
    }

    if (!foundPath) {
      const wander = rotate2(nx, nz, Math.sin(enemy.wobble * 0.7) * 0.9);
      chosenX = wander.x;
      chosenZ = wander.z;
    }

    moveCircle(enemy, chosenX * enemySpeed * dt, chosenZ * enemySpeed * dt, enemy.radius);
    enemy.wobble += dt * (2 + enemySpeed * 0.18);

    const bob = Math.sin(enemy.wobble * 6) * 0.08 * enemy.type.scale;
    enemy.group.position.y = bob - enemy.spawnRise * 1.1;
    const targetFacing = angleForNegativeZFacing(nx, nz);
    enemy.facingY = lerpAngle(enemy.facingY, targetFacing, clamp(dt * 9, 0, 1));
    enemy.group.rotation.y = enemy.facingY;
    animateEnemyParts(enemy);
    const pulse = 1 + enemy.hitFlash * 0.35;
    enemy.group.scale.setScalar(pulse);

    if (dist < enemy.radius + PLAYER_RADIUS + 0.12 && enemy.cooldown <= 0) {
      damagePlayer(enemy.type.damage, enemy.group.position);
      enemy.cooldown = enemy.type.attackCooldown;
      const push = new THREE.Vector2(nx, nz).multiplyScalar(-0.9);
      moveCircle(player, push.x, push.y, PLAYER_RADIUS);
    }
  }
}

function updatePlayer(dt) {
  const inputX = (isInputDown('KeyD', 'd', 'ArrowRight') ? 1 : 0) - (isInputDown('KeyA', 'a', 'ArrowLeft') ? 1 : 0);
  const inputZ = (isInputDown('KeyS', 's', 'ArrowDown') ? 1 : 0) - (isInputDown('KeyW', 'w', 'ArrowUp') ? 1 : 0);
  tmpVec2.set(inputX, inputZ);
  if (tmpVec2.lengthSq() > 1) tmpVec2.normalize();

  const targetSpeed = 8.9;
  player.velocity.x = lerp(player.velocity.x, tmpVec2.x * targetSpeed, 1 - Math.exp(-dt * 12));
  player.velocity.y = lerp(player.velocity.y, tmpVec2.y * targetSpeed, 1 - Math.exp(-dt * 12));

  moveCircle(player, player.velocity.x * dt, player.velocity.y * dt, PLAYER_RADIUS);

  const aim = getAimWorld();
  const aimX = aim.x - player.group.position.x;
  const aimZ = aim.z - player.group.position.z;
  const aimLen = Math.hypot(aimX, aimZ) || 1;
  player.aimDir.set(aimX / aimLen, aimZ / aimLen);
  player.group.rotation.y = Math.atan2(-player.aimDir.x, -player.aimDir.y);

  player.bob += dt * (2 + tmpVec2.length() * 9.5);
  player.group.position.y = Math.sin(player.bob) * 0.06;

  if (mouse.down) fireCurrentWeapon();
  if (mouse.right || isInputDown('Space', 'space')) throwGrenade();
}

function updateSpawns(dt) {
  if (game.over) return;
  const difficulty = 1 + game.elapsed * 0.04;
  game.spawnAccumulator += dt * (0.42 + difficulty * 0.35);
  const chunk = 1 + Math.floor(game.elapsed / 18);
  while (game.spawnAccumulator >= 1) {
    game.spawnAccumulator -= 1;
    const guaranteedExtra = Math.floor(game.elapsed / 210);
    const packChance = clamp(0.08 + game.elapsed * 0.0022, 0.08, 0.82);
    const packSize = 1 + guaranteedExtra + (Math.random() < packChance ? 1 : 0);
    spawnEnemyPack(packSize);
  }

  game.swarmTimer -= dt;
  if (game.swarmTimer <= 0) {
    const swarmSize = 4 + Math.floor(game.elapsed / 24) + Math.floor(Math.random() * 3);
    const swarmTypes = ['skitter', 'viper', 'zigzag', 'stalker'];
    spawnEnemyPack(swarmSize, swarmTypes[Math.floor(Math.random() * swarmTypes.length)]);
    showMessage(`Swarm incoming x${swarmSize}`);
    audio.swarm();
    game.swarmTimer = Math.max(7.5, 24 - game.elapsed * 0.028) + Math.random() * 5;
  }

  if (Math.random() < dt * (0.04 + chunk * 0.003)) {
    const pos = pickSpawnTile(12, 28);
    const loot = Math.random();
    if (loot < 0.38) createPickup('ammo', pos.x, pos.z);
    else if (loot < 0.68) createPickup('grenade', pos.x, pos.z);
    else if (loot < 0.88) createPickup('health', pos.x, pos.z);
    else {
      const pool = ['shotgun', 'flamethrower', 'nova', 'lightning'];
      createPickup('weapon', pos.x, pos.z, pool[Math.floor(Math.random() * pool.length)]);
    }
  }
}

function updateLights(dt) {
  const flicker = Math.sin(game.elapsed * 19) * 0.8 + Math.sin(game.elapsed * 31 + 1.4) * 0.45;
  const sideX = -player.aimDir.y;
  const sideZ = player.aimDir.x;
  torchConeUniforms.uPlayer.value.set(player.group.position.x, player.group.position.z);
  torchConeUniforms.uAim.value.set(player.aimDir.x, player.aimDir.y);
  torch.position.set(
    player.group.position.x - player.aimDir.x * 0.55 - sideX * 0.18,
    3.05,
    player.group.position.z - player.aimDir.y * 0.55 - sideZ * 0.18
  );
  torchTarget.position.set(
    player.group.position.x + player.aimDir.x * 23 + sideX * 0.08,
    0.38,
    player.group.position.z + player.aimDir.y * 23 + sideZ * 0.08
  );
  torch.intensity = 74 + flicker * 2.2;

  lantern.position.set(
    player.group.position.x - player.aimDir.x * 0.2 + sideX * 0.55,
    3.8,
    player.group.position.z - player.aimDir.y * 0.2 + sideZ * 0.55
  );
  lanternTarget.position.set(
    player.group.position.x + player.aimDir.x * 5.8,
    0.4,
    player.group.position.z + player.aimDir.y * 5.8
  );
  lantern.intensity = 12 + flicker * 0.65;

  haloLight.position.set(player.group.position.x, 2.2, player.group.position.z);
  haloLight.intensity = 0.95 + flicker * 0.04;

  for (let i = muzzleLights.length - 1; i >= 0; i -= 1) {
    const entry = muzzleLights[i];
    entry.life -= dt;
    entry.light.intensity = (entry.life / entry.maxLife) * entry.intensity;
    if (entry.life <= 0) {
      scene.remove(entry.light);
      muzzleLights.splice(i, 1);
    }
  }

  for (let i = blastLights.length - 1; i >= 0; i -= 1) {
    const entry = blastLights[i];
    entry.life -= dt;
    entry.light.intensity = (entry.life / entry.maxLife) * entry.intensity;
    if (entry.life <= 0) {
      scene.remove(entry.light);
      blastLights.splice(i, 1);
    }
  }
}

function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.velocity.y -= p.gravity * dt;
    p.sprite.position.addScaledVector(p.velocity, dt);
    const alpha = Math.max(0, p.life / p.maxLife);
    p.sprite.material.opacity = alpha;
    p.sprite.scale.setScalar(lerp(0.04, p.sprite.scale.x, 0.95) + dt * 0.22);
    if (p.life <= 0) {
      fxGroup.remove(p.sprite);
      p.sprite.material.dispose();
      particles.splice(i, 1);
    }
  }

  for (let i = traces.length - 1; i >= 0; i -= 1) {
    const trace = traces[i];
    trace.life -= dt;
    const alpha = Math.max(0, trace.life / trace.maxLife);
    const progress = 1 - alpha;
    for (let b = 0; b < trace.beams.length; b += 1) {
      const beam = trace.beams[b];
      beam.material.uniforms.uAlpha.value = alpha * (b === 0 ? 0.28 : b === 1 ? 0.78 : 0.58);
    }
    for (let j = 0; j < trace.sprites.length; j += 1) {
      const sprite = trace.sprites[j];
      const spark = trace.sparks[j];
      sprite.material.opacity = alpha * (0.35 + spark.t * 0.6);
      sprite.position.lerpVectors(trace.start, trace.end, clamp(spark.t + spark.advance * progress, 0, 1));
      sprite.position.addScaledVector(trace.side, spark.drift * progress);
      sprite.position.y += spark.rise * progress;
      sprite.scale.setScalar(spark.baseScale * (1 + progress * 0.85));
    }
    trace.head.material.opacity = alpha * 0.92;
    trace.head.scale.setScalar(trace.thickness * (11.2 + progress * 8));
    trace.ring.material.opacity = alpha * 0.48;
    trace.ring.scale.setScalar(trace.thickness * (6.4 + progress * 13));
    if (trace.life <= 0) {
      fxGroup.remove(trace.group);
      for (const beam of trace.beams) {
        beam.geometry.dispose();
        beam.material.dispose();
      }
      for (const sprite of trace.sprites) sprite.material.dispose();
      trace.head.material.dispose();
      trace.ring.material.dispose();
      traces.splice(i, 1);
    }
  }

  for (let i = shockwaves.length - 1; i >= 0; i -= 1) {
    const wave = shockwaves[i];
    if (wave.delay > 0) {
      wave.delay -= dt;
      wave.sprite.material.opacity = 0;
      continue;
    }
    wave.life -= dt;
    const alpha = Math.max(0, wave.life / wave.maxLife);
    wave.sprite.material.opacity = alpha * (wave.baseOpacity ?? 0.95);
    if (wave.endRadius !== undefined) {
      const progress = 1 - alpha;
      const s = lerp(wave.startRadius, wave.endRadius, 1 - Math.pow(1 - progress, 2.3));
      wave.sprite.scale.set(s, s, 1);
    } else {
      const s = wave.sprite.scale.x + wave.grow * dt;
      wave.sprite.scale.set(s, s, 1);
    }
    if (wave.life <= 0) {
      fxGroup.remove(wave.sprite);
      if (wave.disposeGeometry) wave.sprite.geometry.dispose();
      wave.sprite.material.dispose();
      shockwaves.splice(i, 1);
    }
  }

  game.screenShake = Math.max(0, game.screenShake - dt * 1.9);
  const shakePx = game.screenShake * 13;
  if (shakePx > 0.02) {
    const sx = (Math.random() * 2 - 1) * shakePx;
    const sy = (Math.random() * 2 - 1) * shakePx;
    screenEl.style.transform = `translate(${sx}px, ${sy}px)`;
  } else {
    screenEl.style.transform = 'translate(0px, 0px)';
  }

  playerState.hurtFlash = Math.max(0, playerState.hurtFlash - dt * 2.2);
  damageFlashEl.style.opacity = String(playerState.hurtFlash * 0.95);
  game.boomFlash = Math.max(0, game.boomFlash - dt * 2.8);
  boomFlashEl.style.opacity = String(game.boomFlash * 1.5);

  if (game.messageTimer > 0) {
    game.messageTimer -= dt;
    if (game.messageTimer <= 0) messageEl.style.opacity = '0';
  }
}

function updateCamera(dt) {
  const camTarget = new THREE.Vector3(
    player.group.position.x - player.aimDir.x * 2.2,
    22,
    player.group.position.z + 12 - player.aimDir.y * 2.2
  );
  camera.position.lerp(camTarget, 1 - Math.exp(-dt * 9));
  tmpVec3.set(player.group.position.x, 0.6, player.group.position.z - 1.5);
  camera.lookAt(tmpVec3);
}

function animate() {
  requestAnimationFrame(animate);
  let dt = clock.getDelta();
  dt = Math.min(dt, 0.033);
  shaderTime.value += dt;

  if (game.started && !game.over) {
    game.elapsed += dt;
    game.score += dt * 2.25;
    playerState.fireCooldown = Math.max(0, playerState.fireCooldown - dt);
    playerState.throwCooldown = Math.max(0, playerState.throwCooldown - dt);
    playerState.hurtCooldown = Math.max(0, playerState.hurtCooldown - dt);
    updatePlayer(dt);
    updateGrenades(dt);
    updateEnemies(dt);
    updatePickups(dt);
    updateSpawns(dt);
    updateHud();
  }

  updateExploration(dt);
  updateLights(dt);
  updateEffects(dt);
  updateCamera(dt);
  updateFloatingTexts(dt);

  crosshairEl.style.left = `${mouse.x}px`;
  crosshairEl.style.top = `${mouse.y}px`;

  renderWeaponPreview(dt);
  renderer.render(scene, camera);
}

function beginGame() {
  audio.unlock();
  game.started = true;
  startScreenEl.style.display = 'none';
  if (game.over) resetGame();
}

function handleStartScreenCode(event, pressed) {
  if (!pressed || event.repeat || (game.started && !game.over)) return false;
  const key = normalizeInputKey(event.key);
  if (!key || key.length !== 1) return false;
  const candidate = game.startCodeBuffer + key;
  if (START_LOADOUT_CODE.startsWith(candidate)) {
    game.startCodeBuffer = candidate;
    if (candidate === START_LOADOUT_CODE) {
      game.bonusLoadout = true;
      game.startCodeBuffer = '';
      applyBonusLoadout();
    }
    return true;
  }
  game.startCodeBuffer = START_LOADOUT_CODE.startsWith(key) ? key : '';
  return false;
}

function handleKeyChange(event, pressed) {
  if (handledInputEvents.has(event)) return;
  handledInputEvents.add(event);
  setInputState(event, pressed);
  if (handleStartScreenCode(event, pressed)) {
    event.preventDefault();
    return;
  }

  if (eventMatchesInput(event, 'KeyW', 'w', 'KeyA', 'a', 'KeyS', 's', 'KeyD', 'd', 'Space', 'space', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight')) {
    event.preventDefault();
    if (pressed && !game.started) beginGame();
  }

  if (!pressed) return;

  if (eventMatchesInput(event, 'Digit1', '1')) {
    event.preventDefault();
    switchWeapon('carbine');
  }
  if (eventMatchesInput(event, 'KeyQ', 'q')) {
    event.preventDefault();
    if (event.repeat) return;
    cycleWeapon(1);
  }
  if (eventMatchesInput(event, 'Digit2', '2')) {
    event.preventDefault();
    switchWeapon('shotgun');
  }
  if (eventMatchesInput(event, 'Digit3', '3')) {
    event.preventDefault();
    switchWeapon('flamethrower');
  }
  if (eventMatchesInput(event, 'Digit4', '4')) {
    event.preventDefault();
    switchWeapon('nova');
  }
  if (eventMatchesInput(event, 'Digit5', '5')) {
    event.preventDefault();
    switchWeapon('lightning');
  }
  if (eventMatchesInput(event, 'KeyR', 'r')) {
    event.preventDefault();
    game.started = true;
    startScreenEl.style.display = 'none';
    resetGame();
  }
}

window.addEventListener('pointerdown', (event) => {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
  if (!game.started || game.over) {
    beginGame();
  }
  audio.unlock();
  if (event.button === 0) mouse.down = true;
  if (event.button === 2) mouse.right = true;
});

window.addEventListener('pointerup', (event) => {
  if (event.button === 0) mouse.down = false;
  if (event.button === 2) mouse.right = false;
});

window.addEventListener('mousemove', (event) => {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
});

window.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('keydown', (event) => handleKeyChange(event, true), { capture: true });
window.addEventListener('keyup', (event) => handleKeyChange(event, false), { capture: true });
document.addEventListener('keydown', (event) => handleKeyChange(event, true), { capture: true });
document.addEventListener('keyup', (event) => handleKeyChange(event, false), { capture: true });

window.addEventListener('blur', () => {
  mouse.down = false;
  mouse.right = false;
  keys.clear();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  syncWeaponPreviewSize();
});
