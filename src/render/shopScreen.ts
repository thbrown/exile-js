/**
 * The shopping screen — draw_shop_graphics (boe.newgraph.cpp:700) with the
 * geometry from init_shopping_rects (boe.actions.cpp:152). It takes over the
 * same panel the talking screen uses: portrait, shop name, eight stock rows
 * with a letter shortcut and a price, and four lines of help at the bottom.
 */

import { ShopState, SHOP_CHARS, SHOP_ROWS, COST_STRINGS } from '../game/shop';
import { ShopItemType } from '../data/shop';
import { Colours } from './colours';
import { ITEM_BTN_ICONS, UiRect, height, width } from './layout';
import { itemGraphic } from './itemPics';
import { SheetStore } from './sheets';
import { TextStyle, drawString, drawStringEllipsis, drawStringRight } from './text';
import { tilePattern } from './tiling';
import { TALK_AREA } from './talkScreen';

const FACE_RECT: UiRect = { top: 6, left: 6, bottom: 38, right: 38 };
const TITLE_RECT: UiRect = { top: 15, left: 48, bottom: 42, right: 260 };
const SHOPPER_RECT: UiRect = { top: 44, left: 6, bottom: 56, right: 260 };

/** bottom_help_rects (boe.dlgutil.cpp:117). */
const HELP_RECTS: UiRect[] = [
  { top: 356, left: 6, bottom: 368, right: 250 },
  { top: 374, left: 6, bottom: 386, right: 270 },
  { top: 386, left: 6, bottom: 398, right: 250 },
  { top: 398, left: 6, bottom: 410, right: 250 },
];

/** shop_base and the row spacing from init_shopping_rects. */
const ROW_BASE: UiRect = { top: 63, left: 19, bottom: 99, right: 274 };
const ROW_STEP = 36;

/** The rects making up one stock row, relative to the shop panel. */
export interface ShopRowRects {
  whole: UiRect;
  active: UiRect;
  graphic: UiRect;
  key: UiRect;
  name: UiRect;
  cost: UiRect;
  extra: UiRect;
  info: UiRect;
}

/** init_shopping_rects (boe.actions.cpp:152). */
export function shopRowRects(row: number, scrollbar: boolean): ShopRowRects {
  const base = { ...ROW_BASE };
  const off = (r: UiRect, dx: number, dy: number): UiRect => ({
    top: r.top + dy, left: r.left + dx, bottom: r.bottom + dy, right: r.right + dx,
  });
  // Extra room on the right when no scrollbar is showing.
  const offsetRight = scrollbar ? -4 : 12;

  const graphic: UiRect = { ...base, right: base.left + 28 };
  const rects: ShopRowRects = {
    whole: base,
    active: { ...base, right: base.right - 35 },
    graphic,
    key: { ...base, right: graphic.left, left: graphic.left - 6 },
    name: { ...base, top: base.top + 4, left: base.left + 28 },
    cost: off({ ...base, top: base.top + 20, left: base.left + 154, right: base.right - 20 }, offsetRight, 0),
    extra: { ...base, top: base.top + 20, left: base.left + 34 },
    info: off(
      (() => {
        const r = { ...base, top: base.top + 3, bottom: base.bottom - 21, right: base.right - 19 };
        return { ...r, left: r.right - 14 };
      })(),
      offsetRight, 0,
    ),
  };
  const dy = row * ROW_STEP;
  return {
    whole: off(rects.whole, 0, dy),
    active: off(rects.active, 0, dy),
    graphic: off(rects.graphic, 0, dy),
    key: off(rects.key, 0, dy),
    name: off(rects.name, 0, dy),
    cost: off(rects.cost, 0, dy),
    extra: off(rects.extra, 0, dy),
    info: off(rects.info, 0, dy),
  };
}

const SHOP_BG = 12;
/** The gold coin drawn after a price (invenbtns {0,29,7,36}). */
const COIN_SRC: UiRect = { top: 0, left: 29, bottom: 7, right: 36 };
const NAME_STYLE: TextStyle = { font: 'dungeon', size: 18, colour: Colours.TITLE_BLUE };
const BOLD12: TextStyle = { font: 'bold', size: 12, colour: Colours.BLACK };
const SMALL: TextStyle = { font: 'bold', size: 10, colour: Colours.BLACK };

export type ShopHit =
  | { part: 'buy'; row: number }
  | { part: 'info'; row: number }
  | { part: 'done' }
  | { part: 'scroll'; delta: number };

