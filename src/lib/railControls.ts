import * as THREE from 'three';
import type { Segment } from '../types';

// One walkway, reduced to a straight centerline on the floor (Three-space X/Z).
export interface Aisle {
  name: string;
  start: THREE.Vector3; // floor point, y = 0
  end: THREE.Vector3;   // floor point, y = 0
  dir: THREE.Vector3;   // normalized start -> end
  length: number;
}

export interface RailControlsOptions {
  eyeHeight?: number;     // starting camera height in world units (Three Y)
  moveSpeed?: number;     // world units / second along the rail
  verticalSpeed?: number; // world units / second for rising / descending
  keyYawSpeed?: number;   // radians / second for A / D turning
  dragLookSpeed?: number; // radians / pixel for mouse-drag look
  wheelSpeed?: number;    // world units per wheel notch
  minHeight?: number;     // lowest the camera may descend (Three Y)
  maxHeight?: number;     // highest the camera may rise; defaults to tallest segment
  minPitch?: number;      // look-down clamp (radians)
  maxPitch?: number;      // look-up clamp (radians)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Rail navigation: camera X/Z is locked to an aisle centerline (so it can never
 * enter a rack), while orientation is free (drag to look, A/D to turn) and the
 * user can ride straight up / down the aisle to inspect higher rack levels.
 * Switch between aisles with prevAisle() / nextAisle() (or the arrow keys).
 */
export class RailControls {
  enabled = false;
  aisles: Aisle[] = [];
  index = 0;
  topY = 0; // tallest segment top, in Three Y

  // Fires whenever the active aisle changes, so Svelte UI can update.
  onChange: ((info: { index: number; name: string; total: number }) => void) | null = null;

