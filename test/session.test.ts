import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { SECTOR_SIZE } from '../src/data/outdoors';
import { Scenario } from '../src/data/scenario';
import { TerSpec } from '../src/data/terrain';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { OUT_HALF_DIM } from '../src/universe/curOut';
import { TOWN_NUM_OUTDOORS } from '../src/universe/party';
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

function newSession(): GameSession {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  return new GameSession(univ);
}

describe('party setup', () => {
  it('starts with the six pregen adventurers', () => {
    const { univ } = newSession();
    expect(univ.party.pcs.map((p) => p.name)).toEqual([
      'Jenneke',
      'Thissa',
      'Frrrrrr',
      'Adrianna',
      'Feodoric',
      'Michael',
    ]);
    expect(univ.party.pcs.every((p) => p.isAlive)).toBe(true);
    expect(univ.party.pcs[0]!.maxHealth).toBe(22);
    expect(univ.party.pcs[3]!.maxSp).toBe(20);
    expect(univ.party.gold).toBe(200);
    expect(univ.party.food).toBe(100);
    expect(univ.party.calcDay()).toBe(1);
  });

  it('places the outdoor window on the scenario start sector', () => {
    const { univ } = newSession();
    expect(univ.party.outdoorCorner).toEqual(scen.outdoorStart);
    expect(univ.party.locInSec).toEqual(scen.sectorStart);
    // The window is stitched from the 2x2 block starting at the corner.
    const base = scen.outdoors[scen.outdoorStart.x]![scen.outdoorStart.y]!;
    expect(univ.out.at(0, 0)).toBe(base.terrain[0]![0]!);
    expect(univ.out.at(SECTOR_SIZE - 1, SECTOR_SIZE - 1)).toBe(
      base.terrain[SECTOR_SIZE - 1]![SECTOR_SIZE - 1]!,
    );
  });
});

describe('start and end town mode', () => {
  it('starts a new game inside the scenario start town', () => {
    const session = newSession();
    session.startNewGame();
    expect(session.mode).toBe(GameMode.TOWN);
    expect(session.inTown).toBe(true);
    expect(session.univ.party.townNum).toBe(scen.startTown);
    expect(session.univ.town!.record.name).toBe('Fort Talrus');
    // The party lands on a usable start location inside the town bounds.
    const rect = session.univ.town!.record.inTownRect;
    const p = session.univ.party.townLoc;
    expect(p.x).toBeGreaterThan(rect.left);
    expect(p.x).toBeLessThan(rect.right);
    expect(p.y).toBeGreaterThan(rect.top);
    expect(p.y).toBeLessThan(rect.bottom);
    expect(session.locationName().length).toBeGreaterThan(0);
  });

  it('populates the town with its always-present creatures', () => {
    const session = newSession();
    session.startNewGame();
    const alive = session.univ.town!.monsters.filter((m) => m.isAlive);
    expect(alive.length).toBeGreaterThan(0);
    // Every live creature refers to a real monster template and fits the map.
    for (const m of alive) {
      expect(scen.scenMonsters[m.number]).toBeDefined();
      expect(session.univ.town!.isOnMap(m.curLoc.x, m.curLoc.y)).toBe(true);
    }
  });

  it('leaves town when the party steps past the in-town boundary', () => {
    const session = newSession();
    session.startNewGame();
    const rect = session.univ.town!.record.inTownRect;
    // Step straight onto the southern boundary.
    session.moveTo({ x: session.univ.party.townLoc.x, y: rect.bottom });
    expect(session.mode).toBe(GameMode.OUTDOORS);
    expect(session.univ.party.townNum).toBe(TOWN_NUM_OUTDOORS);
    expect(session.univ.town).toBeNull();
    expect(session.univ.out.isOnMap(session.univ.party.outLoc.x, session.univ.party.outLoc.y)).toBe(
      true,
    );
  });

  it('remembers the town map between visits', () => {
    const session = newSession();
    session.startNewGame();
    const record = session.univ.town!.record;
    const seen = session.univ.party.townLoc;
    session.moveTo({ x: seen.x, y: record.inTownRect.bottom });
    expect(record.maps[seen.x]![seen.y]).toBe(1);

    session.startTownMode(scen.startTown, FORCED_ENTRY);
    expect(session.univ.town!.isExplored(seen.x, seen.y)).toBe(true);
  });

  it('picks the entrance opposite the direction of travel', () => {
    // find_direction_from: heading north arrives at start_locs[2], south at [0].
    const session = newSession();
    const town = scen.towns.find((t) => t.startLocs.every((l) => l.x >= 0));
    if (!town) return; // no town in this scenario defines all four entrances
    const num = scen.towns.indexOf(town);
    session.univ.party.direction = Direction.N;
    session.startTownMode(num, 2);
    expect(session.univ.party.townLoc).toEqual(town.startLocs[2]);
    session.startTownMode(num, 0);
    expect(session.univ.party.townLoc).toEqual(town.startLocs[0]);
  });
});

