/**
 * The 21 tiled background patterns cut out of pixpats.png — port of
 * init_tiling (gfx/tiling.cpp:76). Scenarios pick their outdoor/town/dungeon/
 * fight background by index into this table.
 */

import { UiRect } from './layout';

const PAT_OFFS: [number, number][] = [
  [0, 3], [1, 1], [2, 1], [2, 0],
  [3, 0], [3, 1], [1, 3], [0, 0],
  [0, 2], [1, 2], [0, 1], [2, 2],
  [2, 3], [3, 2], [1, 0], [4, 0], [3, 3],
];
const PAT_I = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20];

/** bg_rects[0..20]: source rect in pixpats.png for each background pattern. */
export const BG_RECTS: UiRect[] = (() => {
  const rects: UiRect[] = Array.from({ length: 21 }, () => ({
    top: 0,
    left: 0,
    bottom: 64,
    right: 64,
  }));
  for (let i = 0; i < 17; i++) {
    const [ox, oy] = PAT_OFFS[i]!;
    rects[PAT_I[i]!] = { top: 64 * oy, left: 64 * ox, bottom: 64 * oy + 64, right: 64 * ox + 64 };
  }
  // 0, 1, 18 and 7 are the four 32x32 quadrants of the tile below bg_rects[19].
  const base = rects[19]!;
  const tmp = { top: base.top + 64, left: base.left, bottom: base.bottom + 64, right: base.right };
  rects[0] = { ...tmp, right: tmp.right - 32, bottom: tmp.bottom - 32 };
  rects[1] = { ...tmp, left: tmp.left + 32, bottom: tmp.bottom - 32 };
  rects[18] = { ...tmp, right: tmp.right - 32, top: tmp.top + 32 };
  rects[7] = { ...tmp, left: tmp.left + 32, top: tmp.top + 32 };
  return rects;
})();

/** cScenario defaults (scenario.cpp:67) — used when no area overrides them. */
export const DEFAULT_BG = {
  out: 10,
  fight: 4,
  town: 13,
  dungeon: 9,
} as const;

/** The pattern used to fill panel interiors before drawing text (bg[6]). */
export const PANEL_BG = 6;

/**
 * Fill `dest` with pattern `index`, aligning the pattern to the destination
 * origin the way tileImage does.
 */
export function tilePattern(
  ctx: CanvasRenderingContext2D,
  pixpats: CanvasImageSource,
  index: number,
  dest: UiRect,
): void {
  const src = BG_RECTS[index] ?? BG_RECTS[0]!;
  const pw = src.right - src.left;
  const ph = src.bottom - src.top;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.left, dest.top, dest.right - dest.left, dest.bottom - dest.top);
  ctx.clip();
  const startX = dest.left - (dest.left % pw);
  const startY = dest.top - (dest.top % ph);
  for (let y = startY; y < dest.bottom; y += ph)
    for (let x = startX; x < dest.right; x += pw)
      ctx.drawImage(pixpats, src.left, src.top, pw, ph, x, y, pw, ph);
  ctx.restore();
}

/**
 * `bw_pats` (gfx/tiling.cpp:104) — six 8x8 dither patterns in a row across
 * bwpats.png, sparse to dense. Only the mask over unexplored ground uses them.
 */
export const BW_PAT_W = 8;

export function bwPatRect(index: number): UiRect {
  const left = 8 * index;
  return { top: 0, left, bottom: 8, right: left + 8 };
}

/** `tileImage` with one of the black-and-white patterns rather than a bg. */
export function tileBwPattern(
  ctx: CanvasRenderingContext2D,
  bwpats: CanvasImageSource,
  index: number,
  dest: UiRect,
): void {
  const src = bwPatRect(index);
  ctx.save();
  ctx.beginPath();
  ctx.rect(dest.left, dest.top, dest.right - dest.left, dest.bottom - dest.top);
  ctx.clip();
  // The pattern is aligned to the destination origin, as tileImage aligns it.
  const startX = dest.left - (dest.left % BW_PAT_W);
  const startY = dest.top - (dest.top % BW_PAT_W);
  for (let y = startY; y < dest.bottom; y += BW_PAT_W)
    for (let x = startX; x < dest.right; x += BW_PAT_W)
      ctx.drawImage(bwpats, src.left, src.top, BW_PAT_W, BW_PAT_W, x, y, BW_PAT_W, BW_PAT_W);
  ctx.restore();
}
