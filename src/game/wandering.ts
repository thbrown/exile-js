/**
 * Wandering monsters — `create_wand_monst` and `place_outd_wand_monst`
 * (boe.monster.cpp:45 and 98), the outdoor half of `do_monsters` (:274), and
 * `out_enc_lev_tot` / `count_walls`, which decide whether a group is worth
 * fighting and how walled-in the arena is.
 *
 * Outdoors a wandering group isn't a creature on the map at all: it's one of
 * ten `OutdoorCreature` slots on the party, each holding a whole encounter
 * (up to seven monster types and three friendly ones). It roams the 96×96
 * outdoor window, and when it reaches the party the encounter turns into a
 * fight in a generated arena — see `outCombat.ts`.
 */

import { Location, dist, loc } from '../core/location';
import { OutWandering } from '../data/outdoors';
import { TerObstruct } from '../data/terrain';
import { OutdoorCreature } from '../universe/outdoorCreature';
import { Universe } from '../universe/universe';
import { placeMonster } from './monsterPlace';
import { GameMode } from './modes';
import type { GameSession } from './session';

/** How many outdoor encounter slots the party carries (cParty::out_c). */
export const NUM_OUT_CREATURES = 10;

/** An encounter with no monsters in it at all (cWandering::isNull). */
export function wanderingIsNull(w: OutWandering): boolean {
  return w.monst.every((m) => m === 0) && w.friendly.every((m) => m === 0);
}

/** random_shift (boe.monster.cpp:757) — one step in any direction, or none. */
function randomShift(univ: Universe, start: Location): Location {
  return {
    x: start.x + univ.rng.getRan(1, 0, 2) - 1,
    y: start.y + univ.rng.getRan(1, 0, 2) - 1,
  };
}

/** set_direction — the eDirection an outdoor group ends up facing. */
function setDirection(from: Location, to: Location): number {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === -1) return 1;
  if (dx === 1 && dy === 0) return 2;
  if (dx === 1 && dy === 1) return 3;
  if (dx === 0 && dy === 1) return 4;
  if (dx === -1 && dy === 1) return 5;
  if (dx === -1 && dy === 0) return 6;
  if (dx === -1 && dy === -1) return 7;
  return 8;
}

/**
 * outdoor_move_monster (boe.monster.cpp:767) — a group steps onto a square if
 * it isn't blocked, isn't a special encounter square, and isn't where the
 * party is standing. Note the last test: a group never walks *onto* the party,
 * it only ends up next to it, which is what the adjacency check reads.
 */
export function outdoorMoveMonster(
  session: GameSession, which: number, dest: Location,
): boolean {
  const univ = session.univ;
  const group = univ.party.outC[which];
  if (!group) return false;
  if (outdBlocked(univ, dest)) return false;
  if (univ.out.isSpot(dest.x, dest.y)) return false;
  if (dest.x === univ.party.outLoc.x && dest.y === univ.party.outLoc.y) return false;
  group.direction = setDirection(group.mLoc, dest);
  group.mLoc = { ...dest };
  return true;
}

function outdBlocked(univ: Universe, where: Location): boolean {
  if (!univ.out.isOnMap(where.x, where.y)) return true;
  const ter = univ.terrainType(univ.out.at(where.x, where.y));
  return ter.blockage === TerObstruct.BLOCK_MOVE
    || ter.blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT
    || ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT;
}

/** try_move + seek_party, cut down to the outdoor case. */
function seekParty(session: GameSession, which: number, from: Location, to: Location): boolean {
  const step = (dx: number, dy: number): boolean =>
    outdoorMoveMonster(session, which, loc(from.x + dx, from.y + dy));
  if (from.x > to.x && from.y > to.y && step(-1, -1)) return true;
  if (from.x < to.x && from.y < to.y && step(1, 1)) return true;
  if (from.x > to.x && from.y < to.y && step(-1, 1)) return true;
  if (from.x < to.x && from.y > to.y && step(1, -1)) return true;
  if (from.x > to.x && step(-1, 0)) return true;
  if (from.x < to.x && step(1, 0)) return true;
  if (from.y < to.y && step(0, 1)) return true;
  if (from.y > to.y && step(0, -1)) return true;
  const m = session.univ.rng.getRan(1, 0, 2) - 1;
  const n = session.univ.rng.getRan(1, 0, 2) - 1;
  return step(m, n);
}

