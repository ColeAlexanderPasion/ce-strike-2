/**
 * CE Strike 3D — Client
 * ─────────────────────────────────────────────────────────────
 * Architecture:
 *   • Three.js r128 for 3D rendering (loaded from CDN)
 *   • Socket.io for real-time multiplayer
 *   • Pointer Lock API for FPS mouse look
 *   • Client-side prediction: local player moves immediately,
 *     server reconciles position every broadcast
 *   • 60fps render loop independent of 20Hz server tick
 *
 * HOW TO ADD A WEAPON:
 *   1. Add stats to CHARACTERS in server.js
 *   2. In buildWeaponMesh() below, add a case for the weapon name
 *
 * HOW TO ADD MAP OBJECTS:
 *   Add to MAP_BOXES in server.js — client reads them from 'map_data' event
 *
 * HOW TO SWITCH TO THIRD-PERSON:
 *   Change CAMERA_MODE to 'third' below
 * ─────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════
// CONFIG  — tweak these to change feel
// ═══════════════════════════════════════════════
const CAMERA_MODE   = 'first';   // 'first' | 'third'
const MOVE_SPEED    = 7;         // base, overridden per-character
const MOUSE_SENS    = 0.0022;
const JUMP_V        = 10;
const GRAVITY       = -28;
const PLAYER_H      = 1.8;
const PLAYER_R      = 0.4;
const WINS_REQ      = 15;
const FOV           = 75;

// ═══════════════════════════════════════════════
// CHARACTER DEFINITIONS  (mirrors server)
// ═══════════════════════════════════════════════
const CHARS = {
  Andree:  { color:0x00e5ff, maxHp:100, spd:7,   maxAmmo:12, reloadMs:1200, weapon:'Assault Rifle', role:'Rifleman'  },
  Chesney: { color:0xff6b35, maxHp:140, spd:5.5, maxAmmo:6,  reloadMs:2200, weapon:'Shotgun',        role:'Breacher'  },
  Denver:  { color:0xb5ff4d, maxHp:80,  spd:9,   maxAmmo:20, reloadMs:800,  weapon:'SMG',            role:'Scout'     },
  Fischer: { color:0xe040fb, maxHp:90,  spd:6,   maxAmmo:5,  reloadMs:2500, weapon:'Sniper',         role:'Marksman'  },
  Maybelle:{ color:0xffeb3b, maxHp:110, spd:6.5, maxAmmo:8,  reloadMs:1500, weapon:'Revolver',       role:'Duelist'   }
};

// ═══════════════════════════════════════════════
// THREE.JS SETUP
// ═══════════════════════════════════════════════
const scene    = new THREE.Scene();
const camera   = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.1, 500);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('cvs'), antialias: true });

renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x080c18);
renderer.toneMapping       = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ── Fog ──
scene.fog = new THREE.FogExp2(0x080c18, 0.012);

// ── Lighting ──
const ambient = new THREE.AmbientLight(0x1a2040, 1.2);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffeedd, 1.8);
sun.position.set(20, 50, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far  = 200;
sun.shadow.camera.left = sun.shadow.camera.bottom = -100;
sun.shadow.camera.right = sun.shadow.camera.top    =  100;
scene.add(sun);

// Blue fill light from below
const fill = new THREE.PointLight(0x0040aa, 0.6, 200);
fill.position.set(0, 1, 0);
scene.add(fill);

// ═══════════════════════════════════════════════
// SCENE HELPERS
// ═══════════════════════════════════════════════

/** Create a box mesh with optional emissive glow */
function makeBox(w, h, d, color, emissive = 0x000000, emissiveIntensity = 0) {
  const geo = new THREE.BoxGeometry(w * 2, h * 2, d * 2);
  const mat = new THREE.MeshStandardMaterial({
    color, emissive, emissiveIntensity, roughness: 0.7, metalness: 0.2
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Build a character mesh (colored box body + head + weapon) */
function buildCharMesh(character) {
  const ch    = CHARS[character] || CHARS.Andree;
  const color = ch.color;
  const group = new THREE.Group();

  // Body
  const body = makeBox(0.35, 0.6, 0.25, color, color, 0.15);
  body.position.y = 0.6;
  group.add(body);

  // Head
  const head = makeBox(0.22, 0.22, 0.22, color, color, 0.2);
  head.position.y = 1.42;
  group.add(head);

  // Eyes (dark rectangles on head)
  const eyeGeo = new THREE.BoxGeometry(0.08, 0.05, 0.02);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  [-0.08, 0.08].forEach(ex => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(ex, 1.44, 0.23);
    group.add(eye);
  });

  // Legs
  [-0.12, 0.12].forEach(lx => {
    const leg = makeBox(0.1, 0.35, 0.1, Math.max(0, color - 0x303030));
    leg.position.set(lx, 0, 0);
    group.add(leg);
  });

  // Weapon
  const weapon = buildWeaponMesh(ch.weapon, color);
  weapon.position.set(0.3, 0.65, 0.3);
  group.add(weapon);

  // Name tag (plane with canvas texture)
  // We use a dynamic canvas texture for the floating name
  group.userData.nameTagGroup = createNameTag('');
  group.userData.nameTagGroup.position.y = 1.9;
  group.add(group.userData.nameTagGroup);

  return group;
}

/**
 * Build a simple weapon mesh.
 * TO ADD A WEAPON: add a new case below.
 */
function buildWeaponMesh(weaponName, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness:0.4, metalness:0.8 });

  switch (weaponName) {
    case 'Shotgun': {
      // Wide stubby barrel
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.55), mat);
      const stock  = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.22), mat);
      stock.position.z = 0.24;
      g.add(barrel, stock);
      break;
    }
    case 'Sniper': {
      // Long thin barrel
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.75), mat);
      const scope  = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), new THREE.MeshStandardMaterial({ color:0x222233 }));
      scope.rotation.z = Math.PI / 2;
      scope.position.y = 0.05;
      g.add(barrel, scope);
      break;
    }
    case 'SMG': {
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.35), mat);
      const grip   = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.05), mat);
      grip.position.set(0, -0.07, 0.05);
      g.add(barrel, grip);
      break;
    }
    case 'Revolver': {
      const barrel   = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8), mat);
      barrel.rotation.z = Math.PI / 2;
      const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.08, 8), mat);
      cylinder.rotation.z = Math.PI / 2;
      cylinder.position.y = 0.02;
      g.add(barrel, cylinder);
      break;
    }
    default: { // Assault Rifle
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.5), mat);
      const mag    = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), mat);
      mag.position.set(0, -0.07, 0);
      g.add(barrel, mag);
    }
  }
  return g;
}

