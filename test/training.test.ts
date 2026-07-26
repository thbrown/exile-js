import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { TalkNodeType } from '../src/data/talking';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { doRest, healPc, restorePcSp } from '../src/game/rest';
import { TrainingState, trainCost } from '../src/game/training';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Skill, Status, Trait } from '../src/universe/skills';
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

function newGame(): { univ: Universe; session: GameSession } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startTownMode(0, FORCED_ENTRY);
  return { univ, session };
}

describe('training', () => {
  it('charges both skill points and gold', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 20;
    const state = new TrainingState(pc, 1000);
    const cost = trainCost(Skill.LOCKPICKING);
    const before = pc.skills[Skill.LOCKPICKING]!;

    expect(state.change(Skill.LOCKPICKING, true)).toBe(true);
    expect(state.points).toBe(20 - cost.points);
    expect(state.gold).toBe(1000 - cost.gold);
    // Nothing is committed until keep().
    expect(pc.skills[Skill.LOCKPICKING]).toBe(before);
    expect(state.keep()).toBe(1000 - cost.gold);
    expect(pc.skills[Skill.LOCKPICKING]).toBe(before + 1);
    expect(pc.skillPts).toBe(20 - cost.points);
  });

  it('refuses without the skill points or the gold', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 0;
    expect(new TrainingState(pc, 10000).canChange(Skill.LUCK, true)).toBe(false);
    pc.skillPts = 100;
    expect(new TrainingState(pc, 0).canChange(Skill.STRENGTH, true)).toBe(false);
    expect(new TrainingState(pc, 10000).canChange(Skill.STRENGTH, true)).toBe(true);
  });

  it('stops at the skill cap', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 1000;
    pc.skills[Skill.MAGE_SPELLS] = 7; // the mage-spell cap
    const state = new TrainingState(pc, 100000);
    expect(state.canChange(Skill.MAGE_SPELLS, true)).toBe(false);
    expect(state.canChange(Skill.MAGE_LORE, true)).toBe(true);
  });

  it("won't refund a level the PC came in with, but will refund this session's", () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 100;
    pc.skills[Skill.LOCKPICKING] = 3;
    const state = new TrainingState(pc, 10000);
    expect(state.canChange(Skill.LOCKPICKING, false)).toBe(false);
    state.change(Skill.LOCKPICKING, true);
    expect(state.canChange(Skill.LOCKPICKING, false)).toBe(true);
    state.change(Skill.LOCKPICKING, false);
    expect(state.level(Skill.LOCKPICKING)).toBe(3);
    expect(state.points).toBe(100);
    expect(state.gold).toBe(10000);
  });

  it('buys health two at a time, already filled', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.skillPts = 10;
    pc.curHealth = pc.maxHealth;
    const maxBefore = pc.maxHealth;
    const state = new TrainingState(pc, 1000);
    expect(state.change('hp', true)).toBe(true);
    state.keep();
    expect(pc.maxHealth).toBe(maxBefore + 2);
    expect(pc.curHealth).toBe(pc.maxHealth);
  });

  it('curses an Anama member who takes up mage magic', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.traits[Trait.ANAMA] = true;
    pc.skills[Skill.MAGE_SPELLS] = 0;
    pc.skills[Skill.STRENGTH] = 10;
    pc.skills[Skill.DEXTERITY] = 10;
    pc.skills[Skill.INTELLIGENCE] = 10;
    pc.skills[Skill.LUCK] = 5;
    pc.skillPts = 100;
    const state = new TrainingState(pc, 10000);
    state.change(Skill.MAGE_SPELLS, true);
    expect(state.breaksAnamaOath).toBe(true);
    state.keep();
    expect(pc.skills[Skill.STRENGTH]).toBe(8);
    expect(pc.skills[Skill.DEXTERITY]).toBe(8);
    expect(pc.skills[Skill.INTELLIGENCE]).toBe(6);
    expect(pc.skills[Skill.LUCK]).toBe(0);
    expect(pc.traits[Trait.ANAMA]).toBe(false);
  });

  it('only offers PCs with skill points to spend', () => {
    const { univ, session } = newGame();
    univ.party.pcs.forEach((pc) => { pc.skillPts = 0; });
    univ.party.pcs[2]!.skillPts = 5;
    const options = session.selectPcOptions('train');
    expect(options.filter((o) => o.canPick).map((o) => o.index)).toEqual([2]);
    expect(options[2]!.label).toContain('5 skill points');
    expect(options[0]!.label).toContain('no skill points');
  });
});

