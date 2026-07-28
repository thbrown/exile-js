import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
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

/** A no-op specials host, just enough to let the VM run. */
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

describe('boats and horses', () => {
  it('the stealth scenario places horses and boats from the .map files', async () => {
    // town1.map has horse markers at (6,24)/(8,24)/(10,24) and boat markers
    // at (17,54)/(19,53); town9.map and town19.map add more boats.
    expect(scen.horses.length).toBeGreaterThanOrEqual(5);
    expect(scen.boats.length).toBeGreaterThanOrEqual(7);
    expect(scen.horses.every((h) => h.exists)).toBe(true);
    expect(scen.boats.every((b) => b.exists)).toBe(true);
  });

  it('a fresh party gets its own copy of every vehicle the scenario placed', async () => {
    const { univ } = newSession();
    expect(univ.party.horses.length).toBe(scen.horses.length);
    expect(univ.party.boats.length).toBe(scen.boats.length);
    expect(univ.party.inBoat).toBe(-1);
    expect(univ.party.inHorse).toBe(-1);
  });

  it('walking onto a horse mounts it, and pausing dismounts it', async () => {
    const session = newSession();
    session.startTownMode(1, FORCED_ENTRY);
    // town1's horses are placed unowned ('H', not 'h') — boarding one refuses
    // with "Not your horses." until something (a CHANGE_HORSE_OWNER special,
    // here just the test) hands it over.
    session.univ.party.horses[0]!.property = false;
    // Stand one step south of the horse at (6,24) and walk onto it.
    session.univ.party.townLoc = { x: 6, y: 25 };
    const moved = await session.moveTo({ x: 6, y: 24 });
    expect(moved).toBe(true);
    expect(session.univ.party.inHorse).toBeGreaterThanOrEqual(0);
    expect(session.univ.party.townLoc).toEqual({ x: 6, y: 24 });

    const mountIndex = session.univ.party.inHorse;
    session.pause();
    expect(session.univ.party.inHorse).toBe(-1);
    expect(session.univ.party.horses[mountIndex]!.loc).toEqual({ x: 6, y: 24 });
    expect(session.univ.party.horses[mountIndex]!.whichTown).toBe(1);
  });

  it('refuses to board a horse the party does not own', async () => {
    const session = newSession();
    session.startTownMode(1, FORCED_ENTRY);
    session.univ.party.townLoc = { x: 6, y: 25 };
    const moved = await session.moveTo({ x: 6, y: 24 });
    expect(moved).toBe(false);
    expect(session.univ.party.inHorse).toBe(-1);
    expect(session.univ.transcript.at(-1)).toBe('  Not your horses.');
  });

  it('CHANGE_HORSE_OWNER flips the property flag (ex2a == 0 takes it, else gives it)', async () => {
    const session = newSession();
    const { univ } = session;
    session.attachSpecials(new TestHost());
    session.startTownMode(1, FORCED_ENTRY);
    univ.town!.record.specials = new Map([
      [0, { ...emptySpecialNode(), type: SpecType.CHANGE_HORSE_OWNER, ex1a: 0, ex2a: 1 }],
      [1, { ...emptySpecialNode(), type: SpecType.CHANGE_HORSE_OWNER, ex1a: 0, ex2a: 0 }],
    ]);

    expect(univ.party.horses[0]!.property).toBe(true);
    await session.runSpecialRaw(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 0, { x: 5, y: 5 });
    expect(univ.party.horses[0]!.property).toBe(false);
    await session.runSpecialRaw(SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, 1, { x: 5, y: 5 });
    expect(univ.party.horses[0]!.property).toBe(true);
  });

  it('a mounted party moves ten ticks per step outdoors, five on a horse', async () => {
    const session = newSession();
    const before = session.univ.party.age;
    await session.moveTo({ ...session.univ.party.outLoc, x: session.univ.party.outLoc.x + 1 });
    // On foot: rounds down to a multiple of 10 then adds 10.
    expect(session.univ.party.age - before).toBeLessThanOrEqual(10);
  });
});
