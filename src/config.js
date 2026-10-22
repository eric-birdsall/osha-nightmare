// All playtest tuning values live here. Units: meters, seconds, kilograms, radians.

const deg = (d) => (d * Math.PI) / 180;

export const CONFIG = {
  physics: {
    dt: 1 / 60,
    gravity: -9.81,
    solverIterations: 8, // Rapier default is 4; more = steadier stacks
    maxStepsPerFrame: 5,
  },

  climber: {
    height: 1.8,
    radius: 0.35,
    eyeHeight: 1.65,
    walkSpeed: 3.5,
    groundAccel: 30, // m/s² toward target walk velocity
    airAccel: 4, // limited air control
    jumpHeight: 1.0,
    mantleHeight: 0.35, // airborne: ledges this far above the feet get climbed
    gravity: 9.81,
    characterMass: 70, // used when the climber shoves boxes and pallets
    pushStrength: 2.5, // how hard walking into a box shoves it
    reach: 1.5, // pick up: aimed box surface within this distance of the chest
    chestDrop: 0.45, // chest is this far below the eye
    placeReach: 2.2, // put down: how far the aim ray looks for a surface
    lookSensitivity: 0.0022, // rad per mouse pixel
    stickLookSpeed: 2.8, // rad/s at full stick
    // Ragdoll triggers
    fallRagdollHeight: 2.5, // fall distance below jump peak
    hitSpeed: 1.5, // forklift moving at the climber faster than this (m/s) = incident
    crushForkSpeed: 0.1, // lowering forks this fast onto the climber's head = incident
    fallingLoadSpeed: 1.0, // a box/pallet falling this fast onto the climber's head = incident
    throwAccel: 10, // support horizontal acceleration (m/s², smoothed) that throws them off
    throwAccelSmoothing: 0.35, // EMA factor per step (higher = twitchier)
    throwMinSupportSpeed: 1.5, // the support must be moving at least this fast (m/s) to throw you
    dropSpeed: 2.0, // support falling faster than this drops them
    supportLostTime: 0.15, // moving support vanished for this long = thrown
    lowSupportHeight: 1.2, // thrown/dropped only count when Dave's feet are at least this high off the floor (m)
    ragdollTime: 3.0,
    respawnClearance: 4.0, // skip spawn points this close to the forklift (center, or 1 s ahead)
    respawnGrace: 2.0, // seconds after respawn when forklift contact only nudges
    ragdollFade: 0.6,
    wrappedLockTime: 5.0,
  },

  forklift: {
    mass: 3000,
    centerOfMass: [0, 0.8, -0.35], // toward the counterweight; with rollDamping, a hard turn at full speed (~4 m/s) tips it
    gripHeight: 0, // where the sideways tire grip acts (0 = the floor)
    inertia: [1700, 1800, 650],
    topSpeed: 4.0,
    reverseSpeed: 2.5,
    accel: 2.2,
    reverseAccel: 1.6,
    brakeDecel: 5.33, // 4 m/s to 0 in ~1.5 m
    coastDecel: 0.7,
    parkDecel: 6.0, // idle forklift in single player holds still
    traction: 1.0, // tire friction coefficient (caps drive/lateral impulses)
    steerMax: deg(60),
    steerRate: deg(140), // how fast the rear wheels turn
    maxYawRate: 1.7,
    rollDamping: 6, // 1/s: higher = harder to tip; at 6 only a sharp turn at full throttle tips it
    yawAccel: 4.0,
    wheelbase: 1.4,
    liftMin: 0.1,
    liftMax: 3.5,
    liftSpeed: 0.4,
    lowerSpeed: 0.7, // forks come down faster than they go up
    liftAccel: 0.8, // ease in and out
    liftStiffness: 2500, // carriage motor (acceleration-based)
    liftDamping: 120,
    lookYawLimit: deg(120),
    lookPitchLimit: deg(60),
    lookSensitivity: 0.0022,
    stickLookSpeed: 2.4,
    seatEye: [0, 1.85, -0.25],
    leanOffset: [0, 0.08, 0.45], // eye shift when looking down at the forks
    rightAfter: 4, // seconds tipped over before it's reset upright
  },

  objects: {
    pallet: { size: [1.0, 0.15, 1.2], mass: 25, friction: 0.7, color: 0xb08850 },
    small: { size: [0.4, 0.4, 0.4], mass: 5, friction: 0.6, color: 0xc9a66b },
    medium: { size: [0.6, 0.6, 0.6], mass: 12, friction: 0.6, color: 0xb8925a },
    large: { size: [0.6, 0.9, 0.6], mass: 20, friction: 0.6, color: 0xa47e4a },
  },

  racks: {
    massPerBay: 60, // kg: light racking (each rack is 6 bays)
    friction: 3.0, // feet grip the floor hard, so hits rock a rack instead of skating it along
    // Wobbly racking: a new hit also rocks the top of the rack along the direction of travel
    tipImpactSpeed: 1.4, // forklift hits slower than this (m/s) just bump it
    tipKick: 1.3, // top impulse = loaded rack mass (rack + boxes on it) x tipKick x hit speed: ~1.8 m/s and up tips it
    ladderImpactSpeed: 0.6, // a ladder's top moving faster than this when it hits a rack
    ladderKick: 4, // top impulse = ladder mass x ladderKick x speed, scaled by the rack's load
    rackKick: 2.5, // a falling rack hitting its neighbour: falling rack mass x rackKick x top speed, scaled by load
    maxKickSpeed: 3.5, // m/s: cap on how fast any one kick can push a rack's top (no launching racks)
    crushSpeed: 1.5, // a rack part moving at the climber faster than this (m/s) = incident
  },

  ladder: {
    platformHeight: 2.95, // level with shelf 2 (3.0 m), so Dave can step across
    rise: 0.2, // per step: under the climber's 0.22 m step-up, so the steps work like stairs
    tread: 0.2,
    width: 1.0,
    platformDepth: 0.6,
    mass: 60,
    friction: 0.3, // on casters: rolls easily
    rollSpeedFactor: 0.55, // Dave walks this much slower while rolling a ladder
    rollGain: 0.35, // how firmly the ladder follows Dave (0-1 per step)
    maxRollSpeed: 2.5,
    maxTurnRate: 2.5, // rad/s
    snagDistance: 0.6, // ladder this far from where it should be (stuck on something) = let go
  },

  order: {
    decoyChance: 0.6, // chance an order slot also holds a near-miss SKU next to the right box
    backstockChance: 0.5, // chance a 2-box line 2 is also one short at its pick face (line 1 always is)
  },

  wrap: {
    restSpeed: 0.1,
    restTime: 1.0,
    duration: 3.0,
    maxPalletHeight: 0.6, // pallet must be on (or just above) the floor
  },

  dock: {
    restSpeed: 0.1,
    restTime: 0.5,
  },

  replay: {
    delay: 1.5, // seconds after an incident before the replay starts
    speed: 0.5, // slow motion
    postSeconds: 1.4, // how much after the incident the last angle shows
    bufferSeconds: 5,
  },

  input: {
    deadZone: 0.15,
  },

  hud: {
    startDays: 47,
    secondsPerDay: 30, // incident-free time it takes to add a "day"
  },
};
