// The warehouse layout: where the building's features, racks, props and start spots are.
// level.js, parking.js, spills.js, the CCTV cameras and the pause screen's floor plan all work
// from this, so trying a new layout is mostly a matter of editing the numbers here.
// Axes: x runs west to east, z north to south, y up; y = 0 is the main floor. All in metres.
//
//  N ┌──────────────────────────────────────────────────┐
//    │ BASEMENT (H/I)    │◄── RAMP ──┐         PARK     │
//    │              stairs◄ by the   │  PACKING         │
//    │═══ railing ═══════╛  ramp                         │
//    │  west ┌──── A ─────┐                              ├ D1
//    │  lane │   aisle    │  east       WRAPPER          │
//    │       ├─── B/C ────┤  lane                        │
//    │       │   aisle    │                              ├ D2
//    │       ├─── D/E ────┤                              │
//    │       │   aisle    │                              ├ D3
//    │       └─── F/G ────┘                              │
//    │ ═════════════ HIGHWAY to the docks ══════════►    │
//  S └──────────────────────────────────────────────────┘

// The building is centred on x = 0, so changing its width moves both walls. Everything below is
// placed from the wall it belongs with: the west side (basement, ramp, racks) from the west wall
// W, the dock side (docks, parking) from the east wall E, and the wrapper and packing stations
// from the racks' east end, so narrowing the building only moves the dock side in.
const room = { halfX: 20.5, halfZ: 22, wallH: 12 }; // wallH: up to the roof
const NORTH = -room.halfZ; // inside face of the north wall
const W = -room.halfX; // inside face of the west wall
const E = room.halfX; // inside face of the east wall

// The basement: the north-west corner of the floor sits 1 m down and holds the backstock racks.
// The forklift's ramp runs down westward along the north wall; Dave's stairs go down westward
// from the basement's east edge, just south of the ramp.
const lower = { y: -1.0, x0: W, x1: W + 20, z0: NORTH, z1: -9, label: 'BASEMENT' };
const ramp = { x0: lower.x1, x1: lower.x1 + 8, z0: NORTH, z1: -18, down: 'west' };
const stairs = { from: -12.5, to: -10.5, edge: lower.x1, down: 'west', steps: 6, tread: 0.3 };

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

// One block of racks with a narrow lane (about 3.8 m) down its west side. Rack A stands with its
// back to the basement's railing; below it B/C, D/E and F/G are back-to-back pairs, every row 4.4 m
// from the next (G faces the highway). The pick aisles are narrower than the racks are tall, so a
// toppled rack falls onto its neighbour (dominoes). The basement holds the backstock pair H/I.
const RACKS_E = lower.x1; // the racks' east end caps line up with the basement's east edge
const WEST = RACKS_E - 6 * racking.bayW; // the racks' west end
const AISLE = 4.4;
const A = lower.z1 + 0.15; // Rack A's back, just clear of the railing
const PAIR = racking.depth * 2 + racking.flue;
const racks = [
  rack('A', WEST, A, 'south'),
  ...pair('B', 'C', WEST, A + racking.depth + AISLE),
  ...pair('D', 'E', WEST, A + racking.depth + AISLE + PAIR + AISLE),
  ...pair('F', 'G', WEST, A + racking.depth + 2 * (AISLE + PAIR) + AISLE),
  ...pair('H', 'I', W + 2, -17.6, lower.y),
];