/**
 * The outdoor half of `do_monsters`: every live group either drifts one step
 * at random (one roll in six) or walks toward the party.
 */
export function doOutdoorMonsters(session: GameSession): void {
  const univ = session.univ;
  for (let i = 0; i < NUM_OUT_CREATURES; i++) {
    const group = univ.party.outC[i];
    if (!group?.exists) continue;
    if (univ.rng.getRan(1, 1, 6) === 3) {
      outdoorMoveMonster(session, i, randomShift(univ, group.mLoc));
    } else {
      seekParty(session, i, group.mLoc, univ.party.outLoc);
    }
  }
}

/**
 * place_outd_wand_monst (boe.monster.cpp:98) — fill the first free slot with a
 * group. `forced` lets a special reuse the last slot and shove the group onto
 * a clear square nearby.
 *
 * The `end_spec` pair is a Stuff Done Flag that switches the encounter off for
 * good once a scenario sets it, which is how a scenario stops respawning the
 * bandits after you've dealt with them.
 */
export function placeOutdWandMonst(
  session: GameSession, where: Location, group: OutWandering, forced = 0,
): void {
  const univ = session.univ;
  for (let i = 0; i < NUM_OUT_CREATURES; i++) {
    const slot = univ.party.outC[i]!;
    if (!(!slot.exists || (i === NUM_OUT_CREATURES - 1 && forced > 0))) continue;

    if (univ.party.sdLegit(group.endSpec1, group.endSpec2)
      && univ.party.getSdf(group.endSpec1, group.endSpec2) > 0) return;

    slot.exists = true;
    slot.direction = 0;
    slot.whatMonst = group;
    slot.whichSector = { ...univ.party.iwc };
    // `where` arrives sector-local; the slot keeps window coordinates.
    slot.mLoc = { x: where.x, y: where.y };
    if (slot.whichSector.x === 1) slot.mLoc.x += 48;
    if (slot.whichSector.y === 1) slot.mLoc.y += 48;

    let l = { ...slot.mLoc };
    let tries = 0;
    while (forced && outdBlocked(univ, l) && tries < 50) {
      l = {
        x: slot.mLoc.x + univ.rng.getRan(1, 0, 2) - 1,
        y: slot.mLoc.y + univ.rng.getRan(1, 0, 2) - 1,
      };
      tries++;
    }
    slot.mLoc = l;
    return;
  }
}

/**
 * create_wand_monst (boe.monster.cpp:45) — roll a new encounter into the
 * world. Outdoors that means a group in one of the party's ten slots; in town
 * it means real creatures placed near one of the town's wandering points.
 *
 * The town branch keeps two bugs the C++ flags and preserves for replays: it
 * tries to place the fourth monster type as an "extra" on every one of the
 * four passes rather than once, and it will place monster type 0 (a nameless
 * default) when that slot is empty. Both are behind feature flags there that
 * default to *unfixed*, so this port keeps them.
 */
