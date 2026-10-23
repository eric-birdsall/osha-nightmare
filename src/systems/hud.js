import { CONFIG } from '../config.js';

// Per-view HUD overlays (DOM). One view per character; single player shows only the active one.

const VIEW_HTML = (role) => `
  <div class="topright">
    <div class="timer card">00:00</div>
  </div>
  <div class="roles card">
    <span data-r="climber">🧗 Dave</span><span data-r="driver">🚜 Ralph</span>
    <span class="swaphint">Tab / View to swap</span>
  </div>
  ${
    role === 'climber'
      ? `<div class="crosshair"></div><div class="prompt"></div>
         <div class="holdring"><svg viewBox="0 0 44 44"><circle class="trk" cx="22" cy="22" r="18"/><circle class="fil" cx="22" cy="22" r="18"/></svg></div>`
      : '' /* speed, gear and fork height are on the forklift's dashboard */
  }
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
          p = `On the ladder · ${climb} · No jumping!`;
        } else if (c.ladderCarry) p = c.ladderPlaceOk ? `Set up ladder <kbd>${key}</kbd>` : 'Find flat, clear floor for the ladder';
        else if (c.target?.kind === 'ladder') {
          if (!c.target.standing) p = `Pick up ladder <kbd>${key}</kbd>`;
          else p = `Walk into the steps to climb · Fold ladder <kbd>${key}</kbd>`;
        }
        else if (c.onBlades && !c.carried && !c.target) p = `Hold on <kbd>${key}</kbd>`;
        else if (c.carried) {
          const n = c.carriedBoxes().length;
          const toss = `Toss${n > 1 ? ' top box' : ''} <kbd>${game.keyHint(role, 'toss')}</kbd>`;
          p = n > 1 ? `Put down ${n} boxes <kbd>${key}</kbd> · ${toss}` : `Put down SKU ${c.carried.sku} <kbd>${key}</kbd> · ${toss}`;
        } else if (c.target) {
          const n = c.targetStack;
          p = n > 1 && n <= CONFIG.climber.maxCarry
            ? `Pick up ${n} boxes <kbd>${key}</kbd> · bottom SKU ${c.target.sku}`
            : `Pick up SKU ${c.target.sku} <kbd>${key}</kbd>`;
        }
        // Knocked-over racking nearby: offer the reset (alongside any box prompt), and fill a
        // ring round the crosshair while E/X is held
        const hold = CONFIG.racks.resetHoldTime;
        const resetting = c.resetTimer > 0;
        if (c.nearKnockedRack && !c.onLadder && !c.ladderCarry && c.state === 'walk') {
          const r = resetting ? `Resetting the racking… ${Math.ceil(hold - c.resetTimer)}` : `Hold <kbd>${key}</kbd> ${hold} s to reset the racking`;
          p = p ? `${p}<br><small>${r}</small>` : r;
        }
        v.holdRing.style.display = resetting ? '' : 'none';
        if (resetting) v.holdFill.style.strokeDashoffset = String(113.1 * (1 - Math.min(1, c.resetTimer / hold)));
        v.prompt.innerHTML = p;
        v.prompt.style.display = p ? '' : 'none';
        v.crosshair.classList.toggle('hot', !!c.target);
        v.fade.style.opacity = Math.max(c.fade, c.fadeIn / 0.5);
      } else {
        v.fade.style.opacity = 0;
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
