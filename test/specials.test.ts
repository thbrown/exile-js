import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { SpecType, SpecialNode, emptySpecialNode } from '../src/data/special';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { SpecCtx, SpecCtxType, SpecialHost } from '../src/game/specials/context';
import { ONCE_DONE } from '../src/game/specials/oneshot';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
import { Status } from '../src/universe/skills';
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

/** Records everything the VM asked the host to do. */
class TestHost implements SpecialHost {
  messages: { str1: string; str2: string; title: string }[] = [];
  choices: { strs: string[]; buttons: string[] }[] = [];
  sounds: number[] = [];
  moves: { x: number; y: number }[] = [];
  levels: { town: number; where: { x: number; y: number } }[] = [];
  shops: number[] = [];
  ended = false;
  /** What choice() should return, in order; defaults to the last button. */
  answers: number[] = [];
  textAnswers: string[] = [];
  pcAnswer = 0;

  async message(str1: string, str2: string, title: string): Promise<void> {
    this.messages.push({ str1, str2, title });
  }

  async choice(strs: string[], buttons: string[]): Promise<number> {
    this.choices.push({ strs, buttons });
    return this.answers.shift() ?? buttons.length - 1;
  }

  stories: { title: string; first: number; last: number }[] = [];
  async story(title: string, first: number, last: number): Promise<void> {
    this.stories.push({ title, first, last });
  }
  async askText(): Promise<string> {
    return this.textAnswers.shift() ?? '';
  }

  async selectPc(): Promise<number> {
    return this.pcAnswer;
  }

  startShop(which: number): boolean {
    this.shops.push(which);
    return true;
  }

  startTalk(): void {}

  sound(which: number): void {
    this.sounds.push(which);
  }

  rest(): void {}

  moveParty(where: { x: number; y: number }): void {
    this.moves.push({ ...where });
  }

  changeLevel(town: number, where: { x: number; y: number }): void {
    this.levels.push({ town, where: { ...where } });
  }

  endScenario(): void {
    this.ended = true;
  }
}

/** A session in the start town with a set of synthetic nodes installed. */
function withNodes(nodes: Record<number, Partial<SpecialNode>>) {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  const host = new TestHost();
  session.attachSpecials(host);
  session.startTownMode(0, FORCED_ENTRY);
  // Replace the town's node list so the tests are self-contained.
  const map = new Map<number, SpecialNode>();
  for (const [num, node] of Object.entries(nodes))
    map.set(Number(num), { ...emptySpecialNode(), ...node });
  univ.town!.record.specials = map;
  univ.town!.record.specStrs = ['first string', 'second string', 'third string'];
  const run = (node = 0, mode = SpecCtx.TOWN_MOVE) =>
    session.runSpecialRaw(mode, SpecCtxType.TOWN, node, { x: 5, y: 5 });
  return { univ, session, host, run };
}

describe('the VM core', () => {
  /**
   * The one-chain-at-a-time lock has to come back down even when a handler
   * blows up. Callers launch chains fire-and-forget, so a stuck lock used to
   * queue every later special forever — one bad node killed all scripting for
   * the rest of the session.
   */
  it('keeps running specials after one chain throws', async () => {
    const { univ, session, host, run } = withNodes({
      0: { type: SpecType.DISPLAY_MSG, m1: 0 },
      1: { type: SpecType.SET_SDF, sd1: 3, sd2: 3, ex1a: 42 },
    });
    const boom = new Error('handler exploded');
    host.message = () => Promise.reject(boom);
    await run(0);
    expect(univ.transcript.at(-1)).toBe('SPECIAL ENCOUNTER FAILED.');
    // The lock is down again, so the next chain runs normally.
    expect(session.specials!.busy).toBe(false);
    await run(1);
    expect(univ.party.getSdf(3, 3)).toBe(42);
  });

  it('follows jumpto from node to node until it runs out', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.SET_SDF, sd1: 1, sd2: 1, ex1a: 7, jumpto: 3 },
      3: { type: SpecType.SET_SDF, sd1: 1, sd2: 2, ex1a: 8, jumpto: 4 },
      4: { type: SpecType.SET_SDF, sd1: 1, sd2: 3, ex1a: 9 },
    });
    await run();
    expect(univ.party.getSdf(1, 1)).toBe(7);
    expect(univ.party.getSdf(1, 2)).toBe(8);
    expect(univ.party.getSdf(1, 3)).toBe(9);
  });

  it('sets the reserved pointers to the trigger location and its terrain', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.NONE } });
    await run();
    expect(univ.party.getPtr(10)).toBe(5);
    expect(univ.party.getPtr(11)).toBe(5);
    expect(univ.party.getPtr(12)).toBe(univ.town!.record.terrain[5]![5]);
  });

  it('reads a field <= -10 as a pointer rather than a value', async () => {
    const { univ, run } = withNodes({
      // ex1a = -10 means "pointer 10", which holds the trigger's x.
      0: { type: SpecType.SET_SDF, sd1: 2, sd2: 0, ex1a: -10 },
    });
    await run();
    expect(univ.party.getSdf(2, 0)).toBe(5);
  });

  it('resolves a named pointer through the SDF it aliases', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.SET_POINTER, ex1a: 100, sd1: 4, sd2: 4, jumpto: 1 },
      1: { type: SpecType.SET_SDF, sd1: 5, sd2: 0, ex1a: -100 },
    });
    univ.party.setSdf(4, 4, 42);
    await run();
    expect(univ.party.getSdf(5, 0)).toBe(42);
  });

  it('stops on a node number that does not exist', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.SET_SDF, sd1: 1, sd2: 1, ex1a: 3, jumpto: 900 } });
    await run();
    expect(univ.party.getSdf(1, 1)).toBe(3);
    expect(univ.transcript.at(-1)).toContain('out of range');
  });

  it('cuts off a chain that never ends', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.NONE, jumpto: 0 } });
    await run();
    expect(univ.transcript.at(-1)).toContain('INTERRUPTED');
  });
});

