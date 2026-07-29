/**
 * The 605x430 game screen: tiled background, terrain view, status bar, PC
 * stats, inventory, transcript and toolbar. Composed the same way as
 * redraw_screen (boe.graphics.cpp:598) so each panel can be filled in
 * independently as its underlying systems land.
 */

import { Direction, dist } from '../core/location';
import { ItemAbil, ItemType, canUse } from '../data/item';
import { variety } from '../data/itemVariety';
import { EffectPattern, SpellPat, getBuiltinPattern } from '../data/pattern';
import { groundFromTer, terFromGround } from '../data/scenario';
import { TerSpec, TrimType, blocksMove } from '../data/terrain';
import { Lighting } from '../data/town';
import { GameSession } from '../game/session';
import { GameMode, isCombat, isScrollable } from '../game/modes';
import { Boom } from '../game/booms';
import { Missile, getMissileDirection } from '../game/missileAnim';
import { MAIN_STATUS_LABEL, MainStatus, Status } from '../universe/skills';
import { statIconRect, statusIconFor } from '../data/statusIcons';
import { Player } from '../universe/player';
import { Colours } from './colours';
import {
  BOE_HEIGHT,
  BOE_WIDTH,
  BTN_SRC_RECTS,
  ITEM_BOTTOM_BUTTONS,
  ITEM_BOTTOM_ICONS,
  ITEM_BTN_ICONS,
  ITEM_PANEL,
  ITEM_ROWS,
  ITEM_ROWS_SHOP,
  ITEM_SBAR_RECT,
  SPEC_BTN_ICONS,
  FIGHT_BUTTONS,
  OUT_BUTTONS,
  POINTING_ARROWS,
  PANEL_IMAGES,
  PC_PANEL,
  PC_ROWS,
  PlacedButton,
  ROAD_DEST,
  ROAD_SRC,
  TER_INSET_X,
  TER_INSET_Y,
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
  pointingArrowRects,
  terrainSpotPos,
  width,
} from './layout';
import { ITEM_SHOP_TITLES, specIcon, specPrice } from '../game/itemShop';
import {
  ItemWinMode, ItemWindow, LINES_IN_ITEM_WIN, QUEST_COMPLETED_OFFSET, QUEST_FAILED_OFFSET,
} from '../game/itemWindow';
import { specItemUseable } from '../data/quest';
import { Scrollbar } from './scrollbar';
import {
  FieldSprite, SFX_SPRITES, SOLID_SPRITES, SPECIAL_SPOT_SPRITE, TRANSIENT_SPRITES,
} from './fieldPics';
import { itemGraphic } from './itemPics';
import { monsterDims, monsterGraphic } from './monsterPics';
import { pcGraphic } from './pcPics';
import { SheetStore, TILE_H, TILE_W, calcRect } from './sheets';
import { terrainGraphic } from './terrainPics';
import { DEFAULT_BG, PANEL_BG, tileBwPattern, tilePattern } from './tiling';
import { MAP_SHEETS, MapScreen } from './mapScreen';
import { TalkScreen } from './talkScreen';
import { ShopScreen } from './shopScreen';
import { Trim, TrimMasks } from './trim';
import {
  drawString, drawStringCentre, drawStringEllipsis, drawStringRight, measureString, wrapLines,
} from './text';

/**
 * `bw_pats[3]` — the 50% dither `apply_unseen_mask` shades unexplored ground
 * with (boe.newgraph.cpp:163).
 */
const UNSEEN_PATTERN = 3;

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
  'missiles',
  'staticons',
  'vehicle',
  'dlogscrollwh',
  'bwpats',
  ...MAP_SHEETS,
];

/**
 * The `can_draw` gate from `draw_terrain` (boe.graphics.cpp:929) for one
 * square of the 9x9 view: out of bounds, unexplored, or unlit all draw
 * darkness. Town and combat are separate branches there, and they differ in
 * a way that is very visible once the view can scroll:
 *
 * - In combat the explored map is bypassed the moment the mode is anything
 *   other than plain `MODE_COMBAT` — i.e. while you are aiming — so
 *   scrolling with the pointing arrows during targeting shows whatever the
 *   party can actually see, not a wall of black. It is bypassed for the same
 *   reason while the monsters are going, when the camera is likewise off
 *   somewhere the party may never have been.
 * - In plain town mode, the same fallback exists but is gated on
 *   `MODE_LOOK_TOWN` specifically (boe.graphics.cpp:945): scrolling the view
 *   with **L** falls back to `party_can_see` once explored+lit fails.
 *   `partyCanSeeMonst`'s NPC visibility never gated on `isExplored` at all,
 *   which is why terrain used to look far foggier than the monsters
 *   standing on it while looking around.
 *
 * Exported (not just inlined in `drawTerrainView`) so this exact gate is
 * unit-testable without a canvas.
 */
