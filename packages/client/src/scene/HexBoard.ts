/**
 * scene/HexBoard — owns the static hex tile layer (the ground plane of
 * the game board): top + side materials, the terminal (Eldorado) plateau,
 * and the cost-label meshes that sit on top of each hex.
 *
 * Read-only accessors (`getHexMesh`, `getHexTop`, `getHexPickables`) let
 * BlockadeRenderer and BoardInput query the layer without breaking
 * encapsulation. `render()` rebuilds the layer each turn.
 */
import * as THREE from 'three';
import { axialToPixel, type GameState, type Hex, type Terrain } from '@eldorado/core';
import { terrainTexture } from '../textures.js';
import { Decorations, type Placed } from '../decor.js';
import { TERRAIN_SIDE_COLOR } from '../shared/palette.js';
import {
  HEX_SIZE,
  HEX_GAP,
  TERMINAL_HEIGHT,
  TERRAIN_DEMAND_DARKEN_STEP,
  TERRAIN_DEMAND_DARKEN_MIN,
} from '../shared/constants.js';
import {
  terminalPlateGeometry,
  visibleTerminalHexes,
  hexKey,
  terminalOutline,
  type XZ,
} from './geom.js';
import {
  COST_LABEL_GEO,
  CostLabelAtlas,
  costIconForHex,
  imageReady,
} from './CostLabelAtlas.js';

/** Invisible material used as a placeholder for terminal-pickable hexes. */
export const PICK_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

interface HexTopInfo {
  y: number;
  landing: number;
}

export class HexBoard {
  readonly group = new THREE.Group();

  private readonly geoCache = new Map<string, THREE.CylinderGeometry>();
  private readonly topMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly sideMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly costLabelMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

  private terminalTopMaterial: THREE.MeshStandardMaterial | null = null;
  private terminalSideMaterial: THREE.MeshStandardMaterial | null = null;
  private terminalGlowMaterial: THREE.MeshBasicMaterial | null = null;
  private terminalOutlineMaterial: THREE.LineBasicMaterial | null = null;

  private readonly hexMeshes = new Map<string, THREE.Mesh>();
  private readonly hexPickables: THREE.Mesh[] = [];
  private readonly hexTops = new Map<string, HexTopInfo>();
  private readonly decor = new Decorations();

  /** Callback the facade invokes when a label texture loads (drives a
   *  re-render so the freshly-painted label is shown). */
  constructor(
    private readonly costAtlas: CostLabelAtlas,
    private readonly onTextureReady: () => void,
    private readonly realShadows: boolean,
  ) {}

  /** Rebuild the entire hex layer from `state`. */
  render(state: GameState): void {
    const terminalVisibility = visibleTerminalHexes(state.hexes);
    this.group.clear();
    this.decor.build(terminalVisibility.hexes.map((hex) => {
      const { x, z } = this.worldXZ(hex);
      const top = this.terrainHeight(visualTerrain(hex.terrain), hex.cost);
      return { hex, x, z, top };
    }));
    this.group.add(this.decor.group);
    this.enableSoftShadows(this.decor.group);

    this.hexMeshes.clear();
    this.hexPickables.length = 0;
    this.hexTops.clear();

    const terminal: Placed[] = [];
    for (const hex of terminalVisibility.hexes) {
      const terrain = visualTerrain(hex.terrain);
      const h = this.terrainHeight(terrain, hex.cost);
      const geo = this.hexGeo(`${terrain}:${h.toFixed(2)}`, h);
      const k = hexKey(hex);
      const isTerminal = terminalVisibility.terminalKeys.has(k);
      const top = isTerminal ? PICK_MATERIAL : this.topMaterial(terrain, hex.cost);
      const side = isTerminal ? PICK_MATERIAL : this.sideMaterial(terrain, hex.cost);
      // CylinderGeometry material groups: [side, top, bottom]
      const mesh = new THREE.Mesh(geo, [side, top, side]);
      const { x, z } = this.worldXZ(hex);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = !isTerminal && this.realShadows;
      mesh.receiveShadow = !isTerminal && this.realShadows;
      mesh.userData = { kind: 'hex', q: hex.q, r: hex.r, terrain: hex.terrain };
      this.group.add(mesh);
      this.hexMeshes.set(k, mesh);
      this.hexPickables.push(mesh);
      this.hexTops.set(k, { y: h, landing: this.pawnLandingHeight(hex, h) });

      const label = this.costLabel(hex);
      if (label) {
        label.position.set(x, h + 0.025, z);
        this.group.add(label);
      }

      if (isTerminal) terminal.push({ hex, x, z, top: h });
    }

    this.addTerminalPlate(terminal);
  }

  // --- accessors used by BlockadeRenderer + BoardInput -------------------

  getHexMesh(key: string): THREE.Mesh | undefined {
    return this.hexMeshes.get(key);
  }

  /** Top surface Y of the hex at `key`, plus the landing Y a pawn rests on. */
  getHexTop(key: string): HexTopInfo | undefined {
    return this.hexTops.get(key);
  }

  getHexPickables(): THREE.Mesh[] {
    return this.hexPickables;
  }

  /** World (x,z) on the ground plane of a hex centre. */
  worldXZ(c: { q: number; r: number }): XZ {
    const p = axialToPixel(c, HEX_SIZE);
    return { x: p.x, z: p.y };
  }

  // --- internals --------------------------------------------------------

