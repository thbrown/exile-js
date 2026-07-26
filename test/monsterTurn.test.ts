import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { dist, loc } from '../src/core/location';
import { GameRng } from '../src/core/rng';
import { Attitude } from '../src/data/monster';
import { Scenario } from '../src/data/scenario';
import { NO_ONE } from '../src/game/combat';
import {
  closestPc, combatRunMonst, doMonsterTurn, doMonsters, monstAdjacent, monsterAttack,
} from '../src/game/monsterTurn';
import { FORCED_ENTRY, GameSession } from '../src/game/session';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { Creature, CreatureStatus, assignCreature } from '../src/universe/creature';
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

/**
 * A game already in combat with a single hostile monster, everything else
 * cleared out so the turn under test is the only thing happening.
 */
function combatWithOne(index = 1): {
  univ: Universe; session: GameSession; monst: Creature;
} {
  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startTownMode(0, FORCED_ENTRY);
  univ.town!.monsters.length = 0;

  const at = loc(univ.party.townLoc.x + 2, univ.party.townLoc.y);
  const template = { ...scen.scenMonsters[index]!, resist: [...scen.scenMonsters[index]!.resist] };
  template.attacks = [{ dice: 3, sides: 6, type: 0 }];
  template.skill = 20;
  template.speed = 12;
  template.armor = 0;
  const monst = assignCreature(0, {
    number: index, startAttitude: Attitude.HOSTILE_A, startLoc: at,
    mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
    specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
  } as never, template);
  monst.health = monst.maxHealth = 500;
  univ.town!.monsters.push(monst);

  session.startCombat(univ.party.direction);
  // Put the party somewhere predictable: everyone bare, plenty of health.
  univ.party.pcs.forEach((pc, i) => {
    pc.items.forEach((_, s) => { pc.equip[s] = false; });
    pc.maxHealth = 200;
    pc.curHealth = 200;
    pc.combatPos = loc(univ.party.townLoc.x, univ.party.townLoc.y + i);
  });
  return { univ, session, monst };
}

