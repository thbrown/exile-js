import { describe, expect, it } from 'vitest';
import { calcRect, findGraphic } from '../src/render/sheets';

describe('tile sheet math (gfxsheets.cpp)', () => {
  it('calc_rect offsets the 28x36 base rect', async () => {
    const r = calcRect(3, 2);
    expect(r.left).toBe(84);
    expect(r.top).toBe(72);
    expect(r.width).toBe(28);
    expect(r.height).toBe(36);
  });

  it('find_graphic maps pic number to sheet + cell rect', async () => {
    // pic 0 → sheet 0, cell (0,0)
    expect(findGraphic(0)).toMatchObject({ sheet: 0, rect: { left: 0, top: 0 } });
    // pic 57 → sheet 0, col 7 row 5
    expect(findGraphic(57)).toMatchObject({ sheet: 0, rect: { left: 196, top: 180 } });
    // pic 234 → sheet 2, cell 34 → col 4 row 3
    expect(findGraphic(234)).toMatchObject({ sheet: 2, rect: { left: 112, top: 108 } });
  });
});
