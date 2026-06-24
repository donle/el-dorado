/**
 * scene/geom — pure geometric utilities shared across the board renderer.
 *
 * No class state, no DOM, no Three.js object references. Each function is
 * either a coordinate key/area test (no Three.js at all) or a pure
 * geometry-builder that returns a `THREE.BufferGeometry` from its inputs.
 *
 * Pulled out of the old `board.ts` so the per-owner classes can import
 * the helpers they actually need without dragging in unrelated code.
 */
import * as THREE from 'three';
import { neighbors, type Axial, type Hex } from '@eldorado/core';
import { HEX_SIZE } from '../shared/constants.js';

// --- coordinate keys ---------------------------------------------------------

/** "q,r" key for an axial coord — used as a Map key everywhere. */
export function hexKey(c: Axial): string {
  return `${c.q},${c.r}`;
}

/** Inverse of `hexKey` — parses "q,r" back into an Axial. */
export function keyToAxial(key: string): Axial {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

/** Ordered edge key — distinguishes `a>b` from `b>a`. */
export function axialEdgeKey(a: Axial, b: Axial): string {
  return `${hexKey(a)}>${hexKey(b)}`;
}

// --- 2D polygon helpers -------------------------------------------------------

export interface XZ {
  x: number;
  z: number;
}

export interface BoundaryEdge {
  key: string;
  a: XZ;
  b: XZ;
  aKey: string;
  bKey: string;
}

export function pointKey(p: XZ): string {
  return `${Math.round(p.x * 10000)},${Math.round(p.z * 10000)}`;
}

export function edgeKey(a: string, b: string): string {
  return `${a}>${b}`;
}

export function polygonArea(points: XZ[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/** Cross-product sign — does triangle (a,b,c) face up in the XZ plane? */
export function topTriangleFacesUp(a: XZ, b: XZ, c: XZ): boolean {
  return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
}

/** Six corners of a hex centred at (x,z) on the XZ plane. */
export function hexCornerPoints(x: number, z: number): XZ[] {
  // Use the logical hex radius here, not the visual GAP radius. The terminal
  // plate is one continuous board tile, so neighbouring terminal cells must
  // share exact edges before we extract the outer outline.
  const radius = HEX_SIZE;
  const points: XZ[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    points.push({ x: x + radius * Math.sin(angle), z: z + radius * Math.cos(angle) });
  }
  return points;
}

/** Extract closed outline loops from a set of boundary edges. */
export function boundaryLoops(edges: BoundaryEdge[]): XZ[][] {
  const byKey = new Map(edges.map((e) => [e.key, e]));
  const outgoing = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.aKey) ?? [];
    list.push(edge);
    outgoing.set(edge.aKey, list);
  }

  const unused = new Set(byKey.keys());
  const loops: XZ[][] = [];
  while (unused.size) {
    const firstKey = unused.values().next().value as string;
    const first = byKey.get(firstKey);
    if (!first) break;
    unused.delete(firstKey);

    const loop: XZ[] = [first.a, first.b];
    const startKey = first.aKey;
    let currentKey = first.bKey;
    let guard = 0;
    while (currentKey !== startKey && guard++ < edges.length + 4) {
      const next = (outgoing.get(currentKey) ?? []).find((edge) => unused.has(edge.key));
      if (!next) break;
      unused.delete(next.key);
      loop.push(next.b);
      currentKey = next.bKey;
    }

    if (pointKey(loop[loop.length - 1]) === pointKey(loop[0])) loop.pop();
    loops.push(loop);
  }
  return loops;
}

interface PlacedLike {
  x: number;
  z: number;
}

/** Outer outline (largest loop) of a set of placed cells. */
export function terminalOutline(cells: PlacedLike[]): XZ[] {
  const boundary = new Map<string, BoundaryEdge>();
  for (const cell of cells) {
    const corners = hexCornerPoints(cell.x, cell.z);
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      const aKey = pointKey(a);
      const bKey = pointKey(b);
      const key = edgeKey(aKey, bKey);
      const reverse = edgeKey(bKey, aKey);
      if (boundary.has(reverse)) boundary.delete(reverse);
      else boundary.set(key, { key, a, b, aKey, bKey });
    }
  }

  const loops = boundaryLoops([...boundary.values()]).filter((loop) => loop.length >= 3);
  if (!loops.length) return [];
  return loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0];
}

// --- 3D geometry builders -----------------------------------------------------

/**
 * Extrude a polygonal loop into a 3D plate with separate top and side
 * material groups. Caller supplies the bottom-Y (`bottomY`) and top-Y
 * (`topY`); the geometry spans the slab between them.
 */
function extrudePlate(
  loop: XZ[],
  bottomY: number,
  topY: number,
): { geometry: THREE.BufferGeometry; topIndexCount: number } {
  if (loop.length < 3) return { geometry: new THREE.BufferGeometry(), topIndexCount: 0 };

  const minX = Math.min(...loop.map((p) => p.x));
  const maxX = Math.max(...loop.map((p) => p.x));
  const minZ = Math.min(...loop.map((p) => p.z));
  const maxZ = Math.max(...loop.map((p) => p.z));
  const spanX = Math.max(maxX - minX, 0.001);
  const spanZ = Math.max(maxZ - minZ, 0.001);

  const positions: number[] = [];
  const uvs: number[] = [];
  for (const p of loop) {
    positions.push(p.x, topY, p.z);
    uvs.push((p.x - minX) / spanX, (p.z - minZ) / spanZ);
  }
  for (const p of loop) {
    positions.push(p.x, bottomY, p.z);
    uvs.push((p.x - minX) / spanX, 0);
  }

  const contour = loop.map((p) => new THREE.Vector2(p.x, p.z));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const indices: number[] = [];
  for (const [a, b, c] of triangles) {
    if (topTriangleFacesUp(loop[a], loop[b], loop[c])) indices.push(a, b, c);
    else indices.push(a, c, b);
  }
  const topIndexCount = indices.length;

  const bottomOffset = loop.length;
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    indices.push(i, bottomOffset + i, j, j, bottomOffset + i, bottomOffset + j);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, topIndexCount, 0);
  geometry.addGroup(topIndexCount, indices.length - topIndexCount, 1);
  geometry.computeVertexNormals();
  return { geometry, topIndexCount };
}