describe('general nodes', () => {
  it('does SDF arithmetic, taking either literals or other flags', async () => {
    const { univ, run } = withNodes({
      // 6 + 7, both literal (ex?b === -1 means "take ex?a as a number").
      0: { type: SpecType.SDF_ADD, sd1: 1, sd2: 0, ex1a: 6, ex1b: -1, ex2a: 7, ex2b: -1, jumpto: 1 },
      // (1,0) * 2
      1: { type: SpecType.SDF_TIMES, sd1: 1, sd2: 1, ex1a: 1, ex1b: 0, ex2a: 2, ex2b: -1, jumpto: 2 },
      // 17 / 5, remainder into (1,3)
      2: {
        type: SpecType.SDF_DIVIDE, sd1: 1, sd2: 2, ex1a: 17, ex1b: -1, ex2a: 5, ex2b: -1,
        ex1c: 1, ex2c: 3,
      },
    });
    await run();
    expect(univ.party.getSdf(1, 0)).toBe(13);
    expect(univ.party.getSdf(1, 1)).toBe(26);
    expect(univ.party.getSdf(1, 2)).toBe(3);
    expect(univ.party.getSdf(1, 3)).toBe(2);
  });

  it('STORY_DIALOG passes a title and a *range*, not two paragraphs', async () => {
    // m1 is the title; m2..m3 is the run of strings the dialog pages through
    // (boe.specials.cpp:2458). The port used to send m1 and m2 to the plain
    // message box as if they were one message in two parts.
    const { host, run } = withNodes({
      0: { type: SpecType.STORY_DIALOG, m1: 0, m2: 1, m3: 2, pic: 3, pictype: 4 },
    });
    await run();
    expect(host.stories).toEqual([{ title: 'first string', first: 1, last: 2 }]);
    // And nothing went to the plain message box.
    expect(host.messages).toHaveLength(0);
  });

  it('flips and increments flags', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.FLIP_SDF, sd1: 3, sd2: 0, jumpto: 1 },
      1: { type: SpecType.INC_SDF, sd1: 3, sd2: 1, ex1a: 5, ex1b: 0, jumpto: 2 },
      2: { type: SpecType.INC_SDF, sd1: 3, sd2: 1, ex1a: 2, ex1b: 1 },
    });
    await run();
    expect(univ.party.getSdf(3, 0)).toBe(1);
    expect(univ.party.getSdf(3, 1)).toBe(3);
  });

  it('shows a message and reads its text from the right string list', async () => {
    const { host, run } = withNodes({
      0: { type: SpecType.DISPLAY_MSG, m1: 0, m2: 1 },
    });
    await run();
    expect(host.messages).toEqual([{ str1: 'first string', str2: 'second string', title: '' }]);
  });

  it('hands the strings back instead of showing them, in a conversation', async () => {
    const { run } = withNodes({ 0: { type: SpecType.DISPLAY_MSG, m1: 2, m2: 1 } });
    const result = await run(0, SpecCtx.TALK);
    expect(result).toEqual({ a: 2, b: 1 });
  });

  it('builds a line in the string buffer', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.CLEAR_BUF, jumpto: 1 },
      // pic 0 means "no leading space"; the field's default of -1 is truthy.
      1: { type: SpecType.APPEND_STRING, ex1a: 0, pic: 0, jumpto: 2 },
      2: { type: SpecType.APPEND_NUM, ex1a: 42, pic: 1, jumpto: 3 },
      // BUFFER_STR is -8; note handle_message's guard means a node whose
      // *only* string is the buffer prints nothing, exactly as the C++ does.
      3: { type: SpecType.DISPLAY_MSG, m1: -8, m2: 0 },
    });
    await run();
    expect(univ.strBuf).toBe('first string 42');
    expect(host.messages[0]!.str1).toBe('first string 42');
  });

  it('blocks the step for a CANT_ENTER node', async () => {
    const { run } = withNodes({ 0: { type: SpecType.CANT_ENTER, ex1a: 1 } });
    expect((await run()).a).toBe(1);
  });

  it('changes terrain and plays sounds', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.CHANGE_TER, ex1a: 4, ex1b: 4, ex2a: 2, jumpto: 1 },
      1: { type: SpecType.PLAY_SOUND, ex1a: 25, ex1b: 0 },
    });
    await run();
    expect(univ.town!.record.terrain[4]![4]).toBe(2);
    // A negative number means "play asynchronously".
    expect(host.sounds).toEqual([-25]);
  });

  it('ends the scenario', async () => {
    const { host, run } = withNodes({ 0: { type: SpecType.END_SCENARIO } });
    await run();
    expect(host.ended).toBe(true);
  });
});

