/**
 * CE Strike 3D - Game Server
 * ─────────────────────────────────────────────
 * Architecture:
 *   • 60Hz physics loop  — moves players, checks collisions
 *   • 20Hz broadcast     — sends compact state to all clients
 *   • Velocity-based input — client sends direction, server moves player
 *
 * HOW TO ADD MORE PLAYERS:
 *   Just open more browser tabs — each connection spawns a new player.
 *
 * HOW TO ADD WEAPONS:
 *   Add entries to WEAPONS below, then handle in the 'shoot' event.
 *
 * HOW TO ADD MAP OBJECTS:
 *   Add to MAP_BOXES array — each box is { x,y,z, w,h,d }.
 */

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 8000,
  pingTimeout:  4000,
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const PHYSICS_HZ   = 60;
const BROADCAST_HZ = 20;

const MAP_W = 80;   // map half-extents (world units)
const MAP_D = 80;

const GRAVITY    = -28;
const JUMP_FORCE =  10;
const PLAYER_H   =  1.8;  // eye height
const PLAYER_R   =  0.4;  // collision radius

const WINS_REQUIRED = 15;
const RESPAWN_MS    = 3000;
const BULLET_SPEED  = 40;
const BULLET_MAX_DIST = 120;

// ─────────────────────────────────────────────
// CHARACTER STATS
// TO ADD A CHARACTER: add a new entry here with a unique key.
// ─────────────────────────────────────────────
const CHARACTERS = {
  Andree:  { color: 0x00e5ff, maxHp: 100, speed: 7,   damage: 22, reloadMs: 1200, maxAmmo: 12, fireRateMs: 150,  weapon: 'Assault Rifle' },
  Chesney: { color: 0xff6b35, maxHp: 140, speed: 5.5, damage: 45, reloadMs: 2200, maxAmmo: 6,  fireRateMs: 600,  weapon: 'Shotgun'       },
  Denver:  { color: 0xb5ff4d, maxHp: 80,  speed: 9,   damage: 15, reloadMs: 800,  maxAmmo: 20, fireRateMs: 80,   weapon: 'SMG'           },
  Fischer: { color: 0xe040fb, maxHp: 90,  speed: 6,   damage: 70, reloadMs: 2500, maxAmmo: 5,  fireRateMs: 1000, weapon: 'Sniper'        },
  Maybelle:{ color: 0xffeb3b, maxHp: 110, speed: 6.5, damage: 30, reloadMs: 1500, maxAmmo: 8,  fireRateMs: 400,  weapon: 'Revolver'      }
};

// ─────────────────────────────────────────────
// MAP GEOMETRY
// Used for bullet and player collision on the server.
// TO ADD MAP OBJECTS: push to MAP_BOXES.
// Each box: { x, y, z, w, h, d }  (world center + half-extents)
// ─────────────────────────────────────────────
const MAP_BOXES = [
  // Outer walls (thin, just for bullet clipping)
  { x: 0,    y: 3, z:  MAP_D,  w: MAP_W,  h: 6,  d: 1   },  // north wall
  { x: 0,    y: 3, z: -MAP_D,  w: MAP_W,  h: 6,  d: 1   },  // south wall
  { x:  MAP_W, y: 3, z: 0,     w: 1,      h: 6,  d: MAP_D }, // east wall
  { x: -MAP_W, y: 3, z: 0,     w: 1,      h: 6,  d: MAP_D }, // west wall

  // Center bunker
  { x: 0,    y: 1,  z: 0,    w: 6,  h: 2,  d: 6  },

  // Mid-left cover boxes
  { x: -20,  y: 1,  z: 10,   w: 4,  h: 2,  d: 2  },
  { x: -20,  y: 1,  z: -10,  w: 4,  h: 2,  d: 2  },
  { x: -35,  y: 1.5,z: 0,    w: 2,  h: 3,  d: 8  },

  // Mid-right cover boxes
  { x: 20,   y: 1,  z: 10,   w: 4,  h: 2,  d: 2  },
  { x: 20,   y: 1,  z: -10,  w: 4,  h: 2,  d: 2  },
  { x: 35,   y: 1.5,z: 0,    w: 2,  h: 3,  d: 8  },

  // Sniper towers
  { x: -50,  y: 2,  z: -50,  w: 4,  h: 4,  d: 4  },
  { x:  50,  y: 2,  z: -50,  w: 4,  h: 4,  d: 4  },
  { x: -50,  y: 2,  z:  50,  w: 4,  h: 4,  d: 4  },
  { x:  50,  y: 2,  z:  50,  w: 4,  h: 4,  d: 4  },

  // Low walls across middle
  { x: -10,  y: 0.75, z: -30, w: 3, h: 1.5, d: 10 },
  { x:  10,  y: 0.75, z:  30, w: 3, h: 1.5, d: 10 },

  // Ramp-style platforms
  { x: -50,  y: 0.5, z: 0,   w: 6,  h: 1,  d: 12 },
  { x:  50,  y: 0.5, z: 0,   w: 6,  h: 1,  d: 12 },
];

