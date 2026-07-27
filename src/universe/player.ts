/**
 * A single party member — cPlayer (universe/pc.cpp). Identity, stats, the two
 * hardcoded presets a game starts with, and (M5) the `iLiving` half of the
 * damage and status pipeline: every effect here layers the PC's equipment
 * protections and racial/trait disadvantages on top of the base `applyStatus`.
 */

import { Direction, Location, loc, percent } from '../core/location';
import { GameRng } from '../core/rng';
import { Item, ItemAbil, defaultItem } from '../data/item';
import { getProtLevel, hasAbilEquip } from './inventory';
import { Living, SpellNote, livingSound, printResult } from './living';
import { Party } from './party';
import {
  MainStatus, NUM_SKILLS, NUM_STATUSES, NUM_TRAITS, Race, Skill, Status, Trait,
} from './skills';

export const NUM_PC_SLOTS = 6;
export const NUM_INVEN_SLOTS = 24;
/** 62 spells per school (spell.hpp) — the last two are scenario-only. */
export const NUM_SPELLS = 62;

export enum PartyPreset {
  /** The six pregens a new game starts with (cPlayer ctor, pc.cpp:1084). */
  DEFAULT = 0,
  /** Maxed-out test party (pc.cpp:1036). */
  DEBUG = 1,
}

/**
 * The percentage each trait adds to the experience needed per level
 * (cPlayer::get_tnl), indexed by `Trait`. Negative entries are disadvantages,
 * which make levelling *cheaper*.
 */
const TRAIT_XP_COST: number[] = [
  10, // TOUGHNESS
  20, // MAGICALLY_APT
  8, // AMBIDEXTROUS
  10, // NIMBLE
  4, // CAVE_LORE
  6, // WOODSMAN
  10, // GOOD_CONST
  7, // HIGHLY_ALERT
  12, // STRENGTH
  15, // RECUPERATION
  -10, // SLUGGISH
  -8, // MAGICALLY_INEPT
  -8, // FRAIL
  -20, // CHRONIC_DISEASE
  -8, // BAD_BACK
  -40, // PACIFIST
  -10, // ANAMA
];

/**
 * `cPlayer::basic_spells` (pc.cpp:28) — `numeric_limits<uint32_t>::max() >> 2`,
 * which is bits 0..29. So every PC, pregen or newly made, starts out knowing
 * the first **30** spells on each list, and learns the rest from books and
 * scenario nodes.
 */
export const BASIC_SPELLS = 30;

function basicSpells(): boolean[] {
  return Array.from({ length: NUM_SPELLS }, (_, i) => i < BASIC_SPELLS);
}

/** skill_bonus (shop.cpp:43) — the stat bonus table, indexed by skill level. */
const SKILL_BONUS = [
  -3, -3, -2, -1, 0, 0, 1, 1, 1, 2,
  2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5,
];

export class Player extends Living {
  name = '';
  mainStatus: MainStatus = MainStatus.ABSENT;
  skills: number[] = new Array<number>(NUM_SKILLS).fill(0);
  traits: boolean[] = new Array<boolean>(NUM_TRAITS).fill(false);
  curHealth = 6;
  maxHealth = 6;
  curSp = 0;
  maxSp = 0;
  experience = 0;
  skillPts = 65;
  level = 1;
  expAdj = 100;
  race: Race = Race.HUMAN;
  whichGraphic = 0;
  uniqueId = 0;
  items: Item[] = Array.from({ length: NUM_INVEN_SLOTS }, () => defaultItem());
  /** Which slots are currently worn/wielded (cPlayer::equip). */
  equip: boolean[] = new Array<boolean>(NUM_INVEN_SLOTS).fill(false);
  /**
   * Which spells this PC knows (cPlayer::mage_spells / priest_spells). Every
   * PC starts knowing `basic_spells` on both lists — see BASIC_SPELLS.
   */
  mageSpells: boolean[] = basicSpells();
  priestSpells: boolean[] = basicSpells();
  /**
   * Where this PC stands in combat. Negative means "not placed", and
   * `getLoc` then falls back to the party's own square (pc.cpp:395).
   */
  combatPos: Location = loc(-1, -1);
  /** cPlayer::party — set by `Universe`, and only `getLoc` needs it. */
  party: Party | null = null;
  /**
   * How much of this turn's damage the PC is parrying away (cPlayer::parry).
   * Set by the combat Parry action and spent by `damagePc`.
   */
  parry = 0;
  /**
   * Who this PC last swung at, so the Attack command can repeat without
   * re-targeting (cPlayer::last_attacked).
   */
  lastAttacked: Living | null = null;
  /** The weapon carrying the poison from the Poison Weapon skill, if any. */
  weapPoisoned: Item | null = null;