/** The Done button, bottom right of the panel (shop_done_rect). */
const DONE_RECT: UiRect = { top: 386, left: 210, bottom: 406, right: 270 };
/** Stand-ins for the scrollbar arrows until the widget lands. */
const UP_RECT: UiRect = { top: 63, left: 278, bottom: 83, right: 294 };
const DOWN_RECT: UiRect = { top: 331, left: 278, bottom: 351, right: 294 };

export class ShopScreen {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
  ) {}

  private at(rect: UiRect): UiRect {
    return {
      top: rect.top + TALK_AREA.top,
      left: rect.left + TALK_AREA.left,
      bottom: rect.bottom + TALK_AREA.top,
      right: rect.right + TALK_AREA.left,
    };
  }

  private get scrollbar(): boolean {
    return this.showScrollbar;
  }

  private showScrollbar = false;

  draw(state: ShopState): void {
    const { ctx } = this;
    this.showScrollbar = state.maxScroll > 0;

    ctx.fillStyle = Colours.BLACK;
    ctx.fillRect(TALK_AREA.left, TALK_AREA.top, width(TALK_AREA), height(TALK_AREA));
    const pats = this.store.get('pixpats');
    const inner: UiRect = {
      top: TALK_AREA.top + 1, left: TALK_AREA.left + 1,
      bottom: TALK_AREA.bottom - 1, right: TALK_AREA.right - 1,
    };
    if (pats) tilePattern(ctx, pats, SHOP_BG, inner);

    this.drawFace(state);

    // Shop name, drawn twice for the drop shadow.
    const title = this.at(TITLE_RECT);
    drawString(ctx, { ...title, top: title.top + 1, left: title.left + 1 }, state.name,
      { ...NAME_STYLE, colour: Colours.SHADOW });
    drawString(ctx, title, state.name, NAME_STYLE);
    drawString(ctx, this.at(SHOPPER_RECT), state.title, { ...BOLD12, colour: Colours.SHADOW });

    for (let row = 0; row < SHOP_ROWS; row++) this.drawRow(state, row);

    drawString(ctx, this.at(HELP_RECTS[0]!),
      `Prices here are ${COST_STRINGS[state.costAdj] ?? '?'}.`, SMALL);
    drawString(ctx, this.at(HELP_RECTS[1]!), "Click on item name (or type 'a'-'h') to buy.", SMALL);
    drawString(ctx, this.at(HELP_RECTS[2]!), 'Hit done button (or Esc.) to quit.', SMALL);
    drawString(ctx, this.at(HELP_RECTS[3]!), "'I' button brings up description.", SMALL);

    this.drawButtons(state);
  }

  private drawFace(state: ShopState): void {
    const dest = this.at(FACE_RECT);
    const portraits = this.store.get('talkportraits');
    const pic = Math.max(0, state.shop.face);
    if (!portraits || pic >= 1000) return;
    // drawPresetTalk (pict.cpp:896): 32x32 cells, ten to a row.
    this.ctx.drawImage(
      portraits, (pic % 10) * 32, Math.floor(pic / 10) * 32, 32, 32,
      dest.left, dest.top, width(dest), height(dest),
    );
  }

  private drawRow(state: ShopState, row: number): void {
    const target = state.rowEntry(row);
    if (!target) return;
    const { entry } = target;
    const rects = shopRowRects(row, this.scrollbar);
    const { ctx } = this;

    // The item's picture.
    const g = itemGraphic(entry.item.graphicNum);
    const dest = this.at(rects.graphic);
    if (g) {
      const sheet = this.store.get(g.sheetName);
      if (sheet)
        ctx.drawImage(
          sheet, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
          dest.left + g.inset.x, dest.top + g.inset.y, g.rect.width, g.rect.height,
        );
    }

    drawString(ctx, this.at(rects.key), SHOP_CHARS[row] ?? '', SMALL);
    drawStringEllipsis(ctx, this.at(rects.name), entry.item.fullName, BOLD12);

    // Price, right-aligned, with the little coin after it.
    const cost = String(state.cost(entry));
    const costRect = this.at(rects.cost);
    drawStringRight(ctx, { ...costRect, right: costRect.right - 10 }, cost, BOLD12);
    const icons = this.store.get('invenbtns');
    if (icons)
      ctx.drawImage(icons, COIN_SRC.left, COIN_SRC.top, width(COIN_SRC), height(COIN_SRC),
        costRect.right - 7, costRect.top + 3, width(COIN_SRC), height(COIN_SRC));

    const extra = this.at(rects.extra);
    drawStringEllipsis(ctx, { ...extra, right: costRect.right - 40 },
      state.extraInfo(entry), SMALL);

    // The info button, the same icon the inventory panel uses.
    if (icons) {
      const src = ITEM_BTN_ICONS.info;
      const info = this.at(rects.info);
      ctx.drawImage(icons, src.left, src.top, width(src), height(src),
        info.left, info.top, width(src), height(src));
    }
  }

  private drawButtons(state: ShopState): void {
    const { ctx } = this;
    const frame = (rect: UiRect, label: string) => {
      const r = this.at(rect);
      ctx.fillStyle = Colours.WHITE;
      ctx.fillRect(r.left, r.top, width(r), height(r));
      ctx.strokeStyle = Colours.BLACK;
      ctx.strokeRect(r.left + 0.5, r.top + 0.5, width(r) - 1, height(r) - 1);
      drawStringRight(ctx, { ...r, right: r.right - Math.floor((width(r) - 30) / 2), top: r.top + 4 },
        label, BOLD12);
    };
    frame(DONE_RECT, 'Done');
    // TODO(M3): a real cScrollbar; two arrows do the job for now.
    if (state.maxScroll > 0) {
      frame(UP_RECT, '▲');
      frame(DOWN_RECT, '▼');
    }
  }

  /** Which part of the shop screen a click landed on. */
  hit(state: ShopState, x: number, y: number): ShopHit | null {
    const inside = (rect: UiRect): boolean => {
      const r = this.at(rect);
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    };
    if (inside(DONE_RECT)) return { part: 'done' };
    if (state.maxScroll > 0) {
      if (inside(UP_RECT)) return { part: 'scroll', delta: -1 };
      if (inside(DOWN_RECT)) return { part: 'scroll', delta: 1 };
    }
    for (let row = 0; row < SHOP_ROWS; row++) {
      if (!state.rowEntry(row)) break;
      const rects = shopRowRects(row, state.maxScroll > 0);
      if (inside(rects.info)) return { part: 'info', row };
      if (inside(rects.active)) return { part: 'buy', row };
    }
    return null;
  }

  /** The row a letter shortcut names, or -1 (shop_chars, boe.actions.cpp:2791). */
  rowForKey(state: ShopState, key: string): number {
    const row = SHOP_CHARS.indexOf(key.toLowerCase());
    if (row < 0 || !state.rowEntry(row)) return -1;
    return row;
  }
}

