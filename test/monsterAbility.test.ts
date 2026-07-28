/**
 * The uAbility port: readMonstAbilFromXml (fileio_scen.cpp:1425) against the
 * real valleydy monsters, plus the enum-shape rules from
 * monster_abilities.hpp that the rest of combat leans on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Monster } from '../src/data/monster';
import {
  MonstAbil, MonstAbilCat, MonstGen, MonstMissile, MonstSummon, SpellPat,
  abilityApCost, abilityCategory, defaultAbility,
} from '../src/data/monsterAbility';
import { readMonstersFromXml } from '../src/fileio/monstersXml';
import { parseXmlDoc } from '../src/fileio/xml';
import { Status } from '../src/universe/skills';

async function monstersOf(scen: string): Promise<Monster[]> {
  const src = readFileSync(
    new URL(`../public/scenarios/${scen}/monsters.xml`, import.meta.url), 'utf8');
  return readMonstersFromXml(await parseXmlDoc(src, 'monsters.xml'), 'monsters.xml');
}

const valleydyMonsters = (): Promise<Monster[]> => monstersOf('valleydy');

/** Parse an inline document, the way the fixture tests do. */
async function parse(src: string): Promise<Monster[]> {
  return readMonstersFromXml(await parseXmlDoc(src, 'x.xml'), 'x.xml');
}

function byName(monsters: Monster[], name: string): Monster {
  const m = monsters.find((mon) => mon.name === name);
  if (!m) throw new Error(`no monster named ${name}`);
  return m;
}

describe('getMonstAbilCategory', () => {
  it('files each key under the arm of the union it selects', async () => {
    expect(abilityCategory(MonstAbil.MISSILE)).toBe(MonstAbilCat.MISSILE);
    expect(abilityCategory(MonstAbil.DAMAGE)).toBe(MonstAbilCat.GENERAL);
    expect(abilityCategory(MonstAbil.STATUS2)).toBe(MonstAbilCat.GENERAL);
    expect(abilityCategory(MonstAbil.SPLITS)).toBe(MonstAbilCat.SPECIAL);
    expect(abilityCategory(MonstAbil.DEATH_TRIGGER)).toBe(MonstAbilCat.SPECIAL);
    expect(abilityCategory(MonstAbil.RADIATE)).toBe(MonstAbilCat.RADIATE);
    expect(abilityCategory(MonstAbil.SUMMON)).toBe(MonstAbilCat.SUMMON);
    // NO_ABIL is SPECIAL, not INVALID — the C++ leans on that.
    expect(abilityCategory(MonstAbil.NO_ABIL)).toBe(MonstAbilCat.SPECIAL);
  });
});

describe('get_ap_cost', () => {
  it('charges the heavier missiles 3 and the rest 2', async () => {
    const a = defaultAbility();
    a.missile.type = MonstMissile.ARROW;
    expect(abilityApCost(MonstAbil.MISSILE, a)).toBe(3);
    a.missile.type = MonstMissile.DART;
    expect(abilityApCost(MonstAbil.MISSILE, a)).toBe(2);
  });

  it('gives a touch ability -1, so it rides along with the melee attack', async () => {
    const a = defaultAbility();
    a.gen.type = MonstGen.TOUCH;
    expect(abilityApCost(MonstAbil.STATUS, a)).toBe(-1);
    a.gen.type = MonstGen.BREATH;
    expect(abilityApCost(MonstAbil.STATUS, a)).toBe(3);
  });

  it('reads a SPECIAL ability cost out of its second parameter', async () => {
    const a = defaultAbility();
    a.special.extra2 = 5;
    expect(abilityApCost(MonstAbil.SPECIAL, a)).toBe(5);
  });
});

