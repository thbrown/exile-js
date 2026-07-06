/**
 * Monster graphic resolution — get_monster_template_rect
 * (boe.graphutil.cpp:514) + the monst-sheet split (20 sprites per sheet,
 * sheet = monst{1 + (i+part)/20}).
 *
 * mode: 0 = facing left(default pose, adj+1), 1 = facing right; +10 = attack pose.
 */

import { Rect } from '../core/location';
import { M_PIC_INDEX } from './mPicIndex';
import { calcRect } from './sheets';

export interface MonstGraphic {
  sheetName: string;
  rect: Rect;
}

export function monsterDims(pic: number): { w: number; h: number } {
  const entry = M_PIC_INDEX[pic];
  if (!entry) return { w: 1, h: 1 };
  return { w: entry[1], h: entry[2] };
}

export function monsterGraphic(pic: number, mode = 0, part = 0): MonstGraphic | null {
  const entry = M_PIC_INDEX[pic];
  if (!entry) return null;
  let adj = 0;
  if (mode >= 10) {
    adj += 4;
    mode -= 10;
  }
  if (mode === 0) adj++;
  const raw = entry[0] + part;
  const idx = raw % 20;
  return {
    sheetName: `monst${1 + Math.floor(raw / 20)}`,
    rect: calcRect(2 * Math.floor(idx / 10) + adj, idx % 10),
  };
}
