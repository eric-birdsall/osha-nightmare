import { CONFIG } from '../config.js';

// Per-view HUD overlays (DOM). One view per character; single player shows only the active one.

const VIEW_HTML = (role) => `
  <div class="topright">
    <div class="timer card">00:00</div>
  </div>
  <div class="roles card">
    <span data-r="driver">Ralph</span>
    <span data-r="climber">Dave</span>
    <span class="swaphint">Tab / View to swap</span>
  </div>
  ${
    role === 'climber'
      ? `<div class="crosshair"></div><div class="prompt"></div>`
      : /* speed, gear and fork height are on the forklift's dashboard */
        `<div class="driftmeter"><div class="bar"><div class="fill"></div></div><div class="label"></div></div>`
  }
  <div class="holdring"><svg viewBox="0 0 44 44"><circle class="trk" cx="22" cy="22" r="18"/><circle class="fil" cx="22" cy="22" r="18"/></svg></div>
  <div class="rolelabel">${role === 'climber' ? 'DAVE · CLIMBER' : 'RALPH · DRIVER'}</div>
  <div class="toast"></div>
  <div class="banner"></div>
  <div class="devicehint"></div>
  <div class="fade"></div>
`;

const fmt = (t) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export class Hud {
  constructor(container) {
    this.container = container;
    this.views = {};
    for (const role of ['climber', 'driver']) {
      const el = document.createElement('div');
      el.className = `view ${role}`;
      el.innerHTML = VIEW_HTML(role);
      container.appendChild(el);
      const q = (s) => el.querySelector(s);
      this.views[role] = {
        el,
        timer: q('.timer'),
        roles: q('.roles'),
        prompt: q('.prompt'),
        holdRing: q('.holdring'),
        holdFill: q('.holdring .fil'),
        crosshair: q('.crosshair'),
        toast: q('.toast'),
        banner: q('.banner'),
        deviceHint: q('.devicehint'),
        fade: q('.fade'),
        driftMeter: q('.driftmeter'),
        driftFill: q('.driftmeter .fill'),
        driftLabel: q('.driftmeter .label'),
      };
    }
    this.toastUntil = 0;
    this.bannerUntil = 0;
  }

  show(on) {
    this.container.style.display = on ? '' : 'none';
  }

  toast(text, secs = 2) {
    for (const v of Object.values(this.views)) {
      v.toast.textContent = text;
      v.toast.classList.add('on');
    }
    this.toastUntil = performance.now() + secs * 1000;
  }

  banner(text, secs = 2.2) {
    for (const v of Object.values(this.views)) {
      v.banner.innerHTML = text;
      v.banner.classList.remove('on');
      void v.banner.offsetWidth;
      v.banner.classList.add('on');
    }
    this.bannerUntil = performance.now() + secs * 1000;
  }

  update(game) {
    const now = performance.now();
    // How far through holding Q / Y to go back to the start (0..1)
    const respawn = (role) => Math.min(1, Math.max(0, game.respawnHold?.[role] || 0) / CONFIG.input.respawnHoldTime);
    const single = game.mode === 'single';
    for (const [role, v] of Object.entries(this.views)) {
      const visible = !single || game.active === role;
      v.el.style.display = visible ? '' : 'none';
      v.el.classList.toggle('split', !single);
      v.el.classList.toggle('top', !single && role === 'climber');
      v.el.classList.toggle('bottom', !single && role === 'driver');
      if (!visible) continue;
      // The pick list isn't on the HUD: it's a clipboard in the forklift cab
      v.timer.textContent = fmt(game.time);
      v.roles.style.display = single ? '' : 'none';
      if (single) {
        for (const s of v.roles.querySelectorAll('[data-r]')) s.classList.toggle('on', s.dataset.r === game.active);
      }
      v.deviceHint.textContent = [game.deviceHints[role], game.usesKeyboard(role) ? game.lookHint : '']
        .filter(Boolean)
        .join(' · ');
      if (role === 'climber') {
        const c = game.climber;
        const ragdoll = c.state === 'ragdoll';
        v.crosshair.style.display = ragdoll ? 'none' : '';
        let p = '';
        const key = game.keyHint(role, 'interact');
        if (c.state === 'wrapped') p = 'You are wrapped. Wait for it…';
        else if (c.holdingOn) p = `Holding on · Let go <kbd>${key}</kbd>`;
        else if (c.onLadder && !c.carried && !c.target) {
          const climb = game.usesKeyboard(role) ? '<kbd>W</kbd> <kbd>S</kbd> climb' : 'Stick up / down to climb';
          p = `On the ladder · ${climb}<br><small>Jumping off knocks it over</small>`;
        } else if (c.ladderCarry) p = c.ladderPlaceOk ? `Set up ladder <kbd>${key}</kbd>` : 'Find flat, clear floor for the ladder';
        else if (c.target?.kind === 'ladder') {
          if (!c.target.standing) p = `Pick up ladder <kbd>${key}</kbd>`;
          else p = `Walk into the steps to climb · Fold ladder <kbd>${key}</kbd>`;
        }
        else if (c.onBlades && !c.carried && !c.target) p = `Hold on <kbd>${key}</kbd>`;
        else if (c.carried) {
          const n = c.carriedBoxes().length;
          const toss = `Punt${n > 1 ? ' top box' : ''} <kbd>${game.keyHint(role, 'toss')}</kbd>`;
          const fragile = c.carriedBoxes().some((b) => b.fragile) ? ' <b class="fragile">FRAGILE</b>' : '';
          p = (n > 1 ? `Put down ${n} boxes <kbd>${key}</kbd> · ${toss}` : `Put down SKU ${c.carried.sku} <kbd>${key}</kbd> · ${toss}`) + fragile;
        } else if (c.target) {
          const n = c.targetStack;
          p = n > 1 && n <= CONFIG.climber.maxCarry
            ? `Pick up ${n} boxes <kbd>${key}</kbd> · bottom SKU ${c.target.sku}`
            : `Pick up SKU ${c.target.sku} <kbd>${key}</kbd>${c.target.fragile ? ' <b class="fragile">FRAGILE</b>' : ''}`;
        }
        // Knocked-over racking nearby: offer the reset (alongside any box prompt), and fill a
        // ring round the crosshair while E/X is held
        const hold = CONFIG.racks.resetHoldTime;
        const resetting = c.resetTimer > 0;
        if (c.nearKnockedRack && !c.onLadder && !c.ladderCarry && c.state === 'walk') {
          const r = resetting ? `Resetting the racking… ${Math.ceil(hold - c.resetTimer)}` : `Hold <kbd>${key}</kbd> ${hold} s to reset the racking`;
          p = p ? `${p}<br><small>${r}</small>` : r;
        }
        // A fallen ladder nearby (hands empty): hold R / RB to stand it back up
        const upHold = CONFIG.ladder.uprightHoldTime;
        const uprighting = c.uprightTimer > 0;
        if (c.fallenLadder && c.state === 'walk') {
          const r = uprighting ? 'Standing the ladder up…' : `Stand the ladder up: hold <kbd>${game.keyHint(role, 'toss')}</kbd>`;
          p = p ? `${p}<br><small>${r}</small>` : r;
        }
        // Aiming a punt: the arc and ghost show where it will land
        if (c.aimingPunt) p = 'Let go to punt it<br><small>Aim higher to punt further</small>';
        // The same ring fills while Q / Y is held to go back to the start
        if (respawn(role) > 0) p = p ? `${p}<br><small>Going back to the start…</small>` : 'Going back to the start…';
        const back = respawn(role);
        const ring = Math.min(1, Math.max(back, resetting ? c.resetTimer / hold : 0, uprighting ? c.uprightTimer / upHold : 0));
        v.holdRing.style.display = ring > 0 ? '' : 'none';
        if (ring > 0) v.holdFill.style.strokeDashoffset = String(113.1 * (1 - ring));
        v.prompt.innerHTML = p;
        v.prompt.style.display = p ? '' : 'none';
        v.crosshair.classList.toggle('hot', !!c.target);
        v.fade.style.opacity = Math.max(c.fade, c.fadeIn / 0.5);
      } else {
        v.fade.style.opacity = 0;
        // Q / Y held: the ring fills on the way back to the parking bay
        const back = respawn(role);
        v.holdRing.style.display = back > 0 ? '' : 'none';
        if (back > 0) v.holdFill.style.strokeDashoffset = String(113.1 * (1 - back));
        // Drift meter: fills orange while a drift charges, blue once the boost is earned,
        // then BOOST! while it fires (Ralph can't see the sparks from the seat)
        const f = game.forklift;
        const need = CONFIG.forklift.drift.boostCharge;
        const charge = f.driftCharge || 0;
        const state = f.boostTime > 0 ? 'boost' : charge >= need ? 'ready' : (f.drift || 0) > 0.5 ? 'charging' : '';
        v.driftMeter.className = `driftmeter ${state}`;
        if (state) {
          v.driftFill.style.width = `${state === 'charging' ? Math.min(1, charge / need) * 100 : 100}%`;
          v.driftLabel.textContent = state === 'boost' ? 'BOOST!' : state === 'ready' ? 'BOOST READY · let go!' : 'DRIFT';
        }
      }
    }
    if (this.toastUntil && now > this.toastUntil) {
      this.toastUntil = 0;
      for (const v of Object.values(this.views)) v.toast.classList.remove('on');
    }
    if (this.bannerUntil && now > this.bannerUntil) {
      this.bannerUntil = 0;
      for (const v of Object.values(this.views)) v.banner.classList.remove('on');
    }
  }
}
