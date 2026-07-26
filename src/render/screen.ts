/**
 * The 605x430 game screen: tiled background, terrain view, status bar, PC
 * stats, inventory, transcript and toolbar. Composed the same way as
 * redraw_screen (boe.graphics.cpp:598) so each panel can be filled in
 * independently as its underlying systems land.
 */

import { Direction } from '../core/location';
import { ItemAbil, ItemType } from '../data/item';
import { variety } from '../data/itemVariety';
import { groundFromTer, terFromGround } from '../data/scenario';
import { TerSpec, TrimType, blocksMove } from '../data/terrain';
import { Lighting } from '../data/town';
import { GameSession } from '../game/session';
import { GameMode, isCombat } from '../game/modes';
import { Boom } from '../game/booms';
import { MAIN_STATUS_LABEL, MainStatus } from '../universe/skills';
import { Colours } from './colours';
import {
  BOE_HEIGHT,
  BOE_WIDTH,
  BTN_SRC_RECTS,
  ITEM_BTN_ICONS,
  ITEM_PANEL,
  ITEM_ROWS,
  ITEM_ROWS_SHOP,
  SPEC_BTN_ICONS,
  FIGHT_BUTTONS,
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
import { ITEM_SHOP_TITLES, specIcon, specPrice } from '../game/itemShop';
import {
  FieldSprite, SFX_SPRITES, SOLID_SPRITES, SPECIAL_SPOT_SPRITE, TRANSIENT_SPRITES,
} from './fieldPics';
import { itemGraphic } from './itemPics';
import { monsterDims, monsterGraphic } from './monsterPics';
import { pcGraphic } from './pcPics';
import { SheetStore, TILE_H, TILE_W, calcRect } from './sheets';
import { terrainGraphic } from './terrainPics';
import { DEFAULT_BG, PANEL_BG, tilePattern } from './tiling';
import { MAP_SHEETS, MapScreen } from './mapScreen';
import { TalkScreen } from './talkScreen';
import { ShopScreen } from './shopScreen';
import { Trim, TrimMasks } from './trim';
import {
  drawString, drawStringCentre, drawStringEllipsis, drawStringRight, wrapLines,
} from './text';

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
  'talkportraits',
  'booms',
  ...MAP_SHEETS,
];

