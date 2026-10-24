import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/systems/input.js';

test('Ralph drifts with RT, accelerates with the stick, and retains keyboard Space drift', () => {
  const pad = { index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, () => ({ value: 0, pressed: false })) };
  const input = Object.assign(Object.create(Input.prototype), {
    pads: [pad], padEdges: new Map(), keys: new Set(), pressed: new Set(), mouseDX: 0, mouseDY: 0, dt: 1 / 60,
  });
  pad.buttons[7] = { value: .8, pressed: true };
  let actions = input.driverActions(['pad0']);
  assert.equal(actions.drift, true); assert.equal(actions.throttle, 0);
  pad.buttons[7] = { value: 0, pressed: false }; pad.buttons[1].pressed = true;
  actions = input.driverActions(['pad0']); assert.equal(actions.drift, false);
  pad.axes[1] = -1; actions = input.driverActions(['pad0']); assert.equal(actions.throttle, 1);
  input.keys.add('Space'); assert.equal(input.driverActions(['kbm']).drift, true);
});
