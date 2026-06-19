import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Hex } from '@eldorado/core';
import { terrainTexture } from './textures.js';

/** A hex positioned in world space, with the height of its top face. */
export interface Placed {
  hex: Hex;
  x: number;
  z: number;
  top: number;
}

function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tag a geometry with a single vertex colour so merged meshes can be multi-coloured. */
function paint(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function treeGeometry(): THREE.BufferGeometry {
  const trunk = paint(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5).translate(0, 0.15, 0), 0x6b4a2a);
  const f1 = paint(new THREE.ConeGeometry(0.23, 0.5, 7).translate(0, 0.5, 0), 0x2f7a45);
  const f2 = paint(new THREE.ConeGeometry(0.16, 0.38, 7).translate(0, 0.78, 0), 0x3fa65a);
  return mergeGeometries([trunk, f1, f2])!;
}

function hutGeometry(): THREE.BufferGeometry {
  const walls = paint(new THREE.BoxGeometry(0.32, 0.22, 0.32).translate(0, 0.11, 0), 0xcaa46a);
  const roof = paint(new THREE.ConeGeometry(0.3, 0.22, 4).rotateY(Math.PI / 4).translate(0, 0.33, 0), 0x8a4b32);
  return mergeGeometries([walls, roof])!;
}

const VERTEX_MAT = () =>
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });

const MOUNTAIN_BOULDER_GEO = new THREE.DodecahedronGeometry(0.34, 1);
let mountainMat: THREE.MeshStandardMaterial | null = null;

function mountainMaterial(): THREE.MeshStandardMaterial {
  if (!mountainMat) {
    mountainMat = new THREE.MeshStandardMaterial({
      map: terrainTexture('mountain'),
      color: 0xb8bec4,
      roughness: 0.96,
      metalness: 0,
    });
  }
  return mountainMat;
}

function hexBoundaryRadius(angle: number, radius: number): number {
  const sector = Math.PI / 3;
  const a = ((((angle + sector / 2) % sector) + sector) % sector) - sector / 2;
  return (radius * Math.cos(Math.PI / 6)) / Math.cos(a);
}