export class Screen {
  /** Hit animations still on screen; see `drawBooms`. */
  booms: Boom[] = [];
  private buttons: PlacedButton[] = [];
  private buttonsMode: 'out' | 'town' | 'combat' | null = null;
  private trim: TrimMasks;
  readonly talkScreen: TalkScreen;
  readonly shopScreen: ShopScreen;
  readonly mapScreen: MapScreen;
  /** map_visible (boe.town.cpp) — the automap overlay is up. */
  mapVisible = false;
  /** The ground terrain trim falls back to when a neighbour is impassable. */
  private currentGround = 0;
  animFrame = 0;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
  ) {
    this.trim = new TrimMasks(store);
    this.talkScreen = new TalkScreen(ctx, store);
    this.shopScreen = new ShopScreen(ctx, store);
    this.mapScreen = new MapScreen(ctx, store);
  }

  draw(session: GameSession): void {
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    this.putBackground(session);
    // Talking and shopping replace the whole left column, so the terrain view,
    // status bar and toolbar are skipped (redraw_screen's MODE_TALKING branch).
    if (session.shop || session.talk) {
      if (session.shop) this.shopScreen.draw(session.shop);
      else this.talkScreen.draw(session.talk!);
      this.drawPanel('pcStats');
      this.drawPcStats(session);
      this.drawPanel('inven');
      this.drawInventory(session);
      this.drawPanel('transcript');
      this.drawTranscript(session);
      if (this.mapVisible) this.mapScreen.draw(session);
      return;
    }
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
    // redraw_screen ends with `if(map_visible) draw_map(false)` (boe.main.cpp:1767).
    if (this.mapVisible) this.mapScreen.draw(session);
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
        this.drawFields(session, q, row, x, y);
      }

    if (town) this.drawTownItems(session);
    if (town) this.drawTownMonsters(session);
    this.drawPartySymbol(session);
    this.drawBooms(session);
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

  /**
   * draw_fields (boe.graphutil.cpp:379) — what's in a space beyond its terrain.
   * The layering is the original's: floor decals, then things standing in the
   * space, then the transient magical walls and clouds, then the white
   * special-encounter marker, which is always drawn last so nothing hides it.
   */
  private drawFields(
    session: GameSession, q: number, row: number, x: number, y: number,
  ): void {
    const img = this.store.get('fields');
    if (!img) return;
    const pos = terrainSpotPos(q, row);
    const blit = (sprite: FieldSprite): void => {
      if (sprite.animated) {
        // Barriers cycle through four frames on teranim.png.
        const anim = this.store.get('teranim');
        if (!anim) return;
        const src = calcRect(sprite.col + (this.animFrame % 4), sprite.row);
        this.ctx.drawImage(
          anim, src.left, src.top, src.width, src.height, pos.x, pos.y, TILE_W, TILE_H);
        return;
      }
      const src = calcRect(sprite.col, sprite.row);
      this.ctx.drawImage(
        img, src.left, src.top, src.width, src.height, pos.x, pos.y, TILE_W, TILE_H);
    };

    const town = session.univ.town;
    if (!town) {
      if (session.univ.out.isSpot(x, y)) blit(SPECIAL_SPOT_SPRITE);
      return;
    }
    for (const [field, sprite] of SFX_SPRITES)
      if (town.hasField(x, y, field)) blit(sprite);
    for (const [field, sprite] of SOLID_SPRITES)
      if (town.hasField(x, y, field)) blit(sprite);
    for (const [field, sprite] of TRANSIENT_SPRITES)
      if (town.hasField(x, y, field)) blit(sprite);
    if (town.specialSpots[x]?.[y]) blit(SPECIAL_SPOT_SPRITE);
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
      // Creatures in the dark or behind unexplored walls stay hidden
      // (party_can_see_monst, boe.locutils.cpp:366).
      if (!session.partyCanSeeMonst(monst)) continue;
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

  /**
   * In combat the party is six figures rather than one, drawn at their own
   * `combatPos`. The PC whose turn it is gets a highlight ring, which is the
   * port's stand-in for the original's animated pose (draw_pcs, M5b).
   */
  private drawCombatParty(session: GameSession): void {
    const { univ } = session;
    for (let i = 0; i < univ.party.pcs.length; i++) {
      const pc = univ.party.pcs[i]!;
      if (!pc.isAlive) continue;
      const q = TER_VIEW_CENTER + pc.combatPos.x - session.center.x;
      const row = TER_VIEW_CENTER + pc.combatPos.y - session.center.y;
      if (q < 0 || row < 0 || q >= TER_VIEW_TILES || row >= TER_VIEW_TILES) continue;
      const pos = terrainSpotPos(q, row);
      const g = pcGraphic(pc.whichGraphic, pc.direction);
      const img = g && this.store.get(g.sheetName);
      if (g && img) {
        this.ctx.drawImage(
          img, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
          pos.x, pos.y, TILE_W, TILE_H,
        );
      }
      if (i === univ.curPc) {
        this.ctx.save();
        this.ctx.strokeStyle = Colours.WHITE;
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(pos.x + 0.5, pos.y + 0.5, TILE_W - 1, TILE_H - 1);
        this.ctx.restore();
      }
    }
  }

  /**
   * The hit animation — boom_space's drawing half (boe.graphics.cpp). One frame
   * from booms.png over the square, with the damage printed on it in white with
   * a black shadow, exactly as the C++ lays it out. The C++ then sleeps; here
   * each boom carries an expiry and `main.ts` keeps redrawing until they're
   * gone.
   */
  private drawBooms(session: GameSession): void {
    if (this.booms.length === 0) return;
    const img = this.store.get('booms');
    const center = session.center;
    for (const boom of this.booms) {
      const q = boom.where.x - center.x + TER_VIEW_CENTER;
      const row = boom.where.y - center.y + TER_VIEW_CENTER;
      if (q < 0 || row < 0 || q >= TER_VIEW_TILES || row >= TER_VIEW_TILES) continue;
      const pos = terrainSpotPos(q, row);
      if (img) {
        this.ctx.drawImage(
          img, boom.type * TILE_W, 0, TILE_W, TILE_H,
          pos.x, pos.y, TILE_W, TILE_H,
        );
      }
      if (boom.damage <= 0) continue;
      const text = String(boom.damage);
      const rect: UiRect = {
        top: pos.y + 13, left: pos.x, bottom: pos.y + 23, right: pos.x + TILE_W,
      };
      // White twice offset either way, then black in the middle — the C++'s
      // cheap drop shadow.
      const style = { size: 10, colour: Colours.WHITE };
      drawStringCentre(
        this.ctx, { ...rect, top: rect.top - 1, left: rect.left - 1 }, text, style);
      drawStringCentre(
        this.ctx, { ...rect, top: rect.top + 1, left: rect.left + 1 }, text, style);
      drawStringCentre(this.ctx, rect, text, { ...style, colour: Colours.BLACK });
    }
  }

  private drawPartySymbol(session: GameSession): void {
    const { univ } = session;
    // Targeting modes (FIRING/THROWING) are combat modes too — the party is
    // still six figures on the map, so this asks `isCombat`, not `== COMBAT`.
    if (isCombat(session.mode)) {
      this.drawCombatParty(session);
      return;
    }
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
   * put_item_screen (boe.text.cpp:213) — the eight visible inventory rows for
   * whichever PC's page is showing, with equipped items italicised and coloured
   * by kind.
   *
   * TODO(M3): the Use/Give/Info buttons, the bottom row of page buttons, and
   * scrolling past the first eight slots.
   */
  private drawInventory(session: GameSession): void {
    const panel = WIN_RECTS.inven;
    this.erasePanel(panel, ITEM_PANEL.erase);
    const pc = session.univ.party.pcs[this.itemPage] ?? session.univ.currentPc;

    const at = (rect: UiRect): UiRect => ({
      top: panel.top + rect.top,
      left: panel.left + rect.left,
      bottom: panel.top + rect.bottom,
      right: panel.left + rect.right,
    });

    // In a shop service mode the panel is a prompt, not a list of your things.
    const service = session.itemShop;
    const title = service ? ITEM_SHOP_TITLES[service.mode] : `${pc.name} inventory:`;
    drawStringEllipsis(this.ctx, at(ITEM_PANEL.title), title, {
      font: 'bold',
      size: 10,
      colour: Colours.YELLOW,
    });

    const btnSheet = this.store.get('invenbtns');
    const rows = service ? ITEM_ROWS_SHOP : ITEM_ROWS;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const item = pc.items[i];
      // The slot number is always shown, so empty slots read as empty.
      drawString(this.ctx, at(row.name), `${i + 1}.`, { size: 12, colour: Colours.BLACK });
      if (!item || item.variety === ItemType.NO_ITEM) continue;

      const equipped = pc.equip[i] === true;
      let colour: string = Colours.BLACK;
      if (equipped) {
        if (item.variety === ItemType.ONE_HANDED || item.variety === ItemType.TWO_HANDED)
          colour = Colours.PINK;
        else if (variety(item.variety).isArmour) colour = Colours.GREEN;
        else colour = Colours.BLUE;
      }

      let label = item.ident ? item.fullName : item.name;
      // Charges show for stacks, ammo and lockpicks; see put_item_screen.
      let showCharges = item.maxCharges > 1 || item.charges > 1;
      if (item.missile < 0 && item.ability !== ItemAbil.LOCKPICKS) showCharges &&= item.ident;
      showCharges &&= item.ability !== ItemAbil.MESSAGE;
      if (showCharges) label += ` (${item.charges})`;

      const nameRect = at(row.name);
      drawStringEllipsis(
        this.ctx,
        { ...nameRect, left: nameRect.left + 36, top: nameRect.top - 2 },
        label,
        { size: 12, colour, italic: equipped },
      );

      // The item's icon sits in the left gutter of its row.
      const g = itemGraphic(item.graphicNum);
      const iconSheet = g ? this.store.get(g.sheetName) : undefined;
      if (g && iconSheet) {
        const icon = at(row.icon);
        this.ctx.drawImage(
          iconSheet, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
          icon.left, icon.top, 18, 18,
        );
      }
      if (btnSheet) {
        // Give, drop and info act on any carried item; Use needs the item
        // ability system, so it isn't offered yet.
        const icon = (src: UiRect, dest: UiRect): void => {
          this.ctx.drawImage(
            btnSheet, src.left, src.top, width(src), height(src),
            dest.left, dest.top, width(src), height(src),
          );
        };
        if (service) {
          // The spec button replaces the row's usual buttons, and only appears
          // on items the service applies to (place_item_button, :410).
          const price = specPrice(service, pc, i);
          if (price !== null) {
            const src = SPEC_BTN_ICONS[specIcon(service.mode)];
            const dest = at(row.spec);
            this.ctx.drawImage(
              btnSheet, src.left, src.top, width(src), height(src),
              dest.left, dest.top, 30, height(src),
            );
            drawString(this.ctx, { ...dest, left: dest.left + 35 }, String(price),
              { font: 'bold', size: 10, colour: Colours.BLACK });
          }
        } else if (!session.shop) {
          // MODE_SHOP has no row buttons at all (handle_item_shop_action:1218).
          icon(ITEM_BTN_ICONS.give, at(row.give));
          icon(ITEM_BTN_ICONS.drop, at(row.drop));
          icon(ITEM_BTN_ICONS.info, at(row.info));
        }
      }
    }
  }

  /** Which PC's inventory page is showing. */
  itemPage = 0;

  /** The inventory row and part a click landed on, if any. */
  inventoryHit(
    x: number, y: number, service = false,
  ): { row: number; part: 'name' | 'give' | 'drop' | 'info' | 'spec' } | null {
    const panel = WIN_RECTS.inven;
    const lx = x - panel.left;
    const ly = y - panel.top;
    const rows = service ? ITEM_ROWS_SHOP : ITEM_ROWS;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const inside = (rect: UiRect): boolean =>
        lx >= rect.left && lx < rect.right && ly >= rect.top && ly < rect.bottom;
      if (service) {
        if (inside(row.spec)) return { row: i, part: 'spec' };
      } else {
        if (inside(row.give)) return { row: i, part: 'give' };
        if (inside(row.drop)) return { row: i, part: 'drop' };
        if (inside(row.info)) return { row: i, part: 'info' };
      }
      if (inside(row.name) || inside(row.icon)) return { row: i, part: 'name' };
    }
    return null;
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

    // Wrap from the newest message backwards until the pane is full. Leading
    // spaces are meaningful — the game indents sub-items of a message — so they
    // are re-applied after wrapping, which strips them.
    const visible: string[] = [];
    const maxLines = Math.floor(height(area) / TRANSCRIPT_LINE_HEIGHT);
    for (let i = session.univ.transcript.length - 1; i >= 0 && visible.length < maxLines; i--) {
      const message = session.univ.transcript[i]!;
      const indent = message.slice(0, message.length - message.trimStart().length);
      const lines = wrapLines(this.ctx, message, maxWidth - indent.length * 4, style);
      for (let j = lines.length - 1; j >= 0; j--) visible.unshift(indent + lines[j]!);
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
      isCombat(session.mode) ? 'combat' : session.inTown ? 'town' : 'out';
    if (mode !== this.buttonsMode) {
      this.buttonsMode = mode;
      this.buttons = placeButtons(
        mode === 'combat' ? FIGHT_BUTTONS : mode === 'town' ? TOWN_BUTTONS : OUT_BUTTONS,
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