describe('if-then nodes', () => {
  it('branches on a flag being at or above a value', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.IF_SDF, sd1: 8, sd2: 0, ex1a: 5, ex1b: 10, jumpto: 20 },
      10: { type: SpecType.SET_SDF, sd1: 9, sd2: 0, ex1a: 1 },
      20: { type: SpecType.SET_SDF, sd1: 9, sd2: 0, ex1a: 2 },
    });
    univ.party.setSdf(8, 0, 4);
    await run();
    expect(univ.party.getSdf(9, 0)).toBe(2); // fell through to jumpto

    univ.party.setSdf(8, 0, 6);
    await run();
    expect(univ.party.getSdf(9, 0)).toBe(1); // took the branch
  });

  it('charges gold when the test says to take it', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.IF_HAS_GOLD, ex1a: 50, ex1b: 10, ex2a: 1, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 11, sd2: 0, ex1a: 1 },
    });
    univ.party.gold = 100;
    await run();
    expect(univ.party.gold).toBe(50);
    expect(univ.party.getSdf(11, 0)).toBe(1);

    // Too poor: no branch, no charge.
    univ.party.gold = 10;
    univ.party.setSdf(11, 0, 0);
    await run();
    expect(univ.party.gold).toBe(10);
    expect(univ.party.getSdf(11, 0)).toBe(0);
  });

  it('branches on a special item the party holds', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.IF_HAVE_SPECIAL_ITEM, ex1a: 3, ex1b: 10, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 12, sd2: 0, ex1a: 1 },
    });
    await run();
    expect(univ.party.getSdf(12, 0)).toBe(0);
    univ.party.specItems.add(3);
    await run();
    expect(univ.party.getSdf(12, 0)).toBe(1);
  });

  it('branches on the answer to a typed question', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.IF_TEXT_RESPONSE, m1: 0, pic: 5, ex1a: 1, ex1b: 10, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 13, sd2: 0, ex1a: 1 },
    });
    // The scenario-level list is what IF_TEXT_RESPONSE reads.
    scen.specStrs[0] = 'What is the password?';
    scen.specStrs[1] = 'second string';
    host.textAnswers = ['SECOND'];
    await run();
    expect(univ.party.getSdf(13, 0)).toBe(1);
  });

  it('compares a party statistic', async () => {
    const { univ, run } = withNodes({
      // Strength, cumulative across the party, at least 20.
      0: { type: SpecType.IF_STATISTIC, ex1a: 20, ex1b: 10, ex2a: 0, ex2b: 0, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 14, sd2: 0, ex1a: 1 },
    });
    await run();
    expect(univ.party.getSdf(14, 0)).toBe(1);
  });
});

