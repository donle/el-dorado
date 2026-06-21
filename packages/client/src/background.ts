import * as THREE from 'three';
import type { Axial, Hex } from '@eldorado/core';

const GROUND_Y = -0.08;
const GROUND_TEXTURE_URL = '/textures/golden-city-ground.jpg';

interface WorldPoint {
  x: number;
  z: number;
}

interface BoardBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
  width: number;
  depth: number;
  radius: number;
  start: WorldPoint;
  finish: WorldPoint;
  dir: WorldPoint;
}

function hexShadowGeometry(): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(1, 6);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function average(points: WorldPoint[], fallback: WorldPoint): WorldPoint {
  if (!points.length) return fallback;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
  };
}

function normalize(p: WorldPoint, fallback: WorldPoint): WorldPoint {
  const d = Math.hypot(p.x, p.z);
  if (d < 0.001) return fallback;
  return { x: p.x / d, z: p.z / d };
}

function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x7fb5ca) },
      horizonColor: { value: new THREE.Color(0xd7d0a6) },
      lowColor: { value: new THREE.Color(0x4f7a48) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 lowColor;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        vec3 sky = mix(horizonColor, topColor, smoothstep(0.02, 0.82, h));
        sky = mix(lowColor, sky, smoothstep(-0.2, 0.12, h));
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
}

function groundTexture(): THREE.Texture {
  const tex = new THREE.TextureLoader().load(GROUND_TEXTURE_URL, () => {
    window.dispatchEvent(new Event('eldorado:texture-loaded'));
  });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

function groundAlphaTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(256, 256, 120, 256, 256, 255);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.74, '#ffffff');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function softBoardShadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 245);
  g.addColorStop(0, 'rgba(5, 10, 3, 0.32)');
  g.addColorStop(0.55, 'rgba(5, 10, 3, 0.18)');
  g.addColorStop(0.82, 'rgba(5, 10, 3, 0.07)');
  g.addColorStop(1, 'rgba(5, 10, 3, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  return new THREE.CanvasTexture(c);
}

function softGoldGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 126);
  g.addColorStop(0, 'rgba(255, 216, 100, 0.55)');
  g.addColorStop(0.45, 'rgba(255, 195, 66, 0.24)');
  g.addColorStop(1, 'rgba(255, 195, 66, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export class BoardBackground {
  readonly group = new THREE.Group();
  private key = '';
  private texture: THREE.Texture | null = null;
  private alphaTexture: THREE.Texture | null = null;
  private boardShadowTexture: THREE.Texture | null = null;
  private goldGlowTexture: THREE.Texture | null = null;

  build(hexes: Hex[], worldXZ: (coord: Axial) => WorldPoint): void {
    const bounds = this.measure(hexes, worldXZ);
    if (!bounds) return;
    const key = [
      bounds.minX.toFixed(2),
      bounds.maxX.toFixed(2),
      bounds.minZ.toFixed(2),
      bounds.maxZ.toFixed(2),
      bounds.finish.x.toFixed(2),
      bounds.finish.z.toFixed(2),
    ].join(':');
    if (key === this.key) return;
    this.key = key;

    this.group.clear();
    this.addSky(bounds);
    this.addTextureGround(bounds);
    this.addHexContactShadows(hexes, worldXZ);
    this.addBoardShadow(bounds);
    this.addFinishGlow(bounds);
  }

  update(_t: number): void {
    // Static illustrated texture. Kept as a hook so Board can update all scene layers uniformly.
  }

  private measure(hexes: Hex[], worldXZ: (coord: Axial) => WorldPoint): BoardBounds | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const starts: WorldPoint[] = [];
    const finishes: WorldPoint[] = [];

    for (const hex of hexes) {
      const p = worldXZ(hex);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      if (hex.terrain === 'start') starts.push(p);
      if (hex.terrain === 'finish') finishes.push(p);
    }

    if (!Number.isFinite(minX)) return null;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const start = average(starts, { x: minX, z: cz });
    const finish = average(finishes, { x: maxX, z: cz });
    const dir = normalize({ x: finish.x - start.x, z: finish.z - start.z }, { x: 1, z: 0 });

    return {
      minX,
      maxX,
      minZ,
      maxZ,
      cx,
      cz,
      width,
      depth,
      radius: Math.max(width, depth) / 2,
      start,
      finish,
      dir,
    };
  }

  private addSky(bounds: BoardBounds): void {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(210, 32, 16), skyMaterial());
    sky.position.set(bounds.cx, 18, bounds.cz);
    sky.frustumCulled = false;
    this.group.add(sky);
  }

  private addTextureGround(bounds: BoardBounds): void {
    const size = Math.max(bounds.width, bounds.depth) + 58;
    if (!this.texture) this.texture = groundTexture();
    if (!this.alphaTexture) this.alphaTexture = groundAlphaTexture();

    const underlay = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 1.35, size * 1.35),
      new THREE.MeshStandardMaterial({
        color: 0x173a18,
        roughness: 1,
      }),
    );
    underlay.rotation.x = -Math.PI / 2;
    underlay.position.set(bounds.cx, GROUND_Y - 0.025, bounds.cz);
    underlay.receiveShadow = true;
    this.group.add(underlay);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        map: this.texture,
        alphaMap: this.alphaTexture,
        transparent: true,
        roughness: 0.92,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(bounds.cx, GROUND_Y, bounds.cz);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private addHexContactShadows(hexes: Hex[], worldXZ: (coord: Axial) => WorldPoint): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x071006,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    const shadows = new THREE.InstancedMesh(hexShadowGeometry(), mat, hexes.length);
    const dummy = new THREE.Object3D();

    hexes.forEach((hex, i) => {
      const p = worldXZ(hex);
      const lift = hex.terrain === 'mountain' ? 1.1 : 0.96;
      dummy.position.set(p.x + 0.16, GROUND_Y + 0.035, p.z + 0.2);
      dummy.rotation.set(0, Math.PI / 6, 0);
      dummy.scale.set(lift, 1, lift);
      dummy.updateMatrix();
      shadows.setMatrixAt(i, dummy.matrix);
    });

    shadows.instanceMatrix.needsUpdate = true;
    this.group.add(shadows);
  }

  private addBoardShadow(bounds: BoardBounds): void {
    if (!this.boardShadowTexture) this.boardShadowTexture = softBoardShadowTexture();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.boardShadowTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(bounds.cx + 0.28, GROUND_Y + 0.026, bounds.cz + 0.34);
    shadow.scale.set(bounds.width * 1.08, bounds.depth * 0.92, 1);
    this.group.add(shadow);
  }

  private addFinishGlow(bounds: BoardBounds): void {
    if (!this.goldGlowTexture) this.goldGlowTexture = softGoldGlowTexture();
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.goldGlowTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(
      bounds.finish.x + bounds.dir.x * 3.2,
      GROUND_Y + 0.018,
      bounds.finish.z + bounds.dir.z * 3.2,
    );
    glow.scale.setScalar(5.2);
    this.group.add(glow);
  }
}
