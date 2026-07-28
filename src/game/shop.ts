/**
 * Shopping mode — start_shop_mode (boe.dlgutil.cpp:160), set_up_shop_array
 * (:574) and handle_sale (:333).
 *
 * A shop's stock is a fixed list of entries, but only some are on offer at any
 * moment: a healer only shows the cures the current PC needs, and a random
 * "magic shop" shows whatever its rolled stock happens to be. `visible` is that
 * filtered view (shop_array in the C++), and everything the UI does is indexed
 * through it.
 */

import { QuestStatus } from '../data/quest';
import { Item, ItemAbil, ItemType, interestingString } from '../data/item';
import { alchemyRecipe } from '../data/alchemy';
import {
  SKILL_MAX, Shop, ShopItem, ShopItemType, ShopPrompt, ShopType, shopItemCost,
} from '../data/shop';
import { getStr } from '../data/strings';
import { SoundPlayer, Snd } from '../platform/sound';
import { GiveStatus, giveItem } from '../universe/inventory';
import { NUM_INVEN_SLOTS } from '../universe/player';
import { MainStatus, Skill, Status } from '../universe/skills';
import { Universe } from '../universe/universe';

/** How many entries fit on screen at once. */
export const SHOP_ROWS = 8;

/** Letter shortcuts for the visible rows — shop_chars (boe.actions.cpp:2791). */
export const SHOP_CHARS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** The prices-are-X blurb (boe.newgraph.cpp:710). */
export const COST_STRINGS = [
  'Extremely Cheap', 'Very Reasonable', 'Pretty Average', 'Somewhat Pricey',
  'Expensive', 'Exorbitant', 'Utterly Ridiculous',
];

export class ShopState {
  /** Which scenario shop this is; -1 for a shop built on the fly. */
  readonly shopNum: number;
  /** A working copy: buying reduces stock without editing the scenario. */
  readonly shop: Shop;
  /** Entry indices currently on offer (shop_array). */
  visible: number[] = [];
  /** First visible row — the scrollbar position. */
  scroll = 0;

  constructor(private univ: Universe, shopNum: number, shop: Shop) {
    this.shopNum = shopNum;
    this.shop = shop;
    this.setUpArray();
  }

  get name(): string {
    return this.shop.name;
  }

  get costAdj(): number {
    return this.shop.costAdj;
  }

  /** The title line above the stock (draw_shop_graphics, :777). */
  get title(): string {
    const who = this.univ.currentPc.name;
    switch (this.shop.prompt) {
      case ShopPrompt.HEALING: return `Healing for ${who}.`;
      case ShopPrompt.MAGE: return `Mage Spells for ${who}.`;
      case ShopPrompt.PRIEST: return `Priest Spells for ${who}.`;
      case ShopPrompt.SPELLS: return `Spells for ${who}.`;
      case ShopPrompt.TRAINING: return `Training for ${who}.`;
      case ShopPrompt.ALCHEMY: return 'Buying Alchemy.';
      default: return `Shopping for ${who}.`;
    }
  }

  get maxScroll(): number {
    return Math.max(0, this.visible.length - SHOP_ROWS);
  }

  /** The entry shown on a given screen row, or null past the end. */
  rowEntry(row: number): { index: number; entry: ShopItem } | null {
    const index = this.visible[row + this.scroll];
    if (index === undefined) return null;
    const entry = this.shop.getItem(index);
    if (entry.type === ShopItemType.EMPTY) return null;
    return { index, entry };
  }

  cost(entry: ShopItem): number {
    return shopItemCost(entry, this.shop.costAdj);
  }

