/**
 * `process_fields` and the pieces it is built from — `hit_space`,
 * `monst_inflict_fields`, `sync_force_cages` and `process_force_cage`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { DamageType } from '../src/data/monster';
import { MonstAbil } from '../src/data/monsterAbility';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import {
  WHO_HIT_PARTY, hitPcsInSpace, hitSpace, monstInflictFields, processFields,
  processForceCage, syncForceCages,
} from '../src/game/processFields';
import { Creature } from '../src/universe/creature';
import { PartyPreset } from '../src/universe/player';
import { Race, Status } from '../src/universe/skills';
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

/** Put the party somewhere with nothing else on it, and hand back the square. */
function partyAlone(s: GameSession): { x: number; y: number } {
  const at = s.univ.party.townLoc;
  for (const m of s.univ.town!.monsters) {
    if (m.curLoc.x === at.x && m.curLoc.y === at.y) m.curLoc = { x: at.x + 6, y: at.y + 6 };
  }
  return { x: at.x, y: at.y };
}

describe('hit_space', () => {
  it('an antimagic field swallows fire, cold and magic but not weapon damage', () => {
    const s = inTown();
    const at = partyAlone(s);
    s.univ.town!.setField(at.x, at.y, FieldType.FIELD_ANTIMAGIC, true);
    const pc = s.univ.party.pcs[0]!;
    const before = pc.curHealth;
    hitSpace(s, at, 20, DamageType.FIRE, 1, 1, WHO_HIT_PARTY);
    hitSpace(s, at, 20, DamageType.COLD, 1, 1, WHO_HIT_PARTY);
    hitSpace(s, at, 20, DamageType.MAGIC, 1, 1, WHO_HIT_PARTY);
    expect(pc.curHealth).toBe(before);
    hitSpace(s, at, 20, DamageType.WEAPON, 1, 1, WHO_HIT_PARTY);
    expect(pc.curHealth).toBeLessThan(before);
  });

  it('says so rather than hitting when the damage is nothing', () => {
    const s = inTown();
    const at = partyAlone(s);
    const pc = s.univ.party.pcs[0]!;
    const before = pc.curHealth;
    hitSpace(s, at, 0, DamageType.FIRE, 1, 1, WHO_HIT_PARTY);
    expect(s.univ.transcript.at(-1)).toBe('  No damage.');
    expect(pc.curHealth).toBe(before);
  });

  it('hit_pcs_in_space leaves the monsters out of it', () => {
    const s = inTown();
    const at = partyAlone(s);
    const monst = aLiveMonster(s);
    monst.curLoc = { ...at };
    const monstBefore = monst.health;
    const pcBefore = s.univ.party.pcs[0]!.curHealth;
    hitPcsInSpace(s, at, 15, DamageType.FIRE, 1, 1);
    expect(monst.health).toBe(monstBefore);
    expect(s.univ.party.pcs[0]!.curHealth).toBeLessThan(pcBefore);
  });

  it('out of combat one blow lands on the whole party', () => {
    const s = inTown();
    const at = partyAlone(s);
    const before = s.univ.party.pcs.map((p) => p.curHealth);
    hitPcsInSpace(s, at, 12, DamageType.FIRE, 1, 1);
    const hurt = s.univ.party.pcs.filter((p, i) => p.curHealth < before[i]!);
    expect(hurt.length).toBeGreaterThan(1);
  });
});

describe('monst_inflict_fields', () => {
  it('quickfire burns a monster whether or not it radiates anything', () => {
    const s = inTown();
    const monst = aLiveMonster(s);
    s.univ.town!.setField(monst.curLoc.x, monst.curLoc.y, FieldType.FIELD_QUICKFIRE, true);
    const before = monst.health;
    monstInflictFields(s, monst);
    expect(monst.health).toBeLessThan(before);
  });

  it('a monster that radiates nothing walks through a wall of blades unhurt', () => {
    const s = inTown();
    const monst = aLiveMonster(s);
    expect(monst.mon.abil[MonstAbil.RADIATE]?.active ?? false).toBe(false);
    s.univ.town!.setField(monst.curLoc.x, monst.curLoc.y, FieldType.WALL_BLADES, true);
    const before = monst.health;
    monstInflictFields(s, monst);
    // Faithful to the C++: the damage only applies when have_radiate is set.
    expect(monst.health).toBe(before);
  });

  it('a web catches a monster and is used up doing it', () => {
    const s = inTown();
    const monst = aLiveMonster(s);
    if (monst.mon.race === Race.BUG) monst.mon.race = Race.HUMANOID;
    const { x, y } = monst.curLoc;
    s.univ.town!.setField(x, y, FieldType.FIELD_WEB, true);
    monstInflictFields(s, monst);
    expect(monst.status[Status.WEBS] ?? 0).toBeGreaterThan(0);
    expect(s.univ.town!.hasField(x, y, FieldType.FIELD_WEB)).toBe(false);
  });

  it('a bug walks straight through a web', () => {
    const s = inTown();
    const monst = aLiveMonster(s);
    monst.mon.race = Race.BUG;
    const { x, y } = monst.curLoc;
    s.univ.town!.setField(x, y, FieldType.FIELD_WEB, true);
    monstInflictFields(s, monst);
    expect(monst.status[Status.WEBS] ?? 0).toBe(0);
    expect(s.univ.town!.hasField(x, y, FieldType.FIELD_WEB)).toBe(true);
  });

  it('only the first field on a square bites — the C++ breaks out', () => {
    const s = inTown();
    const monst = aLiveMonster(s);
    if (monst.mon.race === Race.BUG) monst.mon.race = Race.HUMANOID;
    const { x, y } = monst.curLoc;
    // Quickfire is tested first and breaks, so the web below it never catches.
    s.univ.town!.setField(x, y, FieldType.FIELD_QUICKFIRE, true);
    s.univ.town!.setField(x, y, FieldType.FIELD_WEB, true);
    monstInflictFields(s, monst);
    expect(monst.status[Status.WEBS] ?? 0).toBe(0);
    expect(s.univ.town!.hasField(x, y, FieldType.FIELD_WEB)).toBe(true);
  });

  it('flattens a crate it is standing on and spills what it held', () => {
    const s = inTown();
    const monst = aLiveMonster(s);
    const { x, y } = monst.curLoc;
    s.univ.town!.setField(x, y, FieldType.OBJECT_CRATE, true);
    monstInflictFields(s, monst);
    expect(s.univ.town!.hasField(x, y, FieldType.OBJECT_CRATE)).toBe(false);
  });
});

