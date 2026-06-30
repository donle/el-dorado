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
let caveMouthGeo: THREE.ShapeGeometry | null = null;
let caveGlowGeo: THREE.ShapeGeometry | null = null;
let caveFrameGeo: THREE.ExtrudeGeometry | null = null;
let caveHaloGeo: THREE.PlaneGeometry | null = null;
let caveHaloTex: THREE.CanvasTexture | null = null;
let caveGlowMat: THREE.MeshBasicMaterial | null = null;
let caveHaloMat: THREE.MeshBasicMaterial | null = null;
let caveFrameMat: THREE.MeshStandardMaterial | null = null;

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

function caveFrameMaterial(): THREE.MeshStandardMaterial {
  if (!caveFrameMat) {
    caveFrameMat = new THREE.MeshStandardMaterial({
      color: 0x555c5d,
      emissive: 0x231407,
      emissiveIntensity: 0.04,
      roughness: 0.96,
      metalness: 0.02,
      flatShading: true,
    });
  }
  return caveFrameMat;
}

function archedPath(width: number, height: number): THREE.Path {
  const sideH = height * 0.42;
  const halfW = width / 2;
  const baseY = -height / 2;
  const shoulderY = baseY + sideH;
  const path = new THREE.Path();
  path.moveTo(-halfW, baseY);
  path.lineTo(-halfW, shoulderY);
  path.quadraticCurveTo(-halfW * 0.86, height * 0.5, 0, height * 0.5);
  path.quadraticCurveTo(halfW * 0.86, height * 0.5, halfW, shoulderY);
  path.lineTo(halfW, baseY);
  path.lineTo(-halfW, baseY);
  return path;
}

function archedShapeGeometry(width: number, height: number): THREE.ShapeGeometry {
  return new THREE.ShapeGeometry(new THREE.Shape(archedPath(width, height).getPoints(22)), 18);
}

function archedFrameGeometry(outerWidth: number, outerHeight: number, innerWidth: number, innerHeight: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape(archedPath(outerWidth, outerHeight).getPoints(30));
  shape.holes.push(archedPath(innerWidth, innerHeight));
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelSize: 0.025,
    bevelThickness: 0.02,
    bevelSegments: 1,
    curveSegments: 2,
  });
}

function caveMouthGeometry(): THREE.ShapeGeometry {
  if (!caveMouthGeo) caveMouthGeo = archedShapeGeometry(0.58, 0.44);
  return caveMouthGeo;
}

function caveInnerGlowGeometry(): THREE.ShapeGeometry {
  if (!caveGlowGeo) caveGlowGeo = archedShapeGeometry(0.44, 0.3);
  return caveGlowGeo;
}

function caveFrameGeometry(): THREE.ExtrudeGeometry {
  if (!caveFrameGeo) caveFrameGeo = archedFrameGeometry(0.88, 0.68, 0.58, 0.44);
  return caveFrameGeo;
}

function caveHaloGeometry(): THREE.PlaneGeometry {
  if (!caveHaloGeo) caveHaloGeo = new THREE.PlaneGeometry(1.08, 0.8);
  return caveHaloGeo;
}

function caveHaloTexture(): THREE.CanvasTexture {
  if (caveHaloTex) return caveHaloTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 72, 5, 64, 72, 58);
  g.addColorStop(0, 'rgba(255,220,145,0.95)');
  g.addColorStop(0.28, 'rgba(255,190,90,0.52)');
  g.addColorStop(0.58, 'rgba(110,230,220,0.22)');
  g.addColorStop(1, 'rgba(110,230,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  caveHaloTex = new THREE.CanvasTexture(canvas);
  caveHaloTex.colorSpace = THREE.SRGBColorSpace;
  caveHaloTex.generateMipmaps = false;
  caveHaloTex.minFilter = THREE.LinearFilter;
  caveHaloTex.magFilter = THREE.LinearFilter;
  return caveHaloTex;
}