  private hexGeo(key: string, height: number): THREE.CylinderGeometry {
    let g = this.geoCache.get(key);
    if (!g) {
      // CylinderGeometry's 6-gon already has a vertex on +Z (pointy-top), which
      // matches axialToPixel's pointy-top spacing — so NO extra rotation. The
      // earlier rotateY(30°) made flat-top hexes on pointy-top centres → the
      // honeycomb stopped tessellating.
      g = new THREE.CylinderGeometry(HEX_SIZE * HEX_GAP, HEX_SIZE * HEX_GAP, height, 6);
      this.geoCache.set(key, g);
    }
    return g;
  }

  private terrainHeight(t: Terrain, cost: number): number {
    if (t === 'eldorado') return TERMINAL_HEIGHT;
    if (t === 'mountain') return 0.52;
    if (t === 'start') return 0.3;
    return 0.3 + cost * 0.12;
  }

  private terrainDemandShade(cost: number): number {
    if (cost <= 1) return 1;
    return Math.max(TERRAIN_DEMAND_DARKEN_MIN, 1 - (cost - 1) * TERRAIN_DEMAND_DARKEN_STEP);
  }

  private pawnLandingHeight(hex: Hex, terrainTop: number): number {
    return hex.terrain === 'mountain' ? terrainTop + 0.06 : terrainTop;
  }

  private topMaterial(terrain: Terrain, cost: number): THREE.MeshStandardMaterial {
    const cacheKey = `${terrain}:${Math.max(0, cost)}`;
    let mat = this.topMaterialCache.get(cacheKey);
    if (!mat) {
      const shade = this.terrainDemandShade(cost);
      mat = new THREE.MeshStandardMaterial({
        map: terrainTexture(terrain),
        color: new THREE.Color(shade, shade, shade),
        roughness: 0.85,
      });
      this.topMaterialCache.set(cacheKey, mat);
    }
    return mat;
  }

  private sideMaterial(terrain: Terrain, cost: number): THREE.MeshStandardMaterial {
    const cacheKey = `${terrain}:${Math.max(0, cost)}`;
    let mat = this.sideMaterialCache.get(cacheKey);
    if (!mat) {
      const shade = this.terrainDemandShade(cost);
      const color = new THREE.Color(TERRAIN_SIDE_COLOR[terrain] ?? 0x445).multiplyScalar(shade);
      mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.95,
      });
      this.sideMaterialCache.set(cacheKey, mat);
    }
    return mat;
  }

  private terminalMaterials(): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
    if (!this.terminalTopMaterial) {
      this.terminalTopMaterial = new THREE.MeshStandardMaterial({
        map: terrainTexture('eldorado'),
        color: 0xf4d276,
        roughness: 0.78,
        metalness: 0.04,
        emissive: 0x7a4c12,
        emissiveIntensity: 0.28,
        side: THREE.DoubleSide,
      });
    }
    if (!this.terminalSideMaterial) {
      this.terminalSideMaterial = new THREE.MeshStandardMaterial({
        color: 0x8a6728,
        roughness: 0.9,
        side: THREE.DoubleSide,
      });
    }
    return [this.terminalTopMaterial, this.terminalSideMaterial];
  }

  private terminalGlow(): THREE.MeshBasicMaterial {
    if (!this.terminalGlowMaterial) {
      this.terminalGlowMaterial = new THREE.MeshBasicMaterial({
        color: 0xffd166,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    }
    return this.terminalGlowMaterial;
  }

  private terminalOutlineMaterialForCity(): THREE.LineBasicMaterial {
    if (!this.terminalOutlineMaterial) {
      this.terminalOutlineMaterial = new THREE.LineBasicMaterial({
        color: 0xfff0a3,
        transparent: true,
        opacity: 0.95,
      });
    }
    return this.terminalOutlineMaterial;
  }

  private addTerminalPlate(cells: Placed[]): void {
    if (!cells.length) return;
    const geometry = terminalPlateGeometry(cells, TERMINAL_HEIGHT);
    const mesh = new THREE.Mesh(geometry, this.terminalMaterials());
    mesh.castShadow = this.realShadows;
    mesh.receiveShadow = this.realShadows;
    this.group.add(mesh);
    const glow = new THREE.Mesh(geometry.clone(), this.terminalGlow());
    glow.position.y = 0.03;
    glow.renderOrder = 0.75;
    this.group.add(glow);

    const outline = terminalOutline(cells);
    if (outline.length >= 3) {
      const points = outline.map((p) => new THREE.Vector3(p.x, TERMINAL_HEIGHT + 0.085, p.z));
      points.push(points[0].clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.terminalOutlineMaterialForCity());
      line.renderOrder = 1.3;
      this.group.add(line);
    }
  }

  private costLabel(hex: Hex): THREE.Mesh | null {
    if (hex.cost <= 0) return null;
    const icon = costIconForHex(hex);
    if (!icon) return null;
    const cacheKey = `${icon}:${hex.cost}`;
    let mat = this.costLabelMaterialCache.get(cacheKey);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const img = this.costAtlas.iconImage(icon);
      const redraw = () => {
        this.costAtlas.drawHexLabel(ctx, icon, hex.cost, imageReady(img) ? img : null);
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
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.costLabelMaterialCache.set(cacheKey, mat);
    }
    const label = new THREE.Mesh(COST_LABEL_GEO, mat);
    label.renderOrder = 1;
    return label;
  }

  private enableSoftShadows(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        const opaqueLit = materials.some((m) => !(m instanceof THREE.MeshBasicMaterial) && !m.transparent);
        obj.castShadow = this.realShadows && opaqueLit;
        obj.receiveShadow = this.realShadows && opaqueLit;
      }
    });
  }
}

/** "finish" looks the same as "yellow" on the map. Centralised so the
 *  texture loader and the cost-labeller don't disagree. */
function visualTerrain(t: Terrain): Terrain {
  return t === 'finish' ? 'yellow' : t;
}