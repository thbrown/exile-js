/**
 * Random treasure — cScenario::return_treasure / pull_item_of_type
 * (scenario.cpp:445-558). Used by the random "Magic Shop" stock and, later, by
 * monster drops. The get_ran call order is part of the spec: every branch here
 * draws exactly as often as the C++ does, in the same order.
 */

import { GameRng } from '../core/rng';
import { Item, ItemType, defaultItem } from './item';
import { Scenario } from './scenario';

enum TreasureType {
  FOOD, WEAPON, ARMOR, SHIELD, HELM, MISSILE, POTION,
  SCROLL, WAND, RING, NECKLACE, POISON, GLOVES, BOOTS,
}

const T = TreasureType;
/** which_treas_chart (scenario.cpp:478) — 48 entries; loot level shifts into it. */
const TREASURE_CHART: TreasureType[] = [
  T.FOOD, T.FOOD, T.FOOD, T.FOOD, T.FOOD, T.WEAPON, T.WEAPON, T.WEAPON, T.WEAPON, T.WEAPON,
  T.ARMOR, T.ARMOR, T.ARMOR, T.ARMOR, T.ARMOR, T.WEAPON, T.WEAPON, T.WEAPON, T.SHIELD, T.SHIELD,
  T.SHIELD, T.SHIELD, T.HELM, T.HELM, T.HELM, T.MISSILE, T.MISSILE, T.MISSILE, T.POTION, T.POTION,
  T.POTION, T.SCROLL, T.SCROLL, T.WAND, T.WAND, T.RING, T.NECKLACE, T.POISON, T.POISON, T.GLOVES,
  T.GLOVES, T.BOOTS, T.WAND, T.RING, T.NECKLACE, T.WAND, T.RING, T.NECKLACE,
];

const LOOT_MIN = [0, 0, 5, 50, 400];
const LOOT_MAX = [3, 8, 40, 800, 4000];

const WEAPON = [ItemType.ONE_HANDED, ItemType.TWO_HANDED];
const ARMOR = [ItemType.ARMOR];
const SHIELD = [ItemType.SHIELD];
const HELM = [ItemType.HELM];
const MISSILES1 = [ItemType.ARROW, ItemType.THROWN_MISSILE, ItemType.BOW];
const MISSILES2 = [ItemType.CROSSBOW, ItemType.BOLTS, ItemType.MISSILE_NO_AMMO];
const SCROLL = [ItemType.SCROLL];
const WAND = [ItemType.WAND];
const RING = [ItemType.RING];
const NECKLACE = [ItemType.NECKLACE];
const POTION = [ItemType.POTION];
const POISON = [ItemType.WEAPON_POISON];
const GLOVES = [ItemType.GLOVES];
const BOOTS = [ItemType.BOOTS];

/** cScenario::get_stored_item (scenario.cpp:436). */
function storedItem(scen: Scenario, loot: number): Item {
  const item = scen.scenItems[loot];
  return item ? { ...item } : defaultItem();
}

/** cScenario::pull_item_of_type (scenario.cpp:445). */
function pullItemOfType(
  scen: Scenario, rng: GameRng, lootMax: number, minVal: number, maxVal: number,
  types: ItemType[], allowJunk: boolean,
): Item {
  // Occasionally get a nice item.
  if (rng.getRan(1, 0, 160) === 80) {
    lootMax += 2;
    maxVal += 2000;
  }
  for (let i = 0; i < 80; i++) {
    const j = rng.getRan(1, 0, scen.scenItems.length - 1);
    const item = storedItem(scen, j);
    if (item.variety === ItemType.NO_ITEM) continue;
    if (!types.includes(item.variety)) continue;
    const val = item.charges > 0 ? item.charges * item.value : item.value;
    if (val >= minVal && val <= maxVal && (item.treasClass !== 0 || allowJunk)
      && item.treasClass <= lootMax) return item;
  }
  return defaultItem();
}

/** cScenario::return_treasure (scenario.cpp:469). */
export function returnTreasure(
  scen: Scenario, rng: GameRng, loot: number, allowJunk: boolean,
): Item {
  let treas = defaultItem();
  const min = LOOT_MIN[loot] ?? 0;
  const max = LOOT_MAX[loot] ?? 0;
  const pull = (types: ItemType[], maxOverride = max) =>
    pullItemOfType(scen, rng, loot, min, maxOverride, types, allowJunk);

  let r1 = rng.getRan(1, 0, 41);
  if (loot >= 3) r1 += 3;
  if (loot === 4) r1 += 3;

  switch (TREASURE_CHART[r1]) {
    case T.FOOD:
      // Food doesn't always appear.
      if (rng.getRan(1, 0, 2) === 1) {
        // The preset food is bread and a drumstick; the next two graphics are
        // also food, and there's a small chance of meat instead.
        treas = defaultItem();
        treas.variety = ItemType.FOOD;
        treas.graphicNum = 72;
        treas.fullName = 'Food';
        treas.name = 'Food';
        treas.graphicNum += rng.getRan(1, 0, 2);
        treas.itemLevel = rng.getRan(1, 5, 10);
        if (rng.getRan(1, 0, 9) === 5) treas.graphicNum = 123;
        if (rng.getRan(1, 0, 9) === 5) treas.graphicNum = 124;
      }
      break;
    case T.WEAPON:
      if (loot > 0) treas = pull(WEAPON);
      break;
    case T.ARMOR:
      if (loot > 0) treas = pull(ARMOR);
      break;
    case T.SHIELD: treas = pull(SHIELD); break;
    case T.HELM: treas = pull(HELM); break;
    case T.MISSILE:
      // Note the C++ discards the first pull; kept verbatim so the RNG
      // sequence matches.
      if (rng.getRan(1, 0, 2) < 2) pull(MISSILES1);
      treas = pull(MISSILES2);
      break;
    case T.POTION:
      treas = pull(POTION, Math.trunc(max / (rng.getRan(1, 0, 80) < 20 * (4 - loot) ? 2 : 1)));
      break;
    case T.SCROLL: treas = pull(SCROLL); break;
    case T.WAND: treas = pull(WAND); break;
    case T.RING: treas = pull(RING); break;
    case T.NECKLACE: treas = pull(NECKLACE); break;
    case T.POISON: treas = pull(POISON); break;
    case T.GLOVES: treas = pull(GLOVES); break;
    case T.BOOTS: treas = pull(BOOTS); break;
  }
  if (treas.variety === ItemType.NO_ITEM) treas.value = 0;
  return treas;
}
