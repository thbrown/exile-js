/**
 * The four shop services that work on the party's own goods rather than on a
 * shop's stock: selling, identifying, enchanting and recharging. They put the
 * inventory panel into a mode (stat_screen_mode) where each eligible item grows
 * an extra button with a price on it.
 *
 * Ports place_item_button's mode switch (boe.text.cpp:410) for eligibility and
 * prices, and handle_item_shop_action (boe.actions.cpp:1150) for the sale.
 */

import { Item, ItemAbil, ItemType } from '../data/item';
import { variety } from '../data/itemVariety';
import { SoundPlayer } from '../platform/sound';
import { takeItem } from '../universe/inventory';
import { Player } from '../universe/player';
import { Universe } from '../universe/universe';

/** eItemWinMode's shop half (boe.consts.hpp) — MODE_IDENTIFY and up. */
export enum ItemShopMode {
  IDENTIFY = 'identify',
  RECHARGE = 'recharge',
  SELL_WEAPONS = 'sell-weapons',
  SELL_ARMOR = 'sell-armor',
  SELL_ANY = 'sell-any',
  ENCHANT = 'enchant',
}

export interface ItemShopState {
  mode: ItemShopMode;
  /** shop_identify_cost — also the enchantment type, and the recharge price. */
  cost: number;
  /** shop_recharge_limit: 0 means "any wand", n means "below max/n charges". */
  rechargeLimit: number;
  /** shop_recharge_amount. */
  rechargeAmount: number;
}

/** The panel's title line for each mode (put_item_screen). */
export const ITEM_SHOP_TITLES: Record<ItemShopMode, string> = {
  [ItemShopMode.IDENTIFY]: 'Identify which item?',
  [ItemShopMode.RECHARGE]: 'Recharge which item?',
  [ItemShopMode.SELL_WEAPONS]: 'Sell which weapon?',
  [ItemShopMode.SELL_ARMOR]: 'Sell which armor?',
  [ItemShopMode.SELL_ANY]: 'Sell which item?',
  [ItemShopMode.ENCHANT]: 'Enchant which weapon?',
};

/** Which of the four spec-button icons a mode uses (button_sources). */
export function specIcon(mode: ItemShopMode): 'identify' | 'sell' | 'enchant' | 'recharge' {
  switch (mode) {
    case ItemShopMode.IDENTIFY: return 'identify';
    case ItemShopMode.RECHARGE: return 'recharge';
    case ItemShopMode.ENCHANT: return 'enchant';
    default: return 'sell';
  }
}

/** cItem::can_use — whether an item has a usable ability at all. */
function canUse(item: Item): boolean {
  return item.ability >= ItemAbil.POISON_WEAPON;
}

/**
 * The price shown on an item's spec button, or null when the service doesn't
 * apply to it. Half value is the standard resale rate (boe.text.cpp:405).
 */
export function specPrice(state: ItemShopState, pc: Player, slot: number): number | null {
  const item = pc.items[slot];
  if (!item || item.variety === ItemType.NO_ITEM) return null;
  const resale = Math.trunc((item.charges > 0 ? item.charges * item.value : item.value) / 2);
  const sellable = !pc.equip[slot] && item.ident && resale > 0 && !item.unsellable;

  switch (state.mode) {
    case ItemShopMode.IDENTIFY:
      return item.ident ? null : state.cost;
    case ItemShopMode.RECHARGE:
      if (!item.rechargeable || !canUse(item)) return null;
      if (state.rechargeLimit !== 0
        && item.charges >= Math.trunc(item.maxCharges / state.rechargeLimit)) return null;
      return state.cost;
    case ItemShopMode.SELL_WEAPONS:
      return sellable && variety(item.variety).isWeapon ? resale : null;
    case ItemShopMode.SELL_ARMOR:
      return sellable && variety(item.variety).isArmour ? resale : null;
    case ItemShopMode.SELL_ANY:
      return sellable ? resale : null;
    case ItemShopMode.ENCHANT:
      if (item.variety !== ItemType.ONE_HANDED && item.variety !== ItemType.TWO_HANDED) return null;
      if (!item.ident || item.ability !== ItemAbil.NONE || item.magic) return null;
      // TODO(M5): eEnchant::adjust_value scales with the enchantment; until the
      // enchantment table lands the node's own cost stands in.
      return state.cost;
    default:
      return null;
  }
}

export type ItemShopResult = 'done' | 'refused' | 'unsupported';

/** handle_item_shop_action (boe.actions.cpp:1150). */
export function handleItemShopAction(
  univ: Universe,
  state: ItemShopState,
  pcNum: number,
  slot: number,
  sound?: SoundPlayer | null,
): ItemShopResult {
  const pc = univ.party.pcs[pcNum];
  if (!pc) return 'refused';
  const price = specPrice(state, pc, slot);
  if (price === null) return 'refused';
  const item = pc.items[slot]!;
  const say = (line: string) => univ.addStringToBuf(line);
  const takeGold = (cost: number): boolean => {
    if (univ.party.gold < cost) return false;
    univ.party.gold -= cost;
    return true;
  };

  switch (state.mode) {
    case ItemShopMode.IDENTIFY:
      if (!takeGold(price)) {
        say("Identify: You don't have the gold.");
        return 'refused';
      }
      sound?.play(68);
      say('Your item is identified.');
      item.ident = true;
      return 'done';

    case ItemShopMode.RECHARGE: {
      if (!takeGold(price)) {
        say("Recharge: You don't have the gold.");
        return 'refused';
      }
      if (price === 0) {
        // A free recharge risks melting the item, the more so the fuller it is.
        const meltChance = [0, 1, 1, 1, 3, 3, 5, 15, 30, 50, 80];
        const n = meltChance.length;
        let i = Math.trunc(Math.round(item.charges * (n - 1)) / (item.maxCharges || 1));
        i = Math.max(0, Math.min(n - 1, i));
        if (univ.rng.getRan(1, 1, 100) < meltChance[i]!) {
          sound?.play(41);
          say('Your item melted!');
          takeItem(pc, slot);
          return 'done';
        }
      }
      sound?.play(68);
      say('Your item is recharged.');
      item.charges += state.rechargeAmount;
      return 'done';
    }

    case ItemShopMode.SELL_WEAPONS:
    case ItemShopMode.SELL_ARMOR:
    case ItemShopMode.SELL_ANY:
      sound?.play(-39);
      univ.party.gold += price;
      say('You sell your item.');
      takeItem(pc, slot);
      return 'done';

    case ItemShopMode.ENCHANT:
      // TODO(M5): enchant_weapon needs the enchantment table.
      say('(Enchanting is not implemented yet)');
      return 'unsupported';

    default:
      return 'refused';
  }
}
