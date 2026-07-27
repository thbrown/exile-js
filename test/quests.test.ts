/**
 * Quests, job banks, special items and the timers — the M6 bookkeeping chunk,
 * plus `special_increase_age`, the tick loop that fires them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import {
  Quest, QuestStatus, makeJob, makeQuest, specItemStartWith, specItemUseable,
} from '../src/data/quest';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { readQuestFromXml, readSpecItemFromXml, readTimerFromXml } from '../src/fileio/scenarioXml';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { parseXmlDoc } from '../src/fileio/xml';
import { GameSession } from '../src/game/session';
import { specialIncreaseAge } from '../src/game/specialIncreaseAge';
import { SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { PartyPreset } from '../src/universe/player';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

const SCENARIOS = ['valleydy', 'stealth', 'zakhazi', 'busywork'];

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

/** The bundled scenarios ship no quests, so the tests supply their own. */
let savedQuests: Quest[] = [];

beforeEach(() => { savedQuests = scen.quests.slice(); });
afterEach(() => {
  scen.quests.length = 0;
  scen.quests.push(...savedQuests);
  for (const t of scen.scenarioTimers) t.time = 0;
});

/** A quest on board `bank`, due `deadline` days after it was taken. */
function aQuest(deadline: number, bank = -1): Quest {
  const q = makeQuest();
  q.deadline = deadline;
  q.deadlineIsRelative = true;
  q.bank1 = bank;
  q.name = 'test quest';
  return q;
}

/** Everything the VM can ask for, doing nothing and recording the calls. */
class TestHost implements SpecialHost {
  messages: string[] = [];
  async message(str1: string): Promise<void> { this.messages.push(str1); }
  async choice(_s: string[], buttons: string[]): Promise<number> { return buttons.length - 1; }
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

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  return s;
}

/** The same, with the specials engine attached so timers can fire nodes. */
function withSpecials(): { session: GameSession; host: TestHost } {
  const session = inTown();
  const host = new TestHost();
  session.attachSpecials(host);
  return { session, host };
}

describe('the XML readers', () => {
  it('reads a special item, packing both flags into one number', async () => {
    const el = await parseXmlDoc(
      '<special-item start-with="true" useable="true" special="9">'
      + '<name>Orb</name><description>It glows.</description></special-item>');
    const item = readSpecItemFromXml(el);
    expect(item.special).toBe(9);
    expect(item.flags).toBe(11);
    expect(specItemUseable(item)).toBe(true);
    expect(specItemStartWith(item)).toBe(true);
    expect(item.name).toBe('Orb');
  });

  it('leaves flags at zero when neither attribute is set', async () => {
    const el = await parseXmlDoc(
      '<special-item special="-1"><name>a</name><description>b</description></special-item>');
    const item = readSpecItemFromXml(el);
    expect(item.flags).toBe(0);
    expect(specItemUseable(item)).toBe(false);
    expect(specItemStartWith(item)).toBe(false);
  });

  it('reads a quest with a relative deadline, a waiver and two banks', async () => {
    const el = await parseXmlDoc(
      '<quest start-with="true">'
      + '<deadline relative="true" waive-if="3">30</deadline>'
      + '<reward xp="100" gold="250"/><bank>1</bank><bank>4</bank>'
      + '<name>Find the cow</name><description>It wandered off.</description></quest>');
    const q = readQuestFromXml(el);
    expect(q.autoStart).toBe(true);
    expect(q.deadlineIsRelative).toBe(true);
    expect(q.event).toBe(3);
    expect(q.deadline).toBe(30);
    expect(q.xp).toBe(100);
    expect(q.gold).toBe(250);
    expect(q.bank1).toBe(1);
    expect(q.bank2).toBe(4);
  });

  it('defaults a quest to no deadline and no banks', async () => {
    const el = await parseXmlDoc('<quest><name>a</name><description>b</description></quest>');
    const q = readQuestFromXml(el);
    expect(q.deadline).toBe(-1);
    expect(q.bank1).toBe(-1);
    expect(q.autoStart).toBe(false);
  });

  it('rejects a quest with no name', async () => {
    const el = await parseXmlDoc('<quest><description>b</description></quest>');
    expect(() => readQuestFromXml(el)).toThrow(/missing <name>/);
  });

  it('requires a timer to carry freq', async () => {
    expect(readTimerFromXml(await parseXmlDoc('<timer freq="50">7</timer>')))
      .toEqual({ time: 50, node: 7 });
    await expect(parseXmlDoc('<timer>7</timer>').then(readTimerFromXml))
      .rejects.toThrow(/missing freq/);
  });

  it('every bundled scenario parses its quests, timers and special items', async () => {
    for (const name of SCENARIOS) {
      const s = await loadScenario(
        new FsSource(fileURLToPath(new URL(`../public/scenarios/${name}`, import.meta.url))),
        opcodes,
      );
      expect(Array.isArray(s.quests)).toBe(true);
      expect(Array.isArray(s.specialItems)).toBe(true);
      expect(Array.isArray(s.scenarioTimers)).toBe(true);
      for (const t of s.scenarioTimers) expect(Number.isFinite(t.time)).toBe(true);
    }
  });

  it('valleydy has its ten special items, two of them useable', () => {
    expect(scen.specialItems.length).toBeGreaterThan(0);
    expect(scen.specialItems.filter(specItemUseable).length).toBe(2);
  });
});

