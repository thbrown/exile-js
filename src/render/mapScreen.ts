/**
 * The automap — a port of `draw_map` (boe.town.cpp:1317) and the parts of
 * `display_map` / `close_map` (boe.town.cpp:1594) that decide when it shows.
 *
 * The original opens a second 296x277 OS window for this. The WASM build
 * already gave up on that and draws it over the main window at a fixed offset
 * (`init_mini_map`, boe.items.cpp:662 — `setDrawOffset(52, 62)`), so the port
 * does the same: one overlay panel, at those coordinates, drawn last.
 *
 * The C++ renders terrain into a persistent 384x384 gworld and blits a 40x40
 * tile window out of it; we draw the visible window straight into the panel,
 * which is the same picture without the cache. Everything else — the 6px
 * tiles, the black backing, the road stubs, the markers — is verbatim.
 */

import { GameMode } from '../game/modes';
import { GameSession } from '../game/session';
import { Colours } from './colours';
import { UiRect } from './layout';
import { SheetStore } from './sheets';
import { terrainGraphic } from './terrainPics';
import { drawString } from './text';
import { tilePattern } from './tiling';

/** Sheets the map needs on top of the main screen's set. */
export const MAP_SHEETS = ['termap', 'dlogpics'];

/** The map window, 296x277 at the WASM build's default draw offset. */
export const MAP_WINDOW: UiRect = { top: 62, left: 52, bottom: 62 + 277, right: 52 + 296 };

/** Rects inside the map window, verbatim from boe.town.cpp:68 and draw_map. */
const MAP_PIC_RECT: UiRect = { top: 6, left: 6, bottom: 42, right: 42 };
const MAP_TITLE_RECT: UiRect = { top: 3, left: 50, bottom: 15, right: 300 };
const MAP_BAR_RECT: UiRect = { top: 15, left: 50, bottom: 27, right: 300 };
const MAP_AREA: UiRect = { top: 29, left: 47, bottom: 269, right: 287 };

/** Each map tile is 6px square, and 40 of them fit the 240px area. */
const MAP_TILE = 6;
const MAP_TILES = 40;
/** The road stub, inset by one pixel: trim.png {8,112,12,116}. */
const ROAD_SRC: UiRect = { top: 8, left: 112, bottom: 12, right: 116 };
/** dlogpics.png is 36x36 cells, four to a row (cPict::drawPresetDlog). */
const DLOG_PIC = 36;
/** The map icon the original puts in the corner of the window. */
const MAP_DLOG_PIC = 21;

