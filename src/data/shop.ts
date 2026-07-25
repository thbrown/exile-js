/**
 * Shops — port of cShop / cShopItem (scenario/shop.hpp:60, shop.cpp).
 * Enum values are verbatim: eShopItemType's numbering is load-bearing because
 * old scenarios are ported by number, and everything from HEAL_WOUNDS up is
 * treated as a healing service by ordering comparisons.
 */

import { Item, ItemType, defaultItem } from './item';
import { getStr } from './strings';
import { Skill } from '../universe/skills';

export enum ShopType {
  NORMAL = 0,
  ALLOW_DEAD = 1,
  RANDOM = 2,
}

export enum ShopPrompt {
  SHOPPING = 0,
  HEALING = 1,
  MAGE = 2,
  PRIEST = 3,
  SPELLS = 4,
  ALCHEMY = 5,
  TRAINING = 6,
}

export enum ShopItemType {
  EMPTY = 0,
  ITEM = 1,
  MAGE_SPELL = 2,
  PRIEST_SPELL = 3,
  ALCHEMY = 4,
  SKILL = 5,
  TREASURE = 6,
  CLASS = 7,
  OPT_ITEM = 8,
  CALL_SPECIAL = 9,
  // Everything from here down is a healing service; HEAL_WOUNDS stays first.
  HEAL_WOUNDS = 10,
  CURE_POISON = 11,
  CURE_DISEASE = 12,
  CURE_ACID = 13,
  CURE_PARALYSIS = 14,
  REMOVE_CURSE = 15,
  DESTONE = 16,
  RAISE_DEAD = 17,
  RESURRECT = 18,
  CURE_DUMBFOUNDING = 19,
}

/** estreams.cpp:636 — the strings scenario.xml uses for <type>. */
export const SHOP_TYPE_TAGS = ['live', 'dead', 'rand'];
/** estreams.cpp:651 — the strings scenario.xml uses for <prompt>. */
export const SHOP_PROMPT_TAGS = ['shop', 'heal', 'mage', 'priest', 'spell', 'alch', 'train'];

export const INFINITE_AMOUNT = 0;

/** cost_mult (shop.cpp:47) — indexed by the shop's cost adjustment, 0..6. */
const COST_MULT = [5, 7, 10, 13, 16, 20, 25];

export interface ShopItem {
  type: ShopItemType;
  quantity: number;
  index: number;
  item: Item;
}

export function emptyShopItem(): ShopItem {
  return { type: ShopItemType.EMPTY, quantity: 0, index: 0, item: shopBaseItem() };
}

/** cItem(ITEM_SHOP) — the blank graphic (item.cpp:357). */
export function shopBaseItem(): Item {
  const item = defaultItem();
  item.graphicNum = 105;
  return item;
}

/** cShopItem::getCost (shop.cpp:322). */
export function shopItemCost(entry: ShopItem, adj: number): number {
  let cost = entry.item.value;
  if (entry.item.charges > 0) cost *= entry.item.charges;
  cost *= COST_MULT[Math.max(0, Math.min(6, adj))]!;
  return Math.trunc(cost / 10);
}

/** skill_cost / skill_max / skill_g_cost (shop.cpp:14). */
export const SKILL_MAX: Partial<Record<Skill, number>> = {
  [Skill.STRENGTH]: 20, [Skill.DEXTERITY]: 20, [Skill.INTELLIGENCE]: 20,
  [Skill.EDGED_WEAPONS]: 20, [Skill.BASHING_WEAPONS]: 20, [Skill.POLE_WEAPONS]: 20,
  [Skill.THROWN_MISSILES]: 20, [Skill.ARCHERY]: 20, [Skill.DEFENSE]: 20,
  [Skill.MAGE_SPELLS]: 7, [Skill.PRIEST_SPELLS]: 7, [Skill.MAGE_LORE]: 20,
  [Skill.ALCHEMY]: 20, [Skill.ITEM_LORE]: 10, [Skill.DISARM_TRAPS]: 20,
  [Skill.LOCKPICKING]: 20, [Skill.ASSASSINATION]: 20, [Skill.POISON]: 20,
  [Skill.LUCK]: 20,
};

export const SKILL_GOLD_COST: Partial<Record<Skill, number>> = {
  [Skill.STRENGTH]: 50, [Skill.DEXTERITY]: 50, [Skill.INTELLIGENCE]: 50,
  [Skill.EDGED_WEAPONS]: 40, [Skill.BASHING_WEAPONS]: 40, [Skill.POLE_WEAPONS]: 40,
  [Skill.THROWN_MISSILES]: 30, [Skill.ARCHERY]: 50, [Skill.DEFENSE]: 40,
  [Skill.MAGE_SPELLS]: 250, [Skill.PRIEST_SPELLS]: 250, [Skill.MAGE_LORE]: 25,
  [Skill.ALCHEMY]: 100, [Skill.ITEM_LORE]: 200, [Skill.DISARM_TRAPS]: 30,
  [Skill.LOCKPICKING]: 20, [Skill.ASSASSINATION]: 100, [Skill.POISON]: 80,
  [Skill.LUCK]: 0,
};

