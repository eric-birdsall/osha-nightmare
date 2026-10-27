// The warehouse layout: where the building's features, racks, props and start spots are.
// level.js, parking.js, the CCTV cameras and the pause screen's floor plan all work
// from this, so trying a new layout is mostly a matter of editing the numbers here.
// Axes: x runs west to east, z north to south, y up; y = 0 is the main floor. All in metres.
// Player compass presentation rotates these internal axes by 90 degrees:
// +Z is the West wall, +X the South wall. See floorplan.js for the map transform.

// The building is centred on x = 0, so changing its width moves both walls. Everything below is
// placed from the wall it belongs with: the west side (basement, docks, ramp, central racks)
// from the west wall W, and the east side (wrapper, packing, conveyor) from the east wall E, so
// narrowing the building only moves the east side in.
const room = { halfX: 19.2, halfZ: 23.2, wallH: 12 }; // wallH: up to the roof
const NORTH = -room.halfZ; // inside face of the north wall
const W = -room.halfX; // inside face of the west wall
const E = room.halfX; // inside face of the east wall
const SOUTH = room.halfZ; // inside face of the south wall

// The basement: the north-west corner of the floor sits 1 m down and holds the backstock racks.
// The forklift's ramp runs down westward along the north wall. Dave's stairs go down northward
// from the basement's south edge in the west lane, beside Rack A's west end.
const lower = { y: -1.0, x0: W, x1: W + 20, z0: NORTH, z1: -9, label: 'BASEMENT' };
const ramp = { x0: lower.x1, x1: lower.x1 + 8, z0: NORTH, z1: -18, down: 'west' };
const stairs = { from: W, to: W + 3.8, edge: lower.z1, down: 'north', steps: 6, tread: 0.3 };

// Racking: every rack is single-deep and open on its aisle face. Bays count from the west end.
const racking = {
  bays: 6,
  bayW: 2.7,
  depth: 1.2,
  flue: 0.2, // gap between back-to-back racks
  uprightH: 5.2,
  shelves: [1.5, 3.0, 4.5], // shelf heights
};
// One rack: its west end at x0, its north edge at z0, open to the north or south. base: its floor
// height. size: { shelves, uprightH } if it isn't the usual three shelves high.
const rack = (name, x0, z0, face, base = 0, size = {}) => ({
  name, x0, z0, z1: z0 + racking.depth, face, base, bays: racking.bays,
  shelves: size.shelves || racking.shelves, uprightH: size.uprightH || racking.uprightH,
});
// Two racks back to back, the north one open to the north
const pair = (north, south, x0, z0, base = 0, size = {}) => [rack(north, x0, z0, 'north', base, size), rack(south, x0, z0 + racking.depth + racking.flue, 'south', base, size)];
// West-wall high storage (world +Z): three equal sections with two 2.6 m ladder gaps. Bottom decks are pick faces; upper decks hold pallets.
// The lower first deck gives strapped crates the same usable fork clearance as upper bays.
const HIGH = { shelves: [1.2, 3.0, 4.8, 6.6, 8.4], uprightH: 9.8 };
const highRack = (name, x0) => ({
  ...rack(name, x0, SOUTH - 1.65, 'north', 0, HIGH),
  z1: SOUTH - 0.15, bays: 4, palletFromShelf: 2,
});


// One block of racks with a narrow lane (about 3.8 m) down its west side. Rack A stands with its
// back to the basement's railing; below it B/C, D/E and F/G are back-to-back pairs, every row 4.4 m
// from the next (G faces the high-storage aisle). The pick aisles are narrower than the racks are tall, so a
// toppled rack falls onto its neighbour (dominoes). The backstock sections X/Y/Z stand along the West wall.
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
  highRack('Z', -18.8),
  highRack('Y', -5.4),
  highRack('X', 8.0),
];

