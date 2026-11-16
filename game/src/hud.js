// The DOM HUD: health, ammo, money, timer, score, kill feed, bomb status, the
// buy menu and the overlays. It never touches the simulation; main.js pushes
// state in once a frame (sync) and events in as they happen (banner, hitmarker,
// kill feed). Cached values keep DOM writes to what actually changed.
import { WEAPONS, GRENADES, BUY_MENU } from './weapons.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    vignette: $('damage-vignette'),
    scope: $('scope'),
    healthValue: $('health-value'),
    healthFill: $('health-fill'),
    moneyValue: $('money-value'),
    bombCarry: $('bomb-carry'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    grenadeFrag: $('grenade-frag'),
    grenadeSmoke: $('grenade-smoke'),
    timerValue: $('timer-value'),
    scoreVan: $('score-van'),
    scoreWar: $('score-war'),
    roundValue: $('round-value'),
    aliveVan: $('alive-van'),
    aliveWar: $('alive-war'),
    bombTimer: $('bomb-timer'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    buyMenu: $('buy-menu'),
    buyMoney: $('buy-money'),
    buyList: $('buy-list'),
    channel: $('channel'),
    channelFill: $('channel-fill'),
    channelLabel: $('channel-label'),
    hint: $('hint'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    playButton: $('play'),
  };

  const last = {};
  let bannerTimer = 0;
  let hitTimer = 0;
  let vignetteTimer = 0;
  let onBuy = null;

  function setText(node, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  // Buy menu rows are built from the one weapon table, so prices in the menu
  // and in the game can never disagree.
  for (const entry of BUY_MENU) {
    const def = entry.kind === 'weapon' ? WEAPONS[entry.id] : GRENADES[entry.id];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'buy-row';
    row.dataset.buy = entry.id;
    const detail = entry.kind === 'weapon'
      ? `DMG ${def.damage} · ${def.auto ? 'AUTO' : 'SEMI'} · ${def.mag} rnd`
      : entry.id === 'frag' ? `Blast radius ${def.radius} m` : `Blocks sight ${def.duration} s`;
    row.innerHTML = `<span class="buy-key">${BUY_MENU.indexOf(entry) + 1}</span>`
      + `<span class="buy-name">${def.name}</span>`
      + `<span class="buy-detail">${detail}</span>`
      + `<span class="buy-price">$${def.price}</span>`;
    row.addEventListener('click', () => {
      if (onBuy) onBuy(entry.id);
    });
    el.buyList.appendChild(row);
  }

  function showBanner(title, sub = '', ms = 2600) {
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
    el.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      el.banner.hidden = true;
    }, ms);
  }

  function hideBanner() {
    clearTimeout(bannerTimer);
    el.banner.hidden = true;
  }

  return {
    onBuy(handler) {
      onBuy = handler;
    },
    onPlay(handler) {
      el.playButton.addEventListener('click', handler);
    },
    showBanner,
    hideBanner,
    hitMarker(killed, holdMs = 120) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', !!killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        el.hitmarker.classList.remove('on', 'kill');
      }, holdMs);
    },
    damageFlash() {
      el.vignette.classList.add('on');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => el.vignette.classList.remove('on'), 220);
    },
    setScoped(scoped) {
      el.scope.hidden = !scoped;
    },
    setCrosshairGap(px) {
      const value = Math.round(px * 10) / 10;
      if (last.gap === value) return;
      last.gap = value;
      el.crosshair.style.setProperty('--gap', `${value}px`);
    },
    showBuyMenu(show) {
      el.buyMenu.hidden = !show;
      if (show) this.refreshBuy(0);
    },
    refreshBuy(money) {
      setText(el.buyMoney, 'buyMoney', `$${money}`);
      for (const row of el.buyList.children) {
        const entry = BUY_MENU.find((item) => item.id === row.dataset.buy);
        const def = entry.kind === 'weapon' ? WEAPONS[entry.id] : GRENADES[entry.id];
        row.classList.toggle('cant', money < def.price);
      }
    },
    showChannel(show, label, progress) {
      el.channel.hidden = !show;
      if (!show) return;
      setText(el.channelLabel, 'channelLabel', label);
      const pct = Math.round(progress * 100);
      if (last.channelPct !== pct) {
        last.channelPct = pct;
        el.channelFill.style.width = `${pct}%`;
      }
    },
    setHint(text) {
      setText(el.hint, 'hint', text);
    },
    showOverlay(title, copy, action) {
      el.overlayTitle.textContent = title;
      el.overlayCopy.textContent = copy;
      el.playButton.textContent = action;
      el.overlay.hidden = false;
      el.playButton.focus();
    },
    hideOverlay() {
      el.overlay.hidden = true;
    },
    sync(state) {
      const player = state.player;
      let vanAlive = 0;
      let warAlive = 0;
      for (const actor of state.actors) {
        if (!actor.alive) continue;
        if (actor.team === 'van') vanAlive += 1;
        else warAlive += 1;
      }
      setText(el.healthValue, 'hp', String(Math.max(0, Math.ceil(player.health))));
      const hpPct = Math.max(0, player.health);
      if (last.hpPct !== hpPct) {
        last.hpPct = hpPct;
        el.healthFill.style.width = `${hpPct}%`;
        el.healthFill.classList.toggle('low', hpPct <= 30);
      }
      setText(el.moneyValue, 'money', `$${state.money}`);
      const ammo = player.ammo[player.weapon];
      setText(el.ammoMag, 'mag', ammo ? String(ammo.mag) : '—');
      setText(el.ammoReserve, 'reserve', ammo ? `/ ${ammo.reserve}` : '');
      setText(el.weaponName, 'weapon', WEAPONS[player.weapon].name);
      setText(el.grenadeFrag, 'frag', `Frag ${player.grenades.frag}`);
      setText(el.grenadeSmoke, 'smoke', `Smoke ${player.grenades.smoke}`);
      setText(el.scoreVan, 'sv', String(state.score.van));
      setText(el.scoreWar, 'sw', String(state.score.war));
      setText(el.roundValue, 'round', `ROUND ${state.round}`);
      setText(el.aliveVan, 'av', String(vanAlive));
      setText(el.aliveWar, 'aw', String(warAlive));
      const bomb = state.bomb;
      const planted = bomb.status === 'planted';
      setText(el.timerValue, 'timer', planted ? `💣 ${Math.ceil(bomb.timer)}` : `${Math.ceil(state.roundTime)}`);
      el.timerValue.classList.toggle('bomb', planted);
      setText(el.bombCarry, 'carry', bomb.status === 'carried' && bomb.carrier === 'player' ? '● CARRYING THE CHARGE' : bomb.status === 'dropped' ? '● CHARGE DROPPED' : '');
      el.bombTimer.hidden = !planted;
      if (planted) setText(el.bombTimer, 'bombTimer', `CHARGE AT SITE ${bomb.site} — ${Math.ceil(bomb.timer)}s`);

      // Kill feed: rebuild only when the newest entry changes.
      const newest = state.kills[0];
      const newestKey = newest ? `${newest.text}@${newest.time}` : '';
      if (last.killKey !== newestKey) {
        last.killKey = newestKey;
        el.killfeed.innerHTML = '';
        for (const kill of state.kills) {
          const line = document.createElement('div');
          line.className = `kill-line ${kill.team || ''}`;
          line.textContent = kill.text;
          el.killfeed.appendChild(line);
        }
      }
    },
  };
}
