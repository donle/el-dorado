/**
 * scene/PawnLayer — owns the player pawns on the board: their meshes,
 * the self-marker arrow above the local player's pawn, and the
 * turn-glow ring that pulses around the active pawn.
 *
 * The facade calls `step(dt)` every frame to advance pawn tweens and
 * `animate(time)` to advance the self-marker / turn-glow loops. The
 * facade also calls `setSelfPlayerId` and `render(state)` to rebuild
 * pawns when the player list or positions change.
 */
import * as THREE from 'three';
import type { GameState } from '@eldorado/core';
import { PLAYER_COLOR } from '../shared/palette.js';
import {
  SELF_ARROW_HEAD_LENGTH,
  SELF_ARROW_SHAFT_LENGTH,
  SELF_ARROW_BASE_Y,
  SELF_ARROW_BOB,
} from '../shared/constants.js';
import type { HexBoard } from './HexBoard.js';

const ACTIVE_PAWN_GLOW_GEO = new THREE.PlaneGeometry(1.45, 1.45).rotateX(-Math.PI / 2);
const ACTIVE_PAWN_RING_GEO = new THREE.RingGeometry(0.42, 0.56, 48).rotateX(-Math.PI / 2);
const ACTIVE_PAWN_RAY_GEO = new THREE.PlaneGeometry(0.44, 1.08);
const ACTIVE_PAWN_FLAME_GEO = new THREE.ConeGeometry(0.16, 0.74, 5, 1, true);

const SELF_ARROW_HEAD_GEO = new THREE.ConeGeometry(0.22, SELF_ARROW_HEAD_LENGTH, 28).rotateX(Math.PI);
const SELF_ARROW_SHAFT_GEO = new THREE.CylinderGeometry(0.055, 0.055, SELF_ARROW_SHAFT_LENGTH, 20);
const SELF_ARROW_SHAFT_RING_GEO = new THREE.TorusGeometry(0.064, 0.009, 8, 28).rotateX(Math.PI / 2);
const SELF_ARROW_HEAD_BASE_RING_GEO = new THREE.TorusGeometry(0.224, 0.012, 8, 32).rotateX(Math.PI / 2);
const SELF_ARROW_GUARD_GEO = new THREE.CylinderGeometry(0.13, 0.13, 0.026, 28);

interface PawnState {
  group: THREE.Group;
  target: THREE.Vector3;
  selfMarker: THREE.Group;
}

export class PawnLayer {
  readonly group = new THREE.Group();

  private readonly pawns = new Map<string, PawnState>();
  private selfPlayerId: string | null = null;
  private glowTextureCache: THREE.CanvasTexture | null = null;
  private rayTextureCache: THREE.CanvasTexture | null = null;

  constructor(
    private readonly hexBoard: HexBoard,
    private readonly overlayScene: THREE.Scene,
    private readonly realShadows: boolean,
    private readonly lowGpuMode: boolean,
  ) {}

  /** Reconcile persistent pawns with the current player list. */
  render(state: GameState): void {
    const present = new Set<string>();
    const activePlayerId = state.phase === 'playing' ? state.turn?.playerId ?? null : null;
    for (const pl of state.players) {
      present.add(pl.id);
      const { x, z } = this.hexBoard.worldXZ(pl.position);
      const y = this.hexBoard.getHexTop(`${pl.position.q},${pl.position.r}`)?.landing ?? 0.3;
      let pawn = this.pawns.get(pl.id);
      if (!pawn) {
        const group = this.makePawn(PLAYER_COLOR[pl.color] ?? 0xffffff, x, y, z);
        const selfMarker = this.makeSelfMarker();
        this.overlayScene.add(selfMarker);
        this.group.add(group);
        selfMarker.visible = pl.id === this.selfPlayerId;
        pawn = { group, target: new THREE.Vector3(x, y, z), selfMarker };
        this.pawns.set(pl.id, pawn);
      } else {
        pawn.target.set(x, y, z);
        pawn.selfMarker.visible = pl.id === this.selfPlayerId;
      }
      this.setTurnActive(pawn, pl.id === activePlayerId);
    }
    for (const [id, pawn] of this.pawns) {
      if (!present.has(id)) {
        this.group.remove(pawn.group);
        this.overlayScene.remove(pawn.selfMarker);
        this.pawns.delete(id);
      }
    }
  }