// Spawn points (x, z — y is always 0)
const SPAWN_POINTS = [
  { x: -60, z: -60 }, { x:  60, z: -60 },
  { x: -60, z:  60 }, { x:  60, z:  60 },
  { x:   0, z: -65 }, { x:   0, z:  65 },
  { x: -65, z:   0 }, { x:  65, z:   0 },
];

// ─────────────────────────────────────────────
// GAME STATE
// ─────────────────────────────────────────────
let players  = {};
let bullets  = {};
let bulletId = 0;
let gameOver = false;
let winner   = null;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function randomSpawn() {
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}

// AABB vs point (for bullet hit on boxes)
function pointInBox(px, py, pz, box) {
  return Math.abs(px - box.x) <= box.w &&
         Math.abs(py - box.y) <= box.h &&
         Math.abs(pz - box.z) <= box.d;
}

// Simple ray-AABB intersection (slab method) for bullet travel
function rayHitsBox(ox, oy, oz, dx, dy, dz, box, maxDist) {
  const bx = box.x, by = box.y, bz = box.z;
  const bw = box.w, bh = box.h, bd = box.d;
  let tmin = 0, tmax = maxDist;
  for (const [o, d, b, e] of [[ox,dx,bx,bw],[oy,dy,by,bh],[oz,dz,bz,bd]]) {
    if (Math.abs(d) < 1e-8) {
      if (Math.abs(o - b) > e) return false;
    } else {
      const t1 = (b - e - o) / d, t2 = (b + e - o) / d;
      tmin = Math.max(tmin, Math.min(t1, t2));
      tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) return false;
    }
  }
  return tmax >= tmin;
}

// Cylinder-AABB collision (XZ plane only, for player movement)
function playerCollidesBox(px, py, pz, box) {
  // Only collide if player vertically overlaps box
  if (py + PLAYER_H < box.y - box.h || py > box.y + box.h) return false;
  const cx = Math.max(box.x - box.w, Math.min(px, box.x + box.w));
  const cz = Math.max(box.z - box.d, Math.min(pz, box.z + box.d));
  const dx = px - cx, dz = pz - cz;
  return dx * dx + dz * dz < PLAYER_R * PLAYER_R;
}

function resolvePlayerCollisions(p) {
  for (const box of MAP_BOXES) {
    if (!playerCollidesBox(p.x, p.y, p.z, box)) continue;

    // Check if player can step on top
    if (p.y < box.y + box.h && p.vy <= 0) {
      p.y = box.y + box.h;
      p.vy = 0; p.onGround = true;
      continue;
    }

    // Push out horizontally
    const dx = p.x - box.x, dz = p.z - box.z;
    const overlapX = box.w + PLAYER_R - Math.abs(dx);
    const overlapZ = box.d + PLAYER_R - Math.abs(dz);
    if (overlapX < overlapZ) {
      p.x += overlapX * Math.sign(dx);
      p.vx = 0;
    } else {
      p.z += overlapZ * Math.sign(dz);
      p.vz = 0;
    }
  }
}

// ─────────────────────────────────────────────
// PHYSICS LOOP — 60Hz
// ─────────────────────────────────────────────
const dt = 1 / PHYSICS_HZ;

