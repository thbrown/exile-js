import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W } from '../src/render/sheets';
import { TRIM_RECTS, WALKWAY_RECTS } from '../src/render/trim';

/**
 * trim.png is 224x72 — eight 28x36 cells in two rows. Each shape's offset
 * *within* its cell is what positions it in the destination tile, so these
 * tables have to land exactly where draw_trim's one-time offsetting puts them.
 */
describe('trim source rects', () => {
  const SHEET_W = 224;
  const SHEET_H = 72;

  it('keeps all twelve trim shapes inside the sheet', async () => {
    expect(TRIM_RECTS).toHaveLength(12);
    for (const rect of TRIM_RECTS) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(SHEET_W);
      expect(rect.bottom).toBeLessThanOrEqual(SHEET_H);
    }
  });

  it('places the edge shapes along the correct edges of their cell', async () => {
    const cell = (i: number): { x: number; y: number; w: number; h: number } => {
      const rect = TRIM_RECTS[i]!;
      return {
        x: rect.left % TILE_W,
        y: rect.top % TILE_H,
        w: rect.right - rect.left,
        h: rect.bottom - rect.top,
      };
    };
    // 0 left / 1 right: full height, half width.
    expect(cell(0)).toEqual({ x: 0, y: 0, w: 14, h: 36 });
    expect(cell(1)).toEqual({ x: 14, y: 0, w: 14, h: 36 });
    // 2 top / 3 bottom: full width, half height.
    expect(cell(2)).toEqual({ x: 0, y: 0, w: 28, h: 18 });
    expect(cell(3)).toEqual({ x: 0, y: 18, w: 28, h: 18 });
    // 4..7 are the quadrant corners, tl, tr, bl, br.
    expect(cell(4)).toEqual({ x: 0, y: 0, w: 14, h: 18 });
    expect(cell(5)).toEqual({ x: 14, y: 0, w: 14, h: 18 });
    expect(cell(6)).toEqual({ x: 0, y: 18, w: 14, h: 18 });
    expect(cell(7)).toEqual({ x: 14, y: 18, w: 14, h: 18 });
    // 8..11 are the wall corners, same quadrants but a different sheet cell.
    expect(cell(8)).toEqual({ x: 0, y: 0, w: 14, h: 18 });
    expect(cell(11)).toEqual({ x: 14, y: 18, w: 14, h: 18 });
    expect(TRIM_RECTS[8]!.left).not.toBe(TRIM_RECTS[4]!.left);
  });

  it('gives every walkway shape a whole cell', async () => {
    expect(WALKWAY_RECTS).toHaveLength(9);
    for (const rect of WALKWAY_RECTS) {
      expect(rect.right - rect.left).toBe(TILE_W);
      expect(rect.bottom - rect.top).toBe(TILE_H);
      expect(rect.left % TILE_W).toBe(0);
      expect(rect.top % TILE_H).toBe(0);
      expect(rect.right).toBeLessThanOrEqual(SHEET_W);
      expect(rect.bottom).toBeLessThanOrEqual(SHEET_H);
    }
    // The lone walkway shape sits apart from the eight-shape block.
    expect(WALKWAY_RECTS[8]).toEqual({ top: 0, left: 196, bottom: TILE_H, right: 196 + TILE_W });
  });

  it('does not overlap walkway cells with trim cells', async () => {
    const cellsOf = (rect: { top: number; left: number; bottom: number; right: number }): string[] => {
      const out: string[] = [];
      for (let x = Math.floor(rect.left / TILE_W); x <= Math.floor((rect.right - 1) / TILE_W); x++)
        for (let y = Math.floor(rect.top / TILE_H); y <= Math.floor((rect.bottom - 1) / TILE_H); y++)
          out.push(`${x},${y}`);
      return out;
    };
    const walkwayCells = new Set(WALKWAY_RECTS.flatMap(cellsOf));
    for (const rect of TRIM_RECTS)
      for (const c of cellsOf(rect)) expect(walkwayCells.has(c)).toBe(false);
  });
});
