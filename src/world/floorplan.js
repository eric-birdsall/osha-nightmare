import { LAYOUT, rackX1 } from './layout.js';
import { STAIRS } from './level.js';
import { packingRect } from './packing.js';
import { parkingRect } from './parking.js';
import { hazardZones } from './hazards.js';

// The pause screen's floor plan, drawn from the layout. SVG x/y = world x/z, in metres.
const n = (v) => String(Math.round(v * 1000) / 1000);
const rect = (x, y, w, h, cls, id) => `<rect${id ? ` id="${id}"` : ''} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${cls ? ` class="${cls}"` : ''} />`;
const text = (x, y, t, cls) => `<text x="${n(x)}" y="${n(y)}" transform="rotate(-90 ${n(x)} ${n(y)})"${cls ? ` class="${cls}"` : ''}>${t}</text>`;

// Label positions are expressed in the final landscape view, not the unrotated world axes.
// Multiline labels keep long names within their allotted space.
const planLabel = (x, y, lines, size = 1.15) => lines.map((line, i) =>
  text(y + i * size * 1.25, -x, line, 'fp-zone').replace('<text ', `<text style="font-size:${size}px" `),
).join('');

export function drawFloorPlan(svg, { idPrefix = 'fp', showPlayers = true } = {}) {
  const { room, lower, ramp, racks, docks, wrap, conveyors } = LAYOUT;
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
    planLabel(-(lower.z0 + lower.z1) / 2 + 2.3, lower.x1 - 4.8, [lower.label, `${n(-lower.y)} M DOWN`], 1.2),
    ...LAYOUT.staging.flatMap(b => [rect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d, 'fp-park'), planLabel(-b.z, b.x, ['STAGING'], .65)]),
    ...conveyors.map((c) => box(c, 'fp-ramp')),
    // Repeated arrows follow actual belt velocity: positive speed carries toward world -Z.
    ...conveyors.flatMap((c) => {
      const cx = (c.x0 + c.x1) / 2, direction = c.speed >= 0 ? -1 : 1;
      const arrows = [];
      for (let z = c.z0 + 1.5; z < c.z1 - 0.5; z += 3.5) {
        const tip = z + direction * 0.75, tail = z - direction * 0.75;
        arrows.push(`<path class="fp-belt-arrow" d="M${n(cx)} ${n(tail)} L${n(cx)} ${n(tip)} M${n(cx - .28)} ${n(tip - direction * .4)} L${n(cx)} ${n(tip)} L${n(cx + .28)} ${n(tip - direction * .4)}" />`);
      }
      return arrows;
    }),
    text(conveyors[0].x0 - 1.2, (conveyors[0].z0 + conveyors[0].z1) / 2, 'CONVEYOR', 'fp-zone'),
    `<g class="fp-racks">${racks.map((r) => rect(r.x0, r.z0, rackX1(r) - r.x0, r.z1 - r.z0)).join('')}</g>`,
    `<g class="fp-labels">${racks.map((r) => text((r.x0 + rackX1(r)) / 2, (r.z0 + r.z1) / 2, r.name)).join('')}</g>`,
    planLabel(-21.8, -20.9, ['X / Y / Z'], .7),
    rect(wrap.x - wrap.frame.half, wrap.z - wrap.frame.half, wrap.frame.half * 2, wrap.frame.half * 2, 'fp-room'),
    rect(wrap.x - wrap.size / 2, wrap.z - wrap.size / 2, wrap.size, wrap.size, 'fp-wrap'),
    planLabel(-wrap.z, wrap.x + wrap.frame.half + 1.15, ['WRAPPER'], 1.1), // below it: the ramp is above
    ...(() => {
      const pk = packingRect();
      return [box(pk, 'fp-room'), planLabel(-(pk.z0 + pk.z1) / 2, pk.x0 - 1, ['PACKING'], 1.15)];
    })(),
    ...docks.map((d, i) => {
      const [r] = dockAt(d);
      return `<rect id="${idPrefix}-dock-${i}" x="${n(r.x0)}" y="${n(r.z0)}" width="${n(r.x1 - r.x0)}" height="${n(r.z1 - r.z0)}" class="fp-dock" />`;
    }),
    ...docks.map((d, i) => text(...dockAt(d)[1], `D${i + 1}`, 'fp-zone')),
    planLabel(-rcz, ramp.x1 - 0.8, ['RAMP'], 1.05),
    rect(park.x0, park.z0, park.x1 - park.x0, park.z1 - park.z0, 'fp-park'),
    text((park.x0 + park.x1) / 2, (park.z0 + park.z1) / 2, 'PARK', 'fp-zone'),
    // A stand turned side-on (against an east or west wall) runs north-south, labelled off to one side
    ...LAYOUT.ladderStands.map((st) => (Math.abs(Math.sin(st.yaw)) > 0.5 ? rect(st.x - 0.3, st.z - 1.1, 0.6, 2.2, 'fp-ladders') : rect(st.x - 1.1, st.z - 0.2, 2.2, 0.6, 'fp-ladders'))),
    ...LAYOUT.ladderStands.filter((st) => st.showLabel !== false).map((st) => planLabel(-st.z + 2.5, st.x, [st.count === 1 ? 'LADDER' : 'LADDERS'], .8)),
    ...LAYOUT.decorativeDoors.flatMap(d => [rect(d.at - d.width / 2, -halfZ, d.width, .2, 'fp-ladders'), planLabel(halfZ - 3.5, d.at, [d.label], .65)]),
    ...LAYOUT.hazards.fireExits.map(e => rect(halfX - e.depth, e.at - e.width / 2, e.depth, e.width, 'fp-room')),
    // Caged fire exits
    ...hazardZones()
      .filter((h) => h.name === 'The blocked fire exit')
      .map((h) => planLabel(Math.max(-halfZ + 3.5, Math.min(halfZ - 3.5, -h.z)), Math.max(-halfX + 1.2, Math.min(halfX - 1.2, h.x)), ['FIRE EXIT'], 1.1)),
    ...(showPlayers ? [`<circle id="${idPrefix}-dave" r="0.9" class="fp-dave" />`,
      `<circle id="${idPrefix}-ralph" r="1.1" class="fp-ralph" />`] : []),
  ];
  // Rotate presentation only: physics coordinates and live player markers stay in world space.
  svg.setAttribute('viewBox', `${-halfZ - 3} ${-halfX - 3} ${halfZ * 2 + 6} ${halfX * 2 + 11}`);
  const compass = `<g class="fp-rose" transform="translate(${n(halfZ - 1)} ${n(halfX + 4.5)})" aria-label="Compass: north up, east right, south down, west left">
    <circle r="1.5" /><path d="M0 -1.8 L.4 -.4 L1.8 0 L.4 .4 L0 1.8 L-.4 .4 L-1.8 0 L-.4 -.4 Z" />
    <path class="fp-rose-north" d="M0 -1.8 L.4 -.4 L0 0 L-.4 -.4 Z" />
    <text x="0" y="-2.4">N</text><text x="2.4" y="0">E</text><text x="0" y="2.4">S</text><text x="-2.4" y="0">W</text>
  </g>`;
  svg.innerHTML = `<g transform="rotate(90)">${parts.join('')}</g>${compass}`;
}
