// The match: buy phase, live round, round end, match end. It owns the clock,
// the economy and the bomb's rules — plant, defuse, detonation — and decides
// every round: elimination, time, detonation or defuse. First to 8 wins.
import { MATCH, PHASES, aliveOf, pushEvent } from './state.js';
import { WEAPONS, GRENADES, giveAmmo } from './weapons.js';
import { groundSpeed } from './player.js';

// Planting takes PLANT_TIME seconds standing still inside a site, carrying the
// charge. Moving cancels the channel. Returns true the step the plant lands.
export function plantTick(state, world, actor, dt) {
  const bomb = state.bomb;
  // The carrier is the string 'player' for the player and the actor object
  // for a bot; normalize before comparing, or the player can never plant.
  const carrier = bomb.carrier === 'player' ? state.player : bomb.carrier;
  if (bomb.status !== 'carried' || carrier !== actor || !actor.alive) return false;
  let site = null;
  for (const key of ['A', 'B']) {
    const candidate = world.sites[key];
    if (actor.pos.distanceTo(candidate.center) < candidate.radius) site = key;
  }
  if (!site || groundSpeed(actor) > 1) {
    bomb.plant = 0;
    return false;
  }
  bomb.plant = Math.min(1, bomb.plant + dt / MATCH.PLANT_TIME);
  if (bomb.plant < 1) return false;
  bomb.status = 'planted';
  bomb.site = site;
  bomb.pos.copy(actor.pos);
  bomb.pos.y = 0;
  bomb.timer = MATCH.BOMB_TIME;
  bomb.plant = 0;
  pushEvent(state, 'planted', { site, by: actor.name });
  return true;
}

// Defusing takes DEFUSE_TIME seconds standing still within arm's reach of a
// planted charge. Moving cancels the channel.
export function defuseTick(state, actor, dt) {
  const bomb = state.bomb;
  if (bomb.status !== 'planted' || !actor.alive) return false;
  if (actor.pos.distanceTo(bomb.pos) > 2.5 || groundSpeed(actor) > 1) {
    bomb.defuse = 0;
    return false;
  }
  bomb.defuse = Math.min(1, bomb.defuse + dt / MATCH.DEFUSE_TIME);
  if (bomb.defuse < 1) return false;
  bomb.status = 'defused';
  bomb.defuse = 0;
  pushEvent(state, 'defused', { by: actor.name });
  return true;
}

export function createRounds(state, hooks) {
  // hooks: { respawn(round), clearField() } — main.js wires the world reset.

  function startRound(round) {
    state.round = round;
    state.phase = PHASES.BUY;
    state.phaseTime = 0;
    state.roundTime = MATCH.ROUND_TIME;
    state.roundWinner = null;
    state.roundReason = '';
    const bomb = state.bomb;
    bomb.status = 'carried';
    bomb.site = null;
    bomb.carrier = 'player';
    bomb.plant = 0;
    bomb.defuse = 0;
    bomb.timer = MATCH.BOMB_TIME;
    hooks.clearField();
    hooks.respawn(round);
    pushEvent(state, 'roundStart', { round });
  }

  function startMatch() {
    state.score.van = 0;
    state.score.war = 0;
    state.money = MATCH.START_MONEY;
    state.matchWinner = null;
    state.kills.length = 0;
    startRound(1);
  }

  function endRound(winner, reason) {
    if (state.phase !== PHASES.LIVE) return;
    state.score[winner] += 1;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.phase = PHASES.ROUND_END;
    state.phaseTime = 0;
    // Economy: the player is Vanguard; a win pays more than a loss.
    state.money = Math.min(MATCH.MAX_MONEY, state.money + (winner === 'van' ? MATCH.WIN_BONUS : MATCH.LOSS_BONUS));
    pushEvent(state, 'roundEnd', { winner, reason, score: { ...state.score } });
  }

  function buy(itemId) {
    if (state.phase !== PHASES.BUY) return false;
    const player = state.player;
    if (!player || !player.alive) return false;
    const weapon = WEAPONS[itemId];
    if (weapon) {
      if (weapon.slot === 'sidearm' || state.money < weapon.price) return false;
      state.money -= weapon.price;
      player.primary = itemId;
      player.weapon = itemId;
      giveAmmo(player, itemId);
      pushEvent(state, 'buy', { item: weapon.name });
      return true;
    }
    const grenade = GRENADES[itemId];
    if (grenade) {
      if (state.money < grenade.price || player.grenades[itemId] >= 1) return false;
      state.money -= grenade.price;
      player.grenades[itemId] += 1;
      pushEvent(state, 'buy', { item: grenade.name });
      return true;
    }
    return false;
  }

  function step(dt) {
    if (state.phase === PHASES.BUY) {
      state.phaseTime += dt;
      if (state.phaseTime >= MATCH.BUY_TIME) {
        state.phase = PHASES.LIVE;
        state.phaseTime = 0;
        pushEvent(state, 'roundLive', { round: state.round });
      }
      return;
    }
    if (state.phase !== PHASES.LIVE) {
      if (state.phase === PHASES.ROUND_END) {
        state.phaseTime += dt;
        if (state.phaseTime >= MATCH.ROUND_END_TIME) {
          if (state.score.van >= MATCH.WINS_TO || state.score.war >= MATCH.WINS_TO) {
            state.matchWinner = state.score.van > state.score.war ? 'van' : 'war';
            state.phase = PHASES.MATCH_END;
            pushEvent(state, 'matchEnd', { winner: state.matchWinner });
          } else {
            startRound(state.round + 1);
          }
        }
      }
      return;
    }

    // A dead carrier drops the charge where they fell; the player picks it back
    // up by walking over it, bots by the fetch behaviour in bots.js.
    const bomb = state.bomb;
    if (bomb.status === 'carried') {
      const carrier = bomb.carrier === 'player' ? state.player : bomb.carrier;
      if (carrier && !carrier.alive) {
        bomb.status = 'dropped';
        bomb.pos.copy(carrier.pos);
        bomb.pos.y = 0;
        bomb.carrier = null;
        pushEvent(state, 'bombDropped', {});
      }
    }
    if (bomb.status === 'dropped' && state.player.alive) {
      if (state.player.pos.distanceTo(bomb.pos) < 1.4) {
        bomb.status = 'carried';
        bomb.carrier = 'player';
        pushEvent(state, 'pickup', { name: 'YOU' });
      }
    }

    if (bomb.status === 'planted') {
      bomb.timer -= dt;
      if (bomb.timer <= 0) {
        bomb.status = 'exploded';
        pushEvent(state, 'detonated', { site: bomb.site });
        endRound('van', 'DETONATION');
        return;
      }
    } else {
      state.roundTime -= dt;
    }
    if (bomb.status === 'defused') {
      endRound('war', 'DEFUSED');
      return;
    }

    const vanAlive = aliveOf(state, 'van');
    const warAlive = aliveOf(state, 'war');
    if (warAlive === 0) {
      endRound('van', 'ELIMINATION');
      return;
    }
    if (vanAlive === 0) {
      // With the charge planted, the round is not over until the Warden
      // defuse it or it goes off; without a plant, elimination ends it.
      if (bomb.status !== 'planted') endRound('war', 'ELIMINATION');
      return;
    }
    if (state.roundTime <= 0 && bomb.status !== 'planted') {
      endRound('war', 'TIME');
    }
  }

  return { startMatch, startRound, endRound, buy, step };
}
