import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemAbil, ItemType, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { TalkNodeType } from '../src/data/talking';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { ItemShopMode, handleItemShopAction, specPrice } from '../src/game/itemShop';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
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

/** Put a specific item in the first PC's first slot. */
function withItem(patch: Partial<ReturnType<typeof defaultItem>>) {
  const { univ, session } = newGame();
  univ.party.pcs[0]!.items[0] = { ...defaultItem(), ...patch };
  return { univ, session, pc: univ.party.pcs[0]! };
}

const SWORD = {
  variety: ItemType.ONE_HANDED, value: 100, ident: true, fullName: 'Sword', itemLevel: 6,
};
const ARMOUR = { variety: ItemType.ARMOR, value: 80, ident: true, fullName: 'Mail' };

describe('which items a service applies to', () => {
  const state = (mode: ItemShopMode, cost = 50) =>
    ({ mode, cost, rechargeLimit: 0, rechargeAmount: 0 });

  it('sells at half value, and only what is unequipped and identified', async () => {
    const { pc } = withItem(SWORD);
    expect(specPrice(state(ItemShopMode.SELL_ANY), pc, 0)).toBe(50);

    pc.equip[0] = true;
    expect(specPrice(state(ItemShopMode.SELL_ANY), pc, 0)).toBeNull();
    pc.equip[0] = false;

    pc.items[0]!.ident = false;
    expect(specPrice(state(ItemShopMode.SELL_ANY), pc, 0)).toBeNull();
    pc.items[0]!.ident = true;

    pc.items[0]!.unsellable = true;
    expect(specPrice(state(ItemShopMode.SELL_ANY), pc, 0)).toBeNull();
  });

  it('separates the weapon and armour dealers', async () => {
    const { pc } = withItem(SWORD);
    expect(specPrice(state(ItemShopMode.SELL_WEAPONS), pc, 0)).toBe(50);
    expect(specPrice(state(ItemShopMode.SELL_ARMOR), pc, 0)).toBeNull();

    pc.items[0] = { ...defaultItem(), ...ARMOUR };
    expect(specPrice(state(ItemShopMode.SELL_WEAPONS), pc, 0)).toBeNull();
    expect(specPrice(state(ItemShopMode.SELL_ARMOR), pc, 0)).toBe(40);
  });

  it('prices a stack of charges per charge', async () => {
    const { pc } = withItem({ ...SWORD, variety: ItemType.POTION, value: 10, charges: 5 });
    expect(specPrice(state(ItemShopMode.SELL_ANY), pc, 0)).toBe(25);
  });

  it('identifies only what is unidentified, at the shop price', async () => {
    const { pc } = withItem({ ...SWORD, ident: false });
    expect(specPrice(state(ItemShopMode.IDENTIFY, 37), pc, 0)).toBe(37);
    pc.items[0]!.ident = true;
    expect(specPrice(state(ItemShopMode.IDENTIFY, 37), pc, 0)).toBeNull();
  });

  it('recharges only rechargeable, usable items below the limit', async () => {
    const { pc } = withItem({
      variety: ItemType.WAND, value: 100, ident: true, rechargeable: true,
      ability: ItemAbil.CALL_SPECIAL, charges: 2, maxCharges: 10,
    });
    const wand = { mode: ItemShopMode.RECHARGE, cost: 20, rechargeLimit: 0, rechargeAmount: 3 };
    expect(specPrice(wand, pc, 0)).toBe(20);

    // limit 2 means "only below half charges".
    expect(specPrice({ ...wand, rechargeLimit: 2 }, pc, 0)).toBe(20);
    pc.items[0]!.charges = 8;
    expect(specPrice({ ...wand, rechargeLimit: 2 }, pc, 0)).toBeNull();

    pc.items[0]!.rechargeable = false;
    expect(specPrice(wand, pc, 0)).toBeNull();
  });

  it('enchants only plain, identified melee weapons', async () => {
    const { pc } = withItem(SWORD);
    const ench = { mode: ItemShopMode.ENCHANT, cost: 200, rechargeLimit: 0, rechargeAmount: 0 };
    expect(specPrice(ench, pc, 0)).toBe(200);
    pc.items[0]!.magic = true;
    expect(specPrice(ench, pc, 0)).toBeNull();
    pc.items[0]!.magic = false;
    pc.items[0]!.ability = ItemAbil.DAMAGING_WEAPON;
    expect(specPrice(ench, pc, 0)).toBeNull();
  });

  it('offers nothing on an empty slot', async () => {
    const { pc } = withItem({});
    expect(specPrice(state(ItemShopMode.SELL_ANY), pc, 0)).toBeNull();
  });
});

