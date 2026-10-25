import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/systems/input.js';

test('Ralph drifts with RT, accelerates with A and brakes with B, and retains keyboard Space drift', () => {
  const pad = { index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ value: 0, pressed: false })) };
  const input = Object.assign(Object.create(Input.prototype), {
    pads: [pad], padEdges: new Map(), keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, dt: 1 / 60,
  });
  pad.buttons[7] = { value: .8, pressed: true };
  let actions = input.driverActions(['pad0']);
  assert.equal(actions.drift, true); assert.equal(actions.throttle, 0);
  pad.buttons[7] = { value: 0, pressed: false }; pad.buttons[1].pressed = true;
  actions = input.driverActions(['pad0']); assert.equal(actions.drift, false); assert.equal(actions.brake, 1);
  pad.buttons[1].pressed = false;
  pad.axes[1] = -1; actions = input.driverActions(['pad0']); assert.equal(actions.throttle, 0);
  pad.axes[1] = 1; assert.equal(input.driverActions(['pad0']).brake, 0);
  pad.buttons[0].pressed = true; assert.equal(input.driverActions(['pad0']).throttle, 1);
  pad.axes[0] = .8; assert.ok(input.driverActions(['pad0']).steer > 0);
  pad.axes[2] = .8; assert.equal(input.driverActions(['pad0']).lookX, 0);
  input.mouseDX = 50; input.keys.add('KeyJ'); assert.equal(input.driverActions(['kbm']).lookX, 0);
  input.keys.add('Space'); assert.equal(input.driverActions(['kbm']).drift, true);
});

test('controller polling handles unsupported, blocked, and sparse browser APIs', async () => {
  const { readGamepads } = await import('../src/systems/input.js');
  assert.match(readGamepads({}, {}, true).issue, /does not expose/);
  assert.match(readGamepads({}, {}, false).issue, /HTTPS/);
  const denied = { getGamepads: () => { const error = new Error(); error.name = 'SecurityError'; throw error; } };
  assert.match(readGamepads(denied, {}, true).issue, /blocked/);
  const pad = { connected: true, index: 2 };
  assert.deepEqual(readGamepads({ getGamepads: () => [null, null, pad] }, {}, true).pads, [pad]);
  assert.equal(readGamepads({ getGamepads: () => [pad] }, { permissionsPolicy: { allowsFeature: () => false } }, true).pads.length, 0);
});
