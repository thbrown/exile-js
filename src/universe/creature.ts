/**
 * A live monster in the current town — cCreature (universe/creature.cpp).
 *
 * The C++ gets its stats by *inheriting* cMonster, so a creature's level,
 * resistances and abilities are its own mutable copy of the scenario's monster
 * definition rather than a reference to it. This port keeps that by cloning the
 * template into `mon` on assignment: charming, draining and splitting all edit
 * the copy, and the scenario's definition stays pristine.
 */

import { Direction, Location, minmax, percent } from '../core/location';
import { GameRng } from '../core/rng';
import { Attitude, DamageType, Monster, MonstTime, defaultMonster } from '../data/monster';
import { Townperson } from '../data/town';
import { Living, SpellNote } from './living';
import { Race, Status } from './skills';

export enum CreatureStatus {
  DEAD = 0,
  IDLE = 1,
  ALERTED = 2,
  FLEEING = 3,
}

/**
 * charm_odds (creature.cpp:19), indexed by *half* the monster's level — the
 * saving throw a mind-affecting effect has to beat. It reaches 0 at level 28,
 * which is why nothing high-level can be put to sleep.
 */
export const CHARM_ODDS = [
  90, 90, 85, 80, 78, 75, 73, 60, 40, 30,
  20, 10, 4, 1, 0, 0, 0, 0, 0, 0, 0,
];

/** The races that can't be put to sleep (creature.cpp, pc.cpp:219). */
const SLEEPLESS_RACES = [
  Race.UNDEAD, Race.SKELETAL, Race.SLIME, Race.STONE, Race.PLANT,
];

export class Creature extends Living {
  /** Index into scenario.scenMonsters. */
  number = 0;
  /** This creature's own copy of the monster definition. */
  mon: Monster = defaultMonster();
  active: CreatureStatus = CreatureStatus.IDLE;
  attitude: Attitude = Attitude.DOCILE;
  startLoc: Location = { x: 0, y: 0 };
  curLoc: Location = { x: 0, y: 0 };
  health = 0;
  maxHealth = 0;
  mp = 0;
  maxMp = 0;
  /** Current and starting morale; both derive from the level in-game. */
  morale = 0;
  mMorale = 0;
  /** Who this creature is attacking (a PC slot), and where it's headed. */
  target = 6;
  targLoc: Location = { x: 80, y: 80 };
  /** Turns left on a summon; 0 for a creature that belongs here. */
  summonTime = 0;
  partySummoned = false;
  mobile = true;
  timeFlag: MonstTime = MonstTime.ALWAYS;
  timeCode = 0;
  monsterTime = 0;
  /** SDF pair that suppresses this creature when set (spec1/spec2). */
  spec1 = -1;
  spec2 = -1;
  specEncCode = 0;
  pictureNum = 0;
  xWidth = 1;
  yWidth = 1;
  /** Index in the town's creature list, for preset lookups. */
  slot = -1;
  /** Absolute personality id (town * 10 + slot); negative means unable to talk. */
  personality = -1;
  facialPic = -1;
  specialOnTalk = -1;
  specialOnKill = -1;

  // --- iLiving queries ---------------------------------------------------

  getHealth(): number { return this.health; }
  getMagic(): number { return this.mp; }
  getLevel(): number { return this.mon.level; }
  getName(): string { return this.mon.name; }
  getLoc(): Location { return this.curLoc; }

  get isFriendly(): boolean {
    return this.attitude === Attitude.DOCILE || this.attitude === Attitude.FRIENDLY;
  }

  get isAlive(): boolean {
    return this.active !== CreatureStatus.DEAD;
  }

  /**
   * cCreature::is_friendly (creature.cpp) — two hostiles are only allies if
   * they're hostile in the same faction (A vs B), which is how a scenario stages
   * a fight between two groups of monsters.
   */
  isFriendlyTo(other: Living): boolean {
    if (this.isFriendly !== other.isFriendly) return false;
    if (other instanceof Creature && !this.isFriendly) return this.attitude === other.attitude;
    return true;
  }

  /** TODO(M5b): the MARTYRS_SHIELD monster ability needs the uAbility port. */
  isShielded(_rng: GameRng): boolean {
    return (this.status[Status.MARTYRS_SHIELD] ?? 0) > 0;
  }

  /** TODO(M5b): MARTYRS_SHIELD's extra2 scales the shared damage. */
  getSharedDmg(baseDmg: number, _rng: GameRng): number {
    return baseDmg;
  }

  /**
   * cCreature::magic_adjust (creature.cpp) — a monster's magic resistance
   * scales down anything a spell tries to do to it.
   *
   * TODO(M5b): ABSORB_SPELLS lets some monsters swallow a spell whole and heal
   * from it; that needs the uAbility port.
   */
  magicAdjust(howMuch: number): number {
    if (howMuch <= 0) return howMuch;
    return percent(howMuch, this.mon.resist[DamageType.MAGIC] ?? 100);
  }

