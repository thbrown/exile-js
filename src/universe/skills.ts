/**
 * Character stat enums, ported verbatim (values are part of save/scenario
 * formats): eSkill/eTrait (skills_traits.hpp), eRace (race.hpp),
 * eMainStatus (damage.hpp:82).
 */

export enum Skill {
  INVALID = -1,
  STRENGTH = 0,
  DEXTERITY = 1,
  INTELLIGENCE = 2,
  EDGED_WEAPONS = 3,
  BASHING_WEAPONS = 4,
  POLE_WEAPONS = 5,
  THROWN_MISSILES = 6,
  ARCHERY = 7,
  DEFENSE = 8,
  MAGE_SPELLS = 9,
  PRIEST_SPELLS = 10,
  MAGE_LORE = 11,
  ALCHEMY = 12,
  ITEM_LORE = 13,
  DISARM_TRAPS = 14,
  LOCKPICKING = 15,
  ASSASSINATION = 16,
  POISON = 17,
  LUCK = 18,
  MAX_HP = 19,
  MAX_SP = 20,
  // Magic values; only for check_party_stat()
  CUR_HP = 100,
  CUR_SP = 101,
  CUR_XP = 102,
  CUR_SKILL = 103,
  CUR_LEVEL = 104,
}

/** The 19 skills a PC actually stores (STRENGTH..LUCK). */
export const NUM_SKILLS = 19;

export enum Trait {
  TOUGHNESS = 0,
  MAGICALLY_APT = 1,
  AMBIDEXTROUS = 2,
  NIMBLE = 3,
  CAVE_LORE = 4,
  WOODSMAN = 5,
  GOOD_CONST = 6,
  HIGHLY_ALERT = 7,
  STRENGTH = 8,
  RECUPERATION = 9,
  SLUGGISH = 10,
  MAGICALLY_INEPT = 11,
  FRAIL = 12,
  CHRONIC_DISEASE = 13,
  BAD_BACK = 14,
  PACIFIST = 15,
  ANAMA = 16,
}

export const NUM_TRAITS = 17;

/**
 * eRace (race.hpp:12) — one enum for both PCs and monsters. Only the first four
 * are selectable for a party; the rest come from monster definitions, and the
 * comments are the values these had in the legacy eMonsterType.
 */
export enum Race {
  UNKNOWN = -1,
  HUMAN = 0,
  NEPHIL = 1,
  SLITH = 2,
  VAHNATAI = 3,
  REPTILE = 4,
  BEAST = 5,
  IMPORTANT = 6,
  MAGE = 7,
  PRIEST = 8,
  HUMANOID = 9,
  DEMON = 10,
  UNDEAD = 11,
  GIANT = 12,
  SLIME = 13,
  STONE = 14,
  BUG = 15,
  DRAGON = 16,
  MAGICAL = 17,
  PLANT = 18,
  BIRD = 19,
  SKELETAL = 20,
  GOBLIN = 21,
}

/** eStatus (damage.hpp:37) — the per-PC timed status effects. */
export enum Status {
  MAIN = -1,
  POISONED_WEAPON = 0,
  BLESS_CURSE = 1,
  POISON = 2,
  HASTE_SLOW = 3,
  INVULNERABLE = 4,
  MAGIC_RESISTANCE = 5,
  WEBS = 6,
  DISEASE = 7,
  INVISIBLE = 8,
  DUMB = 9,
  MARTYRS_SHIELD = 10,
  ASLEEP = 11,
  PARALYZED = 12,
  ACID = 13,
  FORCECAGE = 14,
  CHARM = 15,
}

export const NUM_STATUSES = 16;

/**
 * status_bounds (damage.cpp:52) — how far a status can be pushed. Most run
 * 0..8; a few go negative (bless/curse, haste/slow), and paralysis and
 * forcecage are measured in turns rather than levels.
 */
export function statusBounds(which: Status): [number, number] {
  const allowNegative = new Set([
    Status.BLESS_CURSE, Status.HASTE_SLOW, Status.POISONED_WEAPON,
    Status.POISON, Status.ASLEEP, Status.MAGIC_RESISTANCE, Status.DUMB,
  ]);
  let hi = 8;
  if (which === Status.MARTYRS_SHIELD) hi = 10;
  else if (which === Status.PARALYZED) hi = 5000;
  else if (which === Status.FORCECAGE) hi = 1000;
  return [allowNegative.has(which) ? -hi : 0, hi];
}

/**
 * status_info (damage.cpp:13) — per-status presentation and, more importantly,
 * `isNegative`, which is what `clear_bad_status` keys off. `icon`/`negIcon` are
 * indices into the status-icon strip; `special` overrides the icon while the
 * value falls in [lo, hi] (poison's only use of it).
 */
export interface StatusInfo {
  isNegative: boolean;
  icon: number;
  negIcon: number;
  special?: { icon: number; lo: number; hi: number };
}

const STATUS_INFO: StatusInfo[] = [
  { isNegative: false, icon: 4, negIcon: -1 }, // POISONED_WEAPON
  { isNegative: false, icon: 2, negIcon: 3 }, // BLESS_CURSE
  { isNegative: true, icon: 0, negIcon: -1, special: { icon: 1, lo: 4, hi: Infinity } }, // POISON
  { isNegative: false, icon: 6, negIcon: 8 }, // HASTE_SLOW
  { isNegative: false, icon: 5, negIcon: -1 }, // INVULNERABLE
  { isNegative: false, icon: 9, negIcon: 19 }, // MAGIC_RESISTANCE
  { isNegative: true, icon: 10, negIcon: -1 }, // WEBS
  { isNegative: true, icon: 11, negIcon: -1 }, // DISEASE
  { isNegative: false, icon: 12, negIcon: -1 }, // INVISIBLE
  { isNegative: true, icon: 13, negIcon: 18 }, // DUMB
  { isNegative: false, icon: 14, negIcon: -1 }, // MARTYRS_SHIELD
  { isNegative: true, icon: 15, negIcon: 21 }, // ASLEEP
  { isNegative: true, icon: 16, negIcon: -1 }, // PARALYZED
  { isNegative: true, icon: 17, negIcon: -1 }, // ACID
  { isNegative: true, icon: 20, negIcon: -1 }, // FORCECAGE
  { isNegative: true, icon: 22, negIcon: -1 }, // CHARM
];

export function statusInfo(which: Status): StatusInfo {
  return STATUS_INFO[which] ?? { isNegative: false, icon: -1, negIcon: -1 };
}

export enum MainStatus {
  ABSENT = 0,
  ALIVE = 1,
  DEAD = 2,
  DUST = 3,
  STONE = 4,
  FLED = 5,
  SURFACE = 6,
  WON = 7,
  SPLIT = 10,
}

/** Text shown in the PC stats panel for non-ALIVE statuses (boe.text.cpp:145). */
export const MAIN_STATUS_LABEL: Record<number, string> = {
  [MainStatus.ABSENT]: 'Absent',
  [MainStatus.DEAD]: 'Dead',
  [MainStatus.DUST]: 'Dust',
  [MainStatus.STONE]: 'Stone',
  [MainStatus.FLED]: 'Fled',
  [MainStatus.SURFACE]: 'Surface',
  [MainStatus.WON]: 'Won',
};
