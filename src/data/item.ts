/**
 * Item data — cItem from ../exile-wasm/src/scenario/item.hpp with enums
 * from item_variety.hpp / item_abilities.hpp. Defaults match cItem()
 * (item.cpp:206).
 */

import { SPELLS, Spell, SpellWhen } from './spell';
import { PartyStatus, Status } from '../universe/skills';

export enum ItemType {
  NO_ITEM = 0,
  ONE_HANDED = 1,
  TWO_HANDED = 2,
  GOLD = 3,
  BOW = 4,
  ARROW = 5,
  THROWN_MISSILE = 6,
  POTION = 7,
  SCROLL = 8,
  WAND = 9,
  TOOL = 10,
  FOOD = 11,
  SHIELD = 12,
  ARMOR = 13,
  HELM = 14,
  GLOVES = 15,
  SHIELD_2 = 16,
  BOOTS = 17,
  RING = 18,
  NECKLACE = 19,
  WEAPON_POISON = 20,
  NON_USE_OBJECT = 21,
  PANTS = 22,
  CROSSBOW = 23,
  BOLTS = 24,
  MISSILE_NO_AMMO = 25,
  SPECIAL = 26,
  QUEST = 27,
}

export enum ItemUse {
  HELP_ONE = 0,
  HARM_ONE = 1,
  HELP_ALL = 2,
  HARM_ALL = 3,
}

// eItemAbil — only the values; names match the C++ enum (item_abilities.hpp)
export enum ItemAbil {
  NONE = 0,
  DAMAGING_WEAPON = 1,
  SLAYER_WEAPON = 2,
  HEALING_WEAPON = 3,
  EXPLODING_WEAPON = 4,
  RETURNING_MISSILE = 5,
  DISTANCE_MISSILE = 6,
  SEEKING_MISSILE = 7,
  ANTIMAGIC_WEAPON = 8,
  STATUS_WEAPON = 9,
  SOULSUCKER = 10,
  WEAK_WEAPON = 12,
  CAUSES_FEAR = 13,
  WEAPON_CALL_SPECIAL = 14,
  HP_DAMAGE = 15,
  HP_DAMAGE_REVERSE = 16,
  SP_DAMAGE = 17,
  SP_DAMAGE_REVERSE = 18,
  DAMAGE_PROTECTION = 30,
  FULL_PROTECTION = 31,
  MAGERY = 32,
  EVASION = 33,
  MARTYRS_SHIELD = 34,
  ENCUMBERING = 35,
  STATUS_PROTECTION = 36,
  SKILL = 37,
  BOOST_STAT = 38,
  BOOST_WAR = 39,
  BOOST_MAGIC = 40,
  ACCURACY = 41,
  THIEVING = 42,
  GIANT_STRENGTH = 43,
  LIGHTER_OBJECT = 44,
  HEAVIER_OBJECT = 45,
  OCCASIONAL_STATUS = 46,
  HIT_CALL_SPECIAL = 47,
  LIFE_SAVING = 48,
  PROTECT_FROM_PETRIFY = 49,
  REGENERATE = 50,
  POISON_AUGMENT = 51,
  RADIANT = 52,
  WILL = 53,
  FREE_ACTION = 54,
  SPEED = 55,
  SLOW_WEARER = 56,
  PROTECT_FROM_SPECIES = 57,
  LOCKPICKS = 58,
  DRAIN_MISSILES = 59,
  DROP_CALL_SPECIAL = 60,
  POISON_WEAPON = 70,
  AFFECT_STATUS = 71,
  CAST_SPELL = 72,
  BLISS_DOOM = 73,
  AFFECT_EXPERIENCE = 74,
  AFFECT_SKILL_POINTS = 75,
  AFFECT_HEALTH = 76,
  AFFECT_SPELL_POINTS = 77,
  LIGHT = 78,
  AFFECT_PARTY_STATUS = 79,
  HEALTH_POISON = 80,
  CALL_SPECIAL = 81,
  SUMMONING = 82,
  MASS_SUMMONING = 83,
  QUICKFIRE = 84,
  MESSAGE = 85,
  HOLLY = 150,
  COMFREY = 151,
  NETTLE = 152,
  WORMGRASS = 153,
  ASPTONGUE = 154,
  EMBERF = 155,
  GRAYMOLD = 156,
  MANDRAKE = 157,
  SAPPHIRE = 158,
  SMOKY_CRYSTAL = 159,
  RESURRECTION_BALM = 160,
}

export const SKILL_INVALID = -1;

export interface Item {
  variety: ItemType;
  itemLevel: number;
  awkward: number;
  bonus: number;
  protection: number;
  charges: number;
  maxCharges: number;
  weapType: number; // eSkill value; SKILL_INVALID when unset
  magicUseType: ItemUse;
  graphicNum: number;
  ability: ItemAbil;
  abilStrength: number;
  abilData: number;
  typeFlag: number;
  isSpecial: number;
  value: number;
  weight: number;
  specialClass: number;
  missile: number;
  itemLoc: { x: number; y: number };
  fullName: string;
  name: string;
  treasClass: number;
  ident: boolean;
  property: boolean;
  magic: boolean;
  contained: boolean;
  held: boolean;
  cursed: boolean;
  concealed: boolean;
  enchanted: boolean;
  unsellable: boolean;
  rechargeable: boolean;
  desc: string;
}

