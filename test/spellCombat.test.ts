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
import {
  cancelSpellTargeting, castCollected, doCombatCast, placeTarget,
} from '../src/game/spellCombatTarget';
import { FieldType } from '../src/data/fields';
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
  it('none of them falls through to the town-mode error', async () => {
    const { s, pc } = inCombat();
    const bad: string[] = [];
    for (const type of [Skill.MAGE_SPELLS, Skill.PRIEST_SPELLS]) {
      for (const spell of castableSpells(s, pc, type)) {
        pc.curSp = 500;
        pc.ap = 20;
        s.mode = GameMode.COMBAT;
        const before = s.univ.transcript.length;
        await combatCastSpell(s, spell);
        // Read only what this cast added, and only while the buffer hasn't
        // rolled — the transcript is a rolling window.
        const said = s.univ.transcript.slice(Math.max(0, before)).join(' | ');
        if (said.includes('not implemented for town mode')) bad.push(String(spell));
      }
    }
    expect(bad).toEqual([]);
  });

  it('a targeted one goes into targeting rather than resolving', async () => {
    const { s } = inCombat();
    // Spark is REFER_TARGET: it wants a square.
    expect(SPELLS[Spell.SPARK]?.refer).toBe(SpellRefer.TARGET);
    await combatCastSpell(s, Spell.SPARK);
    expect(s.mode).toBe(GameMode.SPELL_TARGET);
    expect(s.spellTargeting?.spell).toBe(Spell.SPARK);
    expect(s.univ.transcript.at(-1)).toContain("'m' to cancel");
  });

  it('a targeted spell spends neither points nor action points yet', async () => {
    const { s, pc } = inCombat();
    const sp = pc.curSp;
    const ap = pc.ap;
    await combatCastSpell(s, Spell.SPARK);
    expect(pc.curSp).toBe(sp);
    expect(pc.ap).toBe(ap);
  });
});

describe('the refer dispatcher', () => {
  it('REFER_YES runs the town implementation and spends the AP', async () => {
    const { s, pc } = inCombat();
    // Light is REFER_YES, and works the same in a fight as out of one.
    expect(SPELLS[Spell.LIGHT]?.refer).toBe(SpellRefer.YES);
    const ap = pc.ap;
    await combatCastSpell(s, Spell.LIGHT);
    expect(s.univ.party.lightLevel).toBe(50);
    expect(pc.ap).toBe(ap - 6);
  });

  /**
   * `combatCastSpell` is a free function, not a `GameSession` method, so it
   * has to trigger the same turn-advance `pc_combat_move`/`char_parry`/etc.
   * get from their own call to `afterCombatAction` — otherwise the caster's
   * AP hits 0 but the game never hands the turn to anyone else, and nothing
   * stops the same PC opening the spell dialog and casting again forever.
   */
  it('running out of AP after a cast hands the turn to the next PC', async () => {
    const { s, pc } = inCombat();
    pc.ap = 6; // exactly enough for one REFER_YES cast
    const next = s.univ.party.pcs[1]!;
    next.ap = 20;
    await combatCastSpell(s, Spell.LIGHT);
    expect(pc.ap).toBe(0);
    expect(s.univ.curPc).not.toBe(0);
  });

  it('REFER_IMMED resolves at once', async () => {
    const { s, pc } = inCombat();
    expect(SPELLS[Spell.HASTE]?.refer).toBe(SpellRefer.IMMED);
    await combatCastSpell(s, Spell.HASTE);
    // Haste is a negative slow.
    expect(pc.status[Status.HASTE_SLOW]!).toBeGreaterThan(0);
    expect(s.univ.transcript.at(-1)).toContain('hasted');
  });

  it('the active PC is the caster, whoever else could cast', async () => {
    const { s } = inCombat();
    const other = s.univ.party.pcs[2]!;
    other.mageSpells.fill(true);
    other.skills[Skill.MAGE_SPELLS] = 20;
    other.curSp = 100;
    s.univ.curPc = 2;
    other.ap = 20;
    await combatCastSpell(s, Spell.LIGHT);
    expect(s.univ.transcript).toContain(`${other.name} casts Light.`);
  });

  it('a pacifist still refuses the violent ones', async () => {
    const { s, pc } = inCombat();
    pc.traits[Trait.PACIFIST] = true;
    await combatCastSpell(s, Spell.SLOW_GROUP);
    expect(s.univ.transcript.at(-1)).toContain("You're a pacifist");
  });
});

