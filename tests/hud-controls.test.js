import test from 'node:test';
import assert from 'node:assert/strict';
import { basicControls } from '../src/systems/hud.js';

test('basic controls show only the specified character and input device', () => {
  const keys = { gas: 'W', brake: 'S', lift: 'R', lower: 'F', drift: 'Space', reset: 'Q', jump: 'Space', crouch: 'Ctrl', interact: 'E', toss: 'R' };
  const buttons = { gas: 'A', brake: 'B', lift: 'RB', lower: 'LB', drift: 'RT', reset: 'Y', jump: 'A', crouch: 'L3', interact: 'X', toss: 'RB' };
  let keyboard = true;
  const game = { usesKeyboard: () => keyboard, keyHint: (_role, action) => keyboard ? keys[action] : `<span class="pad-button">${buttons[action]}</span>` };
  const ralph = basicControls(game, 'driver');
  assert.match(ralph, /RALPH/); assert.match(ralph, /Reset truck/); assert.doesNotMatch(ralph, /Jump|Crouch|pad-button/);
  const dave = basicControls(game, 'climber');
  assert.match(dave, /DAVE/); assert.match(dave, /Crouch/); assert.doesNotMatch(dave, /Gas|Forks|Reset truck/);
  keyboard = false;
  const controller = basicControls(game, 'driver');
  assert.match(controller, /pad-button/); assert.match(controller, />RT</); assert.doesNotMatch(controller, /WASD|Mouse|>Space</);
});
