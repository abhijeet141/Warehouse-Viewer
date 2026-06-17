import * as THREE from 'three';
import { mulberry32 } from './rng';

// Canvas-generated textures for the demo stock (pallets + boxes), created once
// and cached. Kept small (<=256) — detail comes from the repeat, not the size.
// Ported from Warehouse-3d-View-changes/src/lib/realistic/textures.ts so the
// pallet/box look matches that build exactly.

const cache = new Map<string, THREE.CanvasTexture>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function cached(key: string, build: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    t = build();
    cache.set(key, t);
  }
  return t;
}

// Cardboard box face: kraft-brown base + paper noise + a tape strip + a
// small white shipping label.
export function cardboardTexture(): THREE.CanvasTexture {
  return cached('cardboard', () => {
    const [c, ctx] = makeCanvas(256, 256);
    const rnd = mulberry32(202);

    ctx.fillStyle = '#b08a58';
    ctx.fillRect(0, 0, 256, 256);

    // paper grain
    for (let i = 0; i < 2600; i++) {
      const v = rnd();
      ctx.fillStyle = v > 0.5 ? 'rgba(255,235,200,0.06)' : 'rgba(80,55,25,0.07)';
      ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 3, 1);
    }

    // corrugation hint: faint horizontal ridges
    ctx.fillStyle = 'rgba(90,65,35,0.05)';
    for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 256, 1);

    // packing tape strip across the middle
    ctx.fillStyle = 'rgba(205,185,150,0.85)';
    ctx.fillRect(0, 112, 256, 30);
    ctx.fillStyle = 'rgba(160,140,105,0.5)';
    ctx.fillRect(0, 112, 256, 2);
    ctx.fillRect(0, 140, 256, 2);

    // shipping label
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(168, 28, 58, 40);
    ctx.fillStyle = '#444';
    for (let i = 0; i < 4; i++) ctx.fillRect(174, 36 + i * 8, 40 - i * 6, 3);

    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 2;
    return t;
  });
}

// Pallet wood: horizontal planks with per-plank tone shifts and dark seams.
export function woodTexture(): THREE.CanvasTexture {
  return cached('wood', () => {
    const [c, ctx] = makeCanvas(256, 256);
    const rnd = mulberry32(303);

    for (let y = 0; y < 256; y += 32) {
      const tone = 150 + Math.floor(rnd() * 40);
      ctx.fillStyle = `rgb(${tone},${Math.floor(tone * 0.72)},${Math.floor(tone * 0.45)})`;
      ctx.fillRect(0, y, 256, 32);
      // grain streaks
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(60,40,20,${0.05 + rnd() * 0.1})`;
        ctx.fillRect(rnd() * 256, y + rnd() * 30, 18 + rnd() * 60, 1);
      }
      ctx.fillStyle = 'rgba(40,28,16,0.55)';
      ctx.fillRect(0, y, 256, 2);
    }

    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

// Stretch-wrap: pale plastic with vertical sheen streaks (used with a low
// roughness so it reads glossy).
export function shrinkWrapTexture(): THREE.CanvasTexture {
  return cached('shrink', () => {
    const [c, ctx] = makeCanvas(256, 256);
    const rnd = mulberry32(404);

    ctx.fillStyle = '#cfd6da';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * 256;
      ctx.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.15})`;
      ctx.fillRect(x, 0, 1 + rnd() * 4, 256);
    }
    // a faint hint of the boxes underneath
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(120,105,80,0.10)';
      ctx.fillRect(rnd() * 200, rnd() * 200, 40 + rnd() * 50, 40 + rnd() * 50);
    }

    const t = new THREE.CanvasTexture(c);
    return t;
  });
}

export function disposeGoodsTextures(): void {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
