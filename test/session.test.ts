import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { SECTOR_SIZE } from '../src/data/outdoors';
import { Scenario } from '../src/data/scenario';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { TerObstruct, TerSpec } from '../src/data/terrain';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { SpecialHost } from '../src/game/specials/context';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { OUT_HALF_DIM } from '../src/universe/curOut';
import { TOWN_NUM_OUTDOORS } from '../src/universe/party';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Status } from '../src/universe/skills';
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
  it('starts with the six pregen adventurers', async () => {
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

  it('places the outdoor window on the scenario start sector', async () => {
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
  it('starts a new game inside the scenario start town', async () => {
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

  it('populates the town with its always-present creatures', async () => {
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

  it('leaves town when the party steps past the in-town boundary', async () => {
    const session = newSession();
    session.startNewGame();
    const rect = session.univ.town!.record.inTownRect;
    // Step straight onto the southern boundary.
    await session.moveTo({ x: session.univ.party.townLoc.x, y: rect.bottom });
    expect(session.mode).toBe(GameMode.OUTDOORS);
    expect(session.univ.party.townNum).toBe(TOWN_NUM_OUTDOORS);
    expect(session.univ.town).toBeNull();
    expect(session.univ.out.isOnMap(session.univ.party.outLoc.x, session.univ.party.outLoc.y)).toBe(
      true,
    );
  });

  it('remembers the town map between visits', async () => {
    const session = newSession();
    session.startNewGame();
    const record = session.univ.town!.record;
    const seen = session.univ.party.townLoc;
    await session.moveTo({ x: seen.x, y: record.inTownRect.bottom });
    expect(record.maps[seen.x]![seen.y]).toBe(1);

    session.startTownMode(scen.startTown, FORCED_ENTRY);
    expect(session.univ.town!.isExplored(seen.x, seen.y)).toBe(true);
  });

  it('picks the entrance opposite the direction of travel', async () => {
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

describe('town items', () => {
  it('places the town preset items on the floor', async () => {
    const session = newSession();
    session.startNewGame();
    const town = session.univ.town!;
    const presets = town.record.presetItems.filter((p) => p.code >= 0);
    expect(presets.length).toBeGreaterThan(0);
    expect(town.items.length).toBe(presets.length);
    for (const item of town.items) {
      expect(item.name.length).toBeGreaterThan(0);
      expect(town.isOnMap(item.itemLoc.x, item.itemLoc.y)).toBe(true);
      // is_special is the 1-based preset index, used to mark items as taken.
      expect(item.isSpecial).toBeGreaterThan(0);
    }
  });

  it('leaves out items the party already took, unless always there', async () => {
    const session = newSession();
    session.startNewGame();
    const record = session.univ.town!.record;
    const before = session.univ.town!.items.length;
    const takenIdx = record.presetItems.findIndex((p) => p.code >= 0 && !p.alwaysThere);
    if (takenIdx < 0) return;
    record.itemTaken[takenIdx] = true;
    session.startTownMode(scen.startTown, FORCED_ENTRY);
    expect(session.univ.town!.items.length).toBe(before - 1);
  });
});

describe('visibility', () => {
  it('reveals the 9x9 block around the party but not through walls', async () => {
    const session = newSession();
    session.startNewGame();
    const town = session.univ.town!;
    const p = session.univ.party.townLoc;
    expect(town.isExplored(p.x, p.y)).toBe(true);
    // Something within the 9x9 block is revealed…
    let revealed = 0;
    for (let x = p.x - 4; x <= p.x + 4; x++)
      for (let y = p.y - 4; y <= p.y + 4; y++)
        if (town.isOnMap(x, y) && town.isExplored(x, y)) revealed++;
    expect(revealed).toBeGreaterThan(1);
    // …and nothing outside it is.
    for (let x = 0; x < town.record.maxDim; x++)
      for (let y = 0; y < town.record.maxDim; y++)
        if (Math.abs(x - p.x) > 4 || Math.abs(y - p.y) > 4)
          expect(town.isExplored(x, y)).toBe(false);
  });

  it('treats normally lit towns as fully lit and dark ones by radius', async () => {
    const session = newSession();
    session.startNewGame();
    const town = session.univ.town!;
    if (town.record.lightingType === 0) {
      expect(session.lightRadius()).toBe(200);
      expect(session.ptInLight({ x: 0, y: 0 }, { x: 20, y: 20 })).toBe(true);
    }
    // With no light sources carried, a dark town lights only the adjacent ring.
    const dark = scen.towns.findIndex((t) => t.lightingType !== 0);
    if (dark < 0) return;
    session.startTownMode(dark, FORCED_ENTRY);
    expect(session.lightRadius()).toBe(1);
    const p = session.univ.party.townLoc;
    expect(session.ptInLight(p, { x: p.x + 1, y: p.y })).toBe(true);
    const far = { x: p.x + 8, y: p.y };
    if (session.univ.town!.isOnMap(far.x, far.y) && !session.univ.town!.isLit(far.x, far.y))
      expect(session.ptInLight(p, far)).toBe(false);
  });
});

describe('outdoor movement', () => {
  it('records movement in the transcript and advances the clock', async () => {
    const session = newSession();
    const { univ } = session;
    // Find an unblocked neighbour of the start position and step onto it.
    const from = univ.party.outLoc;
    const dirs = [Direction.N, Direction.E, Direction.S, Direction.W];
    const before = univ.party.age;
    let moved = false;
    for (const d of dirs) {
      if (await session.move(d)) {
        moved = true;
        break;
      }
    }
    expect(moved).toBe(true);
    // increase_age's outdoor clock: rounded down to a multiple of 10, then
    // +10 on foot. Not +1 — `age % 10 == 0` gates the wandering monsters.
    expect(univ.party.age).toBe(before - (before % 10) + 10);
    expect(univ.party.outLoc).not.toEqual(from);
    expect(univ.transcript.at(-1)).toMatch(/^Moved: /);
  });

  it('slides the 96x96 window when the party nears its edge', async () => {
    const session = newSession();
    const { univ, } = session;
    // Put the window somewhere with a sector to the east, then walk off it.
    univ.party.outdoorCorner = { x: 0, y: 0 };
    univ.party.iwc = { x: 1, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: 91, y: 20 };
    const cornerBefore = { ...univ.party.outdoorCorner };

    // moveTo does the shift regardless of whether the destination is walkable.
    await session.moveTo({ x: 92, y: 20 });
    expect(univ.party.outdoorCorner.x).toBe(cornerBefore.x + 1);
    // Shifting keeps the party on the same world tile: it moves back half a
    // window in local coordinates as the corner advances one sector.
    expect(univ.party.outLoc.x).toBeLessThanOrEqual(92 - OUT_HALF_DIM + 1);
    expect(univ.party.iwc.x).toBe(0);
  });

  it('stops the party at the world edge', async () => {
    const session = newSession();
    const { univ } = session;
    univ.party.outdoorCorner = { x: 0, y: 0 };
    univ.party.iwc = { x: 0, y: 0 };
    univ.out.build();
    univ.party.outLoc = { x: 0, y: 10 };
    expect(await session.moveTo({ x: -1, y: 10 })).toBe(false);
    expect(univ.party.outLoc).toEqual({ x: 0, y: 10 });
  });

  it('enters a town by stepping onto a town-entrance tile', async () => {
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

    await session.moveTo({ x: at.x, y: at.y });
    expect(session.inTown).toBe(true);
    expect(univ.party.townNum).toBe(at.town);
  });
});

/**
 * check_special_terrain runs on outdoor moves too (boe.actions.cpp:3950), which
 * is what makes a swamp poison the party on the world map. It used to bail out
 * whenever there was no town, so nothing outdoors ever hurt anyone.
 */
describe('outdoor terrain specials', () => {
  function outdoors(): GameSession {
    const s = newSession();
    s.startNewGame();
    // Walk straight out of the start town, dismissing nothing: endTownMode
    // returns the outdoor square, and the mode flips with it.
    s.endTownMode(s.univ.party.townLoc);
    return s;
  }

  it('poisons the party in a swamp', async () => {
    const s = outdoors();
    expect(s.inTown).toBe(false);
    // Find (or borrow) a DANGEROUS terrain that inflicts poison at 100%.
    const idx = scen.terTypes.findIndex((t) => t.special === TerSpec.DANGEROUS);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ter = { ...scen.terTypes[idx]! };
    const saved = scen.terTypes[idx]!;
    scen.terTypes[idx] = {
      ...ter, flag1: 4, flag2: 100, flag3: Status.POISON, blockage: 0,
    };
    try {
      const from = s.univ.party.outLoc;
      const to = { x: from.x + 1, y: from.y };
      s.univ.out.set(to.x, to.y, idx);
      const before = s.univ.party.pcs[0]!.status[Status.POISON] ?? 0;
      await s.moveTo(to);
      expect(s.univ.party.pcs[0]!.status[Status.POISON] ?? 0).toBeGreaterThan(before);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });

  /**
   * A river ford: the special node on the far bank of a blocking (deep
   * water) square returns `b` (forced) to walk the party through anyway —
   * the same CANT_ENTER trick a walk-through-a-wall node uses in town.
   * `outdMoveParty` used to read only the node's `blocked` return and drop
   * `forced` on the floor, so the ford's special could run and print its
   * message but the water still refused the step right after.
   */
  it('a forced CANT_ENTER node lets the party cross otherwise-blocked terrain', async () => {
    const s = outdoors();
    const host: SpecialHost = {
      async message() {},
      async choice(_strs, buttons) { return buttons.length - 1; },
      async askText() { return ''; },
      async selectPc() { return 0; },
      startShop() { return true; },
      startTalk() {},
      sound() {},
      rest() {},
      moveParty() {},
      changeLevel() {},
      endScenario() {},
    };
    s.attachSpecials(host);

    const idx = scen.terTypes.findIndex((t) => t.blockage === TerObstruct.BLOCK_MOVE);
    expect(idx).toBeGreaterThanOrEqual(0);
    const from = s.univ.party.outLoc;
    const to = { x: from.x + 1, y: from.y };
    s.univ.out.set(to.x, to.y, idx);

    const local = s.univ.party.globalToLocal(to);
    s.univ.out.sector.specialLocs.push({ x: local.x, y: local.y, spec: 0 });
    s.univ.out.sector.specials.set(0, {
      ...emptySpecialNode(), type: SpecType.CANT_ENTER, ex1a: 0, ex2a: 1,
    });

    const moved = await s.moveTo(to);
    expect(moved).toBe(true);
    expect(s.univ.party.outLoc).toEqual(to);
  });

  it('hurts the party on damaging terrain', async () => {
    const s = outdoors();
    const idx = scen.terTypes.findIndex((t) => t.special === TerSpec.DAMAGING);
    if (idx < 0) return; // no such terrain in this scenario
    const saved = scen.terTypes[idx]!;
    scen.terTypes[idx] = { ...saved, flag1: 6, flag2: 2, flag3: 0, blockage: 0 };
    try {
      const from = s.univ.party.outLoc;
      const to = { x: from.x, y: from.y + 1 };
      s.univ.out.set(to.x, to.y, idx);
      const before = s.univ.party.pcs[0]!.curHealth;
      await s.moveTo(to);
      expect(s.univ.party.pcs[0]!.curHealth).toBeLessThan(before);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });
});

describe('walking into things: webs, crates and conveyors', () => {
  /** A town session with a clear square next to the party, or null. */
  function townWithClearNeighbour(): { s: GameSession; to: { x: number; y: number } } | null {
    const s = newSession();
    s.startNewGame();
    const from = s.univ.party.townLoc;
    const candidates = [
      { x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y },
      { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 },
    ];
    const to = candidates.find((c) =>
      !s.townIsBlocked(c) && !s.univ.town!.monsterAt(c) && s.specialAt(c) < 0);
    return to ? { s, to } : null;
  }

  it('walking into a web catches the whole party and uses the web up', async () => {
    const found = townWithClearNeighbour();
    if (!found) return;
    const { s, to } = found;
    s.univ.town!.setField(to.x, to.y, FieldType.FIELD_WEB);
    await s.moveTo(to);
    expect(s.univ.transcript.some((l) => l.includes('Webs!'))).toBe(true);
    // Out of combat every PC is webbed, and the web is spent.
    for (const pc of s.univ.party.pcs)
      if (pc.isAlive) expect(pc.status[Status.WEBS] ?? 0).toBeGreaterThan(0);
    expect(s.univ.town!.hasField(to.x, to.y, FieldType.FIELD_WEB)).toBe(false);
  });

  it('walking into a barrel pushes it one square further along', async () => {
    const found = townWithClearNeighbour();
    if (!found) return;
    const { s, to } = found;
    const from = { ...s.univ.party.townLoc };
    const beyond = { x: to.x + (to.x - from.x), y: to.y + (to.y - from.y) };
    // Only meaningful when the square past it is clear; otherwise push_loc
    // swaps the barrel onto the pusher's square instead.
    if (s.townIsBlocked(beyond) || s.sightObscurity(beyond.x, beyond.y) > 0) return;
    s.univ.town!.setField(to.x, to.y, FieldType.OBJECT_BARREL);
    await s.moveTo(to);
    expect(s.univ.transcript.some((l) => l.includes('push the barrel'))).toBe(true);
    expect(s.univ.town!.hasField(to.x, to.y, FieldType.OBJECT_BARREL)).toBe(false);
    expect(s.univ.town!.hasField(beyond.x, beyond.y, FieldType.OBJECT_BARREL)).toBe(true);
  });

  it('a conveyor refuses to be walked against', async () => {
    const found = townWithClearNeighbour();
    if (!found) return;
    const { s, to } = found;
    const from = { ...s.univ.party.townLoc };
    // valleydy has no conveyor of its own, so borrow the terrain the party is
    // about to step onto and make it one.
    const idx = s.univ.town!.record.terrain[to.x]![to.y]!;
    const saved = scen.terTypes[idx]!;
    // Point the belt back the way the party is coming from.
    const dir = to.y < from.y ? Direction.S : to.y > from.y ? Direction.N
      : to.x > from.x ? Direction.W : Direction.E;
    scen.terTypes[idx] = { ...saved, special: TerSpec.CONVEYOR, flag1: dir, blockage: 0 };
    try {
      await s.moveTo(to);
      expect(s.univ.transcript.some((l) => l.includes('moving floor'))).toBe(true);
      expect(s.univ.party.townLoc).toEqual(from);
    } finally {
      scen.terTypes[idx] = saved;
    }
  });
});

describe('party death', () => {
  /**
   * `handle_party_death` (boe.actions.cpp:1431), called from the tail of
   * `advance_time` whenever `!univ.party.is_alive()`. This port had nothing
   * hooked up at all, so a party that died just kept sitting there with the
   * game still accepting input.
   */
  it('fires onPartyDeath exactly once when the last PC dies', async () => {
    const s = newSession();
    s.startNewGame();
    let fired = 0;
    s.onPartyDeath = () => { fired++; };
    for (const pc of s.univ.party.pcs) pc.mainStatus = MainStatus.DEAD;
    s.pause();
    expect(fired).toBe(1);
    // Upkeep keeps running on a dead party (nothing un-registers it), but the
    // hook must not fire again.
    s.pause();
    expect(fired).toBe(1);
  });

  it('does not fire while anyone is still alive', async () => {
    const s = newSession();
    s.startNewGame();
    let fired = 0;
    s.onPartyDeath = () => { fired++; };
    for (const pc of s.univ.party.pcs.slice(1)) pc.mainStatus = MainStatus.DEAD;
    s.pause();
    expect(fired).toBe(0);
  });
});
