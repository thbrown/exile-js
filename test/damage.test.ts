import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { ItemAbil, ItemType } from '../src/data/item';
import { Attitude, DamageType } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import { TerSpec } from '../src/data/terrain';
import {
  awardXp, damageMonst, damagePc, hitChance, hitParty, killMonst, killPc,
} from '../src/game/damage';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { assignCreature, Creature, CreatureStatus } from '../src/universe/creature';
import { PartyPreset, Player } from '../src/universe/player';
import { MainStatus, Race, Skill, Status, Trait } from '../src/universe/skills';
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

function monster(index: number, level?: number): Creature {
  const template = { ...scen.scenMonsters[index]!, resist: [...scen.scenMonsters[index]!.resist] };
  if (level !== undefined) template.level = level;
  const c = assignCreature(0, {
    number: index, startAttitude: Attitude.HOSTILE_A, startLoc: { x: 10, y: 10 },
    mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
    specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
  } as never, template);
  return c;
}

/** A PC with nothing equipped, so the damage arithmetic is predictable. */
function bareFighter(univ: Universe): Player {
  const pc = univ.party.pcs[0]!;
  pc.items.forEach((_, i) => { pc.equip[i] = false; });
  pc.traits[Trait.TOUGHNESS] = false;
  pc.skills[Skill.LUCK] = 0;
  pc.skills[Skill.DEFENSE] = 0;
  pc.parry = 0;
  pc.maxHealth = 100;
  pc.curHealth = 100;
  return pc;
}

