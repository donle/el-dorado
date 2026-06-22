import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  axialToPixel,
  neighbors,
  type GameState,
  type Hex,
  type Axial,
  type Terrain,
  type Blockade,
  type MoveSymbol,
} from '@eldorado/core';
import { terrainTexture } from './textures.js';
import { Decorations, type Placed } from './decor.js';
import { BoardBackground } from './background.js';

const HEX_SIZE = 1;
const GAP = 0.94;
const MAX_PIXEL_RATIO = 1.25;
const SELF_MARKER_FRAME_MS = 1000 / 12;
const HIDDEN_TAB_FRAME_MS = 1000;
const TOP_DOWN_POLAR = 0.001;
const TERMINAL_HEIGHT = 0.68;
const COST_LABEL_GEO = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
const COST_LABEL_SIZE = 160;
const COST_ICON_DRAW_SIZE = 60;
const BLOCKADE_WIDTH = 0.74;
const BLOCKADE_HEIGHT = 0.16;
const BLOCKADE_LABEL_GEO = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
const BLOCKADE_LABEL_ICON_Y_OFFSET = 8;
const SELF_ARROW_LENGTH = 0.78;
const SELF_ARROW_HEAD_LENGTH = 0.32;
const SELF_ARROW_SHAFT_LENGTH = SELF_ARROW_LENGTH - SELF_ARROW_HEAD_LENGTH;
const SELF_ARROW_HEAD_GEO = new THREE.ConeGeometry(0.22, SELF_ARROW_HEAD_LENGTH, 28).rotateX(Math.PI);
const SELF_ARROW_SHAFT_GEO = new THREE.CylinderGeometry(0.055, 0.055, SELF_ARROW_SHAFT_LENGTH, 20);
const SELF_ARROW_SHAFT_RING_GEO = new THREE.TorusGeometry(0.064, 0.009, 8, 28).rotateX(Math.PI / 2);
const SELF_ARROW_HEAD_BASE_RING_GEO = new THREE.TorusGeometry(0.224, 0.012, 8, 32).rotateX(Math.PI / 2);
const SELF_ARROW_GUARD_GEO = new THREE.CylinderGeometry(0.13, 0.13, 0.026, 28);
const ACTIVE_PAWN_GLOW_GEO = new THREE.PlaneGeometry(1.45, 1.45).rotateX(-Math.PI / 2);
const ACTIVE_PAWN_RING_GEO = new THREE.RingGeometry(0.42, 0.56, 48).rotateX(-Math.PI / 2);
const ACTIVE_PAWN_RAY_GEO = new THREE.PlaneGeometry(0.44, 1.08);
const ACTIVE_PAWN_FLAME_GEO = new THREE.ConeGeometry(0.16, 0.74, 5, 1, true);
const SELF_ARROW_BASE_Y = 2.02;
const SELF_ARROW_BOB = 0.14;
const MOUNTAIN_PAWN_LANDING_LIFT = 0.9;
const PICK_MATERIAL = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
});

const SIDE_COLOR: Record<string, number> = {
  green: 0x24482e,
  blue: 0x1d5668,
  yellow: 0x8b7138,
  rubble: 0x55585a,
  basecamp: 0x6b3d31,
  mountain: 0x20242a,
  start: 0x3f4852,
  finish: 0x9b7430,
  eldorado: 0x87662b,
};

const BLOCKADE_TOP_TINT: Record<string, number> = {
  green: 0xc4d0a1,
  blue: 0xb7ccd0,
  yellow: 0xd6b86c,
  rubble: 0xb29a82,
};

const BLOCKADE_SIDE_COLOR: Record<string, number> = {
  green: 0x355f36,
  blue: 0x376b75,
  yellow: 0x8b692e,
  rubble: 0x68503e,
};

const BLOCKADE_MARK_COLOR: Record<string, number> = {
  green: 0x214a2a,
  blue: 0x235a66,
  yellow: 0x6f511e,
  rubble: 0x4d3a2f,
};

const PLAYER_COLOR: Record<string, number> = {
  red: 0xe05656,
  blue: 0x4c9bef,
  green: 0x5ed17a,
  yellow: 0xf0d24c,
};

const BLOCKADE_COLOR: Record<MoveSymbol, number> = {
  machete: 0x3d9c62,
  paddle: 0x2c8fbd,
  coin: 0xd6a73b,
};

type CostIcon = MoveSymbol | 'discard' | 'remove';

const COST_ICON_URL: Record<CostIcon, string> = {
  machete: '/card-icons/machete.jpg',
  paddle: '/card-icons/paddle.jpg',
  coin: '/card-icons/coin.jpg',
  discard: '/card-icons/discard.jpg',
  remove: '/card-icons/remove.jpg',
};

function blockadeMoveSymbol(blockade: Blockade): MoveSymbol | null {
  if (blockade.terrain === 'green') return 'machete';
  if (blockade.terrain === 'blue') return 'paddle';
  if (blockade.terrain === 'yellow') return 'coin';
  return blockade.symbol ?? null;
}

function blockadeCostIcon(blockade: Blockade): CostIcon {
  return blockadeMoveSymbol(blockade) ?? 'discard';
}

type PickTarget = { kind: 'hex'; key: string } | { kind: 'blockade'; id: string };

interface BlockadeSurface {
  geometry: THREE.BufferGeometry;
}

interface PawnState {
  group: THREE.Group;
  target: THREE.Vector3;
  selfMarker: THREE.Group;
}

function terrainHeight(t: Terrain, cost: number): number {
  if (t === 'eldorado') return TERMINAL_HEIGHT;
  if (t === 'mountain') return 0.52;
  if (t === 'start') return 0.3;
  return 0.3 + cost * 0.12;
}

function pawnLandingHeight(hex: Hex, terrainTop: number): number {
  return hex.terrain === 'mountain' ? terrainTop + MOUNTAIN_PAWN_LANDING_LIFT : terrainTop;
}

function visualTerrain(t: Terrain): Terrain {
  return t === 'finish' ? 'yellow' : t;
}

