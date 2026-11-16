// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js wires the modules together and owns only the wiring:
// player input, the camera, the bomb mesh, the event drain to audio/HUD, and the
// deterministic screenshot setups (?shot=play|buy|site|end with &seed=N).
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, createActor, PHASES, MATCH } from './state.js';
import { createWorld } from './world.js';
import { createMover, look, recoil, groundSpeed, wishFromKeys } from './player.js';
import {
  WEAPONS, spreadFor, canFire, startReload, finishReload,
  createViewModel, giveAmmo,
} from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createRounds, plantTick, defuseTick } from './rounds.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const liveSeed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;

const state = createState(shot ? seed : liveSeed);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 200);
scene.add(camera);

const world = createWorld(scene);
const player = createActor(0, 'YOU', 'van', true);
player.pos.copy(world.spawns.van[0]);
state.actors.push(player);
state.player = player;
giveAmmo(player, 'pistol');

const mover = createMover(world.colliders);
const combat = createCombat(scene, world, state);

// The player has no visible body (first person), so bots need an invisible
// hitbox to shoot at. These two meshes never join the scene — they exist
// only for the raycaster — and their matrices are updated by hand each step.
const playerHitTorso = new THREE.Mesh(
  new THREE.BoxGeometry(0.52, 0.78, 0.3),
  new THREE.MeshBasicMaterial(),
);
playerHitTorso.userData.actor = player;
playerHitTorso.userData.part = 'torso';
const playerHitHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 10, 8),
  new THREE.MeshBasicMaterial(),
);
playerHitHead.userData.actor = player;
playerHitHead.userData.part = 'head';
player.hitMeshes = [playerHitTorso, playerHitHead];

function syncPlayerHitbox() {
  const crouching = player.crouching;
  playerHitTorso.position.set(player.pos.x, player.pos.y + (crouching ? 0.65 : 1.05), player.pos.z);
  playerHitHead.position.set(player.pos.x, player.pos.y + (crouching ? 1.0 : 1.58), player.pos.z);
  playerHitTorso.updateMatrixWorld();
  playerHitHead.updateMatrixWorld();
}
const bots = createBots(scene, world, state, combat, mover);
const viewModel = createViewModel(camera);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

// The charge: a dark case with a blinking lamp, visible when dropped or planted.
const bombMesh = new THREE.Group();
const bombCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.55, 0.3, 0.7),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2d33'), roughness: 0.5, metalness: 0.5 }),
);
bombCase.position.y = 0.15;
bombCase.castShadow = true;
const bombStripe = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.04, 0.12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
bombStripe.position.set(0, 0.31, 0);
const bombLamp = new THREE.Mesh(
  new THREE.BoxGeometry(0.2, 0.1, 0.2),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.war) }),
);
bombLamp.position.set(0, 0.36, 0);
// A small amber glow so a planted or dropped charge reads at a glance,
// in a dark depot, from across the site.
const bombLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 6, 5, 1.8);
bombLight.position.set(0, 0.6, 0);
bombMesh.add(bombCase, bombStripe, bombLamp, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const cameraDir = new THREE.Vector3();
const wish = { x: 0, z: 0 };
let paused = false;
let frozen = false;
let started = false;
let wasLocked = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let stepDistance = 0;
let nextBeep = 0;
let lastHealth = 100;

function respawn() {
  const died = !player.alive;
  player.pos.copy(world.spawns.van[0]);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  player.health = 100;
  player.alive = true;
  player.fall = 0;
  player.spectate = null;
  player.cooldown = 0;
  player.reloadLeft = 0;
  lastHealth = 100;
  if (died) {
    // Death costs the loadout: back to the sidearm, as the buy menu expects.
    player.weapon = 'pistol';
    player.primary = null;
    player.grenades.frag = 0;
    player.grenades.smoke = 0;
    giveAmmo(player, 'pistol');
  }
  viewModel.setWeapon(player.weapon);
  bots.spawnRound(state.round);
  combat.rebuildTargets();
}

const rounds = createRounds(state, {
  respawn,
  clearField: () => combat.clearField(),
});

hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (state.phase === PHASES.MATCH_END) {
    rounds.startMatch();
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  if (!started) {
    started = true;
    rounds.startMatch();
  }
  paused = false;
  hud.hideOverlay();
  input.requestLock();
});

