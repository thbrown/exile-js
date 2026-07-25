/**
 * The 605x430 game screen: tiled background, terrain view, status bar, PC
 * stats, inventory, transcript and toolbar. Composed the same way as
 * redraw_screen (boe.graphics.cpp:598) so each panel can be filled in
 * independently as its underlying systems land.
 */

import { Direction } from '../core/location';
import { ItemType } from '../data/item';
import { groundFromTer, terFromGround } from '../data/scenario';
import { TerSpec, TrimType, blocksMove } from '../data/terrain';
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
  ROAD_DEST,
  ROAD_SRC,
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
import { itemGraphic } from './itemPics';
import { monsterDims, monsterGraphic } from './monsterPics';
import { pcGraphic } from './pcPics';
import { SheetStore, TILE_H, TILE_W } from './sheets';
import { terrainGraphic } from './terrainPics';
import { DEFAULT_BG, PANEL_BG, tilePattern } from './tiling';
import { Trim, TrimMasks } from './trim';
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
  'fields',
  'trim',
  'objects',
  'tinyobj',
];

export class Screen {
  private buttons: PlacedButton[] = [];
  private buttonsMode: 'out' | 'town' | 'combat' | null = null;
  private trim: TrimMasks;
  /** The ground terrain trim falls back to when a neighbour is impassable. */
  private currentGround = 0;
  animFrame = 0;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
  ) {
    this.trim = new TrimMasks(store);
  }

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
        // Out of bounds, unexplored, or unlit all draw darkness — the
        // can_draw logic in draw_terrain (boe.graphics.cpp:929).
        let canDraw = x >= 0 && y >= 0 && x < maxDim && y < maxDimY;
        if (canDraw && town)
          canDraw = town.isExplored(x, y) && session.ptInLight(univ.party.townLoc, { x, y });
        else if (canDraw) canDraw = univ.out.explored[x]![y]! !== 0;
        if (!canDraw) {
          this.ctx.fillStyle = Colours.BLACK;
          this.ctx.fillRect(pos.x, pos.y, TILE_W, TILE_H);
          continue;
        }
        const ter = town ? town.record.terrain[x]![y]! : univ.out.at(x, y);
        this.drawTerrainCell(session, ter, q, row, x, y, pos);
        this.placeTrim(session, ter, q, row, x, y);
        if (this.isRoad(session, x, y)) this.placeRoad(session, q, row, x, y);
      }

    if (town) this.drawTownItems(session);
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

  // -------------------------------------------------------------------- trim

  /**
   * The terrain-drawing branch of draw_terrain (boe.graphics.cpp:958-1000):
   * walkway terrain draws its ground type with a corner shape stencilled on
   * top; everything else draws its own tile.
   */
  private drawTerrainCell(
    session: GameSession,
    ter: number,
    q: number,
    row: number,
    x: number,
    y: number,
    pos: { x: number; y: number },
  ): void {
    const { univ } = session;
    const spec = univ.terrainType(ter);
    if (spec.trimType !== TrimType.WALKWAY) {
      this.currentGround = groundFromTer(univ.scenario, ter);
      this.drawTerrainSpot(spec.picture, pos.x, pos.y);
      return;
    }
    const groundT = spec.trimTer;
    const groundTer = terFromGround(univ.scenario, groundT);
    const nature = (nx: number, ny: number): boolean =>
      univ.terrainType(this.coordToTer(session, nx, ny)).groundType === groundT;

    // Which walkway corner/edge shape fits, from the neighbours' ground type.
    let shape = -1;
    if (nature(x - 1, y)) {
      if (nature(x, y - 1)) {
        if (nature(x + 1, y)) shape = nature(x, y + 1) ? 8 : 4;
        else shape = nature(x, y + 1) ? 7 : 1;
      } else if (nature(x, y + 1)) shape = nature(x + 1, y) ? 6 : 0;
    } else if (nature(x, y - 1)) {
      if (nature(x + 1, y)) shape = nature(x, y + 1) ? 5 : 2;
    } else if (nature(x + 1, y) && nature(x, y + 1)) shape = 3;

    this.drawTerrainSpot(
      univ.terrainType(shape < 0 ? ter : groundTer).picture,
      pos.x,
      pos.y,
    );
    if (shape >= 0)
      this.trim.draw(this.ctx, Trim.WALKWAY_BASE + shape, spec.picture, pos.x, pos.y, this.animFrame);
  }

  private coordToTer(session: GameSession, x: number, y: number): number {
    const town = session.univ.town;
    if (town) return town.isOnMap(x, y) ? town.record.terrain[x]![y]! : 0;
    return session.univ.out.isOnMap(x, y) ? session.univ.out.at(x, y) : 0;
  }

  /** get_ground_for_shore (boe.graphics.cpp:1085). */
  private groundForShore(session: GameSession, ter: number): number {
    const spec = session.univ.terrainType(ter);
    if (spec.blockHorse || blocksMove(spec)) return this.currentGround;
    return ter;
  }

  /**
   * place_trim (boe.graphics.cpp:1088) — shoreline frills around fluids, and
   * rounded corners where walls meet open ground.
   */
  private placeTrim(
    session: GameSession,
    ter: number,
    q: number,
    row: number,
    x: number,
    y: number,
  ): void {
    const { univ } = session;
    const pos = terrainSpotPos(q, row);
    const spec = univ.terrainType(ter);
    const town = session.univ.town;
    const lastX = town ? town.record.maxDim - 1 : 95;
    const lastY = lastX;
    const atLeft = x === 0;
    const atTop = y === 0;
    const atRight = x === lastX;
    const atBot = y === lastY;

    const trimAt = (which: Trim, nx: number, ny: number): void => {
      const shore = this.groundForShore(session, this.coordToTer(session, nx, ny));
      this.trim.draw(this.ctx, which, univ.terrainType(shore).picture, pos.x, pos.y, this.animFrame);
    };

    if (spec.trimType === TrimType.FRILLS) {
      const bits = this.fluidTrimBits(session, x, y, atLeft, atTop, atRight, atBot);
      if (bits !== 0) {
        // Corners first, then edges — the order the C++ draws them in.
        if (bits & 2) trimAt(Trim.TOP_RIGHT, x + 1, y - 1);
        if (bits & 8) trimAt(Trim.BOTTOM_RIGHT, x + 1, y + 1);
        if (bits & 32) trimAt(Trim.BOTTOM_LEFT, x - 1, y + 1);
        if (bits & 128) trimAt(Trim.TOP_LEFT, x - 1, y - 1);
        if (bits & 1) trimAt(Trim.TOP, x, y - 1);
        if (bits & 4) trimAt(Trim.RIGHT, x + 1, y);
        if (bits & 16) trimAt(Trim.BOTTOM, x, y + 1);
        if (bits & 64) trimAt(Trim.LEFT, x - 1, y);
      }
    }

    if (spec.trimType !== TrimType.WALL || atTop || atBot || atLeft || atRight) return;

    // Rounded wall corners: a wall corner is cut where open ground meets it.
    const isWall = (nx: number, ny: number): boolean =>
      univ.terrainType(this.coordToTer(session, nx, ny)).trimType === TrimType.WALL;
    const isGround = (nx: number, ny: number): boolean => {
      const t = univ.terrainType(this.coordToTer(session, nx, ny));
      return t.trimType !== TrimType.WALL && !t.blockHorse;
    };
    const left = this.coordToTer(session, x - 1, y);
    const right = this.coordToTer(session, x + 1, y);
    const wall = { l: isWall(x - 1, y), r: isWall(x + 1, y), u: isWall(x, y - 1), d: isWall(x, y + 1) };
    const gnd = { l: isGround(x - 1, y), r: isGround(x + 1, y), u: isGround(x, y - 1), d: isGround(x, y + 1) };
    const cut = (which: Trim, groundTer: number): void => {
      this.trim.draw(
        this.ctx, which, univ.terrainType(groundTer).picture, pos.x, pos.y, this.animFrame,
      );
    };

    if (wall.l && wall.u && gnd.r && gnd.d) cut(Trim.WALL_BR, right);
    if (wall.l && wall.d && gnd.r && gnd.u) cut(Trim.WALL_TR, right);
    if (wall.r && wall.u && gnd.l && gnd.d) cut(Trim.WALL_BL, left);
    if (wall.r && wall.d && gnd.l && gnd.u) cut(Trim.WALL_TL, left);
    if (gnd.l && gnd.u && gnd.r && wall.d) {
      cut(Trim.WALL_TL, right);
      cut(Trim.WALL_TR, right);
    }
    if (wall.l && gnd.d && gnd.r && gnd.u) {
      cut(Trim.WALL_TR, right);
      cut(Trim.WALL_BR, right);
    }
    if (gnd.r && wall.u && gnd.l && gnd.d) {
      cut(Trim.WALL_BL, left);
      cut(Trim.WALL_BR, left);
    }
    if (wall.r && gnd.d && gnd.l && gnd.u) {
      cut(Trim.WALL_TL, left);
      cut(Trim.WALL_BL, left);
    }
    if (gnd.r && gnd.d && gnd.l && gnd.u) {
      cut(Trim.WALL_TL, left);
      cut(Trim.WALL_TR, right);
      cut(Trim.WALL_BL, left);
      cut(Trim.WALL_BR, right);
    }
  }

  /**
   * get_fluid_trim (boe.graphutil.cpp:575) — a bitmask of which neighbours are
   * shore, with the final masking that suppresses corners next to a full edge.
   */
  private fluidTrimBits(
    session: GameSession,
    x: number,
    y: number,
    atLeft: boolean,
    atTop: boolean,
    atRight: boolean,
    atBot: boolean,
  ): number {
    const isShore = (nx: number, ny: number): boolean => {
      const t = session.univ.terrainType(this.coordToTer(session, nx, ny));
      return t.trimType !== TrimType.FRILLS && t.trimType !== TrimType.WATERFALL;
    };
    let bits = 0;
    if (!atLeft && isShore(x - 1, y)) bits |= 64;
    if (!atRight && isShore(x + 1, y)) bits |= 4;
    if (!atTop && isShore(x, y - 1)) bits |= 1;
    if (!atBot && isShore(x, y + 1)) bits |= 16;
    if (!atLeft && !atTop && isShore(x - 1, y - 1)) bits |= 128;
    if (!atRight && !atBot && isShore(x + 1, y + 1)) bits |= 8;
    if (!atRight && !atTop && isShore(x + 1, y - 1)) bits |= 2;
    if (!atLeft && !atBot && isShore(x - 1, y + 1)) bits |= 32;
    // An edge trim already covers its adjacent corners, so drop those.
    if (bits & 1) bits &= 125;
    if (bits & 4) bits &= 245;
    if (bits & 10) bits &= 215;
    if (bits & 64) bits &= 95;
    return bits;
  }

  private isRoad(session: GameSession, x: number, y: number): boolean {
    const town = session.univ.town;
    if (town) return town.isRoad(x, y);
    return session.univ.out.isRoad(x, y);
  }

  /**
   * extend_road_terrain (boe.graphics.cpp:1304): a road stub reaches into the
   * neighbouring tile when that tile is also road-like — a road flag, a city
   * or walkway trim, or a bridge.
   */
  private extendRoad(session: GameSession, x: number, y: number): boolean {
    if (this.isRoad(session, x, y)) return true;
    const town = session.univ.town;
    const inBounds = town
      ? town.isOnMap(x, y)
      : session.univ.out.isOnMap(x, y);
    if (!inBounds) return false;
    const ter = session.univ.terrainType(
      town ? town.record.terrain[x]![y]! : session.univ.out.at(x, y),
    );
    return (
      ter.trimType === TrimType.CITY ||
      ter.trimType === TrimType.WALKWAY ||
      ter.special === TerSpec.BRIDGE
    );
  }

  /** place_road (boe.graphics.cpp:1345) — the road stubs from fields.png. */
  private placeRoad(session: GameSession, q: number, row: number, x: number, y: number): void {
    const img = this.store.get('fields');
    if (!img) return;
    const pos = terrainSpotPos(q, row);
    const blit = (src: UiRect, dest: UiRect): void => {
      this.ctx.drawImage(
        img, src.left, src.top, width(src), height(src),
        pos.x + dest.left, pos.y + dest.top, width(dest), height(dest),
      );
    };
    blit(ROAD_SRC.centre, ROAD_DEST.centre);
    const maxX = session.univ.town ? session.univ.town.record.maxDim - 1 : 96;
    const maxY = maxX;
    if (y === 0 || this.extendRoad(session, x, y - 1)) blit(ROAD_SRC.vertical, ROAD_DEST.top);
    if (x === maxX || this.extendRoad(session, x + 1, y)) blit(ROAD_SRC.horizontal, ROAD_DEST.right);
    if (y === maxY || this.extendRoad(session, x, y + 1)) blit(ROAD_SRC.vertical, ROAD_DEST.bottom);
    if (x === 0 || this.extendRoad(session, x - 1, y)) blit(ROAD_SRC.horizontal, ROAD_DEST.left);
  }

  /** draw_items (boe.graphutil.cpp:293) — items lying on the town floor. */
  private drawTownItems(session: GameSession): void {
    const town = session.univ.town!;
    const center = session.center;
    for (const item of town.items) {
      if (item.variety === ItemType.NO_ITEM || item.contained) continue;
      const q = item.itemLoc.x - center.x + TER_VIEW_CENTER;
      const row = item.itemLoc.y - center.y + TER_VIEW_CENTER;
      if (q < 0 || row < 0 || q >= TER_VIEW_TILES || row >= TER_VIEW_TILES) continue;
      if (!town.isExplored(item.itemLoc.x, item.itemLoc.y)) continue;
      if (!session.ptInLight(session.univ.party.townLoc, item.itemLoc)) continue;
      const g = itemGraphic(item.graphicNum);
      if (!g) continue;
      const img = this.store.get(g.sheetName);
      if (!img) continue;
      const pos = terrainSpotPos(q, row);
      this.ctx.drawImage(
        img, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
        pos.x + g.inset.x, pos.y + g.inset.y,
        TILE_W - 2 * g.inset.x, TILE_H - 2 * g.inset.y,
      );
    }
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
