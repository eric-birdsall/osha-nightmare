// CSS-pixel bounds shared by the WebGL feed and its DOM frame.
export function forkViewBounds(width, height) {
  const w = Math.min(320, width * 0.32, height * 0.65);
  const h = w * 0.625;
  return { left: 12, top: height - h - 112, width: w, height: h };
}
export function showForkFeed(forklift) {
  return !forklift.tipped && !forklift.forkViewExpanded && forklift.measuredHeight() >= 2.5;
}
