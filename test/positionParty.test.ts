/**
 * `position_party` (boe.fileio.cpp:218) and the two things that reach for it:
 * the TOWN_RELOCATE node and Word of Recall. Also the outdoor window's own
 * bookkeeping — the explored flags a sector remembers, and the wandering
 * groups that ride the window.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { doPriestSpell } from '../src/game/spellTown';
import { SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
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
    new FsSource(fileURLToPath(new URL('../public/scenarios/stealth', import.meta.url))),
    opcodes,
  );
});

class TestHost implements SpecialHost {
  async message(): Promise<void> {}
  async choice(_strs: string[], buttons: string[]): Promise<number> { return buttons.length - 1; }
  async askText(): Promise<string> { return ''; }
  async selectPc(): Promise<number> { return 0; }
  startShop(): boolean { return true; }
  startTalk(): void {}
  sound(): void {}
  rest(): void {}
  moveParty(): void {}
  changeLevel(): void {}
  endScenario(): void {}
}

function newSession(): GameSession {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  return new GameSession(univ);
}

describe('position_party', () => {
  it('moves the window, the corner and the sector-local position together', () => {
    const session = newSession();
    const { party } = session.univ;

    expect(session.positionParty(2, 1, 30, 40)).toBe(true);
    expect(party.outdoorCorner).toEqual({ x: 2, y: 1 });
    expect(party.outLoc).toEqual({ x: 30, y: 40 });
    expect(party.locInSec).toEqual({ x: 30, y: 40 });
    // The square is 0..47, so both `> 47` tests are false and the party always
    // lands in the window's top-left sector.
    expect(party.iwc).toEqual({ x: 0, y: 0 });
    expect(party.sector).toEqual({ x: 2, y: 1 });
  });

  it('refuses an out-of-bounds destination and leaves the party where it was', () => {
    const session = newSession();
    const { party, scenario } = session.univ;
    const corner = { ...party.outdoorCorner };
    const where = { ...party.outLoc };

    // stealth is 4x3 sectors, and a square is 0..47.
    expect(scenario.outWidth).toBe(4);
    expect(session.positionParty(4, 0, 10, 10)).toBe(false);
    expect(session.positionParty(0, 0, 48, 10)).toBe(false);
    expect(session.positionParty(0, 0, 10, -1)).toBe(false);
    expect(party.outdoorCorner).toEqual(corner);
    expect(party.outLoc).toEqual(where);
    expect(session.univ.transcript.at(-1)).toBe(
      'The scenario has tried to place you in an out of bounds outdoor location.');
  });

  it('clears every wandering group in flight', () => {
    const session = newSession();
    const group = session.univ.party.outC[0]!;
    group.exists = true;
    group.mLoc = { x: 50, y: 50 };

    session.positionParty(1, 1, 10, 10);
    expect(group.exists).toBe(false);
    expect(session.univ.party.outC.every((g) => !g.exists)).toBe(true);
  });

  it('reloads the explored flags of the sectors it lands on', () => {
    const session = newSession();
    const { party, scenario } = session.univ;
    // Remember a square of sector (2,1) as explored, then teleport onto it.
    scenario.outdoors[2]![1]!.maps[5]![6] = 1;

    session.positionParty(2, 1, 10, 10);
    expect(session.univ.out.explored[5]![6]).toBe(1);
    expect(party.outdoorCorner).toEqual({ x: 2, y: 1 });
  });

  it('saves what the party had explored before it leaves', () => {
    const session = newSession();
    const { party, scenario } = session.univ;
    const corner = { ...party.outdoorCorner };
    session.univ.out.explored[3]![4] = 1;

    session.positionParty(2, 1, 10, 10);
    expect(scenario.outdoors[corner.x]![corner.y]!.maps[3]![4]).toBe(1);
  });
});

describe('the outdoor window sliding', () => {
  it('restores a sector\'s remembered map when the window slides back onto it', () => {
    const session = newSession();
    const { party, scenario } = session.univ;
    // Put the corner at (1,1) and mark a square of sector (0,1) explored, so
    // it lives in the *western* sector the window is about to pick up.
    session.positionParty(1, 1, 10, 10);
    scenario.outdoors[0]![1]!.maps[20]![21] = 1;

    session.univ.out.shift(-1, 0);
    expect(party.outdoorCorner).toEqual({ x: 0, y: 1 });
    expect(session.univ.out.explored[20]![21]).toBe(1);
  });

  it('drops the wandering groups that fall off the edge and slides the rest', () => {
    const session = newSession();
    session.positionParty(1, 1, 10, 10);
    const near = session.univ.party.outC[0]!;
    const far = session.univ.party.outC[1]!;
    near.exists = true;
    near.mLoc = { x: 10, y: 10 };
    far.exists = true;
    far.mLoc = { x: 80, y: 10 };

    session.univ.out.shift(-1, 0);
    // Shifting left makes room on the west: the near group slides east by a
    // half-window, the far one would land past the edge and is forgotten.
    expect(near.exists).toBe(true);
    expect(near.mLoc).toEqual({ x: 58, y: 10 });
    expect(far.exists).toBe(false);
  });
});

describe('TOWN_RELOCATE', () => {
  it('is position_party, not a town move — ex1a/ex1b are the sector', async () => {
    const session = newSession();
    session.attachSpecials(new TestHost());
    session.startTownMode(1, FORCED_ENTRY);
    const townLoc = { ...session.univ.party.townLoc };

    session.univ.town!.record.specials = new Map([
      [0, {
        ...emptySpecialNode(),
        type: SpecType.TOWN_RELOCATE,
        ex1a: 2, ex1b: 1, ex2a: 33, ex2b: 44,
      }],
    ]);
    await session.runSpecialRaw(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 0, { x: 5, y: 5 });

    expect(session.univ.party.outdoorCorner).toEqual({ x: 2, y: 1 });
    expect(session.univ.party.outLoc).toEqual({ x: 33, y: 44 });
    // The party is standing in a town; the node changes where they come out.
    expect(session.univ.party.townLoc).toEqual(townLoc);
  });
});

describe('Word of Recall', () => {
  it('puts the party in the scenario start town and resets the outdoor position', () => {
    const session = newSession();
    const { univ } = session;
    // Cast from outdoors, somewhere else entirely.
    session.positionParty(0, 0, 5, 5);
    const pc = univ.party.pcs[1]!;
    pc.curSp = 40;

    doPriestSpell(session, 1, Spell.WORD_RECALL);

    expect(univ.party.townNum).toBe(univ.scenario.startTown);
    expect(univ.party.townLoc).toEqual(univ.scenario.townStart);
    // `<outdoor-start>` is the sector and `<sector-start>` the square.
    expect(univ.party.outdoorCorner).toEqual(univ.scenario.outdoorStart);
    expect(univ.party.outLoc).toEqual(univ.scenario.sectorStart);
    expect(pc.curSp).toBe(10);
    expect(univ.transcript).toContain('  You are moved... ');
  });

  it('refuses in a town, in a boat and on a horse, and charges nothing', () => {
    const session = newSession();
    const { univ } = session;
    const pc = univ.party.pcs[1]!;
    pc.curSp = 40;

    univ.party.inBoat = 0;
    doPriestSpell(session, 1, Spell.WORD_RECALL);
    expect(univ.transcript.at(-1)).toBe('  Not while in boat.');

    univ.party.inBoat = -1;
    univ.party.inHorse = 0;
    doPriestSpell(session, 1, Spell.WORD_RECALL);
    expect(univ.transcript.at(-1)).toBe('  Not while on horseback.');

    univ.party.inHorse = -1;
    session.startTownMode(1, FORCED_ENTRY);
    doPriestSpell(session, 1, Spell.WORD_RECALL);
    expect(univ.transcript.at(-1)).toBe('  Can only cast outdoors.');

    expect(pc.curSp).toBe(40);
  });
});
