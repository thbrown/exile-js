/**
 * The party stats panel: the status icons beside each name, and the five
 * things a click on a PC row can do.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { STATUS_NAMES, statIconRect, statusIconFor, statusName } from '../src/data/statusIcons';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { GameMode } from '../src/game/modes';
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

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  // A new game starts on the bed in Fort Talrus's guest quarters, which is
  // where `where_start` puts the party — a two-square room they can't walk
  // around in. Step them out to the town's own entrance square, which is what
  // these tests were written against.
  s.univ.party.townLoc = { ...s.univ.town!.record.startLocs[0]! };
  s.center = { ...s.univ.party.townLoc };
  s.updateExplored(s.univ.party.townLoc);
  return s;
}

describe('status icons', () => {
  it('shows nothing for a status that is not in effect', async () => {
    expect(statusIconFor(Status.POISON, 0)).toBe(-1);
    expect(statusIconFor(Status.WEBS, 0)).toBe(-1);
  });

  it('poison switches to its worse icon from level 4 up', async () => {
    // status_info: {true, 0, -1, {1, 4}} — icon 0 up to 3, icon 1 from 4.
    expect(statusIconFor(Status.POISON, 1)).toBe(0);
    expect(statusIconFor(Status.POISON, 3)).toBe(0);
    expect(statusIconFor(Status.POISON, 4)).toBe(1);
    expect(statusIconFor(Status.POISON, 8)).toBe(1);
  });

  it('a signed status shows a different icon each way', async () => {
    expect(statusIconFor(Status.BLESS_CURSE, 3)).toBe(2);
    expect(statusIconFor(Status.BLESS_CURSE, -3)).toBe(3);
    expect(statusIconFor(Status.HASTE_SLOW, 2)).toBe(6);
    expect(statusIconFor(Status.HASTE_SLOW, -2)).toBe(8);
  });

  it('a one-sided status has nothing to show when negative', async () => {
    expect(statusIconFor(Status.WEBS, -3)).toBe(-1);
    expect(statusIconFor(Status.DISEASE, -1)).toBe(-1);
  });

  it('lays icons out three to a row in staticons.png', async () => {
    expect(statIconRect(0)).toEqual({ left: 0, top: 0 });
    expect(statIconRect(2)).toEqual({ left: 24, top: 0 });
    expect(statIconRect(3)).toEqual({ left: 0, top: 12 });
    expect(statIconRect(22)).toEqual({ left: 12, top: 84 });
  });

  it('names every status it can draw an icon for', async () => {
    for (let s = Status.POISONED_WEAPON; s <= Status.CHARM; s++) {
      expect(STATUS_NAMES[s], `status ${Status[s]}`).toBeDefined();
    }
    expect(statusName(Status.POISON, 5)).toBe('Poisoned');
    expect(statusName(Status.BLESS_CURSE, 2)).toBe('Blessed');
    expect(statusName(Status.BLESS_CURSE, -2)).toBe('Cursed');
    expect(statusName(Status.POISON, 0)).toBeNull();
  });
});

describe('clicking a PC row', () => {
  it('switching makes that PC active', async () => {
    const s = inTown();
    s.switchPc(3);
    expect(s.univ.curPc).toBe(3);
    expect(s.univ.transcript.at(-1)).toContain('Now active');
  });

  it('refuses a PC who is not alive', async () => {
    const s = inTown();
    s.univ.party.pcs[3]!.mainStatus = MainStatus.DEAD;
    s.switchPc(3);
    expect(s.univ.curPc).not.toBe(3);
    expect(s.univ.transcript.at(-1)).toContain('must be here & active');
  });

  it('in combat it needs action points, not a pulse', async () => {
    const s = inTown();
    s.startCombat(s.univ.party.direction);
    expect(s.mode).toBe(GameMode.COMBAT);
    s.univ.party.pcs[2]!.ap = 0;
    s.switchPc(2);
    expect(s.univ.curPc).not.toBe(2);
    expect(s.univ.transcript.at(-1)).toContain('no APs');
    s.univ.party.pcs[2]!.ap = 4;
    s.switchPc(2);
    expect(s.univ.curPc).toBe(2);
  });

  it('the HP and SP read-outs say what they are', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.curHealth = 7;
    pc.maxHealth = 20;
    s.printPcHp(0);
    expect(s.univ.transcript.at(-1)).toBe(`${pc.name} has 7 health out of 20.`);
    s.printPcSp(0);
    expect(s.univ.transcript.at(-1)).toContain('spell points out of');
  });

  it('trade places takes two clicks and swaps the pair', async () => {
    const s = inTown();
    const names = s.univ.party.pcs.map((p) => p.name);
    s.tradePlaces(0);
    expect(s.univ.transcript.at(-1)).toContain('Switch with who?');
    // Nothing has moved yet.
    expect(s.univ.party.pcs.map((p) => p.name)).toEqual(names);
    s.tradePlaces(2);
    expect(s.univ.transcript.at(-1)).toBe('Switch: OK.');
    expect(s.univ.party.pcs[0]!.name).toBe(names[2]);
    expect(s.univ.party.pcs[2]!.name).toBe(names[0]);
  });

  it('refuses to trade a PC with themselves, and forgets the first pick', async () => {
    const s = inTown();
    const names = s.univ.party.pcs.map((p) => p.name);
    s.tradePlaces(1);
    s.tradePlaces(1);
    expect(s.univ.transcript.at(-1)).toContain('Not with self');
    expect(s.univ.party.pcs.map((p) => p.name)).toEqual(names);
    // The pending pick is cleared, so the next click starts over.
    s.tradePlaces(0);
    expect(s.univ.transcript.at(-1)).toContain('Switch with who?');
  });

  it('a trade follows the active PC to their new slot', async () => {
    const s = inTown();
    s.univ.curPc = 0;
    s.tradePlaces(0);
    s.tradePlaces(4);
    expect(s.univ.curPc).toBe(4);
  });

  it('a turn cancels a half-finished trade', async () => {
    const s = inTown();
    const names = s.univ.party.pcs.map((p) => p.name);
    s.tradePlaces(0);
    const at = s.univ.party.townLoc;
    await s.moveTo({ x: at.x, y: at.y + 1 });
    // The first pick is forgotten, so this click starts a new pair rather than
    // completing the old one.
    s.tradePlaces(2);
    expect(s.univ.transcript.at(-1)).toContain('Switch with who?');
    expect(s.univ.party.pcs.map((p) => p.name)).toEqual(names);
  });

  it('will not trade places in combat', async () => {
    const s = inTown();
    s.startCombat(s.univ.party.direction);
    const names = s.univ.party.pcs.map((p) => p.name);
    s.tradePlaces(0);
    s.tradePlaces(2);
    expect(s.univ.transcript.at(-1)).toContain("Can't do this in combat");
    expect(s.univ.party.pcs.map((p) => p.name)).toEqual(names);
  });
});
