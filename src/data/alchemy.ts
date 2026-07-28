/**
 * Alchemy — a port of alchemy.hpp / alchemy.cpp, plus `cItem(eAlchemy)`
 * (item.cpp:364), the constructor that turns a recipe into the potion it
 * makes.
 *
 * A recipe is one or two **ingredient abilities** (a plant is just an item
 * carrying `ItemAbil.HOLLY` and friends), a difficulty the PC's Alchemy skill
 * is measured against, and the ability the resulting potion carries. The
 * numbers are stored in saves as the `party.alchemy` flags indexed by
 * `Alchemy`, so the enum order is verbatim.
 */

import { Item, ItemAbil, ItemType, ItemUse, defaultItem } from './item';
import { Status } from '../universe/skills';
import { getStr } from './strings';

/** eAlchemy (alchemy.hpp:18). */
export enum Alchemy {
  NONE = -1,
  CURE_WEAK = 0,
  HEAL_WEAK = 1,
  POISON_WEAK = 2,
  SPEED_WEAK = 3,
  POISON_MED = 4,
  HEAL_MED = 5,
  CURE_STRONG = 6,
  SPEED_MED = 7,
  GRAYMOLD = 8,
  POWER_WEAK = 9,
  CLARITY = 10,
  POISON_STRONG = 11,
  HEAL_STRONG = 12,
  POISON_KILL = 13,
  RESURRECT = 14,
  POWER_MED = 15,
  KNOWLEDGE = 16,
  STRENGTH = 17,
  BLISS = 18,
  POWER_STRONG = 19,
}

export const NUM_ALCHEMY = 20;

/** cAlchemy (alchemy.hpp:42) — one row of the recipe dictionary. */
export interface AlchemyRecipe {
  id: Alchemy;
  /** The potion's gold value. */
  value: number;
  /** The Alchemy skill the PC needs before they can try at all. */
  difficulty: number;
  ability: ItemAbil;
  ingred1: ItemAbil;
  /** NONE for a one-ingredient recipe. */
  ingred2: ItemAbil;
  abilStrength: number;
  /** The status an AFFECT_STATUS potion carries (uItemAbilData::status). */
  abilData: number;
  magicUseType: ItemUse;
}

function recipe(
  id: Alchemy,
  difficulty: number,
  value: number,
  ingred1: ItemAbil,
  ingred2: ItemAbil,
  ability: ItemAbil,
  abilStrength: number,
  abilData = 0,
  magicUseType = ItemUse.HELP_ONE,
): AlchemyRecipe {
  return { id, difficulty, value, ingred1, ingred2, ability, abilStrength, abilData, magicUseType };
}

const N = ItemAbil.NONE;

/**
 * The twenty recipes, in `eAlchemy` order (alchemy.cpp:84-136). The builder
 * chains there read `withDifficulty(d).withValue(v).withIngredient(s)
 * .withAbility(a, strength[, status])`; the columns here are in that order.
 */
