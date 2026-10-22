import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';
import { Input } from './systems/input.js';
import { Hud } from './systems/hud.js';
import { Game } from './systems/game.js';
import { unlockAudio, sfx } from './systems/audio.js';

await RAPIER.init();

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

const input = new Input(canvas);
const hud = new Hud(document.getElementById('hud'));
document.getElementById('loading').remove();

let game = null;
let state = 'title'; // 'title' | 'playing' | 'paused' | 'complete'
let overlay = null; // controls panel on top of a menu
let pausedAt = 0;
let acc = 0;
let last = performance.now();

// ---------------------------------------------------------------- menus

const screens = {
  title: document.getElementById('title'),
  pause: document.getElementById('pause'),
  complete: document.getElementById('complete'),
  controls: document.getElementById('controls'),
};
let focusIdx = 0;

function visibleScreen() {
  if (overlay) return screens[overlay];
  if (state === 'title') return screens.title;
  if (state === 'paused') return screens.pause;
  if (state === 'complete') return screens.complete;
  return null;
}

function buttons(el) {
  return [...el.querySelectorAll('.btn')].filter((b) => b.offsetParent !== null);
}

function refreshScreens() {
  const vis = visibleScreen();
  for (const s of Object.values(screens)) s.classList.toggle('hidden', s !== vis);
  for (const b of document.querySelectorAll('.coop-only')) b.style.display = game?.mode === 'coop' ? '' : 'none';
  focusIdx = 0;
  if (vis) setFocus(0);
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
  if (m.up) {
    setFocus(focusIdx - 1);
    sfx.menu();
  }
  if (m.down) {
    setFocus(focusIdx + 1);
    sfx.menu();
  }
  if (m.confirm) buttons(vis)[focusIdx]?.click();
  if ((m.back || m.pause) && performance.now() - pausedAt > 300) {
    if (overlay) closeOverlay();
    else if (state === 'paused') resume();
  }
}

function closeOverlay() {
  overlay = null;
  refreshScreens();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.btn');
  if (!b) return;
  unlockAudio();
  const act = b.dataset.act;
  if (act === 'single' || act === 'coop') startGame(act);
  else if (act === 'controls') {
    overlay = 'controls';
    refreshScreens();
  } else if (act === 'back') closeOverlay();
  else if (act === 'resume') resume();
  else if (act === 'restart') startGame(game.mode);
  else if (act === 'swaproles') {
    game.swapRoles();
    resume();
  } else if (act === 'quit') {
    game?.dispose();
    game = null;
    state = 'title';
    hud.show(false);
    refreshScreens();
  }
});
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

function startGame(mode) {
  game?.dispose();
  game = new Game({ mode, hud });
  game.assignDevices(input);
  game.onComplete = showComplete;
  state = 'playing';
  overlay = null;
  acc = 0;
  hud.show(true);
  refreshScreens();
  if (wantsPointer()) input.lockPointer();
}

function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  pausedAt = performance.now();
  if (input.pointerLocked) document.exitPointerLock();
  refreshScreens();
}

function resume() {
  state = 'playing';
  overlay = null;
  refreshScreens();
  if (wantsPointer()) input.lockPointer();
}

const QUIPS = [
  'OSHA has been notified.',
  'Nobody saw anything.',
  'The incident report writes itself.',
  'Flawless. Suspiciously flawless.',
];

function showComplete({ time, falls }) {
  state = 'complete';
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  document.getElementById('c-time').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  document.getElementById('c-falls').textContent = falls;
  document.getElementById('c-quip').textContent = falls === 0 ? QUIPS[3] : QUIPS[Math.min(falls - 1, 2)];
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

const noEdges = (a) => ({ ...a, lookX: 0, lookY: 0, jump: false, interact: false, swap: false, pause: false });

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.poll(dt);

  const padText = document.querySelector('.pads');
  if (state === 'title' && padText) {
    const n = input.padCount();
    padText.textContent = `Gamepads connected: ${n}${n ? '' : ' (press a button on a pad to wake it up)'}`;
  }

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
    if (actions.climber.pause || actions.driver.pause || kbPause) {
      pause();
    } else {
      if (actions.climber.swap || actions.driver.swap) {
        game.swapCharacter();
        game.assignDevices(input);
      }
      const step = CONFIG.physics.dt;
      acc += dt;
      let n = 0;
      while (acc >= step && n < CONFIG.physics.maxStepsPerFrame) {
        game.step(step, n === 0 ? actions : { climber: noEdges(actions.climber), driver: noEdges(actions.driver) });
        acc -= step;
        n++;
      }
      if (n === CONFIG.physics.maxStepsPerFrame) acc = 0;
      game.frame(dt);
    }
  } else {
    menuNav();
  }

  if (game) {
    game.lookHint =
      input.lockFailed && !input.pointerLocked ? 'Mouse lock unavailable: hold a mouse button and drag to look' : '';
    game.render(renderer, innerWidth, innerHeight); // CSS pixels: setViewport applies the pixel ratio
    hud.update(game);
  } else {
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
  start: startGame,
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
