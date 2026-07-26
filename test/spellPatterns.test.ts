/**
 * `place_spell_pattern`, the builtin pattern tables, and the field helpers
 * around them — `web_space`, `scloud_space`, `dispel_fields`, `crumble_wall`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { DamageType } from '../src/data/monster';
import { MonstAbil } from '../src/data/monsterAbility';
import {
  SpellPat, X, copyPattern, emptyPattern, getBuiltinPattern,
} from '../src/data/pattern';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  breakForceCage, dispelFields, scloudSpace, sleepCloudSpace, webSpace,
} from '../src/game/fieldEffects';
import { damageCode, modifyPattern, placeSpellPattern } from '../src/game/spellPatterns';
import { GameSession } from '../src/game/session';
import { Creature } from '../src/universe/creature';
import { PartyPreset } from '../src/universe/player';
import { Status } from '../src/universe/skills';
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

/** Which offsets from centre a pattern covers, as "x,y" strings. */
function cells(pat: number[][]): Set<string> {
  const out = new Set<string>();
  for (let x = 0; x < 9; x++)
    for (let y = 0; y < 9; y++)
      if (pat[x]![y]! > 0) out.add(`${x - 4},${y - 4}`);
  return out;
}

describe('the builtin pattern tables', () => {
  it('PAT_SINGLE covers the centre and nothing else', () => {
    expect(cells(getBuiltinPattern(SpellPat.SINGLE))).toEqual(new Set(['0,0']));
  });

  it('PAT_SQ is the 3x3 around the centre', () => {
    const got = cells(getBuiltinPattern(SpellPat.SQUARE));
    expect(got.size).toBe(9);
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
      expect(got.has(`${dx},${dy}`)).toBe(true);
    }
  });

  it('PAT_SMSQ hangs off the centre to the south-east, not around it', () => {
    expect(cells(getBuiltinPattern(SpellPat.SMALL_SQUARE)))
      .toEqual(new Set(['0,0', '1,0', '0,1', '1,1']));
  });

  it('PAT_OPENSQ is the 3x3 with its middle missing', () => {
    const got = cells(getBuiltinPattern(SpellPat.OPEN_SQUARE));
    expect(got.size).toBe(8);
    expect(got.has('0,0')).toBe(false);
  });

  it('PAT_PLUS is the four neighbours and the centre', () => {
    expect(cells(getBuiltinPattern(SpellPat.PLUS)))
      .toEqual(new Set(['0,0', '0,-1', '0,1', '-1,0', '1,0']));
  });

  it('the two circles are 21 and 37 squares', () => {
    expect(cells(getBuiltinPattern(SpellPat.RADIUS_2)).size).toBe(21);
    expect(cells(getBuiltinPattern(SpellPat.RADIUS_3)).size).toBe(37);
  });

  it('PAT_WALL has eight rotations, and rotation wraps rather than clamps', () => {
    const r0 = getBuiltinPattern(SpellPat.WALL, 0);
    expect(getBuiltinPattern(SpellPat.WALL, 8)).toEqual(r0);
    expect(getBuiltinPattern(SpellPat.WALL, 16)).toEqual(r0);
    // rot 0 is a horizontal band two deep; rot 2 is the vertical one. The C++
    // indexes pat[x][y], so the literal in pattern.cpp reads transposed.
    expect(cells(r0).size).toBe(18);
    for (let x = 0; x < 9; x++) expect(r0[x]![4]).toBe(X);
    const r2 = getBuiltinPattern(SpellPat.WALL, 2);
    for (let y = 0; y < 9; y++) expect(r2[4]![y]).toBe(X);
  });

  it('PAT_PROT carries field types rather than X, in four rings', () => {
    const p = getBuiltinPattern(SpellPat.PROT);
    expect(p[4]![4]).toBe(FieldType.FIELD_ANTIMAGIC); // 3, the core
    expect(p[4]![2]).toBe(FieldType.WALL_BLADES); // 6
    expect(p[4]![1]).toBe(FieldType.WALL_ICE); // 5
    expect(p[4]![0]).toBe(FieldType.WALL_FORCE); // 1
    expect(p[0]![0]).toBe(0); // the corners are open
  });

  it('an unknown pattern id is an empty grid, not a crash', () => {
    expect(getBuiltinPattern(SpellPat.CUSTOM)).toEqual(emptyPattern());
  });

  it('handing out a builtin does not let a caller scribble on it', () => {
    const mine = copyPattern(getBuiltinPattern(SpellPat.SINGLE));
    modifyPattern(mine, FieldType.WALL_FIRE);
    expect(getBuiltinPattern(SpellPat.SINGLE)[4]![4]).toBe(X);
  });
});