setInterval(() => {
  if (gameOver) return;

  // ── Move players ──
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;

    // Apply input velocity (horizontal only, client sends normalized direction)
    const spd = p.speed;
    // vx/vz are from client input (already normalized * speed applied server-side)
    p.x += p.vx * dt;
    p.z += p.vz * dt;

    // Gravity
    p.vy += GRAVITY * dt;
    p.y  += p.vy * dt;

    // Floor
    p.onGround = false;
    if (p.y <= 0) { p.y = 0; p.vy = 0; p.onGround = true; }

    // Map boundary clamp
    p.x = Math.max(-MAP_W + PLAYER_R, Math.min(MAP_W - PLAYER_R, p.x));
    p.z = Math.max(-MAP_D + PLAYER_R, Math.min(MAP_D - PLAYER_R, p.z));

    // Box collisions
    resolvePlayerCollisions(p);
  }

  // ── Update bullets ──
  for (const id in bullets) {
    const b = bullets[id];
    b.x += b.dx * BULLET_SPEED * dt;
    b.y += b.dy * BULLET_SPEED * dt;
    b.z += b.dz * BULLET_SPEED * dt;
    b.dist += BULLET_SPEED * dt;

    // Out of bounds or max distance
    if (b.dist > BULLET_MAX_DIST ||
        Math.abs(b.x) > MAP_W + 5 || Math.abs(b.z) > MAP_D + 5 || b.y < -2 || b.y > 30) {
      delete bullets[id]; continue;
    }

    // Hit a map box
    let hitBox = false;
    for (const box of MAP_BOXES) {
      if (pointInBox(b.x, b.y, b.z, box)) { hitBox = true; break; }
    }
    if (hitBox) { delete bullets[id]; continue; }

    // Hit a player
    let hitPlayer = false;
    for (const pid in players) {
      const p = players[pid];
      if (pid === b.ownerId || !p.alive) continue;
      const dx = p.x - b.x, dy = (p.y + PLAYER_H / 2) - b.y, dz = p.z - b.z;
      if (dx*dx + dy*dy + dz*dz < 0.8 * 0.8) {
        // Hit!
        p.health -= b.damage;
        io.to(pid).emit('hit', { health: Math.max(0, p.health) });
        hitPlayer = true;

        if (p.health <= 0) {
          p.health = 0; p.alive = false;
          const shooter = players[b.ownerId];
          if (shooter) {
            shooter.kills++;
            io.emit('kill_feed', {
              killer: shooter.name, victim: p.name,
              killerChar: shooter.character
            });
            if (shooter.kills >= WINS_REQUIRED) {
              gameOver = true; winner = shooter.name;
              io.emit('game_over', { winner: shooter.name, character: shooter.character });
            }
          }
          const deadId = pid;
          setTimeout(() => {
            if (!players[deadId]) return;
            const sp = randomSpawn();
            Object.assign(players[deadId], {
              x: sp.x, y: 0, z: sp.z,
              vx: 0, vy: 0, vz: 0,
              health: players[deadId].maxHp,
              alive: true, ammo: players[deadId].maxAmmo
            });
            io.emit('respawn', { id: deadId });
          }, RESPAWN_MS);
        }
        delete bullets[id]; break;
      }
    }
    if (hitPlayer) continue;
  }

}, 1000 / PHYSICS_HZ);

// ─────────────────────────────────────────────
// BROADCAST LOOP — 20Hz  (compact state)
// ─────────────────────────────────────────────
setInterval(() => {
  if (gameOver) return;

  // Pack players into compact arrays to minimize payload
  const pArr = Object.values(players).map(p => ({
    id: p.id,
    x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
    yaw: +p.yaw.toFixed(3),     // horizontal look direction
    pitch: +p.pitch.toFixed(3), // vertical look (for other player models)
    hp: p.health | 0,
    maxHp: p.maxHp,
    alive: p.alive,
    kills: p.kills,
    ammo: p.ammo,
    maxAmmo: p.maxAmmo,
    reloading: p.reloading,
    name: p.name,
    character: p.character,
    color: p.color,
    onGround: p.onGround
  }));

  const bArr = Object.values(bullets).map(b => ({
    id: b.id,
    x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2),
    color: b.color
  }));

  io.emit('gs', { players: pArr, bullets: bArr });

}, 1000 / BROADCAST_HZ);

