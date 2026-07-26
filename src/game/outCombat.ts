/**
 * Outdoor combat — `create_out_combat_terrain` (boe.town.cpp:820) and
 * `start_outdoor_combat` (boe.combat.cpp:88).
 *
 * An outdoor fight doesn't happen on the outdoor map: the engine builds a
 * throwaway 48×48 "town" — the arena — out of the terrain the party was
 * standing on, drops both sides into it, and runs ordinary combat. Leaving it
 * puts everyone back outdoors where they were.
 */

import { Location, loc } from '../core/location';
import { Attitude } from '../data/monster';
import { OutWandering } from '../data/outdoors';
import { Town } from '../data/town';
import { TerObstruct } from '../data/terrain';
import { CurTown } from '../universe/curTown';
import { Creature, CreatureStatus, assignCreature } from '../universe/creature';
import { defaultTownperson } from '../data/town';
import { Status } from '../universe/skills';
import { Universe } from '../universe/universe';
import { GameMode } from './modes';
import { NO_ONE, pickNextPc, setPcMoves } from './combat';
import type { GameSession } from './session';

/** The 48×48 arena's dimension (AREA_MEDIUM). */
export const ARENA_DIM = 48;

/** Where the party lands in the arena (out_start_loc). */
const OUT_START_LOC = loc(20, 27);

/** hor_vert_place — the six PC offsets from that square. */
const HOR_VERT_PLACE: Location[] = [
  loc(0, 0), loc(1, 0), loc(0, 1), loc(1, 1), loc(0, 2), loc(1, 2),
];

/** `ter_base` — the ground each arena kind is floored with. */
const TER_BASE = [
  2, 0, 36, 50, 71, 0, 0, 0, 0, 2,
  2, 2, 2, 0, 0, 36, 0, 2, 0, 2,
];

/** Where a lake, a pillar cluster or a camp can be dropped. */
const SPECIAL_TER_LOCS: Location[] = [
  loc(11, 10), loc(11, 14), loc(10, 20), loc(11, 26), loc(9, 30),
  loc(15, 19), loc(23, 19), loc(19, 29), loc(20, 11), loc(28, 16),
  loc(28, 24), loc(27, 19), loc(27, 29), loc(15, 28), loc(19, 19),
];

const CAVE_PILLAR = [
  [0, 14, 11, 1], [14, 19, 20, 11], [17, 18, 21, 8], [1, 17, 8, 0],
];
const MNTN_PILLAR = [
  [37, 29, 27, 36], [29, 33, 34, 27], [31, 32, 35, 25], [36, 31, 25, 37],
];
const SURF_LAKE = [
  [56, 55, 54, 3], [57, 50, 61, 54], [58, 51, 59, 53], [3, 4, 58, 52],
];
const CAVE_LAKE = [
  [93, 96, 71, 71], [96, 71, 71, 71], [71, 71, 71, 96], [71, 71, 71, 96],
];
const SURF_FUME = [
  [75, 75, 75, 36], [75, 75, 75, 75], [75, 75, 75, 75], [36, 37, 75, 75],
];
const CAVE_FUME = [
  [98, 0, 75, 75], [0, 75, 75, 75], [75, 75, 75, 0], [75, 75, 75, 0],
];
const SURF_CAMP = [
  [105, 2, 4, 2], [2, 104, 2, 105], [115, 2, 4, 2], [2, 105, 2, 115],
];
const CAVE_CAMP = [
  [105, 0, 1, 0], [0, 104, 0, 105], [92, 0, 93, 0], [0, 105, 0, 92],
];