export class Board {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private overlayScene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private realShadows = localStorage.getItem('eldorado.highQualityShadows') === '1';
  private hexGroup = new THREE.Group();
  private blockadeGroup = new THREE.Group();
  private pieceGroup = new THREE.Group();
  private highlightGroup = new THREE.Group();
  private inspectionGroup = new THREE.Group();
  private hexMeshes = new Map<string, THREE.Mesh>();
  private hexPickables: THREE.Mesh[] = [];
  private hexTops = new Map<string, { y: number }>();
  private pawnLandings = new Map<string, { y: number }>();
  private blockadePickables: THREE.Mesh[] = [];
  private blockadeSurfaces = new Map<string, BlockadeSurface>();
  private highlights = new Set<string>();
  private blockadeHighlights = new Set<string>();
  private hexGeoCache = new Map<string, THREE.CylinderGeometry>();
  private topMaterialCache = new Map<Terrain, THREE.MeshStandardMaterial>();
  private sideMaterialCache = new Map<Terrain, THREE.MeshStandardMaterial>();
  private costLabelMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
  private costIconImageCache = new Map<CostIcon, HTMLImageElement>();
  private terminalTopMaterial: THREE.MeshStandardMaterial | null = null;
  private terminalSideMaterial: THREE.MeshStandardMaterial | null = null;
  private terminalGlowMaterial: THREE.MeshBasicMaterial | null = null;
  private terminalOutlineMaterial: THREE.LineBasicMaterial | null = null;
  private blockadeTopMaterialCache = new Map<Terrain, THREE.MeshStandardMaterial>();
  private blockadeSideMaterialCache = new Map<Terrain, THREE.MeshStandardMaterial>();
  private blockadeLabelMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
  private blockadePatternMaterialCache = new Map<Terrain, THREE.MeshBasicMaterial>();
  private blockadeBandMaterialCache = new Map<Terrain, THREE.MeshBasicMaterial>();
  private blockadeRimMaterialCache = new Map<Terrain, THREE.LineBasicMaterial>();
  private downPos: { x: number; y: number } | null = null;
  private decor = new Decorations();
  private background = new BoardBackground();
  private frameRequested = false;
  private frameDelayTimer: number | null = null;
  private lastFrameTime = 0;
  private viewMode: '3d' | '2d' = '3d';
  private selfPlayerId: string | null = null;
  private lastFit: { cx: number; cz: number; dist: number } | null = null;
  // Persistent pawns so movement can tween instead of snapping.
  private pawns = new Map<string, PawnState>();
  private pawnGlowTextureCache: THREE.CanvasTexture | null = null;
  private pawnRayTextureCache: THREE.CanvasTexture | null = null;
  private highlightMeshes: THREE.Mesh[] = [];
  private ringGeo: THREE.BufferGeometry | null = null;
  private inspectionFillGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.84, HEX_SIZE * 0.84, 0.012, 6);
  private inspectedFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x4cc9f0,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    depthTest: true,
  });
  private hoverFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x72f2d6,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    depthTest: true,
  });
  private blockadeMoveMaterial = new THREE.MeshBasicMaterial({
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
  private blockadeInspectedMaterial = new THREE.MeshBasicMaterial({
    color: 0x4cc9f0,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  private blockadeHoverMaterial = new THREE.MeshBasicMaterial({
    color: 0x72f2d6,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
  });
  // Hover marker for the cell currently under the cursor (if it's reachable).
  private hoverGroup = new THREE.Group();
  private hoverArrow!: THREE.Mesh;
  private hoverKey: string | null = null;
  private hoverBlockadeId: string | null = null;
  private infoHoverKey: string | null = null;
  private infoHoverBlockadeId: string | null = null;
  private inspectedKey: string | null = null;
  private inspectedBlockadeId: string | null = null;
  onHexHover: (c: Axial | null) => void = () => {};
  onHexClick: (c: Axial) => void = () => {};
  onBlockadeHover: (id: string | null) => void = () => {};
  onBlockadeClick: (id: string) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: (window.devicePixelRatio || 1) <= 1.25,
      powerPreference: 'low-power',
    });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.shadowMap.enabled = this.realShadows;
    if (this.realShadows) this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x8fb8c2);
    this.scene.background = new THREE.Color(0x8fb8c2);
    this.scene.fog = new THREE.Fog(0x8fb59a, 48, 125);
    this.scene.add(
      this.background.group,
      this.hexGroup,
      this.blockadeGroup,
      this.inspectionGroup,
      this.pieceGroup,
      this.highlightGroup,
      this.decor.group,
    );

    this.scene.add(new THREE.HemisphereLight(0xd8f0ff, 0x314420, 0.9));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.1);
    key.position.set(-8, 16, 10);
    if (this.realShadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 90;
      key.shadow.camera.left = -52;
      key.shadow.camera.right = 52;
      key.shadow.camera.top = 52;
      key.shadow.camera.bottom = -52;
      key.shadow.bias = -0.0006;
    }
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(10, 8, -6);
    this.scene.add(fill);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.camera.position.set(0, 20, 16);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 80;
    this.controls.minPolarAngle = 0.15; // keep a 2.5D tilt — never fully top-down
    this.controls.maxPolarAngle = 1.05; // and never too flat
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    // Touch: one finger pans the board (map-like), two fingers pinch-zoom + pan.
    this.controls.touches = {
      ONE: THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.addEventListener('change', () => this.requestFrame());

    this.buildHoverMarker();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('eldorado:texture-loaded', () => this.requestFrame());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.requestFrame();
    });
    // Distinguish a click (select hex) from a drag (camera move).
    canvas.addEventListener('pointerdown', (e) => (this.downPos = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    canvas.addEventListener('pointermove', (e) => {
      if (this.downPos) return; // mid-drag — don't hover
      this.setHoverTarget(this.pickTarget(e));
    });
    canvas.addEventListener('pointerleave', () => this.setHoverTarget(null));
    this.resize();
    this.requestFrame();
  }

  setViewMode(mode: '3d' | '2d'): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    const target = this.lastFit ?? {
      cx: this.controls.target.x,
      cz: this.controls.target.z,
      dist: Math.max(this.camera.position.distanceTo(this.controls.target), 12),
    };
    this.applyCameraPose(target.cx, target.cz, target.dist);
    this.requestFrame();
  }

  setSelfPlayerId(playerId: string | null): void {
    if (this.selfPlayerId === playerId) return;
    this.selfPlayerId = playerId;
    this.updateSelfMarkers();
    this.requestFrame();
  }

  private updateSelfMarkers(): void {
    for (const [id, pawn] of this.pawns) {
      pawn.selfMarker.visible = id === this.selfPlayerId;
    }
  }

  private requestFrame(delayMs = 0): void {
    if (delayMs > 0) {
      if (this.frameRequested || this.frameDelayTimer !== null) return;
      this.frameDelayTimer = window.setTimeout(() => {
        this.frameDelayTimer = null;
        this.queueFrame();
      }, delayMs);
      return;
    }
    if (this.frameDelayTimer !== null) {
      window.clearTimeout(this.frameDelayTimer);
      this.frameDelayTimer = null;
    }
    this.queueFrame();
  }

  private queueFrame(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame((time) => this.drawFrame(time));
  }

  private drawFrame(time: number): void {
    this.frameRequested = false;
    const dt = this.lastFrameTime > 0 ? Math.min((time - this.lastFrameTime) / 1000, 1 / 15) : 1 / 60;
    this.lastFrameTime = time;
    const moving = this.stepPawns(dt);
    const animatingSelfMarker = this.animateSelfMarkers(time);
    const animatingPawnGlow = this.animatePawnTurnGlows(time);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.camera);
    if (moving) this.requestFrame();
    else if (animatingSelfMarker || animatingPawnGlow) this.requestFrame(document.hidden ? HIDDEN_TAB_FRAME_MS : SELF_MARKER_FRAME_MS);
  }

  private stepPawns(dt: number): boolean {
    let moving = false;
    const a = 1 - Math.pow(0.0006, dt);
    for (const { group, target } of this.pawns.values()) {
      if (group.position.distanceToSquared(target) > 0.0004) {
        group.position.lerp(target, a);
        moving = true;
      } else {
        group.position.copy(target);
      }
    }
    return moving;
  }

  private animateSelfMarkers(time: number): boolean {
    let visible = false;
    const t = time * 0.001;
    for (const pawn of this.pawns.values()) {
      const marker = pawn.selfMarker;
      if (!marker.visible) continue;
      visible = true;

      const pulseValue = (Math.sin(t * 5.4) + 1) / 2;
      const pulse = 1 + (pulseValue - 0.5) * 0.14;
      marker.position.set(
        pawn.group.position.x,
        pawn.group.position.y + SELF_ARROW_BASE_Y + Math.sin(t * 4.2) * SELF_ARROW_BOB,
        pawn.group.position.z,
      );
      marker.scale.setScalar(pulse);

      const arrowMat = marker.userData.arrowMat as THREE.MeshBasicMaterial | undefined;
      const highlightMat = marker.userData.highlightMat as THREE.MeshBasicMaterial | undefined;
      arrowMat?.color.setHSL(0.09, 0.92, 0.43 + pulseValue * 0.03);
      highlightMat?.color.setHSL(0.1, 0.82, 0.5 + pulseValue * 0.03);
    }
    return visible;
  }

  private animatePawnTurnGlows(time: number): boolean {
    let visible = false;
    const t = time * 0.001;
    for (const pawn of this.pawns.values()) {
      const group = pawn.group.userData.turnGlow as THREE.Group | undefined;
      if (!group?.visible) continue;
      visible = true;

      const pulse = (Math.sin(t * 3.4) + 1) / 2;
      group.scale.setScalar(1 + (pulse - 0.5) * 0.08);
      group.rotation.y = Math.sin(t * 1.2) * 0.05;

      const glowMat = group.userData.glowMat as THREE.MeshBasicMaterial | undefined;
      const ringMat = group.userData.ringMat as THREE.MeshBasicMaterial | undefined;
      glowMat && (glowMat.opacity = 0.32 + pulse * 0.08);
      ringMat && (ringMat.opacity = 0.42 + pulse * 0.11);

      const rays = group.userData.rays as THREE.Mesh[] | undefined;
      rays?.forEach((ray, i) => {
        const phase = i * 1.7;
        const wave = (Math.sin(t * 4.2 + phase) + 1) / 2;
        ray.rotation.y = (ray.userData.baseRotation as number) + Math.sin(t * 2 + phase) * 0.08;
        ray.scale.set(0.92 + wave * 0.14, 0.9 + wave * 0.18, 1);
        const mat = ray.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.3 + wave * 0.13;
      });

      const flames = group.userData.flames as THREE.Mesh[] | undefined;
      flames?.forEach((flame, i) => {
        const phase = i * 1.35 + 0.6;
        const wave = (Math.sin(t * 5.1 + phase) + 1) / 2;
        const baseY = flame.userData.baseY as number;
        flame.position.y = baseY + wave * 0.035;
        flame.rotation.y = (flame.userData.baseRotation as number) + Math.sin(t * 2.8 + phase) * 0.12;
        flame.scale.set(0.86 + wave * 0.16, 0.86 + wave * 0.22, 0.86 + wave * 0.16);
        const mat = flame.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.34 + wave * 0.15;
      });
    }
    return visible;
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestFrame();
  }

  /** World position (x,z on the ground plane) of a hex centre. */
  private worldXZ(c: Axial): { x: number; z: number } {
    const p = axialToPixel(c, HEX_SIZE);
    return { x: p.x, z: p.y };
  }

  private hexGeo(key: string, height: number): THREE.CylinderGeometry {
    let g = this.hexGeoCache.get(key);
    if (!g) {
      // CylinderGeometry's 6-gon already has a vertex on +Z (pointy-top), which
      // matches axialToPixel's pointy-top spacing — so NO extra rotation. The
      // earlier rotateY(30°) made flat-top hexes on pointy-top centres → the
      // honeycomb stopped tessellating.
      g = new THREE.CylinderGeometry(HEX_SIZE * GAP, HEX_SIZE * GAP, height, 6);
      this.hexGeoCache.set(key, g);
    }
    return g;
  }

  private topMaterial(terrain: Terrain): THREE.MeshStandardMaterial {
    let mat = this.topMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        map: terrainTexture(terrain),
        roughness: 0.85,
      });
      this.topMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private sideMaterial(terrain: Terrain): THREE.MeshStandardMaterial {
    let mat = this.sideMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: SIDE_COLOR[terrain] ?? 0x445,
        roughness: 0.95,
      });
      this.sideMaterialCache.set(terrain, mat);
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
    this.hexGroup.add(mesh);
    const glow = new THREE.Mesh(geometry.clone(), this.terminalGlow());
    glow.position.y = 0.03;
    glow.renderOrder = 0.75;
    this.hexGroup.add(glow);

    const outline = terminalOutline(cells);
    if (outline.length >= 3) {
      const points = outline.map((p) => new THREE.Vector3(p.x, TERMINAL_HEIGHT + 0.085, p.z));
      points.push(points[0].clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), this.terminalOutlineMaterialForCity());
      line.renderOrder = 1.3;
      this.hexGroup.add(line);
    }
  }

  render(state: GameState): void {
    const first = this.hexMeshes.size === 0;
    const terminalVisibility = visibleTerminalHexes(state.hexes);
    this.background.build(terminalVisibility.hexes, (c) => this.worldXZ(c));
    this.hexGroup.clear();
    this.blockadeGroup.clear();
    this.highlightGroup.clear();
    this.hexMeshes.clear();
    this.hexPickables = [];
    this.hexTops.clear();
    this.pawnLandings.clear();
    this.blockadePickables = [];
    this.blockadeSurfaces.clear();
    const placed: Placed[] = [];
    const terminal: Placed[] = [];

    for (const hex of terminalVisibility.hexes) {
      const terrain = visualTerrain(hex.terrain);
      const h = terrainHeight(terrain, hex.cost);
      const geo = this.hexGeo(`${terrain}:${h.toFixed(2)}`, h);
      const k = hexKey(hex);
      const isTerminal = terminalVisibility.terminalKeys.has(k);
      const top = isTerminal ? PICK_MATERIAL : this.topMaterial(terrain);
      const side = isTerminal ? PICK_MATERIAL : this.sideMaterial(terrain);
      // CylinderGeometry material groups: [side, top, bottom]
      const mesh = new THREE.Mesh(geo, [side, top, side]);
      const { x, z } = this.worldXZ(hex);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = !isTerminal && this.realShadows;
      mesh.receiveShadow = !isTerminal && this.realShadows;
      mesh.userData = { kind: 'hex', q: hex.q, r: hex.r, terrain: hex.terrain };
      this.hexGroup.add(mesh);
      this.hexMeshes.set(k, mesh);
      this.hexPickables.push(mesh);
      this.hexTops.set(k, { y: h });
      this.pawnLandings.set(k, { y: pawnLandingHeight(hex, h) });
      const p = { hex, x, z, top: h };
      if (isTerminal) terminal.push(p);
      else if (hex.terrain !== 'finish') placed.push(p);

      const label = this.costLabel(hex);
      if (label) {
        label.position.set(x, h + 0.025, z);
        this.hexGroup.add(label);
      }
    }

    this.addTerminalPlate(terminal);
    this.renderBlockades(state.blockades ?? []);
    this.decor.build(placed);
    this.enableSoftShadows(this.decor.group);

    // Reconcile persistent pawns (so movement tweens instead of snapping).
    const present = new Set<string>();
    const activePlayerId = state.phase === 'playing' ? state.turn?.playerId ?? null : null;
    for (const pl of state.players) {
      present.add(pl.id);
      const { x, z } = this.worldXZ(pl.position);
      const y = this.pawnLandings.get(`${pl.position.q},${pl.position.r}`)?.y ?? 0.3;
      let pawn = this.pawns.get(pl.id);
      if (!pawn) {
        const group = this.makePawn(PLAYER_COLOR[pl.color] ?? 0xffffff, x, y, z);
        const selfMarker = this.makeSelfMarker();
        this.overlayScene.add(selfMarker);
        this.pieceGroup.add(group);
        selfMarker.visible = pl.id === this.selfPlayerId;
        pawn = { group, target: new THREE.Vector3(x, y, z), selfMarker };
        this.pawns.set(pl.id, pawn);
      } else {
        pawn.target.set(x, y, z);
        pawn.selfMarker.visible = pl.id === this.selfPlayerId;
      }
      this.setPawnTurnActive(pawn, pl.id === activePlayerId);
    }
    for (const [id, pawn] of this.pawns) {
      if (!present.has(id)) {
        this.pieceGroup.remove(pawn.group);
        this.overlayScene.remove(pawn.selfMarker);
        this.pawns.delete(id);
      }
    }
    this.animateSelfMarkers(performance.now());

    this.applyHighlights();
    this.applyInspectionHighlights();
    if (first) this.fitCamera(terminalVisibility.hexes);
    this.requestFrame();
  }

  private blockadeTerrain(blockade: Blockade): Terrain {
    if (blockade.terrain) return blockade.terrain;
    if (blockade.symbol === 'machete') return 'green';
    if (blockade.symbol === 'paddle') return 'blue';
    if (blockade.symbol === 'coin') return 'yellow';
    return 'yellow';
  }

  private blockadeTopMaterial(terrain: Terrain): THREE.MeshStandardMaterial {
    let mat = this.blockadeTopMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        map: terrainTexture(terrain),
        color: BLOCKADE_TOP_TINT[terrain] ?? 0xffffff,
        roughness: 0.86,
        metalness: 0.01,
      });
      this.blockadeTopMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private blockadeSideMaterial(terrain: Terrain): THREE.MeshStandardMaterial {
    let mat = this.blockadeSideMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color: BLOCKADE_SIDE_COLOR[terrain] ?? SIDE_COLOR[terrain] ?? 0x17120e,
        roughness: 0.78,
        metalness: 0.05,
      });
      this.blockadeSideMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private blockadePatternMaterial(terrain: Terrain): THREE.MeshBasicMaterial {
    let mat = this.blockadePatternMaterialCache.get(terrain);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      const mark = `#${(BLOCKADE_MARK_COLOR[terrain] ?? 0x4d3a2f).toString(16).padStart(6, '0')}`;

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
      this.blockadePatternMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private blockadeBandMaterial(terrain: Terrain): THREE.MeshBasicMaterial {
    let mat = this.blockadeBandMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: BLOCKADE_MARK_COLOR[terrain] ?? 0x4d3a2f,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      this.blockadeBandMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private blockadeRimMaterial(terrain: Terrain): THREE.LineBasicMaterial {
    let mat = this.blockadeRimMaterialCache.get(terrain);
    if (!mat) {
      mat = new THREE.LineBasicMaterial({
        color: BLOCKADE_MARK_COLOR[terrain] ?? 0x4d3a2f,
        transparent: true,
        opacity: 0.86,
      });
      this.blockadeRimMaterialCache.set(terrain, mat);
    }
    return mat;
  }

  private blockadeLabelMaterial(blockade: Blockade): THREE.MeshBasicMaterial {
    const icon = blockadeCostIcon(blockade);
    const cacheKey = `${icon}:${blockade.cost}`;
    let mat = this.blockadeLabelMaterialCache.get(cacheKey);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = COST_LABEL_SIZE;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const img = this.costIconImage(icon);
      const redraw = () => {
        drawBlockadeCostLabel(ctx, blockade.cost, imageReady(img) ? img : null);
        tex.needsUpdate = true;
        this.requestFrame();
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
      this.blockadeLabelMaterialCache.set(cacheKey, mat);
    }
    return mat;
  }

  private renderBlockades(blockades: Blockade[]): void {
    for (const blockade of blockades) {
      if (blockade.claimedBy) continue;
      const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
      const path = this.blockadePath(edges);
      if (path.length < 2) continue;

      const y =
        Math.max(
          ...edges.flatMap((edge) => [
            this.hexTops.get(hexKey(edge.a))?.y ?? 0.42,
            this.hexTops.get(hexKey(edge.b))?.y ?? 0.42,
          ]),
        ) + 0.12;
      const blockadeTerrain = this.blockadeTerrain(blockade);
      const terrain = new THREE.Mesh(blockadePlateGeometry(path, BLOCKADE_WIDTH, y, BLOCKADE_HEIGHT), [
        this.blockadeTopMaterial(blockadeTerrain),
        this.blockadeSideMaterial(blockadeTerrain),
      ]);
      terrain.castShadow = this.realShadows;
      terrain.receiveShadow = this.realShadows;
      terrain.userData = { kind: 'blockade', id: blockade.id };
      this.blockadePickables.push(terrain);
      this.blockadeSurfaces.set(blockade.id, { geometry: terrain.geometry });
      this.blockadeGroup.add(terrain);

      const edgeBand = new THREE.Mesh(
        blockadeBandGeometry(path, BLOCKADE_WIDTH * 0.98, BLOCKADE_WIDTH * 0.72, y + 0.034),
        this.blockadeBandMaterial(blockadeTerrain),
      );
      edgeBand.renderOrder = 1.04;
      this.blockadeGroup.add(edgeBand);

      const pattern = new THREE.Mesh(
        blockadeTopGeometry(path, BLOCKADE_WIDTH * 0.92, y + 0.032),
        this.blockadePatternMaterial(blockadeTerrain),
      );
      pattern.renderOrder = 1.05;
      this.blockadeGroup.add(pattern);

      const rim = new THREE.Line(
        blockadeRimGeometry(path, BLOCKADE_WIDTH, y + 0.045),
        this.blockadeRimMaterial(blockadeTerrain),
      );
      rim.renderOrder = 1.15;
      this.blockadeGroup.add(rim);

      const labelPos = path[Math.floor(path.length / 2)];

      const label = new THREE.Mesh(BLOCKADE_LABEL_GEO, this.blockadeLabelMaterial(blockade));
      label.position.set(labelPos.x, y + 0.07, labelPos.z);
      label.renderOrder = 1.2;
      this.blockadeGroup.add(label);
    }
  }

  private blockadePath(edges: Array<{ a: Axial; b: Axial }>): XZ[] {
    const crossings = edges.map((edge) => {
      const a = this.worldXZ(edge.a);
      const b = this.worldXZ(edge.b);
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

  private makePawn(color: number, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const turnGlow = this.makePawnTurnGlow(color);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.18, 20), mat);
    base.position.y = 0.09;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), mat);
    body.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 18), mat);
    head.position.y = 0.95;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.05, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x10182a }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(turnGlow, ring, base, body, head);
    g.userData.turnGlow = turnGlow;
    this.enableSoftShadows(g);
    g.position.set(x, y, z);
    return g;
  }

  private setPawnTurnActive(pawn: PawnState, active: boolean): void {
    const glow = pawn.group.userData.turnGlow as THREE.Group | undefined;
    if (glow) glow.visible = active;
  }

  private makePawnTurnGlow(color: number): THREE.Group {
    const group = new THREE.Group();
    group.position.y = 0.026;
    group.visible = false;
    group.frustumCulled = false;

    const tint = new THREE.Color(color).lerp(new THREE.Color(0xffd166), 0.48);
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.pawnGlowTexture(),
      color: tint,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(
      ACTIVE_PAWN_GLOW_GEO,
      glowMat,
    );
    glow.renderOrder = 36;

    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(
      ACTIVE_PAWN_RING_GEO,
      ringMat,
    );
    ring.position.y = 0.006;
    ring.renderOrder = 37;

    const rays: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const baseRotation = (Math.PI * 2 * i) / 3 + 0.24;
      const rayMat = new THREE.MeshBasicMaterial({
        map: this.pawnRayTexture(),
        color: tint,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const ray = new THREE.Mesh(ACTIVE_PAWN_RAY_GEO, rayMat);
      ray.position.y = 0.66;
      ray.rotation.y = baseRotation;
      ray.renderOrder = 38 + i;
      ray.userData.baseRotation = baseRotation;
      rays.push(ray);
      group.add(ray);
    }

    const flames: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (Math.PI * 2 * i) / 3 + 0.62;
      const flameMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffb74d).lerp(tint, 0.35),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        depthTest: true,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const flame = new THREE.Mesh(ACTIVE_PAWN_FLAME_GEO, flameMat);
      flame.position.set(Math.cos(angle) * 0.32, 0.46, Math.sin(angle) * 0.32);
      flame.rotation.y = angle;
      flame.renderOrder = 42 + i;
      flame.userData.baseRotation = angle;
      flame.userData.baseY = 0.46;
      flames.push(flame);
      group.add(flame);
    }

    group.userData.glowMat = glowMat;
    group.userData.ringMat = ringMat;
    group.userData.rays = rays;
    group.userData.flames = flames;
    group.add(glow, ring);
    return group;
  }

  private pawnGlowTexture(): THREE.CanvasTexture {
    if (this.pawnGlowTextureCache) return this.pawnGlowTextureCache;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(255, 226, 138, 0.36)');
    gradient.addColorStop(0.36, 'rgba(255, 209, 102, 0.18)');
    gradient.addColorStop(0.72, 'rgba(255, 209, 102, 0.055)');
    gradient.addColorStop(1, 'rgba(255, 209, 102, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.pawnGlowTextureCache = texture;
    return texture;
  }

  private pawnRayTexture(): THREE.CanvasTexture {
    if (this.pawnRayTextureCache) return this.pawnRayTextureCache;
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;

    const bodyGradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
    bodyGradient.addColorStop(0, 'rgba(255, 185, 70, 0)');
    bodyGradient.addColorStop(0.18, 'rgba(255, 196, 82, 0.32)');
    bodyGradient.addColorStop(0.52, 'rgba(255, 216, 115, 0.48)');
    bodyGradient.addColorStop(0.82, 'rgba(255, 235, 170, 0.16)');
    bodyGradient.addColorStop(1, 'rgba(255, 235, 170, 0)');

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.moveTo(48, 188);
    ctx.bezierCurveTo(21, 142, 30, 72, 44, 12);
    ctx.bezierCurveTo(62, 72, 78, 142, 48, 188);
    ctx.closePath();
    ctx.fill();

    const coreGradient = ctx.createLinearGradient(0, 180, 0, 20);
    coreGradient.addColorStop(0, 'rgba(255, 245, 190, 0)');
    coreGradient.addColorStop(0.42, 'rgba(255, 246, 196, 0.42)');
    coreGradient.addColorStop(1, 'rgba(255, 246, 196, 0)');
    ctx.fillStyle = coreGradient;
    ctx.beginPath();
    ctx.moveTo(48, 174);
    ctx.bezierCurveTo(39, 130, 40, 72, 48, 30);
    ctx.bezierCurveTo(57, 75, 60, 130, 48, 174);
    ctx.closePath();
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.pawnRayTextureCache = texture;
    return texture;
  }

  private makeSelfMarker(): THREE.Group {
    const group = new THREE.Group();
    group.position.y = SELF_ARROW_BASE_Y;
    group.frustumCulled = false;

    const materialOptions = {
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    };
    const arrowMat = new THREE.MeshBasicMaterial({ ...materialOptions, color: 0xe88d16 });
    const highlightMat = new THREE.MeshBasicMaterial({ ...materialOptions, color: 0xf3b24a });
    const edgeMat = new THREE.MeshBasicMaterial({ ...materialOptions, color: 0x5a3200 });

    const headEdge = new THREE.Mesh(SELF_ARROW_HEAD_GEO, edgeMat);
    headEdge.position.set(0, -(SELF_ARROW_SHAFT_LENGTH + SELF_ARROW_HEAD_LENGTH / 2), 0);
    headEdge.scale.set(1.18, 1.12, 1.18);
    const shaftEdge = new THREE.Mesh(SELF_ARROW_SHAFT_GEO, edgeMat);
    shaftEdge.position.set(0, -SELF_ARROW_SHAFT_LENGTH / 2, 0);
    shaftEdge.scale.set(1.26, 1.08, 1.26);

    const head = new THREE.Mesh(SELF_ARROW_HEAD_GEO, arrowMat);
    head.position.set(0, -(SELF_ARROW_SHAFT_LENGTH + SELF_ARROW_HEAD_LENGTH / 2) - 0.004, 0);
    const shaft = new THREE.Mesh(SELF_ARROW_SHAFT_GEO, arrowMat);
    shaft.position.set(0, -SELF_ARROW_SHAFT_LENGTH / 2, 0);

    const shaftTopRing = new THREE.Mesh(SELF_ARROW_SHAFT_RING_GEO, edgeMat);
    shaftTopRing.position.set(0, 0, 0);
    const shaftBottomRing = new THREE.Mesh(SELF_ARROW_SHAFT_RING_GEO, edgeMat);
    shaftBottomRing.position.set(0, -SELF_ARROW_SHAFT_LENGTH, 0);
    const headBaseRing = new THREE.Mesh(SELF_ARROW_HEAD_BASE_RING_GEO, edgeMat);
    headBaseRing.position.set(0, -SELF_ARROW_SHAFT_LENGTH - 0.004, 0);
    const guard = new THREE.Mesh(SELF_ARROW_GUARD_GEO, edgeMat);
    guard.position.set(0, -SELF_ARROW_SHAFT_LENGTH + 0.002, 0);

    const highlight = new THREE.Mesh(SELF_ARROW_HEAD_GEO, highlightMat);
    highlight.position.set(0.03, -(SELF_ARROW_SHAFT_LENGTH + SELF_ARROW_HEAD_LENGTH / 2) - 0.018, -0.03);
    highlight.scale.set(0.36, 0.5, 0.36);

    for (const part of [headEdge, shaftEdge, head, shaft, shaftTopRing, shaftBottomRing, headBaseRing, guard, highlight]) {
      part.frustumCulled = false;
    }
    for (const part of [headEdge, shaftEdge]) part.renderOrder = 80;
    for (const part of [head, shaft]) part.renderOrder = 81;
    highlight.renderOrder = 82;
    for (const part of [shaftTopRing, shaftBottomRing, headBaseRing, guard]) part.renderOrder = 83;

    group.userData.arrowMat = arrowMat;
    group.userData.highlightMat = highlightMat;
    group.add(shaftEdge, headEdge, shaft, head, highlight, shaftTopRing, shaftBottomRing, headBaseRing, guard);
    return group;
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

  private costIconImage(icon: CostIcon): HTMLImageElement {
    let img = this.costIconImageCache.get(icon);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = COST_ICON_URL[icon];
      this.costIconImageCache.set(icon, img);
    }
    return img;
  }

  private costLabel(hex: Hex): THREE.Mesh | null {
    if (hex.cost <= 0) return null;
    const icon = costIconForHex(hex);
    if (!icon) return null;
    const cacheKey = `${icon}:${hex.cost}`;
    let mat = this.costLabelMaterialCache.get(cacheKey);
    if (!mat) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = COST_LABEL_SIZE;
      const ctx = canvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      const img = this.costIconImage(icon);
      const redraw = () => {
        drawCostLabel(ctx, icon, hex.cost, imageReady(img) ? img : null);
        tex.needsUpdate = true;
        this.requestFrame();
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

  private fitCamera(hexes: Hex[]): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const hex of hexes) {
      const { x, z } = this.worldXZ(hex);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 2;
    const dist = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.1;
    this.lastFit = { cx, cz, dist };
    this.applyCameraPose(cx, cz, dist);
  }

  private applyCameraPose(cx: number, cz: number, dist: number): void {
    this.controls.maxDistance = dist * 1.8;
    this.controls.target.set(cx, 0, cz);
    this.controls.enableRotate = this.viewMode === '3d';
    if (this.viewMode === '2d') {
      this.controls.minPolarAngle = TOP_DOWN_POLAR;
      this.controls.maxPolarAngle = TOP_DOWN_POLAR;
      this.camera.position.set(cx, dist * 1.05, cz + dist * TOP_DOWN_POLAR);
    } else {
      this.controls.minPolarAngle = 0.15; // keep a 2.5D tilt — never fully top-down
      this.controls.maxPolarAngle = 1.05; // and never too flat
      // Tilted 2.5D vantage: above and toward +z.
      this.camera.position.set(cx, dist * 0.82, cz + dist * 0.62);
    }
    this.controls.update();
    this.camera.updateMatrixWorld(true);
  }

  private buildHoverMarker(): void {
    const fill = new THREE.Mesh(
      new THREE.CylinderGeometry(HEX_SIZE * 0.9, HEX_SIZE * 0.9, 0.05, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    fill.position.y = 0.08;
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.36, 14),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    );
    arrow.rotation.x = Math.PI; // point downward
    arrow.position.y = 1.0;
    this.hoverArrow = arrow;
    this.hoverGroup.add(fill, arrow);
    this.hoverGroup.visible = false;
    this.scene.add(this.hoverGroup);
  }

  /** The board entity under a pointer event, or null. */
  private pickTarget(e: PointerEvent): PickTarget | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.blockadePickables, ...this.hexPickables]);
    if (!hits.length) return null;
    const data = hits[0].object.userData as { kind?: string; id?: string; q?: number; r?: number };
    if (data.kind === 'blockade' && data.id) return { kind: 'blockade', id: data.id };
    if (typeof data.q === 'number' && typeof data.r === 'number') return { kind: 'hex', key: `${data.q},${data.r}` };
    return null;
  }

  private updateHoverAffordance(): void {
    const wasVisible = this.hoverGroup.visible;
    const key = this.hoverKey ?? this.infoHoverKey;
    const reachableHex = !!key && this.highlights.has(key);
    if (reachableHex) {
      const mesh = this.hexMeshes.get(key!)!;
      const top = this.hexTops.get(key!)!;
      this.hoverGroup.position.set(mesh.position.x, top.y, mesh.position.z);
      this.hoverGroup.visible = true;
      this.canvas.style.cursor = 'pointer';
    } else {
      this.hoverGroup.visible = false;
      this.canvas.style.cursor = (this.hoverBlockadeId ?? this.infoHoverBlockadeId) ? 'pointer' : '';
    }
    if (wasVisible !== this.hoverGroup.visible) this.requestFrame();
  }

  private setHoverTarget(target: PickTarget | null): void {
    const prevKey = this.hoverKey;
    const prevBlockadeId = this.hoverBlockadeId;
    this.hoverKey = target?.kind === 'hex' ? target.key : null;
    this.hoverBlockadeId = target?.kind === 'blockade' ? target.id : null;
    if (prevKey !== this.hoverKey) this.onHexHover(this.hoverKey ? keyToAxial(this.hoverKey) : null);
    if (prevBlockadeId !== this.hoverBlockadeId) this.onBlockadeHover(this.hoverBlockadeId);
    if (prevKey !== this.hoverKey || prevBlockadeId !== this.hoverBlockadeId) {
      this.applyInspectionHighlights();
      this.requestFrame();
    }
    this.updateHoverAffordance();
  }

  clearHover(): void {
    this.setHoverTarget(null);
  }

  setInfoHoverHex(coord: Axial | null): void {
    this.infoHoverKey = coord ? `${coord.q},${coord.r}` : null;
    if (coord) this.infoHoverBlockadeId = null;
    this.applyInspectionHighlights();
    this.updateHoverAffordance();
    this.requestFrame();
  }

  setInfoHoverBlockade(id: string | null): void {
    this.infoHoverBlockadeId = id;
    if (id) this.infoHoverKey = null;
    this.applyInspectionHighlights();
    this.updateHoverAffordance();
    this.requestFrame();
  }

  clearInfoHover(): void {
    if (!this.infoHoverKey && !this.infoHoverBlockadeId) return;
    this.infoHoverKey = null;
    this.infoHoverBlockadeId = null;
    this.applyInspectionHighlights();
    this.updateHoverAffordance();
    this.requestFrame();
  }

  setInspectedHex(coord: Axial | null): void {
    this.inspectedKey = coord ? `${coord.q},${coord.r}` : null;
    this.applyInspectionHighlights();
    this.requestFrame();
  }

  setInspectedBlockade(id: string | null): void {
    this.inspectedBlockadeId = id;
    this.applyInspectionHighlights();
    this.requestFrame();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.downPos) return;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    this.downPos = null;
    if (moved > 6) return; // it was a drag (pan/rotate), not a click
    const target = this.pickTarget(e);
    if (target?.kind === 'hex') {
      const [q, r] = target.key.split(',').map(Number);
      this.onHexClick({ q, r });
    } else if (target?.kind === 'blockade') {
      this.onBlockadeClick(target.id);
    }
  }

  setHighlights(coords: Axial[]): void {
    this.highlights = new Set(coords.map((c) => `${c.q},${c.r}`));
    this.applyHighlights();
    this.applyInspectionHighlights();
    this.updateHoverAffordance(); // re-validate hover against new reachables
    this.requestFrame();
  }

  setBlockadeHighlights(ids: string[]): void {
    this.blockadeHighlights = new Set(ids);
    this.applyHighlights();
    this.applyInspectionHighlights();
    this.updateHoverAffordance();
    this.requestFrame();
  }

  private applyHighlights(): void {
    this.highlightGroup.clear();
    this.highlightMeshes = [];
    // A glowing hexagonal border ring (aligned to the hex), pulsing in animate.
    if (!this.ringGeo) this.ringGeo = hexRingGeometry(HEX_SIZE * 0.82, HEX_SIZE * 1.02);
    for (const k of this.highlights) {
      const mesh = this.hexMeshes.get(k);
      const top = this.hexTops.get(k);
      if (!mesh || !top) continue;
      const ring = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.position.set(mesh.position.x, top.y + 0.07, mesh.position.z);
      this.highlightGroup.add(ring);
      this.highlightMeshes.push(ring);
    }
    for (const id of this.blockadeHighlights) {
      this.addBlockadeFill(id, this.blockadeMoveMaterial, this.highlightGroup, 0.035);
    }
  }

  private applyInspectionHighlights(): void {
    const hoverKey = this.hoverKey ?? this.infoHoverKey;
    const hoverBlockadeId = this.hoverBlockadeId ?? this.infoHoverBlockadeId;
    this.inspectionGroup.clear();
    this.addInspectionFill(this.inspectedKey, this.inspectedFillMaterial);
    if (hoverKey !== this.inspectedKey) {
      this.addInspectionFill(hoverKey, this.hoverFillMaterial);
    }
    this.addBlockadeFill(this.inspectedBlockadeId, this.blockadeInspectedMaterial, this.inspectionGroup, 0.04);
    if (hoverBlockadeId !== this.inspectedBlockadeId) {
      this.addBlockadeFill(hoverBlockadeId, this.blockadeHoverMaterial, this.inspectionGroup, 0.05);
    }
  }

  private addInspectionFill(key: string | null, material: THREE.MeshBasicMaterial): void {
    if (!key) return;
    const mesh = this.hexMeshes.get(key);
    const top = this.hexTops.get(key);
    if (!mesh || !top) return;
    const fill = new THREE.Mesh(this.inspectionFillGeo, material);
    fill.position.set(mesh.position.x, top.y + 0.014, mesh.position.z);
    fill.renderOrder = 0.5;
    this.inspectionGroup.add(fill);
  }

  private addBlockadeFill(
    id: string | null,
    material: THREE.MeshBasicMaterial,
    group: THREE.Group,
    yOffset: number,
  ): void {
    if (!id) return;
    const surface = this.blockadeSurfaces.get(id);
    if (!surface) return;
    const fill = new THREE.Mesh(surface.geometry, material);
    fill.position.y = yOffset;
    fill.renderOrder = 1.4;
    group.add(fill);
  }
}