  scrollBy(delta: number): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + delta));
  }

  /**
   * set_up_shop_array (boe.dlgutil.cpp:574). Healing entries only show when the
   * PC actually needs them, and the three random types resolve to the stock
   * that was rolled for this shop.
   */
  setUpArray(): void {
    const pc = this.univ.currentPc;
    this.visible = [];
    for (let j = 0; j < this.shop.size; j++) {
      const entry = this.shop.getItem(j);
      switch (entry.type) {
        case ShopItemType.ITEM:
        case ShopItemType.MAGE_SPELL:
        case ShopItemType.PRIEST_SPELL:
        case ShopItemType.ALCHEMY:
        case ShopItemType.SKILL:
          this.visible.push(j);
          break;
        case ShopItemType.HEAL_WOUNDS:
          if (pc.curHealth < pc.maxHealth) this.visible.push(j);
          break;
        case ShopItemType.CURE_POISON:
          if (pc.status[Status.POISON]! > 0) this.visible.push(j);
          break;
        case ShopItemType.CURE_DISEASE:
          if (pc.status[Status.DISEASE]! > 0) this.visible.push(j);
          break;
        case ShopItemType.CURE_ACID:
          if (pc.status[Status.ACID]! > 0) this.visible.push(j);
          break;
        case ShopItemType.CURE_PARALYSIS:
          if (pc.status[Status.PARALYZED]! > 0) this.visible.push(j);
          break;
        case ShopItemType.CURE_DUMBFOUNDING:
          if (pc.status[Status.DUMB]! > 0) this.visible.push(j);
          break;
        case ShopItemType.DESTONE:
          if (pc.mainStatus === MainStatus.STONE) this.visible.push(j);
          break;
        case ShopItemType.RAISE_DEAD:
          if (pc.mainStatus === MainStatus.DEAD) this.visible.push(j);
          break;
        case ShopItemType.RESURRECT:
          if (pc.mainStatus === MainStatus.DUST) this.visible.push(j);
          break;
        case ShopItemType.REMOVE_CURSE:
          for (let i = 0; i < NUM_INVEN_SLOTS; i++)
            if (pc.equip[i] && pc.items[i]!.cursed) { this.visible.push(j); break; }
          break;
        case ShopItemType.CALL_SPECIAL:
          // The entry names an SDF that gates whether it's for sale.
          if (this.univ.party.getSdf(entry.item.abilStrength, entry.item.abilData) > 0)
            this.visible.push(j);
          break;
        case ShopItemType.OPT_ITEM:
        case ShopItemType.TREASURE:
        case ShopItemType.CLASS: {
          // An optional item's chance lives in the thousands place; strip it.
          if (entry.type === ShopItemType.OPT_ITEM) entry.quantity %= 1000;
          // Random stock: what was rolled for this slot, if anything.
          entry.type = ShopItemType.ITEM;
          entry.item = this.univ.storeItem(this.shopNum, j);
          if (entry.item.variety === ItemType.NO_ITEM) entry.type = ShopItemType.EMPTY;
          else this.visible.push(j);
          entry.quantity = 1;
          this.shop.replaceItem(j, entry);
          break;
        }
        case ShopItemType.EMPTY:
          break;
      }
    }
    if (this.scroll > this.maxScroll) this.scroll = this.maxScroll;
  }

  /** The small grey line under an entry's name (draw_shop_graphics, :820). */
  extraInfo(entry: ShopItem): string {
    switch (entry.type) {
      case ShopItemType.ITEM:
        return interestingString(entry.item);
      case ShopItemType.ALCHEMY: {
        // The recipe's ingredients, named out of the item-abilities table.
        //
        // *Gotcha, kept*: the C++ looks them up at `int(ingredient) + 1`
        // (boe.newgraph.cpp:827) where the table is 1-based and the editor's
        // own lookup uses no offset — so every ingredient is named one line
        // late, and a holly recipe advertises comfrey root. The names are a
        // hint, not a rule; the recipe itself uses the right plant.
        const info = alchemyRecipe(entry.item.itemLevel);
        if (!info) return '';
        let line = getStr('item-abilities', info.ingred1 + 1);
        if (info.ingred2 !== ItemAbil.NONE)
          line += ` & ${getStr('item-abilities', info.ingred2 + 1)}`;
        return line;
      }
      case ShopItemType.MAGE_SPELL:
      case ShopItemType.PRIEST_SPELL: {
        const table = entry.type === ShopItemType.MAGE_SPELL ? 'mage-spells' : 'priest-spells';
        // TODO(M5): cSpell knows the real level and SP cost; the strings file
        // only gives us the spell's own blurb until the spell table lands.
        const blurb = getStr(table, entry.item.itemLevel * 2 + 2);
        return blurb;
      }
      case ShopItemType.SKILL:
        return 'Increase skill by 1';
      default:
        return '';
    }
  }
}