/** terrain, odds-in-a-thousand, … five pairs per arena kind. */
const TERRAIN_ODDS: number[][] = [
  [3, 80, 4, 40, 115, 20, 114, 10, 112, 1], // Grassy field
  [1, 50, 93, 25, 94, 5, 98, 10, 95, 1], // Ordinary cave
  [37, 20], // Mountain
  [64, 3, 63, 1], // Surface bridge
  [74, 1], // Cave bridge
  [84, 700, 97, 30, 98, 20, 92, 4, 95, 1], // Rubble-strewn cave
  [93, 280, 91, 300, 92, 270, 95, 7, 98, 10], // Cave forest
  [1, 800, 93, 600, 94, 10, 92, 10, 95, 4], // Cave mushrooms
  [1, 700, 96, 200, 95, 100, 92, 10, 112, 5], // Cave swamp
  [3, 600, 87, 90, 110, 20, 114, 6, 113, 2], // Surface rocks
  [3, 200, 4, 400, 111, 250], // Surface swamp
  [3, 200, 4, 300, 112, 50, 113, 60, 114, 100], // Surface woods
  [3, 100, 4, 250, 115, 120, 114, 30, 112, 2], // Surface shrubbery
  [1, 25, 76, 15, 98, 300, 97, 280, 75, 5], // Stalagmites
  [1, 150, 94, 80, 98, 20, 76, 20, 75, 5], // Cave fumarole
  [37, 150, 76, 20, 75, 5], // Surface fumarole
  [1, 50, 93, 25, 94, 5, 98, 10, 95, 1], // Cave camp
  [3, 80, 4, 40, 115, 20, 114, 10, 112, 1], // Surface camp
  [1, 600, 97, 50, 98, 80, 93, 10, 84, 10], // Cave crops
  [3, 500, 4, 500, 110, 50, 87, 10], // Surface crops
];

/** The arena kinds a road can run through. */
const CAVE_ARENAS = new Set([1, 5, 6, 7, 8, 13]);
const SURFACE_ARENAS = new Set([0, 2, 9, 10, 11, 12]);

/**
 * create_out_combat_terrain — build the arena the fight happens in.
 *
 * A terrain type whose `combat_arena` is 1000 or more names a *town* to take
 * the terrain from instead: only the terrain, no creatures, items or specials,
 * and a large town has its outer ring dropped.
 */