  get isAlive(): boolean {
    return this.mainStatus === MainStatus.ALIVE;
  }

  constructor() {
    super();
    // cPlayer(no_party_t): the three basic stats start at 1, everything else 0
    this.skills[Skill.STRENGTH] = 1;
    this.skills[Skill.DEXTERITY] = 1;
    this.skills[Skill.INTELLIGENCE] = 1;
  }

  // --- iLiving queries ---------------------------------------------------

  getHealth(): number { return this.curHealth; }
  getMagic(): number { return this.curSp; }
  getLevel(): number { return this.level; }
  getName(): string { return this.name; }

  getLoc(): Location {
    if (this.party && (this.combatPos.x < 0 || this.combatPos.y < 0)) return this.party.getLoc();
    return this.combatPos;
  }

  /** cPlayer::is_friendly (pc.cpp:360) — only a charm turns a PC hostile. */
  get isFriendly(): boolean {
    return (this.status[Status.CHARM] ?? 0) <= 0;
  }

  isFriendlyTo(other: Living): boolean {
    if ((this.status[Status.CHARM] ?? 0) > 0) {
      if (other.isFriendly) return false;
      // A charmed PC sides with attitude A; another charmed PC is an ally.
      const attitude = (other as { attitude?: number }).attitude;
      return attitude === undefined ? true : attitude === 1 /* HOSTILE_A */;
    }
    return other.isFriendly;
  }

  isShielded(): boolean {
    if ((this.status[Status.MARTYRS_SHIELD] ?? 0) > 0) return true;
    return getProtLevel(this, ItemAbil.MARTYRS_SHIELD) > 0;
  }

  /** cPlayer::get_shared_dmg (pc.cpp:387). */
  getSharedDmg(base: number, rng: GameRng): number {
    const fromStatus = this.status[Status.MARTYRS_SHIELD] ?? 0;
    const fromGear = getProtLevel(this, ItemAbil.MARTYRS_SHIELD);
    if (fromStatus + fromGear <= 0) return 0;
    if (rng.getRan(1, 1, 20) < fromGear) return base + Math.max(1, Math.trunc(fromGear / 5));
    return base;
  }

  /**
   * cPlayer::skill (pc.cpp:...) — the *effective* level of a skill, gear
   * included. Anything that rolls against a skill uses this; `statAdj` and the
   * training screen deliberately use the raw `skills` array instead.
   */
  skill(which: Skill): number {
    let bulkBonus = 0;
    if (which >= Skill.EDGED_WEAPONS && which <= Skill.DEFENSE) {
      bulkBonus = getProtLevel(this, ItemAbil.BOOST_WAR);
    } else if (which >= Skill.MAGE_SPELLS && which <= Skill.ITEM_LORE) {
      bulkBonus = getProtLevel(this, ItemAbil.BOOST_MAGIC);
    }
    const boosted = (this.skills[which] ?? 0) + getProtLevel(this, ItemAbil.BOOST_STAT, which);
    return Math.min(20, boosted) + bulkBonus;
  }

  /**
   * cPlayer::get_tnl (pc.cpp:70) — experience per level. A race costs extra,
   * and every trait shifts it by a percentage: the strong advantages are dear
   * and the disadvantages pay you back.
   */
  getTnl(): number {
    const racePenalty: Partial<Record<Race, number>> = {
      [Race.NEPHIL]: 12, [Race.SLITH]: 20, [Race.VAHNATAI]: 18,
    };
    let storePercent = 100;
    for (let i = 0; i < NUM_TRAITS; i++) {
      if (this.traits[i]) storePercent += TRAIT_XP_COST[i] ?? 0;
    }
    const tnl = percent(100 + (racePenalty[this.race] ?? 0), storePercent);
    return Math.max(tnl, 10);
  }

