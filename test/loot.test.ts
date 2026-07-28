import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { ItemType, defaultItem } from '../src/data/item';
import { defaultMonster } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import { GameSession } from '../src/game/session';
import { itemVal, placeGlands, placeItem, placeTreasure, resetItemMax } from '../src/game/loot';
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

/** A session standing in the start town, so there's a floor to drop things on. */
function inTown(seed?: number): GameSession {
  const rng = new GameRng();
  if (seed !== undefined) rng.seedGame(seed);
  const univ = new Universe(scen, rng, PartyPreset.DEFAULT);
  const s = new GameSession(univ);
  s.startNewGame();
  return s;
}

describe('place_item', () => {
  it('reuses an empty slot before growing the list', async () => {
    const { univ } = inTown();
    const town = univ.town!;
    town.items = [defaultItem(), { ...defaultItem(), variety: ItemType.POTION }];
    const before = town.items.length;
    placeItem(univ, { ...defaultItem(), variety: ItemType.WAND }, { x: 5, y: 6 });
    expect(town.items.length).toBe(before);
    expect(town.items[0]!.variety).toBe(ItemType.WAND);
    expect(town.items[0]!.itemLoc).toEqual({ x: 5, y: 6 });
  });

  it('appends when every slot is taken', async () => {
    const { univ } = inTown();
    const town = univ.town!;
    town.items = [{ ...defaultItem(), variety: ItemType.POTION }];
    placeItem(univ, { ...defaultItem(), variety: ItemType.WAND }, { x: 1, y: 1 });
    expect(town.items.map((i) => i.variety)).toEqual([ItemType.POTION, ItemType.WAND]);
  });

  it('reset_item_max trims empty slots off the end', async () => {
    const { univ } = inTown();
    const town = univ.town!;
    town.items = [{ ...defaultItem(), variety: ItemType.POTION }, defaultItem(), defaultItem()];
    resetItemMax(univ);
    expect(town.items.length).toBe(1);
  });
});

describe('item_val', () => {
  it('is the plain value with no charges, and per-charge with them', async () => {
    expect(itemVal({ ...defaultItem(), value: 30, charges: 0 })).toBe(30);
    expect(itemVal({ ...defaultItem(), value: 30, charges: 4 })).toBe(120);
  });
});

describe('place_glands', () => {
  it('leaves nothing when the monster has no corpse item', async () => {
    const { univ } = inTown();
    univ.town!.items = [];
    placeGlands(univ, { x: 3, y: 3 }, { ...defaultMonster(), corpseItem: -1 });
    expect(univ.town!.items).toHaveLength(0);
  });

  it('always leaves one at a chance of 100', async () => {
    const { univ } = inTown();
    univ.town!.items = [];
    // Item 1 of any scenario is a real item; corpse_item_chance is compared
    // with `<`, so 100 beats every roll of get_ran(1,1,100) except 100 itself.
    placeGlands(univ, { x: 3, y: 3 }, { ...defaultMonster(), corpseItem: 1, corpseItemChance: 101 });
    expect(univ.town!.items).toHaveLength(1);
    expect(univ.town!.items[0]!.itemLoc).toEqual({ x: 3, y: 3 });
  });
});

describe('place_treasure', () => {
  it('a rich corpse leaves something behind', async () => {
    const { univ } = inTown(12345);
    univ.town!.items = [];
    placeTreasure(univ, { x: 8, y: 8 }, 10, 4, 0);
    expect(univ.town!.items.length).toBeGreaterThan(0);
    for (const item of univ.town!.items) {
      expect(item.itemLoc).toEqual({ x: 8, y: 8 });
      expect(item.variety).not.toBe(ItemType.NO_ITEM);
    }
  });

  it('the poorest class leaves almost nothing', async () => {
    // treas_odds[0] is {10,0,0,0,0,0}: one pass at 10% and four dead ones, and
    // the gold roll for loot 0 is `0 * (...)`, so amt can never clear 3.
    const { univ } = inTown(999);
    let total = 0;
    for (let i = 0; i < 20; i++) {
      univ.town!.items = [];
      placeTreasure(univ, { x: 8, y: 8 }, 1, 0, 0);
      total += univ.town!.items.length;
    }
    expect(total).toBeLessThan(20);
  });

  it('is deterministic for a given seed — the call order is the spec', async () => {
    const a = inTown(4242);
    const b = inTown(4242);
    a.univ.town!.items = [];
    b.univ.town!.items = [];
    placeTreasure(a.univ, { x: 4, y: 4 }, 6, 3, 0);
    placeTreasure(b.univ, { x: 4, y: 4 }, 6, 3, 0);
    expect(a.univ.town!.items.map((i) => i.fullName))
      .toEqual(b.univ.town!.items.map((i) => i.fullName));
  });

  it('ignores a treasure class outside 0-4', async () => {
    const { univ } = inTown();
    univ.town!.items = [];
    placeTreasure(univ, { x: 8, y: 8 }, 5, 7, 0);
    expect(univ.town!.items).toHaveLength(0);
  });
});