/** Floating name tag above player heads */
function createNameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 8, 256, 36);
  ctx.font = 'bold 20px "Rajdhani", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(name, 128, 32);

  const tex = new THREE.CanvasTexture(canvas);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.22),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  plane.renderOrder = 1;
  const group = new THREE.Group();
  group.add(plane);
  group._canvas = canvas;
  group._tex    = tex;
  return group;
}

function updateNameTag(tagGroup, name, color) {
  const canvas = tagGroup._canvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 48);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(4, 8, 248, 34);
  ctx.font = 'bold 20px Rajdhani, sans-serif';
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.textAlign = 'center';
  ctx.fillText(name, 128, 31);
  tagGroup._tex.needsUpdate = true;
}

// ═══════════════════════════════════════════════
// WORLD BUILDING
// ═══════════════════════════════════════════════
let mapBoxMeshes = [];
let mapW = 80, mapD = 80;

function buildMap(boxes) {
  // Floor
  const floorGeo = new THREE.PlaneGeometry(mapW * 2, mapD * 2, 40, 40);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x0c1020, roughness: 0.9, metalness: 0.1
  });
  // Add grid pattern via wireframe overlay
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Floor grid lines
  const gridHelper = new THREE.GridHelper(mapW * 2, 40, 0x1a2040, 0x0e1428);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // Sky — gradient via a large sphere
  const skyGeo = new THREE.SphereGeometry(400, 16, 8);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0x060c1a, side: THREE.BackSide
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Stars (random points)
  const starCount = 600;
  const starGeo   = new THREE.BufferGeometry();
  const starVerts = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount * 3; i++) {
    starVerts[i] = (Math.random() - 0.5) * 700;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starVerts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color:0xaaaaff, size:0.4 })));

  // Map boundary glow strips
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent:true, opacity:0.35 });
  [[mapW, 0, 0, 0], [-mapW, 0, 0, 0], [0, 0, mapD, Math.PI/2], [0, 0, -mapD, Math.PI/2]].forEach(([x,_,z,ry]) => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(mapW * 2, 0.08), glowMat);
    strip.position.set(x, 0.05, z);
    strip.rotation.y = ry; strip.rotation.x = -Math.PI/2;
    scene.add(strip);
  });

  // Build map boxes (walls, crates, towers)
  boxes.forEach((b, i) => {
    const isWall = i < 4;
    const color  = isWall ? 0x1a2040 : 0x1c2438;
    const emis   = isWall ? 0x0a1020 : 0x0c1830;

    const mesh = makeBox(b.w, b.h, b.d, color, emis, 0.3);
    mesh.position.set(b.x, b.y, b.z);

    // Glow edge on top of cover boxes
    if (!isWall) {
      const edgeGeo = new THREE.EdgesGeometry(mesh.geometry);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.3 });
      mesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
    }

    scene.add(mesh);
    mapBoxMeshes.push({ mesh, box: b });
  });

  // Spawn point markers
  SPAWN_POINTS_CLIENT.forEach(sp => {
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.04, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent:true, opacity: 0.25 })
    );
    marker.position.set(sp.x, 0.02, sp.z);
    scene.add(marker);
  });
}

const SPAWN_POINTS_CLIENT = [
  {x:-60,z:-60},{x:60,z:-60},{x:-60,z:60},{x:60,z:60},
  {x:0,z:-65},{x:0,z:65},{x:-65,z:0},{x:65,z:0}
];

// ═══════════════════════════════════════════════
// BULLET VISUALS
// ═══════════════════════════════════════════════
const bulletMeshes = {};
const bulletTrailGeo = new THREE.BoxGeometry(0.06, 0.06, 0.3);

function getOrCreateBulletMesh(id, color) {
  if (bulletMeshes[id]) return bulletMeshes[id];
  const mat  = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(bulletTrailGeo, mat);
  scene.add(mesh);
  bulletMeshes[id] = mesh;
  return mesh;
}

function removeBulletMesh(id) {
  if (bulletMeshes[id]) {
    scene.remove(bulletMeshes[id]);
    bulletMeshes[id].geometry.dispose();
    delete bulletMeshes[id];
  }
}

