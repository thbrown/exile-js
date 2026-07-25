/**
 * Runtime state for the town the party is currently in — the M2 slice of
 * cCurTown (universe/universe.hpp). Fields (webs, barriers, quickfire),
 * dropped items, and the population save-slot rotation land later.
 */

import { Location } from '../core/location';
import { Item } from '../data/item';
import { Town } from '../data/town';
import { Creature } from './creature';

export class CurTown {
  monsters: Creature[] = [];
  items: Item[] = [];
  /** Explored flags for the current town, [x][y]. */
  explored: Uint8Array[];

  constructor(readonly record: Town) {
    this.explored = Array.from({ length: record.maxDim }, () => new Uint8Array(record.maxDim));
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
