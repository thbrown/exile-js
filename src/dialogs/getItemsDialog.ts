/**
 * The pick-up-items screen — a port of `get-items.xml` and `show_get_items`
 * (boe.items.cpp:559).
 *
 * Unlike a plain pick-list, this one **stays open**: the six PC buttons down
 * the right choose who is doing the picking up, each item click hands that item
 * over and drops it out of the list, and Done closes. Eight items show at a
 * time, with up/down arrows to scroll a longer pile.
 *
 * Layout is the dialog definition's: the framed list at (31, 73) sized
 * 327x309, rows 37px apart from y=37 with the graphic at x=80, the name at 107
 * and the weight at 319; PC buttons in two columns of three at x=354/397; the
 * arrows at x=342; Done at (408, 337).
 */

import { Item } from '../data/item';
import type { GameSession } from '../game/session';
import { Colours } from '../render/colours';
import { UiRect } from '../render/layout';
import { itemGraphic } from '../render/itemPics';
import { pcGraphic } from '../render/pcPics';
import { SheetStore } from '../render/sheets';
import { drawString, drawStringCentre, drawStringEllipsis } from '../render/text';
import { tilePattern } from '../render/tiling';
import { itemWeight } from '../universe/inventory';
import { MainStatus } from '../universe/skills';
import type { ModalScreen } from './dialog';

/** The dialog is about 410x430 in the original; centred on the 605x430 canvas. */
const W = 410;
const H = 426;
const FRAME: UiRect = {
  left: Math.floor((605 - W) / 2), top: 2,
  right: Math.floor((605 - W) / 2) + W, bottom: 2 + H,
};

const BG = 5;
const TEXT = Colours.WHITE;

const LIST: UiRect = { top: 31, left: 73, bottom: 31 + 309, right: 73 + 327 };
const ROW_TOP = 37;
const ROW_PITCH = 37;
const ROWS = 8;
const X_KEY = 74;
const X_GRAPHIC = 80;
const X_NAME = 107;
const X_DETAIL = 116;
const X_WEIGHT = 319;

const PC_BTN = [
  { x: 89, y: 354 }, { x: 174, y: 354 }, { x: 259, y: 354 },
  { x: 89, y: 397 }, { x: 174, y: 397 }, { x: 259, y: 397 },
];
const PC_PIC = [
  { x: 123, y: 348 }, { x: 208, y: 348 }, { x: 293, y: 348 },
  { x: 123, y: 393 }, { x: 208, y: 393 }, { x: 293, y: 393 },
];
const SMALL = 23;
const ARROW_X = 342;
const UP_Y = 5;
const DOWN_Y = 346;
const ARROW_W = 63;
const ARROW_H = 23;
const DONE: UiRect = { left: 337, top: 408, right: 337 + 63, bottom: 408 + 23 };

/**
 * dlogbtnmed.png frames. `cButton::btnRects` writes these as BoE rectangles,
 * which are `{top, left, bottom, right}` — so BTN_UP `{69,0,92,63}` is 63x23 at
 * *y* 69, not x 69. Easy to read backwards.
 */
const UP_FRAME_Y = 69;
const DOWN_FRAME_Y = 92;

