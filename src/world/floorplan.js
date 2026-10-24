import { LAYOUT, rackX1 } from './layout.js';
import { STAIRS } from './level.js';
import { packingRect } from './packing.js';
import { mezzanineStairs } from './mezzanine.js';
import { parkingRect } from './parking.js';
import { hazardZones } from './hazards.js';

// The pause screen's floor plan, drawn from the layout. SVG x/y = world x/z, in metres.
const n = (v) => String(Math.round(v * 1000) / 1000);
const rect = (x, y, w, h, cls, id) => `<rect${id ? ` id="${id}"` : ''} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${cls ? ` class="${cls}"` : ''} />`;
const text = (x, y, t, cls) => `<text x="${n(x)}" y="${n(y)}"${cls ? ` class="${cls}"` : ''}>${t}</text>`;

export function drawFloorPlan(svg) {
  const { room, lower, ramp, racks, docks, wrap, conveyor, mezzanine: mz } = LAYOUT;
  const park = parkingRect();
  const { halfX, halfZ } = room;
  const box = (r, cls) => rect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0, cls);
  // A dock's doorway marking, 4 m along its wall and 3.6 m in, and where its label goes
  const dockAt = (d) =>
    ({
      north: [{ x0: d.at - 2, x1: d.at + 2, z0: -halfZ, z1: -halfZ + 3.6 }, [d.at, -halfZ + 5]],
      south: [{ x0: d.at - 2, x1: d.at + 2, z0: halfZ - 3.6, z1: halfZ }, [d.at, halfZ - 5]],
      west: [{ x0: -halfX, x1: -halfX + 3.6, z0: d.at - 2, z1: d.at + 2 }, [-halfX + 5.2, d.at]],
      east: [{ x0: halfX - 3.6, x1: halfX, z0: d.at - 2, z1: d.at + 2 }, [halfX - 5.2, d.at]],
    })[d.wall];
  // Ramp arrow, pointing down the ramp: from near its top to near its bottom, with a head
  const DIRS = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] };
  const [dx, dz] = DIRS[ramp.down];
  const rcx = (ramp.x0 + ramp.x1) / 2;
  const rcz = (ramp.z0 + ramp.z1) / 2;
  const half = (dx ? ramp.x1 - ramp.x0 : ramp.z1 - ramp.z0) / 2 - 1.5;
  const [tx, tz] = [rcx - dx * half, rcz - dz * half];
  const [hx, hz] = [rcx + dx * half, rcz + dz * half];
  const head = (s) => [hx - dx * 1.2 + dz * 0.8 * s, hz - dz * 1.2 - dx * 0.8 * s];
  const [l, r] = [head(1), head(-1)];
  const parts = [
    rect(-halfX, -halfZ, halfX * 2, halfZ * 2, 'fp-wall'),
    rect(lower.x0, lower.z0, lower.x1 - lower.x0, lower.z1 - lower.z0, 'fp-lower'),
    rect(ramp.x0, ramp.z0, ramp.x1 - ramp.x0, ramp.z1 - ramp.z0, 'fp-ramp'),
    `<path d="M${n(tx)} ${n(tz)} L${n(hx)} ${n(hz)} M${n(l[0])} ${n(l[1])} L${n(hx)} ${n(hz)} L${n(r[0])} ${n(r[1])}" class="fp-arrow" />`,
    rect(STAIRS.x0, STAIRS.z0, STAIRS.x1 - STAIRS.x0, STAIRS.z1 - STAIRS.z0, 'fp-stairs'),
    text((lower.x0 + lower.x1) / 2 + 2, lower.z1 - 1.6, `${lower.label} · ${n(-lower.y)} M DOWN`, 'fp-zone'),
    // The mezzanine (over the break room) and its stairs, the conveyor
    box(mz, 'fp-lower'),
    box(mezzanineStairs(), 'fp-stairs'),
    text((mz.x0 + mz.x1) / 2, mz.z1 - 0.7, 'MEZZANINE · BREAK ROOM UNDER', 'fp-zone'),
    box(conveyor, 'fp-ramp'),
    text(conveyor.x0 - 1.2, (conveyor.z0 + conveyor.z1) / 2, 'CONVEYOR', 'fp-zone'),
    `<g class="fp-racks">${racks.map((r) => rect(r.x0, r.z0, rackX1(r) - r.x0, r.z1 - r.z0)).join('')}</g>`,
    `<g class="fp-labels">${racks.map((r) => text((r.x0 + rackX1(r)) / 2, (r.z0 + r.z1) / 2, `RACK ${r.name}`)).join('')}</g>`,
    rect(wrap.x - wrap.frame.half, wrap.z - wrap.frame.half, wrap.frame.half * 2, wrap.frame.half * 2, 'fp-room'),
    rect(wrap.x - wrap.size / 2, wrap.z - wrap.size / 2, wrap.size, wrap.size, 'fp-wrap'),
    text(wrap.x, wrap.z - wrap.frame.half - 0.6, 'WRAPPER', 'fp-zone'),
    ...(() => {
      const pk = packingRect();
      return [box(pk, 'fp-room'), text((pk.x0 + pk.x1) / 2, pk.z1 + 0.9, 'PACKING', 'fp-zone')];
    })(),
    ...docks.map((d, i) => {
      const [r] = dockAt(d);
      return `<rect id="fp-dock-${i}" x="${n(r.x0)}" y="${n(r.z0)}" width="${n(r.x1 - r.x0)}" height="${n(r.z1 - r.z0)}" class="fp-dock" />`;
    }),
    ...docks.map((d, i) => text(...dockAt(d)[1], `D${i + 1}`, 'fp-zone')),
    text(rcx, rcz + 0.5, 'RAMP', 'fp-zone'),
    rect(park.x0, park.z0, park.x1 - park.x0, park.z1 - park.z0, 'fp-park'),
    text((park.x0 + park.x1) / 2, (park.z0 + park.z1) / 2, 'PARK', 'fp-zone'),
    ...LAYOUT.ladderStands.map((st) => rect(st.x - 1.1, st.z - 0.2, 2.2, 0.6, 'fp-ladders')),
    ...LAYOUT.ladderStands.map((st) => text(st.x, st.z + 1.1, 'LADDERS', 'fp-zone')),
    // Fire exits (blocked, but they're on the plan) and the barrels nobody can identify
    ...hazardZones()
      .filter((h) => h.name === 'The blocked fire exit' || h.name === 'The mystery barrels')
      .map((h) => text(h.x, h.z, h.name === 'The mystery barrels' ? '???' : 'FIRE EXIT', 'fp-zone')),
    // The walls' compass letters, just outside them
    text(0, -halfZ - 1.5, 'N', 'fp-compass'),
    text(0, halfZ + 1.5, 'S', 'fp-compass'),
    text(-halfX - 1.5, 0, 'W', 'fp-compass'),
    text(halfX + 1.5, 0, 'E', 'fp-compass'),
    '<circle id="fp-dave" r="0.9" class="fp-dave" />',
    '<circle id="fp-ralph" r="1.1" class="fp-ralph" />',
  ];
  svg.setAttribute('viewBox', `${-halfX - 3} ${-halfZ - 3} ${halfX * 2 + 6} ${halfZ * 2 + 6}`);
  svg.innerHTML = parts.join('');
}
