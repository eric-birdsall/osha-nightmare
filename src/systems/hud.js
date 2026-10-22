// Per-view HUD overlays (DOM). One view per character; single player shows only the active one.

const VIEW_HTML = (role) => `
  <div class="order clipboard">
    <div class="clip"></div>
    <div class="paper">
      <div class="otitle"><span>PICK LIST</span><span>ORDER #1</span></div>
      <table class="otable">
        <tr><th>Item</th><th>Location</th><th></th></tr>
        <tr class="oitem" data-item="A"><td><span class="sw a"></span>Item A</td><td class="loc"></td><td><span class="chk"></span></td></tr>
        <tr class="oitem" data-item="B"><td><span class="sw b"></span>Item B</td><td class="loc"></td><td><span class="chk"></span></td></tr>
      </table>
      <div class="odest">Wrap, then ship to <b>DOCK 1</b></div>
      <div class="osign">Picked by</div>
    </div>
  </div>
  <div class="topright">
    <div class="timer card">00:00</div>
    <div class="days card"><div class="dl">DAYS SINCE LAST INCIDENT</div><div class="dn">47</div></div>
  </div>
  <div class="roles card">
    <span data-r="climber">🧗 Dave</span><span data-r="driver">🚜 Ralph</span>
    <span class="swaphint">Tab / View to swap</span>
  </div>
  ${
    role === 'climber'
      ? `<div class="crosshair"></div><div class="prompt"></div>`
      : `<div class="forkh card"><div class="fl">FORKS</div><div class="fv">0.10 m</div><div class="fbar"><div class="ffill"></div></div></div>
         <div class="gear card">D</div>`
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
        items: { A: q('[data-item="A"]'), B: q('[data-item="B"]') },
        timer: q('.timer'),
        days: q('.days'),
        daysN: q('.dn'),
        roles: q('.roles'),
        prompt: q('.prompt'),
        crosshair: q('.crosshair'),
        forkV: q('.fv'),
        forkFill: q('.ffill'),
        gear: q('.gear'),
        toast: q('.toast'),
        banner: q('.banner'),
        deviceHint: q('.devicehint'),
        fade: q('.fade'),
      };
    }
    this.toastUntil = 0;
    this.bannerUntil = 0;
    this.lastDays = null;
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
      for (const k of ['A', 'B']) {
        v.items[k].classList.toggle('done', !!game.itemStatus[k]);
        const loc = v.items[k].querySelector('.loc');
        const code = game.level.itemLocations[k];
        if (loc.textContent !== code) loc.textContent = code;
      }
      v.timer.textContent = fmt(game.time);
      v.daysN.textContent = game.days;
      v.days.classList.toggle('zero', game.days === 0);
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
        else if (c.onBlades && !c.carried && !c.target) p = `Hold on <kbd>${key}</kbd>`;
        else if (c.carried) p = `Put down <kbd>${key}</kbd>`;
        else if (c.target) p = `Pick up${c.target.item ? ' Item ' + c.target.item : ''} <kbd>${key}</kbd>`;
        v.prompt.innerHTML = p;
        v.prompt.style.display = p ? '' : 'none';
        v.crosshair.classList.toggle('hot', !!c.target);
        v.fade.style.opacity = Math.max(c.fade, c.fadeIn / 0.5);
      } else {
        const f = game.forklift;
        v.forkV.textContent = `${f.height.toFixed(2)} m`;
        v.forkFill.style.height = `${(f.height / 3.5) * 100}%`;
        v.gear.textContent = f.gear === 1 ? 'D' : 'R';
        v.gear.classList.toggle('rev', f.gear === -1);
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