function mountainGeometry(rand: () => number): THREE.BufferGeometry {
  const radius = 0.92;
  const segments = 30;
  const rings = 7;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ridge = rand() * Math.PI;
  const ridges = [
    { x: (rand() - 0.5) * 0.18, z: (rand() - 0.5) * 0.18, h: 0.78 + rand() * 0.16, sx: 0.72, sz: 0.46 },
    { x: (rand() - 0.5) * 0.48, z: (rand() - 0.5) * 0.48, h: 0.5 + rand() * 0.14, sx: 0.55, sz: 0.38 },
    { x: (rand() - 0.5) * 0.62, z: (rand() - 0.5) * 0.62, h: 0.36 + rand() * 0.12, sx: 0.46, sz: 0.4 },
  ];

  const heightAt = (x: number, z: number, r: number): number => {
    if (r > 0.98) return 0;
    const edgeFade = Math.max(0, 1 - Math.pow(r, 2.4));
    const taper = Math.pow(edgeFade, 0.78);
    const cr = Math.cos(ridge);
    const sr = Math.sin(ridge);
    let h = 0.1 * taper;
    for (const p of ridges) {
      const dx = x - p.x;
      const dz = z - p.z;
      const rx = dx * cr - dz * sr;
      const rz = dx * sr + dz * cr;
      const d = (rx * rx) / (p.sx * p.sx) + (rz * rz) / (p.sz * p.sz);
      h += p.h * Math.exp(-d * 0.72) * taper;
    }
    h += (Math.sin((x * cr + z * sr) * 7.2) * 0.035 + Math.sin((x * sr - z * cr) * 5.4) * 0.025) * taper;
    h += (rand() - 0.5) * 0.045 * taper;
    const softened = h > 0.52 ? 0.52 + (h - 0.52) * 0.42 : h;
    return Math.max(0, Math.min(softened, 0.82));
  };

  positions.push(0, heightAt(0, 0, 0) * 0.94, 0);
  uvs.push(0.5, 0.5);

  for (let ri = 1; ri <= rings; ri++) {
    const r = ri / rings;
    for (let si = 0; si < segments; si++) {
      const a = (si / segments) * Math.PI * 2;
      const br = hexBoundaryRadius(a, radius) * r;
      const x = Math.sin(a) * br;
      const z = Math.cos(a) * br;
      positions.push(x, heightAt(x, z, r), z);
      uvs.push(0.5 + x / (radius * 2), 0.5 + z / (radius * 2));
    }
  }

  for (let si = 0; si < segments; si++) {
    const a = 1 + si;
    const b = 1 + ((si + 1) % segments);
    indices.push(0, a, b);
  }
  for (let ri = 1; ri < rings; ri++) {
    const prev = 1 + (ri - 1) * segments;
    const curr = 1 + ri * segments;
    for (let si = 0; si < segments; si++) {
      const ni = (si + 1) % segments;
      indices.push(prev + si, curr + si, prev + ni);
      indices.push(prev + ni, curr + si, curr + ni);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** All per-terrain 3D props + effects, kept in one group. */
export class Decorations {
  readonly group = new THREE.Group();
  private fires: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private glows: THREE.Mesh[] = [];

  build(placed: Placed[]): void {
    this.group.clear();
    this.fires = [];
    this.glows = [];

    const trees: THREE.Matrix4[] = [];
    const huts: THREE.Matrix4[] = [];
    const rocks: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    for (const p of placed) {
      const rand = rng((p.hex.q * 73856093) ^ (p.hex.r * 19349663));
      switch (p.hex.terrain) {
        case 'green': {
          // The realistic top texture now carries the jungle detail. Avoid
          // low-poly cone trees on every cell, which read too cartoon-like.
          break;
        }
        case 'yellow': {
          // Same for village/path cells: the textured ground is clearer and
          // less toy-like than repeated low-poly huts.
          break;
        }
        case 'rubble': {
          // The realistic rubble texture carries this terrain now; avoid extra
          // rock models competing with the cost icons.
          break;
        }
        case 'blue':
          // Water detail is carried by the static terrain texture. Avoid the
          // extra transparent 3D ripple layer; it adds draw cost with little
          // visual benefit in the current render-on-demand board.
          break;
        case 'mountain':
          this.addMountain(p, rand);
          break;
        case 'basecamp':
          // Base camp is represented by its terrain texture and remove-card
          // icon. Extra tents/fire made the tile visually too busy.
          break;
        case 'finish':
          this.addBeacon(p);
          break;
        case 'eldorado':
          this.addCity(p, rand);
          break;
        case 'start':
          this.addFlag(p);
          break;
      }
    }

    this.addInstances(treeGeometry(), trees);
    this.addInstances(hutGeometry(), huts);
    this.addInstances(paint(new THREE.IcosahedronGeometry(0.16, 0), 0x8d939d), rocks);
  }

  private addInstances(geo: THREE.BufferGeometry, mats: THREE.Matrix4[]): void {
    if (!mats.length) return;
    const inst = new THREE.InstancedMesh(geo, VERTEX_MAT(), mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  private addMountain(p: Placed, rand: () => number): void {
    const group = new THREE.Group();
    const mat = mountainMaterial();
    const mountain = new THREE.Mesh(mountainGeometry(rand), mat);
    group.add(mountain);

    const count = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * 0.36;
      const boulder = new THREE.Mesh(MOUNTAIN_BOULDER_GEO, mat);
      boulder.position.set(Math.sin(a) * d, 0.22 + rand() * 0.12, Math.cos(a) * d);
      boulder.rotation.set((rand() - 0.5) * 0.35, rand() * Math.PI * 2, (rand() - 0.5) * 0.35);
      boulder.scale.set(0.9 + rand() * 0.45, 0.28 + rand() * 0.16, 0.55 + rand() * 0.32);
      group.add(boulder);
    }

    group.position.set(p.x, p.top + 0.02, p.z);
    group.rotation.y = rand() * Math.PI * 2;
    this.group.add(group);
  }

  private addCamp(p: Placed, rand: () => number): void {
    const tent = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.44, 4).rotateY(Math.PI / 4),
      new THREE.MeshStandardMaterial({ color: 0xe9ddbc, roughness: 0.9, flatShading: true }),
    );
    tent.position.set(p.x - 0.25, p.top + 0.22, p.z - 0.2);
    const fire = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.22, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8a3a }),
    );
    fire.position.set(p.x + 0.25, p.top + 0.11, p.z + 0.2);
    const light = new THREE.PointLight(0xff7a2a, 1.3, 3.5, 2);
    light.position.set(p.x + 0.25, p.top + 0.35, p.z + 0.2);
    this.fires.push({ light, base: 1.3, phase: rand() * 6.28 });
    this.group.add(tent, fire, light);
  }

  private addBeacon(p: Placed): void {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.42, 2.6, 18, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd877, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.set(p.x, p.top + 1.3, p.z);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc83a, emissiveIntensity: 1 }),
    );
    orb.position.set(p.x, p.top + 0.4, p.z);
    this.glows.push(beam, orb);
    this.group.add(beam, orb, new THREE.PointLight(0xffd877, 0.8, 4));
  }

  private addCity(p: Placed, rand: () => number): void {
    // A clutch of golden spires per cell — adjacent cells merge into a sprawling
    // El Dorado skyline beyond the gate.
    const parts: THREE.BufferGeometry[] = [];
    const n = 2 + Math.floor(rand() * 3); // 2–4 towers
    for (let i = 0; i < n; i++) {
      const w = 0.16 + rand() * 0.18;
      const h = 0.3 + rand() * 0.85;
      parts.push(new THREE.BoxGeometry(w, h, w).translate((rand() - 0.5) * 0.95, h / 2, (rand() - 0.5) * 0.95));
    }
    const geo = mergeGeometries(parts)!;
    const city = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: 0xe7c155,
        emissive: 0xb8841f,
        emissiveIntensity: 0.35,
        roughness: 0.4,
        metalness: 0.6,
        flatShading: true,
      }),
    );
    city.position.set(p.x, p.top, p.z);
    this.group.add(city);
  }

  private addFlag(p: Placed): void {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6),
      new THREE.MeshStandardMaterial({ color: 0xcfd6e2 }),
    );
    pole.position.set(p.x + 0.3, p.top + 0.3, p.z + 0.3);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x4c9bef, side: THREE.DoubleSide }),
    );
    flag.position.set(p.x + 0.43, p.top + 0.5, p.z + 0.3);
    this.group.add(pole, flag);
  }

  /** Advance time-based effects: campfire flicker, beacon pulse. */
  update(t: number): void {
    for (const f of this.fires) {
      f.light.intensity = f.base * (0.75 + 0.35 * Math.sin(t * 11 + f.phase)) + Math.sin(t * 27 + f.phase) * 0.1;
    }
    for (const g of this.glows) {
      const m = g.material as THREE.Material & { emissiveIntensity?: number; opacity: number };
      if (m.emissiveIntensity !== undefined) m.emissiveIntensity = 0.7 + 0.5 * Math.sin(t * 2.2);
      else m.opacity = 0.16 + 0.12 * (0.5 + 0.5 * Math.sin(t * 2.2));
    }
  }
}
