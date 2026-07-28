/**
 * Mirrors test expectations from ../exile-wasm/test/item_read.cpp and
 * monst_read.cpp against the same fixtures.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ItemAbil, ItemType, ItemUse } from '../src/data/item';
import { Attitude } from '../src/data/monster';
import { readItemsFromXml } from '../src/fileio/itemsXml';
import { parseDice, readMonstersFromXml } from '../src/fileio/monstersXml';
import { parseXmlDoc } from '../src/fileio/xml';

async function fixture(dir: string, name: string): Promise<Element> {
  const textContent = readFileSync(
    new URL(`./fixtures/${dir}/${name}`, import.meta.url),
    'utf8',
  );
  return parseXmlDoc(textContent, name);
}

describe('readItemsFromXml', () => {
  it('reads a fully specified item', async () => {
    const items = readItemsFromXml(await fixture('items', 'full.xml'), 'full.xml');
    const item = items[0]!;
    expect(item.variety).toBe(ItemType.ONE_HANDED);
    expect(item.itemLevel).toBe(3);
    expect(item.value).toBe(100);
    expect(item.weight).toBe(10);
    expect(item.fullName).toBe('Test Sword');
    expect(item.name).toBe('Sword');
    expect(item.awkward).toBe(1);
    expect(item.bonus).toBe(5);
    expect(item.protection).toBe(4);
    expect(item.charges).toBe(20);
    expect(item.maxCharges).toBe(20);
    expect(item.weapType).toBe(8); // 'defense'
    expect(item.missile).toBe(3);
    expect(item.typeFlag).toBe(9);
    expect(item.specialClass).toBe(400);
    expect(item.treasClass).toBe(2);
    expect(item.ability).toBe(ItemAbil.POISON_AUGMENT);
    expect(item.abilStrength).toBe(6);
    expect(item.abilData).toBe(42);
    expect(item.magicUseType).toBe(ItemUse.HARM_ONE);
    expect(item.ident).toBe(true);
    expect(item.cursed).toBe(true);
    expect(item.unsellable).toBe(true);
    expect(item.desc).toBe('This is a silly, silly description.');
  });

  it('reads a minimal item and rejects malformed files', async () => {
    const items = readItemsFromXml(await fixture('items', 'minimal.xml'), 'minimal.xml');
    expect(items.length).toBeGreaterThan(0);
    for (const bad of ['bad_type.xml', 'bad_use.xml', 'bad_weapon.xml', 'missing_req.xml']) {
      const root = await fixture('items', bad);
      expect(() => readItemsFromXml(root, bad), bad).toThrow();
    }
  });
});

describe('readMonstersFromXml', () => {
  it('reads a minimal monster with defaults intact', async () => {
    const monsters = readMonstersFromXml(await fixture('monsters', 'minimal.xml'), 'minimal.xml');
    const mon = monsters[1]!;
    expect(mon.name).toBe('Test Monster');
    expect(mon.level).toBe(1);
    expect(mon.health).toBe(10);
    expect(mon.speed).toBe(4);
    expect(mon.race).toBe(9); // 'humanoid'
    expect(mon.pictureNum).toBe(5);
    expect(mon.xWidth).toBe(1);
    expect(mon.defaultAttitude).toBe(Attitude.HOSTILE_A);
    expect(mon.resist.every((r) => r === 100)).toBe(true);
  });

  it('reads attacks with dice', async () => {
    const monsters = readMonstersFromXml(await fixture('monsters', 'attacks.xml'), 'attacks.xml');
    const mon = monsters[1]!;
    expect(mon.attacks.length).toBeGreaterThan(0);
    expect(mon.attacks[0]!.dice).toBeGreaterThan(0);
    expect(mon.attacks[0]!.sides).toBeGreaterThan(0);
  });

  it('rejects malformed monsters', async () => {
    for (const bad of [
      'bad_id.xml', 'bad_attack.xml', 'bad_attack_type.xml', 'too_many_attacks.xml',
      'bad_immune.xml', 'missing_req.xml', 'bad_loot.xml',
    ]) {
      const root = await fixture('monsters', bad);
      expect(() => readMonstersFromXml(root, bad), bad).toThrow();
    }
  });
});

describe('parseDice', () => {
  it('parses NdM and dM forms', async () => {
    expect(parseDice('2d6', 't')).toEqual({ count: 2, sides: 6 });
    expect(parseDice('d8', 't')).toEqual({ count: 1, sides: 8 });
    expect(parseDice('10d12', 't')).toEqual({ count: 10, sides: 12 });
    expect(() => parseDice('2x6', 't')).toThrow();
    expect(() => parseDice('', 't')).toThrow();
  });
});
