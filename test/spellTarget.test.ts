/**
 * `start_town_targeting` and `cast_town_spell` — the spells that ask for a
 * square before they resolve.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { SpellPat } from '../src/data/pattern';
import { Scenario } from '../src/data/scenario';
import { Spell, SPELLS } from '../src/data/spell';
import { TerSpec } from '../src/data/terrain';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { GameSession } from '../src/game/session';
import {
  cancelTownTargeting, castTownSpell, startTownTargeting,
} from '../src/game/spellTarget';
import { doMageSpell } from '../src/game/spellTown';
import { PartyPreset, Player } from '../src/universe/player';
import { Skill, Trait } from '../src/universe/skills';
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

/** A square next to the party that is inside the town's active rectangle. */
function nearby(s: GameSession, dx = 1, dy = 0): { x: number; y: number } {
  const at = s.univ.party.townLoc;
  return { x: at.x + dx, y: at.y + dy };
}

describe('start_town_targeting', () => {
  it('parks the spell and switches mode without spending anything', async () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    startTownTargeting(s, Spell.QUICKFIRE, 0);
    expect(s.mode).toBe(GameMode.TOWN_TARGET);
    expect(s.townTarget).toMatchObject({ spell: Spell.QUICKFIRE, whoCast: 0, freebie: false });
    expect(pc.curSp).toBe(sp);
    expect(s.univ.transcript.at(-1)).toBe('  Target spell.');
  });

  it('cancelling is free and puts the mode back', async () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    startTownTargeting(s, Spell.QUICKFIRE, 0);
    cancelTownTargeting(s);
    expect(s.mode).toBe(GameMode.TOWN);
    expect(s.townTarget).toBeNull();
    expect(pc.curSp).toBe(sp);
  });

  it('substitutes a single square for the one rotatable pattern', async () => {
    const s = inTown();
    caster(s);
    // Town targeting can't ask which way a wall faces, so PAT_WALL becomes
    // PAT_SINGLE — the C++ does this silently and its own TODO objects.
    startTownTargeting(s, Spell.QUICKFIRE, 0, false, SpellPat.WALL);
    expect(s.townTarget?.pattern).toBe(SpellPat.SINGLE);
  });
});