describe('a monster taking its turn', () => {
  it('notices the party, gets action points and closes the distance', () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.IDLE;
    const before = { ...monst.curLoc };
    // Give it enough chances that the notice roll lands.
    for (let i = 0; i < 10 && monst.active === CreatureStatus.IDLE; i++) {
      doMonsterTurn(session);
    }
    expect(monst.active).toBe(CreatureStatus.ALERTED);
    expect(monst.curLoc).not.toEqual(before);
    expect(univ.party.pcs.some((pc) => pc.isAlive)).toBe(true);
  });

  it('attacks a PC once it is adjacent, and the PC feels it', () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    expect(monstAdjacent(monst, pc.combatPos)).toBe(true);

    let hurt = false;
    for (let i = 0; i < 15 && !hurt; i++) {
      monst.active = CreatureStatus.ALERTED;
      monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
      doMonsterTurn(session);
      hurt = univ.party.pcs.some((p) => p.curHealth < 200);
    }
    expect(hurt).toBe(true);
    expect(univ.party.totalDamTaken).toBeGreaterThan(0);
  });

  it('monsterAttack rolls each of its attacks', () => {
    const { univ, session, monst } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    monst.mon.attacks = [
      { dice: 2, sides: 4, type: 0 },
      { dice: 2, sides: 4, type: 1 },
      { dice: 2, sides: 4, type: 0 },
    ];
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    let landed = 0;
    for (let i = 0; i < 10; i++) {
      pc.curHealth = 200;
      monsterAttack(session, monst, pc);
      if (pc.curHealth < 200) landed++;
    }
    expect(landed).toBeGreaterThan(0);
    expect(univ.transcript.some((l) => l.includes('attacks'))).toBe(true);
  });

  it('a peaceful monster will not touch the party', () => {
    const { univ, session, monst } = combatWithOne();
    monst.attitude = Attitude.DOCILE;
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    monsterAttack(session, monst, pc);
    expect(pc.curHealth).toBe(200);
  });

  it('sleep and paralysis cost a monster its whole turn', () => {
    const { session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.status[Status.ASLEEP] = 5;
    const before = { ...monst.curLoc };
    doMonsterTurn(session);
    expect(monst.ap).toBe(0);
    expect(monst.curLoc).toEqual(before);
  });

  it('flees once its morale has gone', () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.morale = 0;
    monst.health = 10; // under 50, so it does not steady itself
    const pc = univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    const distBefore = Math.abs(monst.curLoc.x - pc.combatPos.x);
    doMonsterTurn(session);
    // It either backed off or was hemmed in; what it must not do is attack.
    const distAfter = Math.abs(monst.curLoc.x - pc.combatPos.x);
    expect(distAfter).toBeGreaterThanOrEqual(distBefore);
    expect(univ.party.pcs.every((p) => p.curHealth === 200)).toBe(true);
  });

  it('the unliving never flee', () => {
    const { session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.morale = -100;
    monst.mon.race = 11; // UNDEAD
    const pc = session.univ.party.pcs[0]!;
    monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
    let hurt = false;
    for (let i = 0; i < 15 && !hurt; i++) {
      monst.active = CreatureStatus.ALERTED;
      monst.curLoc = loc(pc.combatPos.x + 1, pc.combatPos.y);
      doMonsterTurn(session);
      hurt = pc.curHealth < 200;
    }
    expect(hurt).toBe(true);
  });

  it('a summon runs out and vanishes', () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.summonTime = 1;
    doMonsterTurn(session);
    expect(monst.active).toBe(CreatureStatus.DEAD);
    expect(univ.transcript.some((l) => l.includes('disappears'))).toBe(true);
  });

  it('two monsters alert each other', () => {
    const { univ, session, monst } = combatWithOne();
    const second = Object.assign(Object.create(Object.getPrototypeOf(monst)) as Creature, monst);
    second.status = [...monst.status];
    second.curLoc = loc(monst.curLoc.x + 1, monst.curLoc.y);
    second.active = CreatureStatus.IDLE;
    univ.town!.monsters.push(second);
    monst.active = CreatureStatus.ALERTED;
    doMonsterTurn(session);
    expect(second.active).toBe(CreatureStatus.ALERTED);
  });

  it('does nothing once the whole party is down', () => {
    const { univ, session, monst } = combatWithOne();
    monst.active = CreatureStatus.ALERTED;
    univ.party.pcs.forEach((pc) => { pc.mainStatus = MainStatus.DEAD; });
    const before = { ...monst.curLoc };
    doMonsterTurn(session);
    expect(monst.curLoc).toEqual(before);
  });

  it('closestPc finds the nearest survivor', () => {
    const { univ } = combatWithOne();
    univ.party.pcs[0]!.mainStatus = MainStatus.DEAD;
    const near = closestPc(univ, univ.party.pcs[1]!.combatPos);
    expect(near).toBe(1);
    univ.party.pcs.forEach((pc) => { pc.mainStatus = MainStatus.DEAD; });
    expect(closestPc(univ, loc(0, 0))).toBe(NO_ONE);
  });
});

