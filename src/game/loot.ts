/**
 * What a corpse leaves behind — `place_item`, `place_glands` and
 * `place_treasure` (boe.items.cpp:168, 698 and 725).
 *
 * `place_treasure`'s tables are copied verbatim, and so is its **get_ran call
 * order**: the gold roll, then five passes over the treasure chart, each of
 * which rolls the odds, a minimum, a maximum, the one-in-a-thousand jackpot,
 * the "reality check" trims, up to three `return_treasure` draws, the
 * magic/cursed rejections and finally one identify roll per living PC. Every
 * one of those draws happens even where the result is thrown away.
 */

import { Item, ItemType, defaultItem } from '../data/item';
import { Monster } from '../data/monster';
import { returnTreasure } from '../data/treasure';
import { Location } from '../core/location';
import { Skill } from '../universe/skills';
import { Universe } from '../universe/universe';

/**
 * place_item — drop `item` on the floor at `where`, reusing the first empty
 * slot in the town's item list the way the C++ does.
 *
 * TODO(M6): the `contained` argument (dropping into a barrel or a crate) needs
 * `is_container`, which arrives with the pushable-container work.
 */
export function placeItem(univ: Universe, item: Item, where: Location): boolean {
  const town = univ.town;
  if (!town) return false;
  const placed: Item = { ...item, itemLoc: { ...where }, contained: false, held: false };
  for (let i = 0; i < town.items.length; i++) {
    if (town.items[i]!.variety === ItemType.NO_ITEM) {
      town.items[i] = placed;
      resetItemMax(univ);
      return true;
    }
  }
  town.items.push(placed);
  resetItemMax(univ);
  return true;
}

/** reset_item_max — trim empty slots off the end of the list. */
export function resetItemMax(univ: Universe): void {
  const town = univ.town;
  if (!town) return;
  while (town.items.length > 0
    && town.items[town.items.length - 1]!.variety === ItemType.NO_ITEM) {
    town.items.pop();
  }
}

/** item_val — a stack of charges is worth its value per charge. */
export function itemVal(item: Item): number {
  if (item.charges === 0) return item.value;
  return item.charges * item.value;
}

/**
 * place_glands — the body part some monsters leave (a gland, a hide, an eye).
 * The C++ looks the definition up by monster number so it can reach
 * `party.summons`; a Creature here already owns its copy, so the caller passes
 * it straight in.
 */
export function placeGlands(univ: Universe, where: Location, mon: Monster): void {
  if (mon.corpseItem < 0 || mon.corpseItem >= 400) return;
  if (univ.rng.getRan(1, 1, 100) >= mon.corpseItemChance) return;
  const stored = univ.scenario.scenItems[mon.corpseItem];
  if (!stored) return;
  placeItem(univ, { ...stored }, where);
}

/** treas_chart: which treasure class each of the five passes draws from. */
const TREAS_CHART: number[][] = [
  [0, -1, -1, -1, -1, -1],
  [1, -1, -1, -1, -1, -1],
  [2, 1, 1, -1, -1, -1],
  [3, 2, 1, 1, -1, -1],
  [4, 3, 2, 2, 1, 1],
];
/** treas_odds: the percentage chance each pass produces anything. */
const TREAS_ODDS: number[][] = [
  [10, 0, 0, 0, 0, 0],
  [50, 0, 0, 0, 0, 0],
  [60, 50, 40, 0, 0, 0],
  [100, 90, 80, 70, 0, 0],
  [100, 80, 80, 75, 75, 75],
];
/** id_odds: chance an item comes up identified, by the PC's Item Lore. */
const ID_ODDS = [
  0, 10, 15, 20, 25, 30, 35,
  39, 43, 47, 51, 55, 59, 63,
  67, 71, 73, 75, 77, 79, 81,
];
const MAX_MULT: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [0, 0, 1, 1, 1, 1, 2, 3, 5, 20],
  [0, 0, 1, 1, 2, 2, 4, 6, 10, 25],
  [5, 10, 10, 10, 15, 20, 40, 80, 100, 100],
  [25, 25, 50, 50, 50, 100, 100, 100, 100, 100],
];
const MIN_CHART: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 20],
  [0, 0, 0, 0, 1, 1, 5, 10, 15, 40],
  [10, 10, 15, 20, 20, 30, 40, 50, 75, 100],
  [50, 100, 100, 100, 100, 200, 200, 200, 200, 200],
];

/** cParty::get_level — the summed levels of everyone still standing. */
function partyLevel(univ: Universe): number {
  let total = 0;
  for (const pc of univ.party.pcs) if (pc.isAlive) total += pc.level;
  return total;
}

