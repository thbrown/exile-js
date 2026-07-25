/**
 * The 96x96 outdoor window the party moves around in — cCurOut
 * (universe/universe.hpp:146) plus build_outdoors / shift_universe_*
 * (boe.fileio.cpp:110-243).
 */

import { Location } from '../core/location';
import { SECTOR_SIZE, Sector } from '../data/outdoors';
import { Scenario } from '../data/scenario';
import { Party } from './party';

export const OUT_MAX_DIM = 96;
export const OUT_HALF_DIM = OUT_MAX_DIM / 2;

export class CurOut {
  /** Assembled terrain of the 2x2 sector block, indexed [x][y]. */
  terrain: Uint16Array[] = Array.from({ length: OUT_MAX_DIM }, () => new Uint16Array(OUT_MAX_DIM));
  /** Explored flags for the current window (out_e). */
  explored: Uint8Array[] = Array.from({ length: OUT_MAX_DIM }, () => new Uint8Array(OUT_MAX_DIM));

  constructor(private scen: Scenario, private party: Party) {
    this.build();
  }

  isOnMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < OUT_MAX_DIM && y < OUT_MAX_DIM;
  }

  at(x: number, y: number): number {
    return this.terrain[x]![y]!;
  }

  /** Road/special-spot flags live on the sector, indexed in sector coords. */
  isRoad(x: number, y: number): boolean {
    if (!this.isOnMap(x, y)) return false;
    return this.sectorAt({ x, y }).roads[x % SECTOR_SIZE]![y % SECTOR_SIZE]! === true;
  }

  isSpot(x: number, y: number): boolean {
    if (!this.isOnMap(x, y)) return false;
    return this.sectorAt({ x, y }).specialSpot[x % SECTOR_SIZE]![y % SECTOR_SIZE]! === true;
  }

  /** The sector record the party is currently standing in. */
  get sector(): Sector {
    const s = this.party.sector;
    return this.scen.outdoors[s.x]![s.y]!;
  }

  /** The sector record covering a window coordinate. */
  sectorAt(where: Location): Sector {
    const sx = this.party.outdoorCorner.x + (where.x >= OUT_HALF_DIM ? 1 : 0);
    const sy = this.party.outdoorCorner.y + (where.y >= OUT_HALF_DIM ? 1 : 0);
    const col = this.scen.outdoors[Math.min(sx, this.scen.outWidth - 1)]!;
    return col[Math.min(sy, this.scen.outHeight - 1)]!;
  }

  /** build_outdoors (boe.fileio.cpp:245): stitch the 2x2 block together. */
  build(): void {
    const { x, y } = this.party.outdoorCorner;
    const base = this.scen.outdoors[x]![y]!;
    const hasE = x + 1 < this.scen.outWidth;
    const hasS = y + 1 < this.scen.outHeight;
    const east = hasE ? this.scen.outdoors[x + 1]![y]! : null;
    const south = hasS ? this.scen.outdoors[x]![y + 1]! : null;
    const se = hasE && hasS ? this.scen.outdoors[x + 1]![y + 1]! : null;

    for (let i = 0; i < SECTOR_SIZE; i++)
      for (let j = 0; j < SECTOR_SIZE; j++) {
        this.terrain[i]![j] = base.terrain[i]![j]!;
        // Off-world quadrants are filled with the edge row/column rather than
        // junk, because the 9x9 view can peek past the window's edge.
        this.terrain[SECTOR_SIZE + i]![j] = east
          ? east.terrain[i]![j]!
          : base.terrain[SECTOR_SIZE - 1]![j]!;
        this.terrain[i]![SECTOR_SIZE + j] = south
          ? south.terrain[i]![j]!
          : base.terrain[i]![SECTOR_SIZE - 1]!;
        this.terrain[SECTOR_SIZE + i]![SECTOR_SIZE + j] = se
          ? se.terrain[i]![j]!
          : base.terrain[SECTOR_SIZE - 1]![SECTOR_SIZE - 1]!;
      }
  }

  private shiftExplored(dx: number, dy: number): void {
    const next = Array.from({ length: OUT_MAX_DIM }, () => new Uint8Array(OUT_MAX_DIM));
    for (let i = 0; i < OUT_MAX_DIM; i++)
      for (let j = 0; j < OUT_MAX_DIM; j++) {
        const si = i - dx * OUT_HALF_DIM;
        const sj = j - dy * OUT_HALF_DIM;
        if (si >= 0 && si < OUT_MAX_DIM && sj >= 0 && sj < OUT_MAX_DIM)
          next[i]![j] = this.explored[si]![sj]!;
      }
    this.explored = next;
  }

  /** shift_universe_left (boe.fileio.cpp:110) and its three siblings. */
  shift(dx: -1 | 0 | 1, dy: -1 | 0 | 1): void {
    this.saveMaps();
    this.party.outdoorCorner = {
      x: this.party.outdoorCorner.x + dx,
      y: this.party.outdoorCorner.y + dy,
    };
    this.party.iwc = { x: this.party.iwc.x - dx, y: this.party.iwc.y - dy };
    this.party.outLoc = {
      x: this.party.outLoc.x - dx * OUT_HALF_DIM,
      y: this.party.outLoc.y - dy * OUT_HALF_DIM,
    };
    this.shiftExplored(-dx, -dy);
    this.build();
  }

  /** save_outdoor_maps (boe.fileio.cpp:283) — fold explored flags back. */
  saveMaps(): void {
    const c = this.party.outdoorCorner;
    const put = (sec: Sector | null, ox: number, oy: number): void => {
      if (!sec) return;
      for (let i = 0; i < SECTOR_SIZE; i++)
        for (let j = 0; j < SECTOR_SIZE; j++)
          if (this.explored[i + ox]![j + oy]!) sec.maps[i]![j] = 1;
    };
    put(this.scen.outdoors[c.x]?.[c.y] ?? null, 0, 0);
    put(this.scen.outdoors[c.x + 1]?.[c.y] ?? null, SECTOR_SIZE, 0);
    put(this.scen.outdoors[c.x]?.[c.y + 1] ?? null, 0, SECTOR_SIZE);
    put(this.scen.outdoors[c.x + 1]?.[c.y + 1] ?? null, SECTOR_SIZE, SECTOR_SIZE);
  }

  /** add_outdoor_maps: pull previously explored flags into the window. */
  addMaps(): void {
    const c = this.party.outdoorCorner;
    const take = (sec: Sector | null, ox: number, oy: number): void => {
      if (!sec) return;
      for (let i = 0; i < SECTOR_SIZE; i++)
        for (let j = 0; j < SECTOR_SIZE; j++)
          if (sec.maps[i]![j]!) this.explored[i + ox]![j + oy] = 1;
    };
    take(this.scen.outdoors[c.x]?.[c.y] ?? null, 0, 0);
    take(this.scen.outdoors[c.x + 1]?.[c.y] ?? null, SECTOR_SIZE, 0);
    take(this.scen.outdoors[c.x]?.[c.y + 1] ?? null, 0, SECTOR_SIZE);
    take(this.scen.outdoors[c.x + 1]?.[c.y + 1] ?? null, SECTOR_SIZE, SECTOR_SIZE);
  }
}