describe('modify_pattern and the damage encoding', () => {
  it('stamps the code over every cell of the shape and leaves the gaps', () => {
    const p = copyPattern(getBuiltinPattern(SpellPat.PLUS));
    modifyPattern(p, FieldType.WALL_FIRE);
    expect(p[4]![4]).toBe(FieldType.WALL_FIRE);
    expect(p[4]![3]).toBe(FieldType.WALL_FIRE);
    expect(p[0]![0]).toBe(0);
  });

  it('encodes damage as 50 + type * 40 + dice, with the dice clamped to 1..30', () => {
    expect(damageCode(DamageType.FIRE, 4)).toBe(50 + DamageType.FIRE * 40 + 4);
    expect(damageCode(DamageType.FIRE, 0)).toBe(50 + DamageType.FIRE * 40 + 1);
    expect(damageCode(DamageType.FIRE, 99)).toBe(50 + DamageType.FIRE * 40 + 30);
  });

  it('refuses MARKED, which is not a real damage type', () => {
    expect(damageCode(DamageType.MARKED, 4)).toBeNull();
  });
});

describe('place_spell_pattern', () => {
  it('raises a field over the whole shape', () => {
    const s = inTown();
    const town = s.univ.town!;
    const at = { ...s.univ.party.townLoc, x: s.univ.party.townLoc.x + 3 };
    placeSpellPattern(s, SpellPat.SQUARE, at, { field: FieldType.WALL_FIRE });
    let raised = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        if (town.hasField(at.x + dx, at.y + dy, FieldType.WALL_FIRE)) raised++;
    // Squares the centre can't see are culled, so this is "most of them", not
    // necessarily all nine.
    expect(raised).toBeGreaterThan(0);
    expect(raised).toBeLessThanOrEqual(9);
  });

  it('hurts a monster standing in a damaging pattern', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.maxHealth = 500;
    m.health = 500;
    m.mon.resist.fill(100);
    placeSpellPattern(s, SpellPat.RADIUS_2, m.curLoc, {
      damage: { type: DamageType.FIRE, dice: 10 },
      whoHit: 0,
    });
    expect(m.health).toBeLessThan(500);
  });

  it('spares a monster from the very field it radiates', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.maxHealth = 500;
    m.health = 500;
    m.mon.resist.fill(100);
    // Its armour would otherwise soak the whole wall and hide the difference.
    m.mon.armor = 0;
    const radiate = m.mon.abil[MonstAbil.RADIATE]!;
    radiate.active = true;
    radiate.radiate.type = FieldType.WALL_FIRE;
    placeSpellPattern(s, SpellPat.SQUARE, m.curLoc, { field: FieldType.WALL_FIRE });
    expect(m.health).toBe(500);
  });

  it('a wall of blades still bites a monster that radiates something else', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.maxHealth = 500;
    m.health = 500;
    m.mon.resist.fill(100);
    m.mon.armor = 0;
    const radiate = m.mon.abil[MonstAbil.RADIATE]!;
    radiate.active = true;
    radiate.radiate.type = FieldType.CLOUD_STINK;
    placeSpellPattern(s, SpellPat.SQUARE, m.curLoc, { field: FieldType.WALL_BLADES });
    expect(m.health).toBeLessThan(500);
  });

  it('webs a monster it catches rather than damaging it', () => {
    const s = inTown();
    const m = aLiveMonster(s);
    m.maxHealth = 500;
    m.health = 500;
    placeSpellPattern(s, SpellPat.SINGLE, m.curLoc, { field: FieldType.FIELD_WEB });
    expect(m.health).toBe(500);
    expect(m.status[Status.WEBS]).toBeGreaterThan(0);
  });

  it('a MARKED damage type does nothing at all', () => {
    const s = inTown();
    const town = s.univ.town!;
    const at = s.univ.party.townLoc;
    placeSpellPattern(s, SpellPat.SQUARE, at, {
      damage: { type: DamageType.MARKED, dice: 5 },
    });
    expect(town.fields[at.x]![at.y]!.size).toBe(0);
  });

  it('outdoors it is a no-op, since there is no town map to write to', () => {
    const s = inTown();
    const at = { ...s.univ.party.townLoc };
    s.univ.town = null;
    expect(() => placeSpellPattern(s, SpellPat.SQUARE, at, {
      field: FieldType.WALL_FIRE,
    })).not.toThrow();
  });
});

