# OSHA Nightmare: first playable

Greybox prototype: first-person stacking, jumping and forklift-riding. Three.js + Rapier + Vite.

The crew: **Dave** climbs, **Ralph** drives the forklift. Incident banners and CCTV replays name who did what to whom.

**Play:** https://eric-birdsall.github.io/osha-nightmare/ (every push to `main` redeploys via GitHub Actions).

```bash
npm install
npm run dev
```

Open the printed URL in Chrome. Click the canvas to capture the mouse.

## The order

Every shelf in every bay is stocked with plain cardboard boxes (about 300), each with a barcode label and a unique 4-digit SKU on all four sides. The clipboard lists two SKUs and their Rack-Bay-Shelf locations, picked at random each game:

- **Line 1:** shelf 2 of any rack (reach it from the forks or a ladder).
- **Line 2:** shelf 3, the top, of a different rack (reach it from the forks near full height, or from the top of a ladder).

The order boxes look like every other box, and the right location usually also holds a decoy with a near-miss SKU (two digits swapped, or one digit off), so check the label against the clipboard. Aim at a box to see its SKU in the pick-up prompt. A line only ticks off when the box with the matching SKU is on a pallet. Get both onto one pallet, set it down on the floor in the yellow **WRAP** square, back the forklift out of the square, and leave the pallet still until it's wrapped, then bring the wrapped pallet to **DOCK 1** and stop there. A wrapped pallet missing a SKU is turned away at the dock. To fix it, put the missing box on top of the wrapped load and bring it back to the wrap square: it gets wrapped again with the new box included.

The warehouse is 48 × 32 m. Five racks (A–E, six bays each, single-deep) fill the west half, laid out like a real warehouse: Rack A against the north wall, B and C back to back, D and E back to back, with 4.4 m aisles A/B and C/D between them. The wrap square, Dock 1 and the forklift start in the open east half. Locations read Rack-Bay-Shelf. Bays are numbered 1–6 from the west end of each rack, and shelves 1–3 from the bottom (1.5 m, 3.0 m, 4.5 m). Each rack's aisle face shows rack signs at both ends and a location tag under each shelf beam.

## Controls

| | Gamepad | Keyboard / mouse |
|---|---|---|
| **Climber** move / look | Left / right stick | WASD / mouse or IJKL |
| Jump | A | Space |
| Pick up / put down, grab or let go of a ladder, hold on to the forks | X | E |
| **Driver** steer / look | Left / right stick | A, D / mouse or IJKL |
| Accelerate / brake (then reverse) | RT / LT | W / S |
| Forks up / down | RB / LB | R / F |
| Swap character (single player) | View | Tab |
| Pause | Menu | Esc |

Co-op uses split screen, with the Climber on top. Gamepad 1 plays the Climber and gamepad 2 the Driver. If only one pad is connected, player 2 uses keyboard and mouse. Pause → Swap Roles trades characters. **Invert Look** (title screen or pause menu) flips up/down for the mouse, sticks and I/K; it's remembered in this browser.

## Layout

- `src/config.js`: every tuning value (speeds, masses, lift rate, friction, ragdoll thresholds)
- `src/main.js`: renderer, fixed 1/60 s loop, menus, pointer lock
- `src/world/level.js`: warehouse, racks, zones, initial boxes and pallets
- `src/entities/`: `climber.js` (character controller, carry, ragdoll triggers), `forklift.js`, `box.js`, `pallet.js`
- `src/systems/`: `input.js`, `ragdoll.js`, `wrapping.js`, `game.js` (order state, swap, win), `hud.js`, `audio.js`

## Implementation notes (where it differs from or adds to the spec)

