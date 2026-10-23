// Placeholder beeps via Web Audio. No assets.

let ctx = null;

export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, dur, { type = 'square', vol = 0.08, at = 0, slideTo = null } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  pickup: () => tone(660, 0.08, { type: 'triangle', vol: 0.12, slideTo: 990 }),
  putdown: () => tone(440, 0.09, { type: 'triangle', vol: 0.12, slideTo: 300 }),
  jump: () => tone(300, 0.1, { type: 'sine', vol: 0.08, slideTo: 500 }),
  // The sad ding for the incident sign
  incident: () => {
    tone(784, 0.35, { type: 'sine', vol: 0.15 });
    tone(523, 0.7, { type: 'sine', vol: 0.15, at: 0.3 });
  },
  thud: () => tone(120, 0.18, { type: 'sawtooth', vol: 0.12, slideTo: 50 }),
  reverseBeep: () => tone(1100, 0.18, { type: 'square', vol: 0.04 }),
  wrapStart: () => tone(200, 2.8, { type: 'sawtooth', vol: 0.03, slideTo: 420 }),
  wrapDone: () => {
    tone(523, 0.1, { type: 'triangle', vol: 0.12 });
    tone(784, 0.18, { type: 'triangle', vol: 0.12, at: 0.1 });
  },
  // Crackle of an electrical short; v: 0..1 loudness (by distance)
  zap: (v = 1) => {
    for (let i = 0; i < 7; i++) tone(1200 + Math.random() * 3200, 0.03, { type: 'square', vol: 0.05 * v, at: i * 0.022 + Math.random() * 0.015 });
    tone(110, 0.14, { type: 'sawtooth', vol: 0.06 * v });
  },
  drip: (v = 1) => tone(1500, 0.05, { type: 'sine', vol: 0.035 * v, slideTo: 800 }),
  driftHop: () => tone(220, 0.1, { type: 'square', vol: 0.05, slideTo: 330 }),
  driftBoost: () => {
    tone(330, 0.25, { type: 'sawtooth', vol: 0.06, slideTo: 880 });
    tone(660, 0.2, { type: 'triangle', vol: 0.08, slideTo: 1320, at: 0.05 });
  },
  hint: () => tone(330, 0.12, { type: 'triangle', vol: 0.08 }),
  check: () => tone(880, 0.12, { type: 'triangle', vol: 0.12, slideTo: 1320 }),
  complete: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.14, at: i * 0.12 }));
  },
  swap: () => tone(500, 0.06, { type: 'sine', vol: 0.08, slideTo: 700 }),
  menu: () => tone(600, 0.04, { type: 'sine', vol: 0.06 }),
};