export function defaultItem(): Item {
  return {
    variety: ItemType.NO_ITEM,
    itemLevel: 0,
    awkward: 0,
    bonus: 0,
    protection: 0,
    charges: 0,
    maxCharges: 0,
    weapType: SKILL_INVALID,
    magicUseType: ItemUse.HELP_ONE,
    graphicNum: 0,
    ability: ItemAbil.NONE,
    abilStrength: 0,
    abilData: 0,
    typeFlag: 0,
    isSpecial: 0,
    value: 0,
    weight: 0,
    specialClass: 0,
    missile: -1,
    itemLoc: { x: 0, y: 0 },
    fullName: '',
    name: '',
    treasClass: 0,
    ident: false,
    property: false,
    magic: false,
    contained: false,
    held: false,
    cursed: false,
    concealed: false,
    enchanted: false,
    unsellable: false,
    rechargeable: false,
    desc: '',
  };
}

// min_defense_bonus / max_defense_bonus (item.cpp:110).
function minDefenceBonus(bonus: number): number {
  if (bonus === 0) return 0;
  if (bonus < 0) return bonus;
  return 1 + Math.trunc(bonus / 2);
}

function maxDefenceBonus(bonus: number): number {
  if (bonus === 0) return 0;
  if (bonus < 0) return bonus;
  return bonus + Math.trunc(bonus / 2);
}

/**
 * cItem::interesting_string (item.cpp:122) — the one-line summary the game
 * shows under an item's name in shops and the inventory panel.
 */
export function interestingString(item: Item): string {
  if (item.property) return 'Not yours.';
  if (!item.ident) return 'Not identified.';
  if (item.cursed) return 'Cursed item.';

  let gotString = true;
  let out = '';
  switch (item.variety) {
    case ItemType.ONE_HANDED:
    case ItemType.TWO_HANDED:
    case ItemType.ARROW:
    case ItemType.THROWN_MISSILE:
    case ItemType.BOLTS:
    case ItemType.MISSILE_NO_AMMO:
      out = `Damage: 1-${item.itemLevel}`;
      if (item.bonus > 0) out += ` + ${item.bonus}`;
      else if (item.bonus < 0) out += ` - ${-item.bonus}`;
      break;
    case ItemType.SHIELD:
    case ItemType.ARMOR:
    case ItemType.HELM:
    case ItemType.GLOVES:
    case ItemType.SHIELD_2:
    case ItemType.BOOTS: {
      let minDefense = item.itemLevel > 0 ? 1 : 0;
      minDefense += minDefenceBonus(item.bonus) + Math.sign(item.protection);
      const maxDefense = item.itemLevel + maxDefenceBonus(item.bonus) + item.protection;
      out = `Blocks ${minDefense}`;
      if (maxDefense !== minDefense) out += `-${Math.max(minDefense, item.itemLevel)}`;
      out += ' damage';
      break;
    }
    case ItemType.BOW:
    case ItemType.CROSSBOW:
      out = `Bonus: +${item.bonus} to hit`;
      break;
    case ItemType.GOLD:
      out = `${item.itemLevel} gold pieces`;
      break;
    case ItemType.SPECIAL:
    case ItemType.QUEST:
      out = 'Special';
      break;
    case ItemType.FOOD:
      out = `${item.itemLevel} food`;
      break;
    case ItemType.WEAPON_POISON:
      out = `Poison: ${item.itemLevel}-${item.itemLevel * 6} damage`;
      break;
    default:
      gotString = false;
      break;
  }
  if (item.charges > 0 && item.ability !== ItemAbil.MESSAGE) {
    if (gotString) out += '; ';
    out += `Uses: ${item.charges}`;
  }
  return out.length > 0 ? `${out}.` : out;
}

// --- Which items can be Used, and where (item.cpp:1354) --------------------

const USE_COMBAT = 1;
const USE_TOWN = 2;
const USE_OUTDOORS = 4;
const USE_MAGIC = 8;

/**
 * `abil_chart` (item.cpp:1356) — for each *usable* ability, where it may be
 * used and whether using it counts as magic (which a magically inept PC can't
 * do). Any ability not in here can't be Used at all, which is how `can_use`
 * answers no for the sixty-odd passive abilities without listing them.
 */
