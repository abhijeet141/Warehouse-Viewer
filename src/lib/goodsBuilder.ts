import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Segment } from '../types';
import { seededRng } from './rng';
import {
  cardboardTexture, cardboardNormal,
  cartonTexture, cartonNormal,
  woodTexture, woodNormal,
  shrinkWrapTexture, shrinkWrapNormal,
} from './goodsTextures';

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
  hue: number; // small per-instance colour cast, for load-to-load variety
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
// worldScale mirrors the non-uniform scale on the parent worldGroup ({ y: vScale,
// z: hScale }; X is always 1). Goods are placed compensating for it so rotated
// pallets stay rectangular instead of being sheared by the parent stretch.
export function buildGoods(
  segments: Segment[],
  occupied: Set<number> | null = null,
  worldScale: { y: number; z: number } = { y: 1, z: 1 },
  env: THREE.Texture | null = null,
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.name = 'GOODS';

  // Rack bins (shelf goods) + non-rack leaf locations like goods-in / packing
  // (floor goods). Both are real storage locations the user wants to see filled.
  const spaces = segments.filter((s) => s.type === 'SPACE');
  const floorLocs = segments.filter((s) => s.isLeaf && s.type !== 'SPACE');

  // Archetype mix: mostly brown kraft loads (0 single, 2 mixed pile), a smaller
  // share of light printed cartons (1), and some stretch-wrapped (3). Keeping
  // the bright cartons in the minority reads better for a presentation.
  const pickArchetype = (rv: number): number => {
    if (rv < 0.40) return 0; // kraft single (~40%)
    if (rv < 0.50) return 1; // printed carton (~10%)
    if (rv < 0.86) return 2; // kraft mixed pile (~36%)
    return 3; // stretch-wrapped (~14%, and now grey rather than bright white)
  };

  const decide = (s: Segment, floor: boolean): Decision | null => {
    const r = seededRng(s.fullName);
    const isOccupied = occupied ? s.id != null && occupied.has(s.id) : r() < OCCUPANCY;
    if (!isOccupied) return null;
    return {
      seg: s,
      floor,
      archetype: pickArchetype(r()),
      heightFrac: 0.55 + r() * 0.4,
      jitterX: (r() - 0.5) * 25,
      jitterZ: (r() - 0.5) * 20,
      rotY: ((r() - 0.5) * 4 * Math.PI) / 180,
      tone: 0.8 + r() * 0.32,
      hue: r() - 0.5,
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

  // Materials. Normal maps add tactile relief to the flat box/pallet faces, and
  // the shared env map gives proper indoor reflections — subtle on matte kraft,
  // strong on the glossy stretch wrap — for a far more premium read at no runtime
  // cost (all still instanced).
  const woodMat = new THREE.MeshStandardMaterial({
    map: woodTexture(), normalMap: woodNormal(),
    roughness: 0.82, metalness: 0, envMap: env, envMapIntensity: 0.45,
  });
  woodMat.normalScale.set(0.7, 0.7);
  // Plain kraft boxes (archetypes 0 and 2).
  const kraftMat = new THREE.MeshStandardMaterial({
    map: cardboardTexture(), normalMap: cardboardNormal(),
    roughness: 0.95, metalness: 0, envMap: env, envMapIntensity: 0.25,
  });
  kraftMat.normalScale.set(0.85, 0.85);
  // Printed retail cartons (archetype 1) — a bit smoother, more reflective.
  const cartonMat = new THREE.MeshStandardMaterial({
    map: cartonTexture(), normalMap: cartonNormal(),
    roughness: 0.7, metalness: 0, envMap: env, envMapIntensity: 0.5,
  });
  cartonMat.normalScale.set(0.6, 0.6);
  // Stretch-wrapped loads (archetype 3) — glossy film catching the env map.
  const wrapMat = new THREE.MeshStandardMaterial({
    map: shrinkWrapTexture(), normalMap: shrinkWrapNormal(),
    roughness: 0.24, metalness: 0, envMap: env, envMapIntensity: 1.1,
  });
  wrapMat.normalScale.set(0.5, 0.5);
  const boxMatFor = (archetype: number) =>
    archetype === 3 ? wrapMat : archetype === 1 ? cartonMat : kraftMat;

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
    const m = new THREE.InstancedMesh(g, boxMatFor(i), counts[i]);
    m.frustumCulled = false;
    m.raycast = () => {};
    m.name = `GOODS_BOXES_${i}`;
    return m;
  });

  // Pass 2 — place instances.
  // The parent worldGroup carries a non-uniform scale (depth Z widened by hScale).
  // Composing an instance in local space would leave that scale to SHEAR every
  // rotated pallet — a rotation sitting between two unequal scales is a shear —
  // which reads as skewed, tilted-looking pallets (most obvious looking up at a
  // shelf). So instead we build each instance's intended WORLD matrix (the
  // rotation applied to an already-stretched box, which stays rectangular) and
  // pre-multiply by the inverse parent scale, so the on-screen result is exactly
  // that world matrix — shear-free.
  const { y: vS, z: hS } = worldScale;
  const invParent = new THREE.Matrix4().makeScale(1, 1 / vS, 1 / hS);
  const UP = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();
  const posV = new THREE.Vector3();
  const sclV = new THREE.Vector3();
  const worldMat = new THREE.Matrix4();
  const outMat = new THREE.Matrix4();
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

    quat.setFromAxisAngle(UP, d.rotY);
    // Pallet geom is 1200(X) x 144(Y) x 1000(Z); scale to the bin footprint and
    // bake the parent depth-stretch into Z so the box itself is stretched (and
    // rotated rectangular) rather than sheared.
    posV.set(cx, baseY * vS, cz * hS);
    sclV.set(palletW / 1200, vS, (palletD / 1000) * hS);
    worldMat.compose(posV, quat, sclV);
    outMat.multiplyMatrices(invParent, worldMat);
    palletMesh.setMatrixAt(i, outMat);

    // box stack on top of the pallet
    const avail = d.floor ? FLOOR_STACK : Math.max(300, s.dimensionZ - HEADROOM - PALLET_H);
    const stackH = avail * d.heightFrac;
    const mesh = boxMeshes[d.archetype];
    const idx = cursors[d.archetype]++;

    posV.set(cx, (baseY + PALLET_H) * vS, cz * hS);
    // Boxes a touch larger than the pallet (slight realistic overhang) so the
    // load sits equal-to / a little bigger than the bin opening.
    sclV.set(palletW * 1.04, stackH * vS, palletD * 1.04 * hS);
    worldMat.compose(posV, quat, sclV);
    outMat.multiplyMatrices(invParent, worldMat);
    mesh.setMatrixAt(idx, outMat);

    if (d.archetype === 3) {
      // stretch wrap: muted grey film (light→mid grey, faint cool cast) rather
      // than a glaring bright-white block — reads far better in a presentation.
      const g = 0.6 + (d.tone - 0.8) * 0.6; // tone 0.8..1.12 → ~0.6..0.79
      color.setRGB(g * 0.99, g, g * 1.04);
    } else if (d.archetype === 1) {
      // printed cartons: bright, near-neutral with a faint cast either way
      const t = 0.9 + (d.tone - 0.8) * 0.55;
      color.setRGB(t + d.hue * 0.05, t, t - d.hue * 0.04);
    } else {
      // kraft: soft warm tan. Lift the floor (remap tone into a tight, bright
      // band) so boxes vary gently without any going muddy-dark, and keep the
      // warmth subtle so it doesn't read as heavy brown.
      const k = 0.92 + (d.tone - 0.8) * 0.4; // tone 0.8..1.12 → ~0.92..1.05
      color.setRGB(k, k * (0.97 + d.hue * 0.03), k * (0.92 + d.hue * 0.04));
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
      kraftMat.dispose();
      cartonMat.dispose();
      wrapMat.dispose();
    },
  };
}
