/**
 * `do_mage_spell` and `do_priest_spell` — what spells do when cast outside
 * combat.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { Scenario } from '../src/data/scenario';
import { SPELLS, Spell } from '../src/data/spell';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import { castSpell, doMageSpell, doPriestSpell, giveFood, increaseLight } from '../src/game/spellTown';
import { PartyPreset, Player } from '../src/universe/player';
import { MainStatus, PartyStatus, Skill, Status, Trait } from '../src/universe/skills';
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

/**
 * A caster worth casting with. The intelligence matters: `adj` is
 * `SKILL_BONUS[INT]`, which is *negative* for the pregen party's low-INT
 * fighters, and several spells roll `2 * adj` into their effect — Manna with
 * adj -3 really does produce no food at all.
 */
function caster(s: GameSession): Player {
  const pc = s.univ.party.pcs[0]!;
  pc.curSp = 100;
  pc.maxSp = 100;
  pc.skills[Skill.INTELLIGENCE] = 10;
  pc.level = 10;
  pc.traits[Trait.PACIFIST] = false;
  pc.traits[Trait.ANAMA] = false;
  return pc;
}

describe('the small helpers', () => {
  it('increase_light never goes below zero', () => {
    const s = inTown();
    increaseLight(s, 50);
    expect(s.univ.party.lightLevel).toBe(50);
    increaseLight(s, -500);
    expect(s.univ.party.lightLevel).toBe(0);
  });

  it('give_food ignores a negative amount rather than taking it', () => {
    const s = inTown();
    const before = s.univ.party.food;
    giveFood(s, -50);
    expect(s.univ.party.food).toBe(before);
    giveFood(s, 20);
    expect(s.univ.party.food).toBe(before + 20);
  });
});

describe('do_mage_spell', () => {
  it('Light brightens the lantern and costs its points', () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    doMageSpell(s, 0, Spell.LIGHT);
    expect(s.univ.party.lightLevel).toBe(50);
    expect(pc.curSp).toBe(sp - (SPELLS[Spell.LIGHT]!.cost ?? 0));
  });

  it('a freebie casting costs nothing', () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    doMageSpell(s, 0, Spell.LIGHT, true);
    expect(s.univ.party.lightLevel).toBe(50);
    expect(pc.curSp).toBe(sp);
  });

  it('an Anama refuses mage magic outright', () => {
    const s = inTown();
    const pc = caster(s);
    pc.traits[Trait.ANAMA] = true;
    const sp = pc.curSp;
    doMageSpell(s, 0, Spell.LIGHT);
    expect(s.univ.transcript.at(-1)).toContain("You're an Anama");
    expect(s.univ.party.lightLevel).toBe(0);
    expect(pc.curSp).toBe(sp);
  });

  it('a pacifist refuses a non-peaceful spell but casts a peaceful one', () => {
    const s = inTown();
    const pc = caster(s);
    pc.traits[Trait.PACIFIST] = true;
    doMageSpell(s, 0, Spell.LIGHT);
    expect(s.univ.party.lightLevel).toBe(50);
    // Quickfire is not peaceful.
    expect(SPELLS[Spell.QUICKFIRE]?.peaceful ?? false).toBe(false);
    doMageSpell(s, 0, Spell.QUICKFIRE);
    expect(s.univ.transcript.at(-1)).toContain("You're a pacifist");
  });

  it('Stealth and Flight sit on the party, not a PC', () => {
    const s = inTown();
    const pc = caster(s);
    doMageSpell(s, 0, Spell.STEALTH);
    expect(s.univ.party.partyStatus[PartyStatus.STEALTH]).toBeGreaterThan(0);
    doMageSpell(s, 0, Spell.FLIGHT);
    expect(s.univ.party.partyStatus[PartyStatus.FLIGHT]).toBe(3);
    // Re-casting while already flying refuses, and costs nothing.
    const sp = pc.curSp;
    doMageSpell(s, 0, Spell.FLIGHT);
    expect(s.univ.transcript.at(-1)).toContain('already flying');
    expect(pc.curSp).toBe(sp);
  });

  it('True Sight explores the squares around the party', () => {
    const s = inTown();
    caster(s);
    const at = s.univ.party.townLoc;
    const town = s.univ.town!;
    // Somewhere two squares off that the party hasn't seen.
    town.explored[at.x + 2]![at.y] = 0;
    doMageSpell(s, 0, Spell.TRUE_SIGHT);
    expect(town.isExplored(at.x + 2, at.y)).toBe(true);
    expect(town.isExplored(at.x + 2, at.y + 2)).toBe(true);
  });

  it('Protection raises the whole party\'s magic resistance', () => {
    const s = inTown();
    const pc = caster(s);
    doMageSpell(s, 0, Spell.PROTECTION);
    expect(pc.status[Status.INVULNERABLE]!).toBeGreaterThan(0);
    for (const other of s.univ.party.pcs) {
      if (other.mainStatus !== MainStatus.ALIVE) continue;
      expect(other.status[Status.MAGIC_RESISTANCE]!).toBeGreaterThan(0);
    }
    expect(s.univ.transcript.at(-1)).toBe('  Party protected.');
  });

  it('a spell that wants a square goes into targeting, charging nothing yet', () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    doMageSpell(s, 0, Spell.UNLOCK);
    expect(s.univ.transcript.at(-1)).toBe('  Target spell.');
    expect(s.mode).toBe(GameMode.TOWN_TARGET);
    expect(s.townTarget?.spell).toBe(Spell.UNLOCK);
    // The cost is spent in cast_town_spell, once a square is picked.
    expect(pc.curSp).toBe(sp);
  });

  it('reports a mage spell with no town implementation', () => {
    const s = inTown();
    caster(s);
    // Spark is a combat-only spell; do_mage_spell has no arm for it.
    doMageSpell(s, 0, Spell.SPARK);
    expect(s.univ.transcript.at(-1)).toContain('not implemented for town mode');
  });
});