  /**
   * cPlayer::stat_adj (pc.cpp:336) — the roll bonus a stat confers. Note it
   * reads the *base* skill, deliberately: doing otherwise would change how
   * stat-boosting items compound.
   */
  statAdj(which: Skill): number {
    let tr = SKILL_BONUS[Math.min(this.skills[which] ?? 0, SKILL_BONUS.length - 1)] ?? 0;
    if (which === Skill.INTELLIGENCE && this.traits[Trait.MAGICALLY_APT]) tr++;
    if (which === Skill.STRENGTH) {
      if (this.traits[Trait.STRENGTH]) tr++;
      if (this.race === Race.VAHNATAI) tr -= 2;
    }
    if (hasAbilEquip(this, ItemAbil.BOOST_STAT, which)) tr++;
    return tr;
  }

  // --- iLiving effects ---------------------------------------------------

  /** cPlayer::heal (pc.cpp:128) — never past max, never below zero. */
  heal(amount: number): void {
    if (!this.isAlive) return;
    if (this.curHealth >= this.maxHealth) return;
    this.curHealth = Math.max(0, Math.min(this.maxHealth, this.curHealth + amount));
  }

  /** cPlayer::restore_sp (pc.cpp:306). */
  restoreSp(amount: number): void {
    if (!this.isAlive) return;
    if (amount <= 0) return;
    if (this.curSp >= this.maxSp) return;
    this.curSp = Math.max(0, Math.min(this.maxSp, this.curSp + amount));
  }

  /** cPlayer::drain_sp (pc.cpp:104) — a caster shrugs off most of a drain. */
  drainSp(drain: number, allowResist: boolean): void {
    if (drain <= 0) return;
    if (allowResist) {
      const mu = this.skills[Skill.MAGE_SPELLS] ?? 0;
      const cl = this.skills[Skill.PRIEST_SPELLS] ?? 0;
      if (mu > 0 && this.curSp > 4) drain = Math.min(this.curSp, Math.trunc(drain / 3));
      else if (cl > 0 && this.curSp > 10) drain = Math.min(this.curSp, Math.trunc(drain / 2));
    }
    this.curSp = Math.max(0, this.curSp - drain);
  }

  /** cPlayer::cure (pc.cpp:138). */
  cure(amount: number): void {
    if (!this.isAlive) return;
    if ((this.status[Status.POISON] ?? 0) <= amount) this.status[Status.POISON] = 0;
    else this.status[Status.POISON] = (this.status[Status.POISON] ?? 0) - amount;
    livingSound(51);
  }

  /** cPlayer::poison (pc.cpp:317) — frailty makes every dose worse. */
  poison(howMuch: number, rng: GameRng): void {
    if (!this.isAlive) return;
    howMuch -= Math.trunc(
      getProtLevel(this, ItemAbil.STATUS_PROTECTION, Status.POISON) / 2);
    howMuch -= Math.trunc(getProtLevel(this, ItemAbil.FULL_PROTECTION) / 3);

    if (this.traits[Trait.FRAIL] && howMuch > 1) howMuch++;
    if (this.traits[Trait.FRAIL] && howMuch === 1 && rng.getRan(1, 0, 1) === 0) howMuch++;

    if (howMuch > 0) {
      this.applyStatus(Status.POISON, howMuch);
      printResult(`  ${this.name} poisoned.`);
      livingSound(17);
    }
  }

  /** cPlayer::disease (pc.cpp:190) — a high-level PC often shakes it off. */
  disease(howMuch: number, rng: GameRng): void {
    if (!this.isAlive) return;
    if (rng.getRan(1, 1, 100) < this.level * 2) howMuch -= 2;
    if (howMuch <= 0) {
      printResult(`  ${this.name} saved.`);
      return;
    }
    howMuch -= Math.trunc(
      getProtLevel(this, ItemAbil.STATUS_PROTECTION, Status.DISEASE) / 2);
    if (this.traits[Trait.FRAIL] && howMuch > 1) howMuch++;
    if (this.traits[Trait.FRAIL] && howMuch === 1 && rng.getRan(1, 0, 1) === 0) howMuch++;
    this.applyStatus(Status.DISEASE, howMuch);
    printResult(`  ${this.name} diseased.`);
    livingSound(66);
  }