// The wrapper stands on the main floor against the basement's east edge, between the ramp and the
// basement's LADDERS stand: a wrapped pallet heads out its east side, onto the top of the ramp
// and down into the basement's docks. (Watch the missing railing on its west side.)
const FRAME = 2.6; // the wrapper's posts, out from its centre
const WRAP = { x: lower.x1 + 0.4 + FRAME, z: ramp.z1 + 0.3 + FRAME };
// The packing stations run north-south down the east side, their west side this far in from the
// east wall, with the packing line between their rows
const PACK_WEST = E - 9.2;
const PACK_BELT = 1.6; // the packing line's width: a wide target for boxes bounced off the benches' back panels
const PACK_DEPTH = 0.9 * 2 + PACK_BELT + 0.2; // two benches back to back with the belt between (see packing.js)
// The packing line's north end, where the pallet it fills waits
const PACK_LINE_END = -8.2;
// The two rows are staggered by half a bench, so a gap in one row looks across the belt at the
// back panel of a bench in the other: stand in the gap and throw at that panel
const PACK_GAP = 1.4; // between benches in a row: room for Dave to stand in
const PACK_LEN = 3 * 2.4 + 2 * PACK_GAP + (2.4 + PACK_GAP) / 2; // the island's length, stagger included
const PACKING = { x: PACK_WEST + PACK_DEPTH / 2, z: PACK_LINE_END + 4.2 + PACK_LEN / 2, perRow: 3, yaw: Math.PI / 2, belt: PACK_BELT, gap: PACK_GAP };
const CONVEYORS = [
  { name: 'Conveyor', x0: E - 2.0, x1: E - 0.05, z0: NORTH + 2, z1: 0.9, height: 0.8, speed: 1.2, sign: true, backstop: false, powerSwitch: true, highSpeed: 12 },
  { name: 'Packing line', x0: PACKING.x - PACKING.belt / 2, x1: PACKING.x + PACKING.belt / 2, z0: PACK_LINE_END, z1: PACKING.z + PACK_LEN / 2 + 0.2, height: 0.8, speed: 0.8 },
];