// Muzzle flash
function spawnMuzzleFlash(x, y, z, color) {
  const geo  = new THREE.SphereGeometry(0.22, 6, 4);
  const mat  = new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  let life = 4;
  const tick = () => {
    life--;
    mesh.scale.multiplyScalar(1.4);
    mesh.material.opacity *= 0.5;
    if (life <= 0) { scene.remove(mesh); geo.dispose(); mat.dispose(); }
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Bullet impact sparks
function spawnImpact(x, y, z, color) {
  for (let i = 0; i < 8; i++) {
    const geo  = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const mat  = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    const vel = new THREE.Vector3((Math.random()-0.5)*4, Math.random()*3, (Math.random()-0.5)*4);
    scene.add(mesh);
    let life = 12;
    const tick = () => {
      life--;
      mesh.position.add(vel.clone().multiplyScalar(0.05));
      vel.y -= 0.15;
      mesh.material.opacity = life / 12;
      if (life <= 0) { scene.remove(mesh); geo.dispose(); mat.dispose(); }
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// ═══════════════════════════════════════════════
// WEAPON VIEW MODEL (first-person hands + gun)
// ═══════════════════════════════════════════════
let viewModel = null;

function buildViewModel(weaponName, color) {
  if (viewModel) { scene.remove(viewModel); }
  const g   = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color:0x222233, roughness:0.4, metalness:0.9 });
  const hMat= new THREE.MeshStandardMaterial({ color:0x8b6a5a });

  // Hands
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.09,0.14), hMat);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.09,0.14), hMat);
  handL.position.set(-0.08, -0.01, -0.05);
  handR.position.set( 0.04, -0.03, -0.1);
  g.add(handL, handR);

  // Gun body
  const body   = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.35), mat);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.28, 8), mat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, -0.28);

  if (weaponName === 'Shotgun') {
    const barrelW = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.42), mat);
    g.add(barrelW);
  } else if (weaponName === 'Sniper') {
    const barrelL = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 8), mat);
    barrelL.rotation.x = Math.PI/2; barrelL.position.set(0,0.01,-0.42);
    g.add(body, barrelL);
  } else {
    g.add(body, barrel);
  }

  // Accent color strip
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.062, 0.012, 0.3),
    new THREE.MeshBasicMaterial({ color })
  );
  strip.position.y = 0.042;
  g.add(strip);

  // Position in camera space
  g.position.set(0.2, -0.22, -0.35);
  viewModel = g;
  camera.add(g);   // parent to camera so it moves with view
}

// Bob animation for view model
let bobT = 0;
function updateViewModelBob(moving, dt) {
  if (!viewModel) return;
  if (moving) bobT += dt * 8;
  const bobY = moving ? Math.sin(bobT) * 0.012 : 0;
  const bobX = moving ? Math.sin(bobT * 0.5) * 0.006 : 0;
  viewModel.position.y = THREE.MathUtils.lerp(viewModel.position.y, -0.22 + bobY, 0.15);
  viewModel.position.x = THREE.MathUtils.lerp(viewModel.position.x,  0.20 + bobX, 0.15);
}

// ═══════════════════════════════════════════════
// SOCKET + GAME STATE
// ═══════════════════════════════════════════════
const socket = io({ transports: ['websocket', 'polling'] });

let myId      = null;
let myChar    = null;
let myName    = 'Soldier';
let gameStarted = false;

// Remote player meshes
const remoteMeshes = {};

// Local player (client-side prediction)
const local = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0,
  health: 100, maxHealth: 100,
  alive: true, kills: 0,
  ammo: 12, maxAmmo: 12,
  reloading: false, speed: 7,
  onGround: true
};

// FPS camera yaw/pitch (separate from local so we can apply mouse immediately)
let camYaw   = 0;
let camPitch = 0;

// Ping tracking
let lastPingSent = 0;
let currentPing  = 0;

// ── Socket events ──
socket.on('map_data', data => {
  mapW = data.mapW; mapD = data.mapD;
  buildMap(data.boxes);
});

socket.on('joined', data => {
  myId = data.id;
  startGame();
});

// Compact game state broadcast (20Hz from server)
socket.on('gs', state => {
  const srvMe = state.players.find(p => p.id === myId);

  // ── Reconcile local player ──
  if (srvMe) {
    // Hard snap if large discrepancy (hit wall / lag spike)
    const dx = srvMe.x - local.x, dz = srvMe.z - local.z;
    if (dx*dx + dz*dz > 50) {
      local.x = srvMe.x; local.z = srvMe.z;
    } else {
      // Gentle lerp for small corrections
      local.x += dx * 0.08; local.z += dz * 0.08;
    }

    const wasAlive = local.alive;
    local.health   = srvMe.hp;
    local.maxHealth= srvMe.maxHp;
    local.alive    = srvMe.alive;
    local.kills    = srvMe.kills;
    local.ammo     = srvMe.ammo;
    local.maxAmmo  = srvMe.maxAmmo;
    local.reloading= srvMe.reloading;

    if (!local.alive && wasAlive) {
      // Just died
      document.getElementById('death-screen').classList.add('vis');
      startDeathCountdown();
    }
    updateHUD();
    updateReloadBar();
  }

  // ── Update remote players ──
  const currentIds = new Set(state.players.map(p => p.id));

  // Remove disconnected
  for (const id in remoteMeshes) {
    if (!currentIds.has(id)) {
      scene.remove(remoteMeshes[id]);
      delete remoteMeshes[id];
    }
  }

  // Update / create
  state.players.forEach(p => {
    if (p.id === myId) return;

    if (!remoteMeshes[p.id]) {
      const mesh = buildCharMesh(p.character);
      scene.add(mesh);
      remoteMeshes[p.id] = mesh;
    }

    const mesh = remoteMeshes[p.id];
    mesh.visible = p.alive;

    // Smooth interpolation for remote players
    mesh.position.x = THREE.MathUtils.lerp(mesh.position.x, p.x, 0.25);
    mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, p.y, 0.25);
    mesh.position.z = THREE.MathUtils.lerp(mesh.position.z, p.z, 0.25);
    mesh.rotation.y = p.yaw;

    // Update name tag
    if (mesh.userData.nameTagGroup) {
      const ch = CHARS[p.character];
      updateNameTag(mesh.userData.nameTagGroup, p.name, ch ? ch.color : 0xffffff);
      // Face camera
      mesh.userData.nameTagGroup.lookAt(camera.position);
    }
  });

  // ── Update bullets ──
  const activeBulletIds = new Set(state.bullets.map(b => b.id));
  for (const id in bulletMeshes) {
    if (!activeBulletIds.has(+id)) removeBulletMesh(id);
  }
  state.bullets.forEach(b => {
    const mesh = getOrCreateBulletMesh(b.id, b.color);
    mesh.position.set(b.x, b.y, b.z);
  });

  // Scoreboard
  updateScoreboard(state.players);
});

