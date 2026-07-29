/**
 * `cPict::draw` (pict.cpp) — one picture from whichever sheet its `ePicType`
 * names, drawn at a point. Shared by the dialogxml renderer and the plain
 * modal, because both have to answer the same question: a special node hands
 * over a `pic` and a `pictype`, and something has to know which sheet that is.
 */

import { Colours } from '../render/colours';
import { itemGraphic } from '../render/itemPics';
import { monsterGraphic } from '../render/monsterPics';
import { SheetStore, calcRect } from '../render/sheets';
import { statIconRect } from '../data/statusIcons';
import { terrainGraphic } from '../render/terrainPics';
import { PictType } from './dialogXml';

/** The 28x36 box a picture is drawn into, unless its type says otherwise. */
export const PICT_W = 28;
export const PICT_H = 36;

export function drawPictAt(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  type: PictType, num: number, x: number, y: number, large = false,
): void {
  const blit = (
    sheetName: string,
    from: { left: number; top: number; width: number; height: number },
    dx = 0, dy = 0,
  ): void => {
    const sheet = store.get(sheetName);
    if (!sheet) return;
    ctx.drawImage(
      sheet, from.left, from.top, from.width, from.height,
      x + dx, y + dy, from.width, from.height);
  };
  switch (type) {
    case 'dlog': {
      // dlogpics.png is a 4-across grid of 36x36 portraits; the large kind
      // takes a 72x72 block from the same grid.
      const size = large ? 72 : 36;
      blit('dlogpics', {
        left: 36 * (num % 4), top: 36 * Math.floor(num / 4), width: size, height: size,
      });
      break;
    }
    case 'talk':
      blit('talkportraits', {
        left: 32 * (num % 10), top: 32 * Math.floor(num / 10), width: 32, height: 32,
      });
      break;
    case 'scen':
      blit('scenpics', {
        left: 32 * (num % 5), top: 32 * Math.floor(num / 5), width: 32, height: 32,
      });
      break;
    case 'item': {
      // PIC_ITEM is "28x36 from the large item sheet, **or** 18x18 from the
      // small sheet centred in a 28x36 space" (pictypes.hpp:24). `inset` is
      // that centring; without it a tiny icon draws in the frame's top left
      // corner instead of the middle.
      const g = itemGraphic(num);
      if (g) blit(g.sheetName, g.rect, g.inset.x, g.inset.y);
      break;
    }
    case 'pc': {
      // calc_rect(2 * (num / 8), num % 8) — the same column pairing the party
      // symbol uses, taking the left-facing frame.
      blit('pcs', calcRect(2 * Math.floor(num / 8), num % 8));
      break;
    }
    case 'monst': {
      const g = monsterGraphic(num);
      if (g) blit(g.sheetName, g.rect);
      break;
    }
    case 'ter': {
      const g = terrainGraphic(num);
      if (g) blit(g.sheetName, g.rect);
      break;
    }
    case 'status':
      blit('staticons', { ...statIconRect(num), width: 12, height: 12 });
      break;
    case 'blank':
    default:
      ctx.fillStyle = Colours.GREY;
      ctx.fillRect(x, y, large ? 72 : PICT_W, large ? 72 : PICT_H);
      break;
  }
}