function caveHaloMaterial(): THREE.MeshBasicMaterial {
  if (!caveHaloMat) {
    caveHaloMat = new THREE.MeshBasicMaterial({
      map: caveHaloTexture(),
      color: 0xffffff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
  }
  return caveHaloMat;
}

function caveInnerGlowMaterial(): THREE.MeshBasicMaterial {
  if (!caveGlowMat) {
    caveGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffd088,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  return caveGlowMat;
}

function hexBoundaryRadius(angle: number, radius: number): number {
  const sector = Math.PI / 3;
  const a = ((((angle + sector / 2) % sector) + sector) % sector) - sector / 2;
  return (radius * Math.cos(Math.PI / 6)) / Math.cos(a);
}

function caveCutInfluence(x: number, z: number): number {
  const mouth = Math.exp(-((x * x) / (0.5 * 0.5) + ((z - 0.6) * (z - 0.6)) / (0.36 * 0.36)));
  const throat = Math.exp(-((x * x) / (0.34 * 0.34) + ((z - 0.82) * (z - 0.82)) / (0.2 * 0.2)));
  const frontGate = THREE.MathUtils.smoothstep(z, 0.04, 0.7);
  return Math.min(1, (mouth * 1.05 + throat * 1.25) * frontGate);
}

function mountainGeometry(rand: () => number, cave = false): THREE.BufferGeometry {
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
    let softened = h > 0.52 ? 0.52 + (h - 0.52) * 0.42 : h;
    if (cave) {
      const cut = caveCutInfluence(x, z);
      if (cut > 0.02) {
        const sideLift = Math.min(1, Math.abs(x) / 0.46);
        const carvedFloor = 0.025 + sideLift * 0.24 + Math.max(0, 0.52 - z) * 0.05;
        softened = THREE.MathUtils.lerp(softened, Math.min(softened, carvedFloor), cut * 0.95);
        softened -= 0.28 * cut * (1 - sideLift);
      }
    }
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
  private glows: { mesh: THREE.Mesh; base: number; amp: number; phase: number }[] = [];

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
          // Cave hexes keep the mountain terrain top and get a carved,
          // glowing cave mouth set into the front slope.
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
    const isCave = !!p.hex.cave;
    const mountain = new THREE.Mesh(mountainGeometry(rand, isCave), mat);
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
    group.rotation.y = isCave ? 0 : rand() * Math.PI * 2;
    if (isCave) group.add(this.buildCaveMouth(rand));
    this.group.add(group);
  }

  private buildCaveMouth(rand: () => number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(0, 0.28, 0.58);
    group.rotation.x = -0.54;

    const halo = new THREE.Mesh(caveHaloGeometry(), caveHaloMaterial());
    halo.position.set(0, -0.1, 0.018);
    halo.renderOrder = 1.01;
    this.glows.push({ mesh: halo, base: 0.28, amp: 0.08, phase: rand() * 6.28 });
    group.add(halo);

    const mouth = new THREE.Mesh(
      caveMouthGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x020304,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        side: THREE.DoubleSide,
      }),
    );
    mouth.position.z = 0.05;
    mouth.renderOrder = 1.08;
    group.add(mouth);

    const glowFace = new THREE.Mesh(caveInnerGlowGeometry(), caveInnerGlowMaterial());
    glowFace.position.set(0, -0.18, 0.065);
    glowFace.scale.set(0.72, 0.45, 1);
    glowFace.renderOrder = 1.09;
    this.glows.push({ mesh: glowFace, base: 0.46, amp: 0.12, phase: rand() * 6.28 });
    group.add(glowFace);

    const rimMat = caveFrameMaterial();
    const frame = new THREE.Mesh(caveFrameGeometry(), rimMat);
    frame.position.set(0, 0, 0.055);
    frame.renderOrder = 1.12;
    group.add(frame);

    const chipPoints = [
      [-0.46, -0.28, 0.12, 0.09, 0.06],
      [-0.48, -0.1, 0.11, 0.14, 0.07],
      [-0.39, 0.08, 0.1, 0.14, 0.07],
      [-0.27, 0.24, 0.12, 0.09, 0.06],
      [-0.08, 0.32, 0.13, 0.08, 0.06],
      [0.11, 0.32, 0.13, 0.08, 0.06],
      [0.29, 0.23, 0.12, 0.09, 0.06],
      [0.4, 0.07, 0.1, 0.14, 0.07],
      [0.48, -0.12, 0.11, 0.14, 0.07],
      [0.46, -0.29, 0.12, 0.09, 0.06],
      [-0.24, -0.37, 0.15, 0.055, 0.055],
      [0.02, -0.39, 0.17, 0.055, 0.055],
      [0.27, -0.36, 0.15, 0.055, 0.055],
    ] as const;
    for (const [x, y, sx, sy, sz] of chipPoints) {
      const rock = new THREE.Mesh(MOUNTAIN_BOULDER_GEO, caveFrameMaterial());
      rock.position.set(
        x + (rand() - 0.5) * 0.02,
        y + (rand() - 0.5) * 0.02,
        0.22 + rand() * 0.025,
      );
      rock.scale.set(sx, sy, sz);
      rock.rotation.set((rand() - 0.5) * 0.45, rand() * Math.PI * 2, (rand() - 0.5) * 0.45);
      rock.renderOrder = 1.16;
      group.add(rock);
    }

    const glow = new THREE.PointLight(0xffcf75, 2.6, 3.2, 1.6);
    glow.position.set(0, -0.16, 0.3);
    this.fires.push({ light: glow, base: 2.6, phase: rand() * 6.28 });
    group.add(glow);
    return group;
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
    this.glows.push(
      { mesh: beam, base: 0.22, amp: 0.12, phase: 0 },
      { mesh: orb, base: 0.7, amp: 0.5, phase: 0 },
    );
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
  update(t: number): boolean {
    for (const f of this.fires) {
      f.light.intensity = f.base * (0.75 + 0.35 * Math.sin(t * 11 + f.phase)) + Math.sin(t * 27 + f.phase) * 0.1;
    }
    for (const g of this.glows) {
      const m = g.mesh.material as THREE.Material & { emissiveIntensity?: number; opacity: number };
      const pulse = g.base + g.amp * (0.5 + 0.5 * Math.sin(t * 2.2 + g.phase));
      if (m.emissiveIntensity !== undefined) m.emissiveIntensity = pulse;
      else m.opacity = pulse;
    }
    return this.fires.length > 0 || this.glows.length > 0;
  }
}
