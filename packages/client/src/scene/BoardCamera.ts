/**
 * scene/BoardCamera — owns the perspective camera, OrbitControls, and
 * the camera animation state machine (intro pan, "pan to player").
 *
 * The camera is read by BoardInput for raycasting and by the facade for
 * the resize handler. HexBoard queries `worldXZ` for placement but never
 * the camera directly.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { neighbors, type GameState, type Hex } from '@eldorado/core';
import {
  TOP_DOWN_POLAR,
  START_CONTINENT_DISTANCE_SCALE,
  START_CAMERA_ANIMATION_MS,
} from '../shared/constants.js';
import { axialEdgeKey, hexKey } from './geom.js';
import type { HexBoard } from './HexBoard.js';
import type { PawnLayer } from './PawnLayer.js';

interface CameraAnimation {
  startedAt: number;
  durationMs: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

export class BoardCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private viewMode: '3d' | '2d' = '3d';
  private animation: CameraAnimation | null = null;
  private lastFit: { cx: number; cz: number; dist: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
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
  }

  setViewMode(mode: '3d' | '2d'): void {
    if (this.viewMode === mode) return;
    this.viewMode = mode;
    const target = this.lastFit ?? {
      cx: this.controls.target.x,
      cz: this.controls.target.z,
      dist: Math.max(this.camera.position.distanceTo(this.controls.target), 12),
    };
    this.applyPose(target.cx, target.cz, target.dist);
  }

  /** Pick a "fit the board in view" pose and animate to it. */
  fitInitial(state: GameState, hexBoard: HexBoard): void {
    const visibleHexes = state.hexes;
    const fullFit = this.fitFor(visibleHexes, hexBoard);
    const startCount = visibleHexes.filter((hex) => hex.terrain === 'start').length;
    const startContinent = this.startContinentHexes(state, visibleHexes);
    if (fullFit && startContinent.length >= startCount && startContinent.length > 0) {
      const targetFit = this.fitFor(startContinent, hexBoard);
      if (!targetFit) return this.fitCamera(visibleHexes, hexBoard);
      const targetDist = targetFit.dist * START_CONTINENT_DISTANCE_SCALE;
      this.applyPose(fullFit.cx, fullFit.cz, fullFit.dist, { maxDistance: fullFit.dist * 1.8 });
      this.lastFit = { cx: targetFit.cx, cz: targetFit.cz, dist: targetDist };
      this.animateTo(targetFit.cx, targetFit.cz, targetDist, {
        topDown: true,
        maxDistance: fullFit.dist * 1.8,
      });
      return;
    }
    this.fitCamera(visibleHexes, hexBoard);
  }

  /** Smooth-pan to a player if their pawn is off-screen. */
  panToPlayerIfOffscreen(playerId: string | null, pawnLayer: PawnLayer): void {
    if (!playerId) return;
    const pos = pawnLayer.pawnPosition(playerId);
    if (!pos || this.isWorldPointInView(pos)) return;
    const nextTarget = new THREE.Vector3(pos.x, this.controls.target.y, pos.z);
    const delta = nextTarget.clone().sub(this.controls.target);
    this.animation = {
      startedAt: performance.now(),
      durationMs: 650,
      fromPosition: this.camera.position.clone(),
      toPosition: this.camera.position.clone().add(delta),
      fromTarget: this.controls.target.clone(),
      toTarget: nextTarget,
    };
  }

  /** Advance the camera animation. Returns true while it's still running. */
  step(time: number): boolean {
    const anim = this.animation;
    if (!anim) return false;
    const raw = Math.min(1, Math.max(0, (time - anim.startedAt) / anim.durationMs));
    const eased = easeInOut(raw);
    this.camera.position.lerpVectors(anim.fromPosition, anim.toPosition, eased);
    this.controls.target.lerpVectors(anim.fromTarget, anim.toTarget, eased);
    this.controls.update();
    this.camera.updateMatrixWorld(true);
    if (raw >= 1) {
      this.camera.position.copy(anim.toPosition);
      this.controls.target.copy(anim.toTarget);
      this.controls.update();
      this.animation = null;
      return false;
    }
    return true;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- internals ---------------------------------------------------------

  private isWorldPointInView(point: THREE.Vector3): boolean {
    this.camera.updateMatrixWorld(true);
    const projected = point.clone();
    projected.y += 0.9;
    projected.project(this.camera);
    return projected.z >= -1
      && projected.z <= 1
      && projected.x >= -0.92
      && projected.x <= 0.92
      && projected.y >= -0.88
      && projected.y <= 0.88;
  }

  private fitFor(hexes: Hex[], hexBoard: HexBoard): { cx: number; cz: number; dist: number } | null {
    if (hexes.length === 0) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const hex of hexes) {
      const { x, z } = hexBoard.worldXZ(hex);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 2;
    const dist = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.1;
    return { cx, cz, dist };
  }

  private fitCamera(hexes: Hex[], hexBoard: HexBoard): void {
    const fit = this.fitFor(hexes, hexBoard);
    if (!fit) return;
    const { cx, cz } = fit;
    const dist = fit.dist;
    this.lastFit = { cx, cz, dist };
    this.applyPose(cx, cz, dist);
  }

  private applyPose(
    cx: number,
    cz: number,
    dist: number,
    options: { topDown?: boolean; maxDistance?: number } = {},
  ): void {
    this.controls.maxDistance = options.maxDistance ?? dist * 1.8;
    const pose = this.computePose(cx, cz, dist, options);
    this.controls.target.copy(pose.target);
    this.controls.enableRotate = this.viewMode === '3d';
    if (this.viewMode === '2d') {
      this.controls.minPolarAngle = TOP_DOWN_POLAR;
      this.controls.maxPolarAngle = TOP_DOWN_POLAR;
    } else {
      this.controls.minPolarAngle = 0.15; // keep a 2.5D tilt — never fully top-down
      this.controls.maxPolarAngle = 1.05; // and never too flat
    }
    this.camera.position.copy(pose.position);
    this.controls.update();
    this.camera.updateMatrixWorld(true);
  }

  private computePose(
    cx: number,
    cz: number,
    dist: number,
    options: { topDown?: boolean } = {},
  ): { target: THREE.Vector3; position: THREE.Vector3 } {
    const target = new THREE.Vector3(cx, 0, cz);
    if (this.viewMode === '2d') {
      return { target, position: new THREE.Vector3(cx, dist * 1.05, cz + dist * TOP_DOWN_POLAR) };
    }
    if (options.topDown) {
      return { target, position: new THREE.Vector3(cx, dist * 0.99, cz + dist * 0.16) };
    }
    // Tilted 2.5D vantage: above and toward +z.
    return { target, position: new THREE.Vector3(cx, dist * 0.82, cz + dist * 0.62) };
  }

  private animateTo(
    cx: number,
    cz: number,
    dist: number,
    options: { topDown?: boolean; maxDistance?: number } = {},
  ): void {
    this.controls.maxDistance = options.maxDistance ?? dist * 1.8;
    const pose = this.computePose(cx, cz, dist, options);
    this.animation = {
      startedAt: performance.now(),
      durationMs: START_CAMERA_ANIMATION_MS,
      fromPosition: this.camera.position.clone(),
      toPosition: pose.position,
      fromTarget: this.controls.target.clone(),
      toTarget: pose.target,
    };
  }

  /** The continent reachable from every start hex, treating blockades
   *  as walls. Used to fit the opening camera on the player side. */
  private startContinentHexes(state: GameState, visibleHexes: Hex[]): Hex[] {
    const byKey = new Map(visibleHexes.map((hex) => [hexKey(hex), hex]));
    const starts = visibleHexes
      .filter((hex) => hex.terrain === 'start')
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .map(hexKey);
    if (starts.length === 0) return [];

    const blocked = new Set<string>();
    for (const blockade of state.blockades ?? []) {
      const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
      for (const edge of edges) {
        blocked.add(axialEdgeKey(edge.a, edge.b));
        blocked.add(axialEdgeKey(edge.b, edge.a));
      }
    }

    const seen = new Set<string>(starts);
    const queue = [...starts];
    while (queue.length) {
      const cur = byKey.get(queue.shift()!)!;
      for (const next of neighbors(cur)) {
        const nextKey = hexKey(next);
        if (!byKey.has(nextKey) || seen.has(nextKey)) continue;
        if (blocked.has(axialEdgeKey(cur, next))) continue;
        seen.add(nextKey);
        queue.push(nextKey);
      }
    }
    return [...seen].map((key) => byKey.get(key)!);
  }
}

/** Cosine-based ease-in-out — matches the old `cameraIntroEase`. */
function easeInOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 0.5 - Math.cos(x * Math.PI) * 0.5;
}