export function createOutCombatTerrain(
  univ: Universe, arenaTown: Town, terType: number, numWalls: number, isRoad: boolean,
): void {
  const ter = arenaTown.terrain;
  let arena = univ.terrainType(terType).combatArena;

  if (arena >= 1000) {
    arena -= 1000;
    const source = univ.scenario.towns[arena];
    if (!source) return;
    const offset = Math.max(0, source.maxDim - ARENA_DIM);
    const clamp = (v: number): number => Math.max(0, Math.min(source.maxDim - 1, v));
    const b = {
      left: clamp(source.inTownRect.left),
      right: clamp(source.inTownRect.right),
      top: clamp(source.inTownRect.top),
      bottom: clamp(source.inTownRect.bottom),
    };
    for (let i = 0; i < ARENA_DIM; i++) {
      for (let j = 0; j < ARENA_DIM; j++) {
        const x = i + offset;
        const y = j + offset;
        const inside = x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
        ter[i]![j] = inside ? source.terrain[x]![y]! : 90;
      }
    }
    // "The game uses the upper left corner to replace spaces that are blocked,
    // so it needs to be set to something sensible."
    const fetch = source.startLocs[0] ?? { x: 0, y: 0 };
    ter[0]![0] = source.terrain[fetch.x]?.[fetch.y] ?? 0;
    return;
  }

  const base = TER_BASE[arena] ?? 0;
  for (let i = 0; i < ARENA_DIM; i++) {
    for (let j = 0; j < ARENA_DIM; j++) {
      ter[i]![j] = (j <= 8 || j >= 35 || i <= 8 || i >= 35) ? 90 : base;
    }
  }
  const odds = TERRAIN_ODDS[arena] ?? [];
  for (let i = 0; i < ARENA_DIM; i++) {
    for (let j = 0; j < ARENA_DIM; j++) {
      for (let k = 0; k < 5; k++) {
        if (ter[i]![j] !== 90 && univ.rng.getRan(1, 1, 1000) < (odds[k * 2 + 1] ?? 0)) {
          ter[i]![j] = odds[k * 2] ?? ter[i]![j]!;
        }
      }
    }
  }
  ter[0]![0] = base;

  const isBridge = arena === 3 || arena === 4;
  const paint = (which: number): void => {
    ter[0]![0] = which;
    for (let i = isBridge ? 15 : 19; i < (isBridge ? 26 : 23); i++) {
      for (let j = 9; j < 35; j++) ter[i]![j] = which;
    }
  };
  if (arena === 3 || (isRoad && SURFACE_ARENAS.has(arena))) paint(83);
  if (arena === 4 || (isRoad && CAVE_ARENAS.has(arena))) paint(82);

  // Crops: four planted strips of the *outdoor* terrain type itself.
  if (arena === 18 || arena === 19) {
    for (const start of [12, 17, 22, 27]) {
      for (let i = start; i < start + 3; i++) {
        for (let j = 9; j < 35; j++) {
          if (j !== 17 && j !== 26) ter[i]![j] = terType;
        }
      }
    }
  }
  if (arena === 14 || arena === 15) ter[0]![0] = 75;

  // Lakes, pillars and camps. Note the tests are on the *corner* terrain, so
  // the road painting above can switch which of them can happen.
  const stamp = (pattern: number[][], at: Location): void => {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) ter[at.x + j]![at.y + k] = pattern[k]![j]!;
    }
  };
  const scatter = (oneIn: number, pattern: number[][]): void => {
    for (let i = 0; i < 15; i++) {
      if (univ.rng.getRan(1, 0, oneIn) === 1) stamp(pattern, SPECIAL_TER_LOCS[i]!);
    }
  };
  if (arena === 2 || arena === 15) scatter(5, MNTN_PILLAR);
  if (ter[0]![0] === 0) scatter(25, CAVE_PILLAR);
  if (ter[0]![0] === 0) scatter(40, CAVE_LAKE);
  if (ter[0]![0] === 2) scatter(40, SURF_LAKE);
  if (arena === 14) scatter(5, CAVE_FUME);
  if (arena === 15) scatter(5, SURF_FUME);
  if (arena === 16) stamp(CAVE_CAMP, loc(18, 14));
  if (arena === 17) stamp(SURF_CAMP, loc(18, 14));

  // A cave arena in walled country grows walls of its own.
  if ((TER_BASE[terType] ?? -1) === 0) {
    for (let i = 0; i < numWalls; i++) {
      const r1 = univ.rng.getRan(1, 0, 3);
      for (let j = 9; j < 35; j++) {
        if (r1 === 0) ter[j]![8] = 6;
        else if (r1 === 1) ter[8]![j] = 9;
        else if (r1 === 2) ter[j]![35] = 6;
        else ter[35]![j] = 9;
      }
    }
  }
}

/** set_up_monst (boe.monster.cpp:182) — append one combatant to the arena. */
function setUpMonst(univ: Universe, town: CurTown, attitude: Attitude, mNum: number): void {
  const template = mNum >= 10000
    ? univ.party.summons[mNum - 10000]
    : univ.scenario.scenMonsters[mNum];
  if (!template) return;
  const preset = defaultTownperson();
  preset.number = mNum;
  const c: Creature = assignCreature(
    town.monsters.length, preset, template, univ.party.easyMode, univ.difficultyAdjust());
  c.active = CreatureStatus.ALERTED;
  c.summonTime = 0;
  c.attitude = attitude;
  c.mobile = true;
  town.monsters.push(c);
}

/**
 * start_outdoor_combat (boe.combat.cpp:88) — turn a wandering group into a
 * fight. How many of each type appear is fixed by the `low`/`high` tables, not
 * by the group: the first slot brings 15-30 of its kind, the last exactly one.
 */
