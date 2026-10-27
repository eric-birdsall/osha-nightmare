import beforeRollout from './benchmark-warehouse-before.json';
import { LAYOUT } from '../src/world/layout.js';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from '../src/systems/game.js';
import { Input } from '../src/systems/input.js';
import { settings } from '../src/systems/settings.js';
import warehouse from '../src/world/warehouse-v1.json';
import dense from './benchmark-rack-a-full.json';
await RAPIER.init();
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
renderer.setPixelRatio(1); renderer.setSize(1280, 720, false); renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.info.autoReset = false;
const blank = Input.prototype.climberActions.call({ invertY: false }, []);
const rollout = new URLSearchParams(location.search).has('rollout');
const partial = rollout ? { ...warehouse.faces } : Object.fromEntries(Object.entries(warehouse.faces).filter(([at]) => at.startsWith('A-')));
const baseline = rollout ? beforeRollout.faces : dense;
if (rollout) { document.querySelector('h1').textContent = 'Warehouse-wide stocking performance'; document.querySelector('p').textContent += ' Rollout mode compares the preceding Rack-A-only layout with the new warehouse-wide profile.'; }
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];
const rounded = value => Math.round(value * 100) / 100;
async function measure(stock, mode, collapse) {
  Object.assign(warehouse.faces, stock === 'full' ? baseline : partial);
  if (rollout) for (const rack of LAYOUT.racks) rack.stockRows = stock === 'full' && rack.name !== 'A' ? 0 : 2;
  const game = new Game({ mode, order: 3 }); game.assignDevices({ padCount: () => 0, lastDevice: 'kbm' });
  game.active = 'climber'; game.forklift.height = .1; game.forklift.teleport({ x: 5, z: -5 }, 0);
  for (let i = 0; i < 120; i++) game.step(1 / 60, { climber: blank, driver: blank });
  const boxes = game.entities.filter(e => e.kind === 'box').length;
  const rackA = game.level.racks.find(r => r.name === 'A').stock.length;
  let last, start, acc = 0, collapsed = false;
  const frames = [], cpu = [], calls = [], steps = [];
  await new Promise(resolve => {
    function tick(now) {
      if (last === undefined) { last = now; start = now; requestAnimationFrame(tick); return; }
      const interval = now - last; last = now;
      const elapsed = now - start, sampling = elapsed >= 1000;
      if (sampling && collapse && !collapsed) {
        for (const rack of game.level.racks.filter(r => ['A', 'B', 'C'].includes(r.name))) {
          rack.body.setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .9), true);
          rack.body.wakeUp();
        }
        collapsed = true;
      }
      const began = performance.now();
      acc += Math.min(interval / 1000, .05); let count = 0;
      while (acc >= 1 / 60 && count < 5) {
        game.step(1 / 60, { climber: blank, driver: collapse ? blank : { ...blank, throttle: .05 } });
        acc -= 1 / 60; count++;
      }
      game.frame(Math.min(interval / 1000, .05));
      game.climber.camera.position.set(-6, 2.1, -3); game.climber.camera.lookAt(-6, 2.8, -8);
      game.forklift.camera.position.set(3, 2.3, -1); game.forklift.camera.lookAt(-6, 2.5, -7);
      renderer.info.reset(); game.render(renderer, 1280, 720);
      if (sampling) { frames.push(interval); cpu.push(performance.now() - began); calls.push(renderer.info.render.calls); steps.push(count); }
      if (elapsed >= 6000) resolve(); else requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  const result = { stock: rollout ? (stock === 'full' ? 'Before rollout' : 'After rollout') : stock, mode, scenario: collapse ? 'Three-rack collapse' : 'Normal warehouse', boxes, rackA, frames: frames.length,
    medianFrameMs: rounded(percentile(frames, .5)), p95FrameMs: rounded(percentile(frames, .95)), p95CpuMs: rounded(percentile(cpu, .95)),
    medianCalls: rounded(percentile(calls, .5)), maxSteps: Math.max(...steps), visibility: document.visibilityState };
  game.dispose(); return result;
}
document.getElementById('run').onclick = async () => {
  const button = document.getElementById('run'); button.disabled = true;
  const results = [], cctv = settings.cctvReplays; settings.cctvReplays = false;
  document.getElementById('results').textContent = '';
  try {
    for (const mode of ['single', 'coop']) for (const collapse of [false, true]) for (const stock of (new URLSearchParams(location.search).has('reverse') ? ['partial', 'full'] : ['full', 'partial'])) {
      document.getElementById('status').textContent = `Running ${results.length + 1}/8: ${stock} · ${mode} · ${collapse ? 'collapse' : 'normal'}`;
      const r = await measure(stock, mode, collapse); results.push(r);
      const tr = document.createElement('tr');
      for (const value of [r.stock, r.mode, r.scenario, `${r.boxes} (${r.rackA} A)`, `${r.medianFrameMs} ms`, `${r.p95FrameMs} ms`, `${r.p95CpuMs} ms`, r.medianCalls]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      document.getElementById('results').append(tr); document.getElementById('json').textContent = JSON.stringify(results, null, 2);
    }
    document.getElementById('status').textContent = 'Complete. Preliminary measurements for this browser/device, not a guaranteed frame rate.';
  } catch (error) { document.getElementById('status').textContent = String(error.stack || error); }
  finally { Object.assign(warehouse.faces, partial); for (const rack of LAYOUT.racks) rack.stockRows = 2; settings.cctvReplays = cctv; button.disabled = false; }
};
