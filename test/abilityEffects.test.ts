/**
 * The uAbility consumers that landed with the port: MARTYRS_SHIELD,
 * ABSORB_SPELLS, SPLITS and DEATH_TRIGGER, plus place_monster/find_clear_spot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { DamageType } from '../src/data/monster';
import { MonstAbil, MonstGen, MonstMissile } from '../src/data/monsterAbility';
import { defaultItem } from '../src/data/item';
import {
  monsterBasicAbil, monsterFireMissile, pickMonsterAbility,
} from '../src/game/monsterAbilities';
import { Scenario } from '../src/data/scenario';
import { damageMonst } from '../src/game/damage';
import { findClearSpot, placeMonster } from '../src/game/monsterPlace';
import { GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature } from '../src/universe/creature';
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

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  return s;
}

function aLiveMonster(s: GameSession): Creature {
  const m = s.univ.town!.monsters.find((c) => c.isAlive);
  if (!m) throw new Error('no live monster in the start town');
  return m;
}

describe('MARTYRS_SHIELD as an ability', () => {
  it('shields at a chance of 1000 in a thousand and scales what bounces back', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.MARTYRS_SHIELD]!;
    abil.active = true;
    abil.special.extra1 = 1000; // always
    abil.special.extra2 = 50; // half the damage comes back
    expect(m.isShielded(s.univ.rng)).toBe(true);
    expect(m.getSharedDmg(20, s.univ.rng)).toBe(10);
  });

  it('is off when the ability is inactive and no status is up', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    expect(m.isShielded(s.univ.rng)).toBe(false);
    expect(m.getSharedDmg(20, s.univ.rng)).toBe(20);
  });
});

describe('ABSORB_SPELLS', () => {
  it('swallows the effect whole and heals by extra2', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.maxHealth = 100;
    m.health = 20;
    const abil = m.mon.abil[MonstAbil.ABSORB_SPELLS]!;
    abil.active = true;
    abil.special.extra1 = 1000;
    abil.special.extra2 = 7;
    expect(m.magicAdjust(30)).toBe(0);
    expect(m.health).toBe(27);
  });

  it('otherwise only scales by the magic resistance', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.resist[DamageType.MAGIC] = 50;
    expect(m.magicAdjust(30)).toBe(15);
  });
});

describe('place_monster and find_clear_spot', () => {
  it('places a new creature in a free slot, alerted and hostile', () => {
    const s = inTown();
    const town = s.univ.town!;
    const where = findClearSpot(s, s.univ.party.townLoc, 0);
    expect(where.x).toBeGreaterThan(0);
    const slot = placeMonster(s, 3, where);
    expect(slot).toBeLessThan(town.monsters.length);
    const placed = town.monsters[slot]!;
    expect(placed.isAlive).toBe(true);
    expect(placed.curLoc).toEqual(where);
    expect(placed.isFriendly).toBe(false);
  });

  it('refuses a square something is already standing on', () => {
    const s = inTown();
    const town = s.univ.town!;
    const occupied = aLiveMonster(s).curLoc;
    expect(placeMonster(s, 3, occupied)).toBe(town.monsters.length);
  });
});

describe('SPLITS', () => {
  it('spawns a copy carrying the original\'s remaining health', () => {
    const s = inTown();
    const town = s.univ.town!;
    const m = aLiveMonster(s);
    m.maxHealth = 200;
    m.health = 200;
    m.mon.armor = 0;
    m.mon.resist.fill(100);
    const abil = m.mon.abil[MonstAbil.SPLITS]!;
    abil.active = true;
    abil.special.extra1 = 1000; // always, since the roll is `< 1000` on 1..1000
    const before = town.monsters.filter((c) => c.isAlive).length;
    damageMonst(s.univ, m, 0, 10, DamageType.WEAPON, { session: s, boom: false });
    const after = town.monsters.filter((c) => c.isAlive).length;
    expect(after).toBe(before + 1);
    // Every live copy of it is as hurt as the original.
    const copies = town.monsters.filter((c) => c.isAlive && c.number === m.number && c !== m);
    expect(copies.some((c) => c.health === m.health)).toBe(true);
  });

  it('does not split a monster the blow killed', () => {
    const s = inTown();
    const town = s.univ.town!;
    const m = aLiveMonster(s);
    m.health = 1;
    m.mon.armor = 0;
    m.mon.resist.fill(100);
    const abil = m.mon.abil[MonstAbil.SPLITS]!;
    abil.active = true;
    abil.special.extra1 = 1000;
    const before = town.monsters.filter((c) => c.isAlive).length;
    damageMonst(s.univ, m, 0, 500, DamageType.WEAPON, { session: s, boom: false });
    expect(m.isAlive).toBe(false);
    expect(town.monsters.filter((c) => c.isAlive).length).toBeLessThan(before);
  });
});

describe('a creature owns its abilities', () => {
  it('editing one creature leaves the scenario definition alone', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.abil[MonstAbil.SPLITS]!.active = true;
    expect(scen.scenMonsters[m.number]!.abil[MonstAbil.SPLITS]!.active).toBe(false);
  });
});

describe('ranged monster abilities', () => {
  it('picks a missile when the target is out of reach and skips it when adjacent', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.MISSILE]!;
    abil.active = true;
    abil.missile.type = MonstMissile.ARROW;
    abil.missile.range = 8;
    abil.missile.odds = 1000; // always
    abil.missile.dice = 2;
    abil.missile.sides = 7;
    abil.missile.skill = 20;
    m.curLoc = { x: 10, y: 10 };
    // Four squares off: in range, not adjacent.
    expect(pickMonsterAbility(s, m, { x: 14, y: 10 }, false)?.key).toBe(MonstAbil.MISSILE);
    // Right next to it: prefer the swing.
    expect(pickMonsterAbility(s, m, { x: 11, y: 10 }, true)).toBeNull();
    // Out of range.
    expect(pickMonsterAbility(s, m, { x: 30, y: 10 }, false)).toBeNull();
  });

  it('a spine-shooter fires even point-blank', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.MISSILE]!;
    abil.active = true;
    abil.missile.type = MonstMissile.SPINE;
    abil.missile.range = 8;
    abil.missile.odds = 1000;
    m.curLoc = { x: 10, y: 10 };
    expect(pickMonsterAbility(s, m, { x: 11, y: 10 }, true)?.key).toBe(MonstAbil.MISSILE);
  });

  it('a fired missile hurts the PC it hits', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.MISSILE]!;
    abil.active = true;
    abil.missile.type = MonstMissile.ARROW;
    abil.missile.dice = 8;
    abil.missile.sides = 7;
    abil.missile.skill = 50; // hit_chance caps at 99, so this all but always lands
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 400;
    pc.curHealth = 400;
    pc.items.fill(defaultItem());
    pc.equip.fill(false);
    monsterFireMissile(s, m, abil, pc);
    expect(pc.curHealth).toBeLessThan(400);
  });

  it('a breath weapon deals its damage type', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.DAMAGE]!;
    abil.active = true;
    abil.gen.type = MonstGen.BREATH;
    abil.gen.strength = 8;
    abil.gen.range = 8;
    abil.gen.odds = 1000;
    abil.gen.extra = DamageType.FIRE;
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 400;
    pc.curHealth = 400;
    monsterBasicAbil(s, m, MonstAbil.DAMAGE, abil, pc);
    expect(pc.curHealth).toBeLessThan(400);
  });

  it('a steal-gold ability empties the purse', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.STEAL_GOLD]!;
    abil.active = true;
    abil.gen.strength = 50;
    s.univ.party.gold = 1000;
    monsterBasicAbil(s, m, MonstAbil.STEAL_GOLD, abil, s.univ.party.pcs[0]!);
    expect(s.univ.party.gold).toBeLessThan(1000);
  });
});