describe('combat_immed_mage_cast', () => {
  it('Strength and Haste push their statuses the good way', async () => {
    const { s, pc } = inCombat();
    await combatImmedMageCast(s, 0, Spell.STRENGTH);
    expect(pc.status[Status.BLESS_CURSE]!).toBeGreaterThan(0);
    await combatImmedMageCast(s, 0, Spell.HASTE_MINOR);
    expect(pc.status[Status.HASTE_SLOW]!).toBeGreaterThan(0);
  });

  it('Envenom poisons the weapon', async () => {
    const { s, pc } = inCombat();
    await combatImmedMageCast(s, 0, Spell.ENVENOM);
    expect(pc.status[Status.POISONED_WEAPON]!).toBeGreaterThan(0);
    expect(s.univ.transcript.at(-1)).toContain('receives venom');
  });

  it('Major Haste hastes the whole party', async () => {
    const { s } = inCombat();
    await combatImmedMageCast(s, 0, Spell.HASTE_MAJOR);
    for (const pc of s.univ.party.pcs) {
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      expect(pc.status[Status.HASTE_SLOW]!).toBeGreaterThan(0);
    }
    expect(s.univ.transcript.at(-1)).toBe('  Party hasted.');
  });

  it('a group spell only touches hostile monsters in range and in sight', async () => {
    const { s, pc } = inCombat();
    const monsters = s.univ.town!.monsters.filter((m) => m.isAlive && !m.isFriendly);
    expect(monsters.length).toBeGreaterThan(0);
    // Put one right next to the caster and one far away.
    const near = monsters[0]!;
    near.curLoc = { x: pc.combatPos.x + 1, y: pc.combatPos.y };
    const far = monsters[1];
    if (far) far.curLoc = { x: pc.combatPos.x + 40, y: pc.combatPos.y + 40 };
    await combatImmedMageCast(s, 0, Spell.SLOW_GROUP);
    // HASTE_SLOW is one signed status: positive is hasted, negative slowed. So
    // a slowed monster goes *below* zero — `slow()` applies -howMuch.
    expect(near.status[Status.HASTE_SLOW]!).toBeLessThan(0);
    if (far) expect(far.status[Status.HASTE_SLOW] ?? 0).toBe(0);
  });

  it('Shockwave spares whoever stands on it and hurts everyone else', async () => {
    const { s, pc } = inCombat();
    const other = s.univ.party.pcs.find(
      (p) => p !== pc && p.mainStatus === MainStatus.ALIVE)!;
    other.combatPos = { x: pc.combatPos.x + 3, y: pc.combatPos.y };
    other.curHealth = other.maxHealth = 200;
    pc.curHealth = pc.maxHealth = 200;
    await doShockwave(s, pc.combatPos);
    expect(pc.curHealth).toBe(200);
    expect(other.curHealth).toBeLessThan(200);
  });
});