describe('outdoor movement', () => {
  it('records movement in the transcript and advances the clock', () => {
    const session = newSession();
    const { univ } = session;
    // Find an unblocked neighbour of the start position and step onto it.
    const from = univ.party.outLoc;
    const dirs = [Direction.N, Direction.E, Direction.S, Direction.W];
    const before = univ.party.age;
    let moved = false;
    for (const d of dirs) {
      if (session.move(d)) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
    expect(univ.party.age).toBe(before + 1);
    expect(univ.party.outLoc).not.toEqual(from);
    expect(univ.transcript.at(-1)).toMatch(/^Moved: /);
  });

  it('slides the 96x96 window when the party nears its edge', () => {
    const session = newSession();
    const { univ, } = session;
    // Put the window somewhere with a sector to the east, then walk off it.
    univ.party.outdoorCorner = { x: 0, y: 0 };
    univ.party.iwc = { x: 1, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: 91, y: 20 };
    const cornerBefore = { ...univ.party.outdoorCorner };

    // moveTo does the shift regardless of whether the destination is walkable.
    session.moveTo({ x: 92, y: 20 });
    expect(univ.party.outdoorCorner.x).toBe(cornerBefore.x + 1);
    // Shifting keeps the party on the same world tile: it moves back half a
    // window in local coordinates as the corner advances one sector.
    expect(univ.party.outLoc.x).toBeLessThanOrEqual(92 - OUT_HALF_DIM + 1);
    expect(univ.party.iwc.x).toBe(0);
  });

  it('stops the party at the world edge', () => {
    const session = newSession();
    const { univ } = session;
    univ.party.outdoorCorner = { x: 0, y: 0 };
    univ.party.iwc = { x: 0, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: 0, y: 10 };
    expect(session.moveTo({ x: -1, y: 10 })).toBe(false);
    expect(univ.party.outLoc).toEqual({ x: 0, y: 10 });
  });

  it('enters a town by stepping onto a town-entrance tile', () => {
    const session = newSession();
    const { univ } = session;
    // Find a city loc whose terrain really is a town entrance.
    let found: { sx: number; sy: number; x: number; y: number; town: number } | null = null;
    for (let sx = 0; sx < scen.outWidth && !found; sx++)
      for (let sy = 0; sy < scen.outHeight && !found; sy++)
        for (const city of scen.outdoors[sx]![sy]!.cityLocs) {
          const ter = scen.outdoors[sx]![sy]!.terrain[city.x]![city.y]!;
          if (scen.terTypes[ter]!.special !== TerSpec.TOWN_ENTRANCE) continue;
          if (city.spec < 0 || city.y + 1 >= SECTOR_SIZE) continue;
          found = { sx, sy, x: city.x, y: city.y, town: city.spec };
          break;
        }
    expect(found).not.toBeNull();
    const at = found!;

    univ.party.outdoorCorner = { x: at.sx, y: at.sy };
    univ.party.iwc = { x: 0, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: at.x, y: at.y + 1 };
    univ.party.locInSec = { x: at.x, y: at.y + 1 };

    session.moveTo({ x: at.x, y: at.y });
    expect(session.inTown).toBe(true);
    expect(univ.party.townNum).toBe(at.town);
  });
});