export type SaleResult = 'bought' | 'refused' | 'unsupported';

/**
 * handle_sale (boe.dlgutil.cpp:333) — buy the entry at `index`. Messages go to
 * the transcript exactly as the C++ prints them.
 */
export function handleSale(
  univ: Universe,
  state: ShopState,
  index: number,
  sound?: SoundPlayer | null,
): SaleResult {
  const entry = state.shop.getItem(index);
  const item = entry.item;
  const cost = state.cost(entry);
  const pc = univ.currentPc;
  const say = (line: string) => univ.addStringToBuf(line);

  /** take_gold(cost, false) — pay only if the party can. */
  const takeGold = (): boolean => {
    if (univ.party.gold < cost) return false;
    univ.party.gold -= cost;
    return true;
  };

  switch (entry.type) {
    case ShopItemType.EMPTY:
    case ShopItemType.TREASURE:
    case ShopItemType.CLASS:
    case ShopItemType.OPT_ITEM:
      return 'refused';

    case ShopItemType.ITEM: {
      const status = okToBuy(univ, cost, item);
      if (status !== 'ok') {
        if (status === 'need-gold') say('Not enough cash.');
        else if (status === 'no-space') say("Can't carry any more items.");
        else if (status === 'too-heavy') say('Item is too heavy.');
        else if (item.variety === ItemType.SPECIAL) say('You already own this.');
        else if (item.variety === ItemType.QUEST) say('You already completed this.');
        else say('You own too many of this.');
        return 'refused';
      }
      sound?.play(-38);
      univ.party.gold -= cost;
      const result = giveItem(pc, univ.party, { ...item });
      if (result.message) say(result.message);
      state.shop.takeOne(index);
      break;
    }

    case ShopItemType.ALCHEMY:
      if (univ.party.alchemy[item.itemLevel]) {
        say('You already know that recipe.');
        return 'refused';
      }
      if (!takeGold()) {
        say('Not enough gold.');
        return 'refused';
      }
      sound?.play(8);
      say('You buy an alchemical recipe.');
      univ.party.alchemy[item.itemLevel] = true;
      break;

    case ShopItemType.MAGE_SPELL:
    case ShopItemType.PRIEST_SPELL: {
      const isMage = entry.type === ShopItemType.MAGE_SPELL;
      const book = isMage ? pc.mageSpells : pc.priestSpells;
      if (item.itemLevel < 0 || item.itemLevel > 61) {
        say('The scenario tried to sell you an invalid spell!');
        return 'refused';
      }
      if (book[item.itemLevel]) {
        say('You already have this spell.');
        return 'refused';
      }
      if (!takeGold()) {
        say('Not enough gold.');
        return 'refused';
      }
      sound?.play(isMage ? 25 : 24);
      say('You buy a spell.');
      book[item.itemLevel] = true;
      break;
    }

    case ShopItemType.SKILL: {
      if (item.itemLevel < 0 || item.itemLevel > 18) {
        say('The scenario tried to sell you an invalid skill!');
        return 'refused';
      }
      const skill = item.itemLevel as Skill;
      if ((pc.skills[skill] ?? 0) >= (SKILL_MAX[skill] ?? 0)) {
        say("You're already an expert in this skill.");
        return 'refused';
      }
      if (!takeGold()) {
        say('Not enough gold.');
        return 'refused';
      }
      sound?.play(7);
      say('You learn a little...');
      state.shop.takeOne(index);
      pc.skills[skill] = (pc.skills[skill] ?? 0) + 1;
      break;
    }

    case ShopItemType.CALL_SPECIAL:
      // TODO(M4): run_special(SHOPPING, ...) decides whether the sale goes
      // through; until the specials VM exists nothing can be bought here.
      say('(Shop services that run a special are not implemented yet)');
      return 'unsupported';

    default: {
      // Every healing service.
      if (!takeGold()) {
        say('Not enough gold.');
        return 'refused';
      }
      say('You pay the healer.');
      sound?.play(68);
      applyHealing(univ, entry.type);
      break;
    }
  }

  // The last of something may have just sold, so recompute what's on offer.
  state.setUpArray();
  return 'bought';
}

