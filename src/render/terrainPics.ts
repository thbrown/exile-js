/**
 * Terrain picture → sheet/cell resolution, from place_road/draw code in
 * ../exile-wasm/src/game/boe.graphutil.cpp:79-103:
 *   pic <  960: sheet ter(1 + pic/50), cell pic%50
 *   pic >= 960 && < 1000: teranim, col 4*((pic-960)/5) + frame, row (pic-960)%5
 *   pic >= 1000: custom scenario sheets (deferred until custom gfx land)
 */

import { Rect } from '../core/location';
import { calcRect } from './sheets';

export interface TerGraphic {
  sheetName: string;
  rect: Rect;
}

export function terrainGraphic(pic: number, animFrame = 0): TerGraphic | null {
  if (pic >= 1000) return null; // custom graphics — deferred
  if (pic >= 960) {
    const n = pic - 960;
    return {
      sheetName: 'teranim',
      rect: calcRect(4 * Math.floor(n / 5) + (animFrame % 4), n % 5),
    };
  }
  const sheet = 1 + Math.floor(pic / 50);
  const cell = pic % 50;
  return { sheetName: `ter${sheet}`, rect: calcRect(cell % 10, Math.floor(cell / 10)) };
}
