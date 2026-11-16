// The one state object. Everything the simulation reads or writes about the match
// lives here: phase, round, scores, economy, the bomb, the kill feed, noise events
// bots can hear, and one-frame events the HUD and audio drain. Modules never keep
// their own copy of match state; they take this object and mutate it in place.
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PHASES = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
};

export const MATCH = {
  WINS_TO: 8,
  ROUND_TIME: 100,
  BUY_TIME: 12,
  ROUND_END_TIME: 4,
  BOMB_TIME: 35,
  PLANT_TIME: 3.5,
  DEFUSE_TIME: 5,
  START_MONEY: 800,
  MAX_MONEY: 16000,
  KILL_REWARD: 300,
  WIN_BONUS: 3000,
  LOSS_BONUS: 1500,
};

export function createState(seed) {
  return {
    time: 0,
    seed,
    random: mulberry32(seed),
    phase: PHASES.MENU,
    phaseTime: 0,
    round: 1,
    score: { van: 0, war: 0 },
    money: MATCH.START_MONEY,
    roundTime: MATCH.ROUND_TIME,
    bomb: {
      status: 'carried', // carried | dropped | planted | defused | exploded
      site: null, // 'A' | 'B'
      carrier: 'player', // 'player' | bot actor | null
      pos: new THREE.Vector3(),
      plant: 0, // 0..1 plant progress
      defuse: 0, // 0..1 defuse progress
      timer: MATCH.BOMB_TIME,
    },
    kills: [], // kill feed, newest first: { text, team, time }
    noises: [], // { x, z, radius, time } — gunfire bots can hear
    events: [], // one-frame events for audio/HUD: { type, ... }
    actors: [], // player actor first, then the 7 bots
    player: null,
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
  };
}

// One actor shape for the player and every bot: body state, weapon state, and (bots
// only) an ai block. The renderer positions meshes from these fields; the simulation
// never reads a mesh.
export function createActor(id, name, team, isPlayer) {
  return {
    id,
    name,
    team, // 'van' | 'war'
    isPlayer,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    health: 100,
    alive: true,
    height: 1.72,
    eye: 1.6,
    crouching: false,
    onGround: true,
    weapon: 'pistol',
    primary: null, // 'smg' | 'rifle' | 'sniper' once bought
    ammo: {}, // weapon id -> { mag, reserve }
    cooldown: 0,
    reloadLeft: 0,
    reloadWeapon: null,
    grenades: { frag: 0, smoke: 0 },
    fall: 0, // death animation 0..1
    spectate: null, // who a dead player watches
    ai: isPlayer ? null : {
      state: 'route', // route | engage | hold | seek | fetch | plant | defuse | dead
      route: [], // waypoint Vector3s, consumed from the front
      routeTarget: null, // node id the route leads to
      holdSpot: null, // { x, z, yaw }
      target: null, // enemy actor currently fought
      lastKnown: new THREE.Vector3(), // last seen/heard enemy position
      lastKnownAt: -99,
      reactAt: 0,
      burstLeft: 0,
      burstAt: 0,
      sightAt: 0, // next sight check time (staggered per bot)
      skill: 0.5, // 0..1, scales reaction and aim
      site: 'A', // assigned site
      stuckTime: 0, // last time the bot made progress on its route
      stuckDist: Infinity, // closest distance to the current waypoint so far
    },
    mesh: null, // bot body group; the player has a view model instead
    hitMeshes: [], // torso + head meshes, userData { actor, part }
  };
}

export function aliveOf(state, team) {
  let count = 0;
  for (const actor of state.actors) if (actor.team === team && actor.alive) count += 1;
  return count;
}

export function pushKill(state, text, team) {
  state.kills.unshift({ text, team, time: state.time });
  if (state.kills.length > 5) state.kills.length = 5;
}

export function pushEvent(state, type, data) {
  state.events.push({ type, ...data });
}
