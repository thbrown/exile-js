import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Scenario } from '../src/data/scenario';
import { ShopItemType, ShopPrompt, ShopType, shopItemCost } from '../src/data/shop';
import { ItemType } from '../src/data/item';
import { loadScenario } from '../src/fileio/loadScenario';
import { readShopFromXml } from '../src/fileio/scenarioXml';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { parseXmlDoc } from '../src/fileio/xml';

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

describe('reading <shop> from scenario.xml', () => {
  it('loads every shop in the scenario', () => {
    expect(scen.shops.length).toBe(20);
    for (const shop of scen.shops) expect(shop.name.length).toBeGreaterThan(0);
    // Valleydy leaves four slots as empty "Unused Shop" placeholders.
    expect(scen.shops.filter((s) => s.numItems() === 0).map((s) => s.name))
      .toEqual(['Unused Shop', 'Unused Shop', 'Unused Shop', 'Unused Shop']);
    expect(scen.shops[7]!.name).toBe("Bristow's Smithy");
    expect(scen.shops[7]!.numItems()).toBe(37);
  });

  it('resolves item entries against the scenario item list', () => {
    const shop = scen.shops.find((s) =>
      s.items.some((e) => e.type === ShopItemType.ITEM))!;
    const entry = shop.items.find((e) => e.type === ShopItemType.ITEM)!;
    expect(entry.item.variety).not.toBe(ItemType.NO_ITEM);
    expect(entry.item.fullName).toBe(scen.scenItems[entry.index]!.fullName);
    // Shops never sell unidentified goods.
    expect(entry.item.ident).toBe(true);
  });

  it('names spells and skills from the string resources', () => {
    for (const shop of scen.shops) {
      for (const entry of shop.items) {
        if (entry.type === ShopItemType.MAGE_SPELL || entry.type === ShopItemType.PRIEST_SPELL
          || entry.type === ShopItemType.ALCHEMY || entry.type === ShopItemType.SKILL) {
          expect(entry.item.fullName.length).toBeGreaterThan(0);
          expect(entry.item.value).toBeGreaterThan(0);
        }
      }
    }
  });

  it('reads the healing shop as healing services', () => {
    const healer = scen.shops.find((s) => s.prompt === ShopPrompt.HEALING)!;
    expect(healer.type).toBe(ShopType.ALLOW_DEAD);
    for (const entry of healer.items) {
      expect(entry.type).toBeGreaterThanOrEqual(ShopItemType.HEAL_WOUNDS);
      expect(entry.item.fullName.length).toBeGreaterThan(0);
    }
  });

  it('reads the magic shops as random treasure', () => {
    const magic = scen.shops.filter((s) => s.type === ShopType.RANDOM);
    expect(magic.length).toBeGreaterThan(0);
    for (const entry of magic[0]!.items)
      expect(entry.type).toBe(ShopItemType.TREASURE);
  });

  it('reads the store-items rect', () => {
    expect(scen.storeItemRects.get(0)).toEqual({ top: 0, left: 0, bottom: 47, right: 47 });
  });
});

describe('shop entry forms', () => {
  const parse = async (xml: string) => readShopFromXml(await parseXmlDoc(xml, 'test.xml'));

  it('reads quantities, chances and call-special entries', async () => {
    const shop = await parse(`<shop>
      <name>Test</name><type>live</type><prompt>shop</prompt><face>3</face>
      <entries>
        <item quantity='infinite'>4</item>
        <item quantity='5'>7</item>
        <item chance='40'>9</item>
        <heal>1</heal>
        <special>
          <name>A Favour</name><description>Do a thing.</description>
          <node>12</node><quantity>1</quantity><cost>250</cost><icon>7</icon>
        </special>
      </entries>
    </shop>`);
    expect(shop.face).toBe(3);
    expect(shop.type).toBe(ShopType.NORMAL);
    // Infinite stock is quantity 0.
    expect(shop.getItem(0)).toMatchObject({ type: ShopItemType.ITEM, quantity: 0, index: 4 });
    expect(shop.getItem(1)).toMatchObject({ type: ShopItemType.ITEM, quantity: 5, index: 7 });
    // An optional item packs its chance into the thousands place.
    expect(shop.getItem(2)).toMatchObject({
      type: ShopItemType.OPT_ITEM, quantity: 1 + 40 * 1000, index: 9,
    });
    expect(shop.getItem(3).type).toBe(ShopItemType.CURE_POISON);
    const special = shop.getItem(4);
    expect(special.type).toBe(ShopItemType.CALL_SPECIAL);
    expect(special.item.fullName).toBe('A Favour');
    expect(special.item.desc).toBe('Do a thing.');
    expect(special.item.itemLevel).toBe(12);
    expect(special.item.value).toBe(250);
  });

  it('rejects unknown nodes and missing fields', async () => {
    await expect(parse(`<shop><name>x</name></shop>`)).rejects.toThrow(/missing/);
    await expect(parse(`<shop>
      <name>x</name><type>live</type><prompt>shop</prompt><face>0</face>
      <entries><wat>1</wat></entries></shop>`)).rejects.toThrow(/bad node <wat>/);
  });
});

describe('prices', () => {
  it('scales with the shop cost adjustment (cost_mult)', () => {
    const entry = { type: ShopItemType.ITEM, quantity: 0, index: 0, item: { ...scen.scenItems[0]! } };
    entry.item.value = 100;
    entry.item.charges = 0;
    // cost_mult = {5,7,10,13,16,20,25}, divided by 10.
    expect(shopItemCost(entry, 0)).toBe(50);
    expect(shopItemCost(entry, 2)).toBe(100);
    expect(shopItemCost(entry, 6)).toBe(250);
  });

  it('charges per charge for a wand', () => {
    const entry = { type: ShopItemType.ITEM, quantity: 0, index: 0, item: { ...scen.scenItems[0]! } };
    entry.item.value = 10;
    entry.item.charges = 4;
    expect(shopItemCost(entry, 2)).toBe(40);
  });
});