  /** cPlayer::curse (pc.cpp:147) — a negative amount blesses instead. */
  curse(howMuch: number): void {
    if (!this.isAlive) return;
    if (howMuch > 0) {
      howMuch -= Math.trunc(
        getProtLevel(this, ItemAbil.STATUS_PROTECTION, Status.BLESS_CURSE) / 2);
    }
    this.applyStatus(Status.BLESS_CURSE, -howMuch);
    if (howMuch < 0) printResult(`  ${this.name} blessed.`);
    else if (howMuch > 0) printResult(`  ${this.name} cursed.`);
  }

  /** cPlayer::slow (pc.cpp:267) — a negative amount hastes. */
  slow(howMuch: number): void {
    if (!this.isAlive) return;
    if (howMuch > 0) {
      howMuch -= Math.trunc(
        getProtLevel(this, ItemAbil.STATUS_PROTECTION, Status.HASTE_SLOW) / 2);
    }
    this.applyStatus(Status.HASTE_SLOW, -howMuch);
    if (howMuch < 0) printResult(`  ${this.name} hasted.`);
    else if (howMuch > 0) printResult(`  ${this.name} slowed.`);
  }

  /** cPlayer::web (pc.cpp:282). */
  web(howMuch: number): void {
    if (!this.isAlive) return;
    if (howMuch > 0) {
      howMuch -= Math.trunc(
        getProtLevel(this, ItemAbil.STATUS_PROTECTION, Status.WEBS) / 2);
    }
    this.applyStatus(Status.WEBS, howMuch);
    printResult(`  ${this.name} webbed.`);
    livingSound(17);
  }

  /** cPlayer::acid (pc.cpp:293) — protection is all-or-nothing here. */
  acid(howMuch: number): void {
    if (!this.isAlive) return;
    if (hasAbilEquip(this, ItemAbil.STATUS_PROTECTION, Status.ACID)) {
      printResult(`  ${this.name} resists acid.`);
      return;
    }
    // Note: the C++ writes the status directly rather than through
    // apply_status, so acid on a PC is *not* clamped to the usual bounds.
    this.status[Status.ACID] = (this.status[Status.ACID] ?? 0) + howMuch;
    printResult(`  ${this.name} covered with acid!`);
    livingSound(42);
  }

  /** cPlayer::dumbfound (pc.cpp:166). */
  dumbfound(howMuch: number, rng: GameRng): void {
    if (!this.isAlive) return;
    let r1 = rng.getRan(1, 0, 90);
    if (hasAbilEquip(this, ItemAbil.WILL)) {
      printResult('  Ring of Will glows.');
      r1 -= 10;
    }
    howMuch -= Math.trunc(getProtLevel(this, ItemAbil.STATUS_PROTECTION, Status.DUMB) / 4);
    if (r1 < this.level) howMuch -= 2;
    if (howMuch <= 0) {
      printResult(`  ${this.name} saved.`);
      return;
    }
    this.applyStatus(Status.DUMB, howMuch);
    printResult(`  ${this.name} dumbfounded.`);
    livingSound(67);
  }

  /** cPlayer::scare (pc.cpp:118) — not a thing for PCs in the original either. */
  scare(_howMuch: number): void {
    // Deliberately empty: the C++ has it as an unimplemented override.
  }