socket.on('hit', ({ health }) => {
  local.health = health;
  flashDamage(1 - health / local.maxHealth);
  updateHUD();
  // Screen shake
  screenShakeAmount = 0.06;
});

socket.on('kill_feed', ({ killer, victim, killerChar }) => {
  addKillFeed(killer, victim, killerChar);
});

socket.on('respawn', ({ id }) => {
  if (id === myId) {
    document.getElementById('death-screen').classList.remove('vis');
    local.alive = true; local.health = local.maxHealth;
    updateHUD();
  }
  if (remoteMeshes[id]) remoteMeshes[id].visible = true;
});

socket.on('reload_done', () => {
  local.reloading = false; local.ammo = local.maxAmmo;
  updateHUD(); updateReloadBar();
});

socket.on('game_over', ({ winner, character }) => {
  const ch = CHARS[character];
  const color = ch ? '#' + ch.color.toString(16).padStart(6,'0') : '#ffeb3b';
  document.getElementById('go-title').textContent = `${winner} WINS`;
  document.getElementById('go-title').style.color = color;
  document.getElementById('go-sub').textContent   = `REACHED ${WINS_REQ} KILLS`;
  document.getElementById('game-over').classList.add('vis');
});

socket.on('game_reset', () => {
  document.getElementById('game-over').classList.remove('vis');
  document.getElementById('death-screen').classList.remove('vis');
  local.kills = 0; updateHUD();
});

socket.on('pong_custom', () => {
  currentPing = Date.now() - lastPingSent;
});

document.getElementById('btn-new').addEventListener('click', () => socket.emit('new_game'));

// ═══════════════════════════════════════════════
// LOBBY BUILD
// ═══════════════════════════════════════════════
let selChar = null;

Object.entries(CHARS).forEach(([key, ch]) => {
  const card = document.createElement('div');
  card.className = 'char-card';
  const hexColor = '#' + ch.color.toString(16).padStart(6, '0');

  const hp  = Math.round((ch.maxHp  / 140) * 100);
  const spd = Math.round((ch.spd    / 9)   * 100);
  const amm = Math.round((ch.maxAmmo/ 20)  * 100);

  card.innerHTML = `
    <div class="char-swatch" style="background:${hexColor};box-shadow:0 0 12px ${hexColor}66"></div>
    <div class="char-name" style="color:${hexColor}">${key.toUpperCase()}</div>
    <div class="char-role">${ch.role}</div>
    <div class="stat-row"><span class="stat-lbl">HP</span><div class="stat-bg"><div class="stat-fill" style="width:${hp}%;background:#00e676"></div></div></div>
    <div class="stat-row"><span class="stat-lbl">SPD</span><div class="stat-bg"><div class="stat-fill" style="width:${spd}%;background:#00e5ff"></div></div></div>
    <div class="stat-row"><span class="stat-lbl">AMO</span><div class="stat-bg"><div class="stat-fill" style="width:${amm}%;background:#ffeb3b"></div></div></div>
    <div style="font-size:9px;color:#888;margin-top:6px;font-family:'Share Tech Mono',monospace">${ch.weapon}</div>
  `;

  card.addEventListener('click', () => {
    document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selChar = key;
    checkReady();
  });

  document.getElementById('char-grid').appendChild(card);
});

document.getElementById('name-input').addEventListener('input', checkReady);
function checkReady() {
  document.getElementById('btn-play').disabled = !(
    document.getElementById('name-input').value.trim() && selChar
  );
}

document.getElementById('btn-play').addEventListener('click', () => {
  myName = document.getElementById('name-input').value.trim() || 'Soldier';
  myChar  = selChar;
  socket.emit('join', { name: myName, character: myChar });
});

// ═══════════════════════════════════════════════
// START GAME
// ═══════════════════════════════════════════════
function startGame() {
  document.getElementById('lobby').style.display    = 'none';
  document.getElementById('cvs').style.display      = 'block';
  document.getElementById('hud').style.display      = 'block';
  document.getElementById('crosshair').style.display= 'block';
  document.getElementById('click-to-play').classList.add('vis');

  const ch = CHARS[myChar];
  if (ch) {
    local.maxHealth= ch.maxHp; local.health = ch.maxHp;
    local.maxAmmo  = ch.maxAmmo; local.ammo = ch.maxAmmo;
    local.speed    = ch.spd;

    const hexColor = '#' + ch.color.toString(16).padStart(6,'0');
    document.getElementById('char-name').textContent = myChar.toUpperCase();
    document.getElementById('char-name').style.color = hexColor;
    document.getElementById('char-role').textContent = ch.role;
    document.getElementById('weapon-name').textContent = ch.weapon;
    buildViewModel(ch.weapon, ch.color);
  }

  updateHUD();
  gameStarted = true;

  // Add camera to scene so view model works
  scene.add(camera);

  // Initialise mobile touch controls (no-op on desktop — IS_MOBILE guards everything)
  initMobile();

  // Start ping loop
  setInterval(() => {
    lastPingSent = Date.now();
    socket.emit('ping_custom');
  }, 2000);
}

// ═══════════════════════════════════════════════
// POINTER LOCK + MOUSE LOOK
// ═══════════════════════════════════════════════
const clickToPlay = document.getElementById('click-to-play');

clickToPlay.addEventListener('click', () => {
  if (!gameStarted) return;
  document.body.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === document.body) {
    clickToPlay.classList.remove('vis');
  } else {
    clickToPlay.classList.add('vis');
  }
});

document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== document.body) return;
  camYaw   -= e.movementX * MOUSE_SENS;
  camPitch -= e.movementY * MOUSE_SENS;
  camPitch  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camPitch));
});

