import { forkViewBounds, showForkFeed } from './fork-view.js';
import { CONFIG } from '../config.js';

// The reference belongs to this view's character and uses only its current input device.
export function basicControls(game, role) {
  const keyboard = game.usesKeyboard(role);
  const key = (action) => `<kbd>${game.keyHint(role, action)}</kbd>`;
  const row = (name, control) => `<div><dt>${name}</dt><dd>${control}</dd></div>`;
  const rows = role === 'driver' ? [
    ['Steer', keyboard ? '<kbd>A</kbd> <kbd>D</kbd>' : 'Left stick ← →'],
    ['Look', keyboard ? 'Mouse ↑ ↓ · I / K' : 'Right stick ↑ ↓'],
    ['Gas / brake', `${key('gas')} ${key('brake')}`],
    ['Forks ↑ / ↓', `${key('lift')} ${key('lower')}`],
    ['Fork camera', key('forkView')],
    ['Drift', `Hold ${key('drift')}`],
    ['Reset truck', `Hold ${key('reset')}`],
  ] : [
    ['Move', keyboard ? '<kbd>WASD</kbd>' : 'Left stick'],
    ['Look', keyboard ? 'Mouse · IJKL' : 'Right stick'],
    ['Jump', key('jump')],
    ['Crouch', `Hold ${key('crouch')}`],
    ['Use / carry', key('interact')],
    ['Punt / drag / cut', `Hold ${key('interact')}`],
    ['Reset rack', `Hold ${key('toss')}`],
    ['Back to start', `Hold ${key('reset')}`],
  ];
  return `<strong>${role === 'driver' ? 'RALPH' : 'DAVE'} · CONTROLS</strong><dl>${rows.map(([label, control]) => row(label, control)).join('')}</dl>`;
}

// Per-view HUD overlays (DOM). One view per character; single player shows only the active one.

