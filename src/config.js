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
    characterMass: 70, // used when the controller shoves boxes
    reach: 1.5, // pick up: aimed box surface within this distance of the chest
    chestDrop: 0.45, // chest is this far below the eye
    placeReach: 2.2, // put down: how far the aim ray looks for a surface
    lookSensitivity: 0.0022, // rad per mouse pixel
    stickLookSpeed: 2.8, // rad/s at full stick
    // Ragdoll triggers
    fallRagdollHeight: 2.5, // fall distance below jump peak
    hitSpeed: 1.5, // forklift relative speed that bowls the climber over
    throwAccel: 6, // support horizontal acceleration that throws them off
    throwAccelSmoothing: 0.35, // EMA factor per step (higher = twitchier)
    throwMinSupportSpeed: 0.3, // ignore accel spikes on a near-still support
    dropSpeed: 2.0, // support falling faster than this drops them
    supportLostTime: 0.15, // moving support vanished for this long = thrown
    ragdollTime: 3.0,
    respawnClearance: 4.0, // skip spawn points this close to the forklift (center, or 1 s ahead)
    respawnGrace: 2.0, // seconds after respawn when forklift contact only nudges
    ragdollFade: 0.6,
    wrappedLockTime: 5.0,
  },

  forklift: {
    mass: 3000,
    centerOfMass: [0, 0.5, -0.35], // low and toward the counterweight
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
    yawAccel: 4.0,
    wheelbase: 1.4,
    liftMin: 0.1,
    liftMax: 3.5,
    liftSpeed: 0.4,
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
    item: { size: [0.5, 0.5, 0.5], mass: 8, friction: 0.6 },
  },

  items: {
    A: { color: 0xff3fa4, label: 'A' },
    B: { color: 0x22d3ee, label: 'B' },
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

  input: {
    deadZone: 0.15,
  },

  hud: {
    startDays: 47,
    secondsPerDay: 30, // incident-free time it takes to add a "day"
  },
};
