# Future ideas

Parked for later: not built yet. Each idea has how it could work, pros and cons, and open
questions; how they interact and a suggested order are at the end.

## 1. Faster forklift that can drift

Ralph's forklift is faster and can drift, like Mario Kart drifting.

**How it could work:** raise the top speed (say 4 → 6 m/s). Holding a drift button while turning
(maybe a handbrake on Space / B) drops rear-wheel grip so the tail kicks out. Optionally, holding a
drift charges a small speed boost on exit.

**Pros**
- Makes driving Ralph fun in its own right, not just the commute between picks. That matters in
  single player, where you spend half your time as Ralph.
- Directly helps with "orders take too long" (less driving time per order).
- Very on brand: a forklift driver drifting through a warehouse is exactly what OSHA would hate.
- A lot of it is already there: rear-wheel steering (the tail already swings), adjustable lateral
  grip (spills already reduce it), roll damping.

**Cons**
- **Tipping.** Full-speed hard turns already tip the truck, and a tip now explodes with a 30 m
  blast. Faster plus drifting means a lot more tipping, unless drifting is the safe way to corner.
- **The layout fights it.** Aisles are 4.4 m and racks 16 m long; at 6 m/s you're through an aisle
  in under 3 s, and the truck is 3.3 m long. Drifting only pays off on the open east floor and the
  run to the docks. Might need wider aisles or a longer straightaway.
- **Rack collisions.** About 2 m/s already topples a rack pair. At 6 m/s every scrape is a domino
  run: constant chaos rather than funny chaos.
- **Loads.** Pallets ride on the forks by friction. Drift with a stack on and it flies off. Funny
  once, frustrating every time.

