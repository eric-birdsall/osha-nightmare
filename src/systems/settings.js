// Player settings that stick in this browser (Invert Look lives with the input code).

const KEY = 'osha.cctvReplays';
const GFX_KEY = 'osha.graphics';

function read() {
  try {
    return localStorage.getItem(KEY) !== '0'; // on unless switched off
  } catch {
    return true;
  }
}

// 'high' or 'low'. Consoles (Xbox Edge) lose the WebGL context at full quality, so they start on Low.
function readGraphics() {
  try {
    const saved = localStorage.getItem(GFX_KEY);
    if (saved === 'high' || saved === 'low') return saved;
  } catch {
    // storage blocked: fall through to the default
  }
  return /Xbox|PlayStation|Nintendo/i.test(navigator.userAgent) ? 'low' : 'high';
}

export const settings = {
  // Graphics quality, read once at start-up (antialiasing can only be chosen when the renderer is made)
  graphics: readGraphics(),
  setGraphics(level) {
    this.graphics = level;
    try {
      localStorage.setItem(GFX_KEY, level);
    } catch {
      // private window or storage blocked: it just won't be remembered
    }
  },
  // Show the CCTV replay after an incident (the clock stops while it plays)
  cctvReplays: read(),
  setCctvReplays(on) {
    this.cctvReplays = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // private window or storage blocked: it just won't be remembered
    }
  },
};
