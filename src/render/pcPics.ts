/**
 * The party sprite on the terrain view — draw_party_symbol
 * (boe.graphutil.cpp:446). Pics under 100 come from pcs.png in a 2-column-per
 * -graphic layout; 100..999 borrow a monster graphic; 1000+ are custom
 * scenario graphics (deferred with the rest of custom-graphics support).
 */

import { Direction, Rect } from '../core/location';
import { monsterGraphic } from './monsterPics';
import { calcRect } from './sheets';

export interface PcGraphic {
  sheetName: string;
  rect: Rect;
}

export function pcGraphic(pic: number, direction: Direction): PcGraphic | null {
  // Facing: directions S and beyond (>= 4) use the mirrored column.
  const facingRight = direction >= Direction.S;
  if (pic >= 1000) return null; // TODO: custom scenario party graphics
  if (pic >= 100) {
    return monsterGraphic(pic - 100, facingRight ? 1 : 0, 0);
  }
  const rect = calcRect(2 * Math.floor(pic / 8) + (facingRight ? 1 : 0), pic % 8);
  return { sheetName: 'pcs', rect };
}