/** check_party_stat(which, 0) — the sum of a skill over the living party. */
function partyStatSum(univ: Universe, which: Skill): number {
  let total = 0;
  for (const pc of univ.party.pcs) if (pc.isAlive) total += pc.skill(which);
  return total;
}

/**
 * place_treasure. `level` is (usually) half the monster's level, `loot` its
 * treasure class 0-4, and `mode` 1 forces a drop where 0 lets the rolls refuse.
 */
export function placeTreasure(
  univ: Universe,
  where: Location,
  level: number,
  loot: number,
  mode: number,
): void {
  if (loot < 0 || loot > 4) return;
  const rng = univ.rng;
  const luck = partyStatSum(univ, Skill.LUCK);

  // Gold. The two party-level bumps are cumulative, so a low-level party gets
  // three extra coins on any pile worth more than two.
  let amt = loot === 1
    ? rng.getRan(2, 1, 7) + 1
    : loot * (rng.getRan(1, 0, 10 + loot * 6 + level * 2) + 5);
  const pLevel = partyLevel(univ);
  if (pLevel <= 12) amt += 1;
  if (pLevel <= 60 && amt > 2) amt += 2;

  if (amt > 3) {
    const gold = { ...(univ.scenario.scenItems[0] ?? defaultItem()) };
    gold.itemLevel = amt;
    const r1 = rng.getRan(1, 1, 9);
    if ((loot > 1 && r1 < 7) || (loot === 1 && r1 < 5) || mode === 1
      || (r1 < 6 && pLevel < 30) || loot > 2) {
      placeItem(univ, gold, where);
    }
  }

  for (let j = 0; j < 5; j++) {
    const cls = TREAS_CHART[loot]![j]!;
    let r1 = rng.getRan(1, 1, 100);
    if (cls < 0 || r1 > TREAS_ODDS[loot]![j]! + luck) continue;

    r1 = rng.getRan(1, 0, 9);
    let min = MIN_CHART[cls]![r1]!;
    r1 = rng.getRan(1, 0, 9);
    let max = (min + level + 2 * (loot - 1) + Math.trunc(luck / 3)) * MAX_MULT[cls]![r1]!;
    // One pile in a thousand is a hoard.
    if (rng.getRan(1, 0, 1000) === 500) {
      max = 10000;
      min = 100;
    }
    // "reality check" — weak monsters mostly don't carry fortunes.
    if (loot === 1 && max > 100 && rng.getRan(1, 0, 8) < 7) max = 100;
    if (loot === 2 && max > 200 && rng.getRan(1, 0, 8) < 6) max = 200;

    // Up to three draws to land inside [min, max]; the third only has to come
    // in under max, and is discarded if even that fails.
    let item = returnTreasure(univ.scenario, rng, cls, false);
    if (itemVal(item) < min || itemVal(item) > max) {
      item = returnTreasure(univ.scenario, rng, cls, false);
      if (itemVal(item) < min || itemVal(item) > max) {
        item = returnTreasure(univ.scenario, rng, cls, false);
        if (itemVal(item) > max) item.variety = ItemType.NO_ITEM;
      }
    }

    // not many magic items
    if (mode === 0) {
      if (item.magic && level < 2 && rng.getRan(1, 0, 5) < 3) item.variety = ItemType.NO_ITEM;
      if (item.magic && level === 2 && rng.getRan(1, 0, 5) < 2) item.variety = ItemType.NO_ITEM;
      if (item.cursed && rng.getRan(1, 0, 5) < 3) item.variety = ItemType.NO_ITEM;
    }

    // If forced, keep dipping until a treasure comes up. The C++ loops
    // unconditionally; a scenario with no cheap items in a class would hang it,
    // so this gives up after a fixed number of tries and leaves nothing.
    if (mode === 1 && max >= 20) {
      for (let tries = 0; tries < 100; tries++) {
        item = returnTreasure(univ.scenario, rng, cls, false);
        if (item.variety !== ItemType.NO_ITEM && itemVal(item) <= max) break;
      }
    }

    // Not many cursed items
    if (item.cursed && rng.getRan(1, 0, 2) === 1) item.variety = ItemType.NO_ITEM;

    if (item.variety === ItemType.NO_ITEM) continue;
    // One identify roll per living PC — and every one of them rolls, so a
    // second success after the first changes nothing but the RNG state.
    for (const pc of univ.party.pcs) {
      if (!pc.isAlive) continue;
      const lore = Math.max(0, Math.min(20, pc.skill(Skill.ITEM_LORE)));
      if (rng.getRan(1, 1, 100) < ID_ODDS[lore]!) item.ident = true;
    }
    placeItem(univ, item, where);
  }
}