export function createWandMonst(session: GameSession): void {
  const univ = session.univ;

  if (session.mode === GameMode.OUTDOORS) {
    const sector = univ.out.sectorAt(univ.party.outLoc);
    const groups = sector.wandering;
    const r1 = univ.rng.getRan(1, 0, groups.length - 1);
    const group = groups[r1];
    if (!group || wanderingIsNull(group)) return;
    const spots = sector.wanderingLocs;
    if (spots.length === 0) return;
    let r2 = univ.rng.getRan(1, 0, spots.length - 1);
    let tries = 0;
    // Don't drop a group in plain view; keep rolling until it's off screen.
    while (pointOnScreen(spots[r2]!, univ.party.globalToLocal(univ.party.outLoc))
      && tries++ < 100) {
      r2 = univ.rng.getRan(1, 0, 3);
    }
    const spot = spots[r2];
    if (!spot || spot.x < 0) return;
    if (!outdBlocked(univ, univ.party.localToGlobal(spot))) {
      placeOutdWandMonst(session, spot, group, 0);
    }
    return;
  }

  const town = univ.town;
  const record = univ.townRecord;
  if (!town || !record) return;
  const groups = record.wandering;
  const r1 = univ.rng.getRan(1, 0, groups.length - 1);
  const group = groups[r1];
  if (!group || group.every((m) => m === 0)) return;
  if (town.monsters.filter((c) => c.isAlive).length > 50) return;
  if (record.maxNumMonst <= town.monstersKilled) return;

  const spots = record.wanderingLocs;
  let r2 = univ.rng.getRan(1, 0, groups.length - 1);
  let tries = 0;
  while (spots[r2] && pointOnScreen(spots[r2]!, univ.party.townLoc)
    && !session.locOffActiveArea(spots[r2]!) && tries++ < 100) {
    r2 = univ.rng.getRan(1, 0, 3);
  }
  const base = spots[r2];
  if (!base || base.x < 0) return;

  const tryPlaceExtra = (): void => {
    const p = {
      x: base.x + univ.rng.getRan(1, 0, 4) - 2,
      y: base.y + univ.rng.getRan(1, 0, 4) - 2,
    };
    const r3 = univ.rng.getRan(1, 0, 3);
    // "Buggy behavior of this code, preserved so old replays will run
    // correctly, would spawn nameless monsters of type 0 with default stats."
    if (r3 >= 2 && !session.isBlocked(p)) placeMonster(session, group[3] ?? 0, p);
  };

  for (let i = 0; i < 4; i++) {
    const which = group[i] ?? 0;
    if (which !== 0) {
      const p = {
        x: base.x + univ.rng.getRan(1, 0, 4) - 2,
        y: base.y + univ.rng.getRan(1, 0, 4) - 2,
      };
      if (!session.isBlocked(p)) placeMonster(session, which, p);
    }
    // "…would create more than 1-2 of the last monster type, contradicting
    // the documentation." Kept, because the fix is off by default.
    tryPlaceExtra();
  }
}

/** point_onscreen — inside the 9×9 the party can see. */
function pointOnScreen(where: Location, centre: Location): boolean {
  return Math.abs(where.x - centre.x) <= 4 && Math.abs(where.y - centre.y) <= 4;
}

/**
 * out_enc_lev_tot (boe.monster.cpp:32) — how dangerous a group is, weighted by
 * how many of each type the arena will spawn. A group that can't flee is
 * simply 10000, so the party never scares it off.
 */
export function outEncLevTot(univ: Universe, group: OutWandering): number {
  if (group.cantFlee) return 10000;
  const num = [22, 8, 4, 4, 3, 2, 1];
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const which = group.monst[i] ?? 0;
    if (which !== 0) {
      count += (univ.scenario.scenMonsters[which]?.level ?? 0) * (num[i] ?? 0);
    }
  }
  return count;
}

/**
 * count_walls (boe.actions.cpp:4291) — how many of the four neighbouring
 * outdoor squares are wall terrain. The arena builder turns that into walls of
 * its own, so a fight in a canyon is fought in a walled arena.
 */
export function countWalls(univ: Universe, where: Location): number {
  let answer = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const ter = univ.out.at(where.x + dx, where.y + dy);
    if (ter >= 5 && ter <= 35) answer++;
  }
  return answer;
}

/**
 * The outdoor slot standing next to the party, if there is one — the trigger
 * `handle_action` checks every tenth turn. A `forced` group counts wherever it
 * is standing.
 */
export function adjacentEncounter(univ: Universe): number {
  for (let i = 0; i < NUM_OUT_CREATURES; i++) {
    const group = univ.party.outC[i];
    if (!group?.exists) continue;
    if (dist(univ.party.outLoc, group.mLoc) <= 1 || group.whatMonst.forced) return i;
  }
  return -1;
}

export type { OutdoorCreature };