export class GetItemsDialog implements ModalScreen {
  private first = 0;
  private prompt = '';
  /** `current_getting_pc` — who picks things up. */
  who: number;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    private session: GameSession,
    private items: Item[],
    private title: string,
  ) {
    this.who = session.univ.curPc;
  }

  private rowRect(i: number): UiRect {
    const top = FRAME.top + ROW_TOP + i * ROW_PITCH;
    return {
      left: FRAME.left + X_KEY, top,
      right: FRAME.left + X_KEY + 311, bottom: top + 36,
    };
  }

  private rect(x: number, y: number, w: number, h: number): UiRect {
    return {
      left: FRAME.left + x, top: FRAME.top + y,
      right: FRAME.left + x + w, bottom: FRAME.top + y + h,
    };
  }

  // ------------------------------------------------------------------ input

  onClick(x: number, y: number): string | null {
    const inside = (r: UiRect): boolean =>
      x >= r.left && x < r.right && y >= r.top && y < r.bottom;

    if (inside(this.rect(DONE.left, DONE.top, 63, 23))) return 'done';
    if (inside(this.rect(ARROW_X, UP_Y, ARROW_W, ARROW_H))) {
      this.first = Math.max(0, this.first - ROWS);
      return null;
    }
    if (inside(this.rect(ARROW_X, DOWN_Y, ARROW_W, ARROW_H))) {
      if (this.first + ROWS < this.items.length) this.first += ROWS;
      return null;
    }
    for (let i = 0; i < 6; i++) {
      const b = PC_BTN[i]!;
      if (!inside(this.rect(b.x, b.y, SMALL, SMALL))) continue;
      const pc = this.session.univ.party.pcs[i];
      if (pc && pc.mainStatus === MainStatus.ALIVE) this.who = i;
      return null;
    }
    for (let i = 0; i < ROWS; i++) {
      if (!inside(this.rowRect(i))) continue;
      this.take(this.first + i);
      return null;
    }
    return null;
  }

  onKey(key: string): string | null {
    if (key === 'Escape' || key === 'Enter') return 'done';
    if (key === 'ArrowUp') {
      this.first = Math.max(0, this.first - ROWS);
      return null;
    }
    if (key === 'ArrowDown') {
      if (this.first + ROWS < this.items.length) this.first += ROWS;
      return null;
    }
    // 'a'-'h' take the eight visible items, as the dialog's own help says.
    const slot = 'abcdefgh'.indexOf(key.toLowerCase());
    if (slot >= 0) {
      this.take(this.first + slot);
      return null;
    }
    const digit = '123456'.indexOf(key);
    if (digit >= 0) {
      const pc = this.session.univ.party.pcs[digit];
      if (pc && pc.mainStatus === MainStatus.ALIVE) this.who = digit;
      return null;
    }
    return null;
  }

  /** Hand item `index` to the current PC and drop it out of the list. */
  private take(index: number): void {
    const item = this.items[index];
    if (!item) return;
    // `takeItem` reports what happened either way, so success is judged by
    // whether the item actually left the floor — it splices it out of the
    // town on success and leaves it there on a refusal.
    const message = this.session.takeItem(item, this.who);
    const town = this.session.univ.town;
    if (town && town.items.includes(item)) {
      // Too heavy, or no room. The original shows this in its `prompt` field.
      this.prompt = message;
      return;
    }
    this.prompt = '';
    this.items.splice(index, 1);
    if (this.first > 0 && this.first >= this.items.length) {
      this.first = Math.max(0, this.first - ROWS);
    }
  }

  // ------------------------------------------------------------------- draw

  draw(): void {
    const { ctx } = this;
    const pats = this.store.get('pixpats');
    if (pats) tilePattern(ctx, pats, BG, FRAME);
    else {
      ctx.fillStyle = Colours.BLACK;
      ctx.fillRect(FRAME.left, FRAME.top, W, H);
    }
    ctx.strokeStyle = Colours.WHITE;
    ctx.lineWidth = 1;
    ctx.strokeRect(FRAME.left + 0.5, FRAME.top + 0.5, W - 1, H - 1);

    drawString(ctx, this.rect(64, 6, 220, 18), this.title,
      { size: 12, font: 'bold', colour: TEXT });

    // The framed list box the item rows sit in.
    ctx.strokeRect(
      FRAME.left + LIST.left + 0.5, FRAME.top + LIST.top + 0.5,
      LIST.right - LIST.left, LIST.bottom - LIST.top);

    this.drawItems();
    this.drawParty();
    this.drawChrome();
  }

  private drawItems(): void {
    const { ctx } = this;
    for (let i = 0; i < ROWS; i++) {
      const item = this.items[this.first + i];
      if (!item) continue;
      const y = ROW_TOP + i * ROW_PITCH;

      drawString(ctx, this.rect(X_KEY - 2, y + 2, 16, 18), 'abcdefgh'[i] ?? '',
        { size: 12, font: 'bold', colour: Colours.YELLOW });

      const gr = itemGraphic(item.graphicNum);
      const sheet = gr ? this.store.get(gr.sheetName) : null;
      if (gr && sheet) {
        ctx.drawImage(sheet, gr.rect.left, gr.rect.top, gr.rect.width, gr.rect.height,
          FRAME.left + X_GRAPHIC, FRAME.top + y, gr.rect.width, gr.rect.height);
      }

      drawStringEllipsis(ctx, this.rect(X_NAME, y + 2, 205, 18),
        item.ident ? item.fullName : item.name, { size: 12, colour: TEXT });
      // The detail line is where "(not yours)" belongs — taking it is theft.
      if (item.property) {
        drawString(ctx, this.rect(X_DETAIL, y + 19, 200, 16), '(not yours)',
          { size: 10, colour: Colours.RED });
      }
      drawString(ctx, this.rect(X_WEIGHT, y + 2, 74, 18), `${itemWeight(item)}`,
        { size: 10, colour: Colours.GREY });
    }
  }

  private drawParty(): void {
    const { ctx } = this;
    const btns = this.store.get('dlogbtnsm');
    for (let i = 0; i < 6; i++) {
      const pc = this.session.univ.party.pcs[i];
      if (!pc || pc.mainStatus === MainStatus.ABSENT) continue;
      const b = PC_BTN[i]!;
      const p = PC_PIC[i]!;
      if (btns) {
        ctx.drawImage(btns, this.who === i ? SMALL : 0, 0, SMALL, SMALL,
          FRAME.left + b.x, FRAME.top + b.y, SMALL, SMALL);
      }
      drawStringCentre(ctx, this.rect(b.x, b.y + 4, SMALL, 16), String(i + 1),
        { size: 12, colour: Colours.BLACK });

      const gr = pcGraphic(pc.whichGraphic, pc.direction);
      const sheet = gr ? this.store.get(gr.sheetName) : null;
      if (gr && sheet) {
        ctx.drawImage(sheet, gr.rect.left, gr.rect.top, gr.rect.width, gr.rect.height,
          FRAME.left + p.x, FRAME.top + p.y, 28, 36);
      }
    }
  }

  private drawChrome(): void {
    const { ctx } = this;
    const med = this.store.get('dlogbtnmed');
    if (med) {
      ctx.drawImage(med, 0, UP_FRAME_Y, ARROW_W, ARROW_H,
        FRAME.left + ARROW_X, FRAME.top + UP_Y, ARROW_W, ARROW_H);
      ctx.drawImage(med, 0, DOWN_FRAME_Y, ARROW_W, ARROW_H,
        FRAME.left + ARROW_X, FRAME.top + DOWN_Y, ARROW_W, ARROW_H);
      ctx.drawImage(med, 0, 0, 63, 23,
        FRAME.left + DONE.left, FRAME.top + DONE.top, 63, 23);
    }
    drawStringCentre(ctx, this.rect(DONE.left, DONE.top + 4, 63, 16), 'Done',
      { size: 12, colour: Colours.BLACK });

    // The dialog's own keyboard hint, down the left margin.
    drawString(ctx, this.rect(1, 203, 66, 20), 'Keyboard:', { size: 10, colour: TEXT });
    drawString(ctx, this.rect(1, 217, 66, 20), "'a'-'h' gets", { size: 10, colour: TEXT });
    drawString(ctx, this.rect(1, 229, 66, 20), 'an item.', { size: 10, colour: TEXT });
    drawString(ctx, this.rect(1, 247, 66, 20), 'Arrows', { size: 10, colour: TEXT });
    drawString(ctx, this.rect(1, 259, 66, 20), 'scroll.', { size: 10, colour: TEXT });
    if (this.items.length > ROWS) {
      drawString(ctx, this.rect(1, 285, 66, 20),
        `${this.first + 1}-${Math.min(this.first + ROWS, this.items.length)}`,
        { size: 10, colour: Colours.GREY });
      drawString(ctx, this.rect(1, 297, 66, 20), `of ${this.items.length}`,
        { size: 10, colour: Colours.GREY });
    }
    if (this.prompt) {
      drawString(ctx, this.rect(1, 347, 66, 60), this.prompt,
        { size: 10, colour: Colours.RED });
    }
  }
}
