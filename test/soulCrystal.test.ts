/**
 * The M5 leftovers: the soul crystal (Capture Soul / Simulacrum), petrifying
 * a PC or a monster, Mindduel, and `drain_pc`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { DamageType } from '../src/data/monster';
import { ItemAbil, defaultItem } from '../src/data/item';
import { MonstAbil } from '../src/data/monsterAbility';
import { monsterBasicAbil } from '../src/game/monsterAbilities';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { petrifyMonst, petrifyPc } from '../src/game/damage';
import { drainPc } from '../src/game/itemUse';
import { doMindduel } from '../src/game/mindduel';
import {
  hasTrappedMonst, recordMonst, releaseMonst, trappedMonsters,
} from '../src/game/soulCrystal';
import { GameSession } from '../src/game/session';
import { Creature } from '../src/universe/creature';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Race } from '../src/universe/skills';
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

describe('the soul crystal', () => {
  it('catches a low-level monster and reports its slot', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.level = 1; // charm_odds[0] is 90, so almost every roll catches it
    m.mon.abil[MonstAbil.SPLITS]!.active = false;
    recordMonst(s.univ, m, true); // forced: no saving throw at all
    expect(hasTrappedMonst(s.univ.party)).toBe(true);
    expect(s.univ.party.imprisonedMonst).toContain(m.number);
    expect(s.univ.transcript.join('\n')).toContain('Capture Soul: Success!');
    expect(s.univ.transcript.join('\n')).toMatch(/Caught in slot [1-4]\./);
  });

  it('never catches a monster that splits, or an important one', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.level = 1;
    m.mon.abil[MonstAbil.SPLITS]!.active = true;
    recordMonst(s.univ, m, true);
    expect(hasTrappedMonst(s.univ.party)).toBe(false);

    m.mon.abil[MonstAbil.SPLITS]!.active = false;
    m.mon.race = Race.IMPORTANT;
    recordMonst(s.univ, m, true);
    expect(hasTrappedMonst(s.univ.party)).toBe(false);
  });

  it('refuses a monster bigger than one square, before it rolls anything', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.xWidth = 2;
    recordMonst(s.univ, m, true);
    expect(s.univ.transcript.at(-1)).toContain('Monster is too big');
    expect(hasTrappedMonst(s.univ.party)).toBe(false);
  });

  it('cannot catch anything much above level 14 even unforced', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    // charm_odds[15] is 0, and the roll is at least 1 * 7/10 = 0... but the
    // test is `r1 > odds`, so only a roll of 1 (0 after scaling) would pass.
    m.mon.level = 40;
    m.mon.abil[MonstAbil.SPLITS]!.active = false;
    for (let i = 0; i < 30; i++) recordMonst(s.univ, m, false);
    expect(hasTrappedMonst(s.univ.party)).toBe(false);
  });

  it('lists what it holds, and lets a node release it again', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.level = 1;
    m.mon.abil[MonstAbil.SPLITS]!.active = false;
    recordMonst(s.univ, m, true);
    const held = trappedMonsters(s.univ);
    expect(held.length).toBe(1);
    expect(held[0]!.which).toBe(m.number);
    expect(held[0]!.name).toBe(scen.scenMonsters[m.number]!.name);
    releaseMonst(s.univ.party, m.number);
    expect(hasTrappedMonst(s.univ.party)).toBe(false);
  });
});

describe('petrification', () => {
  it('turns a PC to stone on a bad roll, and says so', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.items.fill(defaultItem());
    pc.equip.fill(false);
    pc.skills.fill(0); // no luck, so kill_pc has no saving throw to make
    // A strength of 30 puts the roll far below 14 whatever it rolls.
    petrifyPc(s.univ, pc, 30);
    expect(pc.mainStatus).toBe(MainStatus.STONE);
    expect(s.univ.transcript.join('\n')).toContain('is turned to stone');
  });

  it('an item that protects from petrification wins outright', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.items.fill(defaultItem());
    pc.equip.fill(false);
    const amulet = defaultItem();
    amulet.variety = 19; // NECKLACE
    amulet.ability = ItemAbil.PROTECT_FROM_PETRIFY;
    pc.items[0] = amulet;
    pc.equip[0] = true;
    petrifyPc(s.univ, pc, 100);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
    expect(s.univ.transcript.at(-1)).toContain('resists');
  });

  it('stones a monster, but not one that magic cannot touch', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.resist[DamageType.MAGIC] = 100;
    petrifyMonst(s.univ, m, 30, s);
    expect(m.isAlive).toBe(false);

    const other = aLiveMonster(s);
    // A resistance of 0 means it takes no magic damage at all — and that is
    // also what makes it immune here.
    other.mon.resist[DamageType.MAGIC] = 0;
    petrifyMonst(s.univ, other, 30, s);
    expect(other.isAlive).toBe(true);
    expect(s.univ.transcript.join('\n')).toContain('resists');
  });
});

describe('mindduel', () => {
  it('drains the caster when the monster is far stronger', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[3]!;
    pc.curSp = 40;
    pc.maxSp = 40;
    const m = aLiveMonster(s);
    m.mon.level = 60; // adjust is hugely negative, so every round goes its way
    m.mon.mu = 3;
    doMindduel(s, 3, m);
    expect(s.univ.transcript).toContain('Mindduel!');
    expect(pc.curSp).toBeLessThan(40);
    expect(s.univ.transcript.join('\n')).toContain('is drained');
  });

  it('kills the caster once dumbfounding passes seven', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[3]!;
    pc.curSp = 0;
    pc.items.fill(defaultItem());
    pc.equip.fill(false);
    pc.skills.fill(0);
    const m = aLiveMonster(s);
    m.mon.level = 60;
    m.mon.mu = 3;
    doMindduel(s, 3, m);
    // Two points of dumbfounding a round, ten rounds, and eight is lethal.
    expect(pc.mainStatus).not.toBe(MainStatus.ALIVE);
    expect(s.univ.transcript.join('\n')).toContain('is killed!');
  });

  it('drains the monster when the caster is far stronger', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[3]!;
    pc.level = 50;
    pc.curSp = 0;
    const m = aLiveMonster(s);
    m.mon.level = 1;
    m.mp = 20;
    doMindduel(s, 3, m);
    expect(m.mp).toBeLessThan(20);
    // The caster's pool goes *up*, and past its maximum — nothing caps it here.
    expect(pc.curSp).toBeGreaterThan(0);
  });

  it('turns the town hostile before duelling a friendly creature', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.level = 1;
    expect(m.isFriendly).toBe(true);
    doMindduel(s, 3, m);
    expect(m.isFriendly).toBe(false);
    expect(s.univ.town!.monstHostile).toBe(true);
  });
});

describe('drain_pc', () => {
  it('takes experience and nothing else — no level goes with it', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.experience = 100;
    const level = pc.level;
    drainPc(pc, 30);
    expect(pc.experience).toBe(70);
    expect(pc.level).toBe(level);
    // It never goes below zero.
    drainPc(pc, 500);
    expect(pc.experience).toBe(0);
  });

  it('leaves the dead alone', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.experience = 100;
    pc.mainStatus = MainStatus.DEAD;
    drainPc(pc, 30);
    expect(pc.experience).toBe(100);
  });
});

describe('the PETRIFY and DRAIN_XP monster abilities', () => {
  it('a petrifying gaze uses a percentage of the monster level as its strength', async () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.level = 40;
    const abil = m.mon.abil[MonstAbil.PETRIFY]!;
    abil.active = true;
    abil.gen.strength = 100; // the whole of its level
    const pc = s.univ.party.pcs[0]!;
    pc.items.fill(defaultItem());
    pc.equip.fill(false);
    pc.skills.fill(0);
    await monsterBasicAbil(s, m, MonstAbil.PETRIFY, abil, pc);
    expect(pc.mainStatus).toBe(MainStatus.STONE);
  });

  it('life saving stops a life drain without being spent', async () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.mon.level = 40;
    const abil = m.mon.abil[MonstAbil.DRAIN_XP]!;
    abil.active = true;
    abil.gen.strength = 100;
    const pc = s.univ.party.pcs[0]!;
    pc.items.fill(defaultItem());
    pc.equip.fill(false);
    pc.experience = 500;
    const ring = defaultItem();
    ring.variety = 18; // RING
    ring.ability = ItemAbil.LIFE_SAVING;
    ring.charges = 1;
    pc.items[0] = ring;
    pc.equip[0] = true;
    await monsterBasicAbil(s, m, MonstAbil.DRAIN_XP, abil, pc);
    expect(pc.experience).toBe(500);
    expect(pc.items[0]!.charges).toBe(1);

    // Without it, the drain lands.
    pc.equip[0] = false;
    await monsterBasicAbil(s, m, MonstAbil.DRAIN_XP, abil, pc);
    expect(pc.experience).toBe(460);
  });
});
