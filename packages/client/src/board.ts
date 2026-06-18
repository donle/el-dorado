import * as THREE from 'three';
import { axialToPixel, type GameState, type Hex, type Axial } from '@eldorado/core';

const HEX_SIZE = 1;
const GAP = 0.92; // shrink hex slightly to show grid lines

const TERRAIN_COLOR: Record<string, number> = {
  green: 0x3a8c4f,
  blue: 0x2f6fb0,
  yellow: 0xd8b34a,
  rubble: 0x8a8f99,
  basecamp: 0xb5495b,
  mountain: 0x2b2f3a,
  start: 0x46506b,
  finish: 0xffd166,
};

const PLAYER_COLOR: Record<string, number> = {
  red: 0xe05656,
  blue: 0x4c9bef,
  green: 0x5ed17a,
  yellow: 0xf0d24c,
};

export class Board {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private raycaster = new THREE.Raycaster();
  private hexGroup = new THREE.Group();
  private pieceGroup = new THREE.Group();
  private hexMeshes = new Map<string, THREE.Mesh>();
  private highlights = new Set<string>();
  onHexClick: (c: Axial) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0e1726);
    this.scene.add(this.hexGroup, this.pieceGroup);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.5);
    dir.position.set(2, 3, 5);
    this.scene.add(dir);

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    this.camera.position.set(0, 0, 100);
    this.camera.lookAt(0, 0, 0);

    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.handleClick(e));
    this.resize();
    this.animate();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.fitCamera();
  }

  private worldPos(c: Axial): THREE.Vector2 {
    const p = axialToPixel(c, HEX_SIZE);
    return new THREE.Vector2(p.x, -p.y);
  }

  private fitCamera(): void {
    if (this.hexMeshes.size === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const mesh of this.hexMeshes.values()) {
      minX = Math.min(minX, mesh.position.x);
      maxX = Math.max(maxX, mesh.position.x);
      minY = Math.min(minY, mesh.position.y);
      maxY = Math.max(maxY, mesh.position.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const margin = 2;
    const boardW = maxX - minX + margin * 2;
    const boardH = maxY - minY + margin * 2;
    const aspect = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    let halfW = boardW / 2;
    let halfH = boardH / 2;
    if (halfW / halfH < aspect) halfW = halfH * aspect;
    else halfH = halfW / aspect;
    // left/right/top/bottom are camera-relative; the camera itself sits at (cx, cy).
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.position.set(cx, cy, 100);
    this.camera.updateProjectionMatrix();
  }

  private handleClick(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.hexMeshes.values()]);
    if (hits.length > 0) {
      const c = hits[0].object.userData as Axial;
      this.onHexClick({ q: c.q, r: c.r });
    }
  }

  /** Rebuild the board and pieces from a snapshot. */
  render(state: GameState): void {
    const first = this.hexMeshes.size === 0;
    this.hexGroup.clear();
    this.pieceGroup.clear();
    this.hexMeshes.clear();

    const hexGeo = new THREE.CircleGeometry(HEX_SIZE * GAP, 6);
    hexGeo.rotateZ(Math.PI / 6); // pointy-top

    for (const hex of state.hexes) {
      const color = TERRAIN_COLOR[hex.terrain] ?? 0x444444;
      const mat = new THREE.MeshStandardMaterial({ color });
      const mesh = new THREE.Mesh(hexGeo, mat);
      const p = this.worldPos(hex);
      mesh.position.set(p.x, p.y, 0);
      mesh.userData = { q: hex.q, r: hex.r };
      this.hexGroup.add(mesh);
      this.hexMeshes.set(`${hex.q},${hex.r}`, mesh);

      const label = this.costLabel(hex);
      if (label) {
        label.position.set(p.x, p.y, 1);
        this.hexGroup.add(label);
      }
    }

    for (const pl of state.players) {
      if (pl.finished) continue;
      const p = this.worldPos(pl.position);
      const geo = new THREE.CircleGeometry(HEX_SIZE * 0.4, 24);
      const mat = new THREE.MeshBasicMaterial({ color: PLAYER_COLOR[pl.color] ?? 0xffffff });
      const piece = new THREE.Mesh(geo, mat);
      piece.position.set(p.x, p.y, 2);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(HEX_SIZE * 0.4, HEX_SIZE * 0.5, 24),
        new THREE.MeshBasicMaterial({ color: 0x0e1726 }),
      );
      ring.position.set(p.x, p.y, 1.9);
      this.pieceGroup.add(piece, ring);
    }

    this.applyHighlights();
    if (first) this.fitCamera();
  }

  private costLabel(hex: Hex): THREE.Sprite | null {
    if (hex.cost <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(hex.cost), 32, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(0.8, 0.8, 1);
    return sprite;
  }

  setHighlights(coords: Axial[]): void {
    this.highlights = new Set(coords.map((c) => `${c.q},${c.r}`));
    this.applyHighlights();
  }

  private applyHighlights(): void {
    for (const [key, mesh] of this.hexMeshes) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (this.highlights.has(key)) {
        mat.emissive = new THREE.Color(0xffd166);
        mat.emissiveIntensity = 0.6;
      } else {
        mat.emissive = new THREE.Color(0x000000);
        mat.emissiveIntensity = 0;
      }
    }
  }
}