const VIEW_HTML = (role) => `
  <div class="topright">
    <div class="timer card">00:00</div>
    <div class="timer-pen">+15 s</div>
  </div>
  <div class="roles card">
    <span data-r="driver">Ralph</span>
    <span data-r="climber">Dave</span>
    <span class="swaphint"></span>
  </div>
  ${
    role === 'climber'
      ? `<div class="crosshair"></div><div class="prompt"></div>`
      : /* speed, gear and fork height are on the forklift's dashboard */
        `<div class="fork-readout card"></div><div class="fork-feed"><span>FORK CAMERA</span></div><div class="driftmeter"><div class="bar"><div class="fill"></div></div><div class="label"></div></div><div class="prompt"></div>`
  }
  <div class="tutorial card" role="status"><strong></strong><p></p></div>
  <div class="holdring"><svg viewBox="0 0 44 44"><circle class="trk" cx="22" cy="22" r="18"/><circle class="fil" cx="22" cy="22" r="18"/></svg></div>
  <div class="rolelabel">${role === 'climber' ? 'DAVE · CLIMBER' : 'RALPH · DRIVER'}</div>
  <div class="toast"></div>
  <div class="banner osha-plate"></div>
  <aside class="basic-controls" aria-label="Basic controls"></aside>
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
        tutorial: q('.tutorial'),
        timer: q('.timer'),
        timerPen: q('.timer-pen'),
        roles: q('.roles'),
        prompt: q('.prompt'),
        holdRing: q('.holdring'),
        holdFill: q('.holdring .fil'),
        crosshair: q('.crosshair'),
        toast: q('.toast'),
        banner: q('.banner'),
        deviceHint: q('.devicehint'),
        controls: q('.basic-controls'),
        fade: q('.fade'),
        forkReadout: q('.fork-readout'),
        forkFeed: q('.fork-feed'),
        driftMeter: q('.driftmeter'),
        driftFill: q('.driftmeter .fill'),
        driftLabel: q('.driftmeter .label'),
      };
    }
    this.toastUntil = 0;
    this.bannerUntil = 0;
    this.penaltyUntil = 0; // the timer flashes red with "+15 s" for a moment after an incident
    this.seenFalls = 0;
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
    if (game.falls > this.seenFalls) this.penaltyUntil = performance.now() + 1600;
    this.seenFalls = game.falls;
    const flashing = performance.now() < this.penaltyUntil;
    for (const [role, v] of Object.entries(this.views)) {
      const visible = !single || game.active === role;
      v.el.style.display = visible ? '' : 'none';
      v.el.classList.toggle('split', !single);
      v.el.classList.toggle('top', !single && role === 'climber');
      v.el.classList.toggle('bottom', !single && role === 'driver');
      if (!visible) continue;
      const controlsKey = `${role}:${game.usesKeyboard(role)}`;
      if (v.controlsKey !== controlsKey) {
        v.controlsKey = controlsKey;
        v.controls.innerHTML = basicControls(game, role);
      }
      const guide = game.tutorial?.content(role);
      v.tutorial.style.display = guide ? '' : 'none';
      if (guide) {
        v.tutorial.querySelector('strong').textContent = guide.title;
        v.tutorial.querySelector('p').innerHTML = guide.detail;
      }
      // The pick list isn't on the HUD: it's a clipboard in the forklift cab
      // The time on the clock is the score: the shift so far plus the incident penalties
      v.timer.textContent = fmt(game.time + game.falls * CONFIG.score.incidentPenalty);
      v.timer.classList.toggle('hit', flashing);
      v.timerPen.textContent = `+${CONFIG.score.incidentPenalty} s`;
      v.timerPen.classList.toggle('on', flashing);
      v.roles.style.display = single ? '' : 'none';
      v.roles.querySelector('.swaphint').innerHTML = `<kbd>${game.keyHint(role, 'swap')}</kbd> to swap`;
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

        else if (c.cutTarget) p = c.cutTimer > 0 ? 'Cutting shrinkwrap…' : `Cut shrinkwrap: hold <kbd>${key}</kbd>`;
        else if (c.findDragPallet()) p = c.draggedPallet ? `Dragging pallet · release <kbd>${key}</kbd> to let go` : `Drag empty pallet: hold <kbd>${key}</kbd> and move`;
        else if (c.holdingOn && c.target?.kind !== 'box') p = `Holding on · Let go <kbd>${key}</kbd>`;
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
          const toss = `Punt${n > 1 ? ' top box' : ''}: hold <kbd>${key}</kbd>`;
          const fragile = c.carriedBoxes().some((b) => b.fragile) ? ' <b class="fragile">FRAGILE</b>' : '';
          p = (n > 1 ? `Put down ${n} boxes: tap <kbd>${key}</kbd> · ${toss}` : `Put down SKU ${c.carried.sku}: tap <kbd>${key}</kbd> · ${toss}`) + fragile;
        } else if (c.target?.kind === 'freight') {
          p = `SKU ${c.target.sku} · ${c.target.mass} kg · Forklift only`;
        } else if (c.target) {
          const n = c.targetStack;
          p = n > 1 && n <= CONFIG.climber.maxCarry
            ? `Pick up ${n} boxes <kbd>${key}</kbd> · bottom SKU ${c.target.sku}`
            : `Pick up SKU ${c.target.sku} <kbd>${key}</kbd>${c.target.fragile ? ' <b class="fragile">FRAGILE</b>' : ''}`;
        }
        if (c.holdingOn && c.target?.kind === 'box') p += '<br><small>Lets go of the forks</small>';
        // Knocked-over racking nearby: offer the reset (alongside any box prompt), and fill a
        // ring round the crosshair while R/RB is held
        const hold = CONFIG.racks.resetHoldTime;
        const resetting = c.resetTimer > 0;
        if (c.nearKnockedRack && !c.onLadder && !c.ladderCarry && c.state === 'walk') {
          const r = resetting ? `Resetting the racking… ${Math.ceil(hold - c.resetTimer)}` : `Hold <kbd>${game.keyHint(role, 'toss')}</kbd> ${hold} s to reset the racking`;
          p = p ? `${p}<br><small>${r}</small>` : r;
        }
        // A tipped-over pallet nearby (hands empty): hold E / X to flip it flat
        const flipHold = CONFIG.climber.palletFlipHoldTime;
        const flipping = c.flipTimer > 0;
        if (c.tippedPallet && c.state === 'walk') {
          const what = c.tippedPallet.kind === 'wrapped' ? 'load' : 'pallet';
          const r = flipping ? `Flipping the ${what}…` : `Flip the ${what} upright: hold <kbd>${key}</kbd>`;
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
        if (c.crouched) p += `${p ? '<br>' : ''}<small>Crouched · ${c.crouchRequested ? `Release <kbd>${game.keyHint(role, 'crouch')}</kbd> to stand` : 'Stay low until there is room to stand'}</small>`;
        if (c.aimingPunt) p = 'Let go to punt it<br><small>Aim higher to punt further</small>';
        // The same ring fills while Q / Y is held to go back to the start
        if (respawn(role) > 0) p = p ? `${p}<br><small>Going back to the start…</small>` : 'Going back to the start…';
        const back = respawn(role);
        const ring = Math.min(1, Math.max(back, c.cutTimer || 0, resetting ? c.resetTimer / hold : 0, uprighting ? c.uprightTimer / upHold : 0, flipping ? c.flipTimer / flipHold : 0));
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
        v.forkReadout.innerHTML = `FORKS <b>${f.measuredHeight().toFixed(2)} m</b><small>${f.forkViewExpanded ? 'FORK CAMERA' : 'SEAT VIEW'} · ${game.keyHint(role, 'forkView')} to ${f.forkViewExpanded ? 'return' : 'expand camera'}</small>`;
        v.forkFeed.style.display = showForkFeed(f) ? '' : 'none';
        const bounds = forkViewBounds(v.el.clientWidth, v.el.clientHeight);
        for (const [key, value] of Object.entries(bounds)) v.forkFeed.style[key] = `${value}px`;

        // Ralph owns recovery, including when the truck is on its side.
        const tip = f.tipped ? `Forklift tipped · hold <kbd>${game.keyHint('driver', 'reset')}</kbd> to reset upright in parking` : '';
        const storageHint = game.level.storage?.hint(f) || '';
        v.prompt.innerHTML = tip || storageHint;
        v.prompt.style.display = (tip || storageHint) ? '' : 'none';
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
