import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Segment } from '../types';
import { seededRng } from './rng';
import { cardboardTexture, woodTexture, shrinkWrapTexture } from './goodsTextures';

// Fills occupied SPACE segments with a wooden pallet and a stack of boxes.
// Occupancy and stack shape are seeded by the segment fullName, so the layout
// is identical on every reload. Everything is InstancedMesh:
//   1 instanced pallet mesh + 1 instanced mesh per box-stack archetype.
// Ported from Warehouse-3d-View-changes so the pallet/box design matches.

const OCCUPANCY = 0.6;
const PALLET_H = 144;          // mm, canonical pallet height
const HEADROOM = 250;          // mm, clearance kept under the level above

// ---- canonical pallet: 1200 (X) x 144 (Y) x 1000 (Z) --------------------
// Low-poly block pallet (48 tris): a single top-deck slab over three stringer
// blocks, leaving the two fork gaps. The wood texture supplies the slatted
// plank look, so the silhouette reads as a pallet without per-board geometry —
// at ~15k instances this is the difference between 2.4M and 0.7M triangles.
function makePalletGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };

  // three stringer blocks (along X), with fork gaps between them
  for (const z of [-430, 0, 430]) add(1200, 118, 130, 0, 59, z);
  // top deck slab
  add(1200, 26, 1000, 0, 131, 0);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

// ---- box-stack archetypes, built in unit space ---------------------------
// Footprint spans x/z in [-0.5, 0.5], height spans y in [0, 1]; instances
// scale this to the real stack size.
function unitBox(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}

function makeArchetypes(): THREE.BufferGeometry[] {
  // 0: one large box
  const single = mergeParts([unitBox(0.94, 1, 0.94, 0, 0, 0)]);

  // 1: 2 x 2 x 2 stack of cartons with small gaps
  const stackParts: THREE.BufferGeometry[] = [];
  for (const x of [-0.245, 0.245])
    for (const z of [-0.245, 0.245])
      for (const y of [0, 0.51])
        stackParts.push(unitBox(0.465, 0.49, 0.465, x, y, z));
  const stack2 = mergeParts(stackParts);

  // 2: mixed-size pile
  const mixed = mergeParts([
    unitBox(0.55, 0.52, 0.9, -0.21, 0, 0),
    unitBox(0.36, 0.44, 0.42, 0.28, 0, -0.24),
    unitBox(0.36, 0.38, 0.4, 0.28, 0, 0.24),
    unitBox(0.5, 0.42, 0.55, -0.12, 0.52, 0.05),
    unitBox(0.3, 0.3, 0.32, 0.27, 0.44, -0.18),
  ]);

  // 3: shrink-wrapped — same silhouette as the 2x2x2 stack, smoothed into
  // one block with a slight taper (wrap pulls the corners in)
  const wrapped = mergeParts([
    unitBox(0.96, 0.97, 0.96, 0, 0, 0),
    unitBox(0.88, 0.06, 0.88, 0, 0.965, 0),
  ]);

  return [single, stack2, mixed, wrapped];
}

interface Decision {
  seg: Segment;
  archetype: number;
  heightFrac: number;
  jitterX: number;
  jitterZ: number;
  rotY: number;
  tone: number;
  floor: boolean; // floor location (goods-in/packing/etc.) vs rack shelf
}

// Fixed footprint/height for floor-location goods (the segment's own dims are
// rack-bay sized and unsuitable). ~1 pallet on the floor.
const FLOOR_W = 1200;
const FLOOR_D = 1100;
const FLOOR_STACK = 1700;