describe('the scenario start', () => {
  it('hands the party every start-with special item', () => {
    const s = inTown();
    for (let i = 0; i < scen.specialItems.length; i++) {
      expect(s.univ.party.specItems.has(i)).toBe(specItemStartWith(scen.specialItems[i]!));
    }
  });

  it('starts every auto-start quest on day 1', () => {
    const s = inTown();
    for (let i = 0; i < scen.quests.length; i++) {
      const job = s.univ.party.activeQuests.get(i);
      if (!scen.quests[i]!.autoStart) {
        expect(job).toBeUndefined();
      } else {
        expect(job?.status).toBe(QuestStatus.STARTED);
        // Day 1, not the current day — the C++ hardcodes cJob(1).
        expect(job?.start).toBe(1);
      }
    }
  });
});

describe('cParty::start_timer', () => {
  it('records the countdown, the node and which list it indexes', () => {
    const s = inTown();
    s.univ.party.startTimer(20, 7, SpecCtxType.SCEN);
    expect(s.univ.party.partyEventTimers).toEqual([
      { time: 20, nodeType: SpecCtxType.SCEN, node: 7 },
    ]);
  });
});

describe('special_increase_age', () => {
  it('ticks a party timer down by the length that passed', () => {
    const s = inTown();
    s.univ.party.startTimer(5, 7, SpecCtxType.SCEN);
    s.univ.party.age += 1;
    specialIncreaseAge(s, 1);
    expect(s.univ.party.partyEventTimers[0]!.time).toBe(4);
  });

  it('blanks the slot rather than removing it when the timer fires', () => {
    const s = inTown();
    s.univ.party.startTimer(1, 7, SpecCtxType.SCEN);
    s.univ.party.startTimer(50, 8, SpecCtxType.SCEN);
    s.univ.party.age += 1;
    specialIncreaseAge(s, 1);
    expect(s.univ.party.partyEventTimers.length).toBe(2);
    expect(s.univ.party.partyEventTimers[0]).toEqual(
      { time: 0, nodeType: SpecCtxType.SCEN, node: -1 });
    // The second slot is untouched apart from its own tick.
    expect(s.univ.party.partyEventTimers[1]!.node).toBe(8);
    expect(s.univ.party.partyEventTimers[1]!.time).toBe(49);
  });

  it('queues a chain rather than running it, and drains on the next action', async () => {
    const { session, host } = withSpecials();
    const engine = session.specials!;
    session.univ.scenario.scenSpecials.set(41, {
      ...emptySpecialNode(), type: SpecType.DISPLAY_MSG, m1: 0,
    });
    session.univ.scenario.specStrs = ['the timer fired'];
    session.univ.party.startTimer(1, 41, SpecCtxType.SCEN);
    session.univ.party.age += 1;
    specialIncreaseAge(session, 1, true);
    // Queued, not run: nothing has reached the host yet.
    expect(engine.queued).toBe(1);
    expect(host.messages).toEqual([]);
    await engine.drainQueue();
    expect(host.messages).toEqual(['the timer fired']);
  });

  it('runs the chain there and then when not queueing', async () => {
    const { session, host } = withSpecials();
    session.univ.scenario.scenSpecials.set(42, {
      ...emptySpecialNode(), type: SpecType.DISPLAY_MSG, m1: 0,
    });
    session.univ.scenario.specStrs = ['now'];
    session.univ.party.startTimer(1, 42, SpecCtxType.SCEN);
    session.univ.party.age += 1;
    specialIncreaseAge(session, 1);
    // The chain is launched fire-and-forget, so let the microtasks settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(host.messages).toEqual(['now']);
  });

  it('fails a quest whose deadline has passed, and angers the board', () => {
    const s = inTown();
    const party = s.univ.party;
    // A quest with a tight relative deadline, taken on day 1 from board 2.
    scen.quests.push(aQuest(5));
    party.activeQuests.set(scen.quests.length - 1, { ...makeJob(1), source: 2 });
    // Day 8 — past day 5 relative to day 1, so past the deadline.
    party.age = 3700 * 7 + 1;
    specialIncreaseAge(s, 1);
    const which = scen.quests.length - 1;
    expect(party.activeQuests.get(which)!.status).toBe(QuestStatus.FAILED);
    // A relative deadline scores +1, then +1 more for each of "under 20",
    // "under 10" and "under 5"; 5 is not under 5, so it stops at three.
    expect(party.jobBanks[2]!.anger).toBe(3);
    expect(s.univ.transcript.some((l) => l.includes('deadline'))).toBe(true);
  });

  it('leaves a quest alone until the deadline day itself has gone by', () => {
    const s = inTown();
    const party = s.univ.party;
    scen.quests.push(aQuest(5));
    const which = scen.quests.length - 1;
    party.activeQuests.set(which, { ...makeJob(1), source: -1 });
    // Day 5: start 1 + deadline 5 = 6, and the test is day_reached(7).
    party.age = 3700 * 4 + 1;
    specialIncreaseAge(s, 1);
    expect(party.activeQuests.get(which)!.status).toBe(QuestStatus.STARTED);
  });

  it('lets an angry job board cool off every thirtieth tick', () => {
    const s = inTown();
    const party = s.univ.party;
    party.jobBank(0).anger = 4;
    party.age = 30;
    specialIncreaseAge(s, 1);
    expect(party.jobBanks[0]!.anger).toBe(3);
    party.age = 31;
    specialIncreaseAge(s, 1);
    expect(party.jobBanks[0]!.anger).toBe(3);
  });
});