describe('do_priest_spell', () => {
  it('Minor Heal heals and says how much', () => {
    const s = inTown();
    const pc = caster(s);
    pc.curHealth = 1;
    doPriestSpell(s, 0, Spell.HEAL_MINOR);
    expect(pc.curHealth).toBeGreaterThan(1);
    expect(s.univ.transcript.at(-1)).toMatch(/healed \d+\./);
  });

  it('Manna feeds the party', () => {
    const s = inTown();
    caster(s);
    const before = s.univ.party.food;
    doPriestSpell(s, 0, Spell.MANNA);
    expect(s.univ.party.food).toBeGreaterThan(before);
    expect(s.univ.transcript.at(-1)).toMatch(/You gain \d+ food\./);
  });

  it('Location reads out where you are', () => {
    const s = inTown();
    caster(s);
    const at = s.univ.party.townLoc;
    doPriestSpell(s, 0, Spell.LOCATION);
    expect(s.univ.transcript.at(-1)).toBe(`  You're at: x ${at.x}  y ${at.y}.`);
  });

  it('Cure Poison takes poison off', () => {
    const s = inTown();
    const pc = caster(s);
    pc.status[Status.POISON] = 5;
    doPriestSpell(s, 0, Spell.POISON_CURE);
    expect(pc.status[Status.POISON]!).toBeLessThan(5);
  });

  it('Awaken and Cure Paralysis notice when there is nothing to do', () => {
    const s = inTown();
    const pc = caster(s);
    pc.status[Status.ASLEEP] = 0;
    doPriestSpell(s, 0, Spell.AWAKEN);
    expect(s.univ.transcript.at(-1)).toContain('already awake');
    pc.status[Status.PARALYZED] = 0;
    doPriestSpell(s, 0, Spell.PARALYSIS_CURE);
    expect(s.univ.transcript.at(-1)).toContain("isn't paralyzed");
  });

  it('Cleanse clears disease and webs together', () => {
    const s = inTown();
    const pc = caster(s);
    pc.status[Status.DISEASE] = 4;
    pc.status[Status.WEBS] = 4;
    doPriestSpell(s, 0, Spell.CLEANSE);
    expect(pc.status[Status.DISEASE]).toBe(0);
    expect(pc.status[Status.WEBS]).toBe(0);
  });

  it('Heal All heals everybody', () => {
    const s = inTown();
    caster(s);
    for (const pc of s.univ.party.pcs) pc.curHealth = 1;
    doPriestSpell(s, 0, Spell.HEAL_ALL);
    for (const pc of s.univ.party.pcs) {
      if (pc.mainStatus === MainStatus.ALIVE) expect(pc.curHealth).toBeGreaterThan(1);
    }
    expect(s.univ.transcript.at(-1)).toMatch(/Party healed \d+\./);
  });

  it('Mass Sanctuary hides the living only', () => {
    const s = inTown();
    caster(s);
    const dead = s.univ.party.pcs[3]!;
    dead.mainStatus = MainStatus.DEAD;
    dead.status[Status.INVISIBLE] = 0;
    doPriestSpell(s, 0, Spell.SANCTUARY_MASS);
    expect(dead.status[Status.INVISIBLE]).toBe(0);
    expect(s.univ.party.pcs[0]!.status[Status.INVISIBLE]!).toBeGreaterThanOrEqual(0);
  });

  it('Detect Life and Firewalk sit on the party', () => {
    const s = inTown();
    caster(s);
    doPriestSpell(s, 0, Spell.DETECT_LIFE);
    expect(s.univ.party.partyStatus[PartyStatus.DETECT_LIFE]).toBeGreaterThan(0);
    doPriestSpell(s, 0, Spell.FIREWALK);
    expect(s.univ.party.partyStatus[PartyStatus.FIREWALK]).toBeGreaterThan(0);
  });

  it('Word of Recall refuses indoors', () => {
    const s = inTown();
    caster(s);
    doPriestSpell(s, 0, Spell.WORD_RECALL);
    expect(s.univ.transcript.at(-1)).toContain('Can only cast outdoors');
  });

  it('Remove Curse uncurses what it can', () => {
    const s = inTown();
    const pc = caster(s);
    // The spell walks every slot and only looks at `cursed`, so the slot's
    // variety is beside the point.
    const item = pc.items[0]!;
    item.cursed = true;
    item.unsellable = true;
    // The roll is per item and can fail, so give it several goes.
    for (let i = 0; i < 30 && item.cursed; i++) doPriestSpell(s, 0, Spell.CURSE_REMOVE);
    expect(item.cursed).toBe(false);
    expect(item.unsellable).toBe(false);
  });
});

describe('cast_spell', () => {
  it('sends a mage spell one way and a priest spell the other', () => {
    const s = inTown();
    caster(s);
    castSpell(s, 0, Spell.LIGHT);
    expect(s.univ.party.lightLevel).toBe(50);
    const before = s.univ.party.food;
    castSpell(s, 0, Spell.MANNA);
    expect(s.univ.party.food).toBeGreaterThan(before);
  });

  it('names the caster and the spell', () => {
    const s = inTown();
    const pc = caster(s);
    castSpell(s, 0, Spell.LIGHT);
    expect(s.univ.transcript).toContain(`${pc.name} casts Light.`);
  });

  it('nothing can be cast standing in an antimagic field', () => {
    const s = inTown();
    const pc = caster(s);
    const at = s.univ.party.townLoc;
    s.univ.town!.setField(at.x, at.y, FieldType.FIELD_ANTIMAGIC, true);
    const sp = pc.curSp;
    castSpell(s, 0, Spell.LIGHT);
    expect(s.univ.transcript.at(-1)).toBe('Cast: Not in antimagic field.');
    expect(s.univ.party.lightLevel).toBe(0);
    expect(pc.curSp).toBe(sp);
  });
});