- **Forks** are a separate dynamic carriage body on a motorized prismatic joint up the mast. The solver therefore knows the fork velocity: loads lift smoothly, their weight presses on the truck, and racks block the forks.
- **The Climber's capsule is query-only.** It never pushes or blocks bodies in the solver. Walking into a box or pallet shoves it; walking into the forklift or a rack doesn't move it.
- **Forklift hits:** if the part of the forklift touching the Climber is moving faster than `climber.hitSpeed` (1.5 m/s), it's an incident: head-on, reversing, sideswipes, tail swing, or the forks scooping them up. Slower contact is a nudge, and walking into a parked or crawling truck is never an incident.
- **Racks are dynamic and wobbly.** Each rack is one light rigid body (60 kg per bay) with its shelves, labels and anything on them, and grippy feet so it rocks rather than skates. A raw forklift hit mostly pushes on the uprights' feet, so the game adds a "wobble": when the forklift, a falling ladder or a falling neighbouring rack newly hits a rack, the impact also rocks the top of that rack in the direction of travel. Back-to-back racks are tied together, so a hit rocks both racks of the pair. Forklift hits around 1.5 m/s just bump a rack; ~2 m/s and up knocks it over (full throttle down an aisle does it). A ladder toppling against a rack knocks it over too. Aisles (4.4 m) are narrower than the racks are tall (5.2 m), so falling racks take out their neighbours like dominoes. Knocked-over racks are incidents, blamed on Ralph or the ladder; a falling rack hitting Dave is one too. Shelf stock counts toward a rack's weight when it's hit. Tuning is under `racks` in `config.js`.
- **Rising platforms carry the Climber up directly.** A character controller can't push out of a surface it's already inside. Being lifted into a beam overhead counts as an incident ("crushed").
- **Reach** is 1.5 m from chest height along the aim ray, so boxes at your feet can be grabbed.
- **Height math.** The pallet deck rests on the forks, so at max lift the Climber's feet are at about 3.55 m, level with the top shelf (4.5 m) within reach. The ladder platform (2.95 m) reaches shelf 3 too.
- **Mantle.** In the air and pushing into a ledge within 0.35 m above your feet, you climb onto it. This is what makes the jump from the forks to the 4.5 m beam possible.
- **Tipping:** the tires' sideways grip acts at the floor, so hard cornering rolls the truck. With the centre of mass at 0.8 m (`forklift.centerOfMass`), a turn at half lock or more at full speed (~4 m/s) tips it; gentle turns at full speed and full-lock turns below ~3.8 m/s don't. Raised forks make it tippier (3.5 m/s at max height). A tipped truck is set back on its wheels after 4 s.
- **Dashboard:** a screen built into a sloped yellow binnacle on the dash, centred behind the steering wheel, shows a speedometer (mph, needle plus digital readout, red above 8 mph), D/R gear lights, and a fork-height bar with the reading in metres and ticks at the 1.5 m and 3.0 m shelf heights. These replaced the driver's on-screen gear and fork-height boxes.
- **Forks lower faster than they rise** (0.7 vs 0.4 m/s). Lowering the forks onto the Climber's head is an incident, and so is a box or pallet falling on it (the spec's optional head hit).
- **CCTV incident replays:** eight security cameras are mounted high on the walls. 1.5 s after every incident, the game freezes and replays the moment at half speed in black and white. It cuts between up to three cameras with a clear view of the Climber, and any button skips. The replay is built from a rolling 5 s recording of everything that moves (`src/systems/replay.js`, tuning under `replay` in `config.js`).
- **Ralph's incidents:** tipping the forklift is an incident ("Ralph tipped the forklift"), with a replay that follows the truck. A rack falling over is an incident too, blamed on Ralph if the forklift touched it in the last few seconds. Racks falling within 6 s of each other count as one domino incident with a growing banner ("Ralph took out Racks D and E").
- **Incident reports:** after each CCTV replay, a filled-in Form 300 appears: case number, employee and job title, shift time, location (rack and bay, aisle, or zone), what happened, ticked root causes (Dave, Ralph, Gravity, the racking, the ladder, the wrapper), corrective action, days away from work, the cameras that witnessed it, and Ralph's signature. Any button files it and play resumes. The Order Complete screen now counts incidents rather than falls.
- **Rolling ladders:** two platform ladders sit in the aisles (A/B and C/D). Dave walks up the steps like stairs; the top platform is level with shelf 2 (3.0 m), so he can step onto that shelf or reach shelf-2 and shelf-3 stock without Ralph. Ladders are loose physics objects. Aim at one and press E/X to grab it: it then keeps its offset and angle relative to Dave, so walking pushes or pulls it and turning swings it round (at about half walking speed). E/X again lets go, and it lets go by itself if it snags on something. Dave can also just shove one by its frame, and the forklift or a falling rack can knock it over. Falling off or riding it down gets its own incident lines. Tuning is under `ladder` in `config.js`.
- **Wrap countdown:** a pallet in the WRAP square gets a ring on the floor around it. The outline is red while the pallet is off the floor (still on the forks), tipped, or while any part of the forklift is in the square, with a hint saying which, white while it's moving, and it fills yellow over the second it must sit still before wrapping starts. The first pallet into the square also shows a one-time hint.
- **Placement ghost:** while carrying a box, a translucent copy shows exactly where it will land if you put it down now (same calculation as the put-down itself), including on a raised pallet. Climber's camera only.
- **See-through cab:** the overhead guard is a grid of bars, and the carriage is an open frame, so the driver can see up through the roof and the load through the backrest.
- **Throw threshold:** the support must be moving at 1.5 m/s or more and accelerate by more than 10 m/s² (smoothed). A full brake (about 5.3 m/s²) does not throw you; clipping a rack at speed does.

## Playtest console

`window.osha` is exposed in the dev build:

```js
osha.CONFIG.forklift.topSpeed = 5   // live-tune (most values are read every step)
osha.scenario(3.5, -6, -12.2, Math.PI / 2)  // forklift in aisle A/B, forks up, pallet + climber on them
osha.sim(2, {}, { throttle: 1 })     // step physics headlessly with scripted actions
osha.override = { driver: { liftUp: 1 } }  // inject actions into live play
```
