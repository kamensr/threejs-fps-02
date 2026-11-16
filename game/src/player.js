// Bodies in the world: acceleration-based movement with friction, gravity, crouch
// and jump, resolved as a box against the world's colliders one axis at a time, so
// a wall never swallows a body. The player and every bot move through this one
// helper; only who picks the wish direction differs.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.4;

export function createMover(colliders) {
  const probe = new THREE.Box3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on
  // the floor is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function setCrouch(actor, crouching) {
    if (crouching && !actor.crouching) {
      actor.crouching = true;
      actor.height = CROUCH_HEIGHT;
    } else if (!crouching && actor.crouching && !overlaps(actor.pos.x, actor.pos.y, actor.pos.z, STAND_HEIGHT, 0.02)) {
      actor.crouching = false;
      actor.height = STAND_HEIGHT;
    }
    const eyeTarget = actor.crouching ? CROUCH_EYE : STAND_EYE;
    actor.eye = eyeTarget;
  }

  // wishX/wishZ is a unit (or zero) horizontal direction in world space; jump
  // requests a jump this step. Speed scales with the actor's wish magnitude.
  function step(actor, dt, wishX, wishZ, jump, speedScale = 1) {
    const speed = (actor.crouching ? CROUCH_SPEED : WALK_SPEED) * speedScale;
    const blend = Math.min(1, ((actor.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / Math.max(speed, 0.1));
    actor.vel.x += (wishX * speed - actor.vel.x) * blend;
    actor.vel.z += (wishZ * speed - actor.vel.z) * blend;
    if (actor.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      actor.vel.x *= damp;
      actor.vel.z *= damp;
    }
    if (jump && actor.onGround) {
      actor.vel.y = JUMP_SPEED;
      actor.onGround = false;
    }
    actor.vel.y -= GRAVITY * dt;

    const nextX = actor.pos.x + actor.vel.x * dt;
    if (!overlaps(nextX, actor.pos.y, actor.pos.z, actor.height, 0.04)) actor.pos.x = nextX;
    else actor.vel.x = 0;
    const nextZ = actor.pos.z + actor.vel.z * dt;
    if (!overlaps(actor.pos.x, actor.pos.y, nextZ, actor.height, 0.04)) actor.pos.z = nextZ;
    else actor.vel.z = 0;

    actor.pos.y += actor.vel.y * dt;
    actor.onGround = false;
    const hit = overlaps(actor.pos.x, actor.pos.y, actor.pos.z, actor.height, 0);
    if (hit && actor.vel.y <= 0) {
      actor.pos.y = hit.max.y;
      actor.vel.y = 0;
      actor.onGround = true;
    } else if (hit) {
      actor.pos.y = hit.min.y - actor.height;
      actor.vel.y = 0;
    }
    if (actor.pos.y < 0) {
      actor.pos.y = 0;
      actor.vel.y = 0;
      actor.onGround = true;
    }
    actor.vel.y = Math.max(-30, actor.vel.y);
  }

  return { step, setCrouch, overlaps };
}

export function look(actor, dx, dy, sensitivity = 0.0022) {
  actor.yaw -= dx * sensitivity;
  actor.pitch = Math.max(-1.45, Math.min(1.45, actor.pitch - dy * sensitivity));
}

export function recoil(actor, pitchKick, yawKick) {
  actor.pitch = Math.min(1.45, actor.pitch + pitchKick);
  actor.yaw += yawKick;
}

export function groundSpeed(actor) {
  return Math.hypot(actor.vel.x, actor.vel.z);
}

// Wish direction from WASD keys and the actor's yaw, written into out (x, z).
export function wishFromKeys(keys, yaw, out) {
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!forward && !strafe) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const x = -sin * forward + cos * strafe;
  const z = -cos * forward - sin * strafe;
  const length = Math.hypot(x, z) || 1;
  out.x = x / length;
  out.z = z / length;
  return out;
}