describe('damagePc', () => {
  it('takes unblockable damage straight off the health', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    expect(damagePc(univ, pc, 10, DamageType.UNBLOCKABLE)).toBe(10);
    expect(pc.curHealth).toBe(90);
    expect(univ.party.totalDamTaken).toBe(10);
    expect(univ.transcript.at(-1)).toBe(`  ${pc.name} takes 10.`);
  });

  it('the dead take nothing', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.mainStatus = MainStatus.DEAD;
    expect(damagePc(univ, pc, 50, DamageType.UNBLOCKABLE)).toBe(0);
  });

  it('reports "No damage" when the reductions eat it all', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.traits[Trait.TOUGHNESS] = true;
    expect(damagePc(univ, pc, 1, DamageType.WEAPON)).toBe(0);
    expect(pc.curHealth).toBe(100);
    expect(univ.transcript.at(-1)).toBe('  No damage.');
  });

  it('invulnerability stops everything except assassination damage', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.status[Status.INVULNERABLE] = 3;
    expect(damagePc(univ, pc, 40, DamageType.FIRE)).toBe(0);
    expect(damagePc(univ, pc, 40, DamageType.SPECIAL)).toBe(40);
  });

  it('magic resistance halves fire, and a curse on it doubles', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.status[Status.MAGIC_RESISTANCE] = 4;
    expect(damagePc(univ, pc, 20, DamageType.FIRE)).toBe(10);
    pc.status[Status.MAGIC_RESISTANCE] = -4;
    expect(damagePc(univ, pc, 20, DamageType.COLD)).toBe(40);
  });

  it('a ring of full protection quarters it at strength 7', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.FULL_PROTECTION, abilStrength: 7,
    };
    pc.equip[0] = true;
    expect(damagePc(univ, pc, 40, DamageType.MAGIC)).toBe(10);
    pc.items[0]!.abilStrength = 3;
    expect(damagePc(univ, pc, 40, DamageType.MAGIC)).toBe(20);
    // It does nothing against a sword.
    expect(damagePc(univ, pc, 40, DamageType.WEAPON)).toBe(40);
  });

  it('parry only helps against weapons', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.parry = 40; // a quarter of it comes off
    expect(damagePc(univ, pc, 20, DamageType.WEAPON)).toBe(10);
    expect(damagePc(univ, pc, 20, DamageType.FIRE)).toBe(20);
  });

  it('protection from a species halves it, and humanoids count twice over', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.PROTECT_FROM_SPECIES, abilData: Race.HUMANOID, abilStrength: 4,
    };
    pc.equip[0] = true;
    // A generic humanoid: one halving, from the exact match.
    expect(damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.HUMANOID)).toBe(20);
    // A nephil is a humanoid *and* its own species, so it halves once here.
    expect(damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.NEPHIL)).toBe(20);
    // Nothing at all against a beast.
    expect(damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.BEAST)).toBe(40);
  });

  it('protection from undead also covers skeletons', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.PROTECT_FROM_SPECIES, abilData: Race.UNDEAD, abilStrength: 4,
    };
    pc.equip[0] = true;
    expect(damagePc(univ, pc, 40, DamageType.UNBLOCKABLE, Race.SKELETAL)).toBe(20);
  });

  it('a hit stirs a sleeping PC toward waking', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.status[Status.ASLEEP] = 3;
    damagePc(univ, pc, 5, DamageType.UNBLOCKABLE);
    expect(pc.status[Status.ASLEEP]).toBe(2);
  });

  it('empties the health bar first and only kills on the next blow', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.curHealth = 4;
    damagePc(univ, pc, 20, DamageType.UNBLOCKABLE);
    expect(pc.curHealth).toBe(0);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
    damagePc(univ, pc, 5, DamageType.UNBLOCKABLE);
    expect(pc.mainStatus).toBe(MainStatus.DEAD);
  });

  it('a big enough blow at zero health turns the PC to dust', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.curHealth = 0;
    damagePc(univ, pc, 30, DamageType.UNBLOCKABLE);
    expect(pc.mainStatus).toBe(MainStatus.DUST);
    expect(univ.transcript).toContain(`  ${pc.name} is obliterated!`);
  });

  it('hitParty hits everyone still standing', () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => {
      pc.maxHealth = 100;
      pc.curHealth = 100;
      pc.items.forEach((_, i) => { pc.equip[i] = false; });
      // Toughness would take one off and make the arithmetic per-PC.
      pc.traits[Trait.TOUGHNESS] = false;
      pc.skills[Skill.LUCK] = 0;
    });
    univ.party.pcs[2]!.mainStatus = MainStatus.DEAD;
    const before = univ.party.pcs[2]!.curHealth;
    hitParty(univ, 10, DamageType.UNBLOCKABLE);
    expect(univ.party.pcs[0]!.curHealth).toBe(90);
    expect(univ.party.pcs[1]!.curHealth).toBe(90);
    expect(univ.party.pcs[2]!.curHealth).toBe(before);
  });
});