export const ALCHEMY_RECIPES: AlchemyRecipe[] = [
  recipe(Alchemy.CURE_WEAK, 1, 40, ItemAbil.HOLLY, N,
    ItemAbil.AFFECT_STATUS, 2, Status.POISON),
  recipe(Alchemy.HEAL_WEAK, 1, 60, ItemAbil.COMFREY, N,
    ItemAbil.AFFECT_HEALTH, 2),
  recipe(Alchemy.POISON_WEAK, 1, 15, ItemAbil.HOLLY, N,
    ItemAbil.POISON_WEAPON, 2),
  recipe(Alchemy.SPEED_WEAK, 3, 50, ItemAbil.COMFREY, ItemAbil.WORMGRASS,
    ItemAbil.AFFECT_STATUS, 2, Status.HASTE_SLOW),
  recipe(Alchemy.POISON_MED, 3, 50, ItemAbil.WORMGRASS, N,
    ItemAbil.POISON_WEAPON, 4),
  recipe(Alchemy.HEAL_MED, 4, 180, ItemAbil.NETTLE, N,
    ItemAbil.AFFECT_HEALTH, 5),
  recipe(Alchemy.CURE_STRONG, 5, 200, ItemAbil.NETTLE, N,
    ItemAbil.AFFECT_STATUS, 8, Status.POISON),
  recipe(Alchemy.SPEED_MED, 5, 100, ItemAbil.WORMGRASS, ItemAbil.NETTLE,
    ItemAbil.AFFECT_STATUS, 5, Status.HASTE_SLOW),
  // The one recipe that treats the whole party at once.
  recipe(Alchemy.GRAYMOLD, 7, 150, ItemAbil.GRAYMOLD, N,
    ItemAbil.AFFECT_STATUS, 4, Status.DISEASE, ItemUse.HELP_ALL),
  recipe(Alchemy.POWER_WEAK, 9, 100, ItemAbil.WORMGRASS, ItemAbil.ASPTONGUE,
    ItemAbil.AFFECT_SPELL_POINTS, 2),
  recipe(Alchemy.CLARITY, 9, 200, ItemAbil.GRAYMOLD, ItemAbil.HOLLY,
    ItemAbil.AFFECT_STATUS, 8, Status.DUMB),
  recipe(Alchemy.POISON_STRONG, 10, 150, ItemAbil.ASPTONGUE, N,
    ItemAbil.POISON_WEAPON, 6),
  recipe(Alchemy.HEAL_STRONG, 12, 300, ItemAbil.GRAYMOLD, ItemAbil.COMFREY,
    ItemAbil.AFFECT_HEALTH, 8),
  recipe(Alchemy.POISON_KILL, 12, 400, ItemAbil.MANDRAKE, N,
    ItemAbil.POISON_WEAPON, 8),
  recipe(Alchemy.RESURRECT, 9, 100, ItemAbil.EMBERF, N,
    ItemAbil.RESURRECTION_BALM, 0),
  recipe(Alchemy.POWER_MED, 14, 300, ItemAbil.MANDRAKE, ItemAbil.ASPTONGUE,
    ItemAbil.AFFECT_SPELL_POINTS, 5),
  recipe(Alchemy.KNOWLEDGE, 19, 500, ItemAbil.MANDRAKE, ItemAbil.EMBERF,
    ItemAbil.AFFECT_SKILL_POINTS, 2),
  recipe(Alchemy.STRENGTH, 10, 175, ItemAbil.NETTLE, ItemAbil.EMBERF,
    ItemAbil.AFFECT_STATUS, 8, Status.BLESS_CURSE),
  recipe(Alchemy.BLISS, 16, 250, ItemAbil.GRAYMOLD, ItemAbil.ASPTONGUE,
    ItemAbil.BLISS_DOOM, 5),
  recipe(Alchemy.POWER_STRONG, 20, 500, ItemAbil.MANDRAKE, ItemAbil.EMBERF,
    ItemAbil.AFFECT_SKILL_POINTS, 8),
];

/** `operator*(eAlchemy)` — the recipe, or null for a number off the table. */
export function alchemyRecipe(which: Alchemy): AlchemyRecipe | null {
  return ALCHEMY_RECIPES[which] ?? null;
}

/** cAlchemy::fail_chances (alchemy.cpp:14), indexed by skill above difficulty. */
const FAIL_CHANCES = [50, 40, 30, 20, 10, 8, 6, 4, 2];

/**
 * cAlchemy::fail_chance — the percentage roll a mixing attempt has to beat.
 *
 * *Gotcha*: the guard is `skill - difficulty > fail_chances.size()`, i.e. `> 9`
 * for a nine-entry table, so a PC exactly nine above the difficulty indexes one
 * past the end — undefined in the C++. This port reads it as 0 (a certainty),
 * which is what the next step up gives anyway.
 */
export function alchemyFailChance(recipeIn: AlchemyRecipe, skill: number): number {
  if (skill < recipeIn.difficulty) return 100;
  if (skill - recipeIn.difficulty > FAIL_CHANCES.length) return 0;
  return FAIL_CHANCES[skill - recipeIn.difficulty] ?? 0;
}

/** cAlchemy::charges — how many doses one mixing makes. */
export function alchemyCharges(recipeIn: AlchemyRecipe, skill: number): number {
  if (skill < recipeIn.difficulty) return 0;
  const diff = skill - recipeIn.difficulty;
  if (diff >= 11) return 3;
  if (diff >= 5) return 2;
  return 1;
}

/** cAlchemy::can_make — whether the PC can attempt this at all. */
export function canMakeAlchemy(recipeIn: AlchemyRecipe, skill: number): boolean {
  return alchemyFailChance(recipeIn, skill) < 100;
}

/** The potion's name, from the `magic-names` table (entries 200 and up). */
export function alchemyName(which: Alchemy): string {
  return getStr('magic-names', which + 200);
}

/**
 * `cItem(ITEM_POTION)` (item.cpp:337) followed by `cItem(eAlchemy)` (:364) —
 * the potion a successful mixing produces. The caller sets the charges and
 * nudges the graphic, as `do_alchemy` does.
 */
export function alchemyPotion(which: Alchemy): Item {
  const info = alchemyRecipe(which);
  const item = defaultItem();
  item.variety = ItemType.POTION;
  item.charges = 1;
  item.maxCharges = 1;
  item.graphicNum = 60;
  item.weight = 8;
  item.fullName = 'Potion';
  item.name = 'Potion';
  item.magic = true;
  if (!info) return item;
  item.fullName = alchemyName(which);
  item.value = info.value;
  item.ability = info.ability;
  item.abilStrength = info.abilStrength;
  item.abilData = info.abilData;
  item.magicUseType = info.magicUseType;
  return item;
}