  /**
   * cPlayer::sleep (pc.cpp:213) — also paralysis and forcecage. Charm never
   * lands on a PC. `adj` is the caster's bonus to the saving roll.
   */
  sleep(whatType: Status, howMuch: number, adjust: number, rng: GameRng): void {
    if (whatType === Status.CHARM) return;
    if (!this.isAlive) return;
    if (howMuch === 0) return;

    // The unliving and the vegetable don't sleep.
    if (whatType === Status.ASLEEP && [
      Race.UNDEAD, Race.SKELETAL, Race.SLIME, Race.STONE, Race.PLANT,
    ].includes(this.race)) return;

    let freeAction = 0;
    if (whatType === Status.ASLEEP || whatType === Status.PARALYZED) {
      howMuch -= Math.trunc(getProtLevel(this, ItemAbil.WILL) / 2);
      freeAction = getProtLevel(this, ItemAbil.FREE_ACTION);
      // Free action is far better against paralysis than against sleep.
      howMuch -= whatType === Status.ASLEEP ? freeAction : freeAction * 300;
      howMuch -= Math.trunc(getProtLevel(this, ItemAbil.STATUS_PROTECTION, whatType) / 4);
    } else if (whatType === Status.FORCECAGE) {
      howMuch -= 1 + Math.trunc(
        getProtLevel(this, ItemAbil.STATUS_PROTECTION, whatType) / 8);
    }

    let r1 = rng.getRan(1, 1, 100) + adjust;
    if (whatType === Status.FORCECAGE) r1 -= this.statAdj(Skill.MAGE_LORE);
    if (r1 < 30 + freeAction * 2) howMuch = -1;
    // Being alert, or having just shaken it off, makes you immune to sleep.
    if (whatType === Status.ASLEEP
      && (this.traits[Trait.HIGHLY_ALERT] || (this.status[Status.ASLEEP] ?? 0) < 0)) howMuch = -1;
    if (howMuch <= 0) {
      printResult(`  ${this.name} resisted.`);
      return;
    }
    this.status[whatType] = howMuch;
    if (whatType === Status.ASLEEP) printResult(`  ${this.name} falls asleep.`);
    else if (whatType === Status.FORCECAGE) printResult(`  ${this.name} is trapped!`);
    else printResult(`  ${this.name} paralyzed.`);
    livingSound(whatType === Status.ASLEEP ? 96 : 90);
    // A cage holds you in place but doesn't cost you the turn.
    if (whatType !== Status.FORCECAGE) this.ap = 0;
  }

  /** cPlayer::avatar (pc.cpp:90) — the works, all at once. */
  avatar(): void {
    this.heal(300);
    this.cure(8);
    this.status[Status.BLESS_CURSE] = 8;
    this.status[Status.HASTE_SLOW] = 8;
    this.status[Status.INVULNERABLE] = 3;
    this.status[Status.MAGIC_RESISTANCE] = 8;
    this.status[Status.WEBS] = 0;
    this.status[Status.DISEASE] = 0;
    if ((this.status[Status.DUMB] ?? 0) > 0) this.status[Status.DUMB] = 0;
    this.status[Status.MARTYRS_SHIELD] = 8;
  }

  /** cPlayer::void_sanctuary (pc.cpp:122) — and it tells you. */
  override voidSanctuary(): void {
    if ((this.status[Status.INVISIBLE] ?? 0) > 0) printResult('You become visible!');
    super.voidSanctuary();
  }
}

// PARTY_DEFAULT tables, verbatim from pc.cpp:1084.
const DEFAULT_NAMES = ['Jenneke', 'Thissa', 'Frrrrrr', 'Adrianna', 'Feodoric', 'Michael'];
const DEFAULT_HEALTH = [22, 24, 24, 16, 16, 18];
const DEFAULT_SP = [0, 0, 0, 20, 20, 21];
const DEFAULT_GRAPHICS = [3, 32, 29, 16, 23, 14];
const DEFAULT_RACE = [Race.HUMAN, Race.SLITH, Race.NEPHIL, Race.HUMAN, Race.HUMAN, Race.HUMAN];

