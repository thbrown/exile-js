/**
 * The spell dictionary transcribed from spell.cpp, and `pc_can_cast_spell` in
 * both its forms.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { Scenario } from '../src/data/scenario';
import {
  NUM_NORMAL_SPELLS, SPELLS, Spell, SpellRefer, SpellSelect, SpellWhen,
  isMage, isPriest, isPriestSide, spellFromNum, spellFromRawNum, spellName,
} from '../src/data/spell';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import { CastStatus, castableSpells, pcCanCastSpell, pcCanCastType } from '../src/game/spellCast';
import { BASIC_SPELLS, PartyPreset, Player } from '../src/universe/player';
import { MainStatus, Skill, Status, Trait } from '../src/universe/skills';
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

/** A caster who knows everything and has the points to prove it. */
function archmage(s: GameSession): Player {
  const pc = s.univ.party.pcs[0]!;
  pc.mageSpells.fill(true);
  pc.priestSpells.fill(true);
  pc.skills[Skill.MAGE_SPELLS] = 7;
  pc.skills[Skill.PRIEST_SPELLS] = 7;
  pc.curSp = 100;
  pc.maxSp = 100;
  pc.traits[Trait.PACIFIST] = false;
  pc.traits[Trait.ANAMA] = false;
  return pc;
}

describe('the spell dictionary', () => {
  it('has all 147 of spell.cpp\'s entries', () => {
    expect(Object.keys(SPELLS).length).toBe(147);
  });

  it('keeps the numbers the save format uses', () => {
    expect(Spell.LIGHT).toBe(0);
    expect(Spell.RECHARGE).toBe(78);
    expect(Spell.BLESS_MINOR).toBe(100);
    expect(Spell.CLEANSE_MAJOR).toBe(161);
    expect(Spell.NIRVANA).toBe(167);
  });

  it('transcribes a spell exactly (M_SPARK)', () => {
    // cSpell(eSpell::SPARK).asType(MAGE_SPELLS).asLevel(1)
    //   .withRange(6).withTargetLock().withCost(1).withRefer(REFER_TARGET).when(WHEN_COMBAT)
    expect(SPELLS[Spell.SPARK]).toEqual({
      refer: SpellRefer.TARGET,
      cost: 1,
      range: 6,
      level: 1,
      type: Skill.MAGE_SPELLS,
      when: SpellWhen.COMBAT,
      targetLock: true,
    });
  });

  it('needsSelect() implies peaceful, as the C++ builder does', () => {
    // M_HASTE_MINOR calls needsSelect() and never calls asPeaceful().
    expect(SPELLS[Spell.HASTE_MINOR]?.select).toBe(SpellSelect.ACTIVE);
    expect(SPELLS[Spell.HASTE_MINOR]?.peaceful).toBe(true);
  });

  it('knows which list a spell is on', () => {
    expect(isMage(Spell.LIGHT)).toBe(true);
    expect(isPriest(Spell.LIGHT)).toBe(false);
    expect(isPriest(Spell.BLESS_MINOR)).toBe(true);
    // The special spells are on neither list, though they sit on the priest
    // side for the purpose of where they're implemented.
    expect(isMage(Spell.RECHARGE)).toBe(false);
    expect(isPriest(Spell.NIRVANA)).toBe(false);
    expect(isPriestSide(Spell.NIRVANA)).toBe(true);
    expect(isPriestSide(Spell.RECHARGE)).toBe(false);
  });

  it('maps list positions to spell numbers', () => {
    expect(spellFromNum(Skill.MAGE_SPELLS, 0)).toBe(Spell.LIGHT);
    expect(spellFromNum(Skill.PRIEST_SPELLS, 0)).toBe(Spell.BLESS_MINOR);
    expect(spellFromNum(Skill.MAGE_SPELLS, 62)).toBe(Spell.NONE);
    expect(spellFromNum(Skill.EDGED_WEAPONS, 0)).toBe(Spell.NONE);
    expect(spellFromRawNum(0)).toBe(Spell.LIGHT);
    expect(spellFromRawNum(99)).toBe(Spell.NONE);
  });

  it('names spells out of the magic-names table', () => {
    expect(spellName(Spell.LIGHT)).toBe('Light');
    expect(spellName(Spell.SPARK)).toBe('Spark');
    expect(spellName(Spell.BLESS_MINOR)).toBe('Minor Bless');
    expect(spellName(Spell.NONE)).toBe('INVALID SPELL');
  });

  it('gives every mage and priest list slot a spell', () => {
    for (let i = 0; i < NUM_NORMAL_SPELLS; i++) {
      expect(SPELLS[i as Spell], `mage ${i}`).toBeDefined();
      expect(SPELLS[(i + 100) as Spell], `priest ${i}`).toBeDefined();
    }
  });
});

