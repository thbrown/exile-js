/**
 * Screen geometry, ported from the C++ so the UI lands pixel-for-pixel where
 * the original put it: win_to_rects (boe.ui.cpp:33), the window size
 * (global.hpp:30), the terrain-spot offsets (boe.graphics.cpp:1368) and the
 * PC-row hit rects (boe.actions.cpp:259).
 *
 * All rects are {top,left,bottom,right} like the C++ `rectangle`.
 */

export const BOE_WIDTH = 605;
export const BOE_HEIGHT = 430;

export interface UiRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const r = (top: number, left: number, bottom: number, right: number): UiRect => ({
  top,
  left,
  bottom,
  right,
});

export const WIN_RECTS = {
  terView: r(7, 19, 358, 298),
  actBtns: r(385, 19, 423, 285),
  pcStats: r(7, 305, 123, 576),
  inven: r(132, 305, 276, 576),
  status: r(360, 19, 381, 298),
  transcript: r(285, 305, 423, 561),
} as const;

/** The background image that fills each panel, keyed by panel. */
export const PANEL_IMAGES = {
  terView: 'terscreen',
  pcStats: 'statarea',
  inven: 'inventory',
  status: 'textbar',
  transcript: 'transcript',
} as const;

/** The terrain view is a 9x9 grid of tiles inset 13px inside its panel. */
export const TER_VIEW_TILES = 9;
export const TER_VIEW_CENTER = 4;
export const TER_INSET_X = 13;
export const TER_INSET_Y = 13;

export function width(rect: UiRect): number {
  return rect.right - rect.left;
}

export function height(rect: UiRect): number {
  return rect.bottom - rect.top;
}

/** Top-left screen pixel of terrain-view cell (q, r). */
export function terrainSpotPos(q: number, row: number): { x: number; y: number } {
  return {
    x: WIN_RECTS.terView.left + TER_INSET_X + q * 28,
    y: WIN_RECTS.terView.top + TER_INSET_Y + row * 36,
  };
}

// --- PC stats panel rows (coordinates are relative to the panel) -----------

export interface PcRowRects {
  name: UiRect;
  hp: UiRect;
  sp: UiRect;
  info: UiRect;
  trade: UiRect;
}

export const PC_ROWS: PcRowRects[] = Array.from({ length: 6 }, (_, i) => {
  const top = 21 + 13 * i;
  const bottom = top + 12;
  return {
    name: r(top, 3, bottom, 180),
    hp: r(top, 184, bottom, 214),
    sp: r(top, 214, bottom, 237),
    info: r(top, 241, bottom, 253),
    trade: r(top, 253, bottom, 262),
  };
});

/** Labels and value slots along the bottom of the PC panel (boe.text.cpp:91). */
export const PC_PANEL = {
  titles: [r(4, 4, 16, 180), r(4, 184, 16, 214), r(4, 214, 16, 237)],
  foodLabel: r(103, 3, 114, 40),
  foodValue: r(103, 34, 114, 76),
  goldLabel: r(103, 75, 114, 104),
  goldValue: r(103, 106, 114, 147),
  dayLabel: r(103, 147, 114, 172),
  dayValue: r(103, 174, 114, 201),
} as const;

// --- Inventory panel rows (init_inven_rects, boe.actions.cpp:200) ----------

/** The item pane shows eight rows at a time. */
export const LINES_IN_ITEM_WIN = 8;

export interface ItemRowRects {
  icon: UiRect;
  name: UiRect;
  use: UiRect;
  give: UiRect;
  drop: UiRect;
  info: UiRect;
  /** The sell/identify/enchant/recharge button, only shown in a shop mode. */
  spec: UiRect;
}

/**
 * `shopMode` is stat_screen_mode >= MODE_IDENTIFY: the spec button appears and
 * the name's hitbox shrinks so it can't steal the button's clicks
 * (boe.actions.cpp:230).
 */
export function itemRows(shopMode = false): ItemRowRects[] {
  return Array.from({ length: LINES_IN_ITEM_WIN }, (_, i) => {
    const dy = 13 * i;
    // The name row starts at 17 and then shifts down 3 (boe.actions.cpp:234).
    const nameTop = 20 + dy;
    const btnTop = 18 + dy;
    return {
      icon: r(15 + dy, 20, 33 + dy, 38),
      name: r(nameTop, 3, nameTop + 12, shopMode ? 173 : 188),
      use: r(btnTop, 196, btnTop + 12, 210),
      give: r(btnTop, 210, btnTop + 12, 224),
      drop: r(btnTop, 224, btnTop + 12, 238),
      info: r(btnTop, 238, btnTop + 12, 252),
      spec: r(17 + dy, 173, 29 + dy, 232),
    };
  });
}

export const ITEM_ROWS: ItemRowRects[] = itemRows();
export const ITEM_ROWS_SHOP: ItemRowRects[] = itemRows(true);

/**
 * The spec button's four icons — button_sources (boe.text.cpp:394), one per
 * shop mode: identify, sell, enchant, recharge.
 */
