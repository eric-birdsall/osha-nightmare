// The warehouse layout: where the building's features, racks, props and start spots are.
// level.js, corner.js, spills.js, the CCTV cameras and the pause screen's floor plan all work
// from this, so trying a new layout is mostly a matter of editing the numbers here.
// Axes: x runs west to east, z north to south, y up; y = 0 is the main floor. All in metres.
//
//  N ┌────────────────────────────────────────────────────────────┐
//    │ BASEMENT  │◄RAMP│      north lane       OFFICE SAFETY  PARK │
//    │  G/H      ├─────┘                                           │
//    │ (backstock)│            ┌── A ──┐  cross  ┌── D ──┐         │
//    ├──stairs────┘   west     │ aisle │  aisle  │ aisle │  east   ├ D1
//    │                lane     └─ B/C ─┘         └─ E/F ─┘  lane   ├ D2
//    │                           south lane                 WRAP   │
//    │ ══════════════════ HIGHWAY to the docks ═════════════════►  ├ D3
//  S └────────────────────────────────────────────────────────────┘

const room = { halfX: 32, halfZ: 22, wallH: 12 }; // wallH: up to the roof
const NORTH = -room.halfZ; // inside face of the north wall

// The basement: the north-west corner of the floor sits 1 m down and holds the backstock racks.
// The forklift's ramp runs down westward along the north wall; Dave's stairs go down northward
// from the basement's south edge.
const lower = { y: -1.0, x0: -room.halfX, x1: -12, z0: NORTH, z1: -9, label: 'BASEMENT' };
const ramp = { x0: -12, x1: -4, z0: NORTH, z1: -18, down: 'west' };
const stairs = { from: -21, to: -19, edge: lower.z1, down: 'north', steps: 6, tread: 0.3 };

// Racking: every rack is single-deep and open on its aisle face. Bays count from the west end.
const racking = {
  bays: 6,
  bayW: 2.7,
  depth: 1.2,
  flue: 0.2, // gap between back-to-back racks
  uprightH: 5.2,
  shelves: [1.5, 3.0, 4.5], // shelf heights
};
// One rack: its west end at x0, its north edge at z0, open to the north or south. base: its floor height.
const rack = (name, x0, z0, face, base = 0) => ({ name, x0, z0, z1: z0 + racking.depth, face, base, bays: racking.bays });
// Two racks back to back, the north one open to the north
const pair = (north, south, x0, z0, base = 0) => [rack(north, x0, z0, 'north', base), rack(south, x0, z0 + racking.depth + racking.flue, 'south', base)];

// Two blocks of racks on an island in the middle of the floor, with a 7 m lane all round them
// (the loop) and a 7 m cross aisle between them. In each block a single rack faces a back-to-back
// pair across a 4.4 m pick aisle, narrower than the racks are tall, so a toppled rack falls onto
// its neighbour (dominoes). The basement holds one back-to-back pair of backstock racks.
const WEST = -25; // west block's west end
const EAST = -1.8; // east block's west end
const ISLAND = 0; // north edge of the racks
const racks = [
  rack('A', WEST, ISLAND, 'south'),
  ...pair('B', 'C', WEST, ISLAND + 5.6),
  rack('D', EAST, ISLAND, 'south'),
  ...pair('E', 'F', EAST, ISLAND + 5.6),
  ...pair('G', 'H', -30, -17.6, lower.y),
];

