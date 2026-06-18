import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Hex } from '@eldorado/core';

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

/**
 * A flat hexagon mesh (in the XZ plane) subdivided for wave animation, aligned
 * to the same orientation as the board's hex prisms.
 */
function hexWaterGeometry(radius: number, n: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  const map = new Map<string, number>();
  const corners: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    corners.push([radius * Math.sin((i * Math.PI) / 3), radius * Math.cos((i * Math.PI) / 3)]);
  }
  const addV = (x: number, z: number): number => {
    const k = `${x.toFixed(4)},${z.toFixed(4)}`;
    let idx = map.get(k);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(x, 0, z);
      map.set(k, idx);
    }
    return idx;
  };
  for (let s = 0; s < 6; s++) {
    const p1 = corners[s];
    const p2 = corners[(s + 1) % 6];
    const grid: number[][] = [];
    for (let i = 0; i <= n; i++) {
      grid[i] = [];
      for (let j = 0; j <= n - i; j++) {
        const x = (i / n) * p1[0] + (j / n) * p2[0];
        const z = (i / n) * p1[1] + (j / n) * p2[1];
        grid[i][j] = addV(x, z);
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        index.push(grid[i][j], grid[i][j + 1], grid[i + 1][j]);
        if (j < n - 1 - i) index.push(grid[i + 1][j], grid[i][j + 1], grid[i + 1][j + 1]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** All per-terrain 3D props + animated effects, kept in one group. */
export class Decorations {
  readonly group = new THREE.Group();
  private waterGeo: THREE.BufferGeometry | null = null;
  private waterBase: Float32Array | null = null;
  private fires: { light: THREE.PointLight; base: number; phase: number }[] = [];
  private glows: THREE.Mesh[] = [];

  build(placed: Placed[]): void {
    this.group.clear();
    this.waterGeo = null;
    this.fires = [];
    this.glows = [];

    const trees: THREE.Matrix4[] = [];
    const huts: THREE.Matrix4[] = [];
    const rocks: THREE.Matrix4[] = [];
    const water: Placed[] = [];
    const dummy = new THREE.Object3D();

    for (const p of placed) {
      const rand = rng((p.hex.q * 73856093) ^ (p.hex.r * 19349663));
      switch (p.hex.terrain) {
        case 'green': {
          const n = 2 + Math.floor(rand() * 2);
          for (let i = 0; i < n; i++) {
            dummy.position.set(p.x + (rand() - 0.5) * 1.0, p.top, p.z + (rand() - 0.5) * 1.0);
            dummy.rotation.set(0, rand() * Math.PI * 2, 0);
            dummy.scale.setScalar(0.7 + rand() * 0.5);
            dummy.updateMatrix();
            trees.push(dummy.matrix.clone());
          }
          break;
        }
        case 'yellow': {
          dummy.position.set(p.x + (rand() - 0.5) * 0.4, p.top, p.z + (rand() - 0.5) * 0.4);
          dummy.rotation.set(0, rand() * Math.PI * 2, 0);
          dummy.scale.setScalar(0.85 + rand() * 0.4);
          dummy.updateMatrix();
          huts.push(dummy.matrix.clone());
          break;
        }
        case 'rubble': {
          const n = 3 + Math.floor(rand() * 2);
          for (let i = 0; i < n; i++) {
            dummy.position.set(p.x + (rand() - 0.5) * 1.1, p.top + 0.05, p.z + (rand() - 0.5) * 1.1);
            dummy.rotation.set(rand() * 3, rand() * 6, rand() * 3);
            dummy.scale.setScalar(0.5 + rand() * 0.8);
            dummy.updateMatrix();
            rocks.push(dummy.matrix.clone());
          }
          break;
        }
        case 'blue':
          water.push(p);
          break;
        case 'mountain':
          this.addMountain(p);
          break;
        case 'basecamp':
          this.addCamp(p, rand);
          break;
        case 'finish':
          this.addBeacon(p);
          break;
        case 'start':
          this.addFlag(p);
          break;
      }
    }

    this.addInstances(treeGeometry(), trees);
    this.addInstances(hutGeometry(), huts);
    this.addInstances(paint(new THREE.IcosahedronGeometry(0.16, 0), 0x8d939d), rocks);
    if (water.length) this.addWater(water);
  }

  private addInstances(geo: THREE.BufferGeometry, mats: THREE.Matrix4[]): void {
    if (!mats.length) return;
    const inst = new THREE.InstancedMesh(geo, VERTEX_MAT(), mats.length);
    mats.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  private addMountain(p: Placed): void {
    const peak = new THREE.Mesh(
      new THREE.ConeGeometry(0.92, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4c, roughness: 1, flatShading: true }),
    );
    peak.position.set(p.x, p.top + 0.75, p.z);
    const snow = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.45, 6),
      new THREE.MeshStandardMaterial({ color: 0xeef2f8, roughness: 0.8, flatShading: true }),
    );
    snow.position.set(p.x, p.top + 1.3, p.z);
    this.group.add(peak, snow);
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

  private addWater(water: Placed[]): void {
    const geo = hexWaterGeometry(0.92, 4);
    this.waterGeo = geo;
    this.waterBase = (geo.attributes.position.array as Float32Array).slice();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f7fc0,
      transparent: true,
      opacity: 0.88,
      roughness: 0.2,
      metalness: 0.2,
      side: THREE.DoubleSide,
    });
    const inst = new THREE.InstancedMesh(geo, mat, water.length);
    const dummy = new THREE.Object3D();
    water.forEach((p, i) => {
      dummy.position.set(p.x, p.top + 0.04, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  /** Advance time-based effects: waves, campfire flicker, beacon pulse. */
  update(t: number): void {
    if (this.waterGeo && this.waterBase) {
      const pos = this.waterGeo.attributes.position;
      const base = this.waterBase;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const z = base[i * 3 + 2];
        const y = Math.sin(x * 2.4 + t * 1.7) * 0.05 + Math.cos(z * 2.0 + t * 1.3) * 0.05;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      this.waterGeo.computeVertexNormals();
    }
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