export function terminalPlateGeometry(cells: PlacedLike[], height: number): THREE.BufferGeometry {
  const loop = terminalOutline(cells);
  return extrudePlate(loop, 0, height).geometry;
}

/** Left+right outline offset from `path` by ±width/2. */
export function stripOutline(path: XZ[], width: number): XZ[] {
  const half = width / 2;
  const left: XZ[] = [];
  const right: XZ[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(path.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    left.push({ x: path[i].x + nx * half, z: path[i].z + nz * half });
    right.push({ x: path[i].x - nx * half, z: path[i].z - nz * half });
  }
  return [...left, ...right.reverse()];
}

export function blockadePlateGeometry(path: XZ[], width: number, topY: number, height: number): THREE.BufferGeometry {
  return extrudePlate(stripOutline(path, width), topY - height, topY).geometry;
}

export function blockadeTopGeometry(path: XZ[], width: number, topY: number): THREE.BufferGeometry {
  const loop = stripOutline(path, width);
  if (loop.length < 3) return new THREE.BufferGeometry();

  const minX = Math.min(...loop.map((p) => p.x));
  const maxX = Math.max(...loop.map((p) => p.x));
  const minZ = Math.min(...loop.map((p) => p.z));
  const maxZ = Math.max(...loop.map((p) => p.z));
  const spanX = Math.max(maxX - minX, 0.001);
  const spanZ = Math.max(maxZ - minZ, 0.001);

  const positions: number[] = [];
  const uvs: number[] = [];
  for (const p of loop) {
    positions.push(p.x, topY, p.z);
    uvs.push((p.x - minX) / spanX, (p.z - minZ) / spanZ);
  }

  const contour = loop.map((p) => new THREE.Vector2(p.x, p.z));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const indices: number[] = [];
  for (const [a, b, c] of triangles) {
    if (topTriangleFacesUp(loop[a], loop[b], loop[c])) indices.push(a, b, c);
    else indices.push(a, c, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function blockadeBandGeometry(path: XZ[], outerWidth: number, innerWidth: number, topY: number): THREE.BufferGeometry {
  const outer = stripOutline(path, outerWidth);
  const inner = stripOutline(path, innerWidth);
  if (outer.length < 3 || outer.length !== inner.length) return new THREE.BufferGeometry();

  const positions: number[] = [];
  const uvs: number[] = [];
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i];
    positions.push(p.x, topY, p.z);
    uvs.push(i / outer.length, 1);
  }
  for (let i = 0; i < inner.length; i++) {
    const p = inner[i];
    positions.push(p.x, topY, p.z);
    uvs.push(i / inner.length, 0);
  }

  const innerOffset = outer.length;
  const indices: number[] = [];
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    indices.push(i, j, innerOffset + j, i, innerOffset + j, innerOffset + i);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function blockadeRimGeometry(path: XZ[], width: number, topY: number): THREE.BufferGeometry {
  const loop = stripOutline(path, width);
  if (loop.length < 2) return new THREE.BufferGeometry();
  const points = loop.map((p) => new THREE.Vector3(p.x, topY, p.z));
  points.push(points[0].clone());
  return new THREE.BufferGeometry().setFromPoints(points);
}

/** A flat hexagonal ring band in the XZ plane, aligned to the hex prisms. */
export function hexRingGeometry(inner: number, outer: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    pos.push(outer * Math.sin(a), 0, outer * Math.cos(a)); // outer i → 2i
    pos.push(inner * Math.sin(a), 0, inner * Math.cos(a)); // inner i → 2i+1
  }
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    const o0 = 2 * i, in0 = 2 * i + 1, o1 = 2 * j, in1 = 2 * j + 1;
    idx.push(o0, o1, in0, in0, o1, in1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- game-specific selectors --------------------------------------------------

/**
 * Filter and tag the hexes that should be rendered as the "terminal" (Eldorado
 * finish entrance + final plateau). Returns the visible subset and the set of
 * hexes that should get the glowing gold plate.
 */
export interface TerminalVisibility {
  hexes: Hex[];
  terminalKeys: Set<string>;
}

export function visibleTerminalHexes(hexes: Hex[]): TerminalVisibility {
  const finishKeys = new Set(hexes.filter((hex) => hex.finishEntrance || hex.terrain === 'finish').map(hexKey));
  const hasEldorado = hexes.some((hex) => hex.terrain === 'eldorado');
  if (!hasEldorado) return { hexes, terminalKeys: new Set() };

  const terminalKeys = new Set<string>();
  const visibleEldoradoKeys = new Set<string>();
  for (const hex of hexes) {
    const k = hexKey(hex);
    if (hex.terrain !== 'eldorado') continue;
    if (neighbors(hex).some((n) => finishKeys.has(hexKey(n)))) {
      visibleEldoradoKeys.add(k);
      terminalKeys.add(k);
    }
  }

  return {
    hexes: hexes.filter((hex) => hex.terrain !== 'eldorado' || visibleEldoradoKeys.has(hexKey(hex))),
    terminalKeys,
  };
}