describe('pc_can_cast_spell, for one spell', () => {
  it('lets a trained caster cast a spell they know', () => {
    const s = inTown();
    const pc = archmage(s);
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(true);
  });

  it('refuses a spell the PC has not learned', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.mageSpells[Spell.LIGHT] = false;
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(false);
  });

  it('refuses a spell above the PC\'s skill', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.skills[Skill.MAGE_SPELLS] = 1;
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(true);
    // Level 7, so a skill of 1 is nowhere near.
    expect(pcCanCastSpell(s, pc, Spell.QUICKFIRE)).toBe(false);
  });

  it('refuses when the spell points are short', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.curSp = 0;
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(false);
  });

  it('honours where a spell may be cast', () => {
    const s = inTown();
    const pc = archmage(s);
    // Identify is a town/outdoors spell, never a combat one.
    expect(SPELLS[Spell.IDENTIFY]?.when).toBe(SpellWhen.TOWN | SpellWhen.OUTDOORS);
    expect(pcCanCastSpell(s, pc, Spell.IDENTIFY)).toBe(true);
    s.mode = GameMode.COMBAT;
    expect(pcCanCastSpell(s, pc, Spell.IDENTIFY)).toBe(false);
    // Spark is the other way round.
    expect(pcCanCastSpell(s, pc, Spell.SPARK)).toBe(true);
    s.mode = GameMode.TOWN;
    expect(pcCanCastSpell(s, pc, Spell.SPARK)).toBe(false);
  });

  it('a pacifist may only cast the peaceful spells', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.traits[Trait.PACIFIST] = true;
    expect(SPELLS[Spell.LIGHT]?.peaceful).toBe(true);
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(true);
    s.mode = GameMode.COMBAT;
    expect(SPELLS[Spell.SPARK]?.peaceful ?? false).toBe(false);
    expect(pcCanCastSpell(s, pc, Spell.SPARK)).toBe(false);
  });

  it('dumbfounding takes the high spells first, enlightenment gives skill', () => {
    const s = inTown();
    const pc = archmage(s);
    // The test is `DUMB >= 8 - level`, so the higher the spell the sooner it
    // goes: Fireball (3) at DUMB 5, Flame (2) at 6, Spark (1) at 7.
    s.mode = GameMode.COMBAT;
    pc.status[Status.DUMB] = 5;
    expect(pcCanCastSpell(s, pc, Spell.FIREBALL)).toBe(false);
    expect(pcCanCastSpell(s, pc, Spell.FLAME)).toBe(true);
    pc.status[Status.DUMB] = 6;
    expect(pcCanCastSpell(s, pc, Spell.FLAME)).toBe(false);
    expect(pcCanCastSpell(s, pc, Spell.SPARK)).toBe(true);
    // At 7 even the cheapest level-1 spell is gone, so a dumbfounded PC is
    // silenced one step before the status maxes out.
    pc.status[Status.DUMB] = 7;
    expect(pcCanCastSpell(s, pc, Spell.SPARK)).toBe(false);
    s.mode = GameMode.TOWN;
    // A negative DUMB is enlightenment and *raises* the effective skill.
    pc.status[Status.DUMB] = -5;
    pc.skills[Skill.MAGE_SPELLS] = 2;
    expect(pcCanCastSpell(s, pc, Spell.QUICKFIRE)).toBe(true);
  });

  it('nothing can be cast asleep, paralysed or dead', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.status[Status.ASLEEP] = 3;
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(false);
    pc.status[Status.ASLEEP] = 0;
    pc.status[Status.PARALYZED] = 2;
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(false);
    pc.status[Status.PARALYZED] = 0;
    pc.mainStatus = MainStatus.DEAD;
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(false);
  });

  it('a raise-dead spell needs somebody dead to raise', () => {
    const s = inTown();
    const pc = archmage(s);
    expect(SPELLS[Spell.RAISE_DEAD]?.select).toBe(SpellSelect.DEAD);
    expect(pcCanCastSpell(s, pc, Spell.RAISE_DEAD)).toBe(false);
    s.univ.party.pcs[3]!.mainStatus = MainStatus.DEAD;
    expect(pcCanCastSpell(s, pc, Spell.RAISE_DEAD)).toBe(true);
  });

  it('the special spells are not castable from the list', () => {
    const s = inTown();
    const pc = archmage(s);
    expect(pcCanCastSpell(s, pc, Spell.NIRVANA)).toBe(false);
    expect(pcCanCastSpell(s, pc, Spell.NONE)).toBe(false);
  });

  it('nothing is castable mid-conversation', () => {
    const s = inTown();
    const pc = archmage(s);
    s.mode = GameMode.TALKING;
    expect(pcCanCastSpell(s, pc, Spell.LIGHT)).toBe(false);
  });
});