function keyToAxial(key: string): Axial {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

function hexKey(c: Axial): string {
  return `${c.q},${c.r}`;
}

function costIconForHex(hex: Hex): CostIcon | null {
  if (hex.reqSymbol) return hex.reqSymbol;
  if (hex.terrain === 'green') return 'machete';
  if (hex.terrain === 'blue') return 'paddle';
  if (hex.terrain === 'yellow') return 'coin';
  if (hex.terrain === 'finish') return 'coin';
  if (hex.terrain === 'rubble') return 'discard';
  if (hex.terrain === 'basecamp') return 'remove';
  return null;
}

function imageReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

function drawCostLabel(
  ctx: CanvasRenderingContext2D,
  icon: CostIcon,
  cost: number,
  img: HTMLImageElement | null,
): void {
  ctx.clearRect(0, 0, COST_LABEL_SIZE, COST_LABEL_SIZE);
  if (!img) return;

  for (const mark of costIconLayout(cost)) {
    drawCostIcon(ctx, img, mark.x, mark.y, mark.size, mark.rotation);
  }
}

function drawBlockadeCostLabel(ctx: CanvasRenderingContext2D, cost: number, img: HTMLImageElement | null): void {
  ctx.clearRect(0, 0, COST_LABEL_SIZE, COST_LABEL_SIZE);
  if (!img) return;

  for (const mark of costIconLayout(cost)) {
    drawCostIcon(ctx, img, mark.x, mark.y + BLOCKADE_LABEL_ICON_Y_OFFSET, mark.size, mark.rotation);
  }
}

function costIconLayout(cost: number): Array<{ x: number; y: number; size: number; rotation: number }> {
  const amount = Math.max(1, Math.min(cost, 4));
  const size = COST_ICON_DRAW_SIZE;
  if (amount === 1) return [{ x: 80, y: 80, size, rotation: 0.02 }];
  if (amount === 2) {
    return [
      { x: 50, y: 82, size, rotation: -0.14 },
      { x: 110, y: 78, size, rotation: 0.14 },
    ];
  }
  if (amount === 3) {
    return [
      { x: 80, y: 47, size, rotation: 0.02 },
      { x: 47, y: 108, size, rotation: -0.14 },
      { x: 113, y: 104, size, rotation: 0.14 },
    ];
  }
  return [
    { x: 46, y: 48, size, rotation: -0.13 },
    { x: 114, y: 46, size, rotation: 0.13 },
    { x: 46, y: 114, size, rotation: 0.13 },
    { x: 114, y: 112, size, rotation: -0.13 },
  ];
}

function drawCostIcon(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  rotation: number,
): void {
  const half = size / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.shadowColor = 'rgba(0,0,0,0.72)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, -half, -half, size, size);
  ctx.restore();
}

interface TerminalVisibility {
  hexes: Hex[];
  terminalKeys: Set<string>;
}

function visibleTerminalHexes(hexes: Hex[]): TerminalVisibility {
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

interface XZ {
  x: number;
  z: number;
}

interface BoundaryEdge {
  key: string;
  a: XZ;
  b: XZ;
  aKey: string;
  bKey: string;
}

function terminalPlateGeometry(cells: Placed[], height: number): THREE.BufferGeometry {
  const loop = terminalOutline(cells);
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
    positions.push(p.x, height, p.z);
    uvs.push((p.x - minX) / spanX, (p.z - minZ) / spanZ);
  }
  for (const p of loop) {
    positions.push(p.x, 0, p.z);
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

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.addGroup(0, topIndexCount, 0);
  g.addGroup(topIndexCount, indices.length - topIndexCount, 1);
  g.computeVertexNormals();
  return g;
}

function blockadePlateGeometry(path: XZ[], width: number, topY: number, height: number): THREE.BufferGeometry {
  const loop = stripOutline(path, width);
  if (loop.length < 3) return new THREE.BufferGeometry();

  const minX = Math.min(...loop.map((p) => p.x));
  const maxX = Math.max(...loop.map((p) => p.x));
  const minZ = Math.min(...loop.map((p) => p.z));
  const maxZ = Math.max(...loop.map((p) => p.z));
  const spanX = Math.max(maxX - minX, 0.001);
  const spanZ = Math.max(maxZ - minZ, 0.001);
  const bottomY = topY - height;

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
  return geometry;
}

function blockadeTopGeometry(path: XZ[], width: number, topY: number): THREE.BufferGeometry {
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

function blockadeBandGeometry(path: XZ[], outerWidth: number, innerWidth: number, topY: number): THREE.BufferGeometry {
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

function blockadeRimGeometry(path: XZ[], width: number, topY: number): THREE.BufferGeometry {
  const loop = stripOutline(path, width);
  if (loop.length < 2) return new THREE.BufferGeometry();
  const points = loop.map((p) => new THREE.Vector3(p.x, topY, p.z));
  points.push(points[0].clone());
  return new THREE.BufferGeometry().setFromPoints(points);
}

function stripOutline(path: XZ[], width: number): XZ[] {
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

function terminalOutline(cells: Placed[]): XZ[] {
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

function boundaryLoops(edges: BoundaryEdge[]): XZ[][] {
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

function hexCornerPoints(x: number, z: number): XZ[] {
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

function pointKey(p: XZ): string {
  return `${Math.round(p.x * 10000)},${Math.round(p.z * 10000)}`;
}

function edgeKey(a: string, b: string): string {
  return `${a}>${b}`;
}

function polygonArea(points: XZ[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

function topTriangleFacesUp(a: XZ, b: XZ, c: XZ): boolean {
  return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
}

/** A flat hexagonal ring band in the XZ plane, aligned to the hex prisms. */
function hexRingGeometry(inner: number, outer: number): THREE.BufferGeometry {
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
