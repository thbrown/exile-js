import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Direction, loc } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { ItemAbil, ItemType } from '../src/data/item';
import { Attitude } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import {
  NO_ONE, getWeapons, pcAttack, pickNextPc, placeParty, setPcMoves, takeAp, totalEncumbrance,
} from '../src/game/combat';
import { GameMode } from '../src/game/modes';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature, CreatureStatus, assignCreature } from '../src/universe/creature';
import { PartyPreset, Player } from '../src/universe/player';
import { MainStatus, Race, Skill, Status, Trait } from '../src/universe/skills';
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

/**
 * Put a hostile monster on a free square next to the party and return it.
 * Fort Talrus has its own guards standing about, so the square has to be
 * checked rather than assumed.
 */
function hostileBeside(univ: Universe, session: GameSession, index = 1): Creature {
  const from = univ.party.townLoc;
  const candidates = [
    loc(from.x + 1, from.y), loc(from.x - 1, from.y),
    loc(from.x, from.y + 1), loc(from.x, from.y - 1),
  ];
  const where = candidates.find((c) =>
    !univ.town!.monsterAt(c) && !session.townIsBlocked(c)) ?? candidates[0]!;
  const monst = assignCreature(0, {
    number: index, startAttitude: Attitude.HOSTILE_A, startLoc: where,
    mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
    specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
  } as never, scen.scenMonsters[index]!);
  monst.mon.armor = 0;
  monst.health = monst.maxHealth = 500;
  univ.town!.monsters.push(monst);
  return monst;
}

describe('action points', () => {
  it('gives four a round, three to the sluggish', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    setPcMoves(univ);
    expect(pc.ap).toBe(4);
    pc.traits[Trait.SLUGGISH] = true;
    setPcMoves(univ);
    expect(pc.ap).toBe(3);
  });

  it('haste doubles them, and a strong haste triples', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    pc.status[Status.HASTE_SLOW] = 4;
    setPcMoves(univ);
    expect(pc.ap).toBe(8);
    pc.status[Status.HASTE_SLOW] = 8;
    setPcMoves(univ);
    expect(pc.ap).toBe(12);
  });

  it('being slowed costs every other round outright', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.HASTE_SLOW] = -4;
    univ.party.age = 1;
    setPcMoves(univ);
    expect(pc.ap).toBe(0);
    univ.party.age = 2;
    setPcMoves(univ);
    expect(pc.ap).toBeGreaterThan(0);
  });

  it('webs eat the round and get torn at', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    pc.status[Status.WEBS] = 8;
    setPcMoves(univ);
    expect(pc.ap).toBe(0);
    expect(pc.status[Status.WEBS]).toBe(5);
    expect(univ.transcript.some((l) => l.includes('must clean webs'))).toBe(true);
  });

  it('sleep and paralysis leave nothing, and the dead get nothing', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.PARALYZED] = 20;
    univ.party.pcs[1]!.mainStatus = MainStatus.DEAD;
    setPcMoves(univ);
    expect(pc.ap).toBe(0);
    expect(univ.party.pcs[1]!.ap).toBe(0);
  });

  it('a speed item adds and a heavy item takes away', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.SLUGGISH] = false;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.NON_USE_OBJECT,
      ability: ItemAbil.SPEED, abilStrength: 2,
    };
    pc.equip[0] = true;
    setPcMoves(univ);
    expect(pc.ap).toBe(6);
    pc.items[0]!.ability = ItemAbil.SLOW_WEARER;
    setPcMoves(univ);
    expect(pc.ap).toBe(2);
  });

  it('takeAp never goes below zero', () => {
    const { univ } = newGame();
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 3;
    takeAp(univ, 4);
    expect(univ.party.pcs[0]!.ap).toBe(0);
  });

  it('awkward gear costs action points', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.skills[Skill.DEFENSE] = 0;
    pc.items[0] = { ...pc.items[0]!, variety: ItemType.SHIELD, awkward: 9 };
    pc.equip[0] = true;
    expect(totalEncumbrance(univ, pc)).toBeGreaterThanOrEqual(8);
    pc.traits[Trait.SLUGGISH] = false;
    setPcMoves(univ);
    expect(pc.ap).toBeLessThan(4);
  });
});

