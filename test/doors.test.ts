import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { TerSpec } from '../src/data/terrain';
import { statAdj } from '../src/game/doors';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
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

function newSession(): GameSession {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  return session;
}

/** The first tile in the current town whose terrain has the given special. */
function findTerrain(session: GameSession, special: TerSpec): { x: number; y: number } | null {
  const town = session.univ.town!.record;
  for (let x = 1; x < town.maxDim - 1; x++)
    for (let y = 1; y < town.maxDim - 1; y++)
      if (session.univ.terrainType(town.terrain[x]![y]!).special === special) return { x, y };
  return null;
}

describe('statAdj', () => {
  it('reads the skill_bonus table', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    // skill_bonus = {-3,-3,-2,-1,0,0,1,...}; Jenneke has strength 8 -> +1.
    pc.skills[Skill.STRENGTH] = 8;
    expect(statAdj(pc, Skill.STRENGTH)).toBe(1);
    pc.skills[Skill.STRENGTH] = 0;
    expect(statAdj(pc, Skill.STRENGTH)).toBe(-3);
    pc.skills[Skill.STRENGTH] = 20;
    expect(statAdj(pc, Skill.STRENGTH)).toBe(5);
    // Traits adjust two of the stats.
    pc.skills[Skill.INTELLIGENCE] = 6;
    expect(statAdj(pc, Skill.INTELLIGENCE)).toBe(1);
    pc.traits[Trait.MAGICALLY_APT] = true;
    expect(statAdj(pc, Skill.INTELLIGENCE)).toBe(2);
  });

  it('clamps a skill above the end of the table', async () => {
    const session = newSession();
    const pc = session.univ.party.pcs[0]!;
    pc.skills[Skill.STRENGTH] = 99;
    expect(statAdj(pc, Skill.STRENGTH)).toBe(5);
  });
});

describe('unlocked doors', () => {
  it('opens on contact and costs the turn when the door blocked the way', async () => {
    const session = newSession();
    const where = findTerrain(session, TerSpec.CHANGE_WHEN_STEP_ON);
    expect(where).not.toBeNull();
    const town = session.univ.town!.record;
    const before = town.terrain[where!.x]![where!.y]!;
    const opened = session.univ.terrainType(before).flag1;

    session.univ.party.townLoc = { x: where!.x, y: where!.y + 1 };
    session.center = { ...session.univ.party.townLoc };
    const entered = await session.move(Direction.N);

    expect(town.terrain[where!.x]![where!.y]).toBe(opened);
    // A closed door blocks movement, so opening it doesn't also move the party.
    expect(entered).toBe(false);
    expect(session.univ.party.townLoc).toEqual({ x: where!.x, y: where!.y + 1 });
    // Now that it's open, walking in works.
    expect(await session.move(Direction.N)).toBe(true);
    expect(session.univ.party.townLoc).toEqual(where);
  });
});

