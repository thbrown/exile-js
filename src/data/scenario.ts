/**
 * Scenario data — the subset of cScenario (scenario.hpp) needed so far.
 * Grows as milestones land: items/monsters/towns arrive with M1-M2,
 * quests/shops with M3+.
 */

import { Sector } from './outdoors';
import { SpecialNode } from './special';
import { Terrain } from './terrain';

export interface Scenario {
  title: string;
  teasers: string[];
  introMsgs: string[];
  numTowns: number;
  outWidth: number;
  outHeight: number;
  startTown: number;
  townStart: { x: number; y: number };
  outdoorStart: { x: number; y: number };
  sectorStart: { x: number; y: number };
  terTypes: Terrain[];
  /** outdoors[x][y] — sector grid, x < outWidth, y < outHeight. */
  outdoors: Sector[][];
  scenSpecials: Map<number, SpecialNode>;
}
