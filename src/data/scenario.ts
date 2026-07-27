/**
 * Scenario data — the subset of cScenario (scenario.hpp) needed so far.
 * Grows as milestones land: items/monsters/towns arrive with M1-M2,
 * quests/shops with M3+.
 */

import { Item } from './item';
import { Monster } from './monster';
import { Sector } from './outdoors';
import { Quest, SpecItem } from './quest';
import { Shop } from './shop';
import { SpecialNode } from './special';
import { Speech } from './talking';
import { Terrain } from './terrain';
import { Timer, Town } from './town';

export interface Scenario {
  title: string;
  teasers: string[];
  introMsgs: string[];
  numTowns: number;
  outWidth: number;
  outHeight: number;
  startTown: number;
  /** 0-3, one lower than the 1-4 the file carries (fileio_scen.cpp:846). */
  difficulty: number;
  /** Whether monster health scales with the party's total level. */
  adjustDiff: boolean;
  townStart: { x: number; y: number };
  outdoorStart: { x: number; y: number };
  sectorStart: { x: number; y: number };
  terTypes: Terrain[];
  scenItems: Item[];
  scenMonsters: Monster[];
  towns: Town[];
  townTalk: Speech[];
  /** outdoors[x][y] — sector grid, x < outWidth, y < outHeight. */
  outdoors: Sector[][];
  scenSpecials: Map<number, SpecialNode>;
  shops: Shop[];
  /** cSpecItem definitions — the quest items, indexed by special-item number. */
  specialItems: SpecItem[];
  /** cQuest definitions; the party's own progress lives in Party.activeQuests. */
  quests: Quest[];
  /** scenario_timers — a node that fires every `time` days, scenario-wide. */
  scenarioTimers: Timer[];
  initSpec: number;
  specStrs: string[];
  storeItemRects: Map<number, { top: number; left: number; bottom: number; right: number }>;
}

/**
 * get_ter_from_ground (scenario.cpp:341) — the terrain type that represents a
 * ground type, preferring the one flagged as its archetype.
 */
export function terFromGround(scen: Scenario, ground: number): number {
  let fallback = -1;
  for (let i = 0; i < scen.terTypes.length; i++) {
    const ter = scen.terTypes[i]!;
    if (ter.groundType !== ground) continue;
    if (ter.isArchetype) return i;
    if (fallback < 0) fallback = i;
  }
  return Math.max(fallback, 0);
}

/** get_ground_from_ter (scenario.cpp:337). */
export function groundFromTer(scen: Scenario, ter: number): number {
  return terFromGround(scen, scen.terTypes[ter]!.groundType);
}
