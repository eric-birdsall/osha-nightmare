import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';
import { Input } from './systems/input.js';
import { Hud } from './systems/hud.js';
import { Game } from './systems/game.js';
import { unlockAudio, sfx } from './systems/audio.js';
import { DOCKS, ORDERS } from './world/level.js';
import { drawFloorPlan } from './world/floorplan.js';
import { best, submit, medalFor, nextMedal, fmtTime, FULL_SHIFT, levelDef } from './systems/records.js';
import { settings } from './systems/settings.js';
import { RECEIVING_ORDERS } from './world/receiving-orders.js';

await RAPIER.init();

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

const input = new Input(canvas);
const hud = new Hud(document.getElementById('hud'));
drawFloorPlan(document.querySelector('#pause .map svg'));
for (const screen of ['title', 'levels']) {
  drawFloorPlan(document.querySelector(`#${screen} .map svg`), { idPrefix: screen, showPlayers: false });
}
document.getElementById('loading').remove();

let game = null;
let state = 'title'; // 'title' | 'playing' | 'paused' | 'complete'
let overlay = null; // Controls or How to Play, on top of a menu
let pausedAt = 0;
let acc = 0;
let last = performance.now();

// ---------------------------------------------------------------- menus

const screens = {
  title: document.getElementById('title'),
  pause: document.getElementById('pause'),
  complete: document.getElementById('complete'),
  controls: document.getElementById('controls'),
  howto: document.getElementById('howto'),
  levels: document.getElementById('levels'),
  jobs: document.getElementById('jobs'),
};
let pickJob = 'picking';
let pickMode = 'single'; // the mode chosen on the title screen, while picking a level
let focusIdx = 0;

function visibleScreen() {
  if (overlay) return screens[overlay];
  if (state === 'title') return screens.title;
  if (state === 'paused') return screens.pause;
  if (state === 'complete') return screens.complete;
  return null;
}

function buttons(el) {
  return [...el.querySelectorAll('.btn')].filter((b) => b.offsetParent !== null && !b.disabled);
}

function refreshScreens() {
  const vis = visibleScreen();
  for (const s of Object.values(screens)) s.classList.toggle('hidden', s !== vis);
  for (const b of document.querySelectorAll('.coop-only')) b.style.display = game?.mode === 'coop' ? '' : 'none';
  focusIdx = 0;
  // The Controls screen opens on Back, so a stray confirm can't flip Invert Look
  if (vis) setFocus(vis === screens.controls ? Math.max(0, buttons(vis).findIndex((b) => b.dataset.act === 'back')) : 0);
}

function setFocus(i) {
  const vis = visibleScreen();
  if (!vis) return;
  const bs = buttons(vis);
  if (!bs.length) return;
  focusIdx = (i + bs.length) % bs.length;
  bs.forEach((b, j) => b.classList.toggle('focus', j === focusIdx));
}

function menuNav() {
  const vis = visibleScreen();
  if (!vis) return;
  const m = input.menu();
  // How to Play is one long page with a single button: up and down scroll it instead
  if (overlay === 'howto' && (m.up || m.down)) {
    vis.querySelector('.panel').scrollBy({ top: m.up ? -160 : 160, behavior: 'smooth' });
  } else {
    if (m.up) {
      setFocus(focusIdx - 1);
      sfx.menu();
    }
    if (m.down) {
      setFocus(focusIdx + 1);
      sfx.menu();
    }
  }
  if (m.confirm) buttons(vis)[focusIdx]?.click();
  if ((m.back || m.pause) && performance.now() - pausedAt > 300) {
    if (overlay) closeOverlay();
    else if (state === 'paused') resume();
  }
}

function refreshInvert() {
  for (const b of document.querySelectorAll('[data-act="invert"] .osha-text')) {
    // Kit lettering: its chipped-paint layer reads data-text, so keep both in step
    b.textContent = b.dataset.text = `INVERT LOOK: ${input.invertY ? 'ON' : 'OFF'}`;
  }
}
refreshInvert();

// CCTV Replays: On/Off (after an incident, with the clock stopped while it plays)
function refreshCctv() {
  for (const b of document.querySelectorAll('[data-act="cctv"] .osha-text')) {
    b.textContent = b.dataset.text = `CCTV REPLAYS: ${settings.cctvReplays ? 'ON' : 'OFF'}`;
  }
}
refreshCctv();

