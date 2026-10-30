import { timedOptions } from './systems/timed-shift.js';
import { orderDestinations, markDestination } from './world/navigation.js';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config.js';
import { Input } from './systems/input.js';
import { Hud } from './systems/hud.js';
import { Game } from './systems/game.js';
import { unlockAudio, sfx } from './systems/audio.js';
import { DOCKS, ORDERS } from './world/level.js';
import { drawFloorPlan } from './world/floorplan.js';
import { best, submit, medalFor, nextMedal, fmtTime, levelDef } from './systems/records.js';
import { settings } from './systems/settings.js';
import { CAMPAIGN_LEVELS, campaignLevel, campaignProgress } from './world/campaign.js';

await RAPIER.init();

const canvas = document.getElementById('c');
const lowGfx = settings.graphics === 'low';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance' });
renderer.setPixelRatio(lowGfx ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;

// If the GPU drops the canvas (out of memory on a console), say so instead of leaving a blank page
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  document.getElementById('gfx-lost').classList.remove('hidden');
});
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
  timed: document.getElementById('timed'),
};
let pickJob = 'campaign';
let timedSettings = timedOptions({ minutes: 10, difficulty: 'standard' });
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
  if (document.activeElement?.id === 'timed-minutes') { if (m.back) closeOverlay(); return; }
  if (state === 'paused' && !overlay && (m.left || m.right)) {
    for (const request of m.clipboards) {
      const role = game.mode === 'single' ? game.active : ['driver', 'climber'].find(r => game.devices[r].includes(request.device)) || pauseRole;
      changeClipboard(request.direction, role);
    }
  }
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

// Graphics: High/Low (takes effect on reload, since antialiasing is fixed when the renderer is made)
function refreshGraphics() {
  for (const b of document.querySelectorAll('[data-act="graphics"] .osha-text')) {
    b.textContent = b.dataset.text = `GRAPHICS: ${settings.graphics === 'low' ? 'LOW' : 'HIGH'}${settings.graphics !== (lowGfx ? 'low' : 'high') ? ' (RELOAD)' : ''}`;
  }
}
refreshGraphics();
document.getElementById('gfx-reload').addEventListener('click', () => {
  settings.setGraphics('low');
  location.reload();
});

