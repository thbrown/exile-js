/**
 * Per-item-type properties — load_item_type_info (item.cpp:35). These drive
 * equipping: how many of a type can be worn at once, how many hands it takes,
 * and which mutually-exclusive category it belongs to.
 */

import { ItemType } from './item';

export enum ItemCat {
  MISC = 0,
  MISSILE_WEAPON = 1,
  MISSILE_AMMO = 2,
  HANDS = 3,
}

export interface ItemVariety {
  isArmour: boolean;
  isWeapon: boolean;
  isMissile: boolean;
  /** How many of this type can be equipped at once; 0 means not equippable. */
  equipCount: number;
  /** Hands it occupies; there are two. */
  numHands: number;
  exclusion: ItemCat;
}

const T = ItemType;

// The C++ builds these as multisets, so a type listed twice can be equipped
// twice (two one-handed weapons, two rings).
const EQUIPPABLE: ItemType[] = [
  T.ONE_HANDED, T.TWO_HANDED, T.BOW, T.ARROW, T.THROWN_MISSILE,
  T.TOOL, T.SHIELD, T.ARMOR, T.HELM, T.GLOVES,
  T.SHIELD_2, T.BOOTS, T.RING, T.NECKLACE, T.PANTS,
  T.CROSSBOW, T.BOLTS, T.MISSILE_NO_AMMO,
  T.ONE_HANDED, T.RING,
];

const NUM_HANDS: ItemType[] = [
  T.ONE_HANDED, T.TWO_HANDED, T.TWO_HANDED, T.SHIELD, T.SHIELD_2,
];

const WEAPONS_NON_MISSILE = new Set([T.ONE_HANDED, T.TWO_HANDED, T.BOW, T.CROSSBOW]);
const WEAPONS_MISSILE = new Set([T.ARROW, T.THROWN_MISSILE, T.BOLTS, T.MISSILE_NO_AMMO]);
const ARMOUR = new Set([T.SHIELD, T.ARMOR, T.HELM, T.GLOVES, T.BOOTS, T.SHIELD_2]);

const EXCLUDING: Partial<Record<ItemType, ItemCat>> = {
  [T.BOW]: ItemCat.MISSILE_WEAPON,
  [T.CROSSBOW]: ItemCat.MISSILE_WEAPON,
  [T.MISSILE_NO_AMMO]: ItemCat.MISSILE_WEAPON,
  [T.ARROW]: ItemCat.MISSILE_AMMO,
  [T.THROWN_MISSILE]: ItemCat.MISSILE_AMMO,
  [T.BOLTS]: ItemCat.MISSILE_AMMO,
};

const count = (list: ItemType[], type: ItemType): number =>
  list.reduce((n, t) => n + (t === type ? 1 : 0), 0);

export const ITEM_VARIETIES: ItemVariety[] = Array.from({ length: 28 }, (_, i) => {
  const type = i as ItemType;
  const numHands = count(NUM_HANDS, type);
  return {
    isArmour: ARMOUR.has(type),
    isWeapon: WEAPONS_NON_MISSILE.has(type) || WEAPONS_MISSILE.has(type),
    isMissile: WEAPONS_MISSILE.has(type),
    equipCount: count(EQUIPPABLE, type),
    numHands,
    // Anything using hands excludes on hands; otherwise it uses its own
    // category, defaulting to MISC (which excludes only its exact type).
    exclusion: numHands > 0 ? ItemCat.HANDS : (EXCLUDING[type] ?? ItemCat.MISC),
  };
});

export function variety(type: ItemType): ItemVariety {
  return ITEM_VARIETIES[type] ?? ITEM_VARIETIES[0]!;
}
