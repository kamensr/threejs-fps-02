// The arsenal: four guns with distinct damage, fire rate, spread, recoil and
// price, plus two grenades. Every number lives in this one table; combat and the
// buy menu read it, never their own copies. Spread grows with movement speed and
// shrinks while crouched, so stopping to aim pays; damage falls off with range.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', slot: 'sidearm', price: 0,
    damage: 34, headMult: 3, rate: 4, auto: false,
    mag: 12, reserve: 48, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, recoil: 0.007, range: 45,
    sound: 'pistol',
  },
  smg: {
    name: 'VK-9 Repeater', slot: 'primary', price: 1200,
    damage: 26, headMult: 3, rate: 11, auto: true,
    mag: 30, reserve: 90, reload: 2.0,
    spreadStill: 0.007, spreadMove: 0.038, recoil: 0.005, range: 38,
    sound: 'smg',
  },
  rifle: {
    name: 'AR-77 Carbine', slot: 'primary', price: 2700,
    damage: 36, headMult: 3, rate: 9, auto: true,
    mag: 30, reserve: 90, reload: 2.2,
    spreadStill: 0.003, spreadMove: 0.03, recoil: 0.009, range: 60,
    sound: 'rifle',
  },
  sniper: {
    name: 'LR-50 Longshot', slot: 'primary', price: 4750,
    damage: 110, headMult: 3, rate: 0.85, auto: false,
    mag: 5, reserve: 15, reload: 3.2,
    spreadStill: 0.0006, spreadMove: 0.05, recoil: 0.05, range: 90,
    sound: 'sniper', scoped: true,
  },
};

export const GRENADES = {
  frag: { name: 'Frag Grenade', price: 300, radius: 7, damage: 120, fuse: 1.5 },
  smoke: { name: 'Smoke Grenade', price: 300, radius: 4.5, duration: 12, fuse: 0.8 },
};

export const BUY_MENU = [
  { id: 'smg', kind: 'weapon' },
  { id: 'rifle', kind: 'weapon' },
  { id: 'sniper', kind: 'weapon' },
  { id: 'frag', kind: 'grenade' },
  { id: 'smoke', kind: 'grenade' },
];

// Spread in radians: still + movement penalty, crouching halves the penalty.
export function spreadFor(weapon, speed, crouching) {
  const move = Math.min(1, speed / 5.2) * weapon.spreadMove;
  return weapon.spreadStill + (crouching ? move * 0.5 : move);
}

// Damage at range: full inside half range, then linear falloff to 50%.
export function damageAt(weapon, distance, head) {
  const half = weapon.range * 0.5;
  const falloff = distance <= half ? 1 : Math.max(0.5, 1 - ((distance - half) / weapon.range));
  const base = weapon.damage * falloff;
  return head ? base * weapon.headMult : base;
}

export function giveAmmo(actor, weaponId) {
  const def = WEAPONS[weaponId];
  actor.ammo[weaponId] = { mag: def.mag, reserve: def.reserve };
}

export function currentWeapon(actor) {
  return WEAPONS[actor.weapon];
}

export function canFire(actor) {
  const ammo = actor.ammo[actor.weapon];
  return actor.alive && ammo && ammo.mag > 0 && actor.cooldown <= 0 && actor.reloadLeft <= 0;
}

export function startReload(actor) {
  const def = WEAPONS[actor.weapon];
  const ammo = actor.ammo[actor.weapon];
  if (!ammo || actor.reloadLeft > 0 || ammo.mag >= def.mag || ammo.reserve <= 0) return false;
  actor.reloadLeft = def.reload;
  actor.reloadWeapon = actor.weapon;
  return true;
}

export function finishReload(actor) {
  const def = WEAPONS[actor.reloadWeapon];
  const ammo = actor.ammo[actor.reloadWeapon];
  if (!def || !ammo) return;
  const take = Math.min(def.mag - ammo.mag, ammo.reserve);
  ammo.mag += take;
  ammo.reserve -= take;
  actor.reloadLeft = 0;
  actor.reloadWeapon = null;
}

// The first-person view model: a box-built gun per weapon, a muzzle flash quad
// and light, kick and reload dip. It is the player's gun only; bots carry theirs
// as a small box on their body mesh.
export function createViewModel(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a'), roughness: 0.5, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.38), grip);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.4), dark);
  barrel.position.set(0, 0.025, -0.38);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.2), dark);
  stock.position.set(0, -0.02, 0.28);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accent);
  sight.position.set(0, 0.07, -0.1);
  model.add(receiver, barrel, stock, sight);
  model.scale.setScalar(0.8);
  model.position.set(0.26, -0.22, -0.5);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.2, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.26, -0.18, -0.7);
  camera.add(flashLight);

  const state = { flash: 0, kick: 0, weapon: 'pistol', reloadPose: 0 };

  // Per-weapon silhouette: barrel length and stock presence change the read.
  const SHAPES = {
    pistol: { barrelZ: -0.22, barrelLen: 0.16, stock: false, sight: false },
    smg: { barrelZ: -0.3, barrelLen: 0.26, stock: true, sight: false },
    rifle: { barrelZ: -0.38, barrelLen: 0.4, stock: true, sight: true },
    sniper: { barrelZ: -0.5, barrelLen: 0.62, stock: true, sight: true },
  };

  function setWeapon(id) {
    if (state.weapon === id) return;
    state.weapon = id;
    const shape = SHAPES[id];
    barrel.scale.z = shape.barrelLen / 0.4;
    barrel.position.z = shape.barrelZ;
    stock.visible = shape.stock;
    sight.visible = shape.sight;
    // Flash sits just past the muzzle: model offset plus the scaled tip.
    flash.position.z = -0.5 + (shape.barrelZ - shape.barrelLen / 2) * 0.8 - 0.04;
  }

  function step(dt, reloading) {
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.reloadPose += ((reloading ? 1 : 0) - state.reloadPose) * Math.min(1, dt * 8);
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2 - state.reloadPose * 0.55;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    setWeapon,
    step,
    pullTrigger() {
      state.flash = 0.06;
      state.kick = 0.055;
    },
  };
}
