# EMBERLINE — Depot Strike

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/kamensr/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/kamensr/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in the browser, built for [make.fun](https://make.fun/bounty/threejs-fps-02)'s best three.js tactical FPS bounty. You are Vanguard, attacking Depot 7 with three bot teammates against four Warden defenders. Plant the charge at SILO or YARD — or wipe the enemy team. Win rounds, earn money, buy better guns. First to 8 takes the depot.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Any static file server works — the game is plain ES modules under `game/`, no build step, no network requests, three.js 0.187.0 vendored.

## Play it

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (pointer lock) · Click — fire |
| R | Reload |
| Ctrl / C | Crouch |
| Space | Jump |
| E (hold) | Plant / defuse the charge |
| B | Buy menu (buy phase) |
| 1 / 2 / wheel | Primary / sidearm |
| G | Frag grenade |
| T | Smoke grenade |
| Right-click | Sniper scope |

Stopping to aim beats spraying on the move: spread grows with speed and shrinks while crouched, and headshots deal triple damage.

## What's in the game

- **Complete rounds:** buy phase, 100-second rounds, elimination / time / detonation / defuse wins, first to 8, match end and restart.
- **Economy:** $800 start, $300 per kill, $3,000 round win / $1,500 loss, four guns (pistol, SMG, rifle, sniper) plus frag and smoke grenades in a buy menu.
- **Gunplay:** hitscan raycasts against bodies with headshot bonus, recoil, movement-punishing spread, acceleration-based movement, crouch, jump, AABB collision.
- **Bots:** seven of them on a waypoint graph — they run lanes, hold sites, see (raycast line of sight + field of view + reaction delay), hear gunfire, investigate noise, fetch a dropped charge, plant and defuse.
- **The map:** Depot 7, an original compact 3-lane map — west/east lanes to two bomb sites, a mid lane split by a wide control block, a cross corridor, crates and platforms for cover, dusk lighting with fog and site lamps.
- **Sound:** every effect synthesized in WebAudio — gunshots, hits, footsteps, bomb beeps, round stings. No audio files.
- **Code:** one job per module, a fixed 60 Hz simulation kept apart from rendering, one state object, no per-frame allocation in the hot loops.

## Layout

```
game/
  index.html          HUD, overlays, buy menu, import map
  src/
    main.js           boot, fixed-step loop, player input, screenshot modes
    state.js          the one state object, actors, match constants
    world.js          Depot 7: geometry, colliders, waypoint graph, lighting
    player.js         movement: acceleration, friction, crouch, AABB collision
    weapons.js        the arsenal table, spread/damage, view model
    combat.js         hitscan, damage, grenades, smoke, tracers, noise
    bots.js           bot bodies, AI states, sight, hearing, routes
    rounds.js         phase machine, economy, plant/defuse, win conditions
    audio.js          procedural WebAudio effects
    input.js          keyboard, mouse, pointer lock
    hud.js            DOM HUD: health, ammo, timer, score, kill feed
    palette.js        the one colour palette, shared by 3D and HUD
  vendor/three/       three.js 0.187.0, byte for byte from the kit
main.ts               hands the game in: copies game/ + screenshots/, writes dossier.json
```

## Screenshots

The four screenshots in `screenshots/` are real renders of this code in headless Chrome, taken with deterministic setups: `?shot=play`, `?shot=buy`, `?shot=site`, `?shot=end` (each with `&seed=1`).
