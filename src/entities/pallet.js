import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config.js';
import { COL, yawQuat } from '../physics.js';
import { flatMat } from '../util/meshes.js';

// Pallet local frame: X = 1.0 m width, Z = 1.2 m length (fork entry from ±Z), origin at bottom center.
// Three runners along Z leave two fork pockets under the deck.
export function palletShapes() {
  const { size, mass, friction } = CONFIG.objects.pallet;
  const [w, h, l] = size;
  const deckT = 0.035;
  const runnerH = h - deckT;
  const runnerW = 0.1;
  const parts = [
    { half: [w / 2, deckT / 2, l / 2], pos: [0, h - deckT / 2, 0] },
    ...[-1, 0, 1].map((i) => ({
      half: [runnerW / 2, runnerH / 2, l / 2],
      pos: [i * (w / 2 - runnerW / 2), runnerH / 2, 0],
    })),
  ];
  const vol = parts.reduce((s, p) => s + p.half[0] * p.half[1] * p.half[2], 0);
  for (const p of parts) {
    p.mass = (mass * p.half[0] * p.half[1] * p.half[2]) / vol;
    p.friction = friction;
  }
  return parts;
}

// Visual construction is separate from the smooth collision deck, so small board gaps
// never catch fork tips or carton corners. Every timber stays within the original envelope.
export function palletMesh() {
  const [w, h, length] = CONFIG.objects.pallet.size;
  const deckT = .035, runnerH = h - deckT, runnerW = .1;
  const group = new THREE.Group();
  const wood = flatMat(0xffffff);
  const matrix = new THREE.Matrix4();
  const addTimbers = (name, pieces) => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wood, pieces.length);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
    pieces.forEach((piece, i) => {
      matrix.compose(new THREE.Vector3(...piece.pos), new THREE.Quaternion(), new THREE.Vector3(...piece.size));
      mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, new THREE.Color(piece.color));
    });
    group.add(mesh); return mesh;
  };
  const runners = [-1, 0, 1].map(i => ({ size: [runnerW, runnerH, length],
    pos: [i * (w / 2 - runnerW / 2), runnerH / 2, 0], color: i === 0 ? 0x967447 : 0xa78250 }));
  addTimbers('Three timber runners', runners);
  const gap = length * .018, unit = (length - gap * 6) / 7.5;
  let z = -length / 2;
  const boards = Array.from({ length: 7 }, (_, i) => {
    const depth = unit * (i === 0 || i === 6 ? 1.25 : 1);
    const board = { size: [w, deckT, depth], pos: [0, h - deckT / 2, z + depth / 2],
      color: [0xb99566, 0xc4a374, 0xb28e5e, 0xc0a071, 0xb99766, 0xc6a779, 0xb38e5e][i] };
    z += depth + gap; return board;
  });
  addTimbers('Seven separated deck boards', boards);
  // Paired nail heads above each runner. Instancing keeps detailed loaded racks inexpensive.
  const nails = new THREE.InstancedMesh(new THREE.BoxGeometry(.008, .0006, .008), flatMat(0x4b4540), boards.length * 6);
  nails.name = 'Recessed nail heads';
  let nail = 0;
  for (const board of boards) for (const runner of runners) for (const side of [-1, 1]) {
    matrix.makeTranslation(runner.pos[0], h + .0003, board.pos[2] + side * board.size[2] * .27);
    nails.setMatrixAt(nail++, matrix);
  }
  group.add(nails);
  // Fine lengthwise grain, end splits and runner seams: visible geometry, no texture downloads.
  const strokes = [];
  const stroke = (a, b) => strokes.push(...a, ...b);
  boards.forEach((board, i) => {
    for (let g = 0; g < 5; g++) {
      const gz = board.pos[2] + (g - 2) * board.size[2] / 6;
      const start = -w * .45 + ((i * 3 + g) % 4) * w * .045;
      stroke([start, h + .0007, gz], [Math.min(w * .46, start + w * (.3 + g * .11)), h + .0007, gz + .002]);
    }
    for (const side of [-1, 1]) {
      const sx = side * w / 2, splitZ = board.pos[2] + (i % 3 - 1) * board.size[2] * .2;
      stroke([sx, h + .0008, splitZ], [sx - side * .065, h + .0008, splitZ + .006]);
    }
  });
  for (const runner of runners) for (const side of [-1, 1]) {
    for (const fraction of [.3, .65]) stroke([runner.pos[0] + side * (runnerW / 2 + .0004), runnerH * fraction, -length * .46],
      [runner.pos[0] + side * (runnerW / 2 + .0004), runnerH * fraction + .003, length * .44]);
  }
  const grain = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(strokes, 3)),
    new THREE.LineBasicMaterial({ color: 0x725739, transparent: true, opacity: .38 }));
  grain.name = 'Wood grain and small end splits'; group.add(grain);
  return group;
}

export function createPallet(game, { pos, yaw = 0 }) {
  const body = game.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2]).setRotation(yawQuat(yaw)).setCanSleep(true),
  );
  const shapes = palletShapes();
  for (const s of shapes) {
    game.world.createCollider(
      RAPIER.ColliderDesc.cuboid(...s.half).setTranslation(...s.pos).setMass(s.mass)
        .setFriction(s.friction).setCollisionGroups(COL.dyn), body,
    );
  }
  const mesh = palletMesh();
  mesh.position.fromArray(pos); mesh.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  game.scene.add(mesh);
  const ent = { kind: 'pallet', body, mesh, shapes, mass: CONFIG.objects.pallet.mass };
  game.addEntity(ent);
  return ent;
}
