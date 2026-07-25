import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemType } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import {
  Shop, ShopItemType, ShopPreset, ShopPrompt, ShopType, presetShop,
} from '../src/data/shop';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { ShopState, handleSale } from '../src/game/shop';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Skill, Status } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

function newGame(): { univ: Universe; session: GameSession } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startTownMode(0, FORCED_ENTRY);
  return { univ, session };
}

/** A session with `shop` open, bypassing the conversation that normally does it. */
function shopping(shop: Shop): { univ: Universe; state: ShopState } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  return { univ, state: new ShopState(univ, -1, shop) };
}

describe('which entries are on offer', () => {
  it('hides healing services the PC does not need', () => {
    const { univ, state } = shopping(presetShop(ShopPreset.HEALING));
    // A healthy, unafflicted PC needs nothing.
    expect(state.visible).toEqual([]);

    univ.currentPc.curHealth = 1;
    state.setUpArray();
    expect(state.visible.length).toBe(1);
    expect(state.shop.getItem(state.visible[0]!).type).toBe(ShopItemType.HEAL_WOUNDS);

    univ.currentPc.status[Status.POISON] = 3;
    univ.currentPc.mainStatus = MainStatus.DEAD;
    state.setUpArray();
    const types = state.visible.map((i) => state.shop.getItem(i).type);
    expect(types).toContain(ShopItemType.CURE_POISON);
    expect(types).toContain(ShopItemType.RAISE_DEAD);
    expect(types).not.toContain(ShopItemType.RESURRECT);
  });

  it('shows a random shop whatever stock was rolled for it', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const which = scen.shops.findIndex((s) => s.type === ShopType.RANDOM);
    const state = new ShopState(univ, which, scen.shops[which]!.clone());
    // Every visible entry has become a concrete item drawn from the treasure
    // tables, not a TREASURE placeholder.
    expect(state.visible.length).toBeGreaterThan(0);
    for (const i of state.visible) {
      const entry = state.shop.getItem(i);
      expect(entry.type).toBe(ShopItemType.ITEM);
      expect(entry.item.variety).not.toBe(ItemType.NO_ITEM);
      expect(entry.item.fullName.length).toBeGreaterThan(0);
    }
  });

  it('rolls the same stock for a given seed', () => {
    const rolls = () => {
      const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
      univ.rng.seedGame(4242);
      univ.refreshStoreItems();
      const which = scen.shops.findIndex((s) => s.type === ShopType.RANDOM);
      return new ShopState(univ, which, scen.shops[which]!.clone())
        .visible.map((i, n) => univ.storeItem(which, n).fullName);
    };
    expect(rolls()).toEqual(rolls());
  });

  it('pages eight rows at a time', () => {
    const big = scen.shops.find((s) => s.numItems() > 20)!;
    const { state } = shopping(big.clone());
    expect(state.visible.length).toBeGreaterThan(8);
    expect(state.maxScroll).toBe(state.visible.length - 8);
    const firstName = state.rowEntry(0)!.entry.item.fullName;
    state.scrollBy(3);
    expect(state.scroll).toBe(3);
    expect(state.rowEntry(0)!.entry.item.fullName).not.toBe(firstName);
    // Scrolling clamps at both ends.
    state.scrollBy(-99);
    expect(state.scroll).toBe(0);
    state.scrollBy(999);
    expect(state.scroll).toBe(state.maxScroll);
  });
});

