# Ralph and Dave's OSHA Nightmare: first playable

Greybox prototype: first-person stacking, jumping and forklift-riding. Three.js + Rapier + Vite.

The crew: **Dave** climbs, **Ralph** drives the forklift. Incident banners and CCTV replays name who did what to whom.

**Play:** https://eric-birdsall.github.io/osha-nightmare/ (every push to `main` redeploys via GitHub Actions).

```bash
npm install
npm run dev
```

Open the printed URL in Chrome. Click the canvas to capture the mouse.

## The order

**The warehouse never changes.** Every shelf in every bay is stocked with boxes (about 450), each with a 3-digit SKU on a small barcode label on all four sides, and every game the same SKUs sit in the same spots, like a real warehouse's slotting map. Every SKU has its own look: a box colour and a made-up brand logo ("Zappop", "Omnio", "Pixelex"...), the same on every box of that SKU, and about 15% of products are stamped **FRAGILE**. The stock is baked into `src/world/warehouse-v1.json` (Warehouse v1) by `tools/bake-warehouse.js`, which is seeded, so re-running it gives the same file; change its order specs or seed only on purpose, as a new warehouse version.

**Five fixed orders** live in `src/world/orders.json`, the same every time you play them, rising in difficulty:

| Order | Lines | Dock |
|---|---|---|
| 1 · Tutorial | 1 box from shelf 1 at the east end of Rack A | Dock 2 |
| 2 · Reach for it | 3 boxes from shelf 2 | Dock 2 |
| 3 · Top shelf | Cartons from high backstock plus 1 strapped crate | Dock 1 |
| 4 · Handle with care | 3 from shelf 2 (one short: backstock), 2 FRAGILE cartons, plus 1 low-bay crate | Dock 2 |
| 5 · The whole nightmare | Three carton lines (including backstock/FRAGILE) plus 1 high-bay crate | Dock 1 |

Each line is a SKU and a quantity; the clipboard shows where it lives (worked out from the warehouse file) and its brand, colour and FRAGILE tag. You can tune an order's quantities in `orders.json`, up to what's stocked for it.

**Playing a level.** The title screen asks for the mode (Single Player or Couch Co-op), then a level: Order 1-5, or **Full Shift**. Each level in the list shows your best time in that mode and its medal. A run's score is its time plus 15 s per incident (`score.incidentPenalty`). The Order Complete screen shows the time, incidents and penalty, the total, your best (NEW BEST! when you beat it) and your medal with the next one to aim for; then Retry, Next Order or Level Select. Best times are kept in this browser per level and per mode. Each level is versioned by the warehouse and its order's lines and dock, so changing either resets that level's times; retuning medal targets doesn't. The medal targets in `orders.json` (`medals: { gold, silver, bronze }`, in seconds) are placeholders until they're set from playtests.

**Full Shift** is all five orders back to back, in order, in one warehouse on one clock. The mess carries over: knocked racks, dropped boxes and both workers stay where they are. When a load is delivered, the truck pulls away with it, an ORDER n banner comes up, the next pick list appears on the clipboard, and that order's dock door rolls up (the other one rolls down: both docks have a trailer behind a roll-up door in a Full Shift). It ends on SHIFT COMPLETE with the total time and penalties, its own best time per mode, and medal targets that are the five orders' added together.