describe('one-shot nodes', () => {
  it('fires once, then refuses to run again', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.ONCE_DISPLAY_MSG, sd1: 20, sd2: 0, m1: 0, jumpto: 1 },
      1: { type: SpecType.SET_SDF, sd1: 21, sd2: 0, ex1a: 1 },
    });
    await run();
    expect(host.messages.length).toBe(1);
    expect(univ.party.getSdf(20, 0)).toBe(ONCE_DONE);
    expect(univ.party.getSdf(21, 0)).toBe(1);

    // Second time: nothing happens, and the chain stops dead.
    univ.party.setSdf(21, 0, 0);
    await run();
    expect(host.messages.length).toBe(1);
    expect(univ.party.getSdf(21, 0)).toBe(0);
  });

  it('gives an item and marks itself done', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.ONCE_GIVE_ITEM, sd1: 22, sd2: 0, ex1a: 3, ex1b: 100, ex2a: 50 },
    });
    const goldBefore = univ.party.gold;
    const foodBefore = univ.party.food;
    await run();
    expect(univ.party.gold).toBe(goldBefore + 100);
    // The item itself may be food, which lands on top of the node's 50.
    expect(univ.party.food).toBeGreaterThanOrEqual(foodBefore + 50);
    expect(univ.party.getSdf(22, 0)).toBe(ONCE_DONE);
  });

  it('leaves the flag unset when the player walks away from a gift', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.ONCE_GIVE_ITEM_DIALOG, sd1: 23, sd2: 0, m1: 0, ex1a: 3 },
    });
    host.answers = [0]; // Leave
    await run();
    expect(univ.party.getSdf(23, 0)).toBe(0);
    expect(host.choices[0]!.buttons).toEqual(['Leave', 'Take']);
  });

  it('offers a dialog and branches on which button was pressed', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.ONCE_DIALOG, sd1: 24, sd2: 0, m1: 0, m3: 1, ex1a: 2, ex1b: 10, jumpto: -1 },
      10: { type: SpecType.SET_SDF, sd1: 25, sd2: 0, ex1a: 1 },
    });
    host.answers = [1]; // the second button, which is ex1a's "Yes"
    await run();
    expect(host.choices[0]!.buttons).toEqual(['Leave', 'Yes']);
    expect(univ.party.getSdf(25, 0)).toBe(1);
  });
});

describe('town and rect nodes', () => {
  it('moves the party', async () => {
    const { host, run } = withNodes({
      0: { type: SpecType.TOWN_MOVE_PARTY, ex1a: 12, ex1b: 13 },
    });
    await run();
    expect(host.moves).toEqual([{ x: 12, y: 13 }]);
  });

  it('kills every hostile creature in town', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.TOWN_NUKE_MONSTS, ex1a: -2 } });
    const town = univ.town!;
    const hostiles = town.monsters.filter((m) => m.isAlive && !m.isFriendly).length;
    const friendlies = town.monsters.filter((m) => m.isAlive && m.isFriendly).length;
    if (hostiles === 0) return;
    await run();
    expect(town.monsters.filter((m) => m.isAlive && !m.isFriendly).length).toBe(0);
    expect(town.monsters.filter((m) => m.isAlive && m.isFriendly).length).toBe(friendlies);
  });

  it('paints terrain over a rectangle', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.RECT_CHANGE_TER, ex1a: 10, ex1b: 10, ex2a: 12, ex2b: 12, sd1: 2, sd2: 100 },
    });
    await run();
    for (let x = 10; x <= 12; x++)
      for (let y = 10; y <= 12; y++)
        expect(univ.town!.record.terrain[x]![y]).toBe(2);
  });

  it('paints only the border when pic is set', async () => {
    const { univ, run } = withNodes({
      0: {
        type: SpecType.RECT_CHANGE_TER, ex1a: 20, ex1b: 20, ex2a: 24, ex2b: 24,
        sd1: 2, sd2: 100, pic: 1,
      },
    });
    const middle = univ.town!.record.terrain[22]![22];
    await run();
    expect(univ.town!.record.terrain[20]![20]).toBe(2);
    expect(univ.town!.record.terrain[22]![20]).toBe(2);
    // The interior is untouched.
    expect(univ.town!.record.terrain[22]![22]).toBe(middle);
  });

  it('takes a staircase to another town', async () => {
    const { host, run } = withNodes({
      0: { type: SpecType.TOWN_GENERIC_STAIR, ex2a: 3, ex1a: 7, ex1b: 8, ex2b: 1 },
    });
    await run();
    expect(host.levels).toEqual([{ town: 3, where: { x: 7, y: 8 } }]);
  });
});

