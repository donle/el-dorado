/**
 * Axial hex-grid helpers (pointy-top, odd-r offset for authoring).
 * See https://www.redblobgames.com/grids/hexagons/
 */
import type { Axial } from './types.js';

const DIRECTIONS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function key(a: Axial): string {
  return `${a.q},${a.r}`;
}

export function equals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function neighbors(a: Axial): Axial[] {
  return DIRECTIONS.map((d) => ({ q: a.q + d.q, r: a.r + d.r }));
}

export function isAdjacent(a: Axial, b: Axial): boolean {
  return neighbors(a).some((n) => equals(n, b));
}

/** Cube distance between two axial hexes. */
export function distance(a: Axial, b: Axial): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}

/** Convert odd-r offset (row, col) to axial — used by the map authoring DSL. */
export function offsetToAxial(row: number, col: number): Axial {
  const q = col - (row - (row & 1)) / 2;
  return { q, r: row };
}

/** Convert axial to pixel center for pointy-top layout (size = hex radius). */
export function axialToPixel(a: Axial, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (a.q + a.r / 2);
  const y = size * (3 / 2) * a.r;
  return { x, y };
}
