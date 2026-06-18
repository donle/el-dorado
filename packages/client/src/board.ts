import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { axialToPixel, type GameState, type Hex, type Axial, type Terrain } from '@eldorado/core';
import { terrainTexture, groundTexture } from './textures.js';
import { Decorations, type Placed } from './decor.js';

const HEX_SIZE = 1;
const GAP = 0.94;

const SIDE_COLOR: Record<string, number> = {
  green: 0x2a6b3c,
  blue: 0x21507f,
  yellow: 0xb89234,
  rubble: 0x6d727c,
  basecamp: 0x7e3540,
  mountain: 0x1a1d24,
  start: 0x3c4566,
  finish: 0xc79a32,
};

const PLAYER_COLOR: Record<string, number> = {
  red: 0xe05656,
  blue: 0x4c9bef,
  green: 0x5ed17a,
  yellow: 0xf0d24c,
};

function terrainHeight(t: Terrain, cost: number): number {
  if (t === 'mountain') return 1.4;
  if (t === 'finish') return 0.55;
  if (t === 'start') return 0.3;
  return 0.3 + cost * 0.12;
}

export class Board {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private hexGroup = new THREE.Group();
  private pieceGroup = new THREE.Group();
  private highlightGroup = new THREE.Group();
  private hexMeshes = new Map<string, THREE.Mesh>();
  private hexTops = new Map<string, { y: number }>();
  private highlights = new Set<string>();
  private hexGeoCache = new Map<string, THREE.CylinderGeometry>();
  private downPos: { x: number; y: number } | null = null;
  private decor = new Decorations();
  private clock = new THREE.Clock();
  onHexClick: (c: Axial) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color(0x0a1120);
    this.scene.fog = new THREE.Fog(0x0a1120, 40, 90);
    this.scene.add(this.hexGroup, this.pieceGroup, this.highlightGroup, this.decor.group);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.1);
    key.position.set(-8, 16, 10);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(10, 8, -6);
    this.scene.add(fill);

    // Backdrop ground plane.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    this.scene.add(ground);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.camera.position.set(0, 20, 16);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
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

    window.addEventListener('resize', () => this.resize());
    // Distinguish a click (select hex) from a drag (camera move).
    canvas.addEventListener('pointerdown', (e) => (this.downPos = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    this.resize();
    this.animate();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.decor.update(this.clock.getElapsedTime());
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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

  render(state: GameState): void {
    const first = this.hexMeshes.size === 0;
    this.hexGroup.clear();
    this.pieceGroup.clear();
    this.highlightGroup.clear();
    this.hexMeshes.clear();
    this.hexTops.clear();
    const placed: Placed[] = [];

    for (const hex of state.hexes) {
      const h = terrainHeight(hex.terrain, hex.cost);
      const geo = this.hexGeo(`${hex.terrain}:${h.toFixed(2)}`, h);
      const top = new THREE.MeshStandardMaterial({
        map: terrainTexture(hex.terrain),
        roughness: 0.85,
      });
      const side = new THREE.MeshStandardMaterial({
        color: SIDE_COLOR[hex.terrain] ?? 0x445,
        roughness: 0.95,
      });
      // CylinderGeometry material groups: [side, top, bottom]
      const mesh = new THREE.Mesh(geo, [side, top, side]);
      const { x, z } = this.worldXZ(hex);
      mesh.position.set(x, h / 2, z);
      mesh.userData = { q: hex.q, r: hex.r };
      this.hexGroup.add(mesh);
      this.hexMeshes.set(`${hex.q},${hex.r}`, mesh);
      this.hexTops.set(`${hex.q},${hex.r}`, { y: h });
      placed.push({ hex, x, z, top: h });

      const label = this.costLabel(hex);
      if (label) {
        label.position.set(x, h + 0.45, z);
        this.hexGroup.add(label);
      }
    }

    this.decor.build(placed);

    for (const pl of state.players) {
      if (pl.finished) continue;
      const { x, z } = this.worldXZ(pl.position);
      const y = this.hexTops.get(`${pl.position.q},${pl.position.r}`)?.y ?? 0.3;
      this.pieceGroup.add(this.makePawn(PLAYER_COLOR[pl.color] ?? 0xffffff, x, y, z));
    }

    this.applyHighlights();
    if (first) this.fitCamera(state);
  }

  private makePawn(color: number, x: number, y: number, z: number): THREE.Group {
    const g = new THREE.Group();
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
    g.add(ring, base, body, head);
    g.position.set(x, y, z);
    return g;
  }

  private costLabel(hex: Hex): THREE.Sprite | null {
    if (hex.cost <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(32, 32, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 38px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(hex.cost), 32, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
    sprite.scale.set(0.7, 0.7, 1);
    return sprite;
  }

  private fitCamera(state: GameState): void {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const hex of state.hexes) {
      const { x, z } = this.worldXZ(hex);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 2;
    const dist = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.1;
    this.controls.target.set(cx, 0, cz);
    // Tilted 2.5D vantage: above and toward +z.
    this.camera.position.set(cx, dist * 0.82, cz + dist * 0.62);
    this.controls.maxDistance = dist * 1.8;
    this.controls.update();
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.downPos) return;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    this.downPos = null;
    if (moved > 6) return; // it was a drag (pan/rotate), not a click

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

  setHighlights(coords: Axial[]): void {
    this.highlights = new Set(coords.map((c) => `${c.q},${c.r}`));
    this.applyHighlights();
  }

  private applyHighlights(): void {
    this.highlightGroup.clear();
    // A thin hex prism overlay, same orientation as the hexes, that pokes out
    // past the GAP so it reads as a glowing rim.
    const geo = new THREE.CylinderGeometry(HEX_SIZE * 0.99, HEX_SIZE * 0.99, 0.12, 6);
    for (const k of this.highlights) {
      const mesh = this.hexMeshes.get(k);
      const top = this.hexTops.get(k);
      if (!mesh || !top) continue;
      const overlay = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.4 }),
      );
      overlay.position.set(mesh.position.x, top.y + 0.06, mesh.position.z);
      this.highlightGroup.add(overlay);
    }
  }
}