describe('the Rest command', () => {
  it('rests, costs food, and plays its sound', () => {
    const { univ, session } = newGame();
    const sounds: number[] = [];
    session.sound = { play: (n: number) => sounds.push(n) } as never;
    univ.party.food = 100;
    univ.party.pcs.forEach((pc) => { pc.curHealth = 1; });
    const ageBefore = univ.party.age;

    expect(session.rest()).toBe(true);
    expect(univ.party.food).toBe(94);
    expect(univ.party.age).toBe(ageBefore + 1200);
    expect(univ.party.pcs[0]!.curHealth).toBeGreaterThan(1);
    // Sound 20, negative meaning "asynchronously".
    expect(sounds).toContain(-20);
    expect(univ.transcript).toContain('Resting...');
    expect(univ.transcript.at(-1)).toBe('  Rest successful.');
  });

  it('refuses when poisoned, hungry, or in a boat', () => {
    const cases: [string, (u: Universe) => void, string][] = [
      ['poison', (u) => { u.party.pcs[0]!.status[Status.POISON] = 3; }, 'Someone poisoned'],
      ['food', (u) => { u.party.food = 5; }, 'Not enough food'],
      ['boat', (u) => { u.party.inBoat = 0; }, 'Not in boat'],
    ];
    for (const [, setup, expected] of cases) {
      const { univ, session } = newGame();
      setup(univ);
      expect(session.rest()).toBe(false);
      expect(univ.transcript.at(-1)).toContain(expected);
    }
  });
});

describe('resting', () => {
  it('heals and restores, capped at the maximum', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[3]!;
    pc.curHealth = 1;
    pc.curSp = 0;
    healPc(pc, 5);
    expect(pc.curHealth).toBe(6);
    healPc(pc, 1000);
    expect(pc.curHealth).toBe(pc.maxHealth);
    restorePcSp(pc, 1000);
    expect(pc.curSp).toBe(pc.maxSp);
    // The dead don't recover.
    pc.mainStatus = MainStatus.DEAD;
    pc.curHealth = 1;
    healPc(pc, 10);
    expect(pc.curHealth).toBe(1);
  });

  it('advances the clock, clears statuses, and heals the party', () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => {
      pc.curHealth = 1;
      pc.status[Status.POISON] = 4;
    });
    const ageBefore = univ.party.age;
    doRest(univ, 700, 30, 25);
    expect(univ.party.age).toBe(ageBefore + 700);
    for (const pc of univ.party.pcs) {
      expect(pc.status[Status.POISON]).toBe(0);
      expect(pc.curHealth).toBeGreaterThan(1);
    }
  });

  it('restocks the random shops on a long rest', () => {
    const { univ } = newGame();
    const which = scen.shops.findIndex((s) => s.type === 2);
    const before = [...(univ.party.magicStoreItems.get(which)?.values() ?? [])]
      .map((i) => i.fullName);
    doRest(univ, 700, 10, 10);
    const short = [...(univ.party.magicStoreItems.get(which)?.values() ?? [])]
      .map((i) => i.fullName);
    expect(short).toEqual(before);
    // A rest past the 4000-tick mark rolls new stock.
    doRest(univ, 5000, 10, 10);
    const after = [...(univ.party.magicStoreItems.get(which)?.values() ?? [])]
      .map((i) => i.fullName);
    expect(after.length).toBe(before.length);
  });

  it('an INN node charges, rests, and moves the party to its bed', () => {
    for (let t = 0; t < scen.townTalk.length; t++) {
      const index = scen.townTalk[t]!.talkNodes.findIndex(
        (n) => n.type === TalkNodeType.INN && n.personality >= 0);
      if (index < 0) continue;
      const node = scen.townTalk[t]!.talkNodes[index]!;
      const [price, , x, y] = node.extras;
      const { univ, session } = newGame();
      session.startTownMode(t, FORCED_ENTRY);
      session.startTalkMode(-1, node.personality, 0, -1);
      univ.party.gold = price! + 100;
      univ.party.pcs.forEach((pc) => { pc.curHealth = 1; });
      const ageBefore = univ.party.age;

      session.chooseTalkNode(index);
      expect(univ.party.gold).toBe(100);
      expect(univ.party.age).toBeGreaterThan(ageBefore);
      expect(univ.party.townLoc).toEqual({ x, y });
      expect(univ.party.pcs[0]!.curHealth).toBeGreaterThan(1);
      // The innkeeper shows you out.
      expect(session.talk!.endForced).toBe(true);

      // Too poor to stay: the node's second string is the refusal.
      const poor = newGame();
      poor.session.startTownMode(t, FORCED_ENTRY);
      poor.session.startTalkMode(-1, node.personality, 0, -1);
      poor.univ.party.gold = Math.max(0, price! - 1);
      poor.session.chooseTalkNode(index);
      expect(poor.session.talk!.str1).toBe(node.str2);
      expect(poor.univ.party.gold).toBe(Math.max(0, price! - 1));
      return;
    }
  });
});