const HEAL_COSTS = [50, 30, 80, 90, 100, 250, 500, 1000, 3000, 100];
const HEAL_TYPES = [
  'Heal Damage', 'Cure Poison', 'Cure Disease', 'Cure Acid', 'Cure Paralysis',
  'Uncurse Items', 'Cure Stoned Character', 'Raise Dead', 'Resurrection', 'Cure Dumbfounding',
];

/** cItem(ITEM_SPELL) (item.cpp:334) — the carrier for spells and recipes. */
function spellItem(): Item {
  const item = defaultItem();
  item.variety = ItemType.NON_USE_OBJECT;
  item.graphicNum = 63;
  return item;
}

// store_mage_spells / store_priest_spells / store_alchemy (shop.cpp:127-190).
const MAGE_SPELL_COSTS = [
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  150, 200, 150, 1000, 1200, 400, 300, 200,
  200, 250, 500, 1500, 300, 250, 125, 150,
  400, 450, 800, 600, 700, 600, 7500, 500,
  5000, 3000, 3500, 4000, 4000, 4500, 7000, 5000,
];

const PRIEST_SPELL_COSTS = [
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
  100, 150, 75, 400, 200, 100, 80, 250,
  400, 400, 1200, 600, 300, 600, 350, 250,
  500, 500, 600, 800, 1000, 900, 400, 600,
  2500, 2000, 4500, 4500, 3000, 3000, 2000, 2000,
];

const ALCHEMY_COSTS = [
  50, 75, 30, 130, 100,
  150, 200, 200, 300, 250,
  300, 500, 600, 750, 700,
  1000, 10000, 5000, 7000, 12000,
];

function clamp(lo: number, hi: number, v: number): number {
  return v < lo || v > hi ? lo : v;
}

function storeMageSpell(which: number): Item {
  const spell = spellItem();
  const n = clamp(0, 61, which);
  spell.itemLevel = n;
  spell.value = MAGE_SPELL_COSTS[n] ?? 5;
  spell.fullName = getStr('magic-names', n + 1);
  return spell;
}

function storePriestSpell(which: number): Item {
  const spell = spellItem();
  const n = clamp(0, 61, which);
  spell.itemLevel = n;
  spell.value = PRIEST_SPELL_COSTS[n] ?? 5;
  spell.fullName = getStr('magic-names', n + 101);
  return spell;
}

function storeAlchemy(which: number): Item {
  const spell = spellItem();
  const n = clamp(0, 19, which);
  spell.itemLevel = n;
  spell.value = ALCHEMY_COSTS[n]!;
  spell.fullName = getStr('magic-names', n + 200);
  return spell;
}

export class Shop {
  items: ShopItem[] = [];
  costAdj = 0;
  name = '';
  type: ShopType = ShopType.NORMAL;
  prompt: ShopPrompt = ShopPrompt.SHOPPING;
  face = 0;

