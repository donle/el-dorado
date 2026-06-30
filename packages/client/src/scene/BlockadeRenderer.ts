/**
 * scene/BlockadeRenderer — owns the unclaimed blockade meshes (the
 * coloured "fence" strips between two hexes) plus their materials and
 * per-blockade cost label.
 *
 * The renderer queries HexBoard for the Y coordinate of the hex edges
 * each blockade sits between, so the blockade plate rises with the
 * terrain. Read-only accessors let BoardInput raycast and fill-overlay
 * against the same surface.
 */
import * as THREE from 'three';
import type { Axial, Blockade, Terrain } from '@eldorado/core';
import { terrainTexture } from '../textures.js';
import {
  BLOCKADE_TOP_TINT,
  BLOCKADE_SIDE_COLOR,
  BLOCKADE_MARK_COLOR,
  TERRAIN_SIDE_COLOR,
  blockadeColor,
} from '../shared/palette.js';
import {
  BLOCKADE_WIDTH,
  BLOCKADE_HEIGHT,
  COST_LABEL_SIZE,
} from '../shared/constants.js';
import {
  blockadePlateGeometry,
  blockadeTopGeometry,
  blockadeBandGeometry,
  blockadeRimGeometry,
  hexKey,
  type XZ,
} from './geom.js';
import { BLOCKADE_LABEL_GEO, CostLabelAtlas, imageReady } from './CostLabelAtlas.js';
import type { HexBoard } from './HexBoard.js';

export interface BlockadeSurface {
  geometry: THREE.BufferGeometry;
}

export class BlockadeRenderer {
  readonly group = new THREE.Group();

  private readonly topMaterialCache = new Map<Terrain, THREE.MeshStandardMaterial>();
  private readonly sideMaterialCache = new Map<Terrain, THREE.MeshStandardMaterial>();
  private readonly labelMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
  private readonly patternMaterialCache = new Map<Terrain, THREE.MeshBasicMaterial>();
  private readonly bandMaterialCache = new Map<Terrain, THREE.MeshBasicMaterial>();
  private readonly rimMaterialCache = new Map<Terrain, THREE.LineBasicMaterial>();

  private readonly pickables: THREE.Mesh[] = [];
  private readonly surfaces = new Map<string, BlockadeSurface>();

  constructor(
    private readonly hexBoard: HexBoard,
    private readonly costAtlas: CostLabelAtlas,
    private readonly onTextureReady: () => void,
    private readonly realShadows: boolean,
  ) {}

  render(blockades: Blockade[]): void {
    this.group.clear();
    this.pickables.length = 0;
    this.surfaces.clear();

    for (const blockade of blockades) {
      if (blockade.claimedBy) continue;
      const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
      const path = this.computePath(edges);
      if (path.length < 2) continue;

      const y =
        Math.max(
          ...edges.flatMap((edge) => [
            this.hexBoard.getHexTop(hexKey(edge.a))?.y ?? 0.42,
            this.hexBoard.getHexTop(hexKey(edge.b))?.y ?? 0.42,
          ]),
        ) + 0.12;
      const terrainKey = this.blockadeTerrain(blockade);
      const terrain = new THREE.Mesh(blockadePlateGeometry(path, BLOCKADE_WIDTH, y, BLOCKADE_HEIGHT), [
        this.topMaterial(terrainKey),
        this.sideMaterial(terrainKey),
      ]);
      terrain.castShadow = this.realShadows;
      terrain.receiveShadow = this.realShadows;
      terrain.userData = { kind: 'blockade', id: blockade.id };
      this.pickables.push(terrain);
      this.surfaces.set(blockade.id, { geometry: terrain.geometry });
      this.group.add(terrain);

      const edgeBand = new THREE.Mesh(
        blockadeBandGeometry(path, BLOCKADE_WIDTH * 0.98, BLOCKADE_WIDTH * 0.72, y + 0.034),
        this.bandMaterial(terrainKey),
      );
      edgeBand.renderOrder = 1.04;
      this.group.add(edgeBand);

      const pattern = new THREE.Mesh(
        blockadeTopGeometry(path, BLOCKADE_WIDTH * 0.92, y + 0.032),
        this.patternMaterial(terrainKey),
      );
      pattern.renderOrder = 1.05;
      this.group.add(pattern);

      const rim = new THREE.Line(
        blockadeRimGeometry(path, BLOCKADE_WIDTH, y + 0.045),
        this.rimMaterial(terrainKey),
      );
      rim.renderOrder = 1.15;
      this.group.add(rim);

      const labelPos = path[Math.floor(path.length / 2)];
      const label = new THREE.Mesh(BLOCKADE_LABEL_GEO, this.labelMaterial(blockade));
      label.position.set(labelPos.x, y + 0.07, labelPos.z);
      label.renderOrder = 1.2;
      this.group.add(label);
    }
  }

  // --- accessors used by BoardInput --------------------------------------

  getPickables(): THREE.Mesh[] {
    return this.pickables;
  }

  getSurface(id: string): BlockadeSurface | undefined {
    return this.surfaces.get(id);
  }

  /** Highlight material used when a blockade is in the player's move set. */
  moveHighlightMaterial(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
  }

  // --- internals ---------------------------------------------------------

