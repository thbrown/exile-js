/**
 * The party's missiles: load_missile's arming rules, fire_missile's shot, and
 * calc_spec_dam's slayer table.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Item, ItemAbil, ItemType, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { GameMode } from '../src/game/modes';
import { calcSpecDam, fireMissile, isLoaded, loadMissile } from '../src/game/missiles';
import { GameSession } from '../src/game/session';
import { Creature } from '../src/universe/creature';
import { PartyPreset, Player } from '../src/universe/player';
import { Race, Skill, Status } from '../src/universe/skills';
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
  return s;
}

/** Strip the PC's pack and equip exactly the items given, in order. */
function armWith(pc: Player, ...items: Item[]): void {
  pc.items.fill(defaultItem());
  pc.equip.fill(false);
  items.forEach((item, i) => {
    pc.items[i] = item;
    pc.equip[i] = true;
  });
}

function anItem(variety: ItemType, extra: Partial<Item> = {}): Item {
  return { ...defaultItem(), variety, name: ItemType[variety]!, charges: 10, ...extra };
}

describe('load_missile', () => {
  it('refuses when nothing is equipped to shoot with', () => {
    const s = inTown();
    armWith(s.univ.currentPc);
    const r = loadMissile(s.univ);
    expect(isLoaded(r)).toBe(false);
    expect(r).toMatchObject({ message: 'Fire: Equip a missile.' });
  });

  it('a bow with bolts is the wrong ammunition', () => {
    const s = inTown();
    armWith(s.univ.currentPc, anItem(ItemType.BOW), anItem(ItemType.BOLTS));
    expect(loadMissile(s.univ)).toMatchObject({ message: 'Fire: Wrong ammunition.' });
  });

  it('a bow without arrows says which ammunition it wants', () => {
    const s = inTown();
    armWith(s.univ.currentPc, anItem(ItemType.BOW));
    expect(loadMissile(s.univ)).toMatchObject({ message: 'Fire: Equip some arrows.' });
  });

  it('a bow and arrows fire at 12, and DISTANCE_MISSILE ammunition reaches further', () => {
    const s = inTown();
    const pc = s.univ.currentPc;
    armWith(pc, anItem(ItemType.BOW), anItem(ItemType.ARROW));
    const r = loadMissile(s.univ);
    expect(r).toMatchObject({ range: 12, mode: GameMode.FIRING, missileSlot: 0, ammoSlot: 1 });

    armWith(pc, anItem(ItemType.BOW), anItem(ItemType.ARROW, {
      ability: ItemAbil.DISTANCE_MISSILE, abilStrength: 4,
    }));
    expect(loadMissile(s.univ)).toMatchObject({ range: 16 });
  });

  it('a thrown weapon wins outright and throws at 8', () => {
    const s = inTown();
    armWith(s.univ.currentPc,
      anItem(ItemType.BOW), anItem(ItemType.ARROW), anItem(ItemType.THROWN_MISSILE));
    const r = loadMissile(s.univ);
    expect(r).toMatchObject({ mode: GameMode.THROWING, range: 8, missileSlot: 2, ammoSlot: 2 });
  });

  it('a launcher that needs no ammunition is its own ammunition', () => {
    const s = inTown();
    armWith(s.univ.currentPc, anItem(ItemType.MISSILE_NO_AMMO));
    expect(loadMissile(s.univ)).toMatchObject({ missileSlot: 0, ammoSlot: 0, range: 12 });
  });
});

describe('fire_missile', () => {
  /** A fight with one hostile creature standing two squares from PC 0. */
  function aFight(): { s: GameSession; monst: Creature; pc: Player } {
    const s = inTown();
    s.startCombat(s.univ.party.direction);
    const pc = s.univ.party.pcs[0]!;
    s.univ.curPc = 0;
    const monst = s.univ.town!.monsters.find((c) => c.isAlive)!;
    monst.curLoc = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
    armWith(pc, anItem(ItemType.BOW, { bonus: 20 }), anItem(ItemType.ARROW, {
      itemLevel: 8, bonus: 30, charges: 10,
    }));
    pc.skills[Skill.ARCHERY] = 20;
    pc.ap = 10;
    return { s, monst, pc };
  }

  it('hits something two squares away and spends an arrow', () => {
    const { s, monst, pc } = aFight();
    const before = monst.health;
    const loaded = loadMissile(s.univ);
    if (!isLoaded(loaded)) throw new Error('should be armed');
    fireMissile(s, loaded, monst.curLoc);
    expect(s.univ.transcript.join('\n')).toContain(`${pc.name} fires.`);
    expect(monst.health).toBeLessThan(before);
    expect(pc.items[1]!.charges).toBe(9);
  });

  it('refuses a target beyond the range and keeps the arrow', () => {
    const { s, monst, pc } = aFight();
    const far = { x: pc.combatPos.x + 30, y: pc.combatPos.y };
    const loaded = loadMissile(s.univ);
    if (!isLoaded(loaded)) throw new Error('should be armed');
    fireMissile(s, loaded, far);
    expect(s.univ.transcript.at(-1)).toBe('  Out of range.');
    expect(pc.items[1]!.charges).toBe(10);
    expect(monst.health).toBeGreaterThan(0);
  });

  it('the last arrow leaves the pack when it is spent', () => {
    const { s, monst, pc } = aFight();
    pc.items[1]!.charges = 1;
    const loaded = loadMissile(s.univ);
    if (!isLoaded(loaded)) throw new Error('should be armed');
    fireMissile(s, loaded, monst.curLoc);
    expect(pc.items[1]!.variety).toBe(ItemType.NO_ITEM);
  });

  it('a returning missile never runs out', () => {
    const { s, monst, pc } = aFight();
    pc.items[1]!.ability = ItemAbil.RETURNING_MISSILE;
    pc.items[1]!.charges = 1;
    const loaded = loadMissile(s.univ);
    if (!isLoaded(loaded)) throw new Error('should be armed');
    fireMissile(s, loaded, monst.curLoc);
    expect(pc.items[1]!.charges).toBe(1);
  });
});

