/**
 * `adj_town_look` — the search half of looking at an adjacent square — plus
 * `is_container`, `is_unlockable` and the automap window's dragging.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { ItemType, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { TerSpec } from '../src/data/terrain';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { MAP_MIN_VISIBLE, MAP_W, MapScreen } from '../src/render/mapScreen';
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

let session: GameSession;

beforeEach(() => {
  session = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  session.startNewGame();
});

/** The first terrain in the scenario with the given special. */
function terrainWith(special: TerSpec): number {
  const i = scen.terTypes.findIndex((t) => t.special === special);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

/** Put `ter` at (x, y) with nothing else on it, and stand the party below. */
function standBy(x: number, y: number, ter: number): void {
  const town = session.univ.town!;
  town.record.terrain[x]![y] = ter;
  session.univ.party.townLoc = { x, y: y + 1 };
  session.center = { ...session.univ.party.townLoc };
}

describe('is_container', () => {
  it('is true for container terrain, and for a crate or barrel on the square', () => {
    const town = session.univ.town!;
    const shelf = terrainWith(TerSpec.IS_A_CONTAINER);
    town.record.terrain[10]![10] = shelf;
    expect(session.isContainer({ x: 10, y: 10 })).toBe(true);

    // Plain floor is not, until something is standing on it.
    expect(session.isContainer({ x: 11, y: 10 })).toBe(false);
    town.setField(11, 10, FieldType.OBJECT_CRATE, true);
    expect(session.isContainer({ x: 11, y: 10 })).toBe(true);
    town.setField(11, 10, FieldType.OBJECT_CRATE, false);
    town.setField(11, 10, FieldType.OBJECT_BARREL, true);
    expect(session.isContainer({ x: 11, y: 10 })).toBe(true);
  });

  it('a stone block is not a container — only crates and barrels are', () => {
    session.univ.town!.setField(12, 10, FieldType.OBJECT_BLOCK, true);
    expect(session.isContainer({ x: 12, y: 10 })).toBe(false);
  });
});

describe('adj_town_look', () => {
  /** A contained item on (x, y), which is what `do_look` refuses to list. */
  function hide(x: number, y: number, name: string): void {
    session.univ.town!.items.push({
      ...defaultItem(), variety: ItemType.NON_USE_OBJECT, name, fullName: name,
      itemLoc: { x, y }, contained: true, held: true,
    });
  }

  it('opens a container with something inside and hands back the contents', async () => {
    standBy(10, 10, terrainWith(TerSpec.IS_A_CONTAINER));
    hide(10, 10, 'Scroll');
    hide(10, 10, 'Another Scroll');
    // Something lying on the same square that isn't inside it stays out of it.
    session.univ.town!.items.push({
      ...defaultItem(), variety: ItemType.NON_USE_OBJECT, name: 'On the floor',
      itemLoc: { x: 10, y: 10 }, contained: false,
    });
    const found = await session.adjTownLook({ x: 10, y: 10 });
    expect(found?.map((i) => i.name)).toEqual(['Scroll', 'Another Scroll']);
  });

  it('an empty container searches like anything else', async () => {
    standBy(10, 10, terrainWith(TerSpec.IS_A_CONTAINER));
    expect(await session.adjTownLook({ x: 10, y: 10 })).toBeNull();
    expect(session.univ.transcript.at(-1))
      .toBe("  Search: You don't find anything.");
  });

  it('a hidden item on a square that is not a container stays hidden', async () => {
    standBy(10, 10, 0);
    hide(10, 10, 'Scroll');
    expect(await session.adjTownLook({ x: 10, y: 10 })).toBeNull();
  });

  it('a use-me square says so rather than reporting a failed search', async () => {
    standBy(10, 10, terrainWith(TerSpec.CHANGE_WHEN_USED));
    expect(await session.adjTownLook({ x: 10, y: 10 })).toBeNull();
    expect(session.univ.transcript.at(-1))
      .toBe('  (Use this space to do something with it.)');
  });

  it('says a distant square is out of reach, but opens it anyway', async () => {
    const town = session.univ.town!;
    standBy(10, 10, terrainWith(TerSpec.IS_A_CONTAINER));
    hide(10, 10, 'Scroll');
    // A special on the square is what makes it check the distance at all.
    town.record.specialLocs.push({ x: 10, y: 10, spec: 0 });
    session.univ.party.townLoc = { x: 20, y: 20 };
    const found = await session.adjTownLook({ x: 10, y: 10 });
    expect(session.univ.transcript).toContain('  Not close enough to search.');
    // "Not close enough" only skips the *special*; `can_open` is untouched, so
    // the container still opens. Unreachable in play — the caller checks
    // adjacency first — and pinned so the dead branch stays as written.
    expect(found?.map((i) => i.name)).toEqual(['Scroll']);
  });
});

describe('is_unlockable', () => {
  it('only a lockable door counts', () => {
    const town = session.univ.town!;
    town.record.terrain[10]![10] = terrainWith(TerSpec.UNLOCKABLE);
    expect(session.isUnlockable({ x: 10, y: 10 })).toBe(true);
    town.record.terrain[10]![10] = 0;
    expect(session.isUnlockable({ x: 10, y: 10 })).toBe(false);
    expect(session.isUnlockable({ x: -1, y: 10 })).toBe(false);
  });
});

describe('the automap window drags', () => {
  const screen = (): MapScreen =>
    new MapScreen(null as unknown as CanvasRenderingContext2D, null as never);

  it('follows the pointer by the delta since the last move', () => {
    const map = screen();
    map.startDrag(60, 70);
    map.dragTo(160, 150, 605, 430);
    expect(map.pos).toEqual({ x: 152, y: 142 });
    map.dragTo(150, 140, 605, 430);
    expect(map.pos).toEqual({ x: 142, y: 132 });
  });

  it('keeps at least 50px on the canvas, and the title bar never leaves the top', () => {
    const map = screen();
    map.startDrag(100, 100);
    map.dragTo(-900, -900, 605, 430);
    expect(map.pos).toEqual({ x: -MAP_W + MAP_MIN_VISIBLE, y: 0 });
    map.dragTo(2000, 2000, 605, 430);
    expect(map.pos).toEqual({ x: 605 - MAP_MIN_VISIBLE, y: 430 - MAP_MIN_VISIBLE });
  });

  it('ignores movement when nothing is being dragged', () => {
    const map = screen();
    map.dragTo(300, 300, 605, 430);
    expect(map.pos).toEqual({ x: 52, y: 62 });
    map.startDrag(0, 0);
    map.endDrag();
    map.dragTo(300, 300, 605, 430);
    expect(map.pos).toEqual({ x: 52, y: 62 });
  });

  it('the window follows its position', () => {
    const map = screen();
    map.pos = { x: 100, y: 20 };
    expect(map.window).toEqual({ top: 20, left: 100, bottom: 20 + 277, right: 100 + MAP_W });
    expect(map.contains(101, 21)).toBe(true);
    expect(map.contains(99, 21)).toBe(false);
  });
});
