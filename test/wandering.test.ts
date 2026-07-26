/**
 * Wandering monsters and the outdoor arena: create_wand_monst's outdoor half,
 * place_outd_wand_monst, the groups roaming, create_out_combat_terrain and
 * start_outdoor_combat.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { OutWandering, emptyOutWandering } from '../src/data/outdoors';
import { Scenario } from '../src/data/scenario';
import { Town } from '../src/data/town';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { ARENA_DIM, createOutCombatTerrain, startOutdoorCombat } from '../src/game/outCombat';
import { GameSession } from '../src/game/session';
import {
  countWalls, doOutdoorMonsters, outEncLevTot, placeOutdWandMonst, wanderingIsNull,
} from '../src/game/wandering';
import { PartyPreset } from '../src/universe/player';
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

/** A party standing outdoors, having walked out of the start town. */
async function outdoors(): Promise<GameSession> {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const s = new GameSession(univ);
  s.startNewGame();
  // Step onto the town's southern boundary, which walks the party out.
  const rect = s.univ.town!.record.inTownRect;
  await s.moveTo({ x: s.univ.party.townLoc.x, y: rect.bottom });
  return s;
}

function aGroup(extra: Partial<OutWandering> = {}): OutWandering {
  return { ...emptyOutWandering(), monst: [1, 0, 0, 0, 0, 0, 0], ...extra };
}

describe('outdoor wandering groups', () => {
  it('an empty encounter is null and a populated one is not', () => {
    expect(wanderingIsNull(emptyOutWandering())).toBe(true);
    expect(wanderingIsNull(aGroup())).toBe(false);
  });

  it('placing a group fills the first free slot in window coordinates', async () => {
    const s = await outdoors();
    s.univ.party.iwc = { x: 1, y: 0 };
    placeOutdWandMonst(s, { x: 10, y: 12 }, aGroup());
    const slot = s.univ.party.outC[0]!;
    expect(slot.exists).toBe(true);
    // The sector-local x gains 48 because the party is in the right-hand sector.
    expect(slot.mLoc).toEqual({ x: 58, y: 12 });
    expect(slot.whichSector).toEqual({ x: 1, y: 0 });
  });

  it('a group whose end flag is already set never appears', async () => {
    const s = await outdoors();
    s.univ.party.setSdf(30, 4, 1);
    placeOutdWandMonst(s, { x: 10, y: 12 }, aGroup({ endSpec1: 30, endSpec2: 4 }));
    expect(s.univ.party.outC.every((c) => !c.exists)).toBe(true);
  });

  it('a group walks toward the party', async () => {
    const s = await outdoors();
    const party = s.univ.party.outLoc;
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup();
    slot.mLoc = { x: party.x + 6, y: party.y };
    const startDist = Math.abs(slot.mLoc.x - party.x);
    for (let i = 0; i < 10; i++) doOutdoorMonsters(s);
    expect(Math.abs(slot.mLoc.x - party.x) + Math.abs(slot.mLoc.y - party.y))
      .toBeLessThan(startDist);
  });

  it('a group never steps onto the party itself', async () => {
    const s = await outdoors();
    const party = s.univ.party.outLoc;
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup();
    slot.mLoc = { x: party.x + 2, y: party.y };
    for (let i = 0; i < 30; i++) doOutdoorMonsters(s);
    expect(slot.mLoc).not.toEqual({ x: party.x, y: party.y });
  });
});

describe('how dangerous a group is', () => {
  it('weights the first monster type most heavily', async () => {
    const s = await outdoors();
    const one = outEncLevTot(s.univ, aGroup({ monst: [1, 0, 0, 0, 0, 0, 0] }));
    const last = outEncLevTot(s.univ, aGroup({ monst: [0, 0, 0, 0, 0, 0, 1] }));
    expect(one).toBe(last * 22);
  });

  it('a group that cannot flee is never scared off', async () => {
    const s = await outdoors();
    expect(outEncLevTot(s.univ, aGroup({ cantFlee: true }))).toBe(10000);
  });

  it('count_walls counts the four neighbours that are wall terrain', async () => {
    const s = await outdoors();
    const { outLoc } = s.univ.party;
    s.univ.out.set(outLoc.x + 1, outLoc.y, 6);
    s.univ.out.set(outLoc.x - 1, outLoc.y, 9);
    s.univ.out.set(outLoc.x, outLoc.y + 1, 3);
    s.univ.out.set(outLoc.x, outLoc.y - 1, 4);
    expect(countWalls(s.univ, outLoc)).toBe(2);
  });
});

