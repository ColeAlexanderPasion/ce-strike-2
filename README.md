# CE Strike 3D

A 3D multiplayer browser FPS built with **Three.js** + **Socket.io** + **Node.js**.

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000 in multiple browser tabs
```

## Deploy to Render

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New Web Service
3. Connect your repo
4. Build command: `npm install`
5. Start command: `node server.js`
6. Done — share the URL with friends!

## Controls

| Key | Action |
|-----|--------|
| `WASD` / `Arrow Keys` | Move |
| `Mouse` | Aim (after clicking to capture) |
| `Left Click` | Shoot |
| `Space` | Jump |
| `R` | Reload |
| `Esc` | Release mouse |

## Folder Structure

```
ce-strike-3d/
├── server.js          ← Node.js game server (physics, multiplayer)
├── package.json
└── public/
    ├── index.html     ← Lobby UI + HUD
    └── client.js      ← Three.js 3D renderer + game client
```

## How to Expand

### Add a new character
In `server.js`, add to the `CHARACTERS` object:
```js
NewHero: { color: 0xff0088, maxHp: 120, speed: 7, damage: 25,
           reloadMs: 1400, maxAmmo: 10, fireRateMs: 200, weapon: 'Pistol' }
```
Then add the same entry to `CHARS` in `client.js`.

### Add a new weapon
In `client.js`, add a `case` to `buildWeaponMesh()` and `buildViewModel()`.

### Add map objects
In `server.js`, push to `MAP_BOXES`:
```js
{ x: 10, y: 1, z: 20, w: 3, h: 2, d: 3 }
// x,y,z = world center   w,h,d = half-extents
```
The client reads map geometry from the server on connect — no client changes needed.

### Switch to third-person camera
In `client.js`, change:
```js
const CAMERA_MODE = 'third';
```
