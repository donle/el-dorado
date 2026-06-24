/**
 * scene/Board — facade that owns the THREE renderer/scene/lights and
 * orchestrates the per-owner layers: HexBoard, BlockadeRenderer,
 * PawnLayer, BoardCamera, BoardInput. Keeps the public API
 * (constructor + 13 methods + 4 callbacks) identical to the old god
 * class so the rest of the client (main.ts, LobbyView) doesn't notice.
 *
 * All scene-graph wiring (lights, fog, resize, rAF loop) lives here.
 * Each per-owner class is a focused unit owning its meshes, materials,
 * and animation state.
 */
import * as THREE from 'three';
import type { Axial, GameState } from '@eldorado/core';
import { BoardBackground } from '../background.js';
import {
  DESKTOP_MAX_PIXEL_RATIO,
  LOW_GPU_MAX_PIXEL_RATIO,
  IDLE_ANIMATION_FRAME_MS,
  HIDDEN_TAB_FRAME_MS,
} from '../shared/constants.js';
import { HexBoard } from './HexBoard.js';
import { BlockadeRenderer } from './BlockadeRenderer.js';
import { CostLabelAtlas } from './CostLabelAtlas.js';
import { PawnLayer } from './PawnLayer.js';
import { BoardCamera } from './BoardCamera.js';
import { BoardInput } from './BoardInput.js';

function isLowGpuDevice(): boolean {
  const coarsePointer = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || (navigator.maxTouchPoints > 1 && coarsePointer);
}

function maxPixelRatio(): number {
  return isLowGpuDevice() ? LOW_GPU_MAX_PIXEL_RATIO : DESKTOP_MAX_PIXEL_RATIO;
}

export class Board {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly cameraCtrl: BoardCamera;
  private readonly realShadows = localStorage.getItem('eldorado.highQualityShadows') === '1';
  private readonly lowGpuMode = isLowGpuDevice();

  private readonly costAtlas: CostLabelAtlas;
  private readonly hexBoard: HexBoard;
  private readonly blockadeRenderer: BlockadeRenderer;
  private readonly pawnLayer: PawnLayer;
  private readonly input: BoardInput;
  private readonly background = new BoardBackground();

  private frameRequested = false;
  private frameDelayTimer: number | null = null;
  private lastFrameTime = 0;
  private firstRender = true;

  // Callbacks the client assigns (publicly, identical to old API).
  onHexHover: (c: Axial | null) => void = () => {};
  onHexClick: (c: Axial) => void = () => {};
  onBlockadeHover: (id: string | null) => void = () => {};
  onBlockadeClick: (id: string) => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: (window.devicePixelRatio || 1) <= maxPixelRatio(),
      powerPreference: 'low-power',
    });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio()));
    this.renderer.shadowMap.enabled = this.realShadows;
    if (this.realShadows) this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x8fb8c2);
    this.scene.background = new THREE.Color(0x8fb8c2);
    this.scene.fog = new THREE.Fog(0x8fb59a, 48, 125);

    this.cameraCtrl = new BoardCamera(canvas);
    this.cameraCtrl.controls.addEventListener('change', () => this.requestFrame());

    this.costAtlas = new CostLabelAtlas();
    this.hexBoard = new HexBoard(
      this.costAtlas,
      () => this.requestFrame(),
      this.realShadows,
    );
    this.blockadeRenderer = new BlockadeRenderer(
      this.hexBoard,
      this.costAtlas,
      () => this.requestFrame(),
      this.realShadows,
    );
    this.pawnLayer = new PawnLayer(
      this.hexBoard,
      this.overlayScene,
      this.realShadows,
      this.lowGpuMode,
    );
    this.input = new BoardInput(
      canvas,
      this.scene,
      this.hexBoard,
      this.blockadeRenderer,
      this.cameraCtrl,
      {
        onHexHover: (c) => this.onHexHover(c),
        onHexClick: (c) => this.onHexClick(c),
        onBlockadeHover: (id) => this.onBlockadeHover(id),
        onBlockadeClick: (id) => this.onBlockadeClick(id),
      },
      () => this.requestFrame(),
    );

    this.scene.add(
      this.background.group,
      this.hexBoard.group,
      this.blockadeRenderer.group,
      this.input.inspectionGroup,
      this.pawnLayer.group,
      this.input.highlightGroup,
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

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('eldorado:texture-loaded', () => this.requestFrame());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.requestFrame();
    });
    this.resize();
    this.requestFrame();
  }

  // --- public API --------------------------------------------------------

  setViewMode(mode: '3d' | '2d'): void {
    this.cameraCtrl.setViewMode(mode);
    this.requestFrame();
  }

  setSelfPlayerId(playerId: string | null): void {
    this.pawnLayer.setSelfPlayerId(playerId);
    this.requestFrame();
  }

  panToPlayerIfOffscreen(playerId: string | null): void {
    this.cameraCtrl.panToPlayerIfOffscreen(playerId, this.pawnLayer);
    this.requestFrame();
  }

  render(state: GameState): void {
    const first = this.firstRender;
    this.background.build(state.hexes, (c) => this.hexBoard.worldXZ(c));
    this.hexBoard.render(state);
    this.blockadeRenderer.render(state.blockades ?? []);
    this.pawnLayer.render(state);
    if (first) {
      this.cameraCtrl.fitInitial(state, this.hexBoard);
      this.firstRender = false;
    }
    this.requestFrame();
  }

  clearHover(): void {
    this.input.clearHover();
  }

  setInfoHoverHex(coord: Axial | null): void {
    this.input.setInfoHoverHex(coord);
  }

  setInfoHoverBlockade(id: string | null): void {
    this.input.setInfoHoverBlockade(id);
  }

  clearInfoHover(): void {
    this.input.clearInfoHover();
  }

  setInspectedHex(coord: Axial | null): void {
    this.input.setInspectedHex(coord);
  }

  setInspectedBlockade(id: string | null): void {
    this.input.setInspectedBlockade(id);
  }

  setHighlights(coords: Axial[]): void {
    this.input.setHighlights(coords);
  }

  setBlockadeHighlights(ids: string[]): void {
    this.input.setBlockadeHighlights(ids);
  }

  // --- frame driver ------------------------------------------------------

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
    const pawnsMoving = this.pawnLayer.step(dt);
    const cameraMoving = this.cameraCtrl.step(time);
    const animatingSelf = this.pawnLayer.animate(time);
    this.renderer.clear();
    this.renderer.render(this.scene, this.cameraCtrl.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.overlayScene, this.cameraCtrl.camera);
    if (pawnsMoving || cameraMoving) this.requestFrame();
    else if (animatingSelf.selfMarkerMoving || animatingSelf.turnGlowMoving) {
      this.requestFrame(document.hidden ? HIDDEN_TAB_FRAME_MS : IDLE_ANIMATION_FRAME_MS);
    }
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio()));
    this.renderer.setSize(w, h, false);
    this.cameraCtrl.resize(w, h);
    this.requestFrame();
  }
}