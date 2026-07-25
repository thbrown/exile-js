/**
 * The 605x430 game screen: tiled background, terrain view, status bar, PC
 * stats, inventory, transcript and toolbar. Composed the same way as
 * redraw_screen (boe.graphics.cpp:598) so each panel can be filled in
 * independently as its underlying systems land.
 */

import { Direction } from '../core/location';
import { Lighting } from '../data/town';
import { GameSession } from '../game/session';
import { GameMode } from '../game/modes';
import { MAIN_STATUS_LABEL, MainStatus } from '../universe/skills';
import { Colours } from './colours';
import {
  BOE_HEIGHT,
  BOE_WIDTH,
  BTN_SRC_RECTS,
  OUT_BUTTONS,
  PANEL_IMAGES,
  PC_PANEL,
  PC_ROWS,
  PlacedButton,
  TER_VIEW_CENTER,
  TER_VIEW_TILES,
  TOWN_BUTTONS,
  TRANSCRIPT_LINE_HEIGHT,
  TRANSCRIPT_TEXT,
  UiRect,
  WIN_RECTS,
  buttonIconRect,
  height,
  placeButtons,
  terrainSpotPos,
  width,
} from './layout';
import { monsterDims, monsterGraphic } from './monsterPics';
import { pcGraphic } from './pcPics';
import { SheetStore, TILE_H, TILE_W } from './sheets';
import { terrainGraphic } from './terrainPics';
import { DEFAULT_BG, PANEL_BG, tilePattern } from './tiling';
import { drawString, drawStringEllipsis, drawStringRight, wrapLines } from './text';

/** Every image the main screen needs, beyond the terrain/monster sheets. */
export const CHROME_SHEETS = [
  'terscreen',
  'statarea',
  'inventory',
  'transcript',
  'textbar',
  'pixpats',
  'buttons',
  'invenbtns',
  'pcs',
];