  /** cShop::firstEmpty (shop.cpp:88). */
  private firstEmpty(): number {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i]!.type === ShopItemType.EMPTY) return i;
    }
    return this.items.length;
  }

  private grow(i: number): void {
    while (this.items.length <= i) this.items.push(emptyShopItem());
  }

  get size(): number {
    return this.items.length;
  }

  numItems(): number {
    return this.items.filter((it) => it.type !== ShopItemType.EMPTY).length;
  }

  getItem(i: number): ShopItem {
    return this.items[i] ?? emptyShopItem();
  }

  replaceItem(i: number, entry: ShopItem): void {
    this.grow(i);
    this.items[i] = entry;
  }

  /** cShop::addItem (shop.cpp:107) — n indexes the scenario item list. */
  addItem(n: number, item: Item, quantity: number, chance = 100): void {
    const i = this.firstEmpty();
    this.grow(i);
    if (item.variety === ItemType.NO_ITEM) return;
    const entry = this.items[i]!;
    entry.type = chance === 100 ? ShopItemType.ITEM : ShopItemType.OPT_ITEM;
    entry.item = item;
    entry.quantity = quantity;
    entry.index = n;
    // An optional item packs its chance into the thousands place.
    if (chance < 100) entry.quantity = Math.min(999, quantity) + chance * 1000;
  }

  /** cShop::addSpecial(type, n) (shop.cpp:190). */
  addSpecial(type: ShopItemType, n = 0): void {
    if (type === ShopItemType.EMPTY || type === ShopItemType.CALL_SPECIAL) return;
    if (type === ShopItemType.OPT_ITEM || type === ShopItemType.ITEM) return;
    this.replaceSpecial(this.firstEmpty(), type, n);
  }

  /** cShop::replaceSpecial (shop.cpp:196). */
  replaceSpecial(i: number, type: ShopItemType, n = 0): void {
    if (type === ShopItemType.EMPTY || type === ShopItemType.ITEM) return;
    if (type === ShopItemType.OPT_ITEM || type === ShopItemType.CALL_SPECIAL) return;
    this.grow(i);
    const entry = this.items[i]!;
    entry.type = type;
    entry.index = type >= ShopItemType.HEAL_WOUNDS ? type - ShopItemType.HEAL_WOUNDS : n;

    if (type === ShopItemType.MAGE_SPELL) entry.item = storeMageSpell(n);
    else if (type === ShopItemType.PRIEST_SPELL) entry.item = storePriestSpell(n);
    else if (type === ShopItemType.ALCHEMY) entry.item = storeAlchemy(n);
    else if (type === ShopItemType.SKILL) {
      entry.item = defaultItem();
      entry.item.graphicNum = 108;
      entry.item.itemLevel = n;
      entry.item.fullName = getStr('skills', n * 2 + 1);
    } else if (type === ShopItemType.TREASURE) {
      entry.item = defaultItem();
      entry.item.graphicNum = 17;
      entry.item.itemLevel = n;
      entry.item.fullName = `Treasure (type ${n})`;
    } else if (type === ShopItemType.CLASS) {
      entry.item = defaultItem();
      entry.item.graphicNum = 105;
      entry.item.specialClass = n;
      entry.item.fullName = `Item of special class ${n}`;
    } else {
      entry.item = defaultItem();
      entry.item.graphicNum = 109;
      entry.item.fullName = HEAL_TYPES[entry.index] ?? '';
    }

    if (type === ShopItemType.SKILL) {
      entry.item.value = Math.trunc((SKILL_GOLD_COST[n as Skill] ?? 0) * 1.5);
    } else if (type >= ShopItemType.HEAL_WOUNDS) {
      entry.item.value = HEAL_COSTS[entry.index] ?? 0;
    }
    entry.quantity = 0;
  }

  /** cShop::addSpecial(name, ...) — a CALL_SPECIAL entry (shop.cpp:242). */
  addCallSpecial(
    name: string, descr: string, pic: number, node: number, cost: number, quantity: number,
  ): void {
    const i = this.firstEmpty();
    this.grow(i);
    const entry = this.items[i]!;
    entry.type = ShopItemType.CALL_SPECIAL;
    entry.quantity = quantity;
    entry.item = shopBaseItem();
    entry.item.fullName = name;
    entry.item.desc = descr;
    entry.item.graphicNum = pic;
    entry.item.itemLevel = node;
    entry.item.value = cost;
  }

  /**
   * cShop::refreshItems (shop.cpp:120) — fill in the real item data from the
   * scenario's item list, which isn't loaded yet when the shop is parsed.
   */
  refreshItems(fromList: Item[]): void {
    for (const entry of this.items) {
      if (entry.type === ShopItemType.ITEM || entry.type === ShopItemType.OPT_ITEM) {
        entry.item = { ...(fromList[entry.index] ?? defaultItem()) };
      }
      // Shops never sell unidentified goods.
      entry.item.ident = true;
    }
  }

  /** cShop::takeOne (shop.cpp:302) — quantity 0 means infinite stock. */
  takeOne(i: number): void {
    const entry = this.items[i];
    if (!entry) return;
    if (entry.quantity === 1) entry.type = ShopItemType.EMPTY;
    else if (entry.quantity > 0) entry.quantity--;
  }

  clone(): Shop {
    const copy = new Shop();
    copy.items = this.items.map((e) => ({ ...e, item: { ...e.item } }));
    copy.costAdj = this.costAdj;
    copy.name = this.name;
    copy.type = this.type;
    copy.prompt = this.prompt;
    copy.face = this.face;
    return copy;
  }
}

/** cShop(eShopPreset) (shop.cpp:63) — the two built-in shops. */
export enum ShopPreset {
  HEALING = 0,
  JUNK = 1,
}

export function presetShop(preset: ShopPreset): Shop {
  const shop = new Shop();
  if (preset === ShopPreset.JUNK) {
    const lootIndex = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4];
    shop.type = ShopType.RANDOM;
    shop.prompt = ShopPrompt.SHOPPING;
    shop.face = 0;
    shop.name = 'Magic Shop';
    for (const loot of lootIndex) shop.addSpecial(ShopItemType.TREASURE, loot);
  } else {
    shop.type = ShopType.ALLOW_DEAD;
    shop.prompt = ShopPrompt.HEALING;
    shop.face = 41;
    shop.name = 'Healing';
    for (const type of [
      ShopItemType.HEAL_WOUNDS, ShopItemType.CURE_POISON, ShopItemType.CURE_DISEASE,
      ShopItemType.CURE_PARALYSIS, ShopItemType.CURE_DUMBFOUNDING, ShopItemType.REMOVE_CURSE,
      ShopItemType.DESTONE, ShopItemType.RAISE_DEAD, ShopItemType.RESURRECT,
    ]) shop.addSpecial(type);
  }
  return shop;
}