describe('killPc', () => {
  it('luck can save you outright', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 20; // hit_chance 99, so it nearly always saves
    let saved = 0;
    for (let i = 0; i < 20; i++) {
      pc.mainStatus = MainStatus.ALIVE;
      killPc(univ, pc, MainStatus.DEAD);
      if (pc.mainStatus === MainStatus.ALIVE) saved++;
    }
    expect(saved).toBeGreaterThan(15);
    expect(univ.transcript).toContain('  But you luck out!');
  });

  it('spends a life-saving item instead of the life', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.curHealth = 0;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT, name: 'amulet',
      ability: ItemAbil.LIFE_SAVING, abilStrength: 1,
    };
    pc.equip[0] = true;
    killPc(univ, pc, MainStatus.DEAD);
    expect(pc.mainStatus).toBe(MainStatus.ALIVE);
    expect(pc.curHealth).toBe(pc.maxHealth);
    expect(pc.items[0]!.ability).not.toBe(ItemAbil.LIFE_SAVING);
    expect(univ.transcript).toContain('  Life saved!');
  });

  it('petrification is not something an amulet understands', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.LIFE_SAVING, abilStrength: 1,
    };
    pc.equip[0] = true;
    killPc(univ, pc, MainStatus.STONE);
    expect(pc.mainStatus).toBe(MainStatus.STONE);
  });

  it('drops the whole pack on the floor and leaves a stain', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.items[0] = { ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'sword' };
    pc.items[1] = { ...pc.items[1]!, variety: ItemType.POTION, name: 'potion' };
    const town = univ.town!;
    const itemsBefore = town.items.length;
    const where = univ.party.townLoc;

    killPc(univ, pc, MainStatus.DEAD);
    expect(pc.mainStatus).toBe(MainStatus.DEAD);
    expect(town.items.length).toBe(itemsBefore + 2);
    expect(pc.items[0]!.variety).toBe(ItemType.NO_ITEM);
    expect(town.hasField(where.x, where.y, FieldType.SFX_LARGE_BLOOD)).toBe(true);
    // The active PC moves on to someone alive.
    expect(univ.party.pcs[univ.curPc]!.isAlive).toBe(true);
  });

  it('a slith leaves slime, and dust leaves ash', () => {
    const { univ } = newGame();
    const pc = bareFighter(univ);
    pc.skills[Skill.LUCK] = 0;
    pc.race = Race.SLIME;
    killPc(univ, pc, MainStatus.DEAD);
    const { x, y } = univ.party.townLoc;
    expect(univ.town!.hasField(x, y, FieldType.SFX_LARGE_SLIME)).toBe(true);

    const other = univ.party.pcs[1]!;
    other.skills[Skill.LUCK] = 0;
    killPc(univ, other, MainStatus.DUST);
    expect(univ.town!.hasField(x, y, FieldType.SFX_ASH)).toBe(true);
  });
});

describe('damageMonst', () => {
  it('scales by the monster resistance for that damage type', () => {
    const { univ } = newGame();
    const monst = monster(1, 40);
    monst.mon.armor = 0;
    monst.mon.resist[DamageType.FIRE] = 50;
    monst.health = 500;
    // Level 40 always makes the elemental saving throw, so 20 -> 10 -> 5.
    expect(damageMonst(univ, monst, 0, 20, DamageType.FIRE)).toBe(5);
  });

  it('invulnerable monsters take a tenth, and it stacks with the status', () => {
    const { univ } = newGame();
    const monst = monster(1, 1);
    monst.mon.armor = 0;
    monst.mon.invuln = true;
    monst.health = 5000;
    expect(damageMonst(univ, monst, 0, 1000, DamageType.UNBLOCKABLE)).toBe(100);
    monst.status[Status.INVULNERABLE] = 3;
    expect(damageMonst(univ, monst, 0, 1000, DamageType.UNBLOCKABLE)).toBe(10);
    // Assassination damage goes through regardless.
    expect(damageMonst(univ, monst, 0, 100, DamageType.SPECIAL)).toBe(100);
  });

  it('a hit alerts the monster and costs it morale', () => {
    const { univ } = newGame();
    const monst = monster(1, 10);
    monst.mon.armor = 0;
    monst.health = 500;
    monst.active = CreatureStatus.IDLE;
    const morale = monst.morale;
    damageMonst(univ, monst, 0, 12, DamageType.UNBLOCKABLE);
    expect(monst.active).toBe(CreatureStatus.ALERTED);
    // >0, >5 and >10 each cost one.
    expect(monst.morale).toBe(morale - 3);
  });

  it('dying runs kill_monst: the SDF, the mess, the count and the xp', () => {
    const { univ } = newGame();
    const monst = monster(1, 5);
    monst.mon.armor = 0;
    monst.mon.race = Race.SKELETAL;
    monst.spec1 = 3;
    monst.spec2 = 4;
    monst.health = 1;
    const town = univ.town!;
    const killedBefore = town.monstersKilled;
    const xpBefore = univ.party.pcs[0]!.experience;

    damageMonst(univ, monst, 0, 50, DamageType.UNBLOCKABLE);
    expect(monst.active).toBe(CreatureStatus.DEAD);
    expect(univ.party.getSdf(3, 4)).toBe(1);
    expect(monst.spec1).toBe(0); // so a summoned one can't come back
    expect(town.monstersKilled).toBe(killedBefore + 1);
    expect(town.hasField(monst.curLoc.x, monst.curLoc.y, FieldType.SFX_BONES)).toBe(true);
    expect(univ.party.pcs[0]!.experience).toBeGreaterThan(xpBefore);
    expect(univ.party.totalMKilled).toBe(1);
    expect(univ.transcript).toContain(`  ${monst.getName()} dies.`);
  });

  it('hurting a friendly is noticed', () => {
    const { univ } = newGame();
    const monst = monster(1, 10);
    monst.mon.armor = 0;
    monst.health = 500;
    monst.attitude = Attitude.DOCILE;
    damageMonst(univ, monst, 0, 20, DamageType.UNBLOCKABLE);
    expect(univ.transcript).toContain('Damaged an innocent.');
    expect(monst.attitude).toBe(Attitude.HOSTILE_A);
  });

  it('gives nothing for a monster the party summoned itself', () => {
    const { univ } = newGame();
    const monst = monster(1, 5);
    monst.summonTime = 10;
    monst.partySummoned = true;
    const xpBefore = univ.party.pcs[0]!.experience;
    killMonst(univ, monst, 0);
    expect(univ.party.pcs[0]!.experience).toBe(xpBefore);
    expect(univ.party.totalMKilled).toBe(0);
  });
});

