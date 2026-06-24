/**
 * scene/BoardInput — owns pointer events, hover, click, and the
 * highlight / inspection overlay state.
 *
 * The input layer is the natural "highlight coordinator": it queries
 * HexBoard and BlockadeRenderer for the meshes / surfaces it needs to
 * overlay. Callbacks (`onHexHover`, `onHexClick`, etc.) bubble up to the
 * facade so the client can react.
 */
import * as THREE from 'three';
import { type Axial } from '@eldorado/core';
import { HEX_SIZE } from '../shared/constants.js';
import { hexRingGeometry, keyToAxial } from './geom.js';
import type { HexBoard } from './HexBoard.js';
import type { BlockadeRenderer } from './BlockadeRenderer.js';
import type { BoardCamera } from './BoardCamera.js';

type PickTarget = { kind: 'hex'; key: string } | { kind: 'blockade'; id: string };

export interface InputCallbacks {
  onHexHover: (c: Axial | null) => void;
  onHexClick: (c: Axial) => void;
  onBlockadeHover: (id: string | null) => void;
  onBlockadeClick: (id: string) => void;
}

export class BoardInput {
  readonly highlightGroup = new THREE.Group();
  readonly inspectionGroup = new THREE.Group();
  private readonly hoverGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();

  private hoverKey: string | null = null;
  private hoverBlockadeId: string | null = null;
  private infoHoverKey: string | null = null;
  private infoHoverBlockadeId: string | null = null;
  private inspectedKey: string | null = null;
  private inspectedBlockadeId: string | null = null;

  private readonly highlights = new Set<string>();
  private readonly blockadeHighlights = new Set<string>();
  private highlightMeshes: THREE.Mesh[] = [];
  private ringGeo: THREE.BufferGeometry | null = null;

  private readonly inspectionFillGeo = new THREE.CylinderGeometry(HEX_SIZE * 0.84, HEX_SIZE * 0.84, 0.012, 6);
  private readonly inspectedFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x4cc9f0,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    depthTest: true,
  });
  private readonly hoverFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x72f2d6,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    depthTest: true,
  });
  private readonly blockadeInspectedMaterial = new THREE.MeshBasicMaterial({
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
  private readonly blockadeHoverMaterial = new THREE.MeshBasicMaterial({
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

  private downPos: { x: number; y: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
    private readonly hexBoard: HexBoard,
    private readonly blockadeRenderer: BlockadeRenderer,
    private readonly cameraCtrl: BoardCamera,
    private readonly callbacks: InputCallbacks,
    private readonly requestFrame: () => void,
  ) {
    this.buildHoverMarker();
    canvas.addEventListener('pointerdown', (e) => (this.downPos = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    canvas.addEventListener('pointermove', (e) => {
      if (this.downPos) return; // mid-drag — don't hover
      this.setHoverTarget(this.pickTarget(e));
    });
    canvas.addEventListener('pointerleave', () => this.setHoverTarget(null));
  }

  // --- public API the facade forwards --------------------------------------

  setHighlights(coords: Axial[]): void {
    this.highlights.clear();
    for (const c of coords) this.highlights.add(`${c.q},${c.r}`);
    this.applyHighlights();
    this.applyInspectionHighlights();
    this.updateHoverAffordance();
    this.requestFrame();
  }

  setBlockadeHighlights(ids: string[]): void {
    this.blockadeHighlights.clear();
    for (const id of ids) this.blockadeHighlights.add(id);
    this.applyHighlights();
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

  clearHover(): void {
    this.setHoverTarget(null);
  }

  // --- internals ----------------------------------------------------------

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
    this.hoverGroup.add(fill, arrow);
    this.hoverGroup.visible = false;
    this.scene.add(this.hoverGroup);
  }

  private pickTarget(e: PointerEvent): PickTarget | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.cameraCtrl.camera);
    const hits = this.raycaster.intersectObjects([
      ...this.blockadeRenderer.getPickables(),
      ...this.hexBoard.getHexPickables(),
    ]);
    if (!hits.length) return null;
    const data = hits[0].object.userData as { kind?: string; id?: string; q?: number; r?: number };
    if (data.kind === 'blockade' && data.id) return { kind: 'blockade', id: data.id };
    if (typeof data.q === 'number' && typeof data.r === 'number') return { kind: 'hex', key: `${data.q},${data.r}` };
    return null;
  }

  private setHoverTarget(target: PickTarget | null): void {
    const prevKey = this.hoverKey;
    const prevBlockadeId = this.hoverBlockadeId;
    this.hoverKey = target?.kind === 'hex' ? target.key : null;
    this.hoverBlockadeId = target?.kind === 'blockade' ? target.id : null;
    if (prevKey !== this.hoverKey) this.callbacks.onHexHover(this.hoverKey ? keyToAxial(this.hoverKey) : null);
    if (prevBlockadeId !== this.hoverBlockadeId) this.callbacks.onBlockadeHover(this.hoverBlockadeId);
    if (prevKey !== this.hoverKey || prevBlockadeId !== this.hoverBlockadeId) {
      this.applyInspectionHighlights();
      this.requestFrame();
    }
    this.updateHoverAffordance();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.downPos) return;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    this.downPos = null;
    if (moved > 6) return; // it was a drag (pan/rotate), not a click
    const target = this.pickTarget(e);
    if (target?.kind === 'hex') {
      const [q, r] = target.key.split(',').map(Number);
      this.callbacks.onHexClick({ q, r });
    } else if (target?.kind === 'blockade') {
      this.callbacks.onBlockadeClick(target.id);
    }
  }

  private updateHoverAffordance(): void {
    const wasVisible = this.hoverGroup.visible;
    const key = this.hoverKey ?? this.infoHoverKey;
    const reachableHex = !!key && this.highlights.has(key);
    if (reachableHex) {
      const mesh = this.hexBoard.getHexMesh(key!);
      const top = this.hexBoard.getHexTop(key!);
      if (mesh && top) {
        this.hoverGroup.position.set(mesh.position.x, top.y, mesh.position.z);
        this.hoverGroup.visible = true;
        this.canvas.style.cursor = 'pointer';
      }
    } else {
      this.hoverGroup.visible = false;
      this.canvas.style.cursor = (this.hoverBlockadeId ?? this.infoHoverBlockadeId) ? 'pointer' : '';
    }
    if (wasVisible !== this.hoverGroup.visible) this.requestFrame();
  }

  private applyHighlights(): void {
    this.highlightGroup.clear();
    this.highlightMeshes = [];
    if (!this.ringGeo) this.ringGeo = hexRingGeometry(HEX_SIZE * 0.82, HEX_SIZE * 1.02);
    for (const k of this.highlights) {
      const mesh = this.hexBoard.getHexMesh(k);
      const top = this.hexBoard.getHexTop(k);
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
      this.addBlockadeFill(id, this.blockadeRenderer.moveHighlightMaterial(), this.highlightGroup, 0.035);
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
    const mesh = this.hexBoard.getHexMesh(key);
    const top = this.hexBoard.getHexTop(key);
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
    const surface = this.blockadeRenderer.getSurface(id);
    if (!surface) return;
    const fill = new THREE.Mesh(surface.geometry, material);
    fill.position.y = yOffset;
    fill.renderOrder = 1.4;
    group.add(fill);
  }
}