The pick list is a clipboard hanging in the forklift cab (on the front-left guard post; Ralph's crutches lean beside his seat, and he has a cast on his left leg, which is why he never gets off the truck), not on the HUD: Ralph reads it from the seat, and Dave has to walk over and look in, or ask Ralph (in single player, swap to Ralph to check it).

**Backstock.** Orange BACKSTOCK signs point to a loaded pallet on shelves 3–5 of the West-wall racks H/I. Ralph retrieves the pallet and lowers it into a marked PALLET STAGING bay; Dave picks the required cartons onto the order pallet; Ralph can rewrap and return the remaining stock overhead; cleanup is optional. Each storage pallet holds six cartons of one SKU. Not every backstock sign is for an order—check the SKU against the clipboard. The clipboard keeps a tally of confirmed delivered units across the loads in the active trailer.

The order cartons look like other boxes, including near-miss decoys, so check their SKUs. Build and wrap carton pallets in the WRAP square, then lower them onto the active trailer floor. Strapped crates are one unit each and ship directly without wrapping. Delivered quantities add up across separate loads; the order finishes only when every line is met. The entire load must be inside the active trailer, upright, still and touching its floor. Bare cartons and wrong SKUs do not count. Taking a load back out revokes its progress before completion. Full Shift removes all delivered loads when the truck leaves, then starts the next order with fresh delivery counts.

The warehouse is 38.4 × 46.4 m with a 12 m roof. `src/world/layout.js` defines its racks, equipment, docks and start spots; the title and pause blueprints are drawn from that same layout. The blueprint uses a landscape presentation with north up; its compass directions are mapped onto the existing world axes.

Seven central racks A–G have six bays and three shelves (1.5, 3.0 and 4.5 m). Along the player-facing **West wall**, normal blue-and-orange racks H and I each have four bays and **five shelves: 1.2, 3.0, 4.8, 6.6 and 8.4 m**. Lower shelves are mostly loose-carton pick faces, with two strapped-crate bays. Of the 24 upper bays, sixteen hold shrinkwrapped carton backstock and eight hold strapped single-unit shipping crates. Crates are mixed throughout H and I, with fixed SKU homes in `src/world/freight-stock.js`; each bay holds one load type. Rack-stored crates are 1.15 m high so Ralph has lifting clearance, including above the lower first deck. The sections have a 2.6 m ladder gap, an open forklift aisle, deck alignment outlines and two floor staging bays. Yellow outlines turn green when an upright pallet rests fully inside a shelf bay. Ralph sees a contextual seating hint when approaching at the right height. The forklift lifts to 8.8 m, with fork pockets oriented into the aisle. Orders 3–5 combine carton picking with a separately delivered crate. Location codes remain Rack-Bay-Shelf.

The mezzanine, its stairway and landing railing have been removed. The break room is a compact ground-floor area farther along the West wall, beside the corner fire-exit cage: toilet doors, vending machines, water fountain, table, chairs and counter remain. Rack J has been replaced by H/I's conventional five-shelf storage.

The basement is 1 m below the main floor, with stairs for Dave and a ramp for the forklift. Both docks are on the player-facing East wall (Dock 1 north of Dock 2); Ralph starts in the southwest of the lower level facing east. Dave starts beside the main-floor ladder at Rack A’s endcap, within pickup reach. The wrapper remains beside the basement edge, with packing benches and two powered conveyor lines across the open floor. Their blueprint arrows show actual belt direction. The West-wall corner fire exit remains caged; the North-wall exit and cage have been removed, and connected pipework surrounds the dripping electrical panel.

The changed warehouse is version 4, so saved best times start fresh for this layout. Order medal times remain provisional pending playtests.

## Controls

| | Gamepad | Keyboard / mouse |
|---|---|---|
| **Climber** move / look | Left / right stick | WASD / mouse or IJKL |
| Carrying: tap to put the box down; hold to aim a punt (top box of a stack), let go to kick it | X | E |
| Stand a fallen ladder back up (hands empty, near it) | Hold RB 1 s | Hold R 1 s |
| Flip a tipped-over pallet or wrapped load upright (hands empty, near it) | Hold X 1 s | Hold E 1 s |
| Jump | A | Space |
| Pick up a box, pick up / set up / fold a ladder, hold on to the forks | X | E |
| Reset knocked-over racking (near it) | Hold RB 3 s | Hold R 3 s |
| **Driver** steer / look up-down | Left stick left-right / right stick up-down | A, D / mouse up-down or I, K |
| Accelerate / brake (then reverse) | A / B | W / S |
| Forks up / down | RB / LB | R / F |
| Drift (hold while turning) | RT | Space |
| Back to the start (Dave to his first spot, the forklift upright to its bay) | Hold Y 1 s | Hold Q 1 s |
| Swap character (single player) | View | Tab |
| Pause | Menu | Esc |

New players: **How to Play** on the title and pause menus is a one-page guide (the job, who's who, the order step by step, reaching shelves, moving boxes, incidents, hazards, resets and tips). On a pad or keys, up and down scroll it.

Co-op uses split screen, with the Climber on top. Gamepad 1 plays the Climber and gamepad 2 the Driver. If only one pad is connected, player 2 uses keyboard and mouse. Pause → Swap Roles trades characters. **Invert Look** (on the Controls screen, from the title or pause menu) flips up/down for the mouse, sticks and I/K; it's remembered in this browser. The pause menu also shows a floor plan of the warehouse with Dave and Ralph marked on it.

## Layout

- `src/config.js`: every tuning value (speeds, masses, lift rate, friction, ragdoll thresholds)
- `src/main.js`: renderer, fixed 1/60 s loop, menus, pointer lock
- `src/ui/osha-ui.css` (+ `assets/heavy-distress-mask.svg`): the OSHA Nightmare UI kit, distressed 3D block lettering (`osha-text`, `--yellow` / `--ivory` / `--red`) and a metal sign plate (`osha-plate`), used for the PAUSED, Order Complete and Controls headings and the in-game INCIDENT banner. Its font, Black Ops One, loads with the other Google Fonts in `index.html`. `src/logo-menu.png` is the title screen's logo, a smaller copy of `src/logo.png`
- `src/world/layout.js`: **the warehouse layout as data** (west-side things are placed from the west wall, dock-side things from the east wall, and the wrapper and packing stations from the racks' east end, so changing `room.halfX` narrows or widens the dock side): room size, lower level, ramp and stairs, racking (bays, bay width, shelf heights) and every rack row, docks, the WRAP square, the packing stations, the parking bay, the hazards, LADDERS stands, loose boxes, pallets, spawn points, ceiling fans and ducts, and the CCTV cameras. Everything below builds from it, so a new layout is mostly a matter of editing these numbers. Racks are `rack(name, z0, face, base)` or `pair(north, south, z0, base)` (back to back); each can have its own `x0` and `bays`.
- `src/world/level.js`: builds the warehouse, racks, stock, zones, initial boxes and pallets from the layout
- `src/world/parking.js`, `wrapper.js`, `packing.js`, `conveyor.js`, `breakroom.js`, `pallet-storage.js`, `props.js`, `puddles.js`, `floorplan.js`: the forklift parking bay, the stretch wrapper, the packing stations, the conveyor, the ground-floor break room and pallet storage, loose physics props, the decorative puddles, and the pause screen's floor plan (drawn from the layout at startup)
- `src/entities/`: `climber.js` (character controller, carry, ragdoll triggers), `forklift.js`, `box.js`, `pallet.js`
- `src/systems/`: `input.js`, `ragdoll.js`, `wrapping.js`, `game.js` (order state, swap, win), `hud.js`, `audio.js`

## Implementation notes (where it differs from or adds to the spec)

- **Forks** are a separate dynamic carriage body on a motorized prismatic joint up the mast. The solver therefore knows the fork velocity: loads lift smoothly, their weight presses on the truck, and racks block the forks.
- **The Climber's capsule is query-only.** It never pushes or blocks bodies in the solver. Walking into a box or pallet shoves it; walking into the forklift or a rack doesn't move it.
- **Forklift hits:** if the part of the forklift touching the Climber is moving faster than `climber.hitSpeed` (1.5 m/s), it's an incident: head-on, reversing, sideswipes, tail swing, or the forks scooping them up. Slower contact is a nudge, and walking into a parked or crawling truck is never an incident.
- **Racks are dynamic and wobbly.** Each rack is one light rigid body (60 kg per bay) with its shelves, labels and anything on them, and grippy feet so it rocks rather than skates. A raw forklift hit mostly pushes on the uprights' feet, so the game adds a "wobble": when the forklift, a falling ladder or a falling neighbouring rack newly hits a standing rack, the impact also rocks the top of that rack in the direction of travel, once per hit and capped so nothing gets launched. Back-to-back racks are tied together, so a hit rocks both racks of the pair. Forklift hits at 1.5 m/s just bump a rack; ~1.8 m/s usually knocks it over and 2 m/s+ always does. A ladder toppling against a rack knocks it over too. Aisles are narrower than the racks are tall (5.2 m), so falling racks take out their neighbours like dominoes, and Rack A can topple backwards over the railing into the basement. Knocked-over racks are incidents, blamed on Ralph or the ladder; a falling rack hitting Dave is one too. Shelf stock counts toward a rack's weight when it's hit. **Resetting the racking:** near a rack that's been knocked over, shoved off its spot, or has lost stock off its shelves, hold R / RB for 3 s. Every disturbed rack stands back up where it belongs and the stock that fell goes back on its shelves, so an order box can't end up out of reach for good. Boxes Dave has picked up and moved stay where he put them, and anything on a pallet or wrapped load stays put. A yellow ring fills round the crosshair while you hold. If the forklift is parked (or lying) where a rack goes, it's sent back to its starting bay; Dave, loose pallets, ladders and stray boxes in the way are moved out into the aisle. Tuning is under `racks` in `config.js`.
- **Rising platforms carry the Climber up directly.** A character controller can't push out of a surface it's already inside. Being lifted into a beam overhead counts as an incident ("crushed").
- **Reach** is 1.5 m from chest height along the aim ray, so boxes at your feet can be grabbed.
- **Height math.** The pallet deck rests on the forks, so at max lift the Climber's feet are at about 3.55 m, level with the top shelf (4.5 m) within reach. From the top step of an A-frame ladder (1.55 m) Dave reaches shelf 2 but not shelf 3.
- **Mantle.** In the air and pushing into a ledge within 0.35 m above your feet, you climb onto it. This is what makes the jump from the forks to the 4.5 m beam possible.
- **Speed and drifting.** The forklift tops out at 6 m/s (13 mph on the dash). A normal grip turn can only corner so hard (`drift.gripLatAccel`), so at speed it runs wide, and full lock at top speed leans it right to the edge of tipping. **Hold Space / RT while turning** and the truck does a little hop (`drift.hop`, like Mario Kart) as the rear tyres let go: the tail swings round at a steady rate whatever the speed, and the truck slides at an angle (about 15-25°) while keeping most of its speed, leaving skid marks and tyre smoke. A drift can't tip the truck (the sideways force goes through the centre of mass while sliding, and grip comes back gradually). Hold a good drift for 0.8 s and orange sparks turn blue: let go for a **boost** up to about 8 m/s for 0.8 s, after which it settles back to top speed. Ralph can't see the sparks from the seat, so a drift meter above his dashboard fills orange while drifting, turns blue with BOOST READY once the boost is earned, and shows BOOST! when it fires; the cab view widens by `drift.boostFov` degrees during the boost and eases back over about a second. Pallets on the forks ride on friction, so a hard drift can fling them. Tuning is under `forklift.drift` in `config.js`.
- **Tipping:** the tires' sideways grip acts at the floor, so hard cornering rolls the truck. Roll damping (`forklift.rollDamping`) soaks up the lurch of a quick flick of the wheel, and grip turns are capped (above), so a normal turn rarely tips it; boosting into a grip turn can. Raised forks make it tippier. Tipping does not cause an explosion. Ralph can reset it upright to parking by holding Q / Y for one second. Dave cannot reset or right the forklift.
- **Ramp driving:** the forklift's drive holds it against the slope (like a hydrostatic drive), so on the ramp it drives, brakes and coasts as on the flat: it doesn't run away downhill, and it can stop and reverse back up.
- **Dashboard:** a screen built into a sloped yellow binnacle on the dash, centred behind the steering wheel, shows a speedometer (mph, needle plus digital readout, red above 8 mph), D/R gear lights, and a fork-height bar with the reading in metres and ticks at the 1.5 m and 3.0 m shelf heights. These replaced the driver's on-screen gear and fork-height boxes.
- **Stacks and punting:** picking up a box also lifts whatever is stacked on it, up to 3 boxes (`climber.maxCarry`); aim at the bottom box to take the stack. A taller stack is too much, so Dave takes the top box. He walks a little slower with 2 or 3 (`climber.stackSpeed`), and putting down sets the whole stack down as a neat column where the ghost shows. **Punting:** with a box in hand, a tap of E / X puts it down and holding it punts the top box (`climber.puntHoldDelay`, 0.25 s, tells them apart): hold to aim, and a dotted arc and a ghost box (red for FRAGILE) show exactly where it will land; let go and Dave drops the box onto his foot and boots it. The kick goes about 23° above where he's looking (`climber.puntAngle`), so a level look lobs it well up and out (about 11 m), aiming a little higher sends it furthest (about 14 m) and looking down keeps it short. It always leaves his boot at the same speed, 11.5 m/s (`climber.puntSpeed`). A punted box flies without spinning and lands dead: landing on top of something, it stops right there; hitting a wall or a panel side-on, it drops straight down onto whatever's below. That's what the ghost shows, so it's always where the box ends up (until something else moves it, like a conveyor). Handy for punting boxes onto a pallet, the packing line, or up onto raised forks. Punting is never an incident.
- **Flipping pallets and loads:** a pallet or a wrapped load that's ended up on its side, on its end or upside down can be put right: with empty hands, within about 1.8 m of it, hold E / X for a second (the ring round the crosshair fills) and it's set back the right way up where it lies (a wrapped load keeps all its boxes), pointing the way it was. A quick tap of E / X still picks up a box as usual. If something's in the way of it lying flat, it says so. Tuning is `climber.palletFlipRange` and `palletFlipHoldTime`.
- **Railings and jumping:** the yellow railings are 1.1 m tall, solid for the forklift and for anyone walking into them, but Dave can jump and scramble over one (into the basement, say, or off a high rack, which is a long way down). He can't grab anything mid-jump: picking up needs his feet on something, so jumping at shelf 2 doesn't reach a box.
- **Nothing is slippery.** There are no spills, and the puddles under the leaking panel are just for looks: the floor grips the same everywhere.
- **More OSHA violations** (`src/world/hazards.js`, placed under `hazards` in `layout.js`):
  - **The electrical waterfall:** on the east wall just past the conveyor's south end, a leaking pipe joint (duct-taped) drips onto a HIGH VOLTAGE · KEEP DRY panel. Water streaks down its front into a puddle on the floor, beside a bucket catching none of it. Now and then a drip shorts it out: sparks, a blue flash and a zap.
  - **The missing railing:** a 2.5 m section of the basement's railing (on its east edge, right by the ramp) is gone, replaced by sagging hazard tape and a tiny WATCH YOUR STEP sign. The tape stops nothing: Dave walks straight through and drops into the basement, and the forklift can drive off the edge.
  - **Blocked fire exit:** the remaining West-wall corner EXIT door has its FIRE EXIT · KEEP CLEAR sign above stored pallets, cartons and plywood inside a steel cage. The North-wall exit and cage have been removed.
  - The caged fire exits are on the floor plan.
- **FRAGILE boxes explode.** Punt a FRAGILE box, let go of one with nowhere to set it (the orange ghost), or get knocked flat while carrying one, and it goes off on the first thing it hits, like a grenade: a huge fireball fills the warehouse and everything loose within 30 m (most of the building: boxes, pallets, ladders, whole racks, and Dave) is flung outward and up, and the forklift gets shoved. The roof keeps the debris indoors. It's an incident on Dave ("It said FRAGILE, Dave"), and racks it knocks over are incidents of their own. The box itself is restocked on its shelf, so an order box is never lost. Setting a FRAGILE box down carefully (green ghost) is safe. Tuning is under `blast` in `config.js`.
- **Holding on to the forks:** anywhere on or right by the forks (on the blades, out at their tips, on a pallet or boxes sitting on them, or on the floor in front of lowered forks), E/X grabs the carriage, and he slides over to stand in the middle of the blades (on a load, if there's one on them), so when he lets go he's always standing on the forks. It works in mid-air too, with a bigger reach: jump or fall off a shelf at the forks, press E/X as you come past them, and Dave catches on and eases down onto whatever's under him on the forks, safe however far he fell. Dave then rides it rigidly and can't be thrown off however fast Ralph drives, drifts, swerves or crashes; in exchange he can't walk or look round. He stands with his back to the truck and his arms behind him gripping the backrest (from the cab you see his back), facing out along the forks with his eyes level, until he lets go (E/X again). He can still get hurt by something landing on him (a falling box, a toppling rack) or by the forks slamming into the floor.
- **Back to the start:** holding Q / Y for a full second sends the character you're playing straight back to where they started the round. Dave drops whatever he's carrying and gets out of a ragdoll, a wrap or a ladder; the forklift goes back to its parking bay, upright and at rest with its forks down. A ring fills while you hold it (a quick tap does nothing), and you have to let go before it'll do it again.
- **Forks can drop fast.** They rise at 0.4 m/s, but holding F/LB speeds the descent up to 3 m/s (2 m/s²); let go and they stop hard, but held all the way down they hit the ground at whatever speed they've reached. **If they hit the ground at near full speed (over 2.7 m/s, `climber.legBreakSpeed`) with Dave riding them** (on the blades, holding on, on a load on the forks, or on a ladder Ralph is carrying) **his legs break** at the moment of impact: Ralph's incident ("Ralph broke Dave's legs"). Only a drop of about 1.8 m or more held all the way down gets that fast; let go before the bottom, or tap, and Dave is fine. Loads ride the slam out.
- **CCTV incident replays:** eight security cameras are mounted high on the walls. With **CCTV Replays** on (the default; switch it on the Controls screen, remembered in this browser), 1.5 s after an incident the game freezes and replays the moment at half speed in black and white. The shift clock is stopped while it plays, so watching costs nothing. It cuts between up to three cameras with a clear view of the Climber, and any button skips. The replay is built from a rolling 5 s recording of everything that moves (`src/systems/replay.js`, tuning under `replay` in `config.js`).
- **Ralph's incidents:** tipping the forklift is an incident ("Ralph tipped the forklift"), with a replay that follows the truck. A rack falling over is an incident too, blamed on Ralph if the forklift touched it in the last few seconds. Racks falling within 6 s of each other count as one domino incident with a growing banner ("Ralph took out Racks D and E").
- **Incident penalty:** every incident adds 15 s to the run (`score.incidentPenalty`). The HUD timer always shows the score, the shift so far plus penalties, and flashes red with "+15 s" when one lands; the INCIDENT banner says so too. A domino run of racks is one incident. The shift clock starts on the first move (Dave walking or jumping, or Ralph driving or working the forks), so you can read the clipboard first for free.
- **A-frame ladders:** two folded step ladders hang on two yellow single-ladder stands: one on the main floor beside the basement’s east edge and the missing railing, and one holding a single ladder in the ground-floor gap between racks H and I. The main-floor ladder is available without fetching one from the basement. Tap E/X at a stand (or at a ladder lying on the floor) to shoulder one: Dave's hands are full, though he walks at full speed. A ghost A-frame shows where it will go, steps facing Dave: green on flat, clear floor at his level, red on the stairs, the ramp, a shelf, a pallet, against a railing or a rack. Tap E/X on green to set it up. Walk into the steps to climb on; W/S (or the stick) climbs up and down, and forward climbs the way you're looking (look down at the floor and W takes you down), and stepping down off the bottom gets off. From the top step (1.55 m) Dave reaches shelf 2 but not shelf 3, and he can pick and place boxes, and climb with one in his hands. **Dave can jump off a ladder**, a normal jump the way he's looking (onto a pallet, the forks, another level), and a jump off the top step down to the floor doesn't hurt him; but pushing off always kicks the ladder over, so there's no landing back on it. The forklift can knock a set-up ladder over, or shove it faster than 1.5 m/s, and with Dave on it that's Ralph's incident. Ralph can also slide the forks in from behind (between the legs, under the spreader tray) and lift the ladder, Dave and all, which puts shelf 3 in reach. Tap E/X next to a set-up ladder to fold it back onto your shoulder. **A ladder that's been knocked over** (or dropped folded on the floor) can be stood straight back up where it lies: with empty hands, within about 1.8 m of it, hold R / RB for a second (the ring round the crosshair fills), and it springs up as an A-frame with its steps facing Dave, if there's flat, clear floor there. Ladders stay wherever they're left. Tuning is under `ladder` in `config.js`.
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


The leaking panel has connected overhead supply and return pipes, tall risers, collars, wall brackets, and a valved branch loop around the original dripping joint.

The main-floor ladder stand holds one ladder against Rack A’s east endcap, facing east, without a LADDER label. The missing railing spans from the south end of the wrapper frame to the basement’s south edge beside Rack A, leaving about 3.4 m clear for the forklift. Dave starts beside the relocated ladder, facing south and within pickup reach.

Dave can drag a nearby upright, empty pallet by holding E / X and walking. He moves at half speed while pulling; release to let go. Loaded pallets, wrapped loads, tipped pallets, and pallets he is standing on cannot be dragged.

### Guided Order 1

Selecting Order 1 enables six automatic tutorial steps: read the forklift clipboard, pick the matching SKU, load a pallet, carry it to WRAP, set it down and back out to wrap, and deliver the wrapped load to the assigned dock. A yellow pointer marks the current destination after the clipboard step. Look at the clipboard briefly to advance; picking or loading the correct stock also advances if you work ahead. If stock falls off a load, the guide returns to picking/loading. Prompts follow keyboard or controller input, and co-op gets instructions for both characters. Other orders and Full Shift have no tutorial overlay. Normal scoring and controls still apply.

Run `npm test` for tutorial progression, recovery, clipboard reading, and input-specific instruction checks.

### Crouching on shelves

Hold Ctrl (keyboard) or hold the left stick click / L3 (controller) to crouch. His collider drops to 1 m tall and he moves more slowly, so he can jump into clear shelf openings and stand on the shelf while crouched. Pushing into loose boxes shoves them, including while entering a shelf. Release to stand; if a shelf or box is overhead, Dave stays crouched until clear.

Crouch jumping: jump, then hold Ctrl / L3 in midair to tuck Dave’s legs up by 0.8 m while his head stays at the same height. This adds foot clearance without extra upward velocity, allowing a jump from a ladder or Shelf 1 height onto Shelf 2. Uncrouching in midair extends his legs back down, so repeated crouch/release cycles do not generate extra height.

Blueprints on the title, order-selection and pause screens use a landscape orientation, rotated 90° clockwise with player-facing compass labels showing north at the top. This is a display transform; warehouse geometry, controls, spawns and order locations are unchanged. Rack letters remain upright, and live pause-map markers use the same transform as the building.

The in-game wall badges match the landscape blueprint: N at the top, E at the right, S at the bottom and W at the left. Internal layout wall keys still follow the original coordinates; only player-facing direction labels are remapped.

Blueprints use a compass rose in the bottom-right instead of wall-edge direction labels. Repeated yellow arrows indicate travel on both conveyors. Forklift parking and its charger sit in the southwest corner of the lower level (landscape compass); Ralph starts facing east.

## Receiving / Putaway

Choose Single Player or Couch Co-op, then **Receiving**. Five fixed purchase orders have separate best times and medals in each mode:

| PO | Challenge | Delivery |
|---|---|---|
| PO-001 | Guided tutorial | Two wrapped single-SKU pallets; first-shelf cartons |
| PO-002 | A little higher | Two wrapped pallets; shelf-2 carton putaway |
| PO-003 | Sort it out | Two mixed-SKU wrapped pallets; three destinations |
| PO-004 | High storage | Wrapped backstock and a strapped crate for upper H bays |
| PO-005 | The whole delivery | Mixed cartons, high backstock and a low-bay crate |

Only PO-001 has PUTAWAY signs, a destination arrow and step-by-step instructions. Every PO lists exact rack locations and live counts on the cab clipboard; carton-pallet lines are marked WRAPPED PALLET and crate lines FORKLIFT ONLY · 1 UNIT. Low destinations and high pallet slots start empty for the selected PO. Regular warehouse stock cannot substitute for incoming cartons.

Ralph unloads wrapped loads and brings them to the aisles. Dave holds E / X for one uninterrupted second, with empty hands and within reach, to cut shrinkwrap. This works while a pallet is on the forklift blades. Releasing, leaving reach or swapping away cancels the hold. Cutting restores individually movable cartons and the empty pallet at their current positions, retaining SKU, quantity and receiving identity. High-storage stock starts shrinkwrapped in picking too.

For low shelves, incoming cartons must rest in the correct bay and height, be supported by the rack or its stock and stay still for 0.75 seconds. Carton-pallet lines require the complete incoming quantity to remain shrinkwrapped, upright, stable and seated in the assigned bay. Heavy-item lines require the actual incoming strapped crate in its assigned bay, on either a low or high shelf. Opened high-stock pallets must be rewrapped before they count. The stretch wrapper works in both modes and accepts partial stock loads, without requiring a shipping order. Wrong locations remain incomplete with no extra penalty; moving valid stock revokes progress until the PO finishes.

Receiving finishes once every line is correctly put away. Returning empty pallets, parking and returning leftover picking stock are optional. The green empty-pallet area remains against the lower level’s West wall. Normal incident penalties apply. Medal targets are provisional; the wrapping rules have a new records version so old times are not compared against the changed job.

`npm test` covers all five wrapped manifests in single player and co-op, tutorial-only aids, correct and incorrect putaway, optional cleanup, holding to cut on the forks, rewrapping partial loads and retaining carton identities.

Forklift resets check clearance for the collapsed truck and forks before moving it. If the normal parking spot contains pallets, boxes, debris, or Dave, the truck uses a clear nearby position and explains why. If no nearby position is safe, the reset asks for the area to be cleared instead of embedding the truck in an obstacle.

Both basement loading docks are on the player-facing east wall, with Dock 1 north of Dock 2. Full Shift builds separate usable doorways and trailers for both docks on that wall.

A compact bottom-right controls reference shows only the current character’s controls, using keyboard keys or controller buttons as appropriate. Each co-op viewport shows its own character’s reference.

At the start of each picking or receiving round, Dave stands beside the main-floor ladder at Rack A’s endcap, facing south. He can pick up the ladder with E / X without moving. This applies to single player and couch co-op.

One forklift-only test crate (SKU 980, one unit, 350 kg including its pallet) sits in the open main-floor aisle at world x=5.8, z=0, between the central racks and packing stations. It is a wooden shipping crate permanently strapped to a standard pallet: approach its labelled front or back with forks low, insert into the normal pockets, then lift and transport the entire load. Dave can read its handling label but cannot carry, punt, drag or cut it open. It is not part of any order yet.

Ralph has a carriage-mounted fork camera: above 2.5 m it appears automatically as an inset. Press **C** / **R3** to expand it or return to the seat. The fork-height readout stays visible while looking up, including in split-screen.