describe('the field helpers', () => {
  it('web_space catches the party standing on the square', () => {
    const s = inTown();
    const at = s.univ.party.townLoc;
    webSpace(s, at);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.FIELD_WEB)).toBe(true);
    expect(s.univ.party.pcs[0]!.status[Status.WEBS]).toBeGreaterThan(0);
  });

  it('scloud_space curses whoever breathes it', () => {
    const s = inTown();
    const at = s.univ.party.townLoc;
    scloudSpace(s, at);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.CLOUD_STINK)).toBe(true);
    expect(s.univ.party.pcs[0]!.status[Status.BLESS_CURSE]).toBeLessThan(0);
  });

  it('sleep_cloud_space puts the party under', () => {
    const s = inTown();
    const at = s.univ.party.townLoc;
    sleepCloudSpace(s, at);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.CLOUD_SLEEP)).toBe(true);
  });

  it('break_force_cage frees whoever was caged and clears the barrier', () => {
    const s = inTown();
    const at = s.univ.party.townLoc;
    s.univ.town!.setField(at.x, at.y, FieldType.BARRIER_CAGE, true);
    s.univ.party.pcs[0]!.status[Status.FORCECAGE] = 8;
    breakForceCage(s, at);
    expect(s.univ.party.pcs[0]!.status[Status.FORCECAGE]).toBe(0);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.BARRIER_CAGE)).toBe(false);
  });

  it('dispel_fields always takes the fire wall, force wall and stink cloud', () => {
    const s = inTown();
    const at = s.univ.party.townLoc;
    const town = s.univ.town!;
    for (const f of [FieldType.WALL_FIRE, FieldType.WALL_FORCE, FieldType.CLOUD_STINK]) {
      town.setField(at.x, at.y, f, true);
    }
    dispelFields(s, at, 0);
    expect(town.hasField(at.x, at.y, FieldType.WALL_FIRE)).toBe(false);
    expect(town.hasField(at.x, at.y, FieldType.WALL_FORCE)).toBe(false);
    expect(town.hasField(at.x, at.y, FieldType.CLOUD_STINK)).toBe(false);
  });

  it('a scripted dispel (mode 1) sweeps everything, saving roll or not', () => {
    // mode >= 1 sets the adjustment to -10, which no roll can recover from, so
    // every condition passes. This is the strong dispel.
    const s = inTown();
    const at = s.univ.party.townLoc;
    const town = s.univ.town!;
    const saved = [
      FieldType.FIELD_WEB, FieldType.WALL_ICE, FieldType.CLOUD_SLEEP,
      FieldType.FIELD_QUICKFIRE, FieldType.WALL_BLADES,
    ];
    for (const f of saved) town.setField(at.x, at.y, f, true);
    dispelFields(s, at, 1);
    for (const f of saved) expect(town.hasField(at.x, at.y, f)).toBe(false);
  });

  it('mode 2 sweeps the barriers, crates and webs outright first', () => {
    const s = inTown();
    const at = s.univ.party.townLoc;
    const town = s.univ.town!;
    const swept = [
      FieldType.BARRIER_FIRE, FieldType.BARRIER_FORCE,
      FieldType.OBJECT_CRATE, FieldType.OBJECT_BARREL, FieldType.FIELD_WEB,
    ];
    for (const f of swept) town.setField(at.x, at.y, f, true);
    dispelFields(s, at, 2);
    for (const f of swept) expect(town.hasField(at.x, at.y, f)).toBe(false);
  });

  it('rolls exactly six saves, in the C++\'s order, whatever it clears', () => {
    // The call order is part of the spec, so this pins the shape of each roll:
    // 1d6 web, 1d6 ice, 1d6 sleep, 1d8 quickfire, 1d7 blades, 1d12 cage.
    const s = inTown();
    const rng = s.univ.rng;
    const drawn: number[] = [];
    const real = rng.getRan.bind(rng);
    rng.getRan = (n, lo, hi) => {
      drawn.push(hi);
      return real(n, lo, hi);
    };
    dispelFields(s, s.univ.party.townLoc, 0);
    rng.getRan = real;
    expect(drawn).toEqual([6, 6, 6, 8, 7, 12]);
  });
});
