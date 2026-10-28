import * as THREE from 'three';

const TITLES = ['Read the clipboard', 'Pick the right box', 'Load a pallet', 'Move the load to WRAP', 'Wrap the pallet', 'Deliver the order'];

// Guidance observes the real order; it never locks controls or requires artificial checkpoints.
export class Tutorial {
  constructor(game) {
    this.game = game;
    this.read = false;
    this.stage = 0;
    this.scanIn = 0;
    this.load = null;
    this.marker = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0xffdc35 });
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 4), material);
    pointer.rotation.z = Math.PI;
    this.marker.add(pointer);
    this.marker.visible = false;
    game.scene.add(this.marker);
  }

  update(dt) {
    const g = this.game;
    this.marker.visible = false;
    if (g.complete || g.jobDone?.shipping) return;
    this.scanIn -= dt;
    if (this.scanIn <= 0) {
      this.scanIn = 0.15;
      const order = g.level.order;
      const completeLoad = (load, wrapped = false) => order.every((line) =>
        (wrapped ? (g.securedCounts ? g.securedCounts(load)[line.line] : load.skus?.[line.sku]) || 0 : g.lineCounts(load)[line.line] || 0) >= line.qty);
      const loads = g.entities.filter((e) => !e.removed && (e.kind === 'pallet' || e.kind === 'wrapped'));
      const wrapped = loads.find((load) => load.kind === 'wrapped' && completeLoad(load, true));
      const loaded = loads.find((load) => completeLoad(load));
      const carrying = g.climber.carriedBoxes().some((box) => (!box.incomingId || g.receivedIds?.has(box.incomingId)) && order.some((line) => line.sku === box.sku));
      if (wrapped || loaded || carrying) this.read = true; // working ahead never blocks progress
      this.load = wrapped || loaded || null;
      if (wrapped) this.stage = 5;
      else if (loaded) this.stage = g.level.wrapZone.contains(loaded.body.translation()) ? 4 : 3;
      else if (carrying) this.stage = 2;
      else this.stage = this.read ? 1 : 0;
    }
    const target = this.destination();
    if (target) {
      this.marker.position.copy(target);
      this.marker.position.y += 0.65 + Math.sin(g.clock * 4) * 0.08;
      this.marker.visible = !g.trackedJobs || Object.values(g.trackedJobs).includes('shipping');
    }
  }

  destination() {
    const g = this.game;
    if (this.stage === 1) {
      const line = g.level.order[0];
      const boxes = g.entities.filter((e) => e.kind === 'box' && !e.removed && !e.carried && e.sku === line.sku);
      const feet = g.climber.feet;
      boxes.sort((a, b) => new THREE.Vector3().copy(a.body.translation()).distanceToSquared(feet)
        - new THREE.Vector3().copy(b.body.translation()).distanceToSquared(feet));
      return boxes[0]?.body.translation();
    }
    if (this.stage === 2) {
      const feet = g.climber.feet;
      const pallets = g.entities.filter((e) => e.kind === 'pallet' && !e.removed);
      pallets.sort((a, b) => new THREE.Vector3().copy(a.body.translation()).distanceToSquared(feet)
        - new THREE.Vector3().copy(b.body.translation()).distanceToSquared(feet));
      return pallets[0]?.body.translation();
    }
    if (this.stage === 3 || this.stage === 4) return { ...g.level.wrapZone.center, y: 0 };
    if (this.stage === 5) return { ...g.level.dockZone.center, y: -0.5 };
    return null;
  }

  content(role) {
    const g = this.game;
    if (g.complete) return null;
    const line = g.level.order[0];
    const button = (action, who = role) => `<kbd>${g.keyHint(who, action)}</kbd>`;
    const move = g.usesKeyboard('climber') ? '<kbd>WASD</kbd>' : 'left stick';
    const swap = g.mode === 'single' ? `Switch to ${role === 'driver' ? 'Dave' : 'Ralph'} with ${button('swap')}. ` : '';
    const details = [
      `Open Pause with ${button('pause')} to read the clipboard. Pick ${line.qty} × SKU ${line.sku} from ${line.location}; ship to ${g.level.dock.name}. Both players can read the current task there. Reading does not start the shift clock.`,
      `${role === 'driver' ? swap : ''}Dave: find ${line.location} and check SKU ${line.sku} on the label. Walk with ${move}; press ${button('interact', 'climber')} to pick it up. Shelf 1 is reachable from the floor—no ladder needed.`,
      `${role === 'driver' ? swap : ''}Dave: carry the box to a wooden pallet. Aim at its deck; tap ${button('interact', 'climber')} to set the box on it when the placement ghost is green. The yellow marker shows a nearby pallet.`,
      `${role === 'climber' ? swap : ''}Ralph: lower the forks with ${button('lower', 'driver')}, line up with the pallet’s open fork pockets, and drive underneath. Raise with ${button('lift', 'driver')}, then carry the load to the yellow WRAP square on the main floor beside the ramp.`,
      g.wrap.job ? 'Wrapping in progress. Keep clear of the rotating arm; the guide advances when the load is wrapped.'
        : `Ralph: lower the pallet onto the floor with ${button('lower', 'driver')}, then reverse fully out of the WRAP square. ${(this.load && !this.load.removed && g.wrap.blockReason(this.load)) || 'Leave the load still; wrapping starts automatically.'}`,
      `${role === 'climber' ? swap : ''}Ralph: collect the wrapped pallet, take the east-wall ramp down to ${g.level.dock.name}, and drive into its open trailer. Keep the forks low so the mast fits. Lower the pallet onto the trailer floor and leave it still to finish.`,
    ];
    return { title: `ORDER 1 · STEP ${this.stage + 1} / ${TITLES.length} · ${TITLES[this.stage]}`, detail: details[this.stage] };
  }
}