  /** Translate a list of hex-edge segments into a smooth XZ path. For
   *  single-edge blockades, the path is a stretched rhombus perpendicular
   *  to the edge. For multi-edge blockades, it's a wavy ribbon along the
   *  longest segment between the two farthest crossing centres. */
  private computePath(edges: Array<{ a: Axial; b: Axial }>): XZ[] {
    const crossings = edges.map((edge) => {
      const a = this.hexBoard.worldXZ(edge.a);
      const b = this.hexBoard.worldXZ(edge.b);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      return {
        mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
        across: { x: dx / len, z: dz / len },
      };
    });
    if (crossings.length === 1) {
      const c = crossings[0];
      const seam = { x: -c.across.z, z: c.across.x };
      return [
        { x: c.mid.x - seam.x * 0.7 - c.across.x * 0.18, z: c.mid.z - seam.z * 0.7 - c.across.z * 0.18 },
        { x: c.mid.x, z: c.mid.z },
        { x: c.mid.x + seam.x * 0.7 + c.across.x * 0.18, z: c.mid.z + seam.z * 0.7 + c.across.z * 0.18 },
      ];
    }

    let left = crossings[0].mid;
    let right = crossings[1].mid;
    let farthest = -Infinity;
    for (const a of crossings) {
      for (const b of crossings) {
        const d = (a.mid.x - b.mid.x) ** 2 + (a.mid.z - b.mid.z) ** 2;
        if (d > farthest) {
          farthest = d;
          left = a.mid;
          right = b.mid;
        }
      }
    }
    const seamLen = Math.hypot(right.x - left.x, right.z - left.z) || 1;
    const seam = { x: (right.x - left.x) / seamLen, z: (right.z - left.z) / seamLen };
    const across = crossings.reduce(
      (acc, c) => ({ x: acc.x + c.across.x, z: acc.z + c.across.z }),
      { x: 0, z: 0 },
    );
    const acrossLen = Math.hypot(across.x, across.z) || 1;
    const acrossDir = { x: across.x / acrossLen, z: across.z / acrossLen };
    const ordered = crossings
      .slice()
      .sort((a, b) => a.mid.x * seam.x + a.mid.z * seam.z - (b.mid.x * seam.x + b.mid.z * seam.z));
    const first = ordered[0].mid;
    const last = ordered[ordered.length - 1].mid;
    const path = ordered.map((c, i) => {
      const wave = (i % 2 === 0 ? -1 : 1) * 0.24;
      return { x: c.mid.x + acrossDir.x * wave, z: c.mid.z + acrossDir.z * wave };
    });
    path.unshift({ x: first.x - seam.x * 0.42, z: first.z - seam.z * 0.42 });
    path.push({ x: last.x + seam.x * 0.42, z: last.z + seam.z * 0.42 });
    return path;
  }

  private blockadeTerrain(blockade: Blockade): Terrain {
    if (blockade.terrain) return blockade.terrain;
    if (blockade.symbol === 'machete') return 'green';
    if (blockade.symbol === 'paddle') return 'blue';
    if (blockade.symbol === 'coin') return 'yellow';
    return 'yellow';
  }

  private topMaterial(terrain: Terrain): THREE.MeshStandardMaterial {
    let mat = this.topMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        map: terrainTexture(terrain),
        color: blockadeColor(terrain, BLOCKADE_TOP_TINT, 0xffffff),
        roughness: 0.86,
        metalness: 0.01,
      });
      this.topMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private sideMaterial(terrain: Terrain): THREE.MeshStandardMaterial {
    let mat = this.sideMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: blockadeColor(terrain, BLOCKADE_SIDE_COLOR, TERRAIN_SIDE_COLOR[terrain] ?? 0x17120e),
        roughness: 0.78,
        metalness: 0.05,
      });
      this.sideMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private patternMaterial(terrain: Terrain): THREE.MeshBasicMaterial {
    let mat = this.patternMaterialCache.get(terrain);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const mark = `#${blockadeColor(terrain, BLOCKADE_MARK_COLOR, 0x4d3a2f).toString(16).padStart(6, '0')}`;

      ctx.clearRect(0, 0, 128, 128);
      ctx.strokeStyle = mark;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.34;
      for (let i = -96; i < 224; i += 24) {
        ctx.beginPath();
        ctx.moveTo(i, 132);
        ctx.lineTo(i + 76, -4);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.24;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(0, 20);
      ctx.lineTo(128, 20);
      ctx.moveTo(0, 108);
      ctx.lineTo(128, 108);
      ctx.stroke();

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2.6, 1.25);
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      this.patternMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private bandMaterial(terrain: Terrain): THREE.MeshBasicMaterial {
    let mat = this.bandMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: blockadeColor(terrain, BLOCKADE_MARK_COLOR, 0x4d3a2f),
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      this.bandMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private rimMaterial(terrain: Terrain): THREE.LineBasicMaterial {
    let mat = this.rimMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.LineBasicMaterial({
        color: blockadeColor(terrain, BLOCKADE_MARK_COLOR, 0x4d3a2f),
        transparent: true,
        opacity: 0.86,
      });
      this.rimMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private labelMaterial(blockade: Blockade): THREE.MeshBasicMaterial {
    const icon = costIcon(blockade);
    const cacheKey = `${icon}:${blockade.cost}`;
    let mat = this.labelMaterialCache.get(cacheKey);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = COST_LABEL_SIZE;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const img = this.costAtlas.iconImage(icon);
      const redraw = () => {
        this.costAtlas.drawBlockadeLabel(ctx, blockade.cost, imageReady(img) ? img : null);
        tex.needsUpdate = true;
        this.onTextureReady();
      };
      redraw();
      if (!imageReady(img)) img.addEventListener('load', redraw, { once: true });
      mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.03,
        depthTest: true,
        depthWrite: false,
      });
      this.labelMaterialCache.set(cacheKey, mat);
    }
    return mat;
  }
}

/** Pick the cost-icon image to show on a blockade's label. */
function costIcon(blockade: Blockade): import('./CostLabelAtlas.js').CostIcon {
  if (blockade.terrain === 'green') return 'machete';
  if (blockade.terrain === 'blue') return 'paddle';
  if (blockade.terrain === 'yellow') return 'coin';
  return blockade.symbol ?? 'discard';
}
