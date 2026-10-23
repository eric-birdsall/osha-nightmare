// The warehouse layout: where the building's features, racks, props and start spots are.
// level.js, corner.js, spills.js, the CCTV cameras and the pause screen's floor plan all work
// from this, so trying a new layout is mostly a matter of editing the numbers here.
// Axes: x runs west to east, z north to south, y up; y = 0 is the upper floor. All in metres.

const room = { halfX: 24, halfZ: 16, wallH: 12 }; // wallH: up to the roof
const NORTH = -room.halfZ; // inside face of the north wall

// Lower level: the south-west of the floor sits 1 m down. Dave takes the stairs by the rack ends;
// the forklift has a ramp along the south wall that runs down westward.
const lower = { y: -1.0, x0: -room.halfX, x1: 6, z0: 3.8, z1: room.halfZ };
const ramp = { x0: 6, x1: 14, z0: 12, z1: room.halfZ }; // top at x1, bottom at x0
const stairs = { x0: -2.6, x1: -0.6, z0: lower.z0, steps: 6, tread: 0.3 };

// Racking: every rack is single-deep and open on its aisle face. Bays count from the west end.
const racking = {
  x0: -20, // west end of the racks
  bays: 6,
  bayW: 2.7,
  depth: 1.2,
  flue: 0.2, // gap between back-to-back racks
  uprightH: 5.2,
  shelves: [1.5, 3.0, 4.5], // shelf heights
};
// One rack: its north edge at z0, open to the north or south. base: its floor height.
const rack = (name, z0, face, base = 0) => ({ name, z0, z1: z0 + racking.depth, face, base, x0: racking.x0, bays: racking.bays });
// Two racks back to back, the north one open to the north
const pair = (north, south, z0, base = 0) => [rack(north, z0, 'north', base), rack(south, z0 + racking.depth + racking.flue, 'south', base)];

// Upstairs: Rack A against the north wall, B/C and D/E back to back, with 4.4 m aisles between.
// Downstairs: F/G back to back, H against the south wall, with 4.2 m aisles. The aisles are
// narrower than the racks are tall, so a toppled rack falls onto its neighbour (dominoes).
const racks = [
  rack('A', -15.6, 'south'),
  ...pair('B', 'C', -10.0),
  ...pair('D', 'E', -3.0),
  ...pair('F', 'G', 8.0, lower.y),
  rack('H', 14.75, 'north', lower.y),
];

// Loading docks on the east wall; each order ships from one, picked at random
const docks = [
  { name: 'Dock 1', z: -5 },
  { name: 'Dock 2', z: 2 },
  { name: 'Dock 3', z: 9 },
];

export const LAYOUT = {
  room,
  lower,
  ramp,
  stairs,
  racking,
  racks,
  docks,
  door: { half: 1.7, h: 3.6 }, // dock doors: half the width, and the height
  trailer: { length: 13, halfW: 1.3, height: 2.75 }, // inside dimensions
  wrap: { x: 12, z: 9, size: 2.5 }, // the WRAP square
  // North-east corner, along the north wall from west to east
  corner: {
    office: { x0: 6, x1: 11, depth: 3.6, height: 3.0 },
    safety: { x0: 11.3, x1: 17 },
    propane: { x: 17.95, w: 1.7, d: 1.4, h: 1.8 },
    parking: { x0: 19.6, x1: 23.6, depth: 5.4 }, // the truck parks nose-out (facing south)
  },
  ladderStands: [
    { x: 1.0, z: NORTH + 0.3, y: 0 }, // upstairs, north wall east of Rack A
    { x: 1.2, z: lower.z0 + 0.3, y: lower.y }, // downstairs, by the foot of the stairs
  ],
  incidentSign: { x: 4, y: 3.6 }, // on the north wall
  climberSpawn: { pos: [-2, 0, -5.2], yaw: Math.PI / 2 }, // aisle C/D, looking down it
  // Where Dave can come back after a respawn
  spawnPoints: [
    [-2, 0, -5.2],
    [-2, 0, -12.2],
    [-2, 0, 1.5],
    [-10, 0, 2.2],
    [-10, lower.y, 5.9],
    [-10, lower.y, 12.6],
    [2, lower.y, 12.6],
    [-22, 0, -6],
    [-22, lower.y, 8],
    [6, 0, 0],
    [10, 0, -10],
    [16, 0, 13],
  ],
  // Loose boxes on the open floor for stacking: [type, x, y, z]
  looseBoxes: [
    ['medium', 1.0, 0, 2.2],
    ['small', 1.0, 0.6, 2.2],
    ['small', 2.0, 0, 2.6],
    ['large', 3.0, 0, -5.0],
    ['medium', 1.6, 0, -12.0],
    ['medium', 16.0, 0, 5.5],
    ['small', 16.7, 0, 5.9],
    ['medium', 0.5, lower.y, 13.5],
  ],
  // Empty pallets: [x, y, z, yaw] (fork pockets open toward ±local Z)
  pallets: [
    [2.6, 0, -12.2, Math.PI / 2],
    [2.6, 0, -4.8, Math.PI / 2],
    [8.0, 0, 6.5, 0],
    [9.8, 0, 6.5, 0],
    [2.0, lower.y, 8.6, Math.PI / 2],
  ],
  ceiling: {
    fans: [[-12, -5], [10, -6], [10, 8]], // giant HVLS fans: [x, z]
    girders: [-6, 6], // z of the girders the long way
    // Round ducts the long way: z, radius, drop below the roof, and their west/east ends
    ducts: [
      { z: -10.5, r: 0.55, drop: 1.6, x0: -room.halfX, x1: room.halfX },
      { z: 9.5, r: 0.55, drop: 1.6, x0: -room.halfX, x1: room.halfX },
      { z: 0.5, r: 0.35, drop: 1.3, x0: -room.halfX, x1: 4 },
    ],
  },
  // Security cameras high on the walls: [id, label, position]
  cctv: [
    ['01', 'NORTH WEST', [-room.halfX + 0.4, 5.4, NORTH + 0.4]],
    ['02', 'AISLE A', [-8, 5.4, NORTH + 0.35]],
    ['03', 'NORTH EAST', [room.halfX - 0.4, 5.4, NORTH + 0.4]],
    ['04', 'WEST WALL · N', [-room.halfX + 0.35, 5.0, -5.5]],
    ['05', 'LOWER LEVEL · W', [-room.halfX + 0.35, 4.6, 9]],
    ['06', 'RACK END', [0, 5.6, NORTH + 0.35]],
    ['07', 'EAST WALL', [room.halfX - 0.35, 5.0, -7]],
    ['08', 'LOWER LEVEL · SW', [-room.halfX + 0.4, 5.0, room.halfZ - 0.4]],
    ['09', 'LOWER LEVEL · S', [2, 5.0, room.halfZ - 0.35]],
    ['10', 'DOCKS', [room.halfX - 0.4, 5.4, room.halfZ - 0.4]],
    ['11', 'RAMP', [16, 5.0, room.halfZ - 0.35]],
  ],
};

// A rack's east end
export const rackX1 = (r) => r.x0 + r.bays * LAYOUT.racking.bayW;
