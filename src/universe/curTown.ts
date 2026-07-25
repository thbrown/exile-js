/**
 * Runtime state for the town the party is currently in — the M2 slice of
 * cCurTown (universe/universe.hpp). Fields (webs, barriers, quickfire),
 * dropped items, and the population save-slot rotation land later.
 */

import { Location } from '../core/location';
import { FieldType } from '../data/fields';
import { Item } from '../data/item';
import { Town } from '../data/town';
import { Creature } from './creature';

export class CurTown {
  monsters: Creature[] = [];
  items: Item[] = [];
  /** Explored flags for the current town, [x][y]. */
  explored: Uint8Array[];
  /** Permanently lit tiles (braziers, bonfires…), cTown::lighting. */
  lighting: Uint8Array[];
  /** Road and special-spot overlays, from the town's preset fields. */
  roads: Uint8Array[];
  specialSpots: Uint8Array[];

  constructor(readonly record: Town) {
    const grid = (): Uint8Array[] =>
      Array.from({ length: record.maxDim }, () => new Uint8Array(record.maxDim));
    this.explored = grid();
    this.lighting = grid();
    this.roads = grid();
    this.specialSpots = grid();
    for (const field of record.presetFields) {
      const { x, y } = field.loc;
      if (!this.isOnMap(x, y)) continue;
      if (field.type === FieldType.SPECIAL_ROAD) this.roads[x]![y] = 1;
      else if (field.type === FieldType.SPECIAL_SPOT) this.specialSpots[x]![y] = 1;
    }
  }

  isLit(x: number, y: number): boolean {
    return this.isOnMap(x, y) && this.lighting[x]![y]! !== 0;
  }

  isRoad(x: number, y: number): boolean {
    return this.isOnMap(x, y) && this.roads[x]![y]! !== 0;
  }

  isOnMap(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.record.maxDim && y < this.record.maxDim;
  }

  isExplored(x: number, y: number): boolean {
    return this.isOnMap(x, y) && this.explored[x]![y]! !== 0;
  }

  makeExplored(x: number, y: number): void {
    if (this.isOnMap(x, y)) this.explored[x]![y] = 1;
  }

  /**
   * cCurTown::is_special (universe.cpp:301) — note this scans the town's
   * special_locs list, *not* the SPECIAL_SPOT field flag. The flag only
   * controls the white marker the map draws; the list is what actually runs.
   */
  isSpecialSpot(x: number, y: number): boolean {
    if (!this.isOnMap(x, y)) return false;
    return this.record.specialLocs.some((l) => l.x === x && l.y === y && l.spec >= 0);
  }

  /** take_explored — put the fog back over a square. */
  takeExplored(x: number, y: number): void {
    if (this.isOnMap(x, y)) this.explored[x]![y] = 0;
  }

  /** A live, alive monster occupying a space (accounting for multi-tile size). */
  monsterAt(where: Location): Creature | null {
    for (const m of this.monsters) {
      if (!m.isAlive) continue;
      if (
        where.x >= m.curLoc.x &&
        where.x < m.curLoc.x + m.xWidth &&
        where.y >= m.curLoc.y &&
        where.y < m.curLoc.y + m.yWidth
      )
        return m;
    }
    return null;
  }
}
