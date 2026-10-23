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
    walkSpeed: 4.0, // m/s (was 3.5)
    groundAccel: 30, // m/s² toward target walk velocity
    airAccel: 4, // limited air control
    jumpHeight: 1.0,
    mantleHeight: 0.35, // airborne: ledges this far above the feet get climbed
    gravity: 9.81,
    characterMass: 70, // used when the climber shoves boxes and pallets
    pushStrength: 2.5, // how hard walking into a box shoves it
    reach: 1.5,
    maxCarry: 3, // boxes Dave can carry as a stack (pick up the bottom one)
    stackSpeed: [1, 0.85, 0.75], // walk speed factor carrying 1, 2, 3 boxes
    tossSpeed: 6, // m/s along the crosshair when he throws a box (Q / RB)
    tossLift: 1.5, // plus a little upward lob // pick up: aimed box surface within this distance of the chest
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
    legBreakSpeed: 2.7, // forks hitting the ground faster than this (near full speed) break the legs of a Dave riding them
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
    topSpeed: 6.0,
    reverseSpeed: 2.5,
    accel: 2.8,
    reverseAccel: 1.6,
    brakeDecel: 6.0, // 6 m/s to 0 in ~3 m
    coastDecel: 0.7,
    parkDecel: 0.7, // m/s²: unattended (you swapped to Dave), it coasts like Ralph taking his foot off
    traction: 1.0, // tire friction coefficient (caps drive/lateral impulses)
    steerMax: deg(60),
    steerRate: deg(140), // how fast the rear wheels turn
    maxYawRate: 1.7,
    // Drifting: hold Space / B while turning at speed and the rear tyres let go
    drift: {
      minSpeed: 2.0, // m/s before a drift can start
      gripLatAccel: 6.5, // m/s²: how hard a normal (grip) turn can corner, so fast turns run wide
      grip: 0.3, // sideways grip while drifting (of normal): the truck slides at a steady angle
      yawRate: 1.5, // rad/s the tail swings round at full lock, whatever the speed
      yawAccel: 7, // rad/s² to get there
      drag: 0.4, // m/s² of speed scrubbed off while sliding
      inTime: 0.15, // s for the rear to let go
      outTime: 0.45, // s for grip to come back after letting go of the button
      minSlip: 0.2, // rad: sliding this sideways (or more) charges the boost
      boostCharge: 0.8, // s of good drifting for a boost on release
      boostSpeed: 2.0, // m/s over top speed while boosting
      boostAccel: 6, // m/s² push while boosting
      boostTime: 0.8, // s
      hop: 1.5, // m/s up when the drift button goes down at speed (a Mario Kart hop)
      boostFov: 14, // degrees the cab view widens during a boost
    },
    rollDamping: 6, // 1/s: higher = harder to tip; at 6 only a sharp turn at full throttle tips it
    yawAccel: 4.0,
    wheelbase: 1.4,
    liftMin: 0.1,
    liftMax: 3.5,
    freeLift: 1.0, // m the forks rise before the inner mast starts telescoping up (collapsed, the mast fits in a trailer)
    liftSpeed: 0.4,
    lowerSpeed: 3.0, // forks can come down fast: holding F/LB keeps speeding them up...
    lowerAccel: 2.0, // ...at this rate (m/s²), so a short tap still lowers gently
    lowerStop: 8.0, // and stop hard (m/s²) when you let go; held down, they hit the ground at speed
    liftAccel: 0.8, // ease in and out going up
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
    fragileChance: 0.15, // share of SKUs printed FRAGILE (they explode if dropped or thrown)
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
    fallImpactSpeed: 0.6, // a falling rack's top moving faster than this when it hits its neighbour
    rackKick: 2.5, // a falling rack hitting its neighbour: falling rack mass x rackKick x top speed, scaled by load
    resetHoldTime: 3, // s of holding E/X near knocked-over racking to set it all back up
    resetRange: 3, // m from Dave to a knocked rack for the reset to be offered
    maxKickSpeed: 3.5, // m/s: cap on how fast any one kick can push a rack's top (no launching racks)
    crushSpeed: 1.5, // a rack part moving at the climber faster than this (m/s) = incident
  },

  ladder: {
    // A-frame step ladder (local +Z = the step side)
    capHeight: 1.8, // top cap
    topStep: 1.55, // highest step Dave stands on: his reach covers shelf 2 (3.0 m) but not shelf 3
    steps: 5,
    tread: 0.12,
    width: 0.8, // wide enough for the fork tines to slide between the legs
    baseFront: 0.48, // feet of the step section (z), spreading to... (front to back fits the 1.1 m forks)
    topFront: 0.1, // ...the top of it
    baseBack: -0.45, // rear legs
    topBack: -0.1,
    mass: 18,
    friction: 0.8,
    climbSpeed: 0.9, // m/s up or down the steps
    lookDownPitch: 0.5, // rad (~30°): looking further down than this, forward climbs down
    carrySpeedFactor: 0.7, // Dave walks this much slower with a ladder on his shoulder
    climbableUp: 0.95, // upright enough to climb (cos of lean)
    fallUp: 0.85, // leaning further than this with Dave on it = it's going over
    setupDistance: 1.05, // ladder centre this far in front of Dave when set up
    jumpKick: 2.5, // m/s at the top cap when Dave jumps off: always enough to send it over
    maxRideSpeed: 1.5, // m/s: a ladder moving faster than this with Dave on it throws him off
  },

  // A FRAGILE box going off (dropped or thrown by Dave)
  blast: {
    radius: 30, // m: everything loose within this is flung (most of the warehouse)
    speed: 20, // m/s at the centre, falling off to 0 at the edge
    daveSpeed: 14, // m/s cap on how hard Dave himself is flung
    fireball: 0.5, // fireball grows to this fraction of the radius
    duration: 0.8, // s the fireball lasts
    upward: 0.6, // lift in the push direction (0 = flat out)
    spin: 8, // rad/s of tumble on flung things
    forkliftScale: 0.25, // the forklift only gets shoved, not launched
  },

  spill: {
    count: [2, 3], // spills per order (min, max)
    radius: [1.2, 1.6], // m (2.4-3.2 m across: room for the whole forklift)
    daveGrip: 0.06, // Dave's grip on a spill (of normal): he slides along with whatever momentum he had
    forkliftGrip: 0.1, // tyre traction per wet wheel (of normal)
    friction: 0.03, // the slick patch loose things (boxes, pallets, ladders) slide on
  },

  order: {
    decoyChance: 0.6, // chance an order slot also holds a near-miss SKU next to the right box
    extraBackstock: 6, // BACKSTOCK signs (with real backstock behind them) on stock that isn't on the order
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