function closeOverlay() {
  overlay = null;
  refreshScreens();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.btn');
  if (!b) return;
  unlockAudio();
  const act = b.dataset.act;
  if (act === 'single' || act === 'coop') {
    pickMode = act;
    overlay = 'jobs';
    refreshScreens();
  } else if (act === 'picking' || act === 'receiving') {
    pickJob = act;
    showLevels();
  } else if (act === 'level') startGame(pickMode, b.dataset.level === 'shift' || b.dataset.level.startsWith('receiving-') ? b.dataset.level : Number(b.dataset.level));
  else if (act === 'next') startGame(game.mode, game.receiving ? RECEIVING_ORDERS[RECEIVING_ORDERS.findIndex(o => o.id === game.levelId) + 1].id : game.orderId + 1);
  else if (act === 'levels') {
    pickMode = game.mode;
    pickJob = game.receiving ? 'receiving' : 'picking';
    quitToTitle();
    showLevels();
  } else if (act === 'controls' || act === 'howto') {
    overlay = act;
    screens[act].querySelector('.panel').scrollTop = 0; // always from the top
    refreshScreens();
  } else if (act === 'back') closeOverlay();
  else if (act === 'cctv') {
    settings.setCctvReplays(!settings.cctvReplays);
    refreshCctv();
  } else if (act === 'invert') {
    input.setInvertY(!input.invertY);
    refreshInvert();
  } else if (act === 'resume') resume();
  else if (act === 'restart') startGame(game.mode, game.levelId);
  else if (act === 'swaproles') {
    game.swapRoles();
    resume();
  } else if (act === 'quit') quitToTitle();
});

function quitToTitle() {
  game?.dispose();
  game = null;
  state = 'title';
  hud.show(false);
  refreshScreens();
}

// The level list for the chosen mode: Order 1-5 with this mode's best time and medal, then Full Shift
function showLevels() {
  document.querySelector('#levels .selection-title').textContent = pickJob === 'receiving' ? 'SELECT PURCHASE ORDER' : 'SELECT ORDER';
  document.getElementById('lv-mode').textContent = pickMode === 'coop' ? 'Couch co-op · split screen' : 'Single player · swap with Tab / View';
  const tag = (m) => (m ? `<i class="medal ${m}">${m}</i>` : '');
  const row = (id, label, name) => {
    const b = best(pickMode, id);
    const right = b ? `${fmtTime(b.total)} ${tag(medalFor(id, b.total))}` : '<span class="none">No time yet</span>';
    return `<button class="btn level" data-act="level" data-level="${id}"><span class="osha-text osha-text--ivory" data-text="${label}">${label}</span><span class="lv-name">${name}</span><span class="lv-best">${right}</span></button>`;
  };
  document.querySelector('#levels .level-list').innerHTML =
    pickJob === 'receiving' ? RECEIVING_ORDERS.map(o => row(o.id, o.number, o.title)).join('')
      : ORDERS.map((o) => row(o.id, `ORDER ${o.id}`, o.title)).join('') + row(FULL_SHIFT.id, 'FULL SHIFT', 'All five, back to back');
  overlay = 'levels';
  refreshScreens();
}
document.addEventListener('mousemove', (e) => {
  const b = e.target.closest?.('.btn');
  const vis = visibleScreen();
  if (b && vis) {
    const i = buttons(vis).indexOf(b);
    if (i >= 0 && i !== focusIdx) setFocus(i);
  }
});

function wantsPointer() {
  return game && (game.mode === 'single' || game.usesKeyboard('climber') || game.usesKeyboard('driver'));
}

function startGame(mode, order = 1) {
  game?.dispose();
  game = new Game({ mode, hud, order });
  game.assignDevices(input);
  game.onComplete = showComplete;
  state = 'playing';
  overlay = null;
  acc = 0;
  clearLatched();
  hud.show(true);
  refreshScreens();
  if (wantsPointer()) input.lockPointer();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  pausedAt = performance.now();
  // Light up this order's dock on the floor plan
  game.level.dock && document.querySelectorAll('#pause .fp-dock').forEach((r, i) => r.classList.add('open'));
  // Mark Dave and Ralph on the pause screen's floor plan (SVG x/y = world x/z)
  for (const [id, body] of [['fp-dave', game.climber.body], ['fp-ralph', game.forklift.body]]) {
    const t = body.translation();
    const dot = document.getElementById(id);
    dot.setAttribute('cx', t.x.toFixed(2));
    dot.setAttribute('cy', t.z.toFixed(2));
  }
  if (input.pointerLocked) document.exitPointerLock();
  refreshScreens();
}