describe('locked doors', () => {
  it('blocks the party and asks the host what to do', async () => {
    const session = newSession();
    const where = findTerrain(session, TerSpec.UNLOCKABLE);
    expect(where).not.toBeNull();
    const asked: { x: number; y: number }[] = [];
    session.onLockedDoor = (at) => asked.push(at);

    session.univ.party.townLoc = { x: where!.x, y: where!.y + 1 };
    session.center = { ...session.univ.party.townLoc };
    expect(await session.move(Direction.N)).toBe(false);
    expect(asked).toEqual([where]);
    // The door is untouched until the player picks an action.
    expect(session.univ.terrainType(session.univ.town!.record.terrain[where!.x]![where!.y]!).special)
      .toBe(TerSpec.UNLOCKABLE);
  });

  it('bashing eventually breaks the lock and remembers it', async () => {
    const session = newSession();
    const where = findTerrain(session, TerSpec.UNLOCKABLE)!;
    const town = session.univ.town!.record;
    const locked = town.terrain[where.x]![where.y]!;
    const spec = session.univ.terrainType(locked);
    // Only a bashable door can be broken open at all (flag3 == 1).
    if (spec.flag3 !== 1 || spec.flag2 >= 5) return;

    // Bash until it gives; the roll is random, so allow several tries.
    for (let i = 0; i < 200; i++) {
      if (session.univ.terrainType(town.terrain[where.x]![where.y]!).special !== TerSpec.UNLOCKABLE)
        break;
      session.bashDoor(where, 0);
    }
    expect(town.terrain[where.x]![where.y]).toBe(spec.flag1);
    expect(town.doorUnlocked).toContainEqual(where);
    expect(session.univ.transcript.at(-1)).toContain('Lock breaks');

    // Re-entering the town replays the unlock.
    town.terrain[where.x]![where.y] = locked;
    session.startTownMode(scen.startTown, FORCED_ENTRY);
    expect(town.terrain[where.x]![where.y]).toBe(spec.flag1);
  });

  it('a failed bash costs the basher some health', async () => {
    const session = newSession();
    const where = findTerrain(session, TerSpec.UNLOCKABLE)!;
    const town = session.univ.town!.record;
    const spec = session.univ.terrainType(town.terrain[where.x]![where.y]!);
    // Force the unbreakable case so the bash always fails.
    if (spec.flag3 === 1) spec.flag3 = 0;
    const pc = session.univ.party.pcs[0]!;
    const before = pc.curHealth;
    session.bashDoor(where, 0);
    expect(pc.curHealth).toBeLessThan(before);
    expect(before - pc.curHealth).toBeLessThanOrEqual(4);
    expect(session.univ.transcript.at(-1)).toContain("Didn't work");
  });

  it('picking a lock needs lockpicks equipped', async () => {
    const session = newSession();
    const where = findTerrain(session, TerSpec.UNLOCKABLE)!;
    session.pickLock(where, 0);
    expect(session.univ.transcript.at(-1)).toContain('Need lockpick equipped');
    expect(session.univ.terrainType(session.univ.town!.record.terrain[where.x]![where.y]!).special)
      .toBe(TerSpec.UNLOCKABLE);
  });
});

describe('looking and signs', () => {
  it('describes the space the party is standing on', async () => {
    const session = newSession();
    const ter = session.lookAt(session.univ.party.townLoc);
    expect(ter).toBeGreaterThanOrEqual(0);
    const tail = session.univ.transcript.slice(-3);
    expect(tail).toContain('You see...');
    expect(tail.some((l) => l.includes('Your party'))).toBe(true);
    expect(tail.at(-1)).toContain(session.univ.terrainType(ter).name);
  });

  it('refuses to describe a space it cannot see', async () => {
    const session = newSession();
    expect(session.lookAt({ x: -1, y: -1 })).toBe(-1);
    expect(session.univ.transcript.at(-1)).toContain("Can't see space");
  });

  it('reads an adjacent sign but not a distant one', async () => {
    const session = newSession();
    const town = session.univ.town!.record;
    const sign = town.signLocs[0];
    if (!sign) return;
    session.univ.party.townLoc = { x: sign.x, y: sign.y + 1 };
    expect(session.signAt(sign)).toBe(sign.text);

    session.univ.party.townLoc = { x: sign.x, y: sign.y + 5 };
    expect(session.signAt(sign)).toBeNull();
    expect(session.univ.transcript.at(-1)).toContain('Too far away');
  });

  it('lists creatures and floor items on a space', async () => {
    const session = newSession();
    const town = session.univ.town!;
    const monst = town.monsters.find((m) => m.isAlive)!;
    session.univ.party.townLoc = { x: monst.curLoc.x, y: monst.curLoc.y + 1 };
    session.lookAt(monst.curLoc);
    const name = scen.scenMonsters[monst.number]!.name;
    expect(session.univ.transcript.some((l) => l.includes(name))).toBe(true);

    const item = town.items.find((i) => !i.contained);
    if (!item) return;
    session.univ.party.townLoc = { ...item.itemLoc };
    session.lookAt(item.itemLoc);
    expect(session.univ.transcript.some((l) => l.includes(item.name))).toBe(true);
  });
});