describe('turn order', () => {
  it('walks to the next PC with moves and reports the end of the round', () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    univ.party.pcs[3]!.ap = 4;
    univ.curPc = 0;
    expect(pickNextPc(univ)).toBe(false);
    expect(univ.curPc).toBe(3);

    univ.party.pcs[3]!.ap = 0;
    expect(pickNextPc(univ)).toBe(true);
    expect(univ.curPc).toBe(0);
  });

  it('wraps back around to an earlier PC', () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    univ.party.pcs[1]!.ap = 4;
    univ.curPc = 4;
    expect(pickNextPc(univ)).toBe(false);
    expect(univ.curPc).toBe(1);
  });

  it('burns everyone else’s moves while one PC is mid-action', () => {
    const { univ } = newGame();
    univ.party.pcs.forEach((pc) => { pc.ap = 4; });
    univ.curPc = 0;
    pickNextPc(univ, 2);
    expect(univ.curPc).toBe(2);
    expect(univ.party.pcs[0]!.ap).toBe(0);
    expect(univ.party.pcs[1]!.ap).toBe(0);
    expect(univ.party.pcs[2]!.ap).toBe(4);
  });
});

describe('starting and ending combat', () => {
  it('walking into something hostile starts a fight', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    expect(session.mode).toBe(GameMode.TOWN);
    await session.moveTo(monst.curLoc);
    expect(session.mode).toBe(GameMode.COMBAT);
    expect(session.whichCombatType).toBe(1);
    // Everyone has been placed and has moves.
    expect(univ.party.pcs[0]!.combatPos.x).toBeGreaterThanOrEqual(0);
    expect(univ.currentPc.ap).toBeGreaterThan(0);
    // And nothing is targeting anyone yet.
    expect(monst.target).toBe(NO_ONE);
  });

  it('walking into a friendly still just blocks', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    monst.attitude = Attitude.FRIENDLY;
    await session.moveTo(monst.curLoc);
    expect(session.mode).toBe(GameMode.TOWN);
    expect(univ.transcript.at(-1)).toContain('creature is in the way');
  });

  it('placeParty spreads the party out on open ground', () => {
    const { univ, session } = newGame();
    placeParty(session, Direction.N);
    const spots = univ.party.pcs.filter((pc) => pc.isAlive).map((pc) => `${pc.combatPos.x},${pc.combatPos.y}`);
    // The first PC stands where the party stood.
    expect(univ.party.pcs[0]!.combatPos).toEqual(univ.party.townLoc);
    // At least some of the others got their own square.
    expect(new Set(spots).size).toBeGreaterThan(1);
  });

  it('a caged party all lands on the one square', () => {
    const { univ, session } = newGame();
    univ.party.pcs[0]!.status[Status.FORCECAGE] = 20;
    placeParty(session, Direction.N);
    for (const pc of univ.party.pcs) expect(pc.combatPos).toEqual(univ.party.townLoc);
  });

  it('ending combat regroups on a survivor and restores town mode', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    await session.moveTo(monst.curLoc);
    expect(session.mode).toBe(GameMode.COMBAT);

    expect(session.endCombat()).toBe(true);
    expect(session.mode).toBe(GameMode.TOWN);
    // The party stands where one of them was.
    const positions = univ.party.pcs.map((pc) => pc.combatPos);
    for (const p of positions) expect(p).toEqual(loc(-1, -1));
    expect(univ.party.townLoc.x).toBeGreaterThanOrEqual(0);
  });

  it('refuses to end combat with only some of the party caged', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    await session.moveTo(monst.curLoc);
    univ.party.pcs[0]!.status[Status.FORCECAGE] = 20;
    univ.party.pcs[0]!.combatPos = loc(1, 1);
    univ.party.pcs[1]!.combatPos = loc(9, 9);
    expect(session.endCombat()).toBe(false);
    expect(session.mode).toBe(GameMode.COMBAT);
    expect(univ.transcript.at(-1)).toContain('Someone trapped.');
  });
});