function resume() {
  state = 'playing';
  clearLatched();
  overlay = null;
  refreshScreens();
  if (wantsPointer()) input.lockPointer();
}

const QUIPS = [
  'Flawless. Ralph and Dave are suspicious of themselves.',
  'Dave is fine. Mostly.',
  'Ralph would like it noted that Dave keeps getting in the way.',
  'OSHA has been notified. OSHA has questions for Ralph.',
];

function showComplete({ time, falls }) {
  state = 'complete';
  const id = game.levelId;
  const order = levelDef(id);
  const run = submit(game.mode, id, { time, incidents: falls });
  const $ = (x) => document.getElementById(x);
  const head = document.querySelector('#complete .screen-title');
  head.textContent = head.dataset.text = game.receiving ? 'STOCK RECEIVED' : id === 'shift' ? 'SHIFT COMPLETE' : 'ORDER COMPLETE';
  document.querySelector('#complete .stamp').textContent = game.receiving ? 'RECEIVED' : 'SHIPPED';
  $('c-order').textContent = `${game.receiving ? `${order.number} · ${order?.title ?? ''}` : id === 'shift' ? 'Full Shift · all five orders' : `Order ${id} · ${order?.title ?? ''}`} · ${game.mode === 'coop' ? 'Couch co-op' : 'Single player'}`;
  $('c-time').textContent = fmtTime(time);
  $('c-falls').textContent = falls;
  $('c-damage').textContent = `$${game.damage.total.toLocaleString('en-US')}`;
  $('c-penalty').textContent = falls ? `+${fmtTime(run.total - time)}` : '';
  $('c-total').textContent = fmtTime(run.total);
  $('c-best').textContent = fmtTime(run.best);
  $('c-newbest').hidden = !run.isNewBest;
  const medal = medalFor(id, run.total);
  const next = nextMedal(id, run.total);
  $('c-medal').innerHTML =
    (medal ? `<i class="medal ${medal}">${medal}</i> ` : '') + (next ? `${next.medal[0].toUpperCase() + next.medal.slice(1)} at ${fmtTime(next.at)}` : 'Top marks.');
  $('c-quip').textContent = QUIPS[Math.min(falls, 3)];
  // No order after the last one
  document.querySelector('#complete [data-act="next"]').style.display = (game.receiving ? RECEIVING_ORDERS.some(o => o.id === `receiving-${game.orderId + 1}`) : id !== 'shift' && ORDERS.some((o) => o.id === id + 1)) ? '' : 'none';
  if (input.pointerLocked) document.exitPointerLock();
  refreshScreens();
}

let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  const locked = input.pointerLocked;
  if (hadLock && !locked && state === 'playing') pause();
  hadLock = locked;
});
canvas.addEventListener('click', () => {
  unlockAudio();
  if (state === 'playing' && wantsPointer()) input.lockPointer();
});
addEventListener('keydown', unlockAudio, { once: true });

// ---------------------------------------------------------------- loop

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
}
addEventListener('resize', resize);
resize();

const noEdges = (a) => ({ ...a, lookX: 0, lookY: 0, jump: false, interact: false, toss: false, swap: false, pause: false, forkView: false });

// One-shot presses and look deltas collected since the last physics step.
const latched = { climber: null, driver: null };
function clearLatched() {
  latched.climber = { jump: false, interact: false, toss: false, lookX: 0, lookY: 0 };
  latched.driver = { lookX: 0, lookY: 0, forkView: false };
}
clearLatched();
function latch(actions) {
  const c = latched.climber;
  c.jump ||= actions.climber.jump;
  c.interact ||= actions.climber.interact;
  c.toss ||= actions.climber.toss;
  c.lookX += actions.climber.lookX;
  c.lookY += actions.climber.lookY;
  latched.driver.forkView ||= actions.driver.forkView;
  latched.driver.lookX += actions.driver.lookX;
  latched.driver.lookY += actions.driver.lookY;
}
const withLatched = (actions) => ({
  climber: { ...actions.climber, ...latched.climber },
  driver: { ...actions.driver, ...latched.driver },
});

function frame(now) {
  requestAnimationFrame(frame);
  if (!window.osha.manual) tick(now);
}