function closeOverlay() {
  if (overlay === 'levels' && pickJob !== 'campaign') { pickJob = 'campaign'; showLevels(); return; }
  if (overlay === 'timed') { showLevels(); return; }
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
    pickJob = 'campaign';
    showLevels();
  } else if (act === 'timed') {
    overlay = 'timed'; refreshTimedSettings(); refreshScreens();
  } else if (act === 'timedlength' || act === 'timedless' || act === 'timedmore') {
    timedSettings.minutes = act === 'timedlength' ? Number(b.dataset.minutes) : timedSettings.minutes + (act === 'timedless' ? -1 : 1);
    refreshTimedSettings();
  } else if (act === 'timeddifficulty') {
    const choices = ['easy', 'standard', 'hard']; timedSettings.difficulty = choices[(choices.indexOf(timedSettings.difficulty) + 1) % choices.length]; refreshTimedSettings();
  } else if (act === 'timedstart') {
    startGame(pickMode, 'timed', timedSettings);
  } else if (act === 'timedreplace') {
    if (game.timed && !game.jobDone[pauseClipboardJob]) {
      game.timed.abandon(pauseClipboardJob);
      if (!game.complete) { renderPauseClipboard(); mapDestinationId = null; refreshMapDestination(); }
    }
  } else if (act === 'recoverystock') {
    const result = game.recovery?.request(pauseClipboardJob);
    if (result?.blocked) game.toast(result.blocked, 4);
    renderPauseClipboard(); mapDestinationId = result?.blocked ? null : 'recovery'; refreshMapDestination();
    if (!result?.blocked) setFocus(0);
  } else if (act === 'practice') {
    pickJob = 'practice'; showLevels();

  } else if (act === 'level') startGame(pickMode, b.dataset.level === 'shift' || b.dataset.level.startsWith('receiving-') || b.dataset.level.startsWith('campaign-') ? b.dataset.level : Number(b.dataset.level));
  else if (act === 'next') startGame(game.mode, game.campaign ? CAMPAIGN_LEVELS[CAMPAIGN_LEVELS.findIndex(l => l.id === game.levelId) + 1].id : game.orderId + 1);
  else if (act === 'levels') {
    pickMode = game.mode;
    pickJob = game.campaign || game.timed ? 'campaign' : 'practice';
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
  } else if (act === 'graphics') {
    settings.setGraphics(settings.graphics === 'low' ? 'high' : 'low');
    refreshGraphics();
  } else if (act === 'invert') {
    input.setInvertY(!input.invertY);
    refreshInvert();
  } else if (act === 'mapdestination') {
    mapDestinationEnabled = !mapDestinationEnabled;
    try { localStorage.setItem('osha.mapDestination', String(mapDestinationEnabled)); } catch {}
    refreshMapDestination();
  } else if (act === 'mapnext') {
    const targets = orderDestinations(game.taskView(pauseClipboardJob));
    mapDestinationId = targets[(targets.findIndex(t => t.id === mapDestinationId) + 1) % targets.length]?.id;
    refreshMapDestination();
  } else if (act === 'resume') resume();
  else if (act === 'restart') startGame(game.mode, game.levelId, game.timed?.options);
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
  document.querySelector('#levels .selection-title').textContent = pickJob === 'campaign' ? 'SELECT LEVEL' : 'PAIRED PRACTICE';
  document.getElementById('lv-mode').textContent = pickMode === 'coop' ? 'Couch co-op · split screen' : 'Single player · swap with Tab / View';
  const tag = (m) => (m ? `<i class="medal ${m}">${m}</i>` : '');
  const row = (id, label, name) => {
    const b = best(pickMode, id);
    const progress = campaignLevel(id) ? campaignProgress(pickMode, id) : null;
    const status = campaignLevel(id) ? (progress?.complete ? 'Shipping ✓ · Receiving ✓' : progress?.checkpoint ? 'Resume unfinished pair' : 'Ship + Receive') : '';
    const right = b ? `${fmtTime(b.total)} ${tag(medalFor(id, b.total))}` : '<span class="none">No time yet</span>';
    return `<button class="btn level" data-act="level" data-level="${id}"><span class="osha-text osha-text--ivory" data-text="${label}">${label}</span><span class="lv-name">${name}</span><span class="lv-best">${right}${status ? `<small class="lv-progress">${status}</small>` : ''}</span></button>`;
  };
  document.querySelector('#levels .level-list').innerHTML =
    pickJob === 'campaign' ? CAMPAIGN_LEVELS.map(l => row(l.id, l.title.toUpperCase(), l.challenge)).join('') + '<button class="btn" data-act="practice">PRACTICE</button><button class="btn" data-act="timed">TIMED SHIFT</button>' : ORDERS.map(o => row(o.id, `PRACTICE ${o.id}`, `${o.title} · Shipping + Receiving`)).join('');
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