// The wrapper sits a 7 m lane east of the racks; the packing stations are north of it
const WRAP_X = RACKS_E + 9.5;

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
  highway: { x0: WEST, x1: E - 5, z0: 15, z1: room.halfZ }, // painted lane to the docks
  // The WRAP square, under a rotary-arm stretch wrapper: posts `half` out from the centre, a
  // gantry `height` up, and an arm swinging the film round at radius `arm`
  wrap: { x: WRAP_X, z: 1, size: 3.0, frame: { half: 2.6, height: 3.9, arm: 1.9 } },
  packing: { x: RACKS_E + 11, z: -13.5, perRow: 3 }, // packing stations: two rows back to back, centred here
  parking: { x0: E - 4.4, x1: E - 0.4, depth: 5.4 }, // forklift bay against the north wall (nose-out, facing south)
  // OSHA violations round the building (hazards.js). Things on a wall give the wall and how far
  // along it they are (x for the north and south walls, z for east and west); y is the floor height.
  hazards: {
    outlet: { wall: 'north', at: RACKS_E + 11 }, // overloaded outlet behind the packing stations
    panel: { wall: 'south', at: W + 14 }, // electrical panel with a leaking pipe dripping on it
    // A section of the basement's railing that isn't there: on its east edge, by the ramp
    railingGap: { along: 'z', line: lower.x1, from: -17.5, to: -15.5 },
    barrels: { x: W + 1.1, z: 13.3, y: 0 }, // unlabelled barrels in the south-west corner, past Rack F
    fireExits: [
      { wall: 'west', at: -11.5, y: lower.y }, // in the basement
      { wall: 'south', at: E - 10, y: 0 }, // on the highway
    ],
  },
  // yaw 0: the ladders hang on the south side of the stand; π: the north side
  ladderStands: [
    { x: RACKS_E + 2.5, z: -15, y: 0, yaw: 0 }, // just north of the top of the stairs, out of the way
    { x: RACKS_E - 3.5, z: lower.z1 - 0.3, y: lower.y, yaw: Math.PI }, // basement, by the foot of the stairs
  ],
  incidentSign: { x: E - 7.5, y: 3.6 }, // on the north wall
  climberSpawn: { pos: [RACKS_E + 1.5, 0, A + racking.depth + AISLE / 2], yaw: Math.PI / 2 }, // east end of aisle A/B, looking down it
  // Where Dave can come back after a respawn
  spawnPoints: [
    [RACKS_E + 1.5, 0, -5.45],
    [RACKS_E + 1.5, 0, 1.55],
    [RACKS_E + 1.5, 0, 8.55],
    [W + 1.8, 0, 0],
    [W + 12, lower.y, -12.5],
    [W + 12, lower.y, -19.8],
    [RACKS_E - 3, 0, 13.5],
    [RACKS_E + 4, 0, -15],
    [E - 5, 0, 8],
    [E - 11, 0, 18],
    [W + 5, 0, 18],
    [E - 5.5, 0, -9],
  ],
  // Loose boxes on the open floor for stacking: [type, x, y, z]
  looseBoxes: [
    ['medium', RACKS_E + 7.5, 0, -5.0],
    ['small', RACKS_E + 7.5, 0.6, -5.0],
    ['small', RACKS_E + 8.5, 0, -5.4],
    ['large', RACKS_E + 8.0, 0, -7.2],
    ['medium', E - 4, 0, -8.0],
    ['medium', E - 7, 0, 12.0],
    ['small', E - 6.3, 0, 12.4],
    ['medium', RACKS_E - 4, lower.y, -11.5],
  ],
  // Empty pallets: [x, y, z, yaw] (fork pockets open toward ±local Z)
  pallets: [
    [RACKS_E + 11, 0, -6.0, 0],
    [RACKS_E + 12.8, 0, -6.0, 0],
    [RACKS_E + 3.5, 0, 9.0, 0],
    [RACKS_E + 3.5, 0, 11.0, 0],
    [W + 5, lower.y, -11.5, Math.PI / 2],
  ],
  // Named stretches of the main floor, for incident reports (first match wins)
  zones: [
    { name: 'The highway', x0: W, z0: 15, x1: E, z1: room.halfZ },
    { name: 'The west lane', x0: W, z0: lower.z1, x1: WEST, z1: 15 },
    { name: 'The south lane', x0: WEST, z0: 11, x1: RACKS_E, z1: 15 },
    { name: 'The east lane', x0: RACKS_E, z0: lower.z1, x1: WRAP_X - 2.6, z1: 15 },
    { name: 'By the ramp', x0: lower.x1, z0: NORTH, x1: E, z1: lower.z1 },
    { name: 'Dock side', x0: WRAP_X - 2.6, z0: lower.z1, x1: E, z1: 15 },
  ],
  ceiling: {
    fans: [[W + 13, 0], [W + 11, -15], [RACKS_E + 10, -8], [RACKS_E + 11, 10]], // giant HVLS fans: [x, z]
    girders: [-8, 8], // z of the girders the long way
    // Round ducts the long way: z, radius, drop below the roof, and their west/east ends
    ducts: [
      { z: -13, r: 0.55, drop: 1.6, x0: W, x1: E },
      { z: 4, r: 0.55, drop: 1.6, x0: W, x1: E },
      { z: 13, r: 0.35, drop: 1.3, x0: W, x1: E - 6 },
    ],
  },
  // Security cameras high on the walls: [id, label, position]
  cctv: [
    ['01', 'BASEMENT · NW', [W + 0.4, 4.6, NORTH + 0.4]],
    ['02', 'BASEMENT · W', [W + 0.35, 4.6, -12]],
    ['03', 'NORTH EAST', [E - 0.4, 5.4, NORTH + 0.4]],
    ['04', 'WEST LANE', [W + 0.35, 5.0, 4]],
    ['05', 'RAMP', [RACKS_E + 10, 5.4, NORTH + 0.35]],
    ['06', 'PACKING', [E - 6, 5.6, NORTH + 0.35]],
    ['07', 'EAST WALL', [E - 0.35, 5.0, -6]],
    ['08', 'SOUTH WEST', [W + 0.4, 5.0, room.halfZ - 0.4]],
    ['09', 'HIGHWAY · W', [RACKS_E, 5.0, room.halfZ - 0.35]],
    ['10', 'DOCKS', [E - 0.4, 5.4, room.halfZ - 0.4]],
    ['11', 'HIGHWAY · E', [E - 8, 5.0, room.halfZ - 0.35]],
  ],
};

// A rack's east end
export const rackX1 = (r) => r.x0 + r.bays * LAYOUT.racking.bayW;
