import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { TalkNodeType } from '../src/data/talking';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { TalkAction, TalkState } from '../src/game/talk';
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

/** A session standing next to the first talkable NPC in the start town. */
function talkingSession(): { session: GameSession; talk: TalkState } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  const town = univ.town!;
  const who = town.monsters.find((m) => m.isAlive && m.personality >= 0 && m.isFriendly);
  if (!who) throw new Error('no talkable NPC in the start town');
  univ.party.townLoc = { x: who.curLoc.x, y: who.curLoc.y + 1 };
  session.center = { ...univ.party.townLoc };
  expect(session.talkTo(who.curLoc)).toBe(true);
  return { session, talk: session.talk! };
}

describe('starting a conversation', () => {
  it('opens on the NPC\'s "look" text with the preset buttons', () => {
    const { session, talk } = talkingSession();
    expect(session.mode).toBe(GameMode.TALKING);
    expect(talk.title).toBe('Cmd. Terrance:');
    expect(talk.str1).toBe(talk.person!.look);
    expect(talk.str1.length).toBeGreaterThan(10);
    const presets = talk.words.filter((w) => w.preset).map((w) => w.word);
    expect(presets).toContain('Look');
    expect(presets).toContain('Done');
    // "Go Back" needs somewhere to go back to, so it isn't offered yet.
    expect(presets).not.toContain('Go Back');
  });

  it('finds the keywords inside the reply', () => {
    const { talk } = talkingSession();
    const keywords = talk.words.filter((w) => !w.preset);
    expect(keywords.length).toBeGreaterThan(0);
    for (const word of keywords) {
      expect(talk.scanForResponse(word.word)).toBe(word.node);
      expect(word.node).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses to talk to nobody, and to hostiles', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startNewGame();
    // An empty tile.
    const empty = { x: univ.party.townLoc.x, y: univ.party.townLoc.y };
    expect(session.talkTo(empty)).toBe(false);
    expect(univ.transcript.at(-1)).toContain('Nobody there');
  });
});

describe('keyword matching', () => {
  it('matches on the first four characters, case-insensitively', () => {
    const { talk } = talkingSession();
    const node = talk.scanForResponse('fort');
    expect(node).toBeGreaterThanOrEqual(0);
    expect(talk.scanForResponse('FORT')).toBe(node);
    // Four characters is all that counts, so a longer word still matches.
    expect(talk.scanForResponse('fortification')).toBe(node);
    // Blank keywords never match.
    expect(talk.scanForResponse('    ')).toBe(-1);
    expect(talk.scanForResponse('zzzz')).toBe(-1);
  });

  it('only offers nodes belonging to this personality (or to anyone)', () => {
    const { talk } = talkingSession();
    const nodes = talk.speech!.talkNodes;
    for (const word of talk.words) {
      if (word.preset) continue;
      const node = nodes[word.node]!;
      expect([talk.personality, -2]).toContain(node.personality);
    }
  });
});

describe('conversation flow', () => {
  it('answers the Look, Name and Job buttons from the personality', () => {
    const { session, talk } = talkingSession();
    session.chooseTalkNode(TalkAction.NAME);
    expect(talk.str1).toBe(talk.person!.name);
    session.chooseTalkNode(TalkAction.JOB);
    expect(talk.str1).toBe(talk.person!.job);
    session.chooseTalkNode(TalkAction.LOOK);
    expect(talk.str1).toBe(talk.person!.look);
  });

  it('follows a keyword to its node text and can go back', () => {
    const { session, talk } = talkingSession();
    const opening = talk.str1;
    const keyword = talk.words.find((w) => !w.preset)!;
    session.chooseTalkNode(keyword.node);
    expect(talk.str1).not.toBe(opening);
    expect(talk.words.some((w) => w.word === 'Go Back')).toBe(true);
    session.chooseTalkNode(TalkAction.BACK);
    expect(talk.str1).toBe(opening);
  });

  it('falls back to the "dunno" reply for an unknown topic', () => {
    const { session, talk } = talkingSession();
    talk.askAbout('zzzz');
    expect(talk.str1).toBe(talk.person!.dunno.length >= 2 ? talk.person!.dunno : 'You get no response.');
    expect(session.mode).toBe(GameMode.TALKING);
  });

  it('maps Ask About to the same replies as the buttons', () => {
    const { talk } = talkingSession();
    talk.askAbout('name');
    expect(talk.str1).toBe(talk.person!.name);
    talk.askAbout('work');
    expect(talk.str1).toBe(talk.person!.job);
    expect(talk.askAbout('bye')).toBe('done');
  });

  it('Done closes the conversation and returns to town mode', () => {
    const { session } = talkingSession();
    session.chooseTalkNode(TalkAction.DONE);
    expect(session.talk).toBeNull();
    expect(session.mode).toBe(GameMode.TOWN);
  });
});

describe('keyboard shortcuts', () => {
  it('maps talk_chars to the preset buttons', () => {
    const { talk } = talkingSession();
    const pairs: [string, TalkAction][] = [
      ['l', TalkAction.LOOK],
      ['n', TalkAction.NAME],
      ['j', TalkAction.JOB],
      ['b', TalkAction.BUY],
      ['s', TalkAction.SELL],
      ['r', TalkAction.RECORD],
      ['d', TalkAction.DONE],
      ['a', TalkAction.ASK],
    ];
    for (const [key, node] of pairs) {
      expect(talk.presetForKey(key)?.node).toBe(node);
      // Case doesn't matter.
      expect(talk.presetForKey(key.toUpperCase())?.node).toBe(node);
    }
    // Escape acts as Done, Space as Go Back.
    expect(talk.presetForKey('Escape')?.node).toBe(TalkAction.DONE);
    expect(talk.presetForKey('z')).toBeNull();
  });

  it('only answers keys whose button is on screen', () => {
    const { session, talk } = talkingSession();
    // "Go Back" isn't offered until there's history, so Space does nothing yet.
    expect(talk.presetForKey(' ')).toBeNull();
    session.chooseTalkNode(TalkAction.JOB);
    expect(talk.presetForKey(' ')?.node).toBe(TalkAction.BACK);
  });

  it('drops every shortcut but Done and Record once the talk is forced to end', () => {
    const { session, talk } = talkingSession();
    const node = talk.speech!.talkNodes.findIndex(
      (n) => n.type === TalkNodeType.END_FORCE && n.personality === talk.personality,
    );
    if (node < 0) return;
    session.chooseTalkNode(node);
    expect(talk.endForced).toBe(true);
    expect(talk.presetForKey('d')?.node).toBe(TalkAction.DONE);
    expect(talk.presetForKey('l')).toBeNull();
    expect(talk.presetForKey('j')).toBeNull();
  });
});

describe('node effects', () => {
  /** Find a node of a given type reachable from any personality in a town. */
  function findNode(type: TalkNodeType): { town: number; index: number } | null {
    for (let t = 0; t < scen.townTalk.length; t++) {
      const speech = scen.townTalk[t]!;
      const index = speech.talkNodes.findIndex((n) => n.type === type && n.personality >= 0);
      if (index >= 0) return { town: t, index };
    }
    return null;
  }

  it('SET_SDF writes the flag it names', () => {
    const found = findNode(TalkNodeType.SET_SDF);
    if (!found) return;
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(found.town, FORCED_ENTRY);
    const node = scen.townTalk[found.town]!.talkNodes[found.index]!;
    session.startTalkMode(-1, node.personality, 0, -1);
    const [a, b, c] = node.extras;
    session.chooseTalkNode(found.index);
    expect(univ.party.getSdf(a!, b!)).toBe(c);
    expect(session.talk!.str1).toBe(node.str1);
  });

  it('DEP_ON_SDF picks its reply from the flag', () => {
    const found = findNode(TalkNodeType.DEP_ON_SDF);
    if (!found) return;
    const node = scen.townTalk[found.town]!.talkNodes[found.index]!;
    const [a, b, c] = node.extras;

    const run = (flag: number): string => {
      const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
      const session = new GameSession(univ);
      session.startTownMode(found.town, FORCED_ENTRY);
      session.startTalkMode(-1, node.personality, 0, -1);
      univ.party.setSdf(a!, b!, flag);
      session.chooseTalkNode(found.index);
      return session.talk!.str1;
    };
    expect(run(0)).toBe(node.str1);
    expect(run(c! + 1)).toBe(node.str2);
  });

  it('BUY_INFO charges gold, and refuses when the party is short', () => {
    const found = findNode(TalkNodeType.BUY_INFO);
    if (!found) return;
    const node = scen.townTalk[found.town]!.talkNodes[found.index]!;
    const cost = node.extras[0]!;

    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(found.town, FORCED_ENTRY);
    session.startTalkMode(-1, node.personality, 0, -1);
    univ.party.gold = cost;
    session.chooseTalkNode(found.index);
    expect(univ.party.gold).toBe(0);
    expect(session.talk!.str1).toBe(node.str1);

    univ.party.gold = Math.max(0, cost - 1);
    session.chooseTalkNode(found.index);
    expect(session.talk!.str1).toBe(node.str2);
  });

  it('END_FORCE strips the conversation down to Done', () => {
    const found = findNode(TalkNodeType.END_FORCE);
    if (!found) return;
    const node = scen.townTalk[found.town]!.talkNodes[found.index]!;
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(found.town, FORCED_ENTRY);
    session.startTalkMode(-1, node.personality, 0, -1);
    session.chooseTalkNode(found.index);
    expect(session.talk!.endForced).toBe(true);
    const presets = session.talk!.words.map((w) => w.word);
    expect(presets).toContain('Done');
    expect(presets).not.toContain('Look');
    // No keyword is clickable once the conversation is over.
    expect(session.talk!.words.every((w) => w.preset)).toBe(true);
  });

  it('a SHOP node opens the shop', () => {
    const found = findNode(TalkNodeType.SHOP);
    if (!found) return;
    const node = scen.townTalk[found.town]!.talkNodes[found.index]!;
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(found.town, FORCED_ENTRY);
    session.startTalkMode(-1, node.personality, 0, -1);
    session.chooseTalkNode(found.index);
    expect(session.mode).toBe(GameMode.SHOPPING);
    // The node's text names the shop, and its extras pick shop and prices.
    expect(session.shop!.name).toBe(node.str1);
    expect(session.shop!.costAdj).toBe(node.extras[0]);
    // Closing the shop returns to the conversation, not to the town.
    session.endShopMode();
    expect(session.mode).toBe(GameMode.TALKING);
    expect(session.talk!.str1).toBe('You conclude your business.');
  });

  it('reports node types that need systems this port has not built', () => {
    const found = findNode(TalkNodeType.TRAINING);
    if (!found) return;
    const node = scen.townTalk[found.town]!.talkNodes[found.index]!;
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(found.town, FORCED_ENTRY);
    session.startTalkMode(-1, node.personality, 0, -1);
    session.chooseTalkNode(found.index);
    expect(session.talk!.lastUnsupported).toBe(TalkNodeType.TRAINING);
    expect(univ.transcript.at(-1)).toContain('not implemented yet');
  });
});