describe('the arena', () => {
  it('is 48x48, walled to the edge, with the floor in the middle', async () => {
    const s = await outdoors();
    const arena = new Town(ARENA_DIM);
    createOutCombatTerrain(s.univ, arena, 0, 0, false);
    expect(arena.terrain[0]![0]).not.toBe(90);
    expect(arena.terrain[4]![4]).toBe(90);
    expect(arena.terrain[47]![47]).toBe(90);
    // The interior is floor and scatter, never the border wall.
    let interiorWalls = 0;
    for (let x = 9; x < 35; x++)
      for (let y = 9; y < 35; y++) if (arena.terrain[x]![y] === 90) interiorWalls++;
    expect(interiorWalls).toBe(0);
  });

  it('starting an outdoor fight fills it with both sides', async () => {
    const s = await outdoors();
    const group = aGroup({ monst: [1, 0, 0, 0, 0, 0, 0], friendly: [2, 0, 0] });
    startOutdoorCombat(s, group, s.univ.party.outLoc, 0);

    expect(s.mode).toBe(GameMode.COMBAT);
    expect(s.whichCombatType).toBe(0);
    expect(s.arena).not.toBeNull();
    expect(s.univ.town).not.toBeNull();
    const monsters = s.univ.town!.monsters;
    // 15-30 of the first hostile type, and 7-10 of the first friendly one.
    expect(monsters.filter((m) => !m.isFriendly).length).toBeGreaterThanOrEqual(15);
    expect(monsters.filter((m) => m.isFriendly).length).toBeGreaterThanOrEqual(7);
    // Everyone stands somewhere sensible, and the party is placed too.
    expect(s.univ.party.pcs[0]!.combatPos.x).toBeGreaterThan(0);
    expect(monsters.every((m) => m.curLoc.x >= 9 && m.curLoc.x < 35)).toBe(true);
  });

  it('the fight cannot be ended while anything hostile is alive', async () => {
    const s = await outdoors();
    startOutdoorCombat(s, aGroup(), s.univ.party.outLoc, 0);
    expect(s.endCombat()).toBe(false);
    expect(s.univ.transcript.at(-1)).toBe('Enemies are still alive!');
    expect(s.mode).toBe(GameMode.COMBAT);
  });

  it('killing everything lets the party walk back out to the world map', async () => {
    const s = await outdoors();
    const where = { ...s.univ.party.outLoc };
    startOutdoorCombat(s, aGroup(), where, 0);
    for (const m of s.univ.town!.monsters) m.active = 0; // DEAD
    expect(s.endCombat()).toBe(true);
    expect(s.mode).toBe(GameMode.OUTDOORS);
    expect(s.univ.town).toBeNull();
    expect(s.arena).toBeNull();
    expect(s.univ.party.outLoc).toEqual(where);
  });
});

describe('bumping into a group', () => {
  it('a group standing next to the party starts a fight', async () => {
    const s = await outdoors();
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup({ cantFlee: true });
    slot.mLoc = { x: s.univ.party.outLoc.x + 1, y: s.univ.party.outLoc.y };
    expect(await s.checkOutdoorEncounter()).toBe(true);
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(slot.exists).toBe(false);
  });

  it('an encounter far below the party runs away instead', async () => {
    const s = await outdoors();
    // A high-level party against one weak monster type.
    for (const pc of s.univ.party.pcs) pc.level = 40;
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup({ monst: [0, 0, 0, 0, 0, 0, 1] });
    slot.mLoc = { x: s.univ.party.outLoc.x + 1, y: s.univ.party.outLoc.y };
    expect(await s.checkOutdoorEncounter()).toBe(false);
    expect(s.univ.transcript.at(-1)).toBe('Combat: Monsters fled!');
    expect(s.mode).toBe(GameMode.OUTDOORS);
  });

  it('nothing happens when no group is adjacent', async () => {
    const s = await outdoors();
    const slot = s.univ.party.outC[0]!;
    slot.exists = true;
    slot.whatMonst = aGroup();
    slot.mLoc = { x: s.univ.party.outLoc.x + 5, y: s.univ.party.outLoc.y };
    expect(await s.checkOutdoorEncounter()).toBe(false);
    expect(slot.exists).toBe(true);
  });
});