describe('generate_job_bank', () => {
  it('offers at most four quests and marks the bank inited', () => {
    const s = inTown();
    // Six quests on board 0, so the four-slot cap is the binding limit.
    for (let i = 0; i < 6; i++) scen.quests.push(aQuest(30, 0));
    const bank = s.univ.generateJobBank(0);
    expect(bank.inited).toBe(true);
    expect(bank.jobs.length).toBe(6);
    expect(bank.jobs.filter((j) => j >= 0).length).toBeLessThanOrEqual(4);
    for (const i of bank.jobs) if (i >= 0) expect(scen.quests[i]!.bank1).toBe(0);
  });

  it('never offers a quest the party has already taken', () => {
    const s = inTown();
    for (let i = 0; i < 6; i++) scen.quests.push(aQuest(30, 0));
    for (let i = 0; i < scen.quests.length; i++) {
      s.univ.party.activeQuests.set(i, makeJob(1));
    }
    const bank = s.univ.generateJobBank(0);
    expect(bank.jobs.every((j) => j === -1)).toBe(true);
  });

  it('grows the bank list to reach a board it has never seen', () => {
    const s = inTown();
    expect(s.univ.party.jobBanks.length).toBe(0);
    s.univ.party.jobBank(3);
    expect(s.univ.party.jobBanks.length).toBe(4);
    expect(s.univ.party.jobBanks[3]!.anger).toBe(0);
  });
});
