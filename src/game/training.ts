/**
 * Training — the rules behind spend_xp (pc.editors.cpp:644) in mode 1, where a
 * trainer charges both skill points and gold, and a level once bought can't be
 * sold back.
 *
 * The original is a single dense dialog with a +/- pair per skill. This holds
 * the state and the rules; the caller draws it.
 *
 * TODO(M3): replace the caller's list with the real spend-xp.xml layout once
 * the dialogxml toolkit has stepper widgets.
 */

import { SKILL_GOLD_COST, SKILL_MAX } from '../data/shop';
import { Player } from '../universe/player';
import { NUM_SKILLS, Skill, Trait } from '../universe/skills';

/** skill_cost (shop.cpp:14) — skill points per level. */
export const SKILL_POINT_COST: Partial<Record<Skill, number>> = {
  [Skill.STRENGTH]: 3, [Skill.DEXTERITY]: 3, [Skill.INTELLIGENCE]: 3,
  [Skill.EDGED_WEAPONS]: 2, [Skill.BASHING_WEAPONS]: 2, [Skill.POLE_WEAPONS]: 2,
  [Skill.THROWN_MISSILES]: 1, [Skill.ARCHERY]: 2, [Skill.DEFENSE]: 2,
  [Skill.MAGE_SPELLS]: 6, [Skill.PRIEST_SPELLS]: 5, [Skill.MAGE_LORE]: 1,
  [Skill.ALCHEMY]: 2, [Skill.ITEM_LORE]: 4, [Skill.DISARM_TRAPS]: 2,
  [Skill.LOCKPICKING]: 1, [Skill.ASSASSINATION]: 4, [Skill.POISON]: 2,
  [Skill.LUCK]: 5,
};

/** Health and spell points are bought in their own units and prices. */
export const HP_PER_LEVEL = 2;
export const HP_GOLD_COST = 10;
export const SP_GOLD_COST = 15;
const MAX_HP_CAP = 250;
const MAX_SP_CAP = 150;

/** What a training row costs, in skill points and gold. */
export interface TrainCost {
  points: number;
  gold: number;
}

export function trainCost(which: Skill | 'hp' | 'sp'): TrainCost {
  if (which === 'hp') return { points: 1, gold: HP_GOLD_COST };
  if (which === 'sp') return { points: 1, gold: SP_GOLD_COST };
  return { points: SKILL_POINT_COST[which] ?? 0, gold: SKILL_GOLD_COST[which] ?? 0 };
}

/** get_skill_max (pc.editors.cpp:339). */
export function skillMax(which: Skill | 'hp' | 'sp'): number {
  if (which === 'hp') return MAX_HP_CAP;
  if (which === 'sp') return MAX_SP_CAP;
  return SKILL_MAX[which] ?? 0;
}

/** A training session in progress: nothing is committed until keep(). */
export class TrainingState {
  skills: number[];
  hp: number;
  sp: number;
  /** Skill points and gold left to spend. */
  points: number;
  gold: number;
  /** Where we started, so a level bought here can't be refunded elsewhere. */
  private readonly origSkills: number[];
  private readonly origHp: number;
  private readonly origSp: number;

  constructor(readonly pc: Player, gold: number) {
    this.skills = [...pc.skills];
    this.origSkills = [...pc.skills];
    this.hp = pc.maxHealth;
    this.origHp = pc.maxHealth;
    this.sp = pc.maxSp;
    this.origSp = pc.maxSp;
    this.points = pc.skillPts;
    this.gold = gold;
  }

  level(which: Skill | 'hp' | 'sp'): number {
    if (which === 'hp') return this.hp;
    if (which === 'sp') return this.sp;
    return this.skills[which] ?? 0;
  }

  private origLevel(which: Skill | 'hp' | 'sp'): number {
    if (which === 'hp') return this.origHp;
    if (which === 'sp') return this.origSp;
    return this.origSkills[which] ?? 0;
  }

  private minLevel(which: Skill | 'hp' | 'sp'): number {
    if (which === 'hp') return 6;
    if (which === 'sp') return 0;
    // The three basic stats never drop below one.
    return which === Skill.STRENGTH || which === Skill.DEXTERITY
      || which === Skill.INTELLIGENCE ? 1 : 0;
  }

  /** can_change_skill (pc.editors.cpp:350) in mode 1. */
  canChange(which: Skill | 'hp' | 'sp', increase: boolean): boolean {
    const cost = trainCost(which);
    if (increase) {
      if (this.level(which) >= skillMax(which)) return false;
      if (this.points < cost.points) return false;
      if (this.gold < cost.gold) return false;
      return true;
    }
    if (this.level(which) <= this.minLevel(which)) return false;
    // A trainer won't buy back what the PC came in with.
    if (this.level(which) === this.origLevel(which)) return false;
    return true;
  }

  /** Buy or refund one level. Returns false when the change isn't allowed. */
  change(which: Skill | 'hp' | 'sp', increase: boolean): boolean {
    if (!this.canChange(which, increase)) return false;
    const cost = trainCost(which);
    const step = increase ? 1 : -1;
    if (which === 'hp') this.hp += step * HP_PER_LEVEL;
    else if (which === 'sp') this.sp += step;
    else this.skills[which] = (this.skills[which] ?? 0) + step;
    this.points -= step * cost.points;
    this.gold -= step * cost.gold;
    return true;
  }

  /** Whether anything has actually been bought. */
  get changed(): boolean {
    if (this.hp !== this.origHp || this.sp !== this.origSp) return true;
    return this.skills.some((v, i) => v !== this.origSkills[i]);
  }

  /**
   * An Anama member who trains in mage spells breaks their oath; the warning is
   * shown before the level is kept (pc.editors.cpp:598).
   */
  get breaksAnamaOath(): boolean {
    return this.pc.traits[Trait.ANAMA] === true
      && this.origSkills[Skill.MAGE_SPELLS] === 0
      && (this.skills[Skill.MAGE_SPELLS] ?? 0) > 0;
  }

  /** do_xp_keep (pc.editors.cpp:318). Returns the gold the party has left. */
  keep(): number {
    const pc = this.pc;
    for (let i = 0; i < NUM_SKILLS; i++) pc.skills[i] = this.skills[i]!;
    // Bought health and spell points arrive already filled.
    pc.curHealth += this.hp - pc.maxHealth;
    pc.maxHealth = this.hp;
    pc.curSp += this.sp - pc.maxSp;
    pc.maxSp = this.sp;
    pc.skillPts = this.points;
    // An Anama member who has taken up mage magic pays for it permanently.
    if (pc.traits[Trait.ANAMA] && (pc.skills[Skill.MAGE_SPELLS] ?? 0) > 0) {
      pc.skills[Skill.STRENGTH] = (pc.skills[Skill.STRENGTH] ?? 0) - 2;
      pc.skills[Skill.DEXTERITY] = (pc.skills[Skill.DEXTERITY] ?? 0) - 2;
      pc.skills[Skill.INTELLIGENCE] = (pc.skills[Skill.INTELLIGENCE] ?? 0) - 4;
      pc.skills[Skill.LUCK] = 0;
      pc.traits[Trait.ANAMA] = false;
    }
    return this.gold;
  }
}