describe('do_combat_cast', () => {
  /** Arm `spell` and fire it at a square `dx` east of the caster. */
  async function cast(s: GameSession, pc: Player, spell: Spell, dx = 2) {
    pc.curSp = 500;
    pc.ap = 20;
    s.mode = GameMode.COMBAT;
    await combatCastSpell(s, spell);
    const at = { x: pc.combatPos.x + dx, y: pc.combatPos.y };
    await doCombatCast(s, at);
    return at;
  }

  /**
   * `doCombatCast` is also a free function with its own AP deduction (5 for
   * a targeted spell), and needs the same `afterCombatAction` trigger as
   * `combatCastSpell` — otherwise a targeted spell could be fired over and
   * over with the caster's turn never ending.
   */
  it('running out of AP after a targeted cast hands the turn to the next PC', async () => {
    const { s, pc } = inCombat();
    s.univ.party.pcs[1]!.ap = 20;
    pc.curSp = 500;
    pc.ap = 5; // exactly enough for one targeted cast
    s.mode = GameMode.COMBAT;
    await combatCastSpell(s, Spell.SPARK);
    const at = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
    await doCombatCast(s, at);
    expect(pc.ap).toBe(0);
    expect(s.univ.curPc).not.toBe(0);
  });

  it('Spark hurts whatever is on the square', async () => {
    const { s, pc } = inCombat();
    const monst = s.univ.town!.monsters.find((m) => m.isAlive)!;
    const at = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
    monst.curLoc = { ...at };
    monst.health = monst.maxHealth = 200;
    // The start town's guards resist magic, and Spark's 2d4 can be resisted
    // away entirely ("Guard undamaged"), so neutralise resistances first —
    // this test is about the spell reaching the square, not about the table.
    monst.mon.resist = monst.mon.resist.map(() => 100);
    await cast(s, pc, Spell.SPARK);
    expect(monst.health).toBeLessThan(200);
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(s.spellTargeting).toBeNull();
  });

  it('a field spell lays its pattern down', async () => {
    const { s, pc } = inCombat();
    const at = await cast(s, pc, Spell.WEB);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.FIELD_WEB)).toBe(true);
  });

  it('Quickfire lights exactly its square', async () => {
    const { s, pc } = inCombat();
    const at = await cast(s, pc, Spell.QUICKFIRE);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.FIELD_QUICKFIRE)).toBe(true);
  });

  it('the cost and 5 action points are spent when it resolves', async () => {
    const { s, pc } = inCombat();
    pc.curSp = 500;
    pc.ap = 20;
    await combatCastSpell(s, Spell.SPARK);
    // Nothing spent while it is merely in the air.
    expect(pc.curSp).toBe(500);
    expect(pc.ap).toBe(20);
    await doCombatCast(s, { x: pc.combatPos.x + 2, y: pc.combatPos.y });
    expect(pc.curSp).toBe(500 - (SPELLS[Spell.SPARK]?.cost ?? 0));
    // Five, not the six an untargeted spell pays.
    expect(pc.ap).toBe(15);
  });

  it('refuses a square out of range, and says so', async () => {
    const { s, pc } = inCombat();
    const range = SPELLS[Spell.SPARK]?.range ?? 0;
    await cast(s, pc, Spell.SPARK, range + 3);
    expect(s.univ.transcript.at(-1)).toBe('  Target out of range.');
  });

  it('a spell that needs a victim says when there is none', async () => {
    const { s, pc } = inCombat();
    const at = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
    for (const m of s.univ.town!.monsters) {
      if (m.curLoc.x === at.x && m.curLoc.y === at.y) m.curLoc = { x: at.x + 9, y: at.y + 9 };
    }
    await cast(s, pc, Spell.SCARE);
    expect(s.univ.transcript.at(-1)).toBe('  Nobody there.');
  });

  it('Scare frightens whoever is standing there', async () => {
    const { s, pc } = inCombat();
    const monst = s.univ.town!.monsters.find((m) => m.isAlive)!;
    const at = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
    monst.curLoc = { ...at };
    const before = monst.morale;
    await cast(s, pc, Spell.SCARE);
    expect(monst.morale).not.toBe(before);
  });

  it('Turn Undead refuses anything that is not undead', async () => {
    const { s, pc } = inCombat();
    const monst = s.univ.town!.monsters.find((m) => m.isAlive)!;
    const at = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
    monst.curLoc = { ...at };
    monst.mon.race = Race.HUMANOID;
    await cast(s, pc, Spell.TURN_UNDEAD);
    expect(s.univ.transcript.at(-1)).toBe('  Not undead.');
  });

  it('cancelling gives the turn back', async () => {
    const { s, pc } = inCombat();
    pc.curSp = 500;
    pc.ap = 20;
    await combatCastSpell(s, Spell.SPARK);
    cancelSpellTargeting(s);
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(s.spellTargeting).toBeNull();
    expect(pc.curSp).toBe(500);
    expect(pc.ap).toBe(20);
  });
});