describe('encounters in town mode', () => {
  /** A town-mode game with one hostile monster a few squares off. */
  function townWithOne(): { univ: Universe; session: GameSession; monst: Creature } {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const session = new GameSession(univ);
    session.startTownMode(0, FORCED_ENTRY);
    univ.town!.monsters.length = 0;
    const template = { ...scen.scenMonsters[1]!, resist: [...scen.scenMonsters[1]!.resist] };
    template.attacks = [{ dice: 3, sides: 6, type: 0 }];
    template.skill = 20;
    template.speed = 12;
    template.armor = 0;
    const monst = assignCreature(0, {
      number: 1, startAttitude: Attitude.HOSTILE_A,
      startLoc: loc(univ.party.townLoc.x + 3, univ.party.townLoc.y),
      mobility: 1, timeFlag: 0, timeCode: 0, monsterTime: 0, spec1: -1, spec2: -1,
      specEncCode: 0, personality: -1, facialPic: -1, specialOnTalk: -1, specialOnKill: -1,
    } as never, template);
    monst.health = monst.maxHealth = 500;
    univ.town!.monsters.push(monst);
    univ.party.pcs.forEach((pc) => {
      pc.items.forEach((_, s2) => { pc.equip[s2] = false; });
      pc.maxHealth = 300;
      pc.curHealth = 300;
    });
    return { univ, session, monst };
  }

  it('a hostile monster notices the party and says so', () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.IDLE;
    for (let i = 0; i < 30 && monst.active === CreatureStatus.IDLE; i++) doMonsters(session);
    expect(monst.active).toBe(CreatureStatus.ALERTED);
    expect(univ.transcript).toContain('Monster saw you!');
  });

  it('and then walks over to the party', () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    const before = Math.abs(monst.curLoc.x - univ.party.townLoc.x);
    for (let i = 0; i < 5; i++) doMonsters(session);
    const after = Math.abs(monst.curLoc.x - univ.party.townLoc.x);
    expect(after).toBeLessThan(before);
  });

  it('attacks a PC in town mode, without any combat mode', () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    let hurt = false;
    for (let i = 0; i < 30 && !hurt; i++) {
      doMonsters(session);
      doMonsterTurn(session);
      hurt = univ.party.pcs.some((pc) => pc.curHealth < 300);
    }
    expect(hurt).toBe(true);
    expect(univ.party.pcs.some((pc) => pc.combatPos.x >= 0)).toBe(false);
  });

  it('walking about is what gives the monsters their turn', async () => {
    const { univ, session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    const home = { ...univ.party.townLoc };
    // Find a neighbour the party can actually step onto and still be in town:
    // a *blocked* move costs no turn, and Fort Talrus's entrance is close
    // enough to the boundary that a step the wrong way leaves the town.
    const free = [
      loc(home.x, home.y - 1), loc(home.x, home.y + 1),
      loc(home.x - 1, home.y), loc(home.x + 1, home.y),
    ].find((c) => !session.townIsBlocked(c) && !univ.town!.monsterAt(c)
      && !session.locOffActiveArea(c));
    expect(free).toBeDefined();

    const startedAt = { ...monst.curLoc };
    let moves = 0;
    for (let i = 0; i < 6; i++) {
      if (await session.moveTo(free!)) moves++;
      if (await session.moveTo(home)) moves++;
    }
    expect(moves).toBeGreaterThan(0);
    // The monster had a turn of its own, which it spent coming after us.
    expect(monst.curLoc).not.toEqual(startedAt);
    expect(dist(monst.curLoc, univ.party.townLoc))
      .toBeLessThanOrEqual(dist(startedAt, home));
  });

  it('a sleeping monster stays put', () => {
    const { session, monst } = townWithOne();
    monst.active = CreatureStatus.ALERTED;
    monst.status[Status.ASLEEP] = 6;
    const before = { ...monst.curLoc };
    for (let i = 0; i < 5; i++) doMonsters(session);
    expect(monst.curLoc).toEqual(before);
  });
});

describe('the round between rounds', () => {
  it('advances the clock and decays the brief statuses', () => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.INVULNERABLE] = 3;
    pc.status[Status.MARTYRS_SHIELD] = 2;
    const ageBefore = univ.party.age;
    combatRunMonst(session);
    expect(univ.party.age).toBe(ageBefore + 1);
    expect(pc.status[Status.INVULNERABLE]).toBe(2);
    expect(pc.status[Status.MARTYRS_SHIELD]).toBe(1);
  });

  it('blessings tick only every fourth turn', () => {
    const { univ, session } = combatWithOne();
    const pc = univ.party.pcs[0]!;
    pc.status[Status.BLESS_CURSE] = 8;
    univ.party.age = 0;
    combatRunMonst(session); // age becomes 1
    expect(pc.status[Status.BLESS_CURSE]).toBe(8);
    univ.party.age = 3;
    combatRunMonst(session); // age becomes 4
    expect(pc.status[Status.BLESS_CURSE]).toBe(7);
  });

  it('a party that runs out of moves gets a fresh round automatically', () => {
    const { univ, session } = combatWithOne();
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    univ.curPc = 0;
    session.startCombatRound();
    expect(univ.party.pcs.some((pc) => pc.ap > 0)).toBe(true);
  });
});