describe('using a service', () => {
  it('selling pays out and empties the slot', async () => {
    const { univ, pc } = withItem(SWORD);
    pc.items[1] = { ...defaultItem(), ...ARMOUR };
    univ.party.gold = 10;
    const state = {
      mode: ItemShopMode.SELL_ANY, cost: 0, rechargeLimit: 0, rechargeAmount: 0,
    };
    expect(handleItemShopAction(univ, state, 0, 0)).toBe('done');
    expect(univ.party.gold).toBe(60);
    expect(univ.transcript.at(-1)).toBe('You sell your item.');
    // take_item compacts the pack, so the armour has moved up a slot.
    expect(pc.items[0]!.fullName).toBe('Mail');
    expect(pc.items[1]!.variety).toBe(ItemType.NO_ITEM);
  });

  it('identifying charges the fee and needs the gold', async () => {
    const { univ, pc } = withItem({ ...SWORD, ident: false });
    const state = {
      mode: ItemShopMode.IDENTIFY, cost: 40, rechargeLimit: 0, rechargeAmount: 0,
    };
    univ.party.gold = 10;
    expect(handleItemShopAction(univ, state, 0, 0)).toBe('refused');
    expect(pc.items[0]!.ident).toBe(false);
    expect(univ.transcript.at(-1)).toContain("don't have the gold");

    univ.party.gold = 100;
    expect(handleItemShopAction(univ, state, 0, 0)).toBe('done');
    expect(pc.items[0]!.ident).toBe(true);
    expect(univ.party.gold).toBe(60);
  });

  it('recharging adds charges', async () => {
    const { univ, pc } = withItem({
      variety: ItemType.WAND, value: 100, ident: true, rechargeable: true,
      ability: ItemAbil.CALL_SPECIAL, charges: 2, maxCharges: 10,
    });
    univ.party.gold = 500;
    const state = {
      mode: ItemShopMode.RECHARGE, cost: 30, rechargeLimit: 0, rechargeAmount: 4,
    };
    expect(handleItemShopAction(univ, state, 0, 0)).toBe('done');
    expect(pc.items[0]!.charges).toBe(6);
    expect(univ.party.gold).toBe(470);
  });

  it('refuses an item the service does not apply to', async () => {
    const { univ } = withItem({ ...SWORD, unsellable: true });
    const state = {
      mode: ItemShopMode.SELL_ANY, cost: 0, rechargeLimit: 0, rechargeAmount: 0,
    };
    expect(handleItemShopAction(univ, state, 0, 0)).toBe('refused');
    expect(univ.party.gold).toBe(200);
  });
});

describe('the talk nodes that open a service', () => {
  function findNode(type: TalkNodeType): { town: number; index: number } | null {
    for (let t = 0; t < scen.townTalk.length; t++) {
      const index = scen.townTalk[t]!.talkNodes.findIndex(
        (n) => n.type === type && n.personality >= 0);
      if (index >= 0) return { town: t, index };
    }
    return null;
  }

  it('puts the inventory panel into the mode the node names', async () => {
    const cases: [TalkNodeType, ItemShopMode][] = [
      [TalkNodeType.SELL_WEAPONS, ItemShopMode.SELL_WEAPONS],
      [TalkNodeType.SELL_ARMOR, ItemShopMode.SELL_ARMOR],
      [TalkNodeType.SELL_ITEMS, ItemShopMode.SELL_ANY],
      [TalkNodeType.IDENTIFY, ItemShopMode.IDENTIFY],
    ];
    let checked = 0;
    for (const [nodeType, mode] of cases) {
      const found = findNode(nodeType);
      if (!found) continue;
      checked++;
      const node = scen.townTalk[found.town]!.talkNodes[found.index]!;
      const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
      const session = new GameSession(univ);
      session.startTownMode(found.town, FORCED_ENTRY);
      session.startTalkMode(-1, node.personality, 0, -1);
      session.chooseTalkNode(found.index);
      expect(session.itemShop?.mode).toBe(mode);
      expect(session.itemShop?.cost).toBe(node.extras[0]);
      // The panel drops back to plain inventory when the talk ends.
      session.endTalkMode();
      expect(session.itemShop).toBeNull();
    }
    expect(checked).toBeGreaterThan(0);
  });
});