// ═══════════════════════════════════════════════
// KEYBOARD INPUT
// ═══════════════════════════════════════════════
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyR') {
    if (!local.reloading && local.ammo < local.maxAmmo) {
      socket.emit('reload');
      local.reloading = true;
      reloadStart = performance.now();
      reloadDuration = CHARS[myChar]?.reloadMs || 1500;
    }
  }
  if (e.code === 'Escape') document.exitPointerLock();
});
document.addEventListener('keyup',  e => { keys[e.code] = false; });

// ═══════════════════════════════════════════════
// SHOOTING
// ═══════════════════════════════════════════════
let lastShot     = 0;
let shootInterval= null;

document.addEventListener('mousedown', e => {
  if (e.button !== 0 || document.pointerLockElement !== document.body) return;
  doShoot();
  shootInterval = setInterval(doShoot, 80);
});
document.addEventListener('mouseup', () => clearInterval(shootInterval));

function doShoot() {
  if (!local.alive || local.reloading || local.ammo <= 0) return;

  const now = Date.now();
  const ch  = CHARS[myChar];
  if (ch && now - lastShot < ch.fireRateMs) return;
  lastShot = now;
  local.ammo = Math.max(0, local.ammo - 1);
  updateHUD();

  // Direction from camera
  const dir = new THREE.Vector3(0, 0, -1);
  dir.applyEuler(new THREE.Euler(camPitch, camYaw, 0, 'YXZ'));

  socket.emit('shoot', { dx: dir.x, dy: dir.y, dz: dir.z });

  // Muzzle flash at gun position
  const gunPos = new THREE.Vector3();
  camera.getWorldPosition(gunPos);
  gunPos.addScaledVector(dir, 0.8);
  gunPos.y -= 0.1;
  spawnMuzzleFlash(gunPos.x, gunPos.y, gunPos.z, ch ? ch.color : 0xffffff);

  // Recoil animation
  if (viewModel) {
    viewModel.rotation.x = -0.1;
    viewModel.position.z = -0.28;
  }
  if (local.ammo <= 0) {
    socket.emit('reload');
    local.reloading = true;
    reloadStart    = performance.now();
    reloadDuration = ch?.reloadMs || 1500;
  }
}

// ═══════════════════════════════════════════════
// MOVEMENT + PHYSICS (client-side prediction)
// ═══════════════════════════════════════════════
let reloadStart    = 0;
let reloadDuration = 1500;
let stepT = 0;

// Client-side wall collision (mirrors server MAP_BOXES)
const clientBoxes = [];   // filled after map_data

socket.on('map_data', data => {
  data.boxes.forEach(b => clientBoxes.push(b));
});

function clientBoxCollide(nx, ny, nz, box) {
  if (ny + PLAYER_H < box.y - box.h || ny > box.y + box.h) return false;
  const cx = Math.max(box.x - box.w, Math.min(nx, box.x + box.w));
  const cz = Math.max(box.z - box.d, Math.min(nz, box.z + box.d));
  const dx = nx - cx, dz = nz - cz;
  return dx*dx + dz*dz < PLAYER_R * PLAYER_R;
}

function updateMovement(dt) {
  if (!local.alive || !gameStarted) return;

  // ── Apply touch aim deltas BEFORE camera rotation ──
  // touchInput.aimDeltaX/Y accumulate between frames (touchmove fires faster
  // than rAF on some devices). We consume and reset them here each frame so
  // the camera rotates smoothly at render rate rather than in bursts.
  if (IS_MOBILE && (touchInput.aimDeltaX !== 0 || touchInput.aimDeltaY !== 0)) {
    camYaw   -= touchInput.aimDeltaX * TOUCH_AIM_SENS_X;
    camPitch -= touchInput.aimDeltaY * TOUCH_AIM_SENS_Y;
    camPitch  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, camPitch));
    touchInput.aimDeltaX = 0;
    touchInput.aimDeltaY = 0;
  }

  // ── Build input direction ──
  // On desktop: read keyboard keys (original logic, unchanged).
  // On mobile:  read touchInput joystick values instead.
  // Both paths produce the same mx/mz values so the physics below
  // works identically regardless of input device.
  let mx = 0, mz = 0;

  if (IS_MOBILE) {
    // touchInput.moveX/Z are already normalized -1..+1 from the joystick
    mx = touchInput.moveX;
    mz = touchInput.moveZ;
  } else {
    // Original keyboard reading — completely unchanged
    if (keys['KeyW'] || keys['ArrowUp'])    mz -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  mz += 1;
    if (keys['KeyA'] || keys['ArrowLeft'])  mx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
  }

  // Rotate input by camera yaw.
  // IMPORTANT: Three.js camera.rotation.y = camYaw uses a left-handed
  // convention where increasing yaw rotates the camera LEFT (clockwise
  // when viewed from above). The standard trig rotation matrix assumes
  // counterclockwise, so we negate camYaw here to make "forward" (mz=-1)
  // always move in the direction the camera is actually facing.
  // Without this negation, turning left/right reverses W/S movement.
  const cos = Math.cos(-camYaw), sin = Math.sin(-camYaw);
  const vx = mx * cos - mz * sin;
  const vz = mx * sin + mz * cos;
  const len = Math.sqrt(vx*vx + vz*vz);
  const normVx = len > 0 ? vx / len : 0;
  const normVz = len > 0 ? vz / len : 0;

  const spd = local.speed || 7;
  local.vx  = normVx * spd;
  local.vz  = normVz * spd;

  // ── Jump ──
  // On desktop: Space key.  On mobile: touchInput.jump (set by jump button).
  // The flag is cleared after being consumed so it only triggers once per press.
  const jumpRequested = IS_MOBILE
    ? touchInput.jump
    : (keys['Space'] || keys['KeySpace']);

  if (jumpRequested && local.onGround) {
    local.vy = JUMP_V;
    local.onGround = false;
    touchInput.jump = false;  // consume mobile flag (desktop keys are stateful anyway)
  } else if (IS_MOBILE) {
    touchInput.jump = false;  // always clear even if we couldn't jump
  }

  // Gravity
  local.vy += GRAVITY * dt;
  local.y  += local.vy * dt;

  // Ground
  local.onGround = false;
  if (local.y <= 0) { local.y = 0; local.vy = 0; local.onGround = true; }

  // Move X
  const nx = local.x + local.vx * dt;
  let colX  = false;
  for (const b of clientBoxes) { if (clientBoxCollide(nx, local.y, local.z, b)) { colX = true; break; } }
  if (!colX) local.x = nx;

  // Move Z
  const nz = local.z + local.vz * dt;
  let colZ  = false;
  for (const b of clientBoxes) { if (clientBoxCollide(local.x, local.y, nz, b)) { colZ = true; break; } }
  if (!colZ) local.z = nz;

  // Map clamp
  local.x = Math.max(-mapW + PLAYER_R, Math.min(mapW - PLAYER_R, local.x));
  local.z = Math.max(-mapD + PLAYER_R, Math.min(mapD - PLAYER_R, local.z));

  // Send to server (20x/second is fine, rAF sends every frame but socket throttles)
  socket.emit('mv', {
    vx: normVx, vz: normVz,
    yaw:   camYaw,
    pitch: camPitch,
    jump: jumpRequested && local.onGround
  });

  // ── Update camera position ──
  const eyeY = local.y + PLAYER_H;
  if (CAMERA_MODE === 'first') {
    camera.position.set(local.x, eyeY, local.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y     = camYaw;
    camera.rotation.x     = camPitch;
  } else {
    // Third-person
    const tpDist = 4;
    const behindX = local.x - Math.sin(camYaw) * tpDist;
    const behindZ = local.z - Math.cos(camYaw) * tpDist;
    camera.position.set(behindX, eyeY + 1.5, behindZ);
    camera.lookAt(local.x, eyeY, local.z);
  }

  updateViewModelBob(len > 0, dt);

  // Reload bar progress
  if (local.reloading) updateReloadBar();
}

