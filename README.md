# OSHA Nightmare: first playable

Greybox prototype: first-person stacking, jumping and forklift-riding. Three.js + Rapier + Vite.

**Play:** https://eric-birdsall.github.io/osha-nightmare/ (every push to `main` redeploys via GitHub Actions).

```bash
npm install
npm run dev
```

Open the printed URL in Chrome. Click the canvas to capture the mouse.

## The order

Get **Item A** (pink, location `A-3-2`) and **Item B** (cyan, `B-2-3`, the middle of Row B's 3 m deep top deck) onto one pallet. Leave that pallet still in the yellow **WRAP** square until it's wrapped, then bring the wrapped pallet to **DOCK 1** and stop there.

Locations read Row-Bay-Shelf. Bays are numbered 1–4 from the west end of each row, and shelves 1–3 from the bottom (1.5 m, 3.0 m, 4.5 m). Every rack face shows row signs at both ends, a bay header above each bay, and a location tag under each shelf beam.

From the forks at max height, Item B is out of reach. To get onto Row B's top deck, either stack a box on the raised pallet, or jump from the pallet and mantle onto the beam.

## Controls

| | Gamepad | Keyboard / mouse |
|---|---|---|
| **Climber** move / look | Left / right stick | WASD / mouse or IJKL |
| Jump | A | Space |
| Pick up / put down | X | E |
| **Driver** steer / look | Left / right stick | A, D / mouse or IJKL |
| Accelerate / brake (then reverse) | RT / LT | W / S |
| Forks up / down | RB / LB | R / F |
| Swap character (single player) | View | Tab |
| Pause | Menu | Esc |

Co-op uses split screen, with the Climber on top. Gamepad 1 plays the Climber and gamepad 2 the Driver. If only one pad is connected, player 2 uses keyboard and mouse. Pause → Swap Roles trades characters.

## Layout

- `src/config.js`: every tuning value (speeds, masses, lift rate, friction, ragdoll thresholds)
- `src/main.js`: renderer, fixed 1/60 s loop, menus, pointer lock
- `src/world/level.js`: warehouse, racks, zones, initial boxes and pallets
- `src/entities/`: `climber.js` (character controller, carry, ragdoll triggers), `forklift.js`, `box.js`, `pallet.js`
- `src/systems/`: `input.js`, `ragdoll.js`, `wrapping.js`, `game.js` (order state, swap, win), `hud.js`, `audio.js`

## Implementation notes (where it differs from or adds to the spec)

- **Forks** are a separate dynamic carriage body on a motorized prismatic joint up the mast. The solver therefore knows the fork velocity: loads lift smoothly, their weight presses on the truck, and racks block the forks.
- **The Climber's capsule is query-only.** It never pushes or blocks bodies in the solver. The character controller still shoves boxes it walks into. Forklift contact is detected separately: above 1.5 m/s it's a ragdoll, below that a nudge.
- **Rising platforms carry the Climber up directly.** A character controller can't push out of a surface it's already inside. Being lifted into a beam overhead counts as an incident ("crushed").
- **Reach** is 1.5 m from chest height along the aim ray, so boxes at your feet can be grabbed.
- **Height math.** The pallet deck rests on the forks, so at max lift the Climber's feet are at about 3.55 m. Row B is 3 m deep, which puts Item B 1.6 m from any spot the forks can reach.
- **Mantle.** In the air and pushing into a ledge within 0.35 m above your feet, you climb onto it. This is what makes the jump from the forks to the 4.5 m beam possible.
- **Tipped forklift** is set back on its wheels after 4 s.
- **Forks lower faster than they rise** (0.7 vs 0.4 m/s). Lowering the forks onto the Climber's head is an incident, and so is a box or pallet falling on it (the spec's optional head hit).
- **See-through cab:** the overhead guard is a grid of bars, and the carriage is an open frame, so the driver can see up through the roof and the load through the backrest.
- **Throw threshold** is 6 m/s² of smoothed horizontal support acceleration. A full brake (about 5.3 m/s²) does not throw you; clipping a rack does.
- Not built: the optional falling-box head hit.

## Playtest console

`window.osha` is exposed in the dev build:

```js
osha.CONFIG.forklift.topSpeed = 5   // live-tune (most values are read every step)
osha.scenario(3.5, -7.95, 1.6, Math.PI)  // forklift at Row B, forks up, pallet + climber on them
osha.sim(2, {}, { throttle: 1 })     // step physics headlessly with scripted actions
osha.override = { driver: { liftUp: 1 } }  // inject actions into live play
```