  setSelfPlayerId(playerId: string | null): void {
    if (this.selfPlayerId === playerId) return;
    this.selfPlayerId = playerId;
    this.refreshSelfMarkers();
  }

  /** World position of a player's pawn, or null if the player isn't on the board. */
  pawnPosition(playerId: string): THREE.Vector3 | null {
    return this.pawns.get(playerId)?.target ?? null;
  }

  /** Advance the pawn tween. Returns true if any pawn is still moving. */
  step(dt: number): boolean {
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

  /** Pulse the self-marker arrow + active pawn glow. Returns true if any
   *  still wants another frame (used by the facade to keep requesting). */
  animate(time: number): { selfMarkerMoving: boolean; turnGlowMoving: boolean } {
    return {
      selfMarkerMoving: this.animateSelfMarkers(time),
      turnGlowMoving: this.animateTurnGlows(time),
    };
  }

  // --- internals ---------------------------------------------------------

  private refreshSelfMarkers(): void {
    for (const [id, pawn] of this.pawns) {
      pawn.selfMarker.visible = id === this.selfPlayerId;
    }
  }

  private setTurnActive(pawn: PawnState, active: boolean): void {
    const glow = pawn.group.userData.turnGlow as THREE.Group | undefined;
    if (glow) glow.visible = active;
  }

  private makePawn(color: number, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const turnGlow = this.makeTurnGlow(color);
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

  private makeTurnGlow(color: number): THREE.Group {
    const group = new THREE.Group();
    group.position.y = 0.026;
    group.visible = false;
    group.frustumCulled = false;

    const tint = new THREE.Color(color).lerp(new THREE.Color(0xffd166), 0.48);
    const glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTexture(),
      color: tint,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(ACTIVE_PAWN_GLOW_GEO, glowMat);
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
    const ring = new THREE.Mesh(ACTIVE_PAWN_RING_GEO, ringMat);
    ring.position.y = 0.006;
    ring.renderOrder = 37;

    const rays: THREE.Mesh[] = [];
    if (!this.lowGpuMode) {
      for (let i = 0; i < 3; i++) {
        const baseRotation = (Math.PI * 2 * i) / 3 + 0.24;
        const rayMat = new THREE.MeshBasicMaterial({
          map: this.rayTexture(),
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
    }

    const flames: THREE.Mesh[] = [];
    if (!this.lowGpuMode) {
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
    }

    group.userData.glowMat = glowMat;
    group.userData.ringMat = ringMat;
    group.userData.rays = rays;
    group.userData.flames = flames;
    group.add(glow, ring);
    return group;
  }

  private glowTexture(): THREE.CanvasTexture {
    if (this.glowTextureCache) return this.glowTextureCache;
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
    this.glowTextureCache = texture;
    return texture;
  }

  private rayTexture(): THREE.CanvasTexture {
    if (this.rayTextureCache) return this.rayTextureCache;
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
    this.rayTextureCache = texture;
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

  private animateSelfMarkers(time: number): boolean {
    let visible = false;
    const t = time * 0.001;
    for (const pawn of this.pawns.values()) {
      const marker = pawn.selfMarker;
      if (!marker.visible) continue;

      const pulseValue = (Math.sin(t * 5.4) + 1) / 2;
      const pulse = 1 + (pulseValue - 0.5) * 0.14;
      marker.position.set(
        pawn.group.position.x,
        pawn.group.position.y + SELF_ARROW_BASE_Y + (this.lowGpuMode ? 0 : Math.sin(t * 4.2) * SELF_ARROW_BOB),
        pawn.group.position.z,
      );
      if (this.lowGpuMode) continue;
      visible = true;
      marker.scale.setScalar(pulse);

      const arrowMat = marker.userData.arrowMat as THREE.MeshBasicMaterial | undefined;
      const highlightMat = marker.userData.highlightMat as THREE.MeshBasicMaterial | undefined;
      arrowMat?.color.setHSL(0.09, 0.92, 0.43 + pulseValue * 0.03);
      highlightMat?.color.setHSL(0.1, 0.82, 0.5 + pulseValue * 0.03);
    }
    return visible;
  }

  private animateTurnGlows(time: number): boolean {
    let visible = false;
    const t = time * 0.001;
    for (const pawn of this.pawns.values()) {
      const group = pawn.group.userData.turnGlow as THREE.Group | undefined;
      if (!group?.visible) continue;
      if (this.lowGpuMode) {
        group.scale.setScalar(1);
        group.rotation.y = 0;
        continue;
      }
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