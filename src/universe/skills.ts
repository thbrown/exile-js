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

export enum Race {
  UNKNOWN = -1,
  HUMAN = 0,
  NEPHIL = 1,
  SLITH = 2,
  VAHNATAI = 3,
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