export function canDrawTerrainSpot(
  session: GameSession, x: number, y: number, maxDim: number, maxDimY: number,
): boolean {
  const { univ } = session;
  const town = univ.town;
  if (x < 0 || y < 0 || x >= maxDim || y >= maxDimY) return false;
  if (town && isCombat(session.mode)) {
    // `monsters_going` is the third of these, and the one that was missing:
    // while the monsters go, the camera is centred on whichever monster is
    // acting, and the ground around it is very often ground the party has
    // never walked on. Without it that monster is drawn — `party_can_see_monst`
    // never consulted the explored map — as a sprite moving over pure black.
    const ignoreExplored = session.whichCombatType === 0 || session.monstersGoing
      || session.mode !== GameMode.COMBAT;
    return (town.isExplored(x, y) || ignoreExplored) && session.partyCanSee({ x, y }) < 6;
  }
  if (town) {
    if (town.isExplored(x, y) && session.ptInLight(univ.party.townLoc, { x, y })) return true;
    if (session.mode === GameMode.LOOK_TOWN) return session.partyCanSee({ x, y }) < 6;
    return false;
  }
  return univ.out.explored[x]?.[y] !== 0;
}

/**
 * text_bar_text (boe.graphics.cpp:685) — what the bar above the terrain view
 * says. Outside combat it is where you are; inside it, it is whose turn it is
 * and what they have left to spend with.
 *
 * The monster half is the one that matters while the monsters go: paired with
 * the camera following each one, it is what names the thing that is about to
 * swing at you. It picks the **first living monster with any AP left**, which
 * is the one currently spending them — the C++'s own comment says so, and its
 * `i = 400` is just a `break`.
 *
 * Exported so the wording is testable without a canvas.
 *
 * TODO(M6): the right-hand half — the "hit m to recast <spell>" hint, and the
 * party status icons it replaces.
 */
export function statusBarText(session: GameSession): string {
  const { univ } = session;
  if (!isCombat(session.mode)) return session.locationName();
  if (session.monstersGoing) {
    for (const monst of univ.town?.monsters ?? []) {
      if (monst.isAlive && monst.ap > 0) return `${monst.getName()} (ap: ${monst.ap})`;
    }
    return session.locationName();
  }
  const pc = univ.party.pcs[univ.curPc];
  if (!pc) return session.locationName();
  return `${pc.name} (ap: ${pc.ap})`;
}

