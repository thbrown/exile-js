/**
 * Carrying, equipping and dropping items — the parts of cPlayer that deal with
 * its 24 inventory slots: give_item (pc.cpp:447), equip_item (:590),
 * unequip_item (:634), max_weight (:674) and cur_weight (:679), plus
 * cItem::item_weight (item.cpp:99).
 */

import { makeJob } from '../data/quest';
import { Item, ItemAbil, ItemType, defaultItem } from '../data/item';
import { ItemCat, variety } from '../data/itemVariety';
import { Party } from './party';
import { NUM_INVEN_SLOTS, Player } from './player';
import { MainStatus, Skill, Trait } from './skills';

export enum GiveStatus {
  OK = 'ok',
  DEAD = 'dead',
  NO_SPACE = 'no-space',
  TOO_HEAVY = 'too-heavy',
}

/** cItem::item_weight — stacks of ammo and potions weigh per charge. */
export function itemWeight(item: Item): number {
  if (item.variety === ItemType.NO_ITEM) return 0;
  if (item.charges > 0) {
    switch (item.variety) {
      case ItemType.ARROW:
      case ItemType.THROWN_MISSILE:
      case ItemType.POTION:
      case ItemType.BOLTS:
        return item.charges * item.weight;
      default:
        break;
    }
  }
  return item.weight;
}

/** cPlayer::max_weight. */
export function maxWeight(pc: Player): number {
  return (
    100 +
    15 * Math.min(pc.skills[Skill.STRENGTH] ?? 0, 20) +
    (pc.traits[Trait.STRENGTH] ? 30 : 0) +
    (pc.traits[Trait.BAD_BACK] ? -50 : 0)
  );
}

/** cPlayer::cur_weight — two abilities shift the total by a flat 30. */
export function curWeight(pc: Player): number {
  let weight = 0;
  let airy = false;
  let heavy = false;
  for (const item of pc.items) {
    if (item.variety === ItemType.NO_ITEM) continue;
    weight += itemWeight(item);
    if (item.ability === ItemAbil.LIGHTER_OBJECT) airy = true;
    if (item.ability === ItemAbil.HEAVIER_OBJECT) heavy = true;
  }
  if (airy) weight -= 30;
  if (heavy) weight += 30;
  return weight;
}

export function freeWeight(pc: Player): number {
  return maxWeight(pc) - curWeight(pc);
}

/** The first empty inventory slot, or -1. */
export function firstFreeSlot(pc: Player): number {
  return pc.items.findIndex((item) => item.variety === ItemType.NO_ITEM);
}

export interface GiveResult {
  status: GiveStatus;
  /** The slot the item landed in, or -1 for party-level items and failures. */
  slot: number;
  /** What to print, when the caller asked for a message. */
  message: string;
}

/**
 * cPlayer::give_item. Gold, food, special items and quests go to the party
 * rather than a slot; everything else needs both spare capacity and a slot.
 *
 * With `checkOnly` (GIVE_CHECK_ONLY) nothing changes hands — the caller just
 * wants to know whether it could, which is how ok_to_buy tests a purchase.
 *
 * TODO(M6): combine_things stacks matching ammo/potions into one slot, which
 * lets a full pack still accept more arrows.
 */
export function giveItem(
  pc: Player, party: Party, item: Item, checkOnly = false,
): GiveResult {
  if (pc.mainStatus !== MainStatus.ALIVE)
    return { status: GiveStatus.DEAD, slot: -1, message: '' };
  if (item.variety === ItemType.NO_ITEM)
    return { status: GiveStatus.OK, slot: -1, message: '' };

  switch (item.variety) {
    case ItemType.GOLD:
      if (!checkOnly) party.gold += item.itemLevel;
      return { status: GiveStatus.OK, slot: -1, message: 'You get some gold.' };
    case ItemType.FOOD:
      if (!checkOnly) party.food += item.itemLevel;
      return { status: GiveStatus.OK, slot: -1, message: 'You get some food.' };
    case ItemType.SPECIAL:
      if (!checkOnly) party.specItems.add(item.itemLevel);
      return { status: GiveStatus.OK, slot: -1, message: 'You get a special item.' };
    case ItemType.QUEST:
      // Picking up a quest item *starts* that quest, dated today.
      if (!checkOnly) party.activeQuests.set(item.itemLevel, makeJob(party.calcDay()));
      return { status: GiveStatus.OK, slot: -1, message: 'You get a quest.' };
    default:
      break;
  }

  if (itemWeight(item) > freeWeight(pc))
    return { status: GiveStatus.TOO_HEAVY, slot: -1, message: 'Item too heavy to carry.' };

  const slot = firstFreeSlot(pc);
  if (slot < 0) return { status: GiveStatus.NO_SPACE, slot: -1, message: 'No room for item.' };

  // Taking an item clears the flags that only apply while it's on the floor.
  if (!checkOnly) pc.items[slot] = { ...item, property: false, contained: false, held: false };
  const name = item.ident ? item.fullName : item.name;
  return { status: GiveStatus.OK, slot, message: `  ${pc.name} gets ${name}.` };
}