const DEFAULT_SKILLS: Partial<Record<Skill, number>>[] = [
  {
    [Skill.STRENGTH]: 8, [Skill.DEXTERITY]: 6, [Skill.INTELLIGENCE]: 2,
    [Skill.EDGED_WEAPONS]: 6, [Skill.ITEM_LORE]: 1, [Skill.ASSASSINATION]: 2,
  },
  {
    [Skill.STRENGTH]: 8, [Skill.DEXTERITY]: 7, [Skill.INTELLIGENCE]: 2,
    [Skill.POLE_WEAPONS]: 6, [Skill.THROWN_MISSILES]: 3, [Skill.DEFENSE]: 3,
    [Skill.POISON]: 2,
  },
  {
    [Skill.STRENGTH]: 8, [Skill.DEXTERITY]: 6, [Skill.INTELLIGENCE]: 2,
    [Skill.EDGED_WEAPONS]: 2, [Skill.BASHING_WEAPONS]: 2, [Skill.ARCHERY]: 4,
    [Skill.DISARM_TRAPS]: 4, [Skill.LOCKPICKING]: 4, [Skill.POISON]: 2, [Skill.LUCK]: 1,
  },
  {
    [Skill.STRENGTH]: 3, [Skill.DEXTERITY]: 2, [Skill.INTELLIGENCE]: 6,
    [Skill.EDGED_WEAPONS]: 2, [Skill.THROWN_MISSILES]: 2,
    [Skill.MAGE_SPELLS]: 3, [Skill.MAGE_LORE]: 3, [Skill.ITEM_LORE]: 1,
  },
  {
    [Skill.STRENGTH]: 2, [Skill.DEXTERITY]: 2, [Skill.INTELLIGENCE]: 6,
    [Skill.EDGED_WEAPONS]: 3, [Skill.THROWN_MISSILES]: 2,
    [Skill.MAGE_SPELLS]: 2, [Skill.PRIEST_SPELLS]: 1, [Skill.MAGE_LORE]: 4,
    [Skill.LUCK]: 1,
  },
  {
    [Skill.STRENGTH]: 2, [Skill.DEXTERITY]: 2, [Skill.INTELLIGENCE]: 6,
    [Skill.BASHING_WEAPONS]: 2, [Skill.THROWN_MISSILES]: 2, [Skill.DEFENSE]: 1,
    [Skill.PRIEST_SPELLS]: 3, [Skill.MAGE_LORE]: 3, [Skill.ALCHEMY]: 2,
  },
];

const DEFAULT_TRAITS: number[][] = [
  [2, 6, 11], // ambidextrous, good constitution, magically inept
  [0, 5, 10], // toughness, woodsman, sluggish
  [3, 12], // nimble, frail
  [1], // magically apt
  [4, 6, 7, 14], // cave lore, good constitution, highly alert, bad back
  [1], // magically apt
];

const DEBUG_NAMES = ['Gunther', 'Yanni', 'Mandolin', 'Pete', 'Vraiment', 'Goo'];

export function makePresetPlayer(preset: PartyPreset, slot: number): Player {
  const pc = new Player();
  pc.mainStatus = MainStatus.ALIVE;
  pc.uniqueId = slot + 1000;
  pc.direction = Direction.N;

  if (preset === PartyPreset.DEBUG) {
    pc.name = DEBUG_NAMES[slot] ?? '';
    pc.skills[Skill.STRENGTH] = 20;
    pc.skills[Skill.DEXTERITY] = 20;
    pc.skills[Skill.INTELLIGENCE] = 20;
    for (let i = 3; i < NUM_SKILLS; i++) pc.skills[i] = 8;
    pc.curHealth = pc.maxHealth = 60;
    pc.curSp = pc.maxSp = 90;
    pc.skillPts = 60;
    pc.expAdj = 50;
    for (let i = 0; i < 10; i++) pc.traits[i] = true;
    pc.mageSpells.fill(true);
    pc.priestSpells.fill(true);
    // 1, 4, 7, 10, 13, 16 — with slot 2 bumped by one
    pc.whichGraphic = slot * 3 + 1 + (slot === 2 ? 1 : 0);
    return pc;
  }

  pc.name = DEFAULT_NAMES[slot] ?? '';
  const skills = DEFAULT_SKILLS[slot] ?? {};
  for (let i = 0; i < NUM_SKILLS; i++) pc.skills[i] = skills[i as Skill] ?? 0;
  pc.curHealth = pc.maxHealth = DEFAULT_HEALTH[slot] ?? 6;
  pc.curSp = pc.maxSp = DEFAULT_SP[slot] ?? 0;
  pc.skillPts = 0;
  for (const t of DEFAULT_TRAITS[slot] ?? []) pc.traits[t] = true;
  pc.race = DEFAULT_RACE[slot] ?? Race.HUMAN;
  pc.whichGraphic = DEFAULT_GRAPHICS[slot] ?? 0;
  return pc;
}