describe('buying', () => {
  /** The first scenario item that actually costs something and isn't a stack. */
  function pricedItem(): number {
    return scen.scenItems.findIndex((i) =>
      i.value > 10 && i.charges === 0 && i.variety !== ItemType.NO_ITEM
      && i.variety !== ItemType.GOLD && i.variety !== ItemType.FOOD);
  }

  /** A shop selling one copy of that item at average prices. */
  function oneItemShop(): Shop {
    const shop = new Shop();
    shop.name = 'Test Shop';
    shop.costAdj = 2;
    shop.addItem(pricedItem(), scen.scenItems[pricedItem()]!, 1);
    shop.refreshItems(scen.scenItems);
    return shop;
  }

  it('takes gold and hands over the item', () => {
    const { univ, state } = shopping(oneItemShop());
    const entry = state.shop.getItem(0);
    const cost = state.cost(entry);
    univ.party.gold = cost + 5;
    const before = univ.currentPc.items.filter((i) => i.variety !== ItemType.NO_ITEM).length;

    expect(handleSale(univ, state, 0)).toBe('bought');
    expect(univ.party.gold).toBe(5);
    expect(univ.currentPc.items.filter((i) => i.variety !== ItemType.NO_ITEM).length).toBe(before + 1);
    // That was the only one, so the shelf is bare.
    expect(state.visible).toEqual([]);
  });

  it('refuses when the party is short of gold', () => {
    const { univ, state } = shopping(oneItemShop());
    univ.party.gold = 0;
    expect(handleSale(univ, state, 0)).toBe('refused');
    expect(univ.transcript.at(-1)).toBe('Not enough cash.');
    expect(state.visible).toEqual([0]);
  });

  it('never runs out of infinite stock', () => {
    const shop = new Shop();
    shop.addItem(pricedItem(), scen.scenItems[pricedItem()]!, 0); // 0 means infinite
    shop.refreshItems(scen.scenItems);
    const { univ, state } = shopping(shop);
    univ.party.gold = 30000;
    for (let i = 0; i < 3; i++) expect(handleSale(univ, state, 0)).toBe('bought');
    expect(state.visible).toEqual([0]);
  });

  it('teaches a spell once, and only to a PC who lacks it', () => {
    const shop = new Shop();
    shop.prompt = ShopPrompt.MAGE;
    shop.addSpecial(ShopItemType.MAGE_SPELL, 30);
    const { univ, state } = shopping(shop);
    univ.party.gold = 30000;
    expect(handleSale(univ, state, 0)).toBe('bought');
    expect(univ.currentPc.mageSpells[30]).toBe(true);
    expect(univ.transcript.at(-1)).toBe('You buy a spell.');
    // Buying it again is refused and costs nothing.
    const gold = univ.party.gold;
    expect(handleSale(univ, state, 0)).toBe('refused');
    expect(univ.transcript.at(-1)).toBe('You already have this spell.');
    expect(univ.party.gold).toBe(gold);
  });

  it('trains a skill up to its cap', () => {
    const shop = new Shop();
    shop.addSpecial(ShopItemType.SKILL, Skill.LOCKPICKING);
    const { univ, state } = shopping(shop);
    univ.party.gold = 30000;
    const before = univ.currentPc.skills[Skill.LOCKPICKING]!;
    expect(handleSale(univ, state, 0)).toBe('bought');
    expect(univ.currentPc.skills[Skill.LOCKPICKING]).toBe(before + 1);

    univ.currentPc.skills[Skill.LOCKPICKING] = 20;
    expect(handleSale(univ, state, 0)).toBe('refused');
    expect(univ.transcript.at(-1)).toBe("You're already an expert in this skill.");
  });

  it('heals, cures and resurrects', () => {
    const { univ, state } = shopping(presetShop(ShopPreset.HEALING));
    univ.party.gold = 30000;
    const pc = univ.currentPc;
    pc.curHealth = 1;
    pc.status[Status.POISON] = 5;
    pc.mainStatus = MainStatus.DEAD;
    state.setUpArray();

    const buy = (type: ShopItemType) => {
      const index = state.visible.find((i) => state.shop.getItem(i).type === type);
      expect(index).toBeDefined();
      expect(handleSale(univ, state, index!)).toBe('bought');
    };
    buy(ShopItemType.HEAL_WOUNDS);
    expect(pc.curHealth).toBe(pc.maxHealth);
    buy(ShopItemType.CURE_POISON);
    expect(pc.status[Status.POISON]).toBe(0);
    buy(ShopItemType.RAISE_DEAD);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
    // Nothing left to buy once the PC is whole.
    expect(state.visible).toEqual([]);
  });

  it('learns an alchemy recipe once', () => {
    const shop = new Shop();
    shop.prompt = ShopPrompt.ALCHEMY;
    shop.addSpecial(ShopItemType.ALCHEMY, 3);
    const { univ, state } = shopping(shop);
    univ.party.gold = 30000;
    expect(handleSale(univ, state, 0)).toBe('bought');
    expect(univ.party.alchemy[3]).toBe(true);
    expect(handleSale(univ, state, 0)).toBe('refused');
    expect(univ.transcript.at(-1)).toBe('You already know that recipe.');
  });
});

describe('shop mode', () => {
  it('remembers stock the party has already bought out', () => {
    // Valleydy sells everything from infinite stock, so this needs a shop with
    // a one-off entry: two items, only one of which can run out.
    const limited = new Shop();
    limited.name = 'Limited';
    limited.addItem(3, scen.scenItems[3]!, 1);
    limited.addItem(4, scen.scenItems[4]!, 0);
    limited.refreshItems(scen.scenItems);
    const which = scen.shops.push(limited) - 1;
    try {
      const { univ, session } = newGame();
      univ.party.gold = 30000;
      expect(session.startShopMode(which, 2, 'Limited')).toBe(true);
      expect(session.shop!.visible).toEqual([0, 1]);
      session.buyShopRow(0);
      session.endShopMode();

      // Re-entering, the one-off is gone and the infinite entry remains.
      expect(session.startShopMode(which, 2, 'Limited')).toBe(true);
      expect(session.shop!.visible).toEqual([1]);
    } finally {
      scen.shops.length = which;
    }
  });

  it('refuses to open a shop with nothing on offer', () => {
    const { session } = newGame();
    const empty = scen.shops.findIndex((s) => s.numItems() === 0);
    expect(session.startShopMode(empty, 2, 'Unused')).toBe(false);
    expect(session.mode).toBe(GameMode.TOWN);
    expect(session.shop).toBeNull();
  });

  it('reports a shop that does not exist', () => {
    const { univ, session } = newGame();
    expect(session.startShopMode(999, 0, 'Nowhere')).toBe(false);
    expect(univ.transcript.at(-1)).toContain('nonexistent shop');
  });

  it('picks another PC when a healer has nothing for the active one', () => {
    const { univ, session } = newGame();
    // Give the healing shop something to do — for PC 3 only.
    const healerIndex = scen.shops.findIndex((s) => s.prompt === ShopPrompt.HEALING);
    univ.curPc = 0;
    univ.party.pcs[3]!.curHealth = 1;
    expect(session.startShopMode(healerIndex, 2, 'Healing')).toBe(false);
    expect(session.startShopModeAnyPc(healerIndex, 2, 'Healing')).toBe(true);
    expect(univ.curPc).toBe(3);
  });

  it('returns to town mode when the shop closes', () => {
    const { session } = newGame();
    const which = scen.shops.findIndex((s) => s.numItems() > 0);
    expect(session.startShopMode(which, 2, 'Test')).toBe(true);
    expect(session.mode).toBe(GameMode.SHOPPING);
    // The party is still standing in the town while the shop is up.
    expect(session.inTown).toBe(true);
    session.endShopMode();
    expect(session.mode).toBe(GameMode.TOWN);
  });
});
