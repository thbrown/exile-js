/**
 * set_town_attitude / make_town_hostile, and the two ways a peaceful town
 * turns on the party: swinging at someone, and being caught stealing.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loc } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { Attitude } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { makeTownHostile, setTownAttitude } from '../src/game/townAttitude';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature, CreatureStatus, assignCreature } from '../src/universe/creature';
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

function newGame(town = 0): { univ: Universe; session: GameSession } {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startTownMode(town, FORCED_ENTRY);
  return { univ, session };
}

/** A docile townsperson on a free square next to the party. */
function friendlyBeside(univ: Universe, session: GameSession, index = 1): Creature {
  const from = univ.party.townLoc;
  const candidates = [
    loc(from.x + 1, from.y), loc(from.x - 1, from.y),
    loc(from.x, from.y + 1), loc(from.x, from.y - 1),
  ];
  const where = candidates.find((c) =>
    !univ.town!.monsterAt(c) && !session.townIsBlocked(c)) ?? candidates[0]!;
  const monst = assignCreature(0, {
    number: index, startAttitude: Attitude.DOCILE, startLoc: where,
    mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
    specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
  } as never, scen.scenMonsters[index]!);
  monst.mon.armor = 0;
  monst.health = monst.maxHealth = 500;
  univ.town!.monsters.push(monst);
  return monst;
}

describe('setTownAttitude', () => {
  it('make_town_hostile turns the whole population and sets the town flag', () => {
    const { univ, session } = newGame();
    friendlyBeside(univ, session);
    expect(univ.town!.monsters.some((m) => m.isFriendly)).toBe(true);

    makeTownHostile(session);

    expect(univ.town!.monstHostile).toBe(true);
    for (const m of univ.town!.monsters) {
      expect(m.attitude).toBe(Attitude.HOSTILE_A);
      expect(m.mobile).toBe(true);
    }
  });

  it('a negative hi counts back from the end, and a summon is left alone', () => {
    const { univ, session } = newGame();
    const summoned = friendlyBeside(univ, session);
    summoned.summonTime = 5;
    const count = univ.town!.monsters.length;

    setTownAttitude(session, 0, -1, Attitude.HOSTILE_A);
    expect(count).toBeGreaterThan(1);
    // Everything but the summon changed side.
    expect(summoned.attitude).toBe(Attitude.DOCILE);
    expect(univ.town!.monsters[0]!.attitude).toBe(Attitude.HOSTILE_A);
  });

  it('only touches the named slot range', () => {
    const { univ, session } = newGame();
    const monsters = univ.town!.monsters;
    expect(monsters.length).toBeGreaterThan(2);
    for (const m of monsters) m.attitude = Attitude.DOCILE;

    setTownAttitude(session, 1, 1, Attitude.HOSTILE_A);
    expect(monsters[0]!.attitude).toBe(Attitude.DOCILE);
    expect(monsters[1]!.attitude).toBe(Attitude.HOSTILE_A);
    expect(monsters[2]!.attitude).toBe(Attitude.DOCILE);
    // Turning someone hostile is what sets the flag; a friendly attitude clears it.
    expect(univ.town!.monstHostile).toBe(true);
    setTownAttitude(session, 1, 1, Attitude.FRIENDLY);
    expect(univ.town!.monstHostile).toBe(false);
  });

  it('a guard turned hostile gets tripled health, haste and a blessing', () => {
    const { univ, session } = newGame();
    const monst = friendlyBeside(univ, session);
    monst.mon.guard = true;
    scen.scenMonsters[monst.number]!.guard = true;
    monst.health = 40;
    try {
      setTownAttitude(session, 0, -1, Attitude.HOSTILE_A);
      expect(monst.health).toBe(120);
      expect(monst.active).toBe(CreatureStatus.ALERTED);
      expect(monst.status[Status.HASTE_SLOW]).toBe(8);
      expect(monst.status[Status.BLESS_CURSE]).toBe(8);
    } finally {
      scen.scenMonsters[monst.number]!.guard = false;
    }
  });

  it('an arena fight has no town population to turn', () => {
    const { univ, session } = newGame();
    friendlyBeside(univ, session);
    session.mode = GameMode.COMBAT;
    session.whichCombatType = 0;
    makeTownHostile(session);
    expect(univ.town!.monstHostile).toBe(false);
  });
});

describe('attacking a peaceful creature', () => {
  it('asks first, and Cancel means no swing and no hostility', async () => {
    const { univ, session } = newGame();
    const monst = friendlyBeside(univ, session);
    session.startCombat(univ.party.direction);
    session.onConfirmAttackFriendly = () => Promise.resolve(false);

    const pc = univ.currentPc;
    pc.combatPos = loc(monst.curLoc.x, monst.curLoc.y + 1);
    pc.ap = 4;

    expect(await session.combatMove(monst.curLoc)).toBe(false);
    expect(pc.ap).toBe(4);
    expect(monst.attitude).toBe(Attitude.DOCILE);
    expect(univ.town!.monstHostile).toBe(false);
  });

  it('going through with it swings and turns the town hostile', async () => {
    const { univ, session } = newGame();
    const monst = friendlyBeside(univ, session);
    session.startCombat(univ.party.direction);
    session.onConfirmAttackFriendly = () => Promise.resolve(true);

    const pc = univ.currentPc;
    pc.combatPos = loc(monst.curLoc.x, monst.curLoc.y + 1);
    pc.ap = 4;

    expect(await session.combatMove(monst.curLoc)).toBe(true);
    expect(univ.town!.monstHostile).toBe(true);
    expect(monst.attitude).toBe(Attitude.HOSTILE_A);
    expect(pc.lastAttacked).toBe(monst);
    expect(pc.ap).toBeLessThan(4);
  });

  it('without a host handler the swing is simply refused', async () => {
    const { univ, session } = newGame();
    const monst = friendlyBeside(univ, session);
    session.startCombat(univ.party.direction);

    const pc = univ.currentPc;
    pc.combatPos = loc(monst.curLoc.x, monst.curLoc.y + 1);
    pc.ap = 4;

    expect(await session.combatMove(monst.curLoc)).toBe(false);
    expect(univ.town!.monstHostile).toBe(false);
  });
});

describe('theft', () => {
  it('taking someone else\'s property in plain sight is a crime', () => {
    const { univ, session } = newGame();
    const monst = friendlyBeside(univ, session);
    const item = univ.town!.items.find((i) => i.variety !== 0);
    expect(item).toBeDefined();
    item!.property = true;
    item!.itemLoc = { ...monst.curLoc };

    session.takeItem(item!, 0);

    expect(univ.transcript).toContain('Your crime was seen!');
    expect(univ.town!.monstHostile).toBe(true);
  });

  it('taking your own property is not', () => {
    const { univ, session } = newGame();
    friendlyBeside(univ, session);
    const item = univ.town!.items.find((i) => i.variety !== 0);
    expect(item).toBeDefined();
    item!.property = false;

    session.takeItem(item!, 0);

    expect(univ.transcript).not.toContain('Your crime was seen!');
    expect(univ.town!.monstHostile).toBe(false);
  });
});
