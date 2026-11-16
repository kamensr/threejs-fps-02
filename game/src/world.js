// Depot 7: an original compact 3-lane map. Vanguard spawns south, Warden north;
// Site A (SILO) west, Site B (YARD) east, a mid lane and a cross corridor between
// them. Every box is a collider for bodies and a surface bullets stop on. The
// waypoint graph underneath is what bots walk: nodes in open space, edges that
// never cross a wall, BFS for the shortest route.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph: [x, z] nodes, then undirected edges by node index. Node 0 is the
// Vanguard spawn, 24 the Warden spawn, 19 Site A, 20 Site B. Nodes 13/27/28/29
// route mid around the ends of the control block — never through it.
const NODES = [
  [0, 18], [-10, 14], [10, 14], [-20, 12], [20, 12], [-24, 6], [24, 6],
  [0, 10], [0, 4], [-24, 0], [24, 0], [-12, 6], [12, 6], [-9, 1],
  [-12, 0], [12, 0], [-24, -6], [24, -6], [0, -6], [-24, -12], [24, -12],
  [0, -14], [-10, -16], [10, -16], [0, -19], [-24, -16], [24, -16],
  [9, 1], [-9, -5], [9, -5],
];
const EDGES = [
  [0, 1], [0, 2], [0, 7], [1, 3], [1, 11], [2, 4], [2, 12],
  [3, 5], [3, 11], [4, 6], [4, 12], [5, 9], [5, 16], [5, 11],
  [6, 10], [6, 17], [6, 12], [7, 8], [7, 11], [7, 12], [8, 13],
  [8, 27], [8, 14], [8, 15], [9, 16], [9, 14], [10, 17], [10, 15],
  [11, 14], [12, 15], [13, 28], [27, 29], [13, 14], [27, 15],
  [14, 28], [15, 29], [28, 18], [29, 18],
  [14, 16], [15, 17],
  [16, 19], [16, 25], [17, 20], [17, 26], [18, 21],
  [19, 25], [20, 26], [21, 22], [21, 23], [21, 24], [22, 25],
  [22, 24], [23, 26], [23, 24],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of ['surface', 'ground', 'concrete', 'crate', 'hairline', 'ink', 'accent', 'siteA', 'siteB', 'war']) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.5 : 0.92,
      metalness: 0.04,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(r, h, x, z, material, segments = 20) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), materials[material]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function disc(x, z, radius, material) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[material]), transparent: true, opacity: 0.28, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.02, z);
    group.add(mesh);
    return mesh;
  }

  // Ground and perimeter: 64 x 44 m, 5 m walls, open to the dusk sky.
  box(64.6, 0.4, 44.6, 0, -0.2, 0, 'ground');
  box(0.6, 5, 44.6, -32.3, 2.5, 0, 'surface');
  box(0.6, 5, 44.6, 32.3, 2.5, 0, 'surface');
  box(64.6, 5, 0.6, 0, 2.5, -22.3, 'surface');
  box(64.6, 5, 0.6, 0, 2.5, 22.3, 'surface');

  // Lane dividers at x = -12 and x = +12, z from +14 down to -2, with two gaps
  // each (z in [5,9] and z in [-2,1]) so lanes connect but sightlines stay short.
  for (const x of [-12, 12]) {
    box(0.6, 4, 5, x, 2, 11.5, 'surface');
    box(0.6, 4, 4, x, 2, 3, 'surface');
  }

  // Mid control block: 12 m wide, splitting mid into two paths around its
  // ends. It is wide on purpose — every spawn-to-spawn sightline crosses it,
  // so neither team can camp spawn and snipe the other; fights happen in the
  // lanes and at the sites, not across the whole map.
  box(12, 4, 4, 0, 2, -2, 'concrete');
  box(12.6, 0.4, 4.6, 0, 4.1, -2, 'hairline');

  // Site A (SILO): a fuel silo, crates, a low platform to jump onto.
  cylinder(2.6, 6.5, -27, -16, 'surface');
  box(4, 0.8, 4, -20, 0.4, -10, 'concrete');
  box(2.4, 1.1, 1.2, -22, 0.55, -14.5, 'crate');
  box(1.2, 1.1, 2.4, -28, 0.55, -9, 'crate');
  box(1.2, 1.2, 1.2, -18.5, 0.6, -17.5, 'crate');
  box(1.2, 1.2, 1.2, -18.5, 1.8, -17.5, 'crate');
  disc(-24, -12, 6, 'siteA');

  // Site B (YARD): stacked freight containers and crates.
  box(5, 2.4, 2.4, 26, 1.2, -16, 'surface');
  box(5, 2.4, 2.4, 26, 3.6, -16, 'hairline');
  box(4, 0.8, 4, 20, 0.4, -10, 'concrete');
  box(2.4, 1.1, 1.2, 22, 0.55, -14.5, 'crate');
  box(1.2, 1.1, 2.4, 28, 0.55, -9, 'crate');
  box(1.2, 1.2, 1.2, 18.5, 0.6, -17.5, 'crate');
  disc(24, -12, 6, 'siteB');

  // Lane cover: crates and low walls to crouch behind, staggered so no lane is a
  // straight shooting gallery.
  box(1.2, 1.2, 1.2, -24, 0.6, 10, 'crate');
  box(1.2, 1.2, 1.2, -20, 0.6, 2, 'crate');
  box(2.4, 1.1, 1.2, -24, 0.55, -3, 'crate');
  box(1.2, 1.2, 1.2, 24, 0.6, 10, 'crate');
  box(1.2, 1.2, 1.2, 20, 0.6, 2, 'crate');
  box(2.4, 1.1, 1.2, 24, 0.55, -3, 'crate');
  box(1.2, 1.2, 1.2, -4, 0.6, 10, 'crate');
  box(1.2, 1.2, 1.2, 4, 0.6, 6, 'crate');
  box(2.4, 1.1, 1.2, 0, 0.55, -8, 'crate');
  box(1.2, 1.2, 1.2, -8, 0.6, -8, 'crate');
  box(1.2, 1.2, 1.2, 8, 0.6, -8, 'crate');
  box(2.4, 1.1, 1.2, -16, 0.55, -6, 'crate');
  box(2.4, 1.1, 1.2, 16, 0.55, -6, 'crate');
  box(1.2, 1.2, 1.2, -6, 0.6, -14, 'crate');
  box(1.2, 1.2, 1.2, 6, 0.6, -14, 'crate');

  // Site marker posts: a lit pylon at each site so both read at a glance.
  for (const [x, z, material] of [[-24, -18.5, 'siteA'], [24, -18.5, 'siteB']]) {
    box(0.5, 4.5, 0.5, x, 2.25, z, 'hairline');
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.5, 0.9),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE[material]) }),
    );
    lamp.position.set(x, 4.7, z);
    group.add(lamp);
  }

  // Light: warm low sun from the south-east, cool dusk fill, fog to the sky colour.
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 95);
  scene.add(new THREE.HemisphereLight(new THREE.Color('#8fa3c7'), new THREE.Color('#3a2f22'), 1.15));
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.7);
  sun.position.set(24, 30, 18);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#6f87ad'), 0.5);
  fill.position.set(-18, 14, -16);
  scene.add(fill);
  for (const [x, z, color] of [[-24, -12, PALETTE.siteA], [24, -12, PALETTE.siteB]]) {
    const lamp = new THREE.PointLight(new THREE.Color(color), 14, 18, 1.8);
    lamp.position.set(x, 4.5, z);
    scene.add(lamp);
  }

  // Waypoint graph: adjacency lists, BFS shortest path, nearest node lookup.
  const adjacency = NODES.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  const nodeVectors = NODES.map(([x, z]) => new THREE.Vector3(x, 0, z));

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodeVectors.length; i += 1) {
      const dx = nodeVectors[i].x - x;
      const dz = nodeVectors[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // BFS from `from` node to `to` node; returns waypoint Vector3s (shared node
  // vectors, never mutated) excluding the start node.
  function findPath(from, to, out) {
    out.length = 0;
    if (from === to) return out;
    const prev = new Int16Array(NODES.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      if (current === to) break;
      for (const next of adjacency[current]) {
        if (prev[next] === -1) {
          prev[next] = current;
          queue.push(next);
        }
      }
    }
    if (prev[to] === -1) return out;
    const chain = [];
    let node = to;
    while (node !== from) {
      chain.push(node);
      node = prev[node];
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) out.push(nodeVectors[chain[i]]);
    return out;
  }

  return {
    colliders,
    shootables,
    group,
    sites: {
      A: { name: 'SILO', center: new THREE.Vector3(-24, 0, -12), radius: 6, node: 19 },
      B: { name: 'YARD', center: new THREE.Vector3(24, 0, -12), radius: 6, node: 20 },
    },
    spawns: {
      van: [
        new THREE.Vector3(-4.5, 0, 19), new THREE.Vector3(-1.5, 0, 19),
        new THREE.Vector3(1.5, 0, 19), new THREE.Vector3(4.5, 0, 19),
      ],
      war: [
        new THREE.Vector3(-4.5, 0, -19), new THREE.Vector3(-1.5, 0, -19),
        new THREE.Vector3(1.5, 0, -19), new THREE.Vector3(4.5, 0, -19),
      ],
    },
    // Defender hold spots: { x, z, yaw } — yaw faces the expected attacker lane.
    holdSpots: {
      A: [
        { x: -20, z: -9, yaw: Math.PI * 0.85 },
        { x: -27.5, z: -9, yaw: Math.PI * 0.15 },
        { x: -24, z: -16.5, yaw: 0 },
      ],
      B: [
        { x: 20, z: -9, yaw: Math.PI * 0.15 },
        { x: 27.5, z: -9, yaw: Math.PI * 0.85 },
        { x: 24, z: -16.5, yaw: 0 },
      ],
      MID: [{ x: 0, z: -9, yaw: 0 }],
    },
    nearestNode,
    findPath,
    nodeVectors,
  };
}