// ═══════════════════════════════════════════════
// SCREEN SHAKE
// ═══════════════════════════════════════════════
let screenShakeAmount = 0;
function applyScreenShake() {
  if (screenShakeAmount <= 0) return;
  camera.position.x += (Math.random() - 0.5) * screenShakeAmount;
  camera.position.y += (Math.random() - 0.5) * screenShakeAmount;
  screenShakeAmount *= 0.7;
  if (screenShakeAmount < 0.001) screenShakeAmount = 0;
}

// ═══════════════════════════════════════════════
// HUD UPDATES
// ═══════════════════════════════════════════════
function updateHUD() {
  const hp    = Math.max(0, (local.health / local.maxHealth) * 100);
  document.getElementById('hp-fill').style.width      = hp + '%';
  document.getElementById('hp-fill').style.background = hp > 50 ? 'linear-gradient(90deg,#00e676,#69f0ae)' : hp > 25 ? 'linear-gradient(90deg,#ffeb3b,#ffd740)' : 'linear-gradient(90deg,#ff1744,#ff6b35)';
  document.getElementById('hp-val').textContent        = Math.ceil(local.health);
  document.getElementById('hp-val').style.color        = hp > 50 ? '#00e676' : hp > 25 ? '#ffeb3b' : '#ff1744';
  document.getElementById('ammo-val').textContent       = local.ammo;
  document.getElementById('ammo-val').style.color       = local.ammo === 0 ? '#ff1744' : local.ammo <= 3 ? '#ff6b35' : '#00e5ff';
  document.getElementById('ammo-max').textContent       = '/ ' + local.maxAmmo;
  document.getElementById('kills-val').textContent      = local.kills;
  document.getElementById('ping-val').textContent       = `PING: ${currentPing}ms`;
}

function updateReloadBar() {
  const wrap = document.getElementById('reload-wrap');
  if (local.reloading) {
    wrap.style.display = 'flex';
    const pct = Math.min(100, ((performance.now() - reloadStart) / reloadDuration) * 100);
    document.getElementById('reload-inner').style.width = pct + '%';
  } else {
    wrap.style.display = 'none';
  }
}

function updateScoreboard(players) {
  const sorted = [...players].sort((a, b) => b.kills - a.kills);
  document.getElementById('sb-rows').innerHTML = sorted.map(p => {
    const isMe = p.id === myId;
    const ch   = CHARS[p.character];
    const c    = ch ? '#' + ch.color.toString(16).padStart(6,'0') : '#fff';
    return `<div class="sb-row">
      <div class="sb-dot" style="background:${c}"></div>
      <span class="sb-name" style="color:${isMe ? c : '#666'}">${isMe ? '▶ ' : ''}${p.name}</span>
      <span class="sb-kills">${p.kills}</span>
    </div>`;
  }).join('');
}