const ABIL_CHART: Partial<Record<ItemAbil, number>> = {
  [ItemAbil.POISON_WEAPON]: USE_TOWN | USE_COMBAT,
  // The default; several statuses widen it to outdoors in use_outdoors below.
  [ItemAbil.AFFECT_STATUS]: USE_TOWN | USE_COMBAT | USE_MAGIC,
  // No `when` bits of its own — they come from the spell it casts.
  [ItemAbil.CAST_SPELL]: USE_MAGIC,
  [ItemAbil.BLISS_DOOM]: USE_TOWN | USE_COMBAT | USE_MAGIC,
  [ItemAbil.AFFECT_EXPERIENCE]: USE_TOWN | USE_COMBAT | USE_OUTDOORS | USE_MAGIC,
  [ItemAbil.AFFECT_SKILL_POINTS]: USE_TOWN | USE_COMBAT | USE_OUTDOORS | USE_MAGIC,
  [ItemAbil.AFFECT_HEALTH]: USE_TOWN | USE_COMBAT | USE_OUTDOORS | USE_MAGIC,
  [ItemAbil.AFFECT_SPELL_POINTS]: USE_TOWN | USE_COMBAT | USE_OUTDOORS | USE_MAGIC,
  [ItemAbil.LIGHT]: USE_TOWN | USE_COMBAT,
  [ItemAbil.AFFECT_PARTY_STATUS]: USE_TOWN | USE_COMBAT | USE_MAGIC,
  [ItemAbil.HEALTH_POISON]: USE_TOWN | USE_COMBAT | USE_OUTDOORS | USE_MAGIC,
  [ItemAbil.CALL_SPECIAL]: USE_TOWN | USE_COMBAT | USE_OUTDOORS | USE_MAGIC,
  [ItemAbil.SUMMONING]: USE_TOWN | USE_COMBAT | USE_MAGIC,
  [ItemAbil.MASS_SUMMONING]: USE_TOWN | USE_COMBAT | USE_MAGIC,
  [ItemAbil.QUICKFIRE]: USE_TOWN | USE_COMBAT | USE_MAGIC,
  [ItemAbil.MESSAGE]: USE_TOWN | USE_COMBAT | USE_OUTDOORS,
};

/** cItem::abil_harms (item.cpp:194) — is this a hostile use type? */
export function abilHarms(item: Item): boolean {
  return item.magicUseType === ItemUse.HARM_ONE || item.magicUseType === ItemUse.HARM_ALL;
}

/** cItem::abil_group (item.cpp:200) — does it hit the whole party? */
export function abilGroup(item: Item): boolean {
  return item.magicUseType === ItemUse.HELP_ALL || item.magicUseType === ItemUse.HARM_ALL;
}

/** The `when` bits of the spell a CAST_SPELL item casts. */
function spellWhen(item: Item): number {
  return SPELLS[item.abilData as Spell]?.when ?? 0;
}

/** cItem::use_in_combat (item.cpp:1375). */
export function useInCombat(item: Item): boolean {
  if (item.ability === ItemAbil.CAST_SPELL) return (spellWhen(item) & SpellWhen.COMBAT) !== 0;
  // Flight is the one party status that's outdoors-only.
  if (item.ability === ItemAbil.AFFECT_PARTY_STATUS
    && item.abilData === PartyStatus.FLIGHT) return false;
  return ((ABIL_CHART[item.ability] ?? 0) & USE_COMBAT) !== 0;
}

/** cItem::use_in_town (item.cpp:1385). */
export function useInTown(item: Item): boolean {
  if (item.ability === ItemAbil.CAST_SPELL) return (spellWhen(item) & SpellWhen.TOWN) !== 0;
  if (item.ability === ItemAbil.AFFECT_PARTY_STATUS
    && item.abilData === PartyStatus.FLIGHT) return false;
  return ((ABIL_CHART[item.ability] ?? 0) & USE_TOWN) !== 0;
}

/** cItem::use_outdoors (item.cpp:1395). */
export function useOutdoors(item: Item): boolean {
  if (item.ability === ItemAbil.CAST_SPELL) return (spellWhen(item) & SpellWhen.OUTDOORS) !== 0;
  if (item.ability === ItemAbil.AFFECT_PARTY_STATUS && item.abilData === PartyStatus.FLIGHT)
    return true;
  if (item.ability === ItemAbil.AFFECT_STATUS) {
    // Four statuses widen AFFECT_STATUS past its chart entry: the two that are
    // afflictions you'd want to cure on the road, and the two long-lived buffs.
    const s = item.abilData as Status;
    if (s === Status.POISON || s === Status.DISEASE
      || s === Status.HASTE_SLOW || s === Status.BLESS_CURSE) return true;
  }
  return ((ABIL_CHART[item.ability] ?? 0) & USE_OUTDOORS) !== 0;
}

/** cItem::use_magic (item.cpp:1410) — does Using it count as casting? */
export function useMagic(item: Item): boolean {
  return ((ABIL_CHART[item.ability] ?? 0) & USE_MAGIC) !== 0;
}

/** cItem::can_use (item.cpp:1414) — usable *somewhere*. */
export function canUse(item: Item): boolean {
  return useInTown(item) || useInCombat(item) || useOutdoors(item);
}