describe('readMonstAbilFromXml', () => {
  it('reads a missile ability, with the chance in tenths of a percent', async () => {
    const archer = byName(await valleydyMonsters(), 'Empire Archer');
    const abil = archer.abil[MonstAbil.MISSILE]!;
    expect(abil.active).toBe(true);
    // <type>arrow++</type> is eMonstMissile::RAPID_ARROW, the last of the ten.
    expect(abil.missile.type).toBe(MonstMissile.RAPID_ARROW);
    expect(abil.missile.pic).toBe(3);
    expect(abil.missile.dice).toBe(8);
    expect(abil.missile.sides).toBe(7);
    expect(abil.missile.skill).toBe(16);
    expect(abil.missile.range).toBe(10);
    // <chance>87.5</chance> — a percentage in the file, tenths in the game.
    expect(abil.missile.odds).toBe(875);
  });

  it("reads a touch status ability and puts eStatus in the union's third arm", async () => {
    const acolyte = byName(await valleydyMonsters(), 'Giant Spider');
    const abil = acolyte.abil[MonstAbil.STATUS2]!;
    expect(abil.active).toBe(true);
    expect(abil.gen.type).toBe(MonstGen.TOUCH);
    expect(abil.gen.extra).toBe(Status.POISON);
    expect(abil.gen.odds).toBe(1000);
  });

  it('reads a <special> ability into its three parameters', async () => {
    const zombie = (await valleydyMonsters()).find((m) => m.abil[MonstAbil.SPLITS]!.active);
    expect(zombie).toBeDefined();
    expect(zombie!.abil[MonstAbil.SPLITS]!.special.extra1).toBe(1000);
  });

  it('leaves every other slot inactive', async () => {
    const archer = byName(await valleydyMonsters(), 'Empire Archer');
    const active = archer.abil
      .map((a, i) => (a.active ? i : -1))
      .filter((i) => i >= 0);
    expect(active).toEqual([MonstAbil.MISSILE]);
  });

  it('defaults a radiate pattern to the 3x3 square', async () => {
    expect(defaultAbility().radiate.pat).toBe(SpellPat.SQUARE);
  });

  it('rejects an ability filed under the wrong element', async () => {
    const src = `<monsters><monster id="1">
      <name>x</name><level>1</level><armor>1</armor><skill>1</skill><hp>1</hp>
      <speed>4</speed><race>human</race><pic w="1" h="1">1</pic><attitude>docile</attitude>
      <immunity><all>false</all></immunity>
      <attacks><attack type="swing">1d2</attack></attacks>
      <abilities><missile type="splits"><param>1</param></missile></abilities>
    </monster></monsters>`;
    await expect(parse(src)).rejects.toThrow();
  });

  it('rejects the same ability twice', async () => {
    const one = `<general type="dmg"><type>touch</type><strength>1</strength>
      <chance>10.0</chance><extra>fire</extra></general>`;
    const src = `<monsters><monster id="1">
      <name>x</name><level>1</level><armor>1</armor><skill>1</skill><hp>1</hp>
      <speed>4</speed><race>human</race><pic w="1" h="1">1</pic><attitude>docile</attitude>
      <immunity><all>false</all></immunity>
      <attacks><attack type="swing">1d2</attack></attacks>
      <abilities>${one}${one}</abilities>
    </monster></monsters>`;
    await expect(parse(src)).rejects.toThrow();
  });

  it('demands a range and a graphic once a general ability is not a touch', async () => {
    const src = `<monsters><monster id="1">
      <name>x</name><level>1</level><armor>1</armor><skill>1</skill><hp>1</hp>
      <speed>4</speed><race>human</race><pic w="1" h="1">1</pic><attitude>docile</attitude>
      <immunity><all>false</all></immunity>
      <attacks><attack type="swing">1d2</attack></attacks>
      <abilities><general type="dmg"><type>breath</type><strength>4</strength>
        <chance>50.0</chance><extra>fire</extra></general></abilities>
    </monster></monsters>`;
    await expect(parse(src)).rejects.toThrow(/missing/);
  });

  it('reads a summon ability, and <race> means a species', async () => {
    const src = `<monsters><monster id="1">
      <name>x</name><level>1</level><armor>1</armor><skill>1</skill><hp>1</hp>
      <speed>4</speed><race>human</race><pic w="1" h="1">1</pic><attitude>docile</attitude>
      <immunity><all>false</all></immunity>
      <attacks><attack type="swing">1d2</attack></attacks>
      <abilities><summon type="summon"><race>demon</race><min>1</min><max>3</max>
        <duration>10</duration><chance>20.0</chance></summon></abilities>
    </monster></monsters>`;
    const mon = (await parse(src))[1]!;
    const abil = mon.abil[MonstAbil.SUMMON]!;
    expect(abil.active).toBe(true);
    expect(abil.summon.type).toBe(MonstSummon.SPECIES);
    expect(abil.summon.min).toBe(1);
    expect(abil.summon.max).toBe(3);
    expect(abil.summon.len).toBe(10);
    expect(abil.summon.chance).toBe(200);
  });

  it('every bundled scenario parses, so no real ability is rejected', async () => {
    for (const scen of ['valleydy', 'stealth', 'zakhazi', 'busywork']) {
      const monsters = await monstersOf(scen);
      expect(monsters.length).toBeGreaterThan(1);
      const withAbilities = monsters.filter((m) => m.abil.some((a) => a.active));
      expect(withAbilities.length).toBeGreaterThan(10);
    }
  });
});