describe('the melee attack', () => {
  function armedFighter(univ: Universe): Player {
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    pc.traits[Trait.PACIFIST] = false;
    pc.skills[Skill.EDGED_WEAPONS] = 20;
    pc.skills[Skill.DEXTERITY] = 20;
    pc.skills[Skill.ASSASSINATION] = 0;
    pc.items[0] = {
      ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'sword',
      itemLevel: 8, weapType: Skill.EDGED_WEAPONS, ability: ItemAbil.NONE,
    };
    pc.equip[0] = true;
    pc.ap = 4;
    return pc;
  }

  it('a swing that lands takes health off the monster', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    const before = monst.health;
    // Twenty swings: with skill 20 against armour 0 some must connect.
    for (let i = 0; i < 20; i++) {
      pc.ap = 4;
      pcAttack(univ, 0, monst, session);
    }
    expect(monst.health).toBeLessThan(before);
    expect(univ.transcript.some((l) => l.includes('swings.'))).toBe(true);
  });

  it('costs four action points whether it connects or not', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    pc.ap = 4;
    pcAttack(univ, 0, monst, session);
    expect(pc.ap).toBe(0);
  });

  it('an unarmed PC punches', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    pcAttack(univ, 0, monst, session);
    expect(univ.transcript.some((l) => l.includes('punches.'))).toBe(true);
  });

  it('a pacifist refuses', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.traits[Trait.PACIFIST] = true;
    const monst = hostileBeside(univ, session);
    const before = monst.health;
    pcAttack(univ, 0, monst, session);
    expect(monst.health).toBe(before);
    expect(univ.transcript.at(-1)).toBe("Attack: You're a pacifist!");
  });

  it('a sleeping or paralysed PC cannot attack at all', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.status[Status.ASLEEP] = 4;
    const monst = hostileBeside(univ, session);
    const before = univ.transcript.length;
    pcAttack(univ, 0, monst, session);
    expect(univ.transcript.length).toBe(before);
  });

  it('attacking gives away invisibility', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.status[Status.INVISIBLE] = 4;
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    pcAttack(univ, 0, monst, session);
    expect(pc.status[Status.INVISIBLE]).toBe(0);
    expect(univ.transcript).toContain('You become visible!');
  });

  it('remembers who it hit, for the repeat', () => {
    const { univ, session } = newGame();
    armedFighter(univ);
    const monst = hostileBeside(univ, session);
    univ.curPc = 0;
    pcAttack(univ, 0, monst, session);
    expect(univ.party.pcs[0]!.lastAttacked).toBe(monst);
  });

  it('a martyr sends some of the damage back', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.maxHealth = 100;
    pc.curHealth = 100;
    const monst = hostileBeside(univ, session);
    monst.status[Status.MARTYRS_SHIELD] = 8;
    univ.curPc = 0;
    for (let i = 0; i < 20 && pc.curHealth === 100; i++) {
      pc.ap = 4;
      pcAttack(univ, 0, monst, session);
    }
    expect(pc.curHealth).toBeLessThan(100);
    expect(univ.transcript).toContain('  Shares damage!');
  });

  it('killing the monster in melee ends it', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    const monst = hostileBeside(univ, session);
    monst.health = 1;
    univ.curPc = 0;
    for (let i = 0; i < 30 && monst.isAlive; i++) {
      pc.ap = 4;
      pcAttack(univ, 0, monst, session);
    }
    expect(monst.active).toBe(CreatureStatus.DEAD);
    expect(univ.party.totalMKilled).toBe(1);
  });

  it('a poisoned blade poisons what it hits, once', () => {
    const { univ, session } = newGame();
    const pc = armedFighter(univ);
    pc.status[Status.POISONED_WEAPON] = 4;
    pc.weapPoisoned = pc.items[0]!;
    const monst = hostileBeside(univ, session);
    monst.mon.resist[2] = 100; // no poison resistance
    univ.curPc = 0;
    for (let i = 0; i < 20 && (monst.status[Status.POISON] ?? 0) === 0; i++) {
      pc.ap = 4;
      pc.status[Status.POISONED_WEAPON] = 4;
      pcAttack(univ, 0, monst, session);
    }
    expect(monst.status[Status.POISON]).toBeGreaterThan(0);
  });

  it('session.attackAt hits whatever is on the square', async () => {
    const { univ, session } = newGame();
    armedFighter(univ);
    const monst = hostileBeside(univ, session);
    await session.moveTo(monst.curLoc); // starts combat
    univ.curPc = 0;
    univ.party.pcs[0]!.ap = 4;
    expect(session.attackAt(monst.curLoc)).toBe(true);
    expect(session.attackAt(loc(1, 1))).toBe(false);
  });
});