function addKillFeed(killer, victim, killerChar) {
  const feed = document.getElementById('kill-feed');
  const el   = document.createElement('div');
  el.className = 'kf-entry';
  const ch    = CHARS[killerChar];
  const color = ch ? '#' + ch.color.toString(16).padStart(6,'0') : '#fff';
  el.style.borderLeftColor = color;
  el.innerHTML = `<span style="color:${color}">${killer}</span> <span style="opacity:0.4">✦</span> ${victim}`;
  feed.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function flashDamage(intensity) {
  const el = document.getElementById('dmg-flash');
  el.style.background = `rgba(255,0,0,${Math.min(0.5, intensity * 0.55)})`;
  setTimeout(() => { el.style.background = 'rgba(255,0,0,0)'; }, 140);
}

let respawnTimer = null;
function startDeathCountdown() {
  let c = 3;
  document.getElementById('respawn-cd').textContent = c;
  if (respawnTimer) clearInterval(respawnTimer);
  respawnTimer = setInterval(() => {
    c--;
    if (c <= 0) { clearInterval(respawnTimer); return; }
    document.getElementById('respawn-cd').textContent = c;
  }, 1000);
}

// ═══════════════════════════════════════════════
// MOBILE & TABLET SUPPORT
// ═══════════════════════════════════════════════
/**
 * HOW MOBILE DETECTION WORKS
 * ─────────────────────────────────────────────
 * IS_MOBILE is true when EITHER:
 *   a) The User-Agent contains keywords common to phones/tablets, OR
 *   b) The primary pointer is 'coarse' (finger-based, not precise mouse).
 *
 * Using BOTH checks ensures we catch:
 *   • iPhones / iPads (UA check)
 *   • Android phones/tablets (UA check)
 *   • Windows tablets / Surface in tablet mode (pointer:coarse)
 *   • Chromebooks in tablet mode (pointer:coarse)
 *
 * Desktop browsers always have pointer:fine (mouse), so they are
 * never flagged even if UA spoofing is in play.
 */
const IS_MOBILE = (
  /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent) ||
  window.matchMedia('(pointer: coarse)').matches
);

/**
 * HOW LANDSCAPE ENFORCEMENT WORKS
 * ─────────────────────────────────────────────
 * checkOrientation() compares window.innerWidth vs window.innerHeight.
 *   • portrait  (width < height) → show #rotate-overlay, hide canvas + touch controls
 *   • landscape (width >= height) → hide overlay, show canvas + touch controls
 *
 * It is called:
 *   1. Once at startup (inside initMobile)
 *   2. On window 'resize' (covers browser chrome show/hide on mobile)
 *   3. On screen.orientation 'change' (covers physical device rotation)
 *
 * On desktop IS_MOBILE is false so checkOrientation is never wired up
 * and the overlay is never shown.
 */
function checkOrientation() {
  const isPortrait = window.innerWidth < window.innerHeight;
  const overlay    = document.getElementById('rotate-overlay');
  const canvas     = document.getElementById('cvs');
  const touchCtrl  = document.getElementById('touch-controls');

  if (isPortrait) {
    overlay.classList.add('show');
    // Hide game canvas and touch UI while portrait
    if (canvas.style.display !== 'none') canvas.dataset.wasVisible = 'true';
    canvas.style.display    = 'none';
    touchCtrl.classList.remove('active');
  } else {
    overlay.classList.remove('show');
    // Restore canvas only if the game has started
    if (gameStarted || canvas.dataset.wasVisible) {
      canvas.style.display = 'block';
    }
    if (gameStarted) touchCtrl.classList.add('active');
  }
}

// ── Touch input state ──
// These values are READ by updateMovement() each frame,
// exactly the same way keyboard keys are read.
// No changes to the existing movement logic are needed —
// we just populate these instead of `keys`.
const touchInput = {
  // Joystick normalized direction (-1 to +1 on each axis)
  // Populated by joystick touchmove handler
  moveX: 0,   // left/right  (+1 = strafe right)
  moveZ: 0,   // fwd/back    (-1 = forward, mirrors WASD convention)

  // Whether jump was requested this frame (cleared after being consumed)
  jump: false,

  // Aim drag accumulator — consumed each frame in updateMovement()
  aimDeltaX: 0,
  aimDeltaY: 0,

  // Is the fire button held down?
  firing: false,
};

/**
 * HOW TOUCH CONTROLS INTEGRATE WITH THE MOVEMENT SYSTEM
 * ─────────────────────────────────────────────────────
 * updateMovement() (defined earlier) reads `keys['KeyW']` etc.
 * We patch it to ALSO read touchInput so both code paths feed
 * into the same physics + server-send logic.
 *
 * Specifically:
 *   • touchInput.moveX / moveZ  replace the keyboard mx/mz values
 *   • touchInput.aimDeltaX/Y    are applied to camYaw/camPitch each frame
 *   • touchInput.firing         calls doShoot() on an interval
 *   • touchInput.jump           sets the 'Space' equivalent for one frame
 *
 * The server never knows whether input came from touch or keyboard —
 * it only receives normalized vx/vz + yaw/pitch via socket.emit('mv').
 * Multiplayer is completely unaffected.
 */

// ── Joystick tracking ──
let joystickTouchId   = null;   // the Touch.identifier locked to the joystick
let joystickOriginX   = 0;      // center of joystick zone in page coords
let joystickOriginY   = 0;
const JOYSTICK_RADIUS = 55;     // max knob travel in px

// ── Aim drag tracking ──
let aimTouchId   = null;
let aimLastX     = 0;
let aimLastY     = 0;

// Touch sensitivity for aiming (radians per pixel)
// Slightly higher than mouse MOUSE_SENS to feel comfortable with a thumb
const TOUCH_AIM_SENS_X = 0.006;
const TOUCH_AIM_SENS_Y = 0.005;

// Auto-fire interval handle (fire held while btn-shoot is pressed)
let touchFireInterval = null;