hud.onBuy((itemId) => {
  if (rounds.buy(itemId)) {
    viewModel.setWeapon(player.weapon);
    hud.refreshBuy(state.money);
    hud.sync(state);
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    wasLocked = true;
    hud.hideOverlay();
    paused = false;
  } else if (wasLocked && started && (state.phase === PHASES.BUY || state.phase === PHASES.LIVE)) {
    // Only a lock that was held and then lost pauses the game: a lock request
    // that never landed (a browser that refuses it) must not freeze the match.
    paused = true;
    hud.showBuyMenu(false);
    hud.showOverlay('EMBERLINE', 'Paused. The round waits for you — click to resume.', 'Click to resume');
  }
}

function syncCamera() {
  if (player.alive) {
    camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    return;
  }
  const target = player.spectate;
  if (target && target.alive) {
    camera.position.set(target.pos.x, target.pos.y + target.eye, target.pos.z);
    camera.rotation.set(target.pitch, target.yaw, 0, 'YXZ');
  }
}

function aimAt(point) {
  const dx = point.x - player.pos.x;
  const dy = point.y - (player.pos.y + player.eye);
  const dz = point.z - player.pos.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shootPlayer() {
  const def = WEAPONS[player.weapon];
  const ammo = player.ammo[player.weapon];
  if (!ammo || ammo.mag <= 0) {
    audio.dryFire();
    if (ammo && ammo.reserve > 0) startReload(player);
    return;
  }
  ammo.mag -= 1;
  player.cooldown = 1 / def.rate;
  viewModel.pullTrigger();
  audio.shot(player.weapon);
  const scoped = player.weapon === 'sniper' && input.state.scoped;
  const spread = spreadFor(def, groundSpeed(player), player.crouching) * (scoped ? 0.2 : 1);
  camera.getWorldDirection(cameraDir);
  combat.fireHitscan(player, camera.position, cameraDir, spread);
  recoil(player, def.recoil * (scoped ? 1.4 : 1), (state.random() * 2 - 1) * def.recoil * 0.4);
}

function switchWeapon(id) {
  if (id === 'primary') {
    if (!player.primary) return;
    player.weapon = player.primary;
  } else {
    player.weapon = 'pistol';
  }
  player.reloadLeft = 0;
  viewModel.setWeapon(player.weapon);
}

function throwGrenade(type) {
  if (state.phase !== PHASES.LIVE || !player.alive) return;
  camera.getWorldDirection(cameraDir);
  combat.throwGrenade(player, type, cameraDir);
}

function playerStep(dt) {
  const keys = input.state.keys;
  const pressed = input.state.pressed;
  const phase = state.phase;

  if (player.alive && (phase === PHASES.BUY || phase === PHASES.LIVE)) {
    const lookDelta = input.takeLook();
    look(player, lookDelta.x, lookDelta.y);
    mover.setCrouch(player, keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
    wishFromKeys(keys, player.yaw, wish);
    mover.step(player, dt, wish.x, wish.z, keys.has('Space'));
    const moved = groundSpeed(player) * dt;
    stepDistance += moved;
    if (stepDistance > 2.4 && player.onGround && moved > 0) {
      stepDistance = 0;
      audio.footstep();
    }
  }

  player.cooldown = Math.max(0, player.cooldown - dt);
  if (player.reloadLeft > 0) {
    player.reloadLeft = Math.max(0, player.reloadLeft - dt);
    if (player.reloadLeft === 0) finishReload(player);
  }
  viewModel.step(dt, player.reloadLeft > 0);

  if (!player.alive || phase !== PHASES.LIVE) return;

  // Fire: automatics while held, semi-automatics on a fresh press.
  const def = WEAPONS[player.weapon];
  const firing = input.state.firing;
  const freshPress = firing && !prevFiring;
  prevFiring = firing;
  if ((def.auto && firing) || (!def.auto && freshPress)) {
    if (canFire(player)) shootPlayer();
    else if (player.ammo[player.weapon] && player.ammo[player.weapon].mag === 0 && freshPress) shootPlayer();
  }
  if (pressed.has('KeyR') && startReload(player)) audio.reload();
  if (pressed.has('Digit1')) switchWeapon('primary');
  if (pressed.has('Digit2')) switchWeapon('pistol');
  const wheel = input.takeWheel();
  if (wheel !== 0) switchWeapon(player.weapon === 'pistol' ? 'primary' : 'pistol');
  if (pressed.has('KeyG')) throwGrenade('frag');
  if (pressed.has('KeyT')) throwGrenade('smoke');

  // Sniper scope: right mouse narrows the field of view.
  const scoped = player.weapon === 'sniper' && input.state.scoped;
  if (camera.fov !== (scoped ? 30 : 74)) {
    camera.fov = scoped ? 30 : 74;
    camera.updateProjectionMatrix();
    hud.setScoped(scoped);
  }

  // Plant / defuse: hold E, standing still, in the right place.
  const bomb = state.bomb;
  let channel = null;
  if (keys.has('KeyE')) {
    if (bomb.status === 'carried' && bomb.carrier === 'player') {
      plantTick(state, world, player, dt);
      if (bomb.plant > 0) channel = ['PLANTING THE CHARGE', bomb.plant];
    } else if (bomb.status === 'planted' && player.pos.distanceTo(bomb.pos) < 2.5) {
      defuseTick(state, player, dt);
      if (bomb.defuse > 0) channel = ['DEFUSING', bomb.defuse];
    }
  }
  hud.showChannel(!!channel, channel ? channel[0] : '', channel ? channel[1] : 0);

  // Context hint: what E would do here, if anything.
  let hint = '';
  if (bomb.status === 'carried' && bomb.carrier === 'player') {
    for (const key of ['A', 'B']) {
      if (player.pos.distanceTo(world.sites[key].center) < world.sites[key].radius) {
        hint = `Hold E to plant at Site ${key} (${world.sites[key].name})`;
      }
    }
  } else if (bomb.status === 'planted' && player.pos.distanceTo(bomb.pos) < 2.5) {
    hint = 'Hold E to defuse';
  } else if (bomb.status === 'dropped') {
    hint = 'The charge is dropped — walk over it to pick it up';
  }
  hud.setHint(hint);
}

function buyStep() {
  const pressed = input.state.pressed;
  if (state.phase !== PHASES.BUY) return;
  if (pressed.has('KeyB')) {
    const menu = document.getElementById('buy-menu');
    const open = menu.hidden;
    hud.showBuyMenu(open);
    if (open) hud.refreshBuy(state.money);
    return;
  }
  if (document.getElementById('buy-menu').hidden) return;
  const buyKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
  const ids = ['smg', 'rifle', 'sniper', 'frag', 'smoke'];
  for (let i = 0; i < buyKeys.length; i += 1) {
    if (pressed.has(buyKeys[i]) && rounds.buy(ids[i])) {
      viewModel.setWeapon(player.weapon);
      hud.refreshBuy(state.money);
      hud.sync(state);
    }
  }
}

function drainEvents() {
  for (const event of state.events) {
    switch (event.type) {
      case 'hit':
        audio.hit(event.head);
        hud.hitMarker(false);
        break;
      case 'kill':
        if (event.byPlayer) {
          audio.kill();
          hud.hitMarker(true);
        }
        if (event.victim === 'YOU') {
          audio.hurt();
          hud.damageFlash();
          for (const actor of state.actors) {
            if (actor.team === 'van' && actor.alive && !actor.isPlayer) {
              player.spectate = actor;
              break;
            }
          }
          hud.setHint(player.spectate ? `Spectating ${player.spectate.name} — next round you are back` : 'All of Vanguard is down');
        }
        break;
      case 'botShot': {
        const dx = event.x - player.pos.x;
        const dz = event.z - player.pos.z;
        if (dx * dx + dz * dz < 30 * 30) audio.shot(event.weapon, true);
        break;
      }
      case 'throw':
        audio.tick();
        break;
      case 'explosion':
        audio.explosion();
        break;
      case 'planted':
        audio.beep(true);
        hud.showBanner('CHARGE PLANTED', `Site ${event.site} — Warden has ${MATCH.BOMB_TIME} seconds`, 3000);
        break;
      case 'defused':
        hud.showBanner('CHARGE DEFUSED', `${event.by} cut it in time`, 3000);
        break;
      case 'detonated':
        audio.explosion();
        hud.showBanner('DETONATION', `Site ${event.site} is gone`, 3000);
        break;
      case 'bombDropped':
        hud.showBanner('CHARGE DROPPED', 'Pick it up before the Warden camps it', 2200);
        break;
      case 'pickup':
        hud.showBanner('CHARGE RECOVERED', `${event.name} has it`, 1800);
        break;
      case 'roundStart':
        hud.showBanner(`ROUND ${event.round}`, event.round === 1 ? 'Buy phase — press B for weapons' : 'Buy phase — press B for weapons', 2400);
        hud.showBuyMenu(event.round === 1);
        if (event.round === 1) hud.refreshBuy(state.money);
        break;
      case 'roundLive':
        hud.showBuyMenu(false);
        hud.hideBanner();
        break;
      case 'roundEnd': {
        const won = event.winner === 'van';
        hud.showBanner(won ? 'VANGUARD WINS THE ROUND' : 'WARDEN WINS THE ROUND', `${event.reason} · ${event.score.van} — ${event.score.war}`, 3400);
        if (won) audio.roundWin();
        else audio.roundLose();
        hud.showBuyMenu(false);
        break;
      }
      case 'matchEnd': {
        const won = event.winner === 'van';
        hud.showOverlay(
          won ? 'VANGUARD TAKES DEPOT 7' : 'WARDEN HOLDS DEPOT 7',
          `Final score ${state.score.van} — ${state.score.war}. ${won ? 'The depot is yours.' : 'The depot stays theirs.'}`,
          'Play again',
        );
        if (document.pointerLockElement) document.exitPointerLock();
        break;
      }
      case 'buy':
        audio.buy();
        break;
      default:
        break;
    }
  }
  state.events.length = 0;
}

function step(dt) {
  if (paused) {
    input.endFrame();
    return;
  }
  state.time += dt;
  rounds.step(dt);
  buyStep();
  playerStep(dt);
  syncPlayerHitbox();
  bots.step(dt);
  combat.step(dt);
  // Non-lethal damage on the player still needs feedback: a thud and a flash.
  if (player.alive && player.health < lastHealth) {
    audio.hurt();
    hud.damageFlash();
  }
  lastHealth = player.health;
  drainEvents();
  // Crosshair gap follows the live spread: still is tight, moving is wide.
  const def = WEAPONS[player.weapon];
  const spread = spreadFor(def, groundSpeed(player), player.crouching);
  hud.setCrosshairGap(4 + spread * 260);
  hud.sync(state);
  input.endFrame();
}

function syncBombMesh(now) {
  const bomb = state.bomb;
  bombMesh.visible = bomb.status === 'dropped' || bomb.status === 'planted';
  if (!bombMesh.visible) return;
  bombMesh.position.copy(bomb.pos);
  const urgent = bomb.status === 'planted' && bomb.timer < 10;
  bombLamp.visible = Math.floor(now / (urgent ? 150 : 400)) % 2 === 0;
  if (bomb.status === 'planted' && now >= nextBeep) {
    const interval = 250 + (bomb.timer / MATCH.BOMB_TIME) * 750;
    nextBeep = now + interval;
    audio.beep(urgent);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    if (state.phase === PHASES.MENU) {
      // Menu backdrop: a slow orbit over the depot, the map selling itself.
      const t = now / 1000;
      camera.position.set(Math.sin(t * 0.05) * 26, 24, Math.cos(t * 0.05) * 26);
      camera.lookAt(0, 0, -4);
    } else {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < 5) {
        step(FIXED_STEP);
        accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (accumulator > FIXED_STEP * 5) accumulator = 0;
      syncCamera();
    }
    // Bomb lamp blinks faster as the timer runs down; beeps match it.
    syncBombMesh(now);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  rounds.startMatch();
  // The round-start event would open the buy menu and banner for round 1; the
  // shot sets its own scene, so drop it.
  state.events.length = 0;
  hud.showBuyMenu(false);
  hud.hideBanner();
  if (name === 'buy') {
    state.money = 3200;
    hud.showBuyMenu(true);
    hud.refreshBuy(state.money);
    player.pos.set(0, 0, 17);
    player.yaw = 0;
    player.pitch = 0;
    settle(20);
  } else if (name === 'site') {
    state.phase = PHASES.LIVE;
    state.score.van = 4;
    state.score.war = 3;
    state.round = 8;
    const bomb = state.bomb;
    bomb.status = 'planted';
    bomb.site = 'A';
    bomb.pos.set(-24, 0, -12);
    bomb.timer = 28;
    player.pos.set(-27, 0, -6);
    player.weapon = 'rifle';
    player.primary = 'rifle';
    giveAmmo(player, 'rifle');
    viewModel.setWeapon('rifle');
    const defender = state.actors.find((a) => a.name === 'HAVOC');
    if (defender) {
      defender.pos.set(-19, 0, -15);
      defender.yaw = Math.PI * 0.75;
      defender.mesh.position.copy(defender.pos);
      defender.mesh.rotation.y = defender.yaw;
    }
    settle(10);
    aimAt(new THREE.Vector3(-24, 0.5, -12));
  } else if (name === 'end') {
    state.phase = PHASES.ROUND_END;
    state.score.van = 5;
    state.score.war = 3;
    state.round = 9;
    state.roundTime = 37;
    state.roundWinner = 'van';
    state.roundReason = 'DETONATION';
    state.bomb.status = 'exploded';
    player.pos.set(-20, 0, -8);
    player.weapon = 'rifle';
    player.primary = 'rifle';
    giveAmmo(player, 'rifle');
    viewModel.setWeapon('rifle');
    settle(10);
    aimAt(new THREE.Vector3(-24, 1.2, -12));
    hud.showBanner('VANGUARD WINS THE ROUND', 'DETONATION · 5 — 3', 60000);
  } else {
    // play: mid-round, mid-lane, an enemy in the sights.
    state.phase = PHASES.LIVE;
    state.score.van = 2;
    state.score.war = 1;
    state.round = 3;
    state.money = 2700;
    player.pos.set(0, 0, 12);
    player.weapon = 'rifle';
    player.primary = 'rifle';
    giveAmmo(player, 'rifle');
    viewModel.setWeapon('rifle');
    const enemy = state.actors.find((a) => a.name === 'HAVOC');
    if (enemy) {
      enemy.pos.set(1.5, 0, 2);
      enemy.yaw = Math.PI;
      enemy.mesh.position.copy(enemy.pos);
      enemy.mesh.rotation.y = enemy.yaw;
    }
    const mate = state.actors.find((a) => a.name === 'REX');
    if (mate) {
      mate.pos.set(-3.5, 0, 7);
      mate.yaw = 0;
      mate.mesh.position.copy(mate.pos);
      mate.mesh.rotation.y = mate.yaw;
    }
    settle(10);
    if (enemy) {
      aimAt(new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.2, enemy.pos.z));
      shootPlayer();
      // Let the muzzle flash and tracer expire before the freeze, so the
      // capture shows the hit marker and the scene, not a flash frame.
      settle(5);
      // Hold the hit marker for the capture, but only if the shot landed.
      if (enemy.health < 100) hud.hitMarker(false, 60000);
    }
  }
  hud.sync(state);
  syncBombMesh(performance.now());
  // The capture freezes the lamp on: a blink caught off would hide the charge.
  bombLamp.visible = true;
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

respawn();
syncCamera();
// A read handle for play-testing and debugging: window.__emberline.state is
// the one state object. Nothing in the game reads it back.
window.__emberline = { state };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
