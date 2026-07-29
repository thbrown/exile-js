/**
 * `run_trap` and the ONCE_TRAP node that springs it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { SpecType, emptySpecialNode } from '../src/data/special';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameSession } from '../src/game/session';
import { SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { ONCE_DONE } from '../src/game/specials/oneshot';
import { TrapType, runTrap } from '../src/game/trap';
import { PartyPreset } from '../src/universe/player';
import { Skill, Status } from '../src/universe/skills';
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

/** A host that answers the trap's two questions however the test says. */
class TrapHost implements SpecialHost {
  buttons: string[][] = [];
  prompts: string[] = [];
  constructor(private answer: number, private pc = 0) {}
  async message(): Promise<void> {}
  async choice(_s: string[], buttons: string[]): Promise<number> {
    this.buttons.push(buttons);
    return this.answer;
  }
  async askText(): Promise<string> { return ''; }
  async selectPc(prompt: string): Promise<number> {
    this.prompts.push(prompt);
    return this.pc;
  }
  startShop(): boolean { return true; }
  startTalk(): void {}
  sound(): void {}
  rest(): void {}
  moveParty(): void {}
  changeLevel(): void {}
  endScenario(): void {}
}

/** A ONCE_TRAP node like Fort Talrus's: a blade trap behind a message. */
function trapNode(): void {
  const node = emptySpecialNode();
  node.type = SpecType.ONCE_TRAP;
  node.sd1 = 0;
  node.sd2 = 7;
  node.m1 = 11;
  node.ex1a = TrapType.BLADE;
  node.ex1b = 1;
  node.ex2a = 30;
  node.jumpto = -1;
  session.univ.town!.record.specials.set(90, node);
}

describe('run_trap', () => {
  it('a false alarm never goes off', async () => {
    expect(await runTrap(session, 6, TrapType.FALSE_ALARM, 1, 0)).toBe(true);
  });

  it('a hopeless roll springs the trap and hurts the disarmer', async () => {
    const pc = session.univ.party.pcs[0]!;
    pc.skills[Skill.DISARM_TRAPS] = 0;
    pc.skills[Skill.LUCK] = 0;
    // diff 100 puts the roll past the top of the odds table, so it can't pass.
    const before = pc.curHealth;
    expect(await runTrap(session, 0, TrapType.BLADE, 1, 100)).toBe(false);
    expect(session.univ.transcript).toContain('  Disarm failed.');
    // trap_level 1 means two knives.
    const knives = session.univ.transcript.filter((l) => l === '  A knife flies out!');
    expect(knives).toHaveLength(2);
    expect(pc.curHealth).toBeLessThan(before);
  });

  it('a certain roll disarms it and nothing happens', async () => {
    const pc = session.univ.party.pcs[0]!;
    pc.skills[Skill.DISARM_TRAPS] = 20;
    pc.skills[Skill.LUCK] = 20;
    const before = pc.curHealth;
    expect(await runTrap(session, 0, TrapType.BLADE, 1, -100)).toBe(true);
    expect(session.univ.transcript).toContain('  Trap disarmed.');
    expect(pc.curHealth).toBe(before);
  });

  it('pc 6 means nobody is disarming, so the roll is skipped entirely', async () => {
    await runTrap(session, 6, TrapType.DRAIN_XP, 1, 0);
    expect(session.univ.transcript).not.toContain('  Disarm failed.');
    expect(session.univ.transcript).toContain('  You feel weak.');
  });

  it('the paralysis ray is named for sleep but paralyses', async () => {
    const pc = session.univ.party.pcs[0]!;
    await runTrap(session, 6, TrapType.SLEEP_RAY, 1, 0);
    expect(session.univ.transcript).toContain('  A purple ray flies out.');
    expect(pc.status[Status.PARALYZED]).toBeGreaterThan(0);
  });

  it('a custom trap hands its level over through reserved pointer 15', async () => {
    await runTrap(session, 6, TrapType.CUSTOM, 4, 0);
    expect(session.univ.party.getPtr(15)).toBe(4);
  });
});

describe('the ONCE_TRAP node', () => {
  it('asks No/Yes, and refusing leaves it armed for next time', async () => {
    trapNode();
    const host = new TrapHost(0); // the first button, which is No
    session.attachSpecials(host);
    await session.runSpecial(SpecCtx.TOWN_LOOK, SpecCtxType.TOWN, 90, { x: 5, y: 5 });
    expect(host.buttons[0]).toEqual(['No', 'Yes']);
    // The one-shot flag stays clear, so the node runs again.
    expect(session.univ.party.getSdf(0, 7)).not.toBe(ONCE_DONE);
    expect(host.prompts).toHaveLength(0);
  });

  it('agreeing asks who disarms it and then marks the node done', async () => {
    trapNode();
    const pc = session.univ.party.pcs[0]!;
    pc.skills[Skill.DISARM_TRAPS] = 20;
    pc.skills[Skill.LUCK] = 20;
    const host = new TrapHost(1); // Yes
    session.attachSpecials(host);
    await session.runSpecial(SpecCtx.TOWN_LOOK, SpecCtxType.TOWN, 90, { x: 5, y: 5 });
    expect(host.prompts).toEqual(['Trap! Who will disarm?']);
    expect(session.univ.party.getSdf(0, 7)).toBe(ONCE_DONE);
  });

  it('a node with no message of its own asks the stock question', async () => {
    trapNode();
    session.univ.town!.record.specials.get(90)!.m1 = -1;
    const host = new TrapHost(0);
    session.attachSpecials(host);
    await session.runSpecial(SpecCtx.TOWN_LOOK, SpecCtxType.TOWN, 90, { x: 5, y: 5 });
    expect(host.buttons[0]).toEqual(['No', 'Yes']);
  });
});