describe('affect nodes', () => {
  it('gives and takes gold and food', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_GOLD, ex1a: 500, ex1b: 0, jumpto: 1 },
      1: { type: SpecType.AFFECT_FOOD, ex1a: 30, ex1b: 1 },
    });
    univ.party.gold = 100;
    univ.party.food = 100;
    await run();
    expect(univ.party.gold).toBe(600);
    expect(univ.party.food).toBe(70);
  });

  it('heals the party', async () => {
    const { univ, run } = withNodes({ 0: { type: SpecType.AFFECT_HP, ex1a: 10, ex1b: 0 } });
    univ.party.pcs.forEach((pc) => { pc.curHealth = 1; });
    await run();
    for (const pc of univ.party.pcs) expect(pc.curHealth).toBeGreaterThan(1);
  });

  it('teaches a spell to one chosen character', async () => {
    const { univ, host, run } = withNodes({
      0: { type: SpecType.SELECT_TARGET, ex1a: 1, ex2a: 0, jumpto: 1 },
      1: { type: SpecType.AFFECT_MAGE_SPELL, ex1a: 30, ex1b: 0 },
    });
    host.pcAnswer = 2;
    await run();
    expect(univ.party.pcs[2]!.mageSpells[30]).toBe(true);
    expect(univ.party.pcs[0]!.mageSpells[30]).toBe(false);
  });

  it('raises a skill, capped at its maximum', async () => {
    const { univ, run } = withNodes({
      // pic is a percentage chance; 101 always lands.
      0: { type: SpecType.AFFECT_STAT, ex2a: 15, ex1a: 3, ex1b: 0, pic: 101 },
    });
    const before = univ.party.pcs[0]!.skills[15]!;
    await run();
    expect(univ.party.pcs[0]!.skills[15]).toBe(before + 3);
  });

  /**
   * A generic add-and-clamp on `status[]` used to land the number with no
   * visible effect: the message ("X diseased.") and the sound both come from
   * `cPlayer::disease`, not from the special node, so a scenario's "you feel
   * ill" node looked like a no-op even though the status array changed.
   *
   * The status type lives in **ex1c**, not ex2a — the first pass at this fix
   * read the wrong field, so a real node (ex2a always -1, unused) still hit
   * the range guard and bailed before doing anything. This scenario node
   * (valleydy out2~0.spec node 2, the "drink the tainted water" event) is
   * what caught it: `ex1a=5, ex1b=1, ex1c=7` (DISEASE).
   */
  it('AFFECT_STATUS routes disease through cPlayer::disease, with its message', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_STATUS, ex1a: 5, ex1b: 1, ex1c: Status.DISEASE },
    });
    const pc = univ.party.pcs[0]!;
    pc.status[Status.DISEASE] = 0;
    await run();
    expect(pc.status[Status.DISEASE]).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('diseased'))).toBe(true);
  });

  it('AFFECT_STATUS poisons with the saving-throw method, not a raw set', async () => {
    const { univ, run } = withNodes({
      0: { type: SpecType.AFFECT_STATUS, ex1a: 4, ex1b: 1, ex1c: Status.POISON },
    });
    const pc = univ.party.pcs[0]!;
    pc.status[Status.POISON] = 0;
    await run();
    expect(pc.status[Status.POISON]).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('poisoned'))).toBe(true);
  });

  /**
   * The exact real node this was found from: valleydy's out2~0.spec node 2,
   * reached from node 1's "Do you drink some?" dialog (ONCE_DIALOG, ex1a=28
   * "Drink" jumping to node 2). Pinned directly against the scenario's own
   * data rather than a synthetic node, so a future field-numbering slip in
   * either direction shows up here too.
   */
  it('the scenario\'s own "drink the tainted water" node diseases the party', async () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.attachSpecials(new TestHost());
    session.startNewGame();
    univ.party.outdoorCorner = { x: 2, y: 0 };
    univ.party.iwc = { x: 0, y: 0 };
    const node = univ.out.sector.specials.get(2)!;
    expect(node.type).toBe(SpecType.AFFECT_STATUS);
    expect(node.ex1c).toBe(Status.DISEASE);

    for (const pc of univ.party.pcs) pc.status[Status.DISEASE] = 0;
    await session.runSpecialRaw(SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, 2, { x: 0, y: 0 });
    expect(univ.party.pcs.every((pc) => (pc.status[Status.DISEASE] ?? 0) > 0)).toBe(true);
    expect(univ.transcript.some((l) => l.includes('diseased'))).toBe(true);
  });
});

describe('every .spec node in the bundled scenario', () => {
  it('runs without throwing', async () => {
    // Not a fidelity check — a crash check. Every node in the start town gets
    // executed with a recording host, which exercises the dispatch table and
    // every handler's argument handling against real scenario data.
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.attachSpecials(new TestHost());
    session.startTownMode(0, FORCED_ENTRY);
    const nodes = [...(univ.town!.record.specials.keys())];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      await session.runSpecialRaw(
        SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, node, { x: 5, y: 5 });
    }
  });
});
