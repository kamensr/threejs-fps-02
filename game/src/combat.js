// Combat: one hitscan resolver shared by the player and every bot, damage with
// headshot bonus and range falloff, thrown grenades with bounce physics, smoke
// that blocks sight, tracers, and the noise events bots hear. A shot is a ray
// from a muzzle against the world and every living body; the nearest hit wins.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS, GRENADES, damageAt } from './weapons.js';
import { pushKill, pushEvent } from './state.js';

const GRAVITY = 20;
const NOISE_RADIUS = { pistol: 14, smg: 20, rifle: 24, sniper: 32, explosion: 40 };

export function createCombat(scene, world, state) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const scratch2 = new THREE.Vector3();
  const hitMeshes = []; // living bodies' torso/head meshes; rebuilt on spawn/death
  const grenades = []; // live grenades: { type, pos, vel, fuse, owner }
  const smokes = []; // { center: Vector3, radius, left, group }
  const grenadeMeshes = [];
  const tracerPool = [];
  for (let i = 0; i < 8; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, left: 0 });
  }
  let tracerNext = 0;

  const grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.4 });
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9cdd2'), transparent: true, opacity: 0.55, depthWrite: false });

  function rebuildTargets() {
    hitMeshes.length = 0;
    for (const actor of state.actors) {
      if (!actor.alive) continue;
      for (const mesh of actor.hitMeshes) hitMeshes.push(mesh);
    }
  }

  function addNoise(x, z, radius) {
    state.noises.push({ x, z, radius, time: state.time });
    if (state.noises.length > 24) state.noises.shift();
  }

  function showTracer(from, to) {
    const tracer = tracerPool[tracerNext];
    tracerNext = (tracerNext + 1) % tracerPool.length;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x;
    positions[1] = from.y;
    positions[2] = from.z;
    positions[3] = to.x;
    positions[4] = to.y;
    positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.material.opacity = 0.7;
    tracer.line.visible = true;
    tracer.left = 0.07;
  }

  function damage(victim, amount, attacker, part) {
    if (!victim.alive) return false;
    victim.health -= amount;
    if (victim.health > 0) {
      if (attacker && attacker.isPlayer) pushEvent(state, 'hit', { victim: victim.name, killed: false, head: part === 'head' });
      return false;
    }
    victim.health = 0;
    victim.alive = false;
    victim.fall = 0;
    if (victim.ai) victim.ai.state = 'dead';
    rebuildTargets();
    const by = attacker ? attacker.name : 'the blast';
    pushKill(state, `${by} ▸ ${victim.name}${part === 'head' ? ' (headshot)' : ''}`, attacker ? attacker.team : null);
    pushEvent(state, 'kill', { victim: victim.name, attacker: attacker ? attacker.name : null, byPlayer: !!(attacker && attacker.isPlayer) });
    if (attacker && attacker.isPlayer) state.money = Math.min(16000, state.money + 300);
    return true;
  }

  // Fires one hitscan round from `from` along `dir` with cone spread. Returns the
  // hit { victim, part, point, distance } or null. World geometry stops bullets;
  // bodies are checked by the same ray, nearest first.
  function fireHitscan(shooter, from, dir, spread) {
    const def = WEAPONS[shooter.weapon];
    direction.copy(dir);
    if (spread > 0) {
      direction.x += (state.random() * 2 - 1) * spread;
      direction.y += (state.random() * 2 - 1) * spread;
      direction.z += (state.random() * 2 - 1) * spread;
      direction.normalize();
    }
    raycaster.set(from, direction);
    raycaster.far = def.range + 30;
    const worldHit = raycaster.intersectObjects(world.shootables, false)[0];
    // Bodies: the shooter's own meshes never count, and a teammate's body
    // stops the bullet without taking damage (no friendly fire).
    const bodyHits = raycaster.intersectObjects(hitMeshes, false);
    let bodyHit = null;
    for (const hit of bodyHits) {
      if (hit.object.userData.actor !== shooter) {
        bodyHit = hit;
        break;
      }
    }
    const worldDist = worldHit ? worldHit.distance : Infinity;
    const bodyDist = bodyHit ? bodyHit.distance : Infinity;
    let end;
    if (bodyHit && bodyDist < worldDist) {
      const victim = bodyHit.object.userData.actor;
      const part = bodyHit.object.userData.part;
      end = bodyHit.point;
      if (victim.team !== shooter.team) {
        const amount = damageAt(def, bodyDist, part === 'head');
        damage(victim, amount, shooter, part);
      }
      showTracer(from, end);
      addNoise(from.x, from.z, NOISE_RADIUS[shooter.weapon] || 20);
      return { victim, part, point: end.clone(), distance: bodyDist };
    }
    if (worldHit) {
      end = worldHit.point;
      showTracer(from, end);
      addNoise(from.x, from.z, NOISE_RADIUS[shooter.weapon] || 20);
      return { victim: null, part: null, point: end.clone(), distance: worldDist };
    }
    scratch.copy(from).addScaledVector(direction, 60);
    showTracer(from, scratch);
    addNoise(from.x, from.z, NOISE_RADIUS[shooter.weapon] || 20);
    return null;
  }

  // Line of sight between two eye points: blocked by world geometry or smoke.
  function losBlocked(from, to) {
    scratch2.subVectors(to, from);
    const distance = scratch2.length();
    if (distance < 0.01) return false;
    direction.copy(scratch2).divideScalar(distance);
    raycaster.set(from, direction);
    raycaster.far = distance;
    if (raycaster.intersectObjects(world.shootables, false).length > 0) return true;
    for (const smoke of smokes) {
      // Distance from the smoke centre to the sight segment.
      scratch.subVectors(smoke.center, from);
      const t = Math.max(0, Math.min(1, scratch.dot(direction) / distance));
      scratch2.copy(from).addScaledVector(direction, t * distance);
      if (scratch2.distanceToSquared(smoke.center) < smoke.radius * smoke.radius) return true;
    }
    return false;
  }

  function throwGrenade(actor, type, dir) {
    if (actor.grenades[type] <= 0) return false;
    actor.grenades[type] -= 1;
    const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
    mesh.castShadow = true;
    scene.add(mesh);
    const grenade = {
      type,
      pos: new THREE.Vector3(actor.pos.x, actor.pos.y + actor.eye - 0.1, actor.pos.z),
      vel: new THREE.Vector3(dir.x * 15 + actor.vel.x * 0.5, dir.y * 15 + 3.5, dir.z * 15 + actor.vel.z * 0.5),
      fuse: GRENADES[type].fuse,
      owner: actor,
      mesh,
    };
    grenade.pos.addScaledVector(dir, 0.5);
    grenades.push(grenade);
    grenadeMeshes.push(mesh);
    pushEvent(state, 'throw', { type });
    return true;
  }

  function explode(grenade) {
    const def = GRENADES[grenade.type];
    if (grenade.type === 'frag') {
      addNoise(grenade.pos.x, grenade.pos.z, NOISE_RADIUS.explosion);
      pushEvent(state, 'explosion', { x: grenade.pos.x, z: grenade.pos.z });
      const flash = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 14, 1.6);
      flash.position.copy(grenade.pos);
      scene.add(flash);
      setTimeout(() => scene.remove(flash), 120);
      for (const actor of state.actors) {
        if (!actor.alive || actor.team === grenade.owner.team) continue;
        const distance = actor.pos.distanceTo(grenade.pos);
        if (distance > def.radius) continue;
        // Blast is blocked by walls: no damage through cover.
        origin.copy(grenade.pos);
        scratch.copy(actor.pos);
        scratch.y += 1;
        if (losBlocked(origin, scratch)) continue;
        const amount = def.damage * (1 - (distance / def.radius) * 0.8);
        damage(actor, amount, grenade.owner, 'blast');
      }
    } else {
      const group = new THREE.Group();
      for (let i = 0; i < 5; i += 1) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.55, 10, 8), smokeMaterial);
        puff.position.set((state.random() - 0.5) * def.radius, 0.8 + state.random() * 1.2, (state.random() - 0.5) * def.radius);
        group.add(puff);
      }
      group.position.copy(grenade.pos);
      group.position.y = Math.max(0.5, grenade.pos.y);
      scene.add(group);
      smokes.push({ center: group.position.clone(), radius: def.radius, left: def.duration, group });
      pushEvent(state, 'smoke', { x: grenade.pos.x, z: grenade.pos.z });
    }
  }

  const colliderProbe = new THREE.Box3();
  function collideGrenade(grenade, dt) {
    const next = scratch.copy(grenade.pos).addScaledVector(grenade.vel, dt);
    colliderProbe.min.set(next.x - 0.09, next.y - 0.09, next.z - 0.09);
    colliderProbe.max.set(next.x + 0.09, next.y + 0.09, next.z + 0.09);
    let hit = null;
    for (const collider of world.colliders) {
      if (colliderProbe.intersectsBox(collider)) {
        hit = collider;
        break;
      }
    }
    if (!hit && next.y >= 0.09) {
      grenade.pos.copy(next);
      return;
    }
    // Bounce: flip the velocity component along the smallest penetration axis.
    if (next.y < 0.09) {
      grenade.pos.y = 0.09;
      grenade.vel.y = Math.abs(grenade.vel.y) * 0.45;
      grenade.vel.x *= 0.7;
      grenade.vel.z *= 0.7;
      return;
    }
    if (hit) {
      const cx = (hit.min.x + hit.max.x) / 2;
      const cz = (hit.min.z + hit.max.z) / 2;
      if (Math.abs(next.x - cx) > Math.abs(next.z - cz)) grenade.vel.x *= -0.45;
      else grenade.vel.z *= -0.45;
      grenade.vel.y *= 0.7;
    }
  }

  function step(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.vel.y -= GRAVITY * dt;
      collideGrenade(grenade, dt);
      grenade.mesh.position.copy(grenade.pos);
      grenade.fuse -= dt;
      if (grenade.fuse <= 0) {
        explode(grenade);
        scene.remove(grenade.mesh);
        grenades.splice(i, 1);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      const smoke = smokes[i];
      smoke.left -= dt;
      smoke.group.rotation.y += dt * 0.1;
      if (smoke.left <= 0) {
        scene.remove(smoke.group);
        smokes.splice(i, 1);
      }
    }
    for (const tracer of tracerPool) {
      if (tracer.left <= 0) continue;
      tracer.left -= dt;
      if (tracer.left <= 0) {
        tracer.line.visible = false;
        tracer.line.material.opacity = 0;
      }
    }
    // Noises older than 3 seconds stop mattering.
    while (state.noises.length > 0 && state.time - state.noises[0].time > 3) state.noises.shift();
  }

  function clearField() {
    for (const grenade of grenades) scene.remove(grenade.mesh);
    grenades.length = 0;
    for (const smoke of smokes) scene.remove(smoke.group);
    smokes.length = 0;
    for (const tracer of tracerPool) {
      tracer.left = 0;
      tracer.line.visible = false;
    }
  }

  return {
    fireHitscan,
    losBlocked,
    throwGrenade,
    damage,
    addNoise,
    rebuildTargets,
    step,
    clearField,
    get grenadeCount() {
      return grenades.length;
    },
  };
}
