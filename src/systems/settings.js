// Player settings that stick in this browser (Invert Look lives with the input code).

const KEY = 'osha.cctvReplays';

function read() {
  try {
    return localStorage.getItem(KEY) !== '0'; // on unless switched off
  } catch {
    return true;
  }
}

export const settings = {
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
