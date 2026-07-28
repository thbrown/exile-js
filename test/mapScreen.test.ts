import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { mapViewRect } from '../src/render/mapScreen';
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
  return new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
}

/**
 * draw_map's view_rect (boe.town.cpp:1345). The window is always 40 squares
 * across, so it slides with the party and stops at the edges of the sector or
 * the town — except a 32-square town, which is shown whole.
 */
describe('map view window', () => {
  it('slides with the party outdoors and clamps to the sector', async () => {
    const s = newSession();
    s.univ.party.locInSec = { x: 24, y: 30 };
    expect(mapViewRect(s, true)).toEqual({ left: 4, top: 8, right: 44, bottom: 48 });

    s.univ.party.locInSec = { x: 2, y: 47 };
    // minmax(0, 8, ...) both ways: never past the sector's far edge at 48.
    expect(mapViewRect(s, true)).toEqual({ left: 0, top: 8, right: 40, bottom: 48 });
  });

  it('clamps a 48-square town to 8 and a 64-square town to 24', async () => {
    const s = newSession();
    s.startNewGame();
    const town = s.univ.town!;
    s.univ.party.townLoc = { x: 40, y: 40 };
    const limit = town.record.maxDim === 64 ? 24 : 8;
    const view = mapViewRect(s, false);
    expect(view.left).toBe(limit);
    expect(view.right - view.left).toBe(40);
  });

  it('centres on the party when it is away from the edges', async () => {
    const s = newSession();
    s.startNewGame();
    s.univ.party.townLoc = { x: 22, y: 25 };
    // 22 - 20 = 2, inside the clamp either way.
    expect(mapViewRect(s, false).left).toBe(2);
    expect(mapViewRect(s, false).top).toBe(5);
  });
});
