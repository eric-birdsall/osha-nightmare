import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

// Collision group bits. A pair interacts when each one's membership is in the other's filter.
export const G = {
  STATIC: 1,
  DYN: 2,
  FORK: 4,
  CLIMBER: 8,
  RAGDOLL: 16,
  CARRIED: 32,
  SENSOR: 64,
};
const ALL = 0xffff;
export const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const COL = {
  static: groups(G.STATIC, ALL),
  dyn: groups(G.DYN, ALL & ~G.CARRIED),
  fork: groups(G.FORK, ALL & ~G.CARRIED),
  // The climber is query-only: its collider never pushes or blocks anything in the solver.
  climber: groups(G.CLIMBER, G.STATIC | G.DYN | G.FORK),
  ragdoll: groups(G.RAGDOLL, G.STATIC | G.DYN | G.FORK),
  carried: groups(G.CARRIED, 0),
  sensor: groups(G.SENSOR, G.DYN),
  // Scene queries made on the climber's behalf (aim, ground, shadow)
  climberQuery: groups(G.CLIMBER, G.STATIC | G.DYN | G.FORK),
  // Forklift wheel ground probes
  wheelQuery: groups(G.FORK, G.STATIC | G.DYN),
};

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const toThree = (v, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const quatToThree = (q, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
export const yawQuat = (yaw) => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};

export function syncMesh(body, mesh) {
  const t = body.translation();
  const r = body.rotation();
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(r.x, r.y, r.z, r.w);
}

export function castRay(world, origin, dir, maxToi, groupsMask, predicate) {
  const ray = new RAPIER.Ray(origin, dir);
  const hit = world.castRayAndGetNormal(
    ray,
    maxToi,
    true,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    groupsMask,
    undefined,
    undefined,
    predicate,
  );
  if (!hit) return null;
  const t = hit.timeOfImpact;
  return {
    collider: hit.collider,
    toi: t,
    point: v3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
    normal: hit.normal,
  };
}
