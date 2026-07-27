/**
 * Casting in combat — the `refer` dispatcher and the immediate-cast spells.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { SPELLS, Spell, SpellRefer } from '../src/data/spell';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import { castableSpells } from '../src/game/spellCast';
import { combatCastSpell, combatImmedMageCast, doShockwave } from '../src/game/spellCombat';
import { PartyPreset, Player } from '../src/universe/player';
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

/** A party in a fight, with PC 0 active and able to cast anything. */
function inCombat(): { s: GameSession; pc: Player } {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  const pc = s.univ.party.pcs[0]!;
  pc.mageSpells.fill(true);
  pc.priestSpells.fill(true);
  pc.skills[Skill.MAGE_SPELLS] = 20;
  pc.skills[Skill.PRIEST_SPELLS] = 20;
  pc.skills[Skill.INTELLIGENCE] = 12;
  pc.level = 20;
  pc.curSp = 500;
  pc.maxSp = 500;
  pc.traits[Trait.PACIFIST] = false;
  pc.traits[Trait.ANAMA] = false;
  s.startCombat(s.univ.party.direction);
  s.univ.curPc = 0;
  pc.ap = 20;
  return { s, pc };
}

describe('every combat-castable spell is accounted for', () => {
  it('none of them falls through to the town-mode error', () => {
    const { s, pc } = inCombat();
    const bad: string[] = [];
    for (const type of [Skill.MAGE_SPELLS, Skill.PRIEST_SPELLS]) {
      for (const spell of castableSpells(s, pc, type)) {
        pc.curSp = 500;
        pc.ap = 20;
        s.mode = GameMode.COMBAT;
        const before = s.univ.transcript.length;
        combatCastSpell(s, spell);
        // Read only what this cast added, and only while the buffer hasn't
        // rolled — the transcript is a rolling window.
        const said = s.univ.transcript.slice(Math.max(0, before)).join(' | ');
        if (said.includes('not implemented for town mode')) bad.push(String(spell));
      }
    }
    expect(bad).toEqual([]);
  });

  it('the targeted ones say what they need, rather than talking about towns', () => {
    const { s } = inCombat();
    // Spark is REFER_TARGET: it wants a square.
    expect(SPELLS[Spell.SPARK]?.refer).toBe(SpellRefer.TARGET);
    combatCastSpell(s, Spell.SPARK);
    expect(s.univ.transcript.at(-1)).toContain('needs combat targeting');
    expect(s.univ.transcript.at(-1)).not.toContain('town mode');
  });

  it('a targeted spell spends neither points nor action points yet', () => {
    const { s, pc } = inCombat();
    const sp = pc.curSp;
    const ap = pc.ap;
    combatCastSpell(s, Spell.SPARK);
    expect(pc.curSp).toBe(sp);
    expect(pc.ap).toBe(ap);
  });
});

describe('the refer dispatcher', () => {
  it('REFER_YES runs the town implementation and spends the AP', () => {
    const { s, pc } = inCombat();
    // Light is REFER_YES, and works the same in a fight as out of one.
    expect(SPELLS[Spell.LIGHT]?.refer).toBe(SpellRefer.YES);
    const ap = pc.ap;
    combatCastSpell(s, Spell.LIGHT);
    expect(s.univ.party.lightLevel).toBe(50);
    expect(pc.ap).toBe(ap - 6);
  });

  it('REFER_IMMED resolves at once', () => {
    const { s, pc } = inCombat();
    expect(SPELLS[Spell.HASTE]?.refer).toBe(SpellRefer.IMMED);
    combatCastSpell(s, Spell.HASTE);
    // Haste is a negative slow.
    expect(pc.status[Status.HASTE_SLOW]!).toBeGreaterThan(0);
    expect(s.univ.transcript.at(-1)).toContain('hasted');
  });

  it('the active PC is the caster, whoever else could cast', () => {
    const { s } = inCombat();
    const other = s.univ.party.pcs[2]!;
    other.mageSpells.fill(true);
    other.skills[Skill.MAGE_SPELLS] = 20;
    other.curSp = 100;
    s.univ.curPc = 2;
    other.ap = 20;
    combatCastSpell(s, Spell.LIGHT);
    expect(s.univ.transcript).toContain(`${other.name} casts Light.`);
  });

  it('a pacifist still refuses the violent ones', () => {
    const { s, pc } = inCombat();
    pc.traits[Trait.PACIFIST] = true;
    combatCastSpell(s, Spell.SLOW_GROUP);
    expect(s.univ.transcript.at(-1)).toContain("You're a pacifist");
  });
});

describe('combat_immed_mage_cast', () => {
  it('Strength and Haste push their statuses the good way', () => {
    const { s, pc } = inCombat();
    combatImmedMageCast(s, 0, Spell.STRENGTH);
    expect(pc.status[Status.BLESS_CURSE]!).toBeGreaterThan(0);
    combatImmedMageCast(s, 0, Spell.HASTE_MINOR);
    expect(pc.status[Status.HASTE_SLOW]!).toBeGreaterThan(0);
  });

  it('Envenom poisons the weapon', () => {
    const { s, pc } = inCombat();
    combatImmedMageCast(s, 0, Spell.ENVENOM);
    expect(pc.status[Status.POISONED_WEAPON]!).toBeGreaterThan(0);
    expect(s.univ.transcript.at(-1)).toContain('receives venom');
  });

  it('Major Haste hastes the whole party', () => {
    const { s } = inCombat();
    combatImmedMageCast(s, 0, Spell.HASTE_MAJOR);
    for (const pc of s.univ.party.pcs) {
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      expect(pc.status[Status.HASTE_SLOW]!).toBeGreaterThan(0);
    }
    expect(s.univ.transcript.at(-1)).toBe('  Party hasted.');
  });

  it('a group spell only touches hostile monsters in range and in sight', () => {
    const { s, pc } = inCombat();
    const monsters = s.univ.town!.monsters.filter((m) => m.isAlive && !m.isFriendly);
    expect(monsters.length).toBeGreaterThan(0);
    // Put one right next to the caster and one far away.
    const near = monsters[0]!;
    near.curLoc = { x: pc.combatPos.x + 1, y: pc.combatPos.y };
    const far = monsters[1];
    if (far) far.curLoc = { x: pc.combatPos.x + 40, y: pc.combatPos.y + 40 };
    combatImmedMageCast(s, 0, Spell.SLOW_GROUP);
    // HASTE_SLOW is one signed status: positive is hasted, negative slowed. So
    // a slowed monster goes *below* zero — `slow()` applies -howMuch.
    expect(near.status[Status.HASTE_SLOW]!).toBeLessThan(0);
    if (far) expect(far.status[Status.HASTE_SLOW] ?? 0).toBe(0);
  });

  it('Shockwave spares whoever stands on it and hurts everyone else', () => {
    const { s, pc } = inCombat();
    const other = s.univ.party.pcs.find(
      (p) => p !== pc && p.mainStatus === MainStatus.ALIVE)!;
    other.combatPos = { x: pc.combatPos.x + 3, y: pc.combatPos.y };
    other.curHealth = other.maxHealth = 200;
    pc.curHealth = pc.maxHealth = 200;
    doShockwave(s, pc.combatPos);
    expect(pc.curHealth).toBe(200);
    expect(other.curHealth).toBeLessThan(200);
  });
});