// ─────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] Connected: ${socket.id}`);

  // Send map geometry so client can build the scene
  socket.emit('map_data', {
    boxes: MAP_BOXES,
    mapW: MAP_W,
    mapD: MAP_D,
    characters: CHARACTERS
  });

  // ── JOIN ──
  socket.on('join', ({ name, character }) => {
    if (!CHARACTERS[character]) {
      character = Object.keys(CHARACTERS)[0];
    }
    const ch = CHARACTERS[character];
    const sp = randomSpawn();

    players[socket.id] = {
      id: socket.id,
      name: (name || 'Soldier').substring(0, 16),
      character,
      color: ch.color,
      x: sp.x, y: 0, z: sp.z,
      vx: 0, vy: 0, vz: 0,
      yaw: 0, pitch: 0,
      speed: ch.speed,
      health: ch.maxHp, maxHp: ch.maxHp,
      damage: ch.damage,
      fireRateMs: ch.fireRateMs,
      reloadMs: ch.reloadMs,
      maxAmmo: ch.maxAmmo,
      ammo: ch.maxAmmo,
      lastShot: 0,
      alive: true,
      kills: 0,
      reloading: false,
      onGround: true
    };

    console.log(`  > ${name} joined as ${character}`);
    socket.emit('joined', { id: socket.id, mapData: { boxes: MAP_BOXES, mapW: MAP_W, mapD: MAP_D } });
    io.emit('player_joined', { name, character });
  });

  // ── MOVEMENT INPUT ──
  // Client sends normalized direction vector + look angles
  socket.on('mv', ({ vx, vz, yaw, pitch, jump }) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;

    // Normalize and apply speed
    const len = Math.sqrt(vx * vx + vz * vz);
    if (len > 0) {
      p.vx = (vx / len) * p.speed;
      p.vz = (vz / len) * p.speed;
    } else {
      p.vx = 0; p.vz = 0;
    }

    p.yaw   = yaw;
    p.pitch = pitch;

    // Jump
    if (jump && p.onGround) {
      p.vy = JUMP_FORCE;
      p.onGround = false;
    }
  });

  // ── SHOOT ──
  socket.on('shoot', ({ dx, dy, dz }) => {
    const p = players[socket.id];
    if (!p || !p.alive || p.reloading || p.ammo <= 0) return;
    const now = Date.now();
    if (now - p.lastShot < p.fireRateMs) return;

    p.lastShot = now;
    p.ammo--;

    // Shotgun fires multiple pellets
    const isChesney = p.character === 'Chesney';
    const pellets   = isChesney ? 6 : 1;
    const spread    = isChesney ? 0.08 : 0;

    for (let i = 0; i < pellets; i++) {
      const sdx = dx + (Math.random() - 0.5) * spread;
      const sdy = dy + (Math.random() - 0.5) * spread;
      const sdz = dz + (Math.random() - 0.5) * spread;
      const len = Math.sqrt(sdx*sdx + sdy*sdy + sdz*sdz) || 1;

      bullets[bulletId] = {
        id: bulletId++,
        ownerId: socket.id,
        x: p.x + dx * 1.2,
        y: p.y + PLAYER_H * 0.85,
        z: p.z + dz * 1.2,
        dx: sdx / len, dy: sdy / len, dz: sdz / len,
        damage: isChesney ? p.damage / pellets : p.damage,
        color: p.color,
        dist: 0
      };
    }

    if (p.ammo <= 0) startReload(socket.id);
  });

  // ── RELOAD ──
  socket.on('reload', () => {
    const p = players[socket.id];
    if (!p || p.reloading || p.ammo >= p.maxAmmo) return;
    startReload(socket.id);
  });

  // ── NEW GAME ──
  socket.on('new_game', () => {
    if (!gameOver) return;
    gameOver = false; winner = null; bullets = {};
    for (const id in players) {
      const sp = randomSpawn();
      Object.assign(players[id], {
        x: sp.x, y: 0, z: sp.z,
        vx: 0, vy: 0, vz: 0,
        health: players[id].maxHp, alive: true,
        kills: 0, ammo: players[id].maxAmmo, reloading: false
      });
    }
    io.emit('game_reset');
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) io.emit('player_left', { name: p.name });
    delete players[socket.id];
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

function startReload(id) {
  const p = players[id];
  if (!p) return;
  p.reloading = true;
  setTimeout(() => {
    if (!players[id]) return;
    players[id].ammo = players[id].maxAmmo;
    players[id].reloading = false;
    io.to(id).emit('reload_done');
  }, p.reloadMs);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 CE Strike 3D → http://localhost:${PORT}\n`);
});