export class Screen {
  /** Hit animations still on screen; see `drawBooms`. */
  booms: Boom[] = [];
  /** Projectiles still in flight; see `drawMissiles`. */
  missiles: Missile[] = [];
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
        const canDraw = canDrawTerrainSpot(session, x, y, maxDim, maxDimY);
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
    if (!town) this.drawOutdoorGroups(session);
    this.drawPartySymbol(session);
    // `apply_unseen_mask` comes after everything drawn into the terrain gworld
    // (boe.graphics.cpp:1067), so it shades the monsters and the party too.
    this.applyUnseenMask(session, maxDim, maxDimY);
    this.drawBooms(session);
    this.drawMissiles(session);
    // redraw_screen draws these over the finished terrain (boe.graphics.cpp:637
    // and :1077), which is why they come after everything else.
    this.drawPointingArrows(session);
    this.drawTargets(session);
    this.drawTargetingLine(session);
  }

  /**
   * `apply_unseen_mask` (boe.newgraph.cpp:138) — the shadow just past what the
   * party can see. Every square of the view the party hasn't explored gets a
   * 50% dither (`bw_pats[3]`) tiled over it, which is what softens the edge of
   * the lit area instead of leaving a hard black wall.
   *
   * The rect it stamps is **8px wider and taller than a tile** and sits 4px up
   * and left of it, so the shadow bleeds a little way over the ground you *can*
   * see — that overlap is the whole visual effect, and it is why the mask is a
   * separate pass rather than part of drawing the square.
   *
   * `unexplored_area` is 13x13 around the view centre (boe.graphics.cpp:887)
   * and the mask reads indices 1..11 of it, so it covers one square more than
   * the 9x9 view in each direction; the extra ring is clipped away against the
   * view. Kept, because that ring is what makes the bleed reach the outermost
   * visible squares.
   */
  private applyUnseenMask(session: GameSession, maxDim: number, maxDimY: number): void {
    const { univ } = session;
    const town = univ.town;
    // An outdoor arena has no unexplored ground to speak of, and a dark town
    // uses the light mask instead (TODO: apply_light_mask, :168).
    if (isCombat(session.mode) && session.whichCombatType === 0) return;
    if (town && town.record.lightingType > 0) return;
    const pats = this.store.get('bwpats');
    if (!pats) return;

    const view = WIN_RECTS.terView;
    const clip: UiRect = {
      top: view.top + TER_INSET_Y,
      left: view.left + TER_INSET_X,
      bottom: view.top + TER_INSET_Y + TER_VIEW_TILES * TILE_H,
      right: view.left + TER_INSET_X + TER_VIEW_TILES * TILE_W,
    };
    const centre = town ? session.center : univ.party.outLoc;

    for (let q = -1; q <= TER_VIEW_TILES; q++)
      for (let row = -1; row <= TER_VIEW_TILES; row++) {
        const x = centre.x + q - TER_VIEW_CENTER;
        const y = centre.y + row - TER_VIEW_CENTER;
        if (x < 0 || y < 0 || x >= maxDim || y >= maxDimY) continue;
        // A town square off the map is left alone rather than shaded.
        if (town && !town.isOnMap(x, y)) continue;
        const explored = town ? town.isExplored(x, y) : univ.out.explored[x]?.[y] !== 0;
        if (explored) continue;

        const pos = terrainSpotPos(q, row);
        const dest: UiRect = {
          top: Math.max(pos.y - 4, clip.top),
          left: Math.max(pos.x - 4, clip.left),
          bottom: Math.min(pos.y + TILE_H + 4, clip.bottom),
          right: Math.min(pos.x + TILE_W + 4, clip.right),
        };
        if (dest.right <= dest.left || dest.bottom <= dest.top) continue;
        tileBwPattern(this.ctx, pats, UNSEEN_PATTERN, dest);
      }
  }

  /**
   * draw_pointing_arrows (boe.graphics.cpp:1634) — the twelve little arrows
   * around the terrain view that scroll it while you're aiming, so a spell can
   * reach a target the party can't currently see on screen. Drawn only in
   * `scrollableModes`, and never while the monsters are moving.
   */
  private drawPointingArrows(session: GameSession): void {
    // `if(monsters_going || !scrollableModes.count(overall_mode)) return;`
    // (boe.graphics.cpp:1635) — the view isn't the player's to scroll while
    // it is following the monsters around.
    if (session.monstersGoing || !isScrollable(session.mode)) return;
    const sheet = this.store.get('invenbtns');
    if (!sheet) return;
    for (const [dir, pos] of POINTING_ARROWS) {
      const { src, dest } = pointingArrowRects(dir, pos);
      this.ctx.drawImage(
        sheet, src.left, src.top, width(src), height(src),
        dest.left, dest.top, width(dest), height(dest),
      );
    }
  }

  /**
   * Which way a click at (x, y) scrolls the view, or null. The C++ doesn't
   * hit-test the arrows themselves — it asks whether the point is inside the
   * terrain *panel* but outside the 9x9 grid inset 13px within it
   * (boe.actions.cpp:1711), so the whole border is live and the arrows are
   * only a hint about where to click. Kept, since a player who aims for the
   * border rather than the 8px arrow should still get the scroll.
   */
  scrollBorderAt(x: number, y: number): { dx: number; dy: number } | null {
    const panel = WIN_RECTS.terView;
    if (x < panel.left || x >= panel.right || y < panel.top || y >= panel.bottom) return null;
    const grid = {
      top: panel.top + TER_INSET_Y,
      left: panel.left + TER_INSET_X,
      bottom: panel.bottom - TER_INSET_Y,
      right: panel.right - TER_INSET_X,
    };
    if (x >= grid.left && x < grid.right && y >= grid.top && y < grid.bottom) return null;
    // Each of the four tests is independent, so a corner scrolls diagonally.
    let dx = 0;
    let dy = 0;
    if (y < grid.top) dy = -1;
    if (y >= grid.bottom) dy = 1;
    if (x < grid.left) dx = -1;
    if (x >= grid.right) dx = 1;
    if (dx === 0 && dy === 0) return null;
    return { dx, dy };
  }

  /**
   * Where the pointer is, in canvas coordinates, or null when it's off the
   * canvas. `mouse_window_coords()` in the C++, which `draw_targeting_line`
   * re-reads on every frame.
   */
  hover: { x: number; y: number } | null = null;

  /**
   * What the game is currently aiming, if anything: the pattern that will land
   * and how far it reaches. Missiles and the two combat targeting modes all
   * draw the same overlay as a town spell does.
   */
  private aiming(session: GameSession): { pattern: EffectPattern; range: number } | null {
    if (session.spellTargeting) {
      return {
        pattern: getBuiltinPattern(session.spellTargeting.pattern),
        range: session.spellTargeting.range,
      };
    }
    if (session.townTarget) {
      const pattern = getBuiltinPattern(session.townTarget.pattern);
      // The C++ gates town targeting's overlay on `current_pat[4][4] != 0` —
      // a pattern with an empty centre gets no crosshair at all.
      if (pattern[4]?.[4] === 0) return null;
      return { pattern, range: session.townTarget.range };
    }
    // A missile is a single square, at the range load_missile worked out.
    if (session.missile) {
      return { pattern: getBuiltinPattern(SpellPat.SINGLE), range: session.missile.range };
    }
    return null;
  }

  /**
   * draw_targeting_line (boe.graphics.cpp:1708) — the grey line from the
   * caster to the cursor, and a white frame around every square the spell's
   * pattern would cover. Drawn only while the cursor is on a square that is
   * both in sight and in range, so losing the crosshair *is* the "you can't
   * reach that" feedback.
   */
  private drawTargetingLine(session: GameSession): void {
    const aim = this.hover === null ? null : this.aiming(session);
    if (!aim || !this.hover) return;
    // Outdoors the C++ skips it entirely (`if(!is_out()) draw_targeting_line()`).
    if (!session.univ.town) return;

    const cell = this.terrainCellAt(this.hover.x, this.hover.y);
    if (!cell) return;
    const center = session.center;
    const at = { x: center.x + cell.q - 4, y: center.y + cell.r - 4 };

    const from = isCombat(session.mode) || session.missile !== null
      ? session.univ.currentPc.combatPos
      : session.univ.party.townLoc;
    if (session.canSeeLight(from, at) >= 5) return;
    if (dist(from, at) > aim.range) return;

    const { ctx } = this;
    ctx.save();
    const panel = WIN_RECTS.terView;
    // Clipped to the terrain view, as the C++ does, so a line to a square near
    // the edge doesn't run out over the panel frame.
    ctx.beginPath();
    ctx.rect(panel.left + TER_INSET_X, panel.top + TER_INSET_Y,
      TER_VIEW_TILES * TILE_W, TER_VIEW_TILES * TILE_H);
    ctx.clip();

    // The line runs from the middle of the caster's square to the cursor.
    const fromSpot = terrainSpotPos(from.x - center.x + 4, from.y - center.y + 4);
    ctx.strokeStyle = 'rgb(128,128,128)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(fromSpot.x + TILE_W / 2, fromSpot.y + TILE_H / 2);
    ctx.lineTo(this.hover.x, this.hover.y);
    ctx.stroke();

    // Then the footprint: every cell of the 9x9 pattern that is set, framed.
    ctx.strokeStyle = Colours.WHITE;
    ctx.lineWidth = 1;
    for (let q = 0; q < TER_VIEW_TILES; q++)
      for (let r = 0; r < TER_VIEW_TILES; r++) {
        const spot = { x: center.x + q - 4, y: center.y + r - 4 };
        const dx = spot.x - at.x;
        const dy = spot.y - at.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) continue;
        if ((aim.pattern[dx + 4]?.[dy + 4] ?? 0) === 0) continue;
        const px = terrainSpotPos(q, r);
        ctx.strokeRect(px.x + 0.5, px.y + 0.5, TILE_W - 1, TILE_H - 1);
        // A multi-target spell prints how many shots are left in the middle
        // square, so you can see the count come down as you pick.
        if (session.mode === GameMode.FANCY_TARGET && dx === 0 && dy === 0) {
          drawStringCentre(ctx,
            { top: px.y + TILE_H / 2 - 6, left: px.x, bottom: px.y + TILE_H / 2 + 6,
              right: px.x + TILE_W },
            String(session.spellTargeting?.targetsLeft ?? 0),
            { size: 12, colour: Colours.WHITE });
        }
      }
    ctx.restore();
  }

  /**
   * draw_targets (boe.graphics.cpp:1665) — the squares a multi-target spell has
   * already been pointed at, marked from the invenbtns sheet. Only FANCY_TARGET
   * collects squares, so only it has anything to draw.
   */
  private drawTargets(session: GameSession): void {
    if (session.mode !== GameMode.FANCY_TARGET) return;
    const chosen = session.spellTargeting?.targets ?? [];
    if (chosen.length === 0) return;
    const sheet = this.store.get('invenbtns');
    if (!sheet) return;
    const center = session.center;
    for (const target of chosen) {
      const q = target.x - center.x + 4;
      const r = target.y - center.y + 4;
      if (q < 0 || r < 0 || q >= TER_VIEW_TILES || r >= TER_VIEW_TILES) continue;
      const spot = terrainSpotPos(q, r);
      // src {top:0,left:46,bottom:12,right:58}, inset 8 and 12 into the cell.
      this.ctx.drawImage(sheet, 46, 0, 12, 12, spot.x + 8, spot.y + 12, 12, 12);
    }
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

  /**
   * draw_monsters' outdoor half (boe.graphutil.cpp:120) — the wandering
   * encounters roaming the world map. A whole group is drawn as one creature:
   * the first monster type in it that isn't empty.
   */
  private drawOutdoorGroups(session: GameSession): void {
    const { univ } = session;
    const centre = univ.party.outLoc;
    for (const enc of univ.party.outC) {
      if (!enc.exists) continue;
      if (Math.abs(enc.mLoc.x - centre.x) > 4 || Math.abs(enc.mLoc.y - centre.y) > 4) continue;
      if (session.canSeeLight(centre, enc.mLoc) >= 5) continue;
      const which = enc.whatMonst.monst.find((m) => m > 0);
      if (which === undefined) continue;
      const pic = univ.scenario.scenMonsters[which]?.pictureNum ?? -1;
      if (pic < 0) continue;
      const q = enc.mLoc.x - centre.x + TER_VIEW_CENTER;
      const row = enc.mLoc.y - centre.y + TER_VIEW_CENTER;
      const { w, h } = monsterDims(pic);
      for (let part = 0; part < w * h; part++) {
        const px = q + (part % w);
        const py = row + Math.floor(part / w);
        if (px < 0 || py < 0 || px >= TER_VIEW_TILES || py >= TER_VIEW_TILES) continue;
        const g = monsterGraphic(pic, enc.direction < 4 ? 0 : 1, part);
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
      // `frame_active_pc` bails while the monsters go (boe.graphutil.cpp:264):
      // the ring means "this one is up", and during their turn nobody is.
      if (i === univ.curPc && !session.monstersGoing) {
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
    const now = performance.now();
    for (const boom of this.booms) {
      // Queued behind a missile still in flight — not yet.
      if (boom.starts > now) continue;
      const q = boom.where.x - center.x + TER_VIEW_CENTER;
      const row = boom.where.y - center.y + TER_VIEW_CENTER;
      if (q < 0 || row < 0 || q >= TER_VIEW_TILES || row >= TER_VIEW_TILES) continue;
      const base = terrainSpotPos(q, row);
      const pos = { x: base.x + boom.xAdj, y: base.y + boom.yAdj };
      // booms.png is one row of single-frame hit sprites (row 0, a column per
      // `boom_gr` type) and six rows of eight-frame explosions under it. A
      // blow uses the first, a volley the second — `boom_space` versus
      // `do_explosion_anim`, and drawing every hit with the first is what made
      // a fireball land like a punch.
      let src: { col: number; row: number } | null = { col: boom.type, row: 0 };
      if (boom.animated) {
        // `for(t = 0; t < 11; t++)` with the sprite drawn while
        // `t + offset` is in 0..7 — the tail of the loop is the frames after
        // this explosion's own have run out.
        const span = Math.max(1, boom.expires - boom.starts);
        const t = Math.min(10, Math.floor(((now - boom.starts) / span) * 11));
        const col = t + boom.offset;
        src = col >= 0 && col <= 7 ? { col, row: 1 + boom.type } : null;
      }
      if (src === null) continue;
      if (img) {
        this.ctx.drawImage(
          img, src.col * TILE_W, src.row * TILE_H, TILE_W, TILE_H,
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

  /**
   * do_missile_anim's drawing half (boe.newgraph.cpp:347). Each missile is
   * parameterised from its origin to its destination and stepped by wall clock
   * rather than by a blocking sleep; `main.ts` keeps redrawing until they land.
   *
   * The pixel arithmetic is the C++'s: the ends are the tile centres offset by
   * (14,18) from the tile's top-left, the destination gets the +1 the C++ adds
   * "to prevent infinite slope", and the 16×16 sprite is centred on the point.
   */
  private drawMissiles(session: GameSession): void {
    if (this.missiles.length === 0) return;
    const img = this.store.get('missiles');
    if (!img) return;
    const center = session.center;
    const now = performance.now();

    // The terrain view, which a missile flying off the edge is clipped to.
    const viewTL = terrainSpotPos(0, 0);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(
      viewTL.x, viewTL.y, TER_VIEW_TILES * TILE_W, TER_VIEW_TILES * TILE_H);
    this.ctx.clip();

    for (const m of this.missiles) {
      // Still waiting its turn on the timeline.
      if (m.started > now) continue;
      const start = terrainSpotPos(
        m.from.x - center.x + TER_VIEW_CENTER, m.from.y - center.y + TER_VIEW_CENTER);
      const finish = terrainSpotPos(
        m.dest.x - center.x + TER_VIEW_CENTER, m.dest.y - center.y + TER_VIEW_CENTER);
      const startPt = { x: start.x + 14, y: start.y + 18 };
      const finishPt = {
        x: finish.x + 1 + 14 + m.xAdj, y: finish.y + 1 + 18 + m.yAdj,
      };
      const x1 = finishPt.x - startPt.x;
      const y1 = finishPt.y - startPt.y;

      const t = Math.min(m.len, Math.trunc(((now - m.started) / m.dur) * m.len));
      const px = startPt.x + Math.trunc((x1 * t) / m.len);
      let py = startPt.y + Math.trunc((y1 * t) / m.len);
      // A lobbed missile rises and falls over its flight.
      if (m.pathType === 1) py -= Math.trunc((t * (m.len - t)) / 100);

      // Types below 7 are directional: the column is the heading. From 7 up the
      // sprite is animated and the column cycles with the step instead.
      const col = m.type < 7 ? getMissileDirection(startPt, finishPt) : t % 8;
      this.ctx.drawImage(
        img, 1 + 18 * col, 1 + 18 * m.type, 16, 16, px - 7, py - 7, 16, 16);
    }
    this.ctx.restore();
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
    const pos = terrainSpotPos(q, row);
    const dir = univ.party.direction;
    if (univ.party.inBoat >= 0 || univ.party.inHorse >= 0) {
      // draw_party_symbol's vehicle half (boe.graphutil.cpp:494): the boat
      // sheet is directional (N/S get their own frame, the rest split
      // east/west); the horse sheet only ever splits east/west.
      const img = this.store.get('vehicle');
      if (!img) return;
      const cell = univ.party.inBoat >= 0
        ? { i: dir === Direction.N ? 2 : dir === Direction.S ? 3 : dir > Direction.S ? 1 : 0, j: 0 }
        : { i: (dir > Direction.SE ? 1 : 0) + 2, j: 1 };
      const r = calcRect(cell.i, cell.j);
      this.ctx.drawImage(
        img, r.left, r.top, r.width, r.height, pos.x, pos.y, TILE_W, TILE_H);
      return;
    }
    const g = pcGraphic(leader.whichGraphic, dir);
    if (!g) return;
    const img = this.store.get(g.sheetName);
    if (!img) return;
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
    drawString(this.ctx, inner, statusBarText(session), {
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

    // put_pc_screen's tail (boe.text.cpp:206): "sometimes this gets called when
    // a character is slain" — if the dead PC's own page is up, move it on. The
    // C++ does this from the drawing code too.
    if (univ.curPc < 6 && univ.currentPc.mainStatus !== MainStatus.ALIVE
      && this.itemWindow.mode === univ.curPc)
      this.itemWindow.setStatWindowForPc(univ, univ.curPc);

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
        this.drawPcEffects(pc, i, at);
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

  /**
   * draw_pc_effects (boe.text.cpp:643) — the status icons that sit to the right
   * of a PC's name, which is where "poisoned" actually shows up.
   *
   * They start just past the name and march rightwards 13px at a time, stopping
   * before they'd reach the HP column. Statuses are drawn in `Status` order —
   * the C++ walks a `std::map` keyed by the enum, so ascending is the order,
   * and a status sitting at 0 draws nothing.
   */
  private drawPcEffects(
    pc: Player, index: number, at: (rect: UiRect) => UiRect,
  ): void {
    const icons = this.store.get('staticons');
    if (!icons) return;
    const nameRow = at(PC_ROWS[index]!.name);
    // The C++ measures the name alone and adds 33 for the "1. " and the gap.
    const nameWidth = measureString(this.ctx, pc.name, { size: 12 });
    let left = nameRow.left + nameWidth + 30;
    // The icon row sits three pixels above the name row: {18,15,30,27} in the
    // C++ against a name row that starts at 21.
    const top = nameRow.top - 3;
    const rightLimit = at(PC_ROWS[0]!.hp).left - 5;

    for (let which = Status.POISONED_WEAPON; which <= Status.CHARM; which++) {
      const code = statusIconFor(which, pc.status[which] ?? 0);
      if (code >= 0) {
        const from = statIconRect(code);
        this.ctx.drawImage(icons, from.left, from.top, 12, 12, left, top, 12, 12);
        left += 13;
      }
      // The C++ tests the limit once per status, not once per icon drawn — so a
      // name long enough to push the first slot past the limit stops the row
      // even when that status had no icon. It also tests *after* drawing, so a
      // name that long gets one icon painted over the HP column before the row
      // gives up. Both are the original's behaviour; kept.
      if (left + 12 >= rightLimit) break;
    }
  }

  /**
   * Which part of which PC row a click landed on, if any — the `pc_buttons`
   * hit test from handle_action's PC-area branch.
   */
  pcRowHit(
    x: number, y: number,
  ): { index: number; part: 'name' | 'hp' | 'sp' | 'info' | 'trade' } | null {
    const panel = WIN_RECTS.pcStats;
    const lx = x - panel.left;
    const ly = y - panel.top;
    for (let i = 0; i < PC_ROWS.length; i++) {
      const row = PC_ROWS[i]!;
      const inside = (rect: UiRect): boolean =>
        lx >= rect.left && lx < rect.right && ly >= rect.top && ly < rect.bottom;
      if (inside(row.info)) return { index: i, part: 'info' };
      if (inside(row.trade)) return { index: i, part: 'trade' };
      if (inside(row.hp)) return { index: i, part: 'hp' };
      if (inside(row.sp)) return { index: i, part: 'sp' };
      if (inside(row.name)) return { index: i, part: 'name' };
    }
    return null;
  }

  // --------------------------------------------------------------- inventory

  /**
   * put_item_screen (boe.text.cpp:213) — the item panel. Normally the eight
   * visible rows of one PC's pack, with equipped items italicised and coloured
   * by kind; the Special Items and Quests pages replace the list with their
   * own.
   */
  private drawInventory(session: GameSession): void {
    const panel = WIN_RECTS.inven;
    this.erasePanel(panel, ITEM_PANEL.erase);
    const pc = session.univ.party.pcs[this.itemPage] ?? session.univ.currentPc;
    const win = this.itemWindow;

    const at = (rect: UiRect): UiRect => ({
      top: panel.top + rect.top,
      left: panel.left + rect.left,
      bottom: panel.top + rect.bottom,
      right: panel.left + rect.right,
    });

    // In a shop service mode the panel is a prompt, not a list of your things.
    const service = session.itemShop;
    let title = service ? ITEM_SHOP_TITLES[service.mode] : `${pc.name} inventory:`;
    if (!service && win.mode === ItemWinMode.SPECIAL) title = 'Special items:';
    if (!service && win.mode === ItemWinMode.QUESTS) title = 'Quests/Jobs:';
    drawStringEllipsis(this.ctx, at(ITEM_PANEL.title), title, {
      font: 'bold',
      size: 10,
      colour: Colours.YELLOW,
    });

    // The scrollbar is a control on the main window, not part of the panel, so
    // it keeps the C++'s absolute rect. `set_stat_window` owns its maximum.
    this.itemSbar.setMaximum(win.scrollMax);
    this.itemSbar.setPosition(win.scroll);

    const btnSheet = this.store.get('invenbtns');
    if (!service && win.mode >= ItemWinMode.SPECIAL) {
      this.drawSpecialPage(session, at, btnSheet);
      this.drawItemBottomButtons(session, at);
      this.itemSbar.draw(this.ctx, this.store);
      return;
    }

    const rows = service ? ITEM_ROWS_SHOP : ITEM_ROWS;
    // `item_offset` — which slot the top row is showing. A pack holds 24 and
    // the panel shows eight, so the scrollbar reaches the other two thirds.
    const offset = service ? 0 : win.scroll;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const iNum = i + offset;
      const item = pc.items[iNum];
      // The slot number is always shown, so empty slots read as empty.
      drawString(this.ctx, at(row.name), `${iNum + 1}.`, { size: 12, colour: Colours.BLACK });
      if (!item || item.variety === ItemType.NO_ITEM) continue;

      const equipped = pc.equip[iNum] === true;
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
          const price = specPrice(service, pc, iNum);
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
          // Use only appears where it would work (boe.text.cpp:370): the item
          // has to be usable somewhere, and a rechargeable one has to have
          // something left in it.
          if (canUse(item) && (item.rechargeable ? item.charges > 0 : true))
            icon(ITEM_BTN_ICONS.use, at(row.use));
        }
      }
    }
    if (!service) {
      this.drawItemBottomButtons(session, at);
      this.itemSbar.draw(this.ctx, this.store);
    }
  }

  /**
   * put_item_screen's ITEM_WIN_SPECIAL and ITEM_WIN_QUESTS branches
   * (boe.text.cpp:270 and :288) — a plain list of names with an Info button.
   */
  private drawSpecialPage(
    session: GameSession,
    at: (rect: UiRect) => UiRect,
    btnSheet: CanvasImageSource | undefined,
  ): void {
    const win = this.itemWindow;
    const scen = session.univ.scenario;
    const icon = (src: UiRect, dest: UiRect): void => {
      if (!btnSheet) return;
      this.ctx.drawImage(
        btnSheet, src.left, src.top, width(src), height(src),
        dest.left, dest.top, width(src), height(src),
      );
    };

    for (let i = 0; i < LINES_IN_ITEM_WIN; i++) {
      const iNum = i + win.scroll;
      const entry = win.specItemArray[iNum];
      if (entry === undefined) continue;
      const row = ITEM_ROWS[i]!;
      const nameRect = at(row.name);

      if (win.mode === ItemWinMode.SPECIAL) {
        const spec = scen.specialItems[entry];
        if (!spec) continue;
        drawStringEllipsis(this.ctx, nameRect, spec.name,
          { font: 'bold', size: 12, colour: Colours.BLACK });
        icon(ITEM_BTN_ICONS.info, at(row.info));
        // A useable special item gets its Use button where Drop would be, so
        // there's no gap between Use and Info. Not in a fight.
        if (specItemUseable(spec) && !isCombat(session.mode))
          icon(ITEM_BTN_ICONS.use, at(row.drop));
      } else {
        const which = entry % QUEST_COMPLETED_OFFSET;
        const quest = scen.quests[which];
        if (!quest) continue;
        const failed = Math.floor(entry / QUEST_COMPLETED_OFFSET) === 2;
        const style = {
          font: 'bold', size: 12, colour: failed ? Colours.RED : Colours.BLACK,
        } as const;
        drawStringEllipsis(this.ctx, nameRect, quest.name, style);
        // A finished quest is struck through in green, across its own width.
        if (Math.floor(entry / QUEST_COMPLETED_OFFSET) === 1) {
          const y = Math.floor((nameRect.top + nameRect.bottom) / 2);
          this.ctx.save();
          this.ctx.strokeStyle = Colours.GREEN;
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(nameRect.left, y + 0.5);
          this.ctx.lineTo(nameRect.left + measureString(this.ctx, quest.name, style), y + 0.5);
          this.ctx.stroke();
          this.ctx.restore();
        }
        icon(ITEM_BTN_ICONS.info, at(row.info));
      }
    }
  }

  /**
   * place_item_bottom_buttons (boe.text.cpp:499) — the six PC portraits, the
   * Special Items and Quests tabs and the help button along the bottom of the
   * panel. A dead PC's button isn't drawn and isn't live; the Quests tab isn't
   * drawn at all in a scenario with no quests.
   */
  private drawItemBottomButtons(session: GameSession, at: (rect: UiRect) => UiRect): void {
    const sheet = this.store.get('invenbtns');
    if (!sheet) return;
    const blit = (img: CanvasImageSource, src: UiRect, dest: UiRect): void => {
      this.ctx.drawImage(
        img, src.left, src.top, width(src), height(src),
        dest.left, dest.top, width(dest), height(dest),
      );
    };

    this.itemBottomActive = [false, false, false, false, false, false, true, false, true];
    for (let i = 0; i < 6; i++) {
      const pc = session.univ.party.pcs[i];
      if (!pc || pc.mainStatus !== MainStatus.ALIVE) continue;
      this.itemBottomActive[i] = true;
      const dest = at(ITEM_BOTTOM_BUTTONS[i]!);
      blit(sheet, ITEM_BOTTOM_ICONS.pcFrame, dest);

      const g = pcGraphic(pc.whichGraphic, Direction.N);
      const face = g ? this.store.get(g.sheetName) : undefined;
      const inner = {
        top: dest.top + 2, left: dest.left + 2, bottom: dest.bottom - 2, right: dest.right - 2,
      };
      if (g && face) {
        this.ctx.drawImage(
          face, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
          inner.left, inner.top, width(inner), height(inner),
        );
      }
      // The numeral sits to the left of the portrait; "6" is nudged an extra
      // pixel down because it has an ascender in this font.
      const numeral = String(i + 1);
      const style = { font: 'bold', size: 10, colour: Colours.YELLOW } as const;
      const w = measureString(this.ctx, numeral, style);
      drawString(this.ctx, {
        top: inner.top + (i === 5 ? 3 : 2),
        left: inner.left - w - 5,
        bottom: inner.bottom,
        right: inner.right,
      }, numeral, style);
    }

    blit(sheet, ITEM_BOTTOM_ICONS.special, at(ITEM_BOTTOM_BUTTONS[6]!));
    if (session.univ.scenario.quests.length > 0) {
      this.itemBottomActive[7] = true;
      blit(sheet, ITEM_BOTTOM_ICONS.quests, at(ITEM_BOTTOM_BUTTONS[7]!));
    }
    blit(sheet, ITEM_BOTTOM_ICONS.help, at(ITEM_BOTTOM_BUTTONS[8]!));
  }

  /** Which page is showing, and where its list is scrolled to. */
  readonly itemWindow = new ItemWindow();

  /** item_sbar — the item panel's scrollbar. */
  readonly itemSbar = new Scrollbar(ITEM_SBAR_RECT);

  /** item_bottom_button_active, filled in as the buttons are drawn. */
  itemBottomActive: boolean[] = [false, false, false, false, false, false, true, false, true];

  /** Which PC's pack the panel is showing. */
  get itemPage(): number {
    return this.itemWindow.pcPage;
  }

  /** Which bottom button a click landed on, or null. */
  itemBottomHit(x: number, y: number): number | null {
    const panel = WIN_RECTS.inven;
    const lx = x - panel.left;
    const ly = y - panel.top;
    for (let i = 0; i < ITEM_BOTTOM_BUTTONS.length; i++) {
      const rect = ITEM_BOTTOM_BUTTONS[i]!;
      if (this.itemBottomActive[i]
        && lx >= rect.left && lx < rect.right && ly >= rect.top && ly < rect.bottom)
        return i;
    }
    return null;
  }

  /** The inventory row and part a click landed on, if any. */
  inventoryHit(
    x: number, y: number, service = false,
  ): { row: number; part: 'name' | 'use' | 'give' | 'drop' | 'info' | 'spec' } | null {
    const panel = WIN_RECTS.inven;
    const lx = x - panel.left;
    const ly = y - panel.top;
    const rows = service ? ITEM_ROWS_SHOP : ITEM_ROWS;
    // `item_hit = item_sbar->getPosition() + i` (boe.actions.cpp:1811) — the row
    // clicked is an offset into the list, not the list itself. A shop service
    // never scrolls.
    const offset = service ? 0 : this.itemWindow.scroll;
    const special = !service && this.itemWindow.mode >= ItemWinMode.SPECIAL;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const inside = (rect: UiRect): boolean =>
        lx >= rect.left && lx < rect.right && ly >= rect.top && ly < rect.bottom;
      if (service) {
        if (inside(row.spec)) return { row: i, part: 'spec' };
      } else if (special) {
        // Only the two buttons these pages draw are live, and Use sits in the
        // Drop slot — so a click there is a Use, not a Drop.
        if (inside(row.drop)) return { row: i + offset, part: 'use' };
        if (inside(row.info)) return { row: i + offset, part: 'info' };
      } else {
        if (inside(row.use)) return { row: i + offset, part: 'use' };
        if (inside(row.give)) return { row: i + offset, part: 'give' };
        if (inside(row.drop)) return { row: i + offset, part: 'drop' };
        if (inside(row.info)) return { row: i + offset, part: 'info' };
      }
      if (inside(row.name) || inside(row.icon)) return { row: i + offset, part: 'name' };
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
    // Lines ride the animation timeline like the sounds and the hit sprites do:
    // "Guard takes 3" belongs to the moment the flame lands, not the moment it
    // was cast. Everything the game has said is in `transcript`; this is the
    // part whose moment has come.
    const said = session.univ.visibleTranscript(performance.now());
    for (let i = said.length - 1; i >= 0 && visible.length < maxLines; i--) {
      const message = said[i]!;
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
