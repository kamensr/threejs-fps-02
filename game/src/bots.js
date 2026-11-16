// The seven bots: three Vanguard teammates, four Warden defenders. Each is an
// actor with a box-built body (torso + head meshes, so headshots work on them)
// and a small state machine: route along the waypoint graph, hold a site, engage
// what it sees, investigate what it hears, fetch the dropped charge, plant it or
// defuse it. Sight is a raycast with a field of view and a reaction delay;
// hearing is the noise events combat logs. Bots never see through walls or smoke.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createActor, pushEvent } from './state.js';
import { createMover, groundSpeed } from './player.js';
import { WEAPONS, giveAmmo, canFire, startReload, finishReload, spreadFor } from './weapons.js';
import { plantTick, defuseTick } from './rounds.js';

const BOT_NAMES = {
  van: ['REX', 'NOVA', 'JOLT'],
  war: ['HAVOC', 'SABLE', 'ORION', 'FENNEC'],
};
const SIGHT_RANGE = 28; // Bots fight at lane range, not across the map: a 50 m
// sight line lets both teams potshot each other from spawn instead of pushing.
const SIGHT_FOV = 1.9; // radians, ~109 degrees
const SIGHT_INTERVAL = 0.12;
const BOT_SPEED = 0.88;

export function createBots(scene, world, state, combat, mover) {
  const actors = [];
  const eye = new THREE.Vector3();
  const chest = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const wish = { x: 0, z: 0 };

  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 12, 10);
  const legGeometry = new THREE.BoxGeometry(0.18, 0.6, 0.2);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const flashGeometry = new THREE.PlaneGeometry(0.3, 0.3);
  const legMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const gunMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d0f12'), roughness: 0.5, metalness: 0.5 });
  const visorMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d0f12'), roughness: 0.3, metalness: 0.6 });
  const flashMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const teamMaterials = {
    van: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.van), roughness: 0.65 }),
    war: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.war), roughness: 0.65 }),
  };

  function buildBody(actor) {
    const outer = new THREE.Group();
    const body = new THREE.Group();
    outer.add(body);
    const torso = new THREE.Mesh(torsoGeometry, teamMaterials[actor.team]);
    torso.position.y = 1.05;
    torso.userData.actor = actor;
    torso.userData.part = 'torso';
    // Helmet in team colours with a dark visor: the head reads as a soldier,
    // and its colour tells the team at a glance.
    const head = new THREE.Mesh(headGeometry, teamMaterials[actor.team]);
    head.position.y = 1.58;
    head.userData.actor = actor;
    head.userData.part = 'head';
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.06), visorMaterial);
    visor.position.set(0, 1.6, -0.13);
    const legL = new THREE.Mesh(legGeometry, legMaterial);
    legL.position.set(-0.14, 0.3, 0);
    const legR = new THREE.Mesh(legGeometry, legMaterial);
    legR.position.set(0.14, 0.3, 0);
    const gun = new THREE.Mesh(gunGeometry, gunMaterial);
    gun.position.set(0.2, 1.15, -0.35);
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.set(0.2, 1.15, -0.7);
    flash.visible = false;
    body.add(torso, head, visor, legL, legR, gun, flash);
    outer.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(outer);
    actor.mesh = outer;
    actor.bodyGroup = body;
    actor.flashMesh = flash;
    actor.flashLeft = 0;
    actor.hitMeshes = [torso, head];
    actor.lastHealth = 100;
  }

  let id = 1;
  for (const team of ['van', 'war']) {
    for (let i = 0; i < (team === 'van' ? 3 : 4); i += 1) {
      const actor = createActor(id, BOT_NAMES[team][i], team, false);
      actor.ai.skill = 0.45 + state.random() * 0.4;
      actor.ai.site = team === 'van' ? (i === 2 ? 'B' : 'A') : (i < 2 ? 'A' : 'B');
      buildBody(actor);
      actors.push(actor);
      state.actors.push(actor);
      id += 1;
    }
  }

  function routeTo(actor, nodeId) {
    const from = world.nearestNode(actor.pos.x, actor.pos.z);
    world.findPath(from, nodeId, actor.ai.route);
    actor.ai.routeTarget = nodeId;
    actor.ai.stuckTime = state.time;
    actor.ai.stuckDist = Infinity;
  }

  function loadoutForRound(actor, round) {
    const weapon = round <= 1 ? 'pistol' : round <= 3 ? 'smg' : actor.name === 'ORION' && round >= 5 ? 'sniper' : 'rifle';
    actor.weapon = weapon;
    actor.primary = weapon === 'pistol' ? null : weapon;
    giveAmmo(actor, 'pistol');
    if (weapon !== 'pistol') giveAmmo(actor, weapon);
  }

  function spawnRound(round) {
    let vanIndex = 0;
    let warIndex = 0;
    for (const actor of actors) {
      const spawn = actor.team === 'van'
        ? world.spawns.van[(vanIndex + 1) % 4]
        : world.spawns.war[warIndex % 4];
      if (actor.team === 'van') vanIndex += 1;
      else warIndex += 1;
      actor.pos.copy(spawn);
      actor.vel.set(0, 0, 0);
      actor.yaw = actor.team === 'van' ? 0 : Math.PI;
      actor.pitch = 0;
      actor.health = 100;
      actor.alive = true;
      actor.fall = 0;
      actor.lastHealth = 100;
      actor.cooldown = 0;
      actor.reloadLeft = 0;
      actor.grenades.frag = 0;
      actor.grenades.smoke = 0;
      loadoutForRound(actor, round);
      actor.mesh.visible = true;
      actor.bodyGroup.rotation.x = 0;
      actor.mesh.position.copy(actor.pos);
      actor.mesh.rotation.y = actor.yaw;
      // Assignments: attackers run a lane to their site; defenders walk to a
      // hold spot and wait. Routes are computed at round start so bots move
      // the moment the round goes live.
      const ai = actor.ai;
      ai.target = null;
      ai.route.length = 0;
      ai.burstLeft = 0;
      ai.lastKnownAt = -99;
      if (actor.team === 'van') {
        ai.state = 'route';
        routeTo(actor, world.sites[ai.site].node);
      } else {
        const spots = actor.name === 'FENNEC' ? world.holdSpots.MID : world.holdSpots[ai.site];
        ai.holdSpot = spots[(round + warIndex) % spots.length];
        ai.state = 'route';
        const node = world.nearestNode(ai.holdSpot.x, ai.holdSpot.z);
        routeTo(actor, node);
      }
    }
    combat.rebuildTargets();
  }

  function angleTo(actor, x, z) {
    return Math.atan2(-(x - actor.pos.x), -(z - actor.pos.z));
  }

  function turnToward(actor, targetYaw, dt, rate = 6) {
    let diff = targetYaw - actor.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
    actor.yaw += step;
    return Math.abs(diff) < 0.05;
  }

  function sightCheck(actor) {
    const ai = actor.ai;
    eye.set(actor.pos.x, actor.pos.y + actor.eye, actor.pos.z);
    let best = null;
    let bestDist = SIGHT_RANGE;
    for (const enemy of state.actors) {
      if (enemy.team === actor.team || !enemy.alive) continue;
      chest.set(enemy.pos.x, enemy.pos.y + 1.2, enemy.pos.z);
      const distance = eye.distanceTo(chest);
      if (distance > bestDist) continue;
      const bearing = angleTo(actor, enemy.pos.x, enemy.pos.z);
      let diff = bearing - actor.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > SIGHT_FOV / 2 && distance > 8) continue;
      if (combat.losBlocked(eye, chest)) continue;
      best = enemy;
      bestDist = distance;
    }
    if (best) {
      const newly = ai.target !== best;
      ai.target = best;
      ai.lastKnown.copy(best.pos);
      ai.lastKnownAt = state.time;
      if (newly) ai.reactAt = state.time + (0.45 - ai.skill * 0.25) + state.random() * 0.25;
      if (ai.state === 'route' || ai.state === 'hold' || ai.state === 'seek') ai.state = 'engage';
      return true;
    }
    if (ai.target && state.time - ai.lastKnownAt > 2) {
      ai.target = null;
      if (ai.state === 'engage') {
        ai.state = 'seek';
        routeTo(actor, world.nearestNode(ai.lastKnown.x, ai.lastKnown.z));
      }
    }
    return false;
  }

  function hearCheck(actor) {
    const ai = actor.ai;
    if (ai.target || ai.state === 'plant' || ai.state === 'defuse' || ai.state === 'fetch') return;
    for (const noise of state.noises) {
      if (state.time - noise.time > 1.5) continue;
      const dx = noise.x - actor.pos.x;
      const dz = noise.z - actor.pos.z;
      if (dx * dx + dz * dz > noise.radius * noise.radius) continue;
      ai.lastKnown.set(noise.x, 0, noise.z);
      ai.lastKnownAt = state.time;
      ai.state = 'seek';
      routeTo(actor, world.nearestNode(noise.x, noise.z));
      return;
    }
  }

  function followRoute(actor, dt, speedScale) {
    const ai = actor.ai;
    if (ai.route.length === 0) return true;
    const waypoint = ai.route[0];
    const dx = waypoint.x - actor.pos.x;
    const dz = waypoint.z - actor.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.9) {
      ai.route.shift();
      ai.stuckTime = state.time;
      ai.stuckDist = Infinity;
      return ai.route.length === 0;
    }
    // Stuck guard: a waypoint the bot cannot reach (a misjudged corner, a
    // shove against a wall) is dropped after 2.5 s without progress, so no
    // bot ever wedges itself for a whole round.
    if (distance < ai.stuckDist - 0.3) {
      ai.stuckDist = distance;
      ai.stuckTime = state.time;
    } else if (state.time - ai.stuckTime > 2.5) {
      ai.route.shift();
      ai.stuckTime = state.time;
      ai.stuckDist = Infinity;
      return ai.route.length === 0;
    }
    wish.x = dx / distance;
    wish.z = dz / distance;
    turnToward(actor, angleTo(actor, waypoint.x, waypoint.z), dt, 8);
    mover.step(actor, dt, wish.x, wish.z, false, speedScale);
    return false;
  }

  function botFire(actor, dt) {
    const ai = actor.ai;
    const target = ai.target;
    if (!target || !target.alive) return;
    if (state.time < ai.reactAt) return;
    if (actor.reloadLeft > 0) return;
    const ammo = actor.ammo[actor.weapon];
    if (ammo && ammo.mag === 0) {
      startReload(actor);
      return;
    }
    if (ai.burstLeft <= 0) {
      if (state.time < ai.burstAt) return;
      ai.burstLeft = 3 + Math.floor(state.random() * 4);
      ai.burstAt = state.time + 0.5 + state.random() * 0.7;
    }
    if (!canFire(actor)) return;
    const def = WEAPONS[actor.weapon];
    actor.cooldown = 1 / def.rate;
    ammo.mag -= 1;
    ai.burstLeft -= 1;
    eye.set(actor.pos.x, actor.pos.y + actor.eye, actor.pos.z);
    chest.set(target.pos.x, target.pos.y + 1.2, target.pos.z);
    toTarget.subVectors(chest, eye);
    const distance = toTarget.length();
    toTarget.divideScalar(distance || 1);
    // Aim error: distance, target speed and the bot's own movement open the
    // cone; skill and standing still close it.
    const targetSpeed = groundSpeed(target);
    const error = (0.01 + distance * 0.0012 + targetSpeed * 0.006 + groundSpeed(actor) * 0.008) * (1.35 - ai.skill);
    const hit = combat.fireHitscan(actor, eye, toTarget, error);
    actor.flashLeft = 0.05;
    pushEvent(state, 'botShot', { weapon: actor.weapon, x: actor.pos.x, z: actor.pos.z, hit: !!hit });
    if (ammo.mag === 0) startReload(actor);
  }

  function stepBot(actor, dt) {
    const ai = actor.ai;
    if (!actor.alive) {
      actor.fall = Math.min(1, actor.fall + dt / 0.4);
      actor.bodyGroup.rotation.x = -actor.fall * 1.45;
      return;
    }
    actor.cooldown = Math.max(0, actor.cooldown - dt);
    if (actor.reloadLeft > 0) {
      actor.reloadLeft = Math.max(0, actor.reloadLeft - dt);
      if (actor.reloadLeft === 0) finishReload(actor);
    }
    actor.flashLeft = Math.max(0, actor.flashLeft - dt);
    actor.flashMesh.visible = actor.flashLeft > 0;

    // Damage interrupts a plant or defuse: the bot fights instead.
    if ((ai.state === 'plant' || ai.state === 'defuse') && actor.health < actor.lastHealth) {
      state.bomb.plant = 0;
      state.bomb.defuse = 0;
      ai.state = 'engage';
    }
    actor.lastHealth = actor.health;

    if (state.time >= ai.sightAt) {
      ai.sightAt = state.time + SIGHT_INTERVAL;
      sightCheck(actor);
      hearCheck(actor);
    }

    switch (ai.state) {
      case 'route': {
        if (followRoute(actor, dt, BOT_SPEED)) {
          if (actor.team === 'war' && ai.holdSpot) {
            ai.state = 'hold';
          } else if (actor.team === 'van') {
            ai.state = 'hold';
            ai.holdSpot = { x: actor.pos.x, z: actor.pos.z, yaw: actor.yaw };
          }
        }
        break;
      }
      case 'hold': {
        if (ai.holdSpot) {
          const dx = ai.holdSpot.x - actor.pos.x;
          const dz = ai.holdSpot.z - actor.pos.z;
          if (Math.hypot(dx, dz) > 1.2) {
            wish.x = dx / (Math.hypot(dx, dz) || 1);
            wish.z = dz / (Math.hypot(dx, dz) || 1);
            mover.step(actor, dt, wish.x, wish.z, false, BOT_SPEED);
          } else {
            // Scan: slow sweep around the hold yaw.
            const sweep = Math.sin(state.time * 0.5 + actor.id * 1.7) * 0.6;
            turnToward(actor, ai.holdSpot.yaw + sweep, dt, 2);
          }
        }
        break;
      }
      case 'engage': {
        const target = ai.target;
        if (target && target.alive) {
          turnToward(actor, angleTo(actor, target.pos.x, target.pos.z), dt, 8);
          // Strafe while fighting, unless holding a site.
          const strafe = Math.sin(state.time * 1.4 + actor.id * 2.1) > 0 ? 1 : -1;
          const sin = Math.sin(actor.yaw);
          const cos = Math.cos(actor.yaw);
          mover.step(actor, dt, cos * strafe * 0.5, -sin * strafe * 0.5, false, BOT_SPEED * 0.55);
          botFire(actor, dt);
        } else {
          ai.target = null;
          ai.state = 'seek';
          routeTo(actor, world.nearestNode(ai.lastKnown.x, ai.lastKnown.z));
        }
        break;
      }
      case 'seek': {
        if (followRoute(actor, dt, BOT_SPEED)) {
          // The trail went cold: attackers resume the push to their site,
          // defenders walk back to their post instead of camping the spot.
          if (actor.team === 'van') {
            ai.state = 'route';
            routeTo(actor, world.sites[ai.site].node);
          } else if (ai.holdSpot) {
            ai.state = 'route';
            routeTo(actor, world.nearestNode(ai.holdSpot.x, ai.holdSpot.z));
          } else {
            ai.state = 'hold';
            ai.holdSpot = { x: actor.pos.x, z: actor.pos.z, yaw: actor.yaw };
          }
        }
        break;
      }
      case 'fetch': {
        const bomb = state.bomb;
        const dx = bomb.pos.x - actor.pos.x;
        const dz = bomb.pos.z - actor.pos.z;
        if (Math.hypot(dx, dz) < 1.4) {
          bomb.carrier = actor;
          bomb.status = 'carried';
          pushEvent(state, 'pickup', { name: actor.name });
          ai.state = 'route';
          routeTo(actor, world.sites[ai.site].node);
        } else if (!followRoute(actor, dt, BOT_SPEED)) {
          // Still walking to the dropped charge.
        } else {
          routeTo(actor, world.nearestNode(bomb.pos.x, bomb.pos.z));
        }
        break;
      }
      case 'plant': {
        if (plantTick(state, world, actor, dt)) {
          ai.state = 'hold';
          ai.holdSpot = { x: actor.pos.x, z: actor.pos.z, yaw: actor.yaw };
        }
        break;
      }
      case 'defuse': {
        if (defuseTick(state, actor, dt)) {
          ai.state = 'hold';
          ai.holdSpot = { x: actor.pos.x, z: actor.pos.z, yaw: actor.yaw };
        }
        break;
      }
      default:
        break;
    }

    // Bomb logic that cuts across states.
    const bomb = state.bomb;
    if (actor.team === 'van' && bomb.status === 'dropped' && actor.alive && ai.state !== 'fetch' && ai.state !== 'engage') {
      // The nearest living Vanguard bot fetches the dropped charge.
      let nearest = null;
      let nearestDist = Infinity;
      for (const other of actors) {
        if (other.team !== 'van' || !other.alive) continue;
        const d = other.pos.distanceToSquared(bomb.pos);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = other;
        }
      }
      if (nearest === actor) {
        ai.state = 'fetch';
        routeTo(actor, world.nearestNode(bomb.pos.x, bomb.pos.z));
      }
    }
    if (actor.team === 'van' && bomb.carrier === actor && bomb.status === 'carried' && ai.state === 'hold') {
      // The carrier reached its site: plant the charge.
      const site = world.sites[ai.site];
      if (actor.pos.distanceTo(site.center) < site.radius) ai.state = 'plant';
      else {
        ai.state = 'route';
        routeTo(actor, site.node);
      }
    }
    if (actor.team === 'war' && bomb.status === 'planted' && actor.alive && ai.state !== 'defuse' && ai.state !== 'engage') {
      const distance = actor.pos.distanceTo(bomb.pos);
      if (distance < 2.5) {
        ai.state = 'defuse';
      } else if (ai.state !== 'route' || ai.routeTarget !== world.sites[bomb.site].node) {
        ai.state = 'route';
        routeTo(actor, world.sites[bomb.site].node);
      }
    }

    actor.mesh.position.copy(actor.pos);
    actor.mesh.rotation.y = actor.yaw;
  }

  function step(dt) {
    if (state.phase !== 'live') {
      for (const actor of actors) {
        if (!actor.alive) {
          actor.fall = Math.min(1, actor.fall + dt / 0.4);
          actor.bodyGroup.rotation.x = -actor.fall * 1.45;
        }
      }
      return;
    }
    for (const actor of actors) stepBot(actor, dt);
  }

  return { actors, spawnRound, step };
}