  private dist = 0;    // distance traveled along the current aisle
  private height = 0;  // current camera Y
  private yaw = 0;     // around world Y
  private pitch = 0;   // around local X
  private opts: Required<Omit<RailControlsOptions, 'maxHeight'>> & { maxHeight: number };
  private keys = { fwd: false, back: false, left: false, right: false, up: false, down: false };
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    segments: Segment[],
    options: RailControlsOptions = {},
  ) {
    this.aisles = this.buildAisles(segments);
    this.topY = this.computeTopY(segments);

    this.opts = {
      eyeHeight: options.eyeHeight ?? 1700,
      moveSpeed: options.moveSpeed ?? 6000,
      verticalSpeed: options.verticalSpeed ?? 4000,
      keyYawSpeed: options.keyYawSpeed ?? 1.6,
      dragLookSpeed: options.dragLookSpeed ?? 0.005,
      wheelSpeed: options.wheelSpeed ?? 1500,
      minHeight: options.minHeight ?? 200,
      maxHeight: options.maxHeight ?? this.topY,
      minPitch: options.minPitch ?? -Math.PI / 2.1,
      maxPitch: options.maxPitch ?? Math.PI / 2.1,
    };
    this.height = this.opts.eyeHeight;

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
  }

  // Reduce each AISLE box to its centerline. Mapping matches WarehouseScene:
  // Three X <- segment X, Three Z <- segment Y. Long footprint axis = travel dir.
  private buildAisles(segments: Segment[]): Aisle[] {
    const out: Aisle[] = [];
    for (const s of segments) {
      if (s.type !== 'AISLE') continue;
      const cx = s.coordinateX + s.dimensionX / 2; // Three X center
      const cz = s.coordinateY + s.dimensionY / 2; // Three Z center
      let start: THREE.Vector3;
      let end: THREE.Vector3;
      if (s.dimensionX >= s.dimensionY) {
        start = new THREE.Vector3(s.coordinateX, 0, cz);
        end = new THREE.Vector3(s.coordinateX + s.dimensionX, 0, cz);
      } else {
        start = new THREE.Vector3(cx, 0, s.coordinateY);
        end = new THREE.Vector3(cx, 0, s.coordinateY + s.dimensionY);
      }
      const dir = end.clone().sub(start);
      const length = dir.length();
      if (length < 1) continue;
      dir.normalize();
      out.push({ name: s.fullName, start, end, dir, length });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return out;
  }

  // Tallest point of the model: segment Z is Three's up axis.
  private computeTopY(segments: Segment[]): number {
    let top = 0;
    for (const s of segments) top = Math.max(top, s.coordinateZ + s.dimensionZ);
    return top;
  }

  enable() {
    if (this.enabled || this.aisles.length === 0) return;
    this.enabled = true;
    this.height = this.opts.eyeHeight;
    this.setAisle(this.nearestAisle(), true);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.dom.addEventListener('wheel', this.onWheel, { passive: false });
    this.dom.style.cursor = 'grab';
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.style.cursor = '';
    this.keys = { fwd: false, back: false, left: false, right: false, up: false, down: false };
    this.dragging = false;
  }

  dispose() {
    this.disable();
  }

  get aisleNames(): string[] {
    return this.aisles.map((a) => a.name);
  }

  setAisle(index: number, faceForward = true) {
    if (this.aisles.length === 0) return;
    const n = this.aisles.length;
    this.index = ((index % n) + n) % n;
    const a = this.aisles[this.index];
    this.dist = 0; // drop in at the start of the aisle, beside the first rack
    if (faceForward) {
      this.yaw = Math.atan2(-a.dir.x, -a.dir.z); // face down the aisle toward 'end'
      this.pitch = 0;
    }
    this.onChange?.({ index: this.index, name: a.name, total: n });
  }

  nextAisle() {
    this.setAisle(this.index + 1);
  }

  prevAisle() {
    this.setAisle(this.index - 1);
  }

  private nearestAisle(): number {
    const p = this.camera.position;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.aisles.length; i++) {
      const a = this.aisles[i];
      const mid = a.start.clone().addScaledVector(a.dir, a.length / 2);
      const d = mid.distanceToSquared(p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private onKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.fwd = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.back = true;
        break;
      case 'KeyA':
        this.keys.left = true;
        break;
      case 'KeyD':
        this.keys.right = true;
        break;
      case 'KeyE':
      case 'PageUp':
        this.keys.up = true;
        break;
      case 'KeyQ':
      case 'PageDown':
        this.keys.down = true;
        break;
      case 'ArrowLeft':
        this.prevAisle();
        break;
      case 'ArrowRight':
        this.nextAisle();
        break;
      default:
        return;
    }
    if (e.code.startsWith('Arrow') || e.code === 'PageUp' || e.code === 'PageDown') {
      e.preventDefault();
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.fwd = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.back = false;
        break;
      case 'KeyA':
        this.keys.left = false;
        break;
      case 'KeyD':
        this.keys.right = false;
        break;
      case 'KeyE':
      case 'PageUp':
        this.keys.up = false;
        break;
      case 'KeyQ':
      case 'PageDown':
        this.keys.down = false;
        break;
    }
  }

  private onPointerDown(e: PointerEvent) {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.dom.style.cursor = 'grabbing';
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Grab-the-world drag, matching OrbitControls in the overview mode: dragging
    // moves the scene WITH the cursor (drag right -> scene swings right, drag
    // down -> scene tilts down), the same convention as Google Street View.
    // The previous FPS-style look (yaw -= dx) turned the opposite way from the
    // orbit view, so the drag direction flipped the moment you entered the
    // walkthrough — the contradictory behaviour reported on the exhibition demo.
    this.yaw += dx * this.opts.dragLookSpeed;
    this.pitch += dy * this.opts.dragLookSpeed;
    this.pitch = clamp(this.pitch, this.opts.minPitch, this.opts.maxPitch);
  }

  private onPointerUp() {
    this.dragging = false;
    this.dom.style.cursor = 'grab';
  }

  private onWheel(e: WheelEvent) {
    // Swallow the wheel event so the browser doesn't scroll/zoom the page, but
    // don't glide along the aisle — scroll is intentionally inert inside a walk.
    e.preventDefault();
    // const a = this.aisles[this.index];
    // this.dist = clamp(this.dist + Math.sign(e.deltaY) * this.opts.wheelSpeed, 0, a.length);
  }

  // Call once per frame from the render loop.
  update(dt: number) {
    if (!this.enabled || this.aisles.length === 0) return;
    const a = this.aisles[this.index];

    if (this.keys.left) this.yaw += this.opts.keyYawSpeed * dt;
    if (this.keys.right) this.yaw -= this.opts.keyYawSpeed * dt;

    // Forward / back glides along the rail, in whichever direction we face.
    let move = 0;
    if (this.keys.fwd) move += 1;
    if (this.keys.back) move -= 1;
    if (move !== 0) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const along = forward.dot(a.dir);
      const sign = Math.abs(along) < 0.1 ? 1 : Math.sign(along);
      this.dist = clamp(this.dist + move * sign * this.opts.moveSpeed * dt, 0, a.length);
    }

    // Up / down rides straight up the aisle to inspect higher levels.
    let lift = 0;
    if (this.keys.up) lift += 1;
    if (this.keys.down) lift -= 1;
    if (lift !== 0) {
      this.height = clamp(
        this.height + lift * this.opts.verticalSpeed * dt,
        this.opts.minHeight,
        this.opts.maxHeight,
      );
    }

    const pos = a.start.clone().addScaledVector(a.dir, this.dist);
    pos.y = this.height;
    this.camera.position.copy(pos);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }
}