// Loading docks on the east wall; each order ships from one, picked at random. The highway runs
// along the south wall to them.
const docks = [
  { name: 'Dock 1', z: 4 },
  { name: 'Dock 2', z: 11 },
  { name: 'Dock 3', z: 18 },
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
  highway: { x0: -25, x1: 27, z0: 15, z1: room.halfZ }, // painted lane to the docks
  // The WRAP square, under a rotary-arm stretch wrapper: posts `half` out from the centre, a
  // gantry `height` up, and an arm swinging the film round at radius `arm`
  wrap: { x: 25.5, z: -3, size: 3.0, frame: { half: 2.6, height: 3.9, arm: 1.9 } },
  packing: { x: 5, z: -13.5, perRow: 3 }, // packing stations: two rows back to back, centred here
  // OSHA violations round the building (hazards.js). Things on a wall give the wall and how far
  // along it they are (x for the north and south walls, z for east and west); y is the floor height.
  hazards: {
    outlet: { wall: 'north', at: 2.5 }, // overloaded outlet behind the packing stations
    panel: { wall: 'south', at: -18 }, // electrical panel with a leaking pipe dripping on it
    railingGap: { line: lower.z1, from: -16, to: -13.5 }, // a section of the basement's railing that isn't there
    barrels: { x: -30.9, z: 11, y: 0 }, // unlabelled barrels against the west wall
    fireExits: [
      { wall: 'west', at: -11.5, y: lower.y }, // in the basement
      { wall: 'south', at: 14, y: 0 }, // on the highway
    ],
  },
  // North-east corner, along the north wall from west to east
  corner: {
    office: { x0: 14, x1: 19, depth: 3.6, height: 3.0 },
    safety: { x0: 19.3, x1: 25 },
    propane: { x: 25.95, w: 1.7, d: 1.4, h: 1.8 },
    parking: { x0: 27.6, x1: 31.6, depth: 5.4 }, // the truck parks nose-out (facing south)
  },
  // yaw π: the ladders hang on the north side of the stand
  ladderStands: [
    { x: -5.3, z: ISLAND - 2.0, y: 0, yaw: Math.PI }, // north end of the cross aisle
    { x: -24, z: lower.z1 - 0.3, y: lower.y, yaw: Math.PI }, // basement, by the foot of the stairs
  ],
  incidentSign: { x: 6, y: 3.6 }, // on the north wall
  climberSpawn: { pos: [-7.3, 0, ISLAND + 3.4], yaw: Math.PI / 2 }, // cross aisle, looking down aisle A/B
  // Where Dave can come back after a respawn
  spawnPoints: [
    [-7.3, 0, ISLAND + 3.4],
    [-7.3, 0, -4],
    [-5.3, 0, 11],
    [-28.5, 0, 4],
    [-20, lower.y, -12.5],
    [-20, lower.y, -19.8],
    [-14, 0, -6],
    [6, 0, -6],
    [18, 0, 4],
    [24, 0, 8],
    [0, 0, 18],
    [-24, 0, 18],
    [16, 0, -12],
  ],
  // Loose boxes on the open floor for stacking: [type, x, y, z]
  looseBoxes: [
    ['medium', -2.5, 0, -5.0],
    ['small', -2.5, 0.6, -5.0],
    ['small', -1.5, 0, -5.4],
    ['large', 3.0, 0, -6.0],
    ['medium', 19.5, 0, -8.0],
    ['medium', 6.0, 0, 12.0],
    ['small', 6.7, 0, 12.4],
    ['medium', -16.0, lower.y, -11.5],
  ],
  // Empty pallets: [x, y, z, yaw] (fork pockets open toward ±local Z)
  pallets: [
    [-11.0, 0, -4.0, 0],
    [-9.2, 0, -4.0, 0],
    [23.0, 0, -8.5, 0],
    [24.8, 0, -8.5, 0],
    [-27.0, lower.y, -11.5, Math.PI / 2],
  ],
  // Named stretches of the main floor, for incident reports (first match wins)
  zones: [
    { name: 'The highway', x0: -room.halfX, z0: 15, x1: room.halfX, z1: room.halfZ },
    { name: 'The cross aisle', x0: WEST + 16.2, z0: ISLAND - 1, x1: EAST, z1: ISLAND + 9.2 },
    { name: 'The west lane', x0: -room.halfX, z0: lower.z1, x1: WEST, z1: 15 },
    { name: 'The east lane', x0: EAST + 16.2, z0: -16.4, x1: EAST + 23.2, z1: 15 },
    { name: 'The north lane', x0: WEST, z0: NORTH, x1: EAST + 16.2, z1: ISLAND },
    { name: 'The south lane', x0: WEST, z0: ISLAND + 8.2, x1: EAST + 16.2, z1: 15 },
    { name: 'Dock side', x0: EAST + 23.2, z0: -16.4, x1: room.halfX, z1: 15 },
  ],
  ceiling: {
    fans: [[-20, 12], [0, -10], [4, 14], [24, -8], [24, 10]], // giant HVLS fans: [x, z]
    girders: [-8, 8], // z of the girders the long way
    // Round ducts the long way: z, radius, drop below the roof, and their west/east ends
    ducts: [
      { z: -13, r: 0.55, drop: 1.6, x0: -room.halfX, x1: room.halfX },
      { z: 4, r: 0.55, drop: 1.6, x0: -room.halfX, x1: room.halfX },
      { z: 13, r: 0.35, drop: 1.3, x0: -room.halfX, x1: 20 },
    ],
  },
  // Security cameras high on the walls: [id, label, position]
  cctv: [
    ['01', 'BASEMENT · NW', [-room.halfX + 0.4, 4.6, NORTH + 0.4]],
    ['02', 'BASEMENT · W', [-room.halfX + 0.35, 4.6, -12]],
    ['03', 'NORTH EAST', [room.halfX - 0.4, 5.4, NORTH + 0.4]],
    ['04', 'WEST LANE', [-room.halfX + 0.35, 5.0, 4]],
    ['05', 'RAMP', [-2, 5.4, NORTH + 0.35]],
    ['06', 'NORTH LANE', [9, 5.6, NORTH + 0.35]],
    ['07', 'EAST WALL', [room.halfX - 0.35, 5.0, -6]],
    ['08', 'SOUTH WEST', [-room.halfX + 0.4, 5.0, room.halfZ - 0.4]],
    ['09', 'HIGHWAY · W', [-12, 5.0, room.halfZ - 0.35]],
    ['10', 'DOCKS', [room.halfX - 0.4, 5.4, room.halfZ - 0.4]],
    ['11', 'HIGHWAY · E', [10, 5.0, room.halfZ - 0.35]],
  ],
};

// A rack's east end
export const rackX1 = (r) => r.x0 + r.bays * LAYOUT.racking.bayW;