describe('placement, parry and holding a turn', () => {
  it('never places a PC in a wall or on top of a monster', async () => {
    const { univ, session } = newGame();
    // Ring the party with monsters so a naive placement would overlap one.
    const from = univ.party.townLoc;
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const at = loc(from.x + d[0]!, from.y + d[1]!);
      if (session.townIsBlocked(at) || univ.town!.monsterAt(at)) continue;
      const m = hostileBeside(univ, session);
      m.curLoc = at;
    }
    const leader = univ.party.pcs[univ.firstActivePc()]!;
    placeParty(session, Direction.N);
    for (const pc of univ.party.pcs) {
      if (!pc.isAlive || pc === leader) continue; // index 0 is forced through
      expect(univ.town!.monsterAt(pc.combatPos)).toBeNull();
      expect(session.townIsBlocked(pc.combatPos)).toBe(false);
    }
  });

  it('isBlocked counts creatures, the party and barriers, not just terrain', () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    expect(session.isBlocked(monst.curLoc)).toBe(true);
    expect(session.townIsBlocked(monst.curLoc)).toBe(false); // terrain is clear
    // The party's own square blocks in town mode.
    expect(session.isBlocked(univ.party.townLoc)).toBe(true);
    // And a force barrier blocks even open floor.
    const open = loc(univ.party.townLoc.x, univ.party.townLoc.y + 1);
    if (!session.townIsBlocked(open) && !univ.town!.monsterAt(open)) {
      expect(session.isBlocked(open)).toBe(false);
      univ.town!.setField(open.x, open.y, FieldType.BARRIER_FORCE);
      expect(session.isBlocked(open)).toBe(true);
    }
  });

  it('parry spends the turn and scales with the moves given up', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    await session.moveTo(monst.curLoc);
    const pc = univ.currentPc;
    pc.skills[Skill.DEFENSE] = 8;
    pc.ap = 8;
    expect(session.parry()).toBe(true);
    expect(pc.parry).toBeGreaterThan(0);
    expect(pc.ap).toBe(0);
    expect(univ.transcript).toContain('Parry.');
  });

  it('standing ready is parry pinned at 100, and clears webs', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    await session.moveTo(monst.curLoc);
    const pc = univ.currentPc;
    pc.status[Status.WEBS] = 5;
    pc.ap = 4;
    session.pause();
    expect(pc.parry).toBe(100);
    expect(pc.status[Status.WEBS]).toBe(3);
    expect(univ.transcript).toContain('Stand ready.');
  });

  it('pausing outside combat is a plain pause', () => {
    const { univ, session } = newGame();
    univ.party.pcs[0]!.status[Status.WEBS] = 4;
    session.pause();
    expect(univ.transcript).toContain('Pause.');
    expect(univ.party.pcs[0]!.status[Status.WEBS]).toBe(2);
  });

  it('X holds the turn on one PC and gives it back', async () => {
    const { univ, session } = newGame();
    const monst = hostileBeside(univ, session);
    await session.moveTo(monst.curLoc);
    univ.curPc = 2;
    session.toggleActivePc();
    expect(session.combatActivePc).toBe(2);
    expect(univ.transcript).toContain('This PC now active.');
    session.toggleActivePc();
    expect(session.combatActivePc).toBe(NO_ONE);
    expect(univ.curPc).toBe(2);
  });
});

describe('weapon selection', () => {
  it('finds one two-handed weapon, or a pair of one-handed', () => {
    const { univ } = newGame();
    const pc = univ.party.pcs[0]!;
    pc.items.forEach((_, i) => { pc.equip[i] = false; });
    expect(getWeapons(pc)).toEqual([null, null]);

    pc.items[0] = { ...pc.items[0]!, variety: ItemType.TWO_HANDED, name: 'greatsword' };
    pc.equip[0] = true;
    expect(getWeapons(pc)[0]!.name).toBe('greatsword');
    expect(getWeapons(pc)[1]).toBeNull();

    pc.items[0] = { ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'left' };
    pc.items[1] = { ...pc.items[1]!, variety: ItemType.ONE_HANDED, name: 'right' };
    pc.equip[1] = true;
    const [a, b] = getWeapons(pc);
    expect(a!.name).toBe('left');
    expect(b!.name).toBe('right');
  });

  it('a slith with a pole arm is more accurate, in the roll', () => {
    // The bonus is a -10 on the to-hit roll, so over many swings a slith with a
    // spear should connect more often than a human with the same skill.
    const { univ, session } = newGame();
    const spear = (pc: Player): void => {
      pc.items.forEach((_, i) => { pc.equip[i] = false; });
      pc.skills[Skill.POLE_WEAPONS] = 4;
      pc.skills[Skill.DEXTERITY] = 4;
      pc.skills[Skill.ASSASSINATION] = 0;
      pc.items[0] = {
        ...pc.items[0]!, variety: ItemType.ONE_HANDED, name: 'spear',
        itemLevel: 6, weapType: Skill.POLE_WEAPONS, ability: ItemAbil.NONE,
      };
      pc.equip[0] = true;
    };
    const hits = (race: Race): number => {
      const pc = univ.party.pcs[0]!;
      pc.race = race;
      spear(pc);
      const monst = hostileBeside(univ, session);
      monst.health = 100000;
      const before = monst.health;
      for (let i = 0; i < 200; i++) {
        pc.ap = 4;
        pcAttack(univ, 0, monst, session);
      }
      univ.town!.monsters.pop();
      return before - monst.health;
    };
    const human = hits(Race.HUMAN);
    const slith = hits(Race.SLITH);
    expect(slith).toBeGreaterThan(human);
  });
});