describe('awardXp', () => {
  it('scales the award by level and levels the PC up', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.level = 1;
    pc.experience = 0;
    pc.expAdj = 100;
    const hpBefore = pc.maxHealth;
    // xp_percent[0] = 150, so an award at level 1 is worth half again.
    awardXp(univ, 0, 100);
    expect(pc.experience).toBe(150);
    expect(pc.level).toBeGreaterThan(1);
    expect(pc.maxHealth).toBeGreaterThan(hpBefore);
    expect(pc.skillPts).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('is level'))).toBe(true);
  });

  it('caps at 15000 experience and level 50', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.experience = 14990;
    awardXp(univ, 0, 200);
    expect(pc.experience).toBe(15000);
    pc.level = 50;
    awardXp(univ, 0, 100);
    expect(pc.level).toBe(50);
  });

  it('gives the dead nothing, and refuses a negative award', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.mainStatus = MainStatus.DEAD;
    pc.experience = 0;
    awardXp(univ, 0, 100);
    expect(pc.experience).toBe(0);
    pc.mainStatus = MainStatus.ALIVE;
    awardXp(univ, 0, -50);
    expect(pc.experience).toBe(0);
  });
});

describe('hit_chance', () => {
  it('reads the table and flattens out at 99', () => {
    expect(hitChance(0)).toBe(20);
    expect(hitChance(5)).toBe(55);
    expect(hitChance(20)).toBe(99);
    expect(hitChance(200)).toBe(99);
  });
});

describe('damaging terrain', () => {
  it('hurts the whole party when they walk into it', async () => {
    const { univ, session } = newGame();
    // Find a town with damaging terrain and stand the party on it.
    let found: { town: number; x: number; y: number } | null = null;
    for (let t = 0; t < scen.towns.length && !found; t++) {
      const town = scen.towns[t]!;
      for (let x = 0; x < town.maxDim && !found; x++) {
        for (let y = 0; y < town.maxDim; y++) {
          const ter = town.terrain[x]![y]!;
          if (scen.terTypes[ter]!.special === TerSpec.DAMAGING) {
            found = { town: t, x, y };
            break;
          }
        }
      }
    }
    if (!found) return; // valleydy may have none; nothing to assert then
    session.startTownMode(found.town, FORCED_ENTRY);
    univ.party.pcs.forEach((pc) => {
      pc.maxHealth = 200;
      pc.curHealth = 200;
      pc.items.forEach((_, i) => { pc.equip[i] = false; });
    });
    await session.moveTo({ x: found.x, y: found.y });
    const hurt = univ.party.pcs.filter((pc) => pc.curHealth < 200).length;
    expect(hurt).toBeGreaterThan(0);
  });
});
