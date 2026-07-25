/**
 * Terrain trim — draw_trim (boe.graphics.cpp:1232) and place_trim (:1088).
 *
 * Trim is drawn by stencilling: trim.png is a 1-bit black-on-white bitmap of
 * 28x36 cells whose black pixels say "let the neighbouring ground terrain show
 * through here". The C++ does this with a fragment shader that keeps the
 * source pixel wherever the mask is black; in canvas the equivalent is an
 * offscreen tile composited with `destination-in` against an alpha mask built
 * once per trim shape.
 */

import { UiRect } from './layout';
import { SheetStore, TILE_H, TILE_W } from './sheets';
import { terrainGraphic } from './terrainPics';

/** Trim shapes, in draw_trim's numbering. */
export enum Trim {
  LEFT = 0,
  RIGHT = 1,
  TOP = 2,
  BOTTOM = 3,
  TOP_LEFT = 4,
  TOP_RIGHT = 5,
  BOTTOM_LEFT = 6,
  BOTTOM_RIGHT = 7,
  WALL_TL = 8,
  WALL_TR = 9,
  WALL_BL = 10,
  WALL_BR = 11,
  /** Walkway shapes are 50..58 in the C++ numbering. */
  WALKWAY_BASE = 50,
}

const r = (top: number, left: number, bottom: number, right: number): UiRect => ({
  top,
  left,
  bottom,
  right,
});

/** trim_rects, after draw_trim's one-time offsetting. */
export const TRIM_RECTS: UiRect[] = (() => {
  const base: UiRect[] = [
    r(0, 0, 36, 14), r(0, 14, 36, 28),
    r(0, 28, 18, 56), r(18, 28, 36, 56),
    r(0, 56, 18, 70), r(0, 70, 18, 84),
    r(18, 56, 36, 70), r(18, 70, 36, 84),
    r(0, 84, 18, 98), r(0, 98, 18, 112),
    r(18, 84, 36, 98), r(18, 98, 36, 112),
  ];
  // Every trim rect then shifts to the second row, right half of the sheet.
  return base.map((rect) => ({
    top: rect.top + 36,
    left: rect.left + 112,
    bottom: rect.bottom + 36,
    right: rect.right + 112,
  }));
})();

/** walkway_rects: full 28x36 cells, four per row, plus a lone one at x=196. */
export const WALKWAY_RECTS: UiRect[] = (() => {
  const rects: UiRect[] = [];
  for (let i = 0; i < 8; i++) {
    const ox = (i % 4) * TILE_W;
    const oy = Math.floor(i / 4) * TILE_H;
    rects.push(r(oy, ox, oy + TILE_H, ox + TILE_W));
  }
  rects.push(r(0, 196, TILE_H, 196 + TILE_W));
  return rects;
})();

/**
 * Builds and caches one alpha mask per trim shape, plus the scratch tile the
 * stencilled draw composites in.
 */
export class TrimMasks {
  private masks = new Map<number, HTMLCanvasElement>();
  private scratch = document.createElement('canvas');

  constructor(private store: SheetStore) {
    this.scratch.width = TILE_W;
    this.scratch.height = TILE_H;
  }

  /**
   * The mask for shape `which`, as a 28x36 canvas that is opaque exactly
   * where the trim bitmap is black.
   */
  private mask(which: number): HTMLCanvasElement | null {
    const cached = this.masks.get(which);
    if (cached) return cached;
    const img = this.store.get('trim');
    if (!img) return null;

    const src = which >= Trim.WALKWAY_BASE
      ? WALKWAY_RECTS[which - Trim.WALKWAY_BASE]
      : TRIM_RECTS[which];
    if (!src) return null;

    const canvas = document.createElement('canvas');
    canvas.width = TILE_W;
    canvas.height = TILE_H;
    const ctx = canvas.getContext('2d')!;
    // Outside the shape's own sub-rect the mask is white, i.e. masked out.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, TILE_W, TILE_H);
    // A shape sits at the same offset inside its cell as inside the sheet.
    const w = src.right - src.left;
    const h = src.bottom - src.top;
    ctx.drawImage(img, src.left, src.top, w, h, src.left % TILE_W, src.top % TILE_H, w, h);

    // Black -> opaque, everything else -> transparent.
    const data = ctx.getImageData(0, 0, TILE_W, TILE_H);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const black = px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0;
      px[i + 3] = black ? 255 : 0;
    }
    ctx.putImageData(data, 0, 0);
    this.masks.set(which, canvas);
    return canvas;
  }

  /**
   * draw_trim: stencil the terrain `groundTer`'s tile through shape `which`
   * onto the destination at (dx, dy).
   */
  draw(
    ctx: CanvasRenderingContext2D,
    which: number,
    groundPic: number,
    dx: number,
    dy: number,
    animFrame = 0,
  ): void {
    const g = terrainGraphic(groundPic, animFrame);
    if (!g) return;
    const sheet = this.store.get(g.sheetName);
    const mask = this.mask(which);
    if (!sheet || !mask) return;

    const sctx = this.scratch.getContext('2d')!;
    sctx.globalCompositeOperation = 'copy';
    sctx.drawImage(
      sheet, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
      0, 0, TILE_W, TILE_H,
    );
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(mask, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.scratch, dx, dy);
  }
}
