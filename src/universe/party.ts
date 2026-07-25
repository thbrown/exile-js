/**
 * The party: shared resources, world position, and the Stuff Done Flags.
 * Port of the M2-relevant parts of cParty (universe/party.cpp:25).
 *
 * Outdoor position model, kept faithful because specials and save files
 * depend on it: the engine keeps a 96x96 window (`CurOut`) assembled from a
 * 2x2 block of 48x48 sectors whose top-left is `outdoorCorner`. `outLoc` is
 * the party position *within that window* (0..95), `iwc` says which of the
 * four sectors the party is currently standing in, and `locInSec` is the
 * position within that sector (0..47).
 */

import { Direction, Location, loc } from '../core/location';

export const SDF_ROWS = 350;
export const SDF_COLUMNS = 50;
export const MAX_GOLD = 30000;
export const MAX_FOOD = 25000;

/** Sentinel town number meaning "not in a town" (i.e. outdoors). */
export const TOWN_NUM_OUTDOORS = 200;

export class Party {
  gold = 200;
  food = 100;
  /** Ticks since the game started; a day is 3700 (cParty::calc_day). */
  age = 0;
  direction: Direction = Direction.N;

  outdoorCorner: Location = loc(7, 8);
  iwc: Location = loc(1, 1);
  locInSec: Location = loc(36, 36);
  outLoc: Location = loc(84, 84);
  townLoc: Location = loc(0, 0);
  townNum = TOWN_NUM_OUTDOORS;

  inBoat = -1;
  inHorse = -1;
  /** Accumulated light from spells/items; drives light_radius in dark towns. */
  lightLevel = 0;
  /** Special items the party has acquired, by index (cParty::spec_items). */
  specItems = new Set<number>();
  /** Alchemy recipes the party knows (cParty::alchemy). */
  alchemy: boolean[] = new Array<boolean>(20).fill(false);
  /**
   * Rolled stock for random shops: magicStoreItems[shop][slot]. Random shops
   * re-roll only when refresh_store_items runs, so the same wares are on the
   * shelf until then (cParty::magic_store_items).
   */
  magicStoreItems = new Map<number, Map<number, import('../data/item').Item>>();
  /** How much of a limited-stock entry is left: storeLimitedStock[shop][slot]. */
  storeLimitedStock = new Map<number, Map<number, number>>();

  /** Stuff Done Flags — the scenario-visible persistent state array. */
  stuffDone: Uint8Array[] = Array.from({ length: SDF_ROWS }, () => new Uint8Array(SDF_COLUMNS));

  pcs: import('./player').Player[] = [];

  calcDay(): number {
    return Math.floor(this.age / 3700) + 1;
  }

  wipeSdfs(): void {
    for (const row of this.stuffDone) row.fill(0);
  }

  sdLegit(row: number, col: number): boolean {
    return row >= 0 && row < SDF_ROWS && col >= 0 && col < SDF_COLUMNS;
  }

  getSdf(row: number, col: number): number {
    return this.sdLegit(row, col) ? this.stuffDone[row]![col]! : 0;
  }

  setSdf(row: number, col: number, value: number): void {
    if (this.sdLegit(row, col)) this.stuffDone[row]![col] = value & 0xff;
  }

  /** The sector the party is standing in, in scenario coordinates. */
  get sector(): Location {
    return loc(this.outdoorCorner.x + this.iwc.x, this.outdoorCorner.y + this.iwc.y);
  }

  /** global_to_local (boe.locutils.cpp:115) — window coords to sector coords. */
  globalToLocal(global: Location): Location {
    return loc(global.x >= 48 ? global.x - 48 : global.x, global.y >= 48 ? global.y - 48 : global.y);
  }

  /** local_to_global (boe.locutils.cpp:126) — sector coords to window coords. */
  localToGlobal(local: Location): Location {
    return loc(local.x + (this.iwc.x === 1 ? 48 : 0), local.y + (this.iwc.y === 1 ? 48 : 0));
  }
}