// One rendered frame of game logic (split out so playtest tools can drive it directly).
function tick(now) {
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  input.poll(dt);

  const padText = document.querySelector('.pads');
  if (state === 'title' && padText) {
    const n = input.padCount();
    padText.textContent = input.gamepadIssue || `Gamepads connected: ${n}${n ? '' : ' · click the game, then press A · see Controls for connection checks'}`;
  }

  if (overlay === 'controls') document.getElementById('controller-report').textContent = input.controllerReport();

  if (state === 'playing') {
    game.assignDevices(input);
    const actions = {
      climber: input.climberActions(game.devices.climber),
      driver: input.driverActions(game.devices.driver),
    };
    // Scripted playtest input from the console: osha.override = { climber: {...}, driver: {...} }
    if (window.osha.override) {
      Object.assign(actions.climber, window.osha.override.climber);
      Object.assign(actions.driver, window.osha.override.driver);
    }
    const kbPause = input.pressed.has('Escape');
    if (game.replay) {
      // Incident replay: the world (and the clock) is frozen; any button skips it
      const m = input.menu();
      const skip =
        actions.climber.jump || actions.climber.interact || actions.climber.pause || actions.driver.pause ||
        actions.climber.swap || actions.driver.swap || kbPause || m.confirm || m.back || input.pressed.size > 0;
      game.updateReplay(dt, skip);
      acc = 0;
      clearLatched(); // the skip press shouldn't also make the climber jump
    } else if (actions.climber.pause || actions.driver.pause || kbPause) {
      pause();
    } else {
      if (actions.climber.swap || actions.driver.swap) {
        game.swapCharacter();
        game.assignDevices(input);
      }
      // Physics runs at a fixed 60 Hz, but the display may run faster: on frames with no
      // physics step, hold on to button presses and look movement until a step uses them.
      latch(actions);
      const step = CONFIG.physics.dt;
      acc += dt;
      let n = 0;
      while (acc >= step && n < CONFIG.physics.maxStepsPerFrame) {
        game.step(step, n === 0 ? withLatched(actions) : { climber: noEdges(actions.climber), driver: noEdges(actions.driver) });
        acc -= step;
        n++;
      }
      if (n > 0) clearLatched();
      if (n === CONFIG.physics.maxStepsPerFrame) acc = 0;
      game.frame(dt);
    }
  } else {
    menuNav();
  }

  if (game) {
    game.lookHint =
      input.lockFailed && !input.pointerLocked ? 'Mouse lock unavailable: drag with a mouse button held, or use IJKL, to look' : '';
    game.render(renderer, innerWidth, innerHeight); // CSS pixels: setViewport applies the pixel ratio
    hud.update(game);
    hud.show(!game.replay);
    canvas.classList.toggle('cctv', !!game.replay);
  } else {
    canvas.classList.remove('cctv');
    renderer.setClearColor(0x1b1f24);
    renderer.clear();
  }
  input.consumeEdges();
}

refreshScreens();
requestAnimationFrame(frame);

// Debug handle for playtesting from the console
window.osha = {
  get game() {
    return game;
  },
  CONFIG,
  override: null,
  renderer, // for perf checks: osha.renderer.info.render.calls
  start: startGame,
  tick: (now) => tick(now), // run one frame at time `now` (ms), e.g. to emulate a 144 Hz display
  manual: false, // true pauses the real frame loop so osha.tick() drives the game alone
  // Advance the simulation headlessly: osha.sim(seconds, climberActions, driverActions)
  sim(secs, c = {}, d = {}) {
    const blank = input.climberActions([]);
    for (let i = 0; i < Math.round(secs * 60); i++) {
      const ca = { ...blank, ...c };
      const da = { ...blank, ...d };
      if (i > 0) ca.jump = ca.interact = false;
      game.step(CONFIG.physics.dt, { climber: ca, driver: da });
    }
    game.frame(CONFIG.physics.dt);
  },
  // Fresh game with the forklift at (x, z, yaw), forks at height h, a pallet on the forks
  // and optionally the climber standing on it.
  scenario(h, x, z, yaw, withClimber = true) {
    startGame('single');
    game.active = 'driver';
    game.assignDevices(input);
    const f = game.forklift;
    f.height = h;
    f.teleport({ x, z }, yaw);
    const pallet = game.entities.find((e) => e.kind === 'pallet');
    const px = x + Math.sin(yaw) * 1.55;
    const pz = z + Math.cos(yaw) * 1.55;
    const py = h - 0.115 + 0.01;
    pallet.body.setTranslation({ x: px, y: py, z: pz }, true);
    pallet.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    if (withClimber) game.climber.body.setTranslation({ x: px, y: py + 0.15 + 0.92, z: pz }, true);
    this.sim(0.6);
    return { g: game, f, c: game.climber, pallet };
  },
};