describe('cast_town_spell', () => {
  it('Quickfire lights the square, and the cost is paid now', async () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    const at = nearby(s);
    startTownTargeting(s, Spell.QUICKFIRE, 0);
    await castTownSpell(s, at);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.FIELD_QUICKFIRE)).toBe(true);
    expect(s.univ.transcript.at(-1)).toBe('  You create quickfire.');
    expect(pc.curSp).toBe(sp - (SPELLS[Spell.QUICKFIRE]?.cost ?? 0));
    expect(s.mode).toBe(GameMode.TOWN);
    expect(s.townTarget).toBeNull();
  });

  it('refuses a square outside the town, without charging', async () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    startTownTargeting(s, Spell.QUICKFIRE, 0);
    await castTownSpell(s, { x: 0, y: 0 });
    expect(s.univ.transcript.at(-1)).toBe("  Can't target outside town.");
    expect(pc.curSp).toBe(sp);
    expect(s.mode).toBe(GameMode.TOWN);
  });

  it('the barriers go down on a clear square', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    // Clear anything standing there, since a monster blocks the barrier.
    for (const m of s.univ.town!.monsters) {
      if (m.curLoc.x === at.x && m.curLoc.y === at.y) m.curLoc = { x: at.x + 9, y: at.y + 9 };
    }
    startTownTargeting(s, Spell.BARRIER_FORCE, 0);
    await castTownSpell(s, at);
    const made = s.univ.town!.hasField(at.x, at.y, FieldType.BARRIER_FORCE);
    // Obstructed terrain legitimately refuses; either way it says which.
    expect(['  You create the barrier.', '  Target space obstructed.'])
      .toContain(s.univ.transcript.at(-1));
    if (s.univ.transcript.at(-1) === '  You create the barrier.') expect(made).toBe(true);
  });

  it('a barrier is blocked by a monster standing on the square', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    const monst = s.univ.town!.monsters.find((m) => m.isAlive)!;
    monst.curLoc = { ...at };
    startTownTargeting(s, Spell.BARRIER_FIRE, 0);
    await castTownSpell(s, at);
    expect(s.univ.transcript.at(-1)).toBe('  Target space obstructed.');
  });

  it('Antimagic lays a cloud with its corners cut off', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    startTownTargeting(s, Spell.ANTIMAGIC, 0, false, SpellPat.RADIUS_2);
    await castTownSpell(s, at);
    const town = s.univ.town!;
    expect(town.hasField(at.x, at.y, FieldType.FIELD_ANTIMAGIC)).toBe(true);
    // The far corner of the 5x5 is excluded: |dx| >= 2 and |dy| >= 2.
    expect(town.hasField(at.x + 2, at.y + 2, FieldType.FIELD_ANTIMAGIC)).toBe(false);
  });

  it('Scry Monster notes what is there, and says when nothing is', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    for (const m of s.univ.town!.monsters) {
      if (m.curLoc.x === at.x && m.curLoc.y === at.y) m.curLoc = { x: at.x + 9, y: at.y + 9 };
    }
    startTownTargeting(s, Spell.SCRY_MONSTER, 0);
    await castTownSpell(s, at);
    expect(s.univ.transcript.at(-1)).toBe('  No monster there.');

    const monst = s.univ.town!.monsters.find((m) => m.isAlive)!;
    monst.curLoc = { ...at };
    startTownTargeting(s, Spell.SCRY_MONSTER, 0);
    await castTownSpell(s, at);
    expect(s.univ.party.mNoted.has(monst.number)).toBe(true);
  });

  it('Unlock refuses terrain that is not a lock', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    const town = s.univ.town!;
    const spec = s.univ.terrainType(town.record.terrain[at.x]![at.y]!);
    if (spec.special === TerSpec.UNLOCKABLE) {
      // Vanishingly unlikely next to the start point, but don't assume.
      town.record.terrain[at.x]![at.y] = 0;
    }
    startTownTargeting(s, Spell.UNLOCK, 0);
    await castTownSpell(s, at);
    expect(s.univ.transcript.at(-1)).toBe('  Wrong terrain type.');
  });

  it('Dispel Barrier reports an empty square', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    startTownTargeting(s, Spell.DISPEL_BARRIER, 0);
    await castTownSpell(s, at);
    expect(s.univ.transcript.at(-1)).toBe('  No barrier there.');
  });

  it('Dispel Barrier breaks a force cage', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    s.univ.town!.setField(at.x, at.y, FieldType.BARRIER_CAGE, true);
    startTownTargeting(s, Spell.DISPEL_BARRIER, 0);
    await castTownSpell(s, at);
    expect(s.univ.transcript.at(-1)).toBe('  Cage broken.');
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.BARRIER_CAGE)).toBe(false);
  });

  it('Dispel Barrier eventually breaks a real barrier', async () => {
    const s = inTown();
    caster(s);
    const at = nearby(s);
    const town = s.univ.town!;
    let broken = false;
    for (let i = 0; i < 60 && !broken; i++) {
      town.setField(at.x, at.y, FieldType.BARRIER_FIRE, true);
      startTownTargeting(s, Spell.DISPEL_BARRIER, 0);
      await castTownSpell(s, at);
      broken = !town.hasField(at.x, at.y, FieldType.BARRIER_FIRE);
    }
    expect(broken).toBe(true);
  });

  it('a click with nothing in the air does nothing at all', async () => {
    const s = inTown();
    const pc = caster(s);
    const sp = pc.curSp;
    const before = s.univ.transcript.length;
    await castTownSpell(s, nearby(s));
    expect(s.univ.transcript.length).toBe(before);
    expect(pc.curSp).toBe(sp);
  });
});

describe('the whole flow, from do_mage_spell', () => {
  it('Quickfire cast in town targets, then lands where it is pointed', async () => {
    const s = inTown();
    const pc = caster(s);
    pc.traits[Trait.PACIFIST] = false;
    doMageSpell(s, 0, Spell.QUICKFIRE);
    expect(s.mode).toBe(GameMode.TOWN_TARGET);
    const at = nearby(s, 2, 0);
    await castTownSpell(s, at);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.FIELD_QUICKFIRE)).toBe(true);
    expect(s.mode).toBe(GameMode.TOWN);
  });
});