  // --- iLiving effects ---------------------------------------------------

  heal(amount: number): void {
    if (!this.isAlive) return;
    if (this.health >= this.maxHealth) return;
    this.health = minmax(0, this.maxHealth, this.health + amount);
  }

  restoreSp(amount: number): void {
    if (!this.isAlive) return;
    if (amount <= 0) return;
    if (this.mp >= this.maxMp) return;
    this.mp = minmax(0, this.maxMp, this.mp + amount);
  }

  drainSp(drain: number, allowResist: boolean): void {
    drain = this.magicAdjust(drain);
    if (drain <= 0) return;
    if (allowResist) {
      if (this.mon.mu > 0 && this.mp > 4) drain = Math.min(this.mp, Math.trunc(drain / 3));
      else if (this.mon.cl > 0 && this.mp > 10) drain = Math.min(this.mp, Math.trunc(drain / 2));
    }
    this.mp = Math.max(0, this.mp - drain);
  }

  cure(amount: number): void {
    if (!this.isAlive) return;
    if ((this.status[Status.POISON] ?? 0) <= amount) this.status[Status.POISON] = 0;
    else this.status[Status.POISON] = (this.status[Status.POISON] ?? 0) - amount;
  }

  /** Note poison scales by the *poison* resistance, not by magic_adjust. */
  poison(howMuch: number): void {
    if (howMuch !== 0) howMuch = percent(howMuch, this.mon.resist[DamageType.POISON] ?? 100);
    this.applyStatus(Status.POISON, howMuch);
    if (howMuch >= 0) this.spellNote(howMuch === 0 ? SpellNote.RESISTS : SpellNote.POISONED);
    else this.spellNote(SpellNote.CURED);
  }

  acid(howMuch: number): void {
    howMuch = this.magicAdjust(howMuch);
    this.applyStatus(Status.ACID, howMuch);
    this.spellNote(howMuch >= 0 ? SpellNote.ACID : SpellNote.CLEANS_ACID);
  }

  slow(howMuch: number): void {
    howMuch = this.magicAdjust(howMuch);
    this.applyStatus(Status.HASTE_SLOW, -howMuch);
    if (howMuch >= 0) this.spellNote(howMuch === 0 ? SpellNote.RESISTS : SpellNote.SLOWED);
    else this.spellNote(SpellNote.HASTED);
  }

  curse(howMuch: number): void {
    howMuch = this.magicAdjust(howMuch);
    this.applyStatus(Status.BLESS_CURSE, -howMuch);
    if (howMuch >= 0) this.spellNote(howMuch === 0 ? SpellNote.RESISTS : SpellNote.CURSED);
    else this.spellNote(SpellNote.BLESSED);
  }

  web(howMuch: number): void {
    howMuch = this.magicAdjust(howMuch);
    this.applyStatus(Status.WEBS, howMuch);
    if (howMuch >= 0) this.spellNote(howMuch === 0 ? SpellNote.RESISTS : SpellNote.WEBBED);
    else this.spellNote(SpellNote.CLEANS_WEBS);
  }

  /** Fear works on morale, not on a status. */
  scare(howMuch: number): void {
    howMuch = this.magicAdjust(howMuch);
    this.morale -= howMuch;
    if (howMuch >= 0) this.spellNote(howMuch === 0 ? SpellNote.RESISTS : SpellNote.SCARED);
    else this.spellNote(SpellNote.RALLIES);
  }

  disease(howMuch: number): void {
    howMuch = this.magicAdjust(howMuch);
    this.applyStatus(Status.DISEASE, howMuch);
    if (howMuch >= 0) this.spellNote(howMuch === 0 ? SpellNote.RESISTS : SpellNote.DISEASED);
    else this.spellNote(SpellNote.FEEL_BETTER);
  }

  dumbfound(howMuch: number): void {
    howMuch = this.magicAdjust(howMuch);
    this.applyStatus(Status.DUMB, howMuch);
    if (howMuch >= 0) this.spellNote(howMuch === 0 ? SpellNote.RESISTS : SpellNote.DUMBFOUNDED);
    else this.spellNote(SpellNote.MIND_CLEAR);
  }