/** minmax(a, b, c) — clamp c into [a, b]. */
function minmax(lo: number, hi: number, v: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The window of map squares on show, in world coordinates. */
export interface MapView {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The 40x40 window of squares that fits the map area. Outdoors it slides with
 * the party inside the current sector; in town it depends on the town's size,
 * and a 32x32 town is shown whole.
 */
export function mapViewRect(session: GameSession, outMode: boolean): MapView {
  const party = session.univ.party;
  if (outMode) {
    const left = minmax(0, 8, party.locInSec.x - 20);
    const top = minmax(0, 8, party.locInSec.y - 20);
    return { left, top, right: left + MAP_TILES, bottom: top + MAP_TILES };
  }
  const size = session.univ.town?.record.maxDim ?? 48;
  if (size === 32) return { left: 0, top: 0, right: 32, bottom: 32 };
  // 64-square towns clamp to 24 so the window still ends on the far edge.
  const limit = size === 64 ? 24 : 8;
  const left = minmax(0, limit, party.townLoc.x - 20);
  const top = minmax(0, limit, party.townLoc.y - 20);
  return { left, top, right: left + MAP_TILES, bottom: top + MAP_TILES };
}

export class MapScreen {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
  ) {}

  /**
   * draw_map. `outMode` and the title come straight from its opening
   * conditions: an arena fight has no map at all, and a town can forbid it.
   */
  draw(session: GameSession): void {
    const { ctx } = this;
    const univ = session.univ;
    const town = univ.town;
    const arena = session.mode === GameMode.COMBAT && session.whichCombatType === 0;
    // is_out() covers talking and shopping that interrupted outdoor mode, which
    // is what the C++ spells out with store_pre_talk_mode / store_pre_shop_mode.
    const outMode = session.isOutdoors || arena;

    let title = 'Your map:';
    let canMap = true;
    if (arena) {
      title = 'No map in combat.';
      canMap = false;
    } else if (!outMode && town?.record.defyMapping) {
      title = 'This place defies mapping.';
      canMap = false;
    }

    this.drawFrame(title);
    if (!canMap) return;

    const view = mapViewRect(session, outMode);
    // The gworld is cleared to black before any terrain lands on it, so an
    // undersized town (32x32) shows black where the 40-tile window overruns.
    ctx.fillStyle = Colours.BLACK;
    ctx.fillRect(
      MAP_WINDOW.left + MAP_AREA.left,
      MAP_WINDOW.top + MAP_AREA.top,
      MAP_TILE * MAP_TILES,
      MAP_TILE * MAP_TILES,
    );

    for (let x = view.left; x < view.right; x++) {
      for (let y = view.top; y < view.bottom; y++) {
        this.drawSquare(session, outMode, view, x, y);
      }
    }

    // draw_pcs is false in combat, and the party marker is also skipped while a
    // conversation or a shop is up.
    if (session.mode === GameMode.COMBAT) return;
    if (session.talk || session.shop) return;
    // TODO(M5c): DETECT_LIFE puts every living monster on the map as a green
    // dot. The party status effect it reads doesn't exist yet.
    const where = session.inTown ? univ.party.townLoc : univ.party.locInSec;
    if (where.x < view.left || where.x >= view.right) return;
    if (where.y < view.top || where.y >= view.bottom) return;
    this.marker(view, where.x, where.y, Colours.RED, Colours.BLACK);
  }

  /** The window's chrome: background, icon, title and the escape hint. */
  private drawFrame(title: string): void {
    const { ctx } = this;
    const pats = this.store.get('pixpats');
    // tileImage(mini_map(), the_rect, bg[4]) — bg[4], not the panel pattern.
    if (pats) tilePattern(ctx, pats, 4, MAP_WINDOW);
    else {
      ctx.fillStyle = Colours.GREY;
      ctx.fillRect(
        MAP_WINDOW.left,
        MAP_WINDOW.top,
        MAP_WINDOW.right - MAP_WINDOW.left,
        MAP_WINDOW.bottom - MAP_WINDOW.top,
      );
    }

    const dlog = this.store.get('dlogpics');
    if (dlog) {
      ctx.drawImage(
        dlog,
        DLOG_PIC * (MAP_DLOG_PIC % 4),
        DLOG_PIC * Math.floor(MAP_DLOG_PIC / 4),
        DLOG_PIC,
        DLOG_PIC,
        MAP_WINDOW.left + MAP_PIC_RECT.left,
        MAP_WINDOW.top + MAP_PIC_RECT.top,
        DLOG_PIC,
        DLOG_PIC,
      );
    }
    const style = { font: 'bold' as const, size: 10, colour: Colours.WHITE };
    drawString(ctx, this.offset(MAP_TITLE_RECT), title, style);
    drawString(ctx, this.offset(MAP_BAR_RECT), '(Hit Escape to close.)', style);
  }

  /** Translate a window-local rect into canvas coordinates. */
  private offset(r: UiRect): UiRect {
    return {
      top: r.top + MAP_WINDOW.top,
      left: r.left + MAP_WINDOW.left,
      bottom: r.bottom + MAP_WINDOW.top,
      right: r.right + MAP_WINDOW.left,
    };
  }

  /** One 6x6 square: its terrain icon, then a road stub over it. */
  private drawSquare(
    session: GameSession,
    outMode: boolean,
    view: MapView,
    x: number,
    y: number,
  ): void {
    const univ = session.univ;
    const town = univ.town;
    // Outdoors, the sector-local square sits inside the 96x96 window at the
    // quadrant the party is in.
    const ox = outMode ? x + 48 * univ.party.iwc.x : x;
    const oy = outMode ? y + 48 * univ.party.iwc.y : y;

    let explored: boolean;
    let ter: number;
    if (outMode) {
      if (!univ.out.isOnMap(ox, oy)) return;
      explored = univ.out.explored[ox]![oy]! !== 0;
      ter = univ.out.at(ox, oy);
    } else {
      if (!town || !town.isOnMap(x, y)) return;
      explored = town.isExplored(x, y);
      ter = town.record.terrain[x]![y]!;
    }
    if (!explored) return;

    const dx = MAP_WINDOW.left + MAP_AREA.left + MAP_TILE * (x - view.left);
    const dy = MAP_WINDOW.top + MAP_AREA.top + MAP_TILE * (y - view.top);
    const spec = univ.terrainType(ter);

    let pic = spec.mapPic;
    let large = false;
    if (pic === -1) {
      pic = spec.picture;
      large = true;
    }
    if (pic >= 1000) {
      // TODO(M6): custom scenario graphics sheets aren't loaded yet.
    } else if (large) {
      // No map icon of its own: shrink the full-size terrain tile into 6px.
      const g = terrainGraphic(pic);
      const img = g && this.store.get(g.sheetName);
      if (g && img) {
        this.ctx.drawImage(
          img, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
          dx, dy, MAP_TILE, MAP_TILE,
        );
      }
    } else {
      // The termap sheet is indexed by the terrain's *full-size* picture, not
      // by map_pic — map_pic only decides which branch runs. That reads like a
      // slip in the C++, but scenarios are drawn against it, so it stays.
      const img = this.store.get('termap');
      if (img) {
        const p = spec.picture;
        const sx = p < 960 ? 12 * (p % 20) : 12 * 20;
        const sy = p < 960 ? 12 * Math.floor(p / 20) : 12 * (p - 960);
        this.ctx.drawImage(img, sx, sy, 12, 12, dx, dy, MAP_TILE, MAP_TILE);
      }
    }

    const road = outMode ? univ.out.isRoad(ox, oy) : town?.isRoad(x, y);
    if (road) {
      const trim = this.store.get('trim');
      if (trim) {
        this.ctx.drawImage(
          trim, ROAD_SRC.left, ROAD_SRC.top, 4, 4,
          dx + 1, dy + 1, MAP_TILE - 2, MAP_TILE - 2,
        );
      }
    }
  }

  /** fill_rect + frame_circle over one map square. */
  private marker(view: MapView, x: number, y: number, fill: string, ring: string): void {
    const { ctx } = this;
    const dx = MAP_WINDOW.left + MAP_AREA.left + MAP_TILE * (x - view.left);
    const dy = MAP_WINDOW.top + MAP_AREA.top + MAP_TILE * (y - view.top);
    ctx.fillStyle = fill;
    ctx.fillRect(dx, dy, MAP_TILE, MAP_TILE);
    ctx.strokeStyle = ring;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(dx + MAP_TILE / 2, dy + MAP_TILE / 2, MAP_TILE / 2 - 0.5, 0, Math.PI * 2);
    ctx.stroke();
  }
}
