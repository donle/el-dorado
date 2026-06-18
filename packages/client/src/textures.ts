import * as THREE from 'three';
import type { Terrain } from '@eldorado/core';

/**
 * Procedurally generated terrain textures — drawn on a canvas at runtime, so
 * there are no external/copyrighted image assets. Cached per terrain type.
 */
const cache = new Map<Terrain, THREE.Texture>();

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZE = 128;

function base(ctx: CanvasRenderingContext2D, a: string, b: string) {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

function speckle(ctx: CanvasRenderingContext2D, rnd: () => number, color: string, n: number, r: number) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = rnd() * SIZE;
    const y = rnd() * SIZE;
    const rr = r * (0.5 + rnd());
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw(terrain: Terrain): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry(terrain.length * 9173 + terrain.charCodeAt(0) * 131);

  switch (terrain) {
    case 'green': {
      base(ctx, '#3f9457', '#2f7a45');
      speckle(ctx, rnd, 'rgba(28,92,52,0.55)', 26, 7); // leafy clumps
      speckle(ctx, rnd, 'rgba(120,200,130,0.35)', 18, 4);
      break;
    }
    case 'blue': {
      base(ctx, '#3a86c8', '#2766a8');
      ctx.strokeStyle = 'rgba(180,220,255,0.45)';
      ctx.lineWidth = 2;
      for (let y = 10; y < SIZE; y += 16) {
        ctx.beginPath();
        for (let x = 0; x <= SIZE; x += 8) ctx.lineTo(x, y + Math.sin((x + y) * 0.15) * 4);
        ctx.stroke();
      }
      break;
    }
    case 'yellow': {
      base(ctx, '#e0bd58', '#cba63f');
      speckle(ctx, rnd, 'rgba(160,120,40,0.4)', 40, 3); // sandy grain
      // a couple of little "huts"
      ctx.fillStyle = 'rgba(120,80,40,0.6)';
      for (let i = 0; i < 3; i++) {
        const x = 24 + rnd() * 80;
        const y = 24 + rnd() * 80;
        ctx.fillRect(x, y, 12, 9);
        ctx.beginPath();
        ctx.moveTo(x - 2, y);
        ctx.lineTo(x + 6, y - 8);
        ctx.lineTo(x + 14, y);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'rubble': {
      base(ctx, '#9aa0aa', '#7f8590');
      speckle(ctx, rnd, 'rgba(60,64,72,0.6)', 34, 6); // rocks
      speckle(ctx, rnd, 'rgba(210,214,220,0.5)', 20, 3);
      break;
    }
    case 'basecamp': {
      base(ctx, '#b6515f', '#933b48');
      // tent
      ctx.fillStyle = 'rgba(245,225,180,0.9)';
      ctx.beginPath();
      ctx.moveTo(64, 34);
      ctx.lineTo(92, 92);
      ctx.lineTo(36, 92);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,40,40,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(64, 34);
      ctx.lineTo(64, 92);
      ctx.stroke();
      break;
    }
    case 'mountain': {
      base(ctx, '#3a3f4c', '#23262f');
      ctx.fillStyle = 'rgba(20,22,28,0.9)';
      ctx.beginPath();
      ctx.moveTo(20, 104);
      ctx.lineTo(56, 40);
      ctx.lineTo(80, 80);
      ctx.lineTo(100, 52);
      ctx.lineTo(118, 104);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(235,240,250,0.85)'; // snow caps
      ctx.beginPath();
      ctx.moveTo(56, 40);
      ctx.lineTo(64, 54);
      ctx.lineTo(48, 54);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'start': {
      base(ctx, '#566184', '#454e6e');
      speckle(ctx, rnd, 'rgba(255,255,255,0.12)', 16, 5);
      break;
    }
    case 'finish': {
      base(ctx, '#ffd667', '#e9b53f');
      // sparkle / star
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 5; i++) {
        const x = 20 + rnd() * 88;
        const y = 20 + rnd() * 88;
        ctx.beginPath();
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const rad = k % 2 === 0 ? 7 : 3;
          ctx.lineTo(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
  return c;
}

export function terrainTexture(terrain: Terrain): THREE.Texture {
  const hit = cache.get(terrain);
  if (hit) return hit;
  const tex = new THREE.CanvasTexture(draw(terrain));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(terrain, tex);
  return tex;
}

/** A large parchment-ish ground texture for the backdrop plane. */
export function groundTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry(99173);
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 180);
  g.addColorStop(0, '#1b2740');
  g.addColorStop(1, '#0c1322');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let i = 0; i < 400; i++) {
    ctx.fillRect(rnd() * 256, rnd() * 256, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
