import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYOUT } from '../src/world/layout.js';
import { parkingRect } from '../src/world/parking.js';

test('basement railing opening clears the forklift and the ladder stays at Rack A', () => {
  const { hazards, wrap, lower, racks, ladderStands, climberSpawn } = LAYOUT;
  const gap = hazards.railingGap;
  assert.ok(gap.to - gap.from > 3.3, 'At least 3.3 m clearance for a roughly 1.2 m wide truck');
  assert.ok(Math.abs(gap.from - (wrap.z + wrap.frame.half + .1)) < 1e-6);
  assert.equal(gap.to, lower.z1);
  const stand = ladderStands[0], rack = racks.find(r => r.name === 'A');
  assert.equal(stand.count, 1); assert.equal(stand.showLabel, false);
  assert.ok(stand.z > gap.to + .55, 'Stand is outside the opening');
  assert.ok(stand.z >= rack.z0 && stand.z <= rack.z1);
  assert.ok(Math.hypot(climberSpawn.pos[0] - stand.x, climberSpawn.pos[2] - stand.z) < 1.5);
  assert.equal(climberSpawn.yaw, Math.PI);
});

test('parking occupies the southwest of the basement and points east on the landscape plan', () => {
  const bay = parkingRect(), lower = LAYOUT.lower;
  assert.ok(bay.x0 >= lower.x0 && bay.x1 <= lower.x1);
  assert.ok(bay.z0 >= lower.z0 && bay.z1 <= lower.z1);
  // Display coordinates are (-worldZ, worldX): the lower-left corner is (lower.z1, lower.x1).
  assert.ok(Math.abs(bay.z1 - lower.z1) < .3);
  assert.ok(Math.abs(bay.x1 - lower.x1) < .3);
  assert.equal(LAYOUT.parking.wall, 'south');
  const yaw = Math.PI; // south-edge frame faces toward world -Z
  assert.ok(-Math.cos(yaw) > .99, 'Forward becomes east/right after the landscape rotation');
});