export function startOutdoorCombat(
  session: GameSession, encounter: OutWandering, where: Location, numWalls: number,
): void {
  const univ = session.univ;
  const low = [15, 7, 4, 3, 2, 1, 1, 7, 2, 1];
  const high = [30, 10, 6, 5, 3, 2, 1, 10, 4, 1];
  const nums: number[] = [];
  // Two loops in the C++, and the split matters: all ten rolls happen, in this
  // order, before anything is placed.
  for (let i = 0; i < 7; i++) nums[i] = univ.rng.getRan(1, low[i]!, high[i]!);
  for (let i = 0; i < 3; i++) nums[i + 7] = univ.rng.getRan(1, low[i + 7]!, high[i + 7]!);

  univ.addStringToBuf('You have been attacked!');
  session.sound?.play(23);

  session.whichCombatType = 0;
  session.mode = GameMode.COMBAT;

  // The arena is a throwaway 48×48 town the party is not "in": town_num stays
  // at 200, and `cCurTown::record` hands back the arena instead.
  const arenaTown = new Town(ARENA_DIM);
  arenaTown.name = 'Combat';
  arenaTown.inTownRect = { top: 0, left: 0, bottom: 47, right: 47 };
  const terType = univ.out.at(where.x, where.y);
  createOutCombatTerrain(
    univ, arenaTown, terType, numWalls, univ.out.isRoad(where.x, where.y));
  const town = new CurTown(arenaTown);
  univ.town = town;
  session.arena = arenaTown;

  for (let i = 0; i < 7; i++) {
    const which = encounter.monst[i] ?? 0;
    if (which !== 0) {
      for (let j = 0; j < nums[i]!; j++) setUpMonst(univ, town, Attitude.HOSTILE_A, which);
    }
  }
  for (let i = 0; i < 3; i++) {
    const which = encounter.friendly[i] ?? 0;
    if (which !== 0) {
      for (let j = 0; j < nums[i + 7]!; j++) setUpMonst(univ, town, Attitude.FRIENDLY, which);
    }
  }

  // Place the party, carving a hole in anything that blocks the square.
  univ.party.pcs.forEach((pc, i) => {
    const offset = HOR_VERT_PLACE[i] ?? loc(0, 0);
    pc.combatPos = loc(OUT_START_LOC.x + offset.x, OUT_START_LOC.y + offset.y);
    if (blockage(univ, arenaTown, pc.combatPos) > 0) {
      arenaTown.terrain[pc.combatPos.x]![pc.combatPos.y] = arenaTown.terrain[0]![0]!;
    }
    session.updateExplored(pc.combatPos);
    // A fight out here starts clean: the buffs and the poisoned blade go.
    for (const which of [
      Status.POISONED_WEAPON, Status.BLESS_CURSE, Status.HASTE_SLOW,
      Status.INVULNERABLE, Status.MAGIC_RESISTANCE,
    ]) pc.status[which] = 0;
    pc.parry = 0;
  });

  // Monsters land in a band across the middle; friendly ones behind the party,
  // spellcasters a few squares further back.
  for (const monst of town.monsters) {
    if (!monst.isAlive) continue;
    monst.target = NO_ONE;
    const roll = (): Location => {
      const l = loc(univ.rng.getRan(1, 15, 25), univ.rng.getRan(1, 14, 18));
      if (monst.attitude === Attitude.FRIENDLY) l.y += 9;
      else if (monst.mon.mu > 0 || monst.mon.cl > 0) l.y -= 4;
      return l;
    };
    monst.curLoc = roll();
    let tries = 0;
    while (tries++ < 50) {
      const blocked = !session.monstCanBeAt(monst, monst.curLoc)
        || arenaTown.terrain[monst.curLoc.x]![monst.curLoc.y] === 180
        || univ.party.pcs.some((pc) => pc.isAlive
          && pc.combatPos.x === monst.curLoc.x && pc.combatPos.y === monst.curLoc.y);
      if (!blocked) break;
      monst.curLoc = roll();
    }
    if (blockage(univ, arenaTown, monst.curLoc) > 0) {
      arenaTown.terrain[monst.curLoc.x]![monst.curLoc.y] = arenaTown.terrain[0]![0]!;
    }
  }

  session.combatActivePc = NO_ONE;
  session.storeCurrentPc = univ.curPc;
  univ.curPc = 0;
  setPcMoves(univ);
  pickNextPc(univ, session.combatActivePc);
  session.center = { ...univ.currentPc.combatPos };
}

function blockage(univ: Universe, town: Town, where: Location): number {
  const ter = univ.terrainType(town.terrain[where.x]?.[where.y] ?? 0);
  return ter.blockage === TerObstruct.CLEAR ? 0 : 1;
}