  /**
   * cCreature::sleep — sleep, paralysis, forcecage and charm all roll against
   * `CHARM_ODDS[level / 2]`, and for charm `howMuch` is the attitude the
   * creature ends up with rather than a duration.
   *
   * A negative `howMuch` is the cure: it lifts the effect without a roll.
   */
  sleep(whichStatus: Status, amount: number, penalty: number, rng: GameRng): void {
    if (whichStatus !== Status.CHARM && amount < 0) {
      this.status[whichStatus] = (this.status[whichStatus] ?? 0) - amount;
      if (whichStatus !== Status.ASLEEP) {
        this.status[whichStatus] = Math.max(0, this.status[whichStatus] ?? 0);
      }
      return;
    }

    if (whichStatus === Status.ASLEEP && SLEEPLESS_RACES.includes(this.mon.race)) return;

    let r1 = rng.getRan(1, 1, 100);
    const magicResist = this.mon.resist[DamageType.MAGIC] ?? 100;
    // A monster immune to magic (resistance 0) is immune to all of this: the
    // roll is forced to 200, which beats every entry in CHARM_ODDS.
    if (magicResist > 0) r1 = Math.trunc((r1 * 100) / magicResist);
    else r1 = 200;
    r1 += penalty;
    if (whichStatus === Status.FORCECAGE && (this.mon.mu > 0 || this.mon.cl > 0)) r1 += 5;
    if (whichStatus === Status.ASLEEP) r1 -= 25;
    if (whichStatus === Status.PARALYZED) r1 -= 15;
    // TODO(M5b): a monster that radiates a sleep cloud can't be slept itself.

    if (r1 > (CHARM_ODDS[Math.trunc(this.mon.level / 2)] ?? 0)) {
      this.spellNote(SpellNote.RESISTS);
      return;
    }

    if (whichStatus === Status.CHARM) {
      if (amount <= 0 || amount > 3) amount = 2;
      this.attitude = amount as Attitude;
      this.spellNote(SpellNote.CHARMED);
    } else if (whichStatus === Status.FORCECAGE) {
      this.status[Status.FORCECAGE] = amount;
      this.spellNote(SpellNote.TRAPPED);
    } else {
      this.status[whichStatus] = amount;
      if (whichStatus === Status.ASLEEP && amount >= 0) this.spellNote(SpellNote.ASLEEP);
      if (whichStatus === Status.PARALYZED && amount >= 0) this.spellNote(SpellNote.PARALYZED);
      if (amount < 0) this.spellNote(SpellNote.ALERT);
    }
  }

  /** Monsters are never made avatars; the override exists to satisfy iLiving. */
  avatar(): void {
    // Deliberately empty, as in the C++.
  }

  /** cCreature::on_space — does this (possibly multi-square) creature cover it? */
  onSpace(where: Location): boolean {
    return where.x >= this.curLoc.x && where.x < this.curLoc.x + this.xWidth
      && where.y >= this.curLoc.y && where.y < this.curLoc.y + this.yWidth;
  }
}

/**
 * cPopulation::assign (population.cpp:51) — combine a town's preset with the
 * scenario's monster definition into a live creature, scaled for the party.
 * This replaced the old `return_monster_template`.
 */
export function assignCreature(
  slot: number,
  preset: Townperson,
  template: Monster,
  easy = false,
  difficultyAdjust = 1,
): Creature {
  const c = new Creature();
  c.slot = slot;
  c.number = preset.number;
  // The creature owns its stats, so the arrays are copied, not shared.
  c.mon = { ...template, resist: [...template.resist], attacks: [...template.attacks] };
  c.attitude = preset.startAttitude;
  c.startLoc = { ...preset.startLoc };
  c.curLoc = { ...preset.startLoc };
  c.mobile = preset.mobility !== 0;
  c.timeFlag = preset.timeFlag;
  c.timeCode = preset.timeCode;
  c.monsterTime = preset.monsterTime;
  c.spec1 = preset.spec1;
  c.spec2 = preset.spec2;
  c.specEncCode = preset.specEncCode;
  c.personality = preset.personality;
  c.facialPic = preset.facialPic;
  c.specialOnTalk = preset.specialOnTalk;
  c.specialOnKill = preset.specialOnKill;
  // The monster's own `health` is its maximum; easy mode halves it and the
  // difficulty adjustment multiplies it, in that order.
  c.mon.health = Math.trunc(c.mon.health / (easy ? 2 : 1)) * difficultyAdjust;
  c.maxHealth = c.mon.health;
  c.health = c.maxHealth;
  c.ap = 0;
  c.mp = c.maxMp = (template.mu > 0 || template.cl > 0) ? 12 * template.level : 0;
  c.mMorale = 10 * template.level;
  if (template.level > 20) c.mMorale += 10 * (template.level - 20);
  c.morale = c.mMorale;
  c.direction = Direction.Here;
  c.target = 6; // no target
  c.summonTime = 0;
  // An invisible monster draws as nothing until something reveals it.
  c.pictureNum = template.invisible ? 0 : template.pictureNum;
  c.xWidth = template.xWidth;
  c.yWidth = template.yWidth;
  c.active = CreatureStatus.IDLE;
  return c;
}