function refreshTimedSettings() {
  timedSettings = timedOptions(timedSettings);
  document.getElementById('timed-minutes').value = timedSettings.minutes;
  document.getElementById('timed-difficulty').textContent = `STARTING DIFFICULTY: ${timedSettings.difficulty.toUpperCase()}`;
  document.querySelectorAll('[data-act="timedlength"]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.minutes) === timedSettings.minutes)));
}
document.getElementById('timed-minutes').addEventListener('change', e => {
  timedSettings.minutes = Number(e.target.value); refreshTimedSettings();
});

function wantsPointer() {
  return game && (game.mode === 'single' || game.usesKeyboard('climber') || game.usesKeyboard('driver'));
}

function startGame(mode, order = 1, timed = null) {
  game?.dispose();
  game = new Game({ mode, hud, order, timed });
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

let mapDestinationEnabled = false;
try { mapDestinationEnabled = localStorage.getItem('osha.mapDestination') === 'true'; } catch {}
let mapDestinationId = null;
function refreshMapDestination() {
  if (!game) return;
  const targets = orderDestinations(game.taskView(pauseClipboardJob));
  const target = targets.find(t => t.id === mapDestinationId) || targets.find(t => !t.complete) || targets[0];
  mapDestinationId = target?.id;
  markDestination(document.querySelector('#pause .map svg'), mapDestinationEnabled ? target : null);
  const toggle = document.querySelector('[data-act="mapdestination"]');
  toggle.textContent = `MARKER: ${mapDestinationEnabled ? 'ON' : 'OFF'}`;
  toggle.setAttribute('aria-pressed', String(mapDestinationEnabled));
  document.querySelector('[data-act="mapnext"]').disabled = !mapDestinationEnabled || targets.length < 2;
  document.getElementById('map-destination-detail').textContent = mapDestinationEnabled && target
    ? `${target.label}${target.complete ? ' · Complete' : ''} — ${target.detail}` : 'Locations read Rack – Bay – Shelf. Shelves count from the bottom.';
}

let pauseClipboardJob = 'shipping';
let pauseRole = 'driver';
function pauseClipboards() {
  return game.clipboardJobs().map(job => { const view = game.taskView(job); return { job, label: view.receiving ? 'RECEIVING' : 'SHIPPING',
    state: game.jobDone[job] ? 'COMPLETE' : 'ACTIVE', view }; });
}
function renderPauseClipboard() {
  const tasks = pauseClipboards();
  const pauseClipboardIndex = Math.max(0, tasks.findIndex(task => task.job === pauseClipboardJob));
  const task = tasks[pauseClipboardIndex], view = task.view;
  pauseClipboardJob = task.job;
  game.forklift.drawClipboard(view);
  const clipboard = document.getElementById('pause-clipboard');
  clipboard.getContext('2d').drawImage(game.forklift.clipboard.canvas, 0, 0);
  const description = `${task.label} · ${task.state}. ` + view.level.order.map(l =>
    `SKU ${l.sku}: ${view.itemStatus[l.line] || 0} of ${l.qty}, ${l.location}`).join('. ') + `. ${view.level.dock.name}.`;
  clipboard.setAttribute('aria-label', description);
  clipboard.textContent = description;
  document.getElementById('pause-clipboard-title').textContent = `${game.mode === 'coop' ? (pauseRole === 'driver' ? 'RALPH · ' : 'DAVE · ') : ''}${task.label} · ${task.state} · ${pauseClipboardIndex + 1}/${tasks.length}`;
  document.getElementById('clipboard-navigation').hidden = tasks.length < 2;
  document.querySelector('.timed-replace').classList.toggle('hidden', !game.timed || !!game.jobDone[task.job]);
  const recovery = document.querySelector('.stock-recovery');
  recovery.classList.toggle('hidden', !game.recovery || !!game.jobDone[task.job]);
  if (game.recovery && !game.jobDone[task.job]) {
    const quote = game.recovery.quote(task.job), button = document.getElementById('recovery-stock');
    button.disabled = !!quote.blocked;
    document.getElementById('recovery-quote').textContent = quote.blocked ||
      `${quote.lines.map(l => `${l.qty} × SKU ${l.sku}`).join(' · ')}. Originals are retired; collect replacements near Rack A.`;
    button.textContent = quote.blocked ? 'REPLACE UNFINISHED STOCK' : game.recovery.free ? 'REPLACE STOCK · FREE IN TUTORIAL' :
      `REPLACE STOCK · $${quote.cost.toLocaleString('en-US')} + ${quote.penalty}s`;
  }
}
function changeClipboard(direction, role = pauseRole) {
  pauseRole = role;
  const jobs = game.clipboardJobs();
  const index = jobs.indexOf(game.trackedJobs[role]);
  pauseClipboardJob = jobs[(index + direction + jobs.length) % jobs.length];
  game.trackJob(role, pauseClipboardJob);
  renderPauseClipboard();
  mapDestinationId = null;
  refreshMapDestination();
  sfx.menu();
}
document.getElementById('clipboard-prev').addEventListener('click', () => changeClipboard(-1));
document.getElementById('clipboard-next').addEventListener('click', () => changeClipboard(1));

function pause(role = game?.active) {
  if (state !== 'playing') return;
  state = 'paused';
  pausedAt = performance.now();
  game.readClipboard();
  pauseRole = role || 'driver';
  pauseClipboardJob = game.trackedJobs[pauseRole];
  renderPauseClipboard();
  mapDestinationId = null;
  refreshMapDestination();
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
  if (game.timed) { showTimedResults(); return; }
  document.getElementById('standard-results').classList.remove('hidden');
  document.getElementById('timed-results').classList.add('hidden');
  const id = game.levelId;
  const order = levelDef(id);
  const run = submit(game.mode, id, { time, incidents: falls, recoveryPenalty: game.recovery?.penalty || 0 });
  const $ = (x) => document.getElementById(x);
  const head = document.querySelector('#complete .screen-title');
  head.textContent = head.dataset.text = 'SHIFT COMPLETE';
  document.querySelector('#complete .stamp').classList.add('combined');
  document.querySelector('#complete .stamp').textContent = 'SHIPPED + RECEIVED';
  $('c-order').textContent = `${game.campaign ? `${order.title} · ${order.challenge}` : `${order.title} · Shipping + Receiving`} · ${game.mode === 'coop' ? 'Couch co-op' : 'Single player'}`;
  $('c-time').textContent = fmtTime(time);
  $('c-falls').textContent = falls;
  $('c-damage').textContent = `$${game.damage.total.toLocaleString('en-US')}`;
  $('c-stock').textContent = `$${(game.recovery?.cost || 0).toLocaleString('en-US')}`;
  $('c-penalty').textContent = run.total > time ? `+${fmtTime(run.total - time)}` : '';
  $('c-total').textContent = fmtTime(run.total);
  $('c-best').textContent = fmtTime(run.best);
  $('c-newbest').hidden = !run.isNewBest;
  const medal = medalFor(id, run.total);
  const next = nextMedal(id, run.total);
  $('c-medal').innerHTML =
    (medal ? `<i class="medal ${medal}">${medal}</i> ` : '') + (next ? `${next.medal[0].toUpperCase() + next.medal.slice(1)} at ${fmtTime(next.at)}` : 'Top marks.');
  $('c-quip').textContent = QUIPS[Math.min(falls, 3)];
  // No order after the last one
  document.querySelector('#complete [data-act="next"]').style.display = (game.campaign ? CAMPAIGN_LEVELS.some(l => l.id === `campaign-${game.orderId + 1}`) : id !== 'shift' && ORDERS.some((o) => o.id === id + 1)) ? '' : 'none';
  if (input.pointerLocked) document.exitPointerLock();
  refreshScreens();
}

function showTimedResults() {
  const t = game.timed, money = value => `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('en-US')}`;
  const key = `osha.timed.v1.${game.mode}.${t.options.minutes}.${t.options.difficulty}`;
  let best = t.net;
  try { const saved = localStorage.getItem(key); if (saved !== null) best = Math.max(best, Number(saved) || 0); localStorage.setItem(key, String(best)); } catch {}
  const head = document.querySelector('#complete .screen-title'); head.textContent = head.dataset.text = 'SHIFT OVER';
  document.querySelector('#complete .stamp').textContent = 'TIME’S UP';
  document.querySelector('#complete .stamp').classList.add('combined');
  document.getElementById('c-order').textContent = `${t.options.minutes} ${t.options.minutes === 1 ? 'minute' : 'minutes'} · ${t.options.difficulty} · ${game.mode === 'coop' ? 'Couch co-op' : 'Single player'}`;
  document.getElementById('standard-results').classList.add('hidden');
  const report = document.getElementById('timed-results'); report.classList.remove('hidden');
  report.innerHTML = [['Shipping orders', t.counts.shipping], ['Receiving orders', t.counts.receiving], ['Earnings', money(t.earnings)], ['Damage', money(game.damage.total)], ['Service fees', money(t.fees)], ['Net profit', money(t.net)], ['Best net profit', money(best)], ['Incidents', game.falls]].map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join('');
  document.getElementById('c-medal').textContent = 'Completed jobs only · unfinished work earns no credit';
  document.getElementById('c-quip').textContent = t.net < 0 ? 'Accounting would like a word.' : 'Clocked out. The warehouse remembers.';
  document.querySelector('#complete [data-act="next"]').style.display = 'none';
  if (input.pointerLocked) document.exitPointerLock(); refreshScreens();
}

let hadLock = false;
document.addEventListener('pointerlockchange', () => {
  const locked = input.pointerLocked;
  if (hadLock && !locked && state === 'playing') pause(game.mode === 'single' ? game.active : ['climber', 'driver'].find(r => game.devices[r].includes('kbm')) || 'driver');
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
      pause(game.mode === 'single' ? game.active : kbPause ? (['climber', 'driver'].find(r => game.devices[r].includes('kbm')) || 'driver') : actions.climber.pause ? 'climber' : 'driver');
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
