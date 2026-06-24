/**
 * scene/CostLabelAtlas — owns the cost-icon image cache and the canvas
 * drawers that paint hex/blockade cost labels.
 *
 * Extracted from the old `board.ts` god class. Both HexBoard and
 * BlockadeRenderer need to draw cost labels; rather than duplicate the
 * image cache, they share one instance of this class.
 */
import * as THREE from 'three';
import type { Hex, MoveSymbol } from '@eldorado/core';
import { COST_LABEL_SIZE, COST_ICON_DRAW_SIZE, BLOCKADE_LABEL_ICON_Y_OFFSET } from '../shared/constants.js';

export type CostIcon = MoveSymbol | 'discard' | 'remove';

const COST_ICON_URL: Record<CostIcon, string> = {
  machete: '/card-icons/machete.jpg',
  paddle: '/card-icons/paddle.jpg',
  coin: '/card-icons/coin.jpg',
  discard: '/card-icons/discard.jpg',
  remove: '/card-icons/remove.jpg',
};

/** Plane geometry shared by every cost label mesh — size is in scene units. */
export const COST_LABEL_GEO = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
/** Same as above for blockade labels — kept separate so a future size
 *  change to one label type doesn't ripple into the other. */
export const BLOCKADE_LABEL_GEO = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);

export class CostLabelAtlas {
  private readonly imageCache = new Map<CostIcon, HTMLImageElement>();

  /** Return (and lazily load) the icon image for `icon`. */
  iconImage(icon: CostIcon): HTMLImageElement {
    let img = this.imageCache.get(icon);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = COST_ICON_URL[icon];
      this.imageCache.set(icon, img);
    }
    return img;
  }

  /**
   * Paint a hex-cost label onto `ctx` (128×128 canvas). The label is a
   * small grid of icons in the centre of the canvas.
   */
  drawHexLabel(ctx: CanvasRenderingContext2D, icon: CostIcon, cost: number, img: HTMLImageElement | null): void {
    ctx.clearRect(0, 0, COST_LABEL_SIZE, COST_LABEL_SIZE);
    if (!img) return;

    for (const mark of costIconLayout(cost)) {
      drawCostIcon(ctx, img, mark.x, mark.y, mark.size, mark.rotation);
    }
  }

  /**
   * Paint a blockade-cost label. Same layout as a hex label, but shifted
   * down by `BLOCKADE_LABEL_ICON_Y_OFFSET` so the icon sits clear of the
   * blockade's top band.
   */
  drawBlockadeLabel(ctx: CanvasRenderingContext2D, cost: number, img: HTMLImageElement | null): void {
    ctx.clearRect(0, 0, COST_LABEL_SIZE, COST_LABEL_SIZE);
    if (!img) return;

    for (const mark of costIconLayout(cost)) {
      drawCostIcon(ctx, img, mark.x, mark.y + BLOCKADE_LABEL_ICON_Y_OFFSET, mark.size, mark.rotation);
    }
  }
}

/** Map a hex's terrain + required symbol to the icon used on its cost label. */
export function costIconForHex(hex: Hex): CostIcon | null {
  if (hex.reqSymbol) return hex.reqSymbol;
  if (hex.terrain === 'green') return 'machete';
  if (hex.terrain === 'blue') return 'paddle';
  if (hex.terrain === 'yellow') return 'coin';
  if (hex.terrain === 'finish') return 'coin';
  if (hex.terrain === 'rubble') return 'discard';
  if (hex.terrain === 'basecamp') return 'remove';
  return null;
}

/** True once the image has finished loading and has a non-zero natural size. */
export function imageReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/**
 * Return the (x, y, size, rotation) for each icon mark on a cost label
 * with the given cost. Caps at 4 (a "4+" label would be misleading).
 */
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

/** Paint one cost-icon mark: rotated, shadowed, clipped to a circle. */
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