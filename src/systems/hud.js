// Per-view HUD overlays (DOM). One view per character; single player shows only the active one.

const VIEW_HTML = (role) => `
  <div class="order clipboard">
    <div class="clip"></div>
    <div class="paper">
      <div class="otitle"><span>PICK LIST</span><span>ORDER #1</span></div>
      <table class="otable">
        <tr><th>SKU</th><th>Qty</th><th>Location</th><th></th></tr>
        <tr class="oitem" data-item="A"><td class="sku"></td><td class="qty"></td><td class="loc"></td><td><span class="chk"></span></td></tr>
        <tr class="oitem" data-item="B"><td class="sku"></td><td class="qty"></td><td class="loc"></td><td><span class="chk"></span></td></tr>
      </table>
      <div class="odest">Wrap, then ship to <b>DOCK 1</b></div>
      <div class="osign">Picked by</div>
    </div>
  </div>
  <div class="topright">
    <div class="timer card">00:00</div>
  </div>
  <div class="roles card">
    <span data-r="climber">🧗 Dave</span><span data-r="driver">🚜 Ralph</span>
    <span class="swaphint">Tab / View to swap</span>
  </div>
  ${
    role === 'climber'
      ? `<div class="crosshair"></div><div class="prompt"></div>`
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
        items: { A: q('[data-item="A"]'), B: q('[data-item="B"]') },
        timer: q('.timer'),
        roles: q('.roles'),
        prompt: q('.prompt'),
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
      for (const k of ['A', 'B']) {
        const line = game.level.order.find((o) => o.line === k);
        const have = Math.min(line.qty, game.itemStatus[k]);
        v.items[k].classList.toggle('done', have >= line.qty);
        // Quantity, with a running tally once some are on the pallet: "2/3"
        const qty = v.items[k].querySelector('.qty');
        const qtyText = have > 0 && have < line.qty ? `${have}/${line.qty}` : String(line.qty);
        if (qty.textContent !== qtyText) qty.textContent = qtyText;
        const loc = v.items[k].querySelector('.loc');
        const sku = v.items[k].querySelector('.sku');
        if (loc.textContent !== line.location) loc.textContent = line.location;
        if (sku.textContent !== String(line.sku)) sku.textContent = line.sku;
      }
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
          else if (c.foldTimer > 0) p = `Folding ladder${'.'.repeat(1 + Math.floor((c.foldTimer / 0.5) * 3))}`;
          else p = `Walk into the steps to climb · Hold <kbd>${key}</kbd> to fold`;
        }
        else if (c.onBlades && !c.carried && !c.target) p = `Hold on <kbd>${key}</kbd>`;
        else if (c.carried) p = `Put down SKU ${c.carried.sku} <kbd>${key}</kbd>`;
        else if (c.target) p = `Pick up SKU ${c.target.sku} <kbd>${key}</kbd>`;
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