/** Whether the party as a whole could take this item. */
export function partyCanTake(party: Party, item: Item): boolean {
  return party.pcs.some((pc) => {
    if (pc.mainStatus !== MainStatus.ALIVE) return false;
    switch (item.variety) {
      case ItemType.GOLD:
      case ItemType.FOOD:
      case ItemType.SPECIAL:
      case ItemType.QUEST:
        return true;
      default:
        return itemWeight(item) <= freeWeight(pc) && firstFreeSlot(pc) >= 0;
    }
  });
}

export interface EquipResult {
  ok: boolean;
  message: string;
}

/** cPlayer::equip_item. */
export function equipItem(pc: Player, slot: number): EquipResult {
  const item = pc.items[slot];
  if (!item) return { ok: false, message: 'Equip: Can\'t equip this item.' };
  const info = variety(item.variety);
  if (info.equipCount === 0) return { ok: false, message: "Equip: Can't equip this item." };

  let numThisType = 0;
  let handsOccupied = 0;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (!pc.equip[i]) continue;
    if (pc.items[i]!.variety === item.variety) numThisType++;
    handsOccupied += variety(pc.items[i]!.variety).numHands;
  }

  // Only one missile weapon and one kind of ammo at a time.
  if (info.exclusion === ItemCat.MISSILE_AMMO || info.exclusion === ItemCat.MISSILE_WEAPON) {
    for (let i = 0; i < NUM_INVEN_SLOTS; i++)
      if (pc.equip[i] && variety(pc.items[i]!.variety).exclusion === info.exclusion)
        return { ok: false, message: 'Equip: You have something of this type equipped.' };
  }

  if (2 - handsOccupied < info.numHands)
    return { ok: false, message: 'Equip: Not enough free hands' };
  if (info.equipCount <= numThisType)
    return { ok: false, message: "Equip: Can't equip another" };

  pc.equip[slot] = true;
  return { ok: true, message: 'Equip: OK' };
}

/** cPlayer::unequip_item. */
export function unequipItem(pc: Player, slot: number): EquipResult {
  if (!pc.equip[slot]) return { ok: false, message: 'Equip: Not equipped' };
  if (pc.items[slot]!.cursed) return { ok: false, message: 'Equip: Item is cursed.' };
  pc.equip[slot] = false;
  return { ok: true, message: 'Equip: Unequipped' };
}

/**
 * cPlayer::has_abil_equip (pc.cpp:...) — the first equipped item with an
 * ability. `dat` narrows to abilities that carry a parameter (which status a
 * ring protects against, which stat an item boosts); -1 means "any".
 */
export function hasAbilEquip(
  pc: Player, abil: ItemAbil, dat = -1,
): { slot: number; item: Item } | null {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (!pc.equip[i] || item.variety === ItemType.NO_ITEM) continue;
    if (item.ability !== abil) continue;
    if (dat >= 0 && dat !== item.abilData) continue;
    return { slot: i, item };
  }
  return null;
}

/**
 * cPlayer::get_prot_level (pc.cpp:...) — the *summed* strength of every
 * equipped item with this ability. Two rings of protection stack; the status
 * methods divide the total down before subtracting it from an effect.
 */
export function getProtLevel(pc: Player, abil: ItemAbil, dat = -1): number {
  let sum = 0;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (!pc.equip[i] || item.variety === ItemType.NO_ITEM) continue;
    if (item.ability !== abil) continue;
    if (dat >= 0 && dat !== item.abilData) continue;
    sum += item.abilStrength;
  }
  return sum;
}

/**
 * cPlayer::take_item (pc.cpp:916) — empty a slot. The pack has no holes in it:
 * everything below the slot shifts up, which is why the inventory list always
 * reads as a contiguous run.
 *
 * TODO(M5): a poisoned weapon loses its poison here, and the poisoned-slot
 * index shifts with the rest.
 */
export function takeItem(pc: Player, slot: number): void {
  for (let i = slot; i < NUM_INVEN_SLOTS - 1; i++) {
    pc.items[i] = pc.items[i + 1]!;
    pc.equip[i] = pc.equip[i + 1]!;
  }
  pc.items[NUM_INVEN_SLOTS - 1] = defaultItem();
  pc.equip[NUM_INVEN_SLOTS - 1] = false;
}

/** Remove an item from a slot, unequipping it first; cursed gear won't go. */
export function takeItemFrom(pc: Player, slot: number): Item | null {
  const item = pc.items[slot];
  if (!item || item.variety === ItemType.NO_ITEM) return null;
  if (item.cursed && pc.equip[slot]) return null;
  pc.equip[slot] = false;
  takeItem(pc, slot);
  return item;
}

/**
 * cPlayer::remove_charge (pc.cpp:938) — spend one use. An item that runs out
 * and can't be recharged is gone; a rechargeable one stays in the pack at zero
 * so a shop can fill it again.
 */
export function removeCharge(pc: Player, slot: number): void {
  const item = pc.items[slot];
  if (!item || item.charges <= 0) return;
  item.charges--;
  if (item.charges === 0 && !item.rechargeable) takeItem(pc, slot);
}