/** A one-line description for the info button (handle_info_request, :510). */
export function shopItemInfo(state: ShopState, row: number): { title: string; text: string } | null {
  const target = state.rowEntry(row);
  if (!target) return null;
  const { entry } = target;
  const title = entry.item.fullName;
  switch (entry.type) {
    case ShopItemType.ITEM:
      return { title, text: entry.item.desc || 'A perfectly ordinary item.' };
    case ShopItemType.CALL_SPECIAL:
      return { title, text: entry.item.desc };
    case ShopItemType.SKILL:
      return { title, text: 'Buying this raises the skill by one level.' };
    case ShopItemType.MAGE_SPELL:
    case ShopItemType.PRIEST_SPELL:
      return { title, text: 'Buying this teaches the spell to the current character.' };
    case ShopItemType.ALCHEMY:
      return { title, text: 'Buying this teaches the party an alchemical recipe.' };
    case ShopItemType.HEAL_WOUNDS:
      return { title, text: 'Select this option to restore the current PC to full health.' };
    case ShopItemType.REMOVE_CURSE:
      return { title, text: 'Select this option to remove any curses on any items the PC is wearing.' };
    case ShopItemType.CURE_DUMBFOUNDING:
      return { title, text: "Select this option to restore the PC's mind from dumbfounding." };
    case ShopItemType.CURE_POISON:
      return { title, text: 'Select this option purge all poison from the current PC.' };
    case ShopItemType.CURE_DISEASE:
      return { title, text: 'Select this option purge all disease from the current PC.' };
    case ShopItemType.CURE_ACID:
      return { title, text: 'Select this option purge all acid from the current PC.' };
    case ShopItemType.CURE_PARALYSIS:
      return { title, text: "Select this option to cure the current PC's paralysis." };
    case ShopItemType.DESTONE:
      return { title, text: 'Select this option to restore a PC that has been turned to stone.' };
    case ShopItemType.RAISE_DEAD:
      return { title, text: 'Select this option to resurrect a PC.' };
    case ShopItemType.RESURRECT:
      return { title, text: 'Select this option to resurrect a PC that has been turned to dust.' };
    default:
      return null;
  }
}