describe('force cages', () => {
  it('sync puts a barrier under anyone who still has the status', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.status[Status.FORCECAGE] = 5;
    const at = pc.getLoc();
    expect(syncForceCages(s)).toBe(true);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.BARRIER_CAGE)).toBe(true);
  });

  it('sync catches someone who walked onto a barrier without the status', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    const at = pc.getLoc();
    s.univ.town!.setField(at.x, at.y, FieldType.BARRIER_CAGE, true);
    pc.status[Status.FORCECAGE] = 0;
    syncForceCages(s);
    expect(pc.status[Status.FORCECAGE]!).toBeGreaterThan(0);
  });

  it('a cage that ticks to zero flickers out and lets go', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    const at = pc.getLoc();
    s.univ.town!.setField(at.x, at.y, FieldType.BARRIER_CAGE, true);
    pc.status[Status.FORCECAGE] = 1;
    processForceCage(s, at, 0);
    expect(pc.status[Status.FORCECAGE]).toBe(0);
    expect(s.univ.town!.hasField(at.x, at.y, FieldType.BARRIER_CAGE)).toBe(false);
    expect(s.univ.transcript.at(-1)).toContain('flickers out');
  });

  it('does nothing where there is no cage', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.status[Status.FORCECAGE] = 5;
    processForceCage(s, pc.getLoc(), 0);
    expect(pc.status[Status.FORCECAGE]).toBe(5);
  });
});

describe('process_fields', () => {
  it('a wall of fire burns the party standing in it', () => {
    const s = inTown();
    const at = partyAlone(s);
    s.univ.town!.setField(at.x, at.y, FieldType.WALL_FIRE, true);
    const before = s.univ.party.pcs[0]!.curHealth;
    processFields(s);
    expect(s.univ.party.pcs[0]!.curHealth).toBeLessThan(before);
  });

  it('a stinking cloud curses whoever stands in it', () => {
    const s = inTown();
    const at = partyAlone(s);
    const pc = s.univ.party.pcs[0]!;
    pc.status[Status.BLESS_CURSE] = 0;
    // Run several turns: the cloud disperses one turn in four, so a single
    // pass can legitimately do nothing.
    for (let i = 0; i < 8 && (pc.status[Status.BLESS_CURSE] ?? 0) === 0; i++) {
      s.univ.town!.setField(at.x, at.y, FieldType.CLOUD_STINK, true);
      processFields(s);
    }
    expect(pc.status[Status.BLESS_CURSE]!).toBeLessThan(0);
  });

  it('fields eventually burn out on their own', () => {
    const s = inTown();
    const at = partyAlone(s);
    const town = s.univ.town!;
    town.setField(at.x + 3, at.y + 3, FieldType.WALL_ICE, true);
    let turns = 0;
    while (town.hasField(at.x + 3, at.y + 3, FieldType.WALL_ICE) && turns < 500) {
      processFields(s);
      turns++;
    }
    expect(turns).toBeLessThan(500);
  });

  it('quickfire spreads to its neighbours', () => {
    const s = inTown();
    const town = s.univ.town!;
    const rect = town.record.inTownRect;
    // Somewhere well inside the town, so the spread has room on all sides.
    const x = Math.trunc((rect.left + rect.right) / 2);
    const y = Math.trunc((rect.top + rect.bottom) / 2);
    town.setField(x, y, FieldType.FIELD_QUICKFIRE, true);
    expect(town.quickfirePresent).toBe(true);
    let spread = false;
    for (let i = 0; i < 10 && !spread; i++) {
      processFields(s);
      spread = town.hasField(x - 1, y, FieldType.FIELD_QUICKFIRE)
        || town.hasField(x + 1, y, FieldType.FIELD_QUICKFIRE)
        || town.hasField(x, y - 1, FieldType.FIELD_QUICKFIRE)
        || town.hasField(x, y + 1, FieldType.FIELD_QUICKFIRE);
    }
    expect(spread).toBe(true);
  });

  it('does nothing at all outdoors', () => {
    const s = inTown();
    const before = s.univ.party.pcs.map((p) => p.curHealth);
    s.univ.town = null;
    processFields(s);
    expect(s.univ.party.pcs.map((p) => p.curHealth)).toEqual(before);
  });

  it('a town with no quickfire never runs the spread pass', () => {
    const s = inTown();
    expect(s.univ.town!.quickfirePresent).toBe(false);
  });
});