export class Screen {
  private buttons: PlacedButton[] = [];
  private buttonsMode: 'out' | 'town' | 'combat' | null = null;
  animFrame = 0;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
  ) {}

  draw(session: GameSession): void {
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    this.putBackground(session);
    this.drawPanel('terView');
    this.drawTerrainView(session);
    this.drawPanel('status');
    this.drawStatusBar(session);
    this.drawPanel('pcStats');
    this.drawPcStats(session);
    this.drawPanel('inven');
    this.drawInventory(session);
    this.drawPanel('transcript');
    this.drawTranscript(session);
    this.drawToolbar(session);
  }

  /** put_background (boe.graphics.cpp:653) — the pattern behind everything. */
  private putBackground(session: GameSession): void {
    const pats = this.store.get('pixpats');
    const full: UiRect = { top: 0, left: 0, bottom: BOE_HEIGHT, right: BOE_WIDTH };
    if (!pats) {
      this.ctx.fillStyle = Colours.BLACK;
      this.ctx.fillRect(0, 0, BOE_WIDTH, BOE_HEIGHT);
      return;
    }
    let index: number;
    if (session.isOutdoors) index = DEFAULT_BG.out;
    else if (session.univ.townRecord?.lightingType !== Lighting.LIGHT_NORMAL)
      index = DEFAULT_BG.dungeon;
    else index = DEFAULT_BG.town;
    tilePattern(this.ctx, pats, index, full);
  }

  private drawPanel(which: keyof typeof PANEL_IMAGES): void {
    const rect = WIN_RECTS[which];
    const img = this.store.get(PANEL_IMAGES[which]);
    if (!img) return;
    this.ctx.drawImage(img, rect.left, rect.top);
  }

  /** Fill a panel's interior with the pattern the C++ erases to (bg[6]). */
  private erasePanel(panel: UiRect, inner: UiRect): void {
    const pats = this.store.get('pixpats');
    if (!pats) return;
    tilePattern(this.ctx, pats, PANEL_BG, {
      top: panel.top + inner.top,
      left: panel.left + inner.left,
      bottom: panel.top + inner.bottom,
      right: panel.left + inner.right,
    });
  }

  // ------------------------------------------------------------ terrain view

  /** draw_terrain (boe.graphics.cpp:831) — the 9x9 view around `center`. */
  private drawTerrainView(session: GameSession): void {
    const { univ } = session;
    const center = session.center;
    const town = univ.town;
    const maxDim = town
      ? town.record.maxDim
      : Math.min(96, 48 * univ.scenario.outWidth);
    const maxDimY = town ? town.record.maxDim : Math.min(96, 48 * univ.scenario.outHeight);

    for (let q = 0; q < TER_VIEW_TILES; q++)
      for (let row = 0; row < TER_VIEW_TILES; row++) {
        const x = center.x + q - TER_VIEW_CENTER;
        const y = center.y + row - TER_VIEW_CENTER;
        const pos = terrainSpotPos(q, row);
        if (x < 0 || y < 0 || x >= maxDim || y >= maxDimY) {
          // Out of bounds draws darkness, same as draw_one_terrain_spot(-1).
          this.ctx.fillStyle = Colours.BLACK;
          this.ctx.fillRect(pos.x, pos.y, TILE_W, TILE_H);
          continue;
        }
        const ter = town ? town.record.terrain[x]![y]! : univ.out.at(x, y);
        this.drawTerrainSpot(univ.terrainType(ter).picture, pos.x, pos.y);
      }

    if (town) this.drawTownMonsters(session);
    this.drawPartySymbol(session);
  }

  private drawTerrainSpot(pic: number, px: number, py: number): void {
    const g = terrainGraphic(pic, this.animFrame);
    if (!g) return;
    const img = this.store.get(g.sheetName);
    if (!img) return;
    this.ctx.drawImage(
      img, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
      px, py, TILE_W, TILE_H,
    );
  }

  private drawTownMonsters(session: GameSession): void {
    const town = session.univ.town!;
    const center = session.center;
    for (const monst of town.monsters) {
      if (!monst.isAlive) continue;
      const q = monst.curLoc.x - center.x + TER_VIEW_CENTER;
      const row = monst.curLoc.y - center.y + TER_VIEW_CENTER;
      const { w, h } = monsterDims(monst.pictureNum);
      if (q + w <= 0 || row + h <= 0 || q >= TER_VIEW_TILES || row >= TER_VIEW_TILES) continue;
      const facingRight = monst.direction >= Direction.S;
      for (let part = 0; part < w * h; part++) {
        const px = q + (part % w);
        const py = row + Math.floor(part / w);
        if (px < 0 || py < 0 || px >= TER_VIEW_TILES || py >= TER_VIEW_TILES) continue;
        const g = monsterGraphic(monst.pictureNum, facingRight ? 1 : 0, part);
        if (!g) continue;
        const img = this.store.get(g.sheetName);
        if (!img) continue;
        const pos = terrainSpotPos(px, py);
        this.ctx.drawImage(
          img, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
          pos.x, pos.y, TILE_W, TILE_H,
        );
      }
    }
  }

  private drawPartySymbol(session: GameSession): void {
    const { univ } = session;
    const leader = univ.party.pcs[univ.firstActivePc()];
    if (!leader || !leader.isAlive) return;
    let q = TER_VIEW_CENTER;
    let row = TER_VIEW_CENTER;
    if (session.inTown) {
      q += univ.party.townLoc.x - session.center.x;
      row += univ.party.townLoc.y - session.center.y;
      if (q < 0 || row < 0 || q >= TER_VIEW_TILES || row >= TER_VIEW_TILES) return;
    }
    const g = pcGraphic(leader.whichGraphic, univ.party.direction);
    if (!g) return;
    const img = this.store.get(g.sheetName);
    if (!img) return;
    const pos = terrainSpotPos(q, row);
    this.ctx.drawImage(
      img, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
      pos.x, pos.y, TILE_W, TILE_H,
    );
  }

  // -------------------------------------------------------------- status bar

  /** draw_text_bar (boe.graphics.cpp:747) with text_bar_text's location half. */
  private drawStatusBar(session: GameSession): void {
    const rect = WIN_RECTS.status;
    const inner: UiRect = { top: rect.top + 4, left: rect.left + 5, bottom: rect.bottom, right: rect.right - 5 };
    drawString(this.ctx, inner, session.locationName(), {
      font: 'bold',
      size: 12,
      colour: Colours.WHITE,
    });
    const day = session.univ.party.calcDay();
    drawStringRight(this.ctx, inner, `Day ${day}`, {
      font: 'bold',
      size: 12,
      colour: Colours.WHITE,
    });
  }

  // ---------------------------------------------------------------- PC stats

  /** put_pc_screen (boe.text.cpp:90). */
  private drawPcStats(session: GameSession): void {
    const panel = WIN_RECTS.pcStats;
    const { univ } = session;
    this.erasePanel(panel, { top: 17, left: 2, bottom: 98, right: 269 });

    const at = (rect: UiRect): UiRect => ({
      top: panel.top + rect.top,
      left: panel.left + rect.left,
      bottom: panel.top + rect.bottom,
      right: panel.left + rect.right,
    });

    const label = { font: 'bold', size: 10, colour: Colours.YELLOW } as const;
    drawString(this.ctx, at(PC_PANEL.titles[0]!), 'Party stats:', label);
    drawString(this.ctx, at(PC_PANEL.titles[1]!), 'HP:', label);
    drawString(this.ctx, at(PC_PANEL.titles[2]!), 'SP:', label);
    drawString(this.ctx, at(PC_PANEL.foodLabel), 'Food:', label);
    drawString(this.ctx, at(PC_PANEL.goldLabel), 'Gold:', label);
    drawString(this.ctx, at(PC_PANEL.dayLabel), 'Day:', label);

    const value = { size: 12, colour: Colours.WHITE } as const;
    drawString(this.ctx, at(PC_PANEL.foodValue), String(univ.party.food), value);
    drawString(this.ctx, at(PC_PANEL.goldValue), String(univ.party.gold), value);
    drawString(this.ctx, at(PC_PANEL.dayValue), String(univ.party.calcDay()), value);

    for (let i = 0; i < PC_ROWS.length; i++) {
      const pc = univ.party.pcs[i];
      const row = PC_ROWS[i]!;
      if (!pc || pc.mainStatus === MainStatus.ABSENT) continue;
      const isCurrent = i === univ.curPc;
      drawStringEllipsis(this.ctx, at(row.name), `${i + 1}. ${pc.name}`, {
        size: 12,
        colour: isCurrent ? Colours.BLUE : Colours.BLACK,
        italic: isCurrent,
      });
      if (pc.mainStatus === MainStatus.ALIVE) {
        const hpColour =
          pc.curHealth === pc.maxHealth
            ? Colours.GREEN
            : pc.curHealth > pc.maxHealth
              ? Colours.ORANGE
              : Colours.RED;
        const spColour =
          pc.curSp === pc.maxSp
            ? Colours.BLUE
            : pc.curSp > pc.maxSp
              ? Colours.TEAL
              : Colours.PINK;
        drawString(this.ctx, at(row.hp), String(pc.curHealth), { size: 12, colour: hpColour });
        drawString(this.ctx, at(row.sp), String(pc.curSp), { size: 12, colour: spColour });
      } else {
        const wide = { ...at(row.hp), right: at(row.hp).right + 20 };
        drawString(this.ctx, wide, MAIN_STATUS_LABEL[pc.mainStatus] ?? '', {
          size: 12,
          colour: Colours.BLACK,
        });
      }
      // The info/trade buttons come from invenbtns.png (12x12 icons).
      const btns = this.store.get('invenbtns');
      if (btns) {
        const info = at(row.info);
        const trade = at(row.trade);
        this.ctx.drawImage(btns, 1, 0, 12, 12, info.left, info.top, 12, 12);
        this.ctx.drawImage(btns, 13, 0, 12, 12, trade.left, trade.top, 12, 12);
      }
    }
  }

  // --------------------------------------------------------------- inventory

  /**
   * put_item_screen (boe.text.cpp:210). Items themselves need the inventory
   * and equipment model, so for now the panel shows whose page is up.
   * TODO(M3): full item rows, equip toggles, and the eight bottom buttons.
   */
  private drawInventory(session: GameSession): void {
    const panel = WIN_RECTS.inven;
    this.erasePanel(panel, { top: 17, left: 2, bottom: 122, right: 255 });
    const pc = session.univ.currentPc;
    const header: UiRect = {
      top: panel.top + 3,
      left: panel.left + 4,
      bottom: panel.top + 15,
      right: panel.right - 4,
    };
    drawString(this.ctx, header, `${pc.name}'s Readied Items`, {
      font: 'bold',
      size: 10,
      colour: Colours.YELLOW,
    });
    const body: UiRect = {
      top: panel.top + 22,
      left: panel.left + 6,
      bottom: panel.bottom - 4,
      right: panel.right - 6,
    };
    drawString(this.ctx, body, '(inventory arrives with M3)', {
      size: 12,
      colour: Colours.GREY,
    });
  }

  // -------------------------------------------------------------- transcript

  /** print_buf (boe.text.cpp:1077) — newest messages at the bottom. */
  private drawTranscript(session: GameSession): void {
    const panel = WIN_RECTS.transcript;
    this.erasePanel(panel, TRANSCRIPT_TEXT);
    const area: UiRect = {
      top: panel.top + TRANSCRIPT_TEXT.top,
      left: panel.left + TRANSCRIPT_TEXT.left,
      bottom: panel.top + TRANSCRIPT_TEXT.bottom,
      right: panel.left + TRANSCRIPT_TEXT.right,
    };
    const maxWidth = width(area) - 4;
    const style = { size: 12, colour: Colours.BLACK } as const;

    // Wrap from the newest message backwards until the pane is full.
    const visible: string[] = [];
    const maxLines = Math.floor(height(area) / TRANSCRIPT_LINE_HEIGHT);
    for (let i = session.univ.transcript.length - 1; i >= 0 && visible.length < maxLines; i--) {
      const lines = wrapLines(this.ctx, session.univ.transcript[i]!, maxWidth, style);
      for (let j = lines.length - 1; j >= 0; j--) visible.unshift(lines[j]!);
    }
    const shown = visible.slice(Math.max(0, visible.length - maxLines));
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(area.left, area.top, width(area), height(area));
    this.ctx.clip();
    for (let i = 0; i < shown.length; i++) {
      drawString(
        this.ctx,
        { ...area, top: area.top + i * TRANSCRIPT_LINE_HEIGHT },
        shown[i]!,
        style,
      );
    }
    this.ctx.restore();
  }

  // ----------------------------------------------------------------- toolbar

  /** cToolbar::draw (boe.ui.cpp:193). */
  private drawToolbar(session: GameSession): void {
    const mode: 'out' | 'town' | 'combat' =
      session.mode === GameMode.COMBAT ? 'combat' : session.inTown ? 'town' : 'out';
    if (mode !== this.buttonsMode) {
      this.buttonsMode = mode;
      this.buttons = placeButtons(
        mode === 'town' ? TOWN_BUTTONS : OUT_BUTTONS,
      );
    }
    const img = this.store.get('buttons');
    if (!img) return;
    const origin = WIN_RECTS.actBtns;
    for (const placed of this.buttons) {
      const frame = BTN_SRC_RECTS[placed.type]!;
      const dx = origin.left + placed.bounds.left;
      const dy = origin.top + placed.bounds.top;
      const w = width(placed.bounds);
      const h = height(placed.bounds);
      this.ctx.drawImage(img, frame.left, frame.top, width(frame), height(frame), dx, dy, w, h);
      const icon = buttonIconRect(placed);
      // The frame is inset by 3px on each side to leave room for its bevel.
      this.ctx.drawImage(
        img, icon.left, icon.top, width(icon), height(icon),
        dx + 3, dy + 3, w - 6, h - (placed.type === 0 ? 6 : 3),
      );
    }
  }

  /** Which toolbar button (if any) a click at screen coords landed on. */
  buttonAt(x: number, y: number): PlacedButton | null {
    const origin = WIN_RECTS.actBtns;
    const lx = x - origin.left;
    const ly = y - origin.top;
    for (const placed of this.buttons) {
      const b = placed.bounds;
      if (lx >= b.left && lx < b.right && ly >= b.top && ly < b.bottom) return placed;
    }
    return null;
  }

  /** The terrain-view cell (if any) a click at screen coords landed on. */
  terrainCellAt(x: number, y: number): { q: number; r: number } | null {
    const first = terrainSpotPos(0, 0);
    const q = Math.floor((x - first.x) / TILE_W);
    const r = Math.floor((y - first.y) / TILE_H);
    if (q < 0 || r < 0 || q >= TER_VIEW_TILES || r >= TER_VIEW_TILES) return null;
    return { q, r };
  }
}