// occupied: set of backend segment ids that hold stock. When provided, goods
// are rendered ONLY at those locations (everything else is an empty shelf).
// When null (demo / unknown), fall back to a seeded random fill for looks.
export function buildGoods(
  segments: Segment[],
  occupied: Set<number> | null = null,
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.name = 'GOODS';

  // Rack bins (shelf goods) + non-rack leaf locations like goods-in / packing
  // (floor goods). Both are real storage locations the user wants to see filled.
  const spaces = segments.filter((s) => s.type === 'SPACE');
  const floorLocs = segments.filter((s) => s.isLeaf && s.type !== 'SPACE');

  const decide = (s: Segment, floor: boolean): Decision | null => {
    const r = seededRng(s.fullName);
    const isOccupied = occupied ? s.id != null && occupied.has(s.id) : r() < OCCUPANCY;
    if (!isOccupied) return null;
    return {
      seg: s,
      floor,
      archetype: Math.floor(r() * 4),
      heightFrac: 0.55 + r() * 0.4,
      jitterX: (r() - 0.5) * 25,
      jitterZ: (r() - 0.5) * 20,
      rotY: ((r() - 0.5) * 4 * Math.PI) / 180,
      tone: 0.88 + r() * 0.18,
    };
  };

  // Pass 1 — decide which locations hold goods, then seed archetype/jitter.
  const decisions: Decision[] = [];
  for (const s of spaces) {
    const d = decide(s, false);
    if (d) decisions.push(d);
  }
  for (const s of floorLocs) {
    const d = decide(s, true);
    if (d) decisions.push(d);
  }

  // Materials
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.9, metalness: 0 });
  const cardboardMat = new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.85, metalness: 0 });
  const wrapMat = new THREE.MeshStandardMaterial({ map: shrinkWrapTexture(), roughness: 0.15, metalness: 0.05 });

  // Pallets — one instance per occupied space.
  const palletGeom = makePalletGeometry();
  const palletMesh = new THREE.InstancedMesh(palletGeom, woodMat, decisions.length);
  palletMesh.frustumCulled = false;
  palletMesh.raycast = () => {};
  palletMesh.name = 'GOODS_PALLETS';

  // Box stacks — one InstancedMesh per archetype.
  const archetypeGeoms = makeArchetypes();
  const counts = [0, 0, 0, 0];
  for (const d of decisions) counts[d.archetype]++;
  const boxMeshes = archetypeGeoms.map((g, i) => {
    const mat = i === 3 ? wrapMat : cardboardMat;
    const m = new THREE.InstancedMesh(g, mat, counts[i]);
    m.frustumCulled = false;
    m.raycast = () => {};
    m.name = `GOODS_BOXES_${i}`;
    return m;
  });

  // Pass 2 — place instances.
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const cursors = [0, 0, 0, 0];

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    const s = d.seg;

    // Footprint + base differ for floor locations (fixed pallet on the floor)
    // vs rack bins (sized to the bin, sitting on the shelf beam).
    const footW = d.floor ? FLOOR_W : s.dimensionX;
    const footD = d.floor ? FLOOR_D : s.dimensionY;
    const cx = s.coordinateX + s.dimensionX / 2 + d.jitterX;
    const cz = s.coordinateY + s.dimensionY / 2 + d.jitterZ;
    // The beam at a level's floor has its top at ~coordinateZ (level bottom),
    // and the pallet geometry's own base is at local y=0, so the pallet sits
    // on the beam when baseY ≈ coordinateZ. (Ground level has no beam → rests
    // on the slab at the same height.) +5mm avoids z-fighting the beam top.
    const baseY = s.coordinateZ + 5;

    // Fill most of the bin so the load reads at full size in the slot (was
    // ~0.8, which looked undersized on the upper levels).
    const palletW = footW * 0.92;
    const palletD = footD * 0.9;

    dummy.position.set(cx, baseY, cz);
    dummy.rotation.set(0, d.rotY, 0);
    dummy.scale.set(palletW / 1200, 1, palletD / 1000);
    dummy.updateMatrix();
    palletMesh.setMatrixAt(i, dummy.matrix);

    // box stack on top of the pallet
    const avail = d.floor ? FLOOR_STACK : Math.max(300, s.dimensionZ - HEADROOM - PALLET_H);
    const stackH = avail * d.heightFrac;
    const mesh = boxMeshes[d.archetype];
    const idx = cursors[d.archetype]++;

    dummy.position.set(cx, baseY + PALLET_H, cz);
    dummy.rotation.set(0, d.rotY, 0);
    // Boxes a touch larger than the pallet (slight realistic overhang) so the
    // load sits equal-to / a little bigger than the bin opening.
    dummy.scale.set(palletW * 1.04, stackH, palletD * 1.04);
    dummy.updateMatrix();
    mesh.setMatrixAt(idx, dummy.matrix);

    if (d.archetype === 3) {
      // shrink wrap: subtle blue-white variation
      color.setRGB(d.tone * 0.95 + 0.05, d.tone * 0.97 + 0.03, 1);
    } else {
      color.setRGB(d.tone, d.tone, d.tone);
    }
    mesh.setColorAt(idx, color);
  }

  palletMesh.instanceMatrix.needsUpdate = true;
  for (const m of boxMeshes) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  group.add(palletMesh, ...boxMeshes);

  return {
    group,
    dispose() {
      palletMesh.geometry.dispose();
      palletMesh.dispose();
      for (const m of boxMeshes) {
        m.geometry.dispose();
        m.dispose();
      }
      woodMat.dispose();
      cardboardMat.dispose();
      wrapMat.dispose();
    },
  };
}
