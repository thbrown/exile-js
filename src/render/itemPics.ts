/**
 * Item graphics — calc_item_rect (boe.newgraph.cpp:684). Graphics under 55 are
 * full 28x36 tiles on objects.png; the rest are 18x18 icons on tinyobj.png,
 * which the game insets inside the destination tile. 1000+ are custom
 * scenario graphics (deferred with the rest of custom-graphics support).
 */

import { Rect } from '../core/location';
import { calcRect } from './sheets';

export interface ItemGraphic {
  sheetName: string;
  rect: Rect;
  /** Inset to apply to the destination tile, in pixels (x, y). */
  inset: { x: number; y: number };
}

export function itemGraphic(num: number): ItemGraphic | null {
  if (num >= 1000) return null;
  if (num < 55) {
    return {
      sheetName: 'objects',
      rect: calcRect(num % 5, Math.floor(num / 5)),
      inset: { x: 0, y: 0 },
    };
  }
  const left = 18 * (num % 10);
  const top = 18 * Math.floor(num / 10);
  return {
    sheetName: 'tinyobj',
    rect: new Rect(top, left, top + 18, left + 18),
    inset: { x: 5, y: 9 },
  };
}
