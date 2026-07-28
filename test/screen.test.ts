/**
 * `canDrawTerrainSpot` — the `can_draw` gate from `draw_terrain`
 * (boe.graphics.cpp:929), pulled out of `Screen` so it's testable without a
 * canvas.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { canDrawTerrainSpot } from '../src/render/screen';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
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
  const session = new GameSession(univ);
  session.startTownMode(0, FORCED_ENTRY);
  return session;
}

describe('canDrawTerrainSpot (town, out of combat)', () => {
  it('refuses an unexplored, unlit square by default', async () => {
    const s = newSession();
    const dim = s.univ.town!.record.maxDim;
    // Far corner of the map: certainly unexplored from a fresh town entry.
    const far = { x: dim - 1, y: dim - 1 };
    expect(s.univ.town!.isExplored(far.x, far.y)).toBe(false);
    expect(canDrawTerrainSpot(s, far.x, far.y, dim, dim)).toBe(false);
  });

  /**
   * The bug: this fallback only existed for combat targeting, not for plain
   * Look — so scrolling the view away from the party with the pointing
   * arrows while looking around left every unexplored square black, even
   * ones directly in front of the party that `partyCanSee` says are visible.
   */
  it('MODE_LOOK_TOWN falls back to partyCanSee for an unexplored square the party can actually see', async () => {
    const s = newSession();
    const dim = s.univ.town!.record.maxDim;
    const from = s.univ.party.townLoc;
    // party_can_see's on-screen test is waived once the view has been
    // scrolled away from the party (center !== party.town_loc) — the same
    // thing the pointing arrows do while looking around — which is what
    // makes a square outside updateExplored's ±4 window reachable at all.
    s.center = { x: from.x + 6, y: from.y };
    // updateExplored only marks a ±4 window, but party_can_see's line of
    // sight has no range limit — so a square just past that window, still on
    // a clear line, is unexplored yet visible. Scan outward along open ground
    // for one, since the exact terrain around the start town varies.
    let near: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (let x = 0; x < dim; x++) {
      for (let y = 0; y < dim; y++) {
        if (s.univ.town!.isExplored(x, y)) continue;
        if (s.partyCanSee({ x, y }) >= 6) continue;
        const d = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (d < bestDist) { bestDist = d; near = { x, y }; }
      }
    }
    expect(near).not.toBeNull();
    near = near!;

    // Plain town mode: no fallback, so it stays dark.
    expect(canDrawTerrainSpot(s, near.x, near.y, dim, dim)).toBe(false);

    // Looking: the fallback kicks in.
    s.mode = GameMode.LOOK_TOWN;
    expect(canDrawTerrainSpot(s, near.x, near.y, dim, dim)).toBe(true);
  });

  it('still refuses a square outside party_can_see even while looking', async () => {
    const s = newSession();
    const dim = s.univ.town!.record.maxDim;
    s.mode = GameMode.LOOK_TOWN;
    const far = { x: dim - 1, y: dim - 1 };
    expect(canDrawTerrainSpot(s, far.x, far.y, dim, dim)).toBe(false);
  });
});

/**
 * The `monsters_going` term of the combat gate (boe.graphics.cpp:940), which
 * this port was missing: while the monsters go the camera follows each one,
 * often onto ground the party has never explored, and the monster was then
 * drawn moving over pure black because `party_can_see_monst` doesn't consult
 * the explored map at all.
 */
describe('canDrawTerrainSpot (town combat, monsters going)', () => {
  function combatSession(): GameSession {
    const s = newSession();
    s.startCombat(s.univ.party.direction);
    // Town combat — `which_combat_type == 1` is what makes the explored map
    // count in the first place.
    expect(s.mode).toBe(GameMode.COMBAT);
    expect(s.whichCombatType).not.toBe(0);
    return s;
  }

  /** An unexplored square that a PC has line of sight to, or null. */
  function unexploredButVisible(s: GameSession): { x: number; y: number } | null {
    const dim = s.univ.town!.record.maxDim;
    for (let x = 0; x < dim; x++)
      for (let y = 0; y < dim; y++) {
        if (s.univ.town!.isExplored(x, y)) continue;
        if (s.partyCanSee({ x, y }) < 6) return { x, y };
      }
    return null;
  }

  it('draws unexplored ground the party can see while the monsters go', async () => {
    const s = combatSession();
    const dim = s.univ.town!.record.maxDim;
    const spot = unexploredButVisible(s);
    expect(spot).not.toBeNull();
    const { x, y } = spot!;

    expect(canDrawTerrainSpot(s, x, y, dim, dim)).toBe(false);
    s.monstersGoing = true;
    expect(canDrawTerrainSpot(s, x, y, dim, dim)).toBe(true);
  });

  it('does not draw what no PC can see, monsters going or not', async () => {
    const s = combatSession();
    const dim = s.univ.town!.record.maxDim;
    const far = { x: dim - 1, y: dim - 1 };
    expect(s.partyCanSee(far)).toBe(6);
    s.monstersGoing = true;
    expect(canDrawTerrainSpot(s, far.x, far.y, dim, dim)).toBe(false);
  });
});