describe('fancy (multi-target) casting', () => {
  /** Clear a run of squares east of the caster so targets are legal. */
  function clearRun(s: GameSession, pc: Player, n: number) {
    const out: { x: number; y: number }[] = [];
    for (let i = 1; i <= n; i++) out.push({ x: pc.combatPos.x + i, y: pc.combatPos.y });
    for (const m of s.univ.town!.monsters) {
      if (out.some((o) => o.x === m.curLoc.x && o.y === m.curLoc.y)) {
        m.curLoc = { x: m.curLoc.x + 20, y: m.curLoc.y + 20 };
      }
    }
    return out;
  }

  it('a fancy spell collects squares instead of firing at once', async () => {
    const { s, pc } = inCombat();
    expect(SPELLS[Spell.SMITE]?.refer).toBe(SpellRefer.FANCY);
    await combatCastSpell(s, Spell.SMITE);
    expect(s.mode).toBe(GameMode.FANCY_TARGET);
    expect(s.spellTargeting?.targetsLeft).toBeGreaterThan(0);
    expect(s.univ.transcript.at(-1)).toContain('space to cast');
  });

  it('clicking a chosen square again takes it back off', async () => {
    const { s, pc } = inCombat();
    await combatCastSpell(s, Spell.SMITE);
    const left = s.spellTargeting!.targetsLeft;
    const at = clearRun(s, pc, 1)[0]!;
    placeTarget(s, at);
    expect(s.spellTargeting?.targets.length).toBe(1);
    expect(s.spellTargeting?.targetsLeft).toBe(left - 1);
    placeTarget(s, at);
    expect(s.spellTargeting?.targets.length).toBe(0);
    expect(s.spellTargeting?.targetsLeft).toBe(left);
    expect(s.univ.transcript.at(-1)).toBe('  Target removed.');
  });

  it('filling the last slot fires the spell by itself', async () => {
    const { s, pc } = inCombat();
    await combatCastSpell(s, Spell.SMITE);
    const want = s.spellTargeting!.targetsLeft;
    const squares = clearRun(s, pc, want);
    for (const at of squares) await placeTarget(s, at);
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(s.spellTargeting).toBeNull();
  });

  it('space fires with however many squares are picked so far', async () => {
    const { s, pc } = inCombat();
    await combatCastSpell(s, Spell.SMITE);
    expect(s.spellTargeting!.targetsLeft).toBeGreaterThan(1);
    placeTarget(s, clearRun(s, pc, 1)[0]!);
    await castCollected(s);
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(s.spellTargeting).toBeNull();
  });

  it('space with nothing picked just cancels, spending nothing', async () => {
    const { s, pc } = inCombat();
    pc.curSp = 500;
    pc.ap = 20;
    await combatCastSpell(s, Spell.SMITE);
    await castCollected(s);
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(pc.curSp).toBe(500);
    expect(pc.ap).toBe(20);
  });

  it('the cost and the action points are each taken only once', async () => {
    const { s, pc } = inCombat();
    pc.curSp = 500;
    pc.ap = 20;
    await combatCastSpell(s, Spell.SMITE);
    const squares = clearRun(s, pc, s.spellTargeting!.targetsLeft);
    for (const at of squares) await placeTarget(s, at);
    expect(pc.curSp).toBe(500 - (SPELLS[Spell.SMITE]?.cost ?? 0));
    expect(pc.ap).toBe(15);
  });

  it('a volley hits every square it was aimed at', async () => {
    const { s, pc } = inCombat();
    await combatCastSpell(s, Spell.SMITE);
    const squares = clearRun(s, pc, s.spellTargeting!.targetsLeft);
    // Put a fragile monster on each chosen square.
    const victims = s.univ.town!.monsters.filter((m) => m.isAlive).slice(0, squares.length);
    victims.forEach((m, i) => {
      m.curLoc = { ...squares[i]! };
      m.health = m.maxHealth = 300;
      m.mon.resist = m.mon.resist.map(() => 100);
    });
    for (const at of squares) await placeTarget(s, at);
    expect(victims.every((m) => m.health < 300)).toBe(true);
  });
});