describe('pc_can_cast_spell, for a whole skill', () => {
  it('says OK for a caster who can cast something', () => {
    const s = inTown();
    const pc = archmage(s);
    expect(pcCanCastType(s, pc, Skill.MAGE_SPELLS)).toBe(CastStatus.OK);
    expect(pcCanCastType(s, pc, Skill.PRIEST_SPELLS)).toBe(CastStatus.OK);
  });

  it('an Anama priest may never cast a mage spell', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.traits[Trait.ANAMA] = true;
    expect(pcCanCastType(s, pc, Skill.MAGE_SPELLS)).toBe(CastStatus.NO_ANAMA);
    // The Anama's own priest magic is untouched.
    expect(pcCanCastType(s, pc, Skill.PRIEST_SPELLS)).toBe(CastStatus.OK);
  });

  it('reports no skill, then no spell points', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.skills[Skill.MAGE_SPELLS] = 0;
    expect(pcCanCastType(s, pc, Skill.MAGE_SPELLS)).toBe(CastStatus.NO_SKILL);
    pc.skills[Skill.MAGE_SPELLS] = 5;
    pc.curSp = 0;
    expect(pcCanCastType(s, pc, Skill.MAGE_SPELLS)).toBe(CastStatus.NO_SP);
  });

  it('an antimagic field stops casting in combat', () => {
    const s = inTown();
    const pc = archmage(s);
    s.startCombat(s.univ.party.direction);
    s.univ.town!.setField(pc.combatPos.x, pc.combatPos.y, FieldType.FIELD_ANTIMAGIC, true);
    expect(pcCanCastType(s, pc, Skill.MAGE_SPELLS)).toBe(CastStatus.NO_ANTIMAGIC);
  });

  it('reports being dumbfounded when that is what stops them', () => {
    const s = inTown();
    const pc = archmage(s);
    pc.status[Status.DUMB] = 8;
    expect(pcCanCastType(s, pc, Skill.MAGE_SPELLS)).toBe(CastStatus.NO_DUMBFOUNDED);
  });
});

describe('the party a new game starts with', () => {
  it('knows the basic spells, so somebody can actually cast', () => {
    // The regression this pins: the pregen party was created with *no* spells
    // known, so the spell picker reported "Nobody can cast a mage spell". The
    // C++ sets basic_spells in the cPlayer constructor, which every preset
    // runs through.
    const s = inTown();
    for (const pc of s.univ.party.pcs) {
      expect(pc.mageSpells.filter(Boolean).length).toBe(BASIC_SPELLS);
      expect(pc.priestSpells.filter(Boolean).length).toBe(BASIC_SPELLS);
    }
    const mages = s.univ.party.pcs.filter(
      (pc) => pcCanCastType(s, pc, Skill.MAGE_SPELLS) === CastStatus.OK);
    const priests = s.univ.party.pcs.filter(
      (pc) => pcCanCastType(s, pc, Skill.PRIEST_SPELLS) === CastStatus.OK);
    expect(mages.length).toBeGreaterThan(0);
    expect(priests.length).toBeGreaterThan(0);
  });

  it('the starting caster has a non-empty spell list', () => {
    const s = inTown();
    const mage = s.univ.party.pcs.find(
      (pc) => pcCanCastType(s, pc, Skill.MAGE_SPELLS) === CastStatus.OK)!;
    const list = castableSpells(s, mage, Skill.MAGE_SPELLS);
    expect(list).toContain(Spell.LIGHT);
    // Nothing beyond their skill or their spell points should be offered.
    for (const spell of list) {
      expect(SPELLS[spell]!.level ?? 0).toBeLessThanOrEqual(mage.skill(Skill.MAGE_SPELLS));
      expect(SPELLS[spell]!.cost ?? 0).toBeLessThanOrEqual(mage.curSp);
    }
  });

  it('the last 32 spells still have to be learned', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    expect(pc.mageSpells[BASIC_SPELLS]).toBe(false);
    expect(pc.mageSpells[NUM_NORMAL_SPELLS - 1]).toBe(false);
  });
});

describe('the castable list', () => {
  it('offers only what the PC can actually cast right now', () => {
    const s = inTown();
    const pc = archmage(s);
    const town = castableSpells(s, pc, Skill.MAGE_SPELLS);
    expect(town).toContain(Spell.LIGHT);
    expect(town).toContain(Spell.IDENTIFY);
    // Spark is combat-only.
    expect(town).not.toContain(Spell.SPARK);
    s.mode = GameMode.COMBAT;
    const fight = castableSpells(s, pc, Skill.MAGE_SPELLS);
    expect(fight).toContain(Spell.SPARK);
    expect(fight).not.toContain(Spell.IDENTIFY);
  });

  it('is empty for a PC who knows nothing', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.mageSpells.fill(false);
    expect(castableSpells(s, pc, Skill.MAGE_SPELLS)).toEqual([]);
  });
});