describe('calc_spec_dam', () => {
  it('a slayer weapon only bites the race it names', () => {
    const s = inTown();
    const monst = s.univ.town!.monsters.find((c) => c.isAlive)!;
    monst.mon.race = Race.DRAGON;
    const hit = calcSpecDam(s.univ, ItemAbil.SLAYER_WEAPON, 3, Race.DRAGON, monst);
    expect(hit.damage).toBe(24); // three points, times eight for a dragon
    const miss = calcSpecDam(s.univ, ItemAbil.SLAYER_WEAPON, 3, Race.UNDEAD, monst);
    expect(miss.damage).toBe(0);
  });

  it('a humanoid-bane weapon also bites nephilim, but not humans', () => {
    const s = inTown();
    const monst = s.univ.town!.monsters.find((c) => c.isAlive)!;
    monst.mon.race = Race.NEPHIL;
    expect(calcSpecDam(s.univ, ItemAbil.SLAYER_WEAPON, 2, Race.HUMANOID, monst).damage).toBe(6);
    // `!isHuman(race)` excludes humans from the widened rule, and HUMAN isn't
    // HUMANOID, so a plain human takes nothing extra.
    monst.mon.race = Race.HUMAN;
    expect(calcSpecDam(s.univ, ItemAbil.SLAYER_WEAPON, 2, Race.HUMANOID, monst).damage).toBe(0);
  });

  it('an undead-bane weapon also bites the skeletal', () => {
    const s = inTown();
    const monst = s.univ.town!.monsters.find((c) => c.isAlive)!;
    monst.mon.race = Race.SKELETAL;
    expect(calcSpecDam(s.univ, ItemAbil.SLAYER_WEAPON, 2, Race.UNDEAD, monst).damage).toBe(12);
  });
});

describe('on-hit item abilities', () => {
  /** A shot that always lands, from PC 0 at a creature two squares away. */
  function aShot(ammoExtra: Partial<Item>): {
    s: GameSession; monst: Creature; pc: Player;
  } {
    const s = inTown();
    s.startCombat(s.univ.party.direction);
    s.univ.curPc = 0;
    const pc = s.univ.party.pcs[0]!;
    const monst = s.univ.town!.monsters.find((c) => c.isAlive)!;
    monst.curLoc = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
    monst.maxHealth = 500;
    monst.health = 500;
    armWith(pc, anItem(ItemType.BOW, { bonus: 20 }), anItem(ItemType.ARROW, {
      itemLevel: 8, bonus: 30, charges: 10, ...ammoExtra,
    }));
    pc.skills[Skill.ARCHERY] = 20;
    pc.ap = 10;
    return { s, monst, pc };
  }

  function fire(s: GameSession, at: { x: number; y: number }): void {
    const loaded = loadMissile(s.univ);
    if (!isLoaded(loaded)) throw new Error('should be armed');
    fireMissile(s, loaded, at);
  }

  it('a soulsucking missile heals the firer, on the coin flip that says so', () => {
    const { s, monst, pc } = aShot({
      ability: ItemAbil.SOULSUCKER, abilStrength: 10,
    });
    pc.maxHealth = 500;
    pc.curHealth = 100;
    // The flip is one get_ran call, so fire until it comes up.
    for (let i = 0; i < 20 && pc.curHealth === 100; i++) {
      pc.items[1]!.charges = 10;
      monst.health = 500;
      fire(s, monst.curLoc);
    }
    expect(s.univ.transcript.join('\n')).toContain('Missile drains life.');
    expect(pc.curHealth).toBeGreaterThan(100);
  });

  it('a status missile applies its status', () => {
    const { s, monst } = aShot({
      ability: ItemAbil.STATUS_WEAPON, abilStrength: 8, abilData: Status.ACID,
    });
    for (let i = 0; i < 20 && (monst.status[Status.ACID] ?? 0) === 0; i++) {
      monst.health = 500;
      fire(s, monst.curLoc);
    }
    expect(s.univ.transcript.join('\n')).toContain('Missile drips acid.');
    expect(monst.status[Status.ACID] ?? 0).toBeGreaterThan(0);
  });

  it('an antimagic missile drains a spellcaster and gives some back', () => {
    const { s, monst, pc } = aShot({
      ability: ItemAbil.ANTIMAGIC_WEAPON, abilStrength: 20,
    });
    monst.mon.mu = 5;
    monst.maxMp = 60;
    monst.mp = 60;
    pc.curSp = 0;
    pc.maxSp = 100;
    for (let i = 0; i < 20 && monst.mp === 60; i++) {
      monst.health = 500;
      fire(s, monst.curLoc);
    }
    expect(monst.mp).toBeLessThan(60);
    expect(s.univ.transcript.join('\n')).toContain('Missile drains energy.');
    expect(pc.curSp).toBeGreaterThan(0);
  });

  it('a damaging missile lands its extra damage as its own type', () => {
    const { s, monst } = aShot({
      ability: ItemAbil.DAMAGING_WEAPON, abilStrength: 5, abilData: 1, // FIRE
    });
    const before = monst.health;
    fire(s, monst.curLoc);
    // Two hits, so more than the 8d1+30 the arrow alone could manage.
    expect(monst.health).toBeLessThan(before);
  });
});