// Dock 1 is on the player-facing North wall near the stairs; Docks 2/3 share the East wall.
// Internal wall keys retain the original axes: `at` is how far along the wall (z for east/west walls, x for north/south). Each order
// ships from one, picked at random.
const docks = [
  { name: 'Dock 1', wall: 'west', at: lower.z1 - 4.3 },
  { name: 'Dock 2', wall: 'north', at: W + 3.5 },
  { name: 'Dock 3', wall: 'north', at: W + 10 },
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
  // The WRAP square, under a rotary-arm stretch wrapper: posts `half` out from the centre, a
  // gantry `height` up, and an arm swinging the film round at radius `arm`
  wrap: { x: WRAP.x, z: WRAP.z, size: 3.0, frame: { half: FRAME, height: 3.9, arm: 1.9 } },
  // Packing stations: two rows back to back with a belt between them, centred here and turned by
  // yaw (π/2: running north-south), the west side lined up with the wrapper's
  packing: PACKING,
  // Powered conveyors, each carrying anything on it north (toward -z) at `speed`: one along the
  // east wall, and one between the packing rows up to the wrapper (packed boxes go to be wrapped)
  conveyors: CONVEYORS,
  decorativeDoors: [
    { wall: 'north', at: 10.5, label: 'OFFICE', width: 1.3 },
    { wall: 'north', at: 13.1, label: 'BATHROOM', width: 1.0 },
    { wall: 'north', at: 15.4, label: 'BATHROOM', width: 1.0 },
  ],
  staging: [{ x: -13.5, z: 17.2, w: 3.0, d: 2.4 }, { x: -0.1, z: 17.2, w: 3.0, d: 2.4 }],
  // Player-facing West edge of the lower level, north of the forklift parking bay.
  emptyPalletReturn: { x: lower.x0 + 12, z: lower.z1 - 1.85, half: 1.65 },
  // Forklift bay: its back against a wall, `width` along it and `depth` out from it, the truck
  // parked nose-out. In the basement's north-west corner, facing east along the ramp, so each
  // round starts with Ralph driving up it.
  parking: { wall: 'south', wallLine: lower.z1, at: lower.x1 - 2.2, width: 4, depth: 5.4, y: lower.y },
  // OSHA violations round the building (hazards.js). Things on a wall give the wall and how far
  // along it they are (x for the north and south walls, z for east and west); y is the floor height.
  hazards: {
    panel: { wall: 'east', at: CONVEYORS[0].z1 - .4 }, // leaking pipework at the cage-side end, beside the wall switch
    // Missing railing beside the main-floor ladder stand on the basement's east edge
    railingGap: { along: 'z', line: lower.x1, from: WRAP.z + FRAME + 0.1, to: lower.z1 },
    fireExits: [
      { wall: 'east', at: 8.55, y: 0, width: 6, depth: 3.2 }, // player-facing South wall, 10 m clear of Rack X
    ],
  },
  // yaw 0: the ladders hang on the south side of the stand; π: the north side; -π/2: the west side
  ladderStands: [
    { x: RACKS_E + 0.3, z: A + racking.depth / 2, y: 0, yaw: Math.PI / 2, count: 1, showLabel: false }, // against Rack A’s east endcap, clear of the forklift opening
    { x: -6.7, z: SOUTH - 0.3, y: 0, yaw: Math.PI, count: 1 },
    { x: 6.7, z: SOUTH - 0.3, y: 0, yaw: Math.PI, count: 1 }, // between the West-wall rack sections
  ],
  climberSpawn: { pos: [RACKS_E + 1.3, 0, A + racking.depth / 2], yaw: Math.PI }, // beside the main-floor ladder, facing the south wall
  // Where Dave can come back after a respawn
  spawnPoints: [
    [RACKS_E + 1.5, 0, -5.45],
    [RACKS_E + 1.5, 0, 1.55],
    [RACKS_E + 1.5, 0, 8.55],
    [W + 1.8, 0, -3],
    [W + 12, lower.y, -12.5],
    [W + 14, lower.y, -19.8],
    [RACKS_E - 3, 0, 15.2],
    [RACKS_E + 4, 0, -15],
    [E - 5, 0, 10],
    [-6.8, 0, 19.5], // the high-storage aisle
    [E - 6, 0, 18],
    [E - 3, 0, -9],
  ],
  // No random loose cartons at the start; rack stock and incoming loads remain.
  looseBoxes: [],
  // Slightly untidy, accessible stacks beside the basement edge, clear of the stair run.
  palletStacks: [
    { x: -12.5, z: -10.25, count: 5, yaw: -.035 },
    { x: -10, z: -10.4, count: 4, yaw: .04 },
    { x: -7.4, z: -10.3, count: 6, yaw: -.02 },
  ],
  // Only conveyor catch pallets start on the main floor; spare supply stays in the basement.
  pallets: CONVEYORS.map(c => [(c.x0 + c.x1) / 2, 0, c.z0 - 0.75, Math.PI / 2]),
  // Named stretches of the main floor for incident reports (first match wins).
  zones: [
    { name: 'The conveyor', x0: E - 2.6, z0: CONVEYORS[0].z0, x1: E, z1: CONVEYORS[0].z1 },
    { name: 'The packing line', x0: PACKING.x - PACK_BELT / 2, z0: PACK_LINE_END - 1.5, x1: PACKING.x + PACK_BELT / 2, z1: PACKING.z + PACK_LEN / 2 + 0.2 },
    { name: 'The west lane', x0: W, z0: lower.z1, x1: WEST, z1: 18.0 },
    { name: 'South of the racks', x0: WEST, z0: 13.3, x1: RACKS_E, z1: 18.0 },
    { name: 'By the ramp', x0: lower.x1, z0: NORTH, x1: PACK_WEST, z1: lower.z1 },
    { name: 'The east lane', x0: RACKS_E, z0: lower.z1, x1: PACK_WEST - 1.6, z1: SOUTH },
    { name: 'The east side', x0: PACK_WEST - 1.6, z0: NORTH, x1: E, z1: SOUTH },
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
    ['02', 'BASEMENT · W', [W + 0.35, 4.6, -11]],
    ['03', 'NORTH EAST', [E - 0.4, 5.4, NORTH + 0.4]],
    ['04', 'WEST LANE', [W + 0.35, 5.0, 6]],
    ['05', 'RAMP', [RACKS_E + 10, 5.4, NORTH + 0.35]],
    ['06', 'PACKING', [E - 0.35, 5.4, -10]],
    ['07', 'CONVEYOR', [E - 0.35, 5.0, 2]],
    ['08', 'SOUTH WEST', [W + 0.4, 7.2, SOUTH - 0.4]],
    ['09', 'HIGH STORAGE', [RACKS_E + 2.5, 6.0, SOUTH - 0.35]],
    ['10', 'SOUTH EAST', [E - 0.4, 5.4, SOUTH - 0.4]],
    ['11', 'SOUTH WALL', [E - 0.3, 2.8, 8.55]],
  ],
};

// A rack's east end
export const rackX1 = (r) => r.x0 + r.bays * LAYOUT.racking.bayW;

// Player-facing compass after the landscape presentation rotation; world axes remain stable.
export const WALL_LABELS = { north: 'E', east: 'S', south: 'W', west: 'N' };