**Open questions:** Is a drift safer than a normal fast turn (so it's a skill), or more dangerous?
Widen the aisles, or add one long "highway" lane (e.g. along the south wall to the docks)?

## 2. Knocked-over racks stay down

If you knock over a rack you can't reset it: you have to find the boxes you need on the ground.

**How it could work:** no 3-second reset. Fallen racks and their scattered stock stay where they
landed for the rest of the order; you dig through the pile for your SKUs, helped by the box
colours and labels, and maybe a hint on the clipboard or floor plan.

**Pros**
- Consequences matter. Right now knocking racks over costs about 3 seconds; without the reset,
  Ralph has a real reason to drive carefully, which is the core tension of the game.
- The scramble is a fun mini-game: 50 boxes on the floor, find the purple Zappop with 427 on it.
- The per-SKU box looks pay off: you can spot your product in a pile from a distance.
- Simpler code overall (no reset hold, forklift teleport home, or stock restore).

**Cons**
- **It can soft-lock an order.** The box you need can land under a fallen rack, wedged between
  racks, on the lower level, or get shoved into a corner by the forklift. Needs a safety valve:
  forks can lift racks off boxes, a "pull a replacement from backstock" fallback, or the
  supervisor's office reissuing the order.
- **Undoes recent work:** the reset ring, sending the forklift home, and restoring fallen stock.
- **Stacks with explosions:** one FRAGILE blast early in an order turns the rest of it into
  pile-sorting, every time.
- **Navigation:** fallen racks block aisles and the forklift can't drive over them, so the docks
  or the ramp could become unreachable.

**Open questions:** What's the fallback when a box can't be reached? Do fallen racks block aisles
for good? Should blasts still fling everything now that nothing gets reset?

## 3. Packing stations for FRAGILE boxes

FRAGILE boxes need bubble-wrapping at a packing station before they go on the pallet. The
stations can be knocked over by the forklift.

**How it could work:** one or two packing tables (e.g. near the wrap square). Put a FRAGILE box on
a station and it gets bubble-wrapped (a short hold, or automatically after a few seconds). A
wrapped FRAGILE box looks different (shiny bubble wrap) and is safe. Stations are physics props
the forklift can bump or tip.

**Pros**
- Gives FRAGILE boxes a purpose beyond "don't drop it". Right now FRAGILE is pure risk.
- A step that's mostly Dave's job: good for co-op (Ralph fetches while Dave packs).
- Fits the warehouse feel (corner area, docks, wrapper).
- A knocked-over station is another hazard and comedy beat.

**Cons**
- **Longer orders**, when order length is already a concern. Fine only if it replaces time
  somewhere else.
- **Rules to decide:** Does a wrapped FRAGILE box still explode if thrown, or does wrapping make
  it safe? Does an unwrapped FRAGILE box block the order at the dock, or just not count? Order
  boxes are FRAGILE only about 15% of the time: is the station mostly unused, or should FRAGILE
  order lines be more common?
- **Space:** the open floor is getting busy (wrap square, docks, spills, the corner).
- **More to restore** if racks or stations get knocked over (ties into idea 2).

## How they work together

- **1 + 2 amplify each other, maybe too much.** A fast drifting forklift knocks racks over far
  more often, and with no reset every mistake is permanent. Much harder and messier: great if
  "survive the shift" is the goal, rough if completing orders is.
- **1 + 3 balance each other.** A fast forklift and a packing step offset on time: Ralph saves time
  driving, Dave spends some packing. Drifting past packing stations adds risk and comedy.
- **2 + 3 need care.** With racks staying down, FRAGILE boxes end up in floor piles. Keep the
  current rule that only Dave dropping or throwing one arms it, not falling off a rack, or one rack
  going over becomes a chain of explosions.
- **All three plus explosions:** maximum chaos. If 1 and 2 both land, tone the blast down (radius,
  or chain reactions).

## Suggested order

1. **Drifting first**, with a drift as the *safe* way to corner fast (tyres slide instead of the
   truck tipping), plus one long straight route to the docks. Self-contained, helps order length,
   most fun per hour of work.
2. **Packing stations next**, with a simple rule: wrapping makes a FRAGILE box safe and is
   required for it to count. Make FRAGILE order lines a bit more common so stations get used.
3. **Racks staying down last**, maybe as a "hard mode" option rather than the default, with a
   backstock fallback so an order can't soft-lock.

## 4. Replace the office and safety station in the north-east corner

The supervisor's office and safety station (the OSHA RULES board and friends) are pure set
dressing on prime floor: about 13 × 4 m along the north wall, between the LADDERS stand and the
forklift parking bay, right by Ralph's start spot and on the way to the docks. Swap them for
something that feeds the game.

**Keep:** the forklift parking bay (Ralph's start spot and the night-shift drop), probably the
propane cage (its chain reactions are good chaos), and the Employee of the Month board, moved to
another wall (a cheap joke that reacts to incidents).

**Gameplay options**
1. **Packing stations** (ties into idea 3): two packing tables with bubble-wrap rolls, tape and a
   scale. The natural spot if FRAGILE boxes ever need wrapping: near the wrap square and docks,
   on Ralph's route. Building the area first makes idea 3 an easy follow-up.
2. **Conveyor line:** a powered roller conveyor along the wall into a shrink-wrap or label
   machine. Boxes dropped on it ride along: a quick way to move boxes across the floor, with a
   kill switch Dave can hit. A classic hazard too: it could carry Dave off if he stands on it.
3. **Returns cage / damaged goods:** a wire cage piled with crushed, re-taped returns. Could get a
   job: exploded or dropped boxes go to the returns cage instead of restocking straight to the
   shelf, so a lost order box has to be fetched from there.
4. **Outbound staging lanes:** painted lanes with half-built pallets for other orders. Filler that's
   also physics chaos for drifting and blasts, and it fits the dock side.
5. **A small mezzanine:** a steel platform about 3 m up with stairs, holding overflow stock or the
   office. Gives Dave a vertical spot and Ralph something to clip with the mast raised.

**Comedy / set dressing options**
- **Break room:** vending machines (one with a box stuck in it), a microwave, a "WHO TOOK MY
  LUNCH" sign, a sofa. Funny, but still decoration.
- **Cardboard baler / compactor:** a big machine with bales stacked by it and a hazard-striped
  crush zone. Looks great; later it could crush stray boxes, or be one more thing that explodes.

**Suggested pick:** packing stations plus a conveyor along the wall feeding them. It fills the
space, sets up idea 3, gives Dave a reason to visit the corner, and adds a new hazard. Runner-up:
the returns cage, if lost boxes should matter.