function initMobile() {
  if (!IS_MOBILE) return;   // ← desktop: skip everything

  // ── Show touch controls ──
  document.getElementById('touch-controls').classList.add('active');

  // ── Hide pointer-lock "click to play" — not needed on mobile ──
  document.getElementById('click-to-play').classList.remove('vis');
  // Prevent it from reappearing (pointer lock events don't fire on mobile)
  document.addEventListener('pointerlockchange', () => {
    if (IS_MOBILE) document.getElementById('click-to-play').classList.remove('vis');
  });

  // ── Wire orientation check ──
  checkOrientation();
  window.addEventListener('resize', checkOrientation);
  if (screen.orientation) {
    screen.orientation.addEventListener('change', checkOrientation);
  } else {
    // Older iOS fallback
    window.addEventListener('orientationchange', () => {
      setTimeout(checkOrientation, 120); // brief delay for layout to settle
    });
  }

  // ── JOYSTICK ──
  const joystickZone = document.getElementById('joystick-zone');
  const joystickKnob = document.getElementById('joystick-knob');

  joystickZone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (joystickTouchId !== null) return;  // already tracking one finger
    const t = e.changedTouches[0];
    joystickTouchId = t.identifier;
    const rect = joystickZone.getBoundingClientRect();
    joystickOriginX = rect.left + rect.width  / 2;
    joystickOriginY = rect.top  + rect.height / 2;
    updateJoystick(t.clientX, t.clientY);
  }, { passive: false });

  joystickZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joystickTouchId) {
        updateJoystick(t.clientX, t.clientY);
      }
    }
  }, { passive: false });

  joystickZone.addEventListener('touchend', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === joystickTouchId) {
        joystickTouchId = null;
        touchInput.moveX = 0;
        touchInput.moveZ = 0;
        // Snap knob back to center
        joystickKnob.style.transform = 'translate(-50%, -50%)';
      }
    }
  }, { passive: false });

  joystickZone.addEventListener('touchcancel', () => {
    joystickTouchId = null;
    touchInput.moveX = 0;
    touchInput.moveZ = 0;
    joystickKnob.style.transform = 'translate(-50%, -50%)';
  });

  function updateJoystick(clientX, clientY) {
    let dx = clientX - joystickOriginX;
    let dy = clientY - joystickOriginY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Clamp to joystick radius
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }

    // Normalize to -1..+1 and write into touchInput
    touchInput.moveX =  dx / JOYSTICK_RADIUS;   // +1 = right
    touchInput.moveZ =  dy / JOYSTICK_RADIUS;   // +1 = back (matches -mz = forward)

    // Move knob visually (offset from CSS centered start position)
    joystickKnob.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // ── AIM ZONE (drag-to-look) ──
  const aimZone = document.getElementById('aim-zone');

  aimZone.addEventListener('touchstart', e => {
    e.preventDefault();
    if (aimTouchId !== null) return;
    const t = e.changedTouches[0];
    aimTouchId = t.identifier;
    aimLastX   = t.clientX;
    aimLastY   = t.clientY;
  }, { passive: false });

  aimZone.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === aimTouchId) {
        // Accumulate delta — applied in updateMovement() each frame
        touchInput.aimDeltaX += (t.clientX - aimLastX);
        touchInput.aimDeltaY += (t.clientY - aimLastY);
        aimLastX = t.clientX;
        aimLastY = t.clientY;
      }
    }
  }, { passive: false });

  aimZone.addEventListener('touchend', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === aimTouchId) aimTouchId = null;
    }
  }, { passive: false });

  aimZone.addEventListener('touchcancel', () => { aimTouchId = null; });

  // ── SHOOT BUTTON ──
  const btnShoot = document.getElementById('btn-shoot');

  btnShoot.addEventListener('touchstart', e => {
    e.preventDefault();
    btnShoot.classList.add('pressed');
    touchInput.firing = true;
    doShoot();  // fire immediately on press
    touchFireInterval = setInterval(doShoot, 90);
  }, { passive: false });

  const stopFire = () => {
    touchInput.firing = false;
    btnShoot.classList.remove('pressed');
    clearInterval(touchFireInterval);
    touchFireInterval = null;
  };
  btnShoot.addEventListener('touchend',   e => { e.preventDefault(); stopFire(); }, { passive: false });
  btnShoot.addEventListener('touchcancel', stopFire);

  // ── RELOAD BUTTON ──
  const btnReload = document.getElementById('btn-reload-mobile');

  btnReload.addEventListener('touchstart', e => {
    e.preventDefault();
    btnReload.classList.add('pressed');
    // Mirror the keyboard 'R' reload logic exactly
    if (!local.reloading && local.ammo < local.maxAmmo) {
      socket.emit('reload');
      local.reloading  = true;
      reloadStart      = performance.now();
      reloadDuration   = CHARS[myChar]?.reloadMs || 1500;
      updateReloadBar();
    }
  }, { passive: false });

  btnReload.addEventListener('touchend',    e => { e.preventDefault(); btnReload.classList.remove('pressed'); }, { passive: false });
  btnReload.addEventListener('touchcancel', () => btnReload.classList.remove('pressed'));

  // ── JUMP BUTTON ──
  const btnJump = document.getElementById('btn-jump-mobile');

  btnJump.addEventListener('touchstart', e => {
    e.preventDefault();
    btnJump.classList.add('pressed');
    touchInput.jump = true;   // consumed by updateMovement() next frame
  }, { passive: false });

  btnJump.addEventListener('touchend', e => {
    e.preventDefault();
    btnJump.classList.remove('pressed');
  }, { passive: false });

  btnJump.addEventListener('touchcancel', () => {
    btnJump.classList.remove('pressed');
  });
}

// ═══════════════════════════════════════════════
// RENDER LOOP
// ═══════════════════════════════════════════════
const clock = new THREE.Clock();

// Recoil spring back
function updateRecoil() {
  if (!viewModel) return;
  viewModel.rotation.x = THREE.MathUtils.lerp(viewModel.rotation.x, 0,   0.18);
  viewModel.position.z = THREE.MathUtils.lerp(viewModel.position.z, -0.35, 0.18);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05); // cap at 50ms to avoid spiral

  if (gameStarted) {
    updateMovement(dt);
    applyScreenShake();
    updateRecoil();
  }

  renderer.render(scene, camera);
}

animate();

// Run an early orientation check so mobile users in portrait
// see the rotate overlay immediately, even before the game starts.
if (IS_MOBILE) checkOrientation();