function applyHealing(univ: Universe, type: ShopItemType): void {
  const pc = univ.currentPc;
  switch (type) {
    case ShopItemType.HEAL_WOUNDS: pc.curHealth = pc.maxHealth; break;
    case ShopItemType.CURE_POISON: pc.status[Status.POISON] = 0; break;
    case ShopItemType.CURE_DISEASE: pc.status[Status.DISEASE] = 0; break;
    case ShopItemType.CURE_ACID: pc.status[Status.ACID] = 0; break;
    case ShopItemType.CURE_PARALYSIS: pc.status[Status.PARALYZED] = 0; break;
    case ShopItemType.REMOVE_CURSE:
      for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
        if (pc.equip[i] && pc.items[i]!.cursed) {
          pc.items[i]!.cursed = false;
          pc.items[i]!.unsellable = false;
        }
      }
      break;
    case ShopItemType.DESTONE:
    case ShopItemType.RAISE_DEAD:
    case ShopItemType.RESURRECT:
      pc.mainStatus = MainStatus.ALIVE;
      break;
    case ShopItemType.CURE_DUMBFOUNDING:
      if (pc.status[Status.DUMB]! > 0) pc.status[Status.DUMB] = 0;
      break;
    default:
      break;
  }
}

export type BuyStatus = 'ok' | 'no-space' | 'need-gold' | 'too-heavy' | 'have-lots';

/** cPlayer::ok_to_buy (pc.cpp:894). */
export function okToBuy(univ: Universe, cost: number, item: Item): BuyStatus {
  const pc = univ.currentPc;
  if (item.variety === ItemType.SPECIAL) {
    if (univ.party.specItems.has(item.itemLevel)) return 'have-lots';
  } else if (item.variety === ItemType.QUEST) {
    // A quest already taken (or finished, or failed) can't be bought again.
    const job = univ.party.activeQuests.get(item.itemLevel);
    if (job && job.status !== QuestStatus.AVAILABLE) return 'have-lots';
  } else if (item.variety !== ItemType.GOLD && item.variety !== ItemType.FOOD) {
    for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
      const held = pc.items[i]!;
      if (held.variety !== ItemType.NO_ITEM && held.typeFlag === item.typeFlag
        && held.charges > 123) return 'have-lots';
    }
    // give_item in check-only mode: is there room and spare capacity?
    const check = giveItem(pc, univ.party, item, true).status;
    if (check === GiveStatus.NO_SPACE) return 'no-space';
    if (check === GiveStatus.TOO_HEAVY) return 'too-heavy';
    if (check === GiveStatus.DEAD) return 'no-space';
  }
  if (cost > univ.party.gold) return 'need-gold';
  return 'ok';
}

/**
 * Whether a shop is one the current PC can use at all — a healing shop with
 * nothing the PC needs is empty, and the C++ then tries the other PCs
 * (start_shop_mode_other_pc, boe.dlgutil.cpp:132).
 */
export function shopAllowsDead(shop: Shop): boolean {
  return shop.type === ShopType.ALLOW_DEAD;
}
