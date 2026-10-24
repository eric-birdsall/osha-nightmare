import { CONFIG } from '../config.js';

// Standard gamepad mapping indices
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, UP: 12, DOWN: 13 };

function deadzone2(x, y) {
  const dz = CONFIG.input.deadZone;
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * s, y * s];
}

const blank = () => ({
  moveX: 0, moveY: 0, lookX: 0, lookY: 0,
  jump: false, crouchHeld: false, interact: false, interactHeld: false, toss: false, tossHeld: false,
  steer: 0, throttle: 0, brake: 0, liftUp: 0, liftDown: 0, drift: false,
  swap: false, pause: false, respawnHeld: false,
});

// Maps keyboard/mouse and gamepads to per-character actions.
// Devices are named 'kbm', 'pad0', 'pad1' (pads in connection order).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.lastDevice = 'kbm';
    this.keyboardActivity = false;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pads = [];
    this.padPrev = new Map(); // gamepad.index -> {buttons:[], stickUp, stickDown}
    this.padEdges = new Map();
    this.dt = 1 / 60;
    // Invert look: up on the mouse, stick or I/K looks down (saved per browser)
    try {
      this.invertY = localStorage.getItem('osha.invertY') === '1';
    } catch {
      this.invertY = false;
    }

    addEventListener('keydown', (e) => {
      this.keyboardActivity = true;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // Mouse look: raw movement while pointer-locked. Where the lock is refused (embedded
    // browsers, or Chrome's cooldown right after Esc), drag with a button held instead.
    this.dragging = false;
    this.lockFailed = false;
    canvas.addEventListener('mousedown', () => { this.dragging = true; this.keyboardActivity = true; });
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('blur', () => (this.dragging = false));
    document.addEventListener('pointerlockerror', () => (this.lockFailed = true));
    document.addEventListener('pointerlockchange', () => {
      if (this.pointerLocked) this.lockFailed = false;
    });
    addEventListener('mousemove', (e) => {
      if (this.pointerLocked || this.dragging) {
        if (e.movementX || e.movementY) this.keyboardActivity = true;
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  lockPointer() {
    if (!this.pointerLocked) this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  // Call once per rendered frame before reading actions.
  poll(dt) {
    this.dt = dt;
    const list = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
    this.pads = list;
    this.padEdges.clear();
    if (this.keyboardActivity || this.keys.size) this.lastDevice = 'kbm';
    for (const p of list) {
      const prev = this.padPrev.get(p.index) || { buttons: [], up: false, down: false };
      const now = p.buttons.map((b) => b.pressed);
      const active = p.buttons.some((b) => b.pressed || b.value > 0.25) || p.axes.some((axis) => Math.abs(axis) > CONFIG.input.deadZone);
      if (active && !this.keyboardActivity && !this.keys.size) this.lastDevice = `pad${list.indexOf(p)}`;
      const sy = p.axes[1] || 0;
      const up = sy < -0.6;
      const down = sy > 0.6;
      const edges = new Set();
      now.forEach((b, i) => {
        if (b && !prev.buttons[i]) edges.add(i);
      });
      if (up && !prev.up) edges.add('stickUp');
      if (down && !prev.down) edges.add('stickDown');
      this.padEdges.set(p.index, edges);
      this.padPrev.set(p.index, { buttons: now, up, down });
    }
    if (this.lastDevice !== 'kbm' && !this.pad(this.lastDevice)) this.lastDevice = 'kbm';
    this.keyboardActivity = false;
    document.body.dataset.input = this.lastDevice === 'kbm' ? 'keyboard' : 'controller';
  }

  // Clear per-frame edges and mouse deltas (after the first physics step consumed them).
  consumeEdges() {
    this.pressed.clear();
    this.padEdges.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  padCount() {
    return this.pads.length;
  }

  pad(device) {
    const i = device === 'pad0' ? 0 : device === 'pad1' ? 1 : -1;
    return i >= 0 ? this.pads[i] || null : null;
  }

  padPressed(p, btn) {
    return !!(p && this.padEdges.get(p.index)?.has(btn));
  }

  key(code) {
    return this.keys.has(code) ? 1 : 0;
  }

  // IJKL look keys, scaled like a full stick deflection: J/L turn, I/K tilt up/down.
  keyLookX() {
    return this.key('KeyL') - this.key('KeyJ');
  }

  setInvertY(on) {
    this.invertY = on;
    try {
      localStorage.setItem('osha.invertY', on ? '1' : '0');
    } catch {}
  }

  keyLookY() {
    return this.key('KeyK') - this.key('KeyI');
  }

  // devices: array of device names feeding this role (single player merges kbm + all pads)
  climberActions(devices) {
    const a = blank();
    const cfg = CONFIG.climber;
    for (const d of devices) {
      if (d === 'kbm') {
        a.moveX += this.key('KeyD') - this.key('KeyA');
        a.moveY += this.key('KeyW') - this.key('KeyS');
        a.lookX += this.mouseDX * cfg.lookSensitivity + this.keyLookX() * cfg.stickLookSpeed * this.dt;
        a.lookY += this.mouseDY * cfg.lookSensitivity + this.keyLookY() * cfg.stickLookSpeed * this.dt;
        a.jump ||= this.pressed.has('Space');
        a.crouchHeld ||= !!(this.key('ControlLeft') || this.key('ControlRight'));
        a.interact ||= this.pressed.has('KeyE');
        a.interactHeld ||= this.key('KeyE') > 0;
        a.toss ||= this.pressed.has('KeyR');
        a.tossHeld ||= this.key('KeyR') > 0;
        a.respawnHeld ||= this.key('KeyQ') > 0;
        a.swap ||= this.pressed.has('Tab');
      } else {
        const p = this.pad(d);
        if (!p) continue;
        const [mx, my] = deadzone2(p.axes[0] || 0, p.axes[1] || 0);
        const [lx, ly] = deadzone2(p.axes[2] || 0, p.axes[3] || 0);
        a.moveX += mx;
        a.moveY -= my;
        a.lookX += lx * cfg.stickLookSpeed * this.dt;
        a.lookY += ly * cfg.stickLookSpeed * this.dt;
        a.jump ||= this.padPressed(p, BTN.A);
        a.crouchHeld ||= !!p.buttons[BTN.L3]?.pressed;
        a.interact ||= this.padPressed(p, BTN.X);
        a.interactHeld ||= !!p.buttons[BTN.X]?.pressed;
        a.toss ||= this.padPressed(p, BTN.RB);
        a.tossHeld ||= !!p.buttons[BTN.RB]?.pressed;
        a.respawnHeld ||= !!p.buttons[BTN.Y]?.pressed;
        a.swap ||= this.padPressed(p, BTN.BACK);
        a.pause ||= this.padPressed(p, BTN.START);
      }
    }
    if (this.invertY) a.lookY = -a.lookY;
    const m = Math.hypot(a.moveX, a.moveY);
    if (m > 1) {
      a.moveX /= m;
      a.moveY /= m;
    }
    return a;
  }

  driverActions(devices) {
    const a = blank();
    const cfg = CONFIG.forklift;
    for (const d of devices) {
      if (d === 'kbm') {
        a.steer += this.key('KeyD') - this.key('KeyA');
        a.throttle = Math.max(a.throttle, this.key('KeyW'));
        a.brake = Math.max(a.brake, this.key('KeyS'));
        a.liftUp = Math.max(a.liftUp, this.key('KeyR'));
        a.liftDown = Math.max(a.liftDown, this.key('KeyF'));
        a.drift ||= this.key('Space') > 0;
        a.respawnHeld ||= this.key('KeyQ') > 0;
        a.lookX += this.mouseDX * cfg.lookSensitivity + this.keyLookX() * cfg.stickLookSpeed * this.dt;
        a.lookY += this.mouseDY * cfg.lookSensitivity + this.keyLookY() * cfg.stickLookSpeed * this.dt;
        a.swap ||= this.pressed.has('Tab');
      } else {
        const p = this.pad(d);
        if (!p) continue;
        // Left stick drives: up = forward, down = brake then reverse, sideways = steer.
        // (The triggers still work as accelerator and brake.)
        const [sx, sy] = deadzone2(p.axes[0] || 0, p.axes[1] || 0);
        const [lx, ly] = deadzone2(p.axes[2] || 0, p.axes[3] || 0);
        a.steer += sx;
        a.throttle = Math.max(a.throttle, -sy, p.buttons[BTN.RT]?.value || 0);
        a.brake = Math.max(a.brake, sy, p.buttons[BTN.LT]?.value || 0);
        a.liftUp = Math.max(a.liftUp, p.buttons[BTN.RB]?.pressed ? 1 : 0);
        a.liftDown = Math.max(a.liftDown, p.buttons[BTN.LB]?.pressed ? 1 : 0);
        a.drift ||= !!p.buttons[BTN.B]?.pressed;
        a.respawnHeld ||= !!p.buttons[BTN.Y]?.pressed;
        a.lookX += lx * cfg.stickLookSpeed * this.dt;
        a.lookY += ly * cfg.stickLookSpeed * this.dt;
        a.swap ||= this.padPressed(p, BTN.BACK);
        a.pause ||= this.padPressed(p, BTN.START);
      }
    }
    a.steer = Math.max(-1, Math.min(1, a.steer));
    if (this.invertY) a.lookY = -a.lookY;
    return a;
  }

  // Menu navigation from any device.
  menu() {
    const m = { up: false, down: false, confirm: false, back: false, pause: false };
    const k = this.pressed;
    m.up = k.has('ArrowUp') || k.has('KeyW');
    m.down = k.has('ArrowDown') || k.has('KeyS');
    m.confirm = k.has('Enter') || k.has('Space');
    m.back = k.has('Escape');
    m.pause = k.has('Escape');
    for (const p of this.pads) {
      m.up ||= this.padPressed(p, BTN.UP) || this.padPressed(p, 'stickUp');
      m.down ||= this.padPressed(p, BTN.DOWN) || this.padPressed(p, 'stickDown');
      m.confirm ||= this.padPressed(p, BTN.A);
      m.back ||= this.padPressed(p, BTN.B);
      m.pause ||= this.padPressed(p, BTN.START);
    }
    return m;
  }
}