export const SPEC_BTN_ICONS = {
  identify: r(24, 0, 36, 30),
  sell: r(36, 0, 48, 30),
  enchant: r(48, 0, 60, 30),
  recharge: r(60, 0, 72, 30),
} as const;

/** The inventory panel's title line and the area erased before drawing. */
export const ITEM_PANEL = {
  title: r(3, 3, 15, 268),
  erase: r(17, 2, 122, 255),
} as const;

/**
 * Row-button icons in invenbtns.png — item_buttons_from (boe.text.cpp:47),
 * indexed by eItemButton minus 2 (USE, GIVE, DROP, INFO).
 */
export const ITEM_BTN_ICONS = {
  use: r(12, 0, 24, 14),
  give: r(12, 14, 24, 28),
  drop: r(12, 28, 24, 42),
  info: r(12, 42, 24, 56),
} as const;

/** The transcript pane's text area, relative to its panel. */
export const TRANSCRIPT_TEXT = r(2, 2, 136, 255);
export const TRANSCRIPT_LINE_HEIGHT = 12;

// --- Road overlay (place_road, boe.graphics.cpp:1345) ----------------------

/** Source rects in fields.png. */
export const ROAD_SRC = {
  horizontal: r(76, 28, 80, 41),
  vertical: r(72, 60, 90, 64),
  centre: r(80, 28, 84, 32),
} as const;

/** Destination rects, relative to a terrain cell's top-left. */
export const ROAD_DEST = {
  top: r(0, 12, 18, 16),
  right: r(16, 15, 20, 28),
  bottom: r(18, 12, 36, 16),
  left: r(16, 0, 20, 13),
  centre: r(16, 12, 20, 16),
} as const;

// --- Toolbar --------------------------------------------------------------

export enum ToolbarButton {
  MAGE = 0, PRIEST, LOOK, CAMP, SCROLL, SAVE,
  SHIELD, BAG, TALK, HAND, SWORD, LOAD,
  WAIT, END, SHOOT, ACT, USE, MAP,
  CANCEL,
  NONE = -1,
}

/** The button sets for each mode (boe.ui.cpp:48). */
export const OUT_BUTTONS = [
  ToolbarButton.MAGE, ToolbarButton.PRIEST, ToolbarButton.LOOK, ToolbarButton.CAMP,
  ToolbarButton.SCROLL, ToolbarButton.SAVE, ToolbarButton.LOAD,
];
export const TOWN_BUTTONS = [
  ToolbarButton.MAGE, ToolbarButton.PRIEST, ToolbarButton.LOOK, ToolbarButton.TALK,
  ToolbarButton.HAND, ToolbarButton.USE, ToolbarButton.MAP, ToolbarButton.SWORD,
];
export const FIGHT_BUTTONS = [
  ToolbarButton.MAGE, ToolbarButton.PRIEST, ToolbarButton.LOOK, ToolbarButton.SHIELD,
  ToolbarButton.BAG, ToolbarButton.WAIT, ToolbarButton.SHOOT, ToolbarButton.END,
  ToolbarButton.ACT,
];

export enum ButtonType {
  LARGE = 0,
  SMALL_HI = 1,
  SMALL_LO = 2,
}

/** Frame source rects in buttons.png, indexed by ButtonType. */
export const BTN_SRC_RECTS: UiRect[] = [r(0, 0, 38, 38), r(0, 38, 19, 76), r(19, 38, 38, 76)];

export interface PlacedButton {
  btn: ToolbarButton;
  type: ButtonType;
  bounds: UiRect;
}

/**
 * place_buttons (boe.ui.cpp:139). Buttons from the third row of buttons.png
 * are half-height and get stacked two to a column.
 */
export function placeButtons(src: readonly ToolbarButton[]): PlacedButton[] {
  const out: PlacedButton[] = [];
  let offset = 0;
  let bottomHalf = false;
  for (const btn of src) {
    const slotY = Math.floor(btn / 6);
    let type: ButtonType;
    let bounds: UiRect;
    if (slotY === 2) {
      type = bottomHalf ? ButtonType.SMALL_LO : ButtonType.SMALL_HI;
      bounds = bottomHalf ? r(19, 0, 38, 38) : r(0, 0, 19, 38);
      bottomHalf = !bottomHalf;
    } else {
      type = ButtonType.LARGE;
      bounds = r(0, 0, 38, 38);
    }
    bounds = { ...bounds, left: bounds.left + offset, right: bounds.right + offset };
    if (type !== ButtonType.SMALL_HI) offset += 38;
    out.push({ btn, type, bounds });
  }
  return out;
}

/** The icon's source rect in buttons.png for a placed button. */
export function buttonIconRect(placed: PlacedButton): UiRect {
  const sx = placed.btn % 6;
  const sy = Math.floor(placed.btn / 6);
  // buttons.png: one row of 38x38 frames, then rows of 32px-tall icons.
  const h = placed.type === ButtonType.LARGE ? 32 : 16;
  return r(38 + 32 * sy, 32 * sx, 38 + 32 * sy + h, 32 * sx + 32);
}
