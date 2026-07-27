/**
 * eSpell and the cSpell dictionary — ../exile-wasm/src/spell.hpp and
 * spell.cpp.
 *
 * The numbers are part of the save format (a PC stores which spells they know
 * as flags indexed by these), so they are verbatim, gaps and all: mage spells
 * run 0..61 with the "special" ones the scenario designer can hand out at
 * 62..78, and priest spells do the same from 100.
 *
 * The table below is a transcription of spell.cpp's builder chains — 147 of
 * them, one per spell — and nothing in it is invented. `needsSelect()` in the
 * C++ quietly sets `peaceful` as well as the selector, so entries here carry
 * both; the note in spell.cpp is worth repeating, that `peaceful` means "a
 * pacifist may cast this", not "only castable out of combat".
 */

import { Skill } from '../universe/skills';
import { getStr } from './strings';

/**
 * How a spell is cast in combat. YES is "same as in town", IMMED has its own
 * town implementation, and TARGET/FANCY both ask the player to pick a square.
 */
export enum SpellRefer {
  YES = 0,
  IMMED = 1,
  TARGET = 2,
  FANCY = 3,
}

/** Whether a spell picks a party member first, and who may be picked. */
export enum SpellSelect {
  NO = 0,
  ACTIVE = 1,
  ANY = 2,
  DEAD = 3,
  STONE = 4,
}

/** A bit field: when the spell may be cast at all. */
export enum SpellWhen {
  COMBAT = 1,
  TOWN = 2,
  OUTDOORS = 4,
}

export enum Spell {
  NONE = -1,
  LIGHT = 0,
  SPARK = 1,
  HASTE_MINOR = 2,
  STRENGTH = 3,
  SCARE = 4,
  CLOUD_FLAME = 5,
  IDENTIFY = 6,
  SCRY_MONSTER = 7,
  GOO = 8,
  TRUE_SIGHT = 9,
  POISON_MINOR = 10,
  FLAME = 11,
  SLOW = 12,
  DUMBFOUND = 13,
  ENVENOM = 14,
  CLOUD_STINK = 15,
  SUMMON_BEAST = 16,
  CONFLAGRATION = 17,
  DISPEL_SQUARE = 18,
  CLOUD_SLEEP = 19,
  UNLOCK = 20,
  HASTE = 21,
  FIREBALL = 22,
  LIGHT_LONG = 23,
  FEAR = 24,
  WALL_FORCE = 25,
  SUMMON_WEAK = 26,
  ARROWS_FLAME = 27,
  WEB = 28,
  RESIST_MAGIC = 29,
  POISON = 30,
  ICE_BOLT = 31,
  SLOW_GROUP = 32,
  MAGIC_MAP = 33,
  CAPTURE_SOUL = 34,
  SIMULACRUM = 35,
  ARROWS_VENOM = 36,
  WALL_ICE = 37,
  STEALTH = 38,
  HASTE_MAJOR = 39,
  FIRESTORM = 40,
  DISPEL_BARRIER = 41,
  BARRIER_FIRE = 42,
  SUMMON = 43,
  SHOCKSTORM = 44,
  SPRAY_FIELDS = 45,
  POISON_MAJOR = 46,
  FEAR_GROUP = 47,
  KILL = 48,
  PARALYZE = 49,
  DEMON = 50,
  ANTIMAGIC = 51,
  MINDDUEL = 52,
  FLIGHT = 53,
  SHOCKWAVE = 54,
  BLESS_MAJOR = 55,
  PARALYSIS_MASS = 56,
  PROTECTION = 57,
  SUMMON_MAJOR = 58,
  BARRIER_FORCE = 59,
  QUICKFIRE = 60,
  ARROWS_DEATH = 61,
  STRENGTHEN_TARGET = 62,
  SUMMON_RAT = 63,
  WALL_ICE_BALL = 64,
  GOO_BOMB = 65,
  FOUL_VAPOR = 66,
  CLOUD_SLEEP_LARGE = 67,
  ACID_SPRAY = 68,
  PARALYZE_BEAM = 69,
  SLEEP_MASS = 70,
  RAVAGE_ENEMIES = 71,
  BLADE_AURA = 72,
  ICY_RAIN = 73,
  FLAME_AURA = 74,
  SUMMON_AID = 75,
  SUMMON_AID_MAJOR = 76,
  FLASH_STEP = 77,
  RECHARGE = 78,
  BLESS_MINOR = 100,
  HEAL_MINOR = 101,
  POISON_WEAKEN = 102,
  TURN_UNDEAD = 103,
  LOCATION = 104,
  SANCTUARY = 105,
  SYMBIOSIS = 106,
  MANNA_MINOR = 107,
  RITUAL_SANCTIFY = 108,
  STUMBLE = 109,
  BLESS = 110,
  POISON_CURE = 111,
  CURSE = 112,
  LIGHT_DIVINE = 113,
  WOUND = 114,
  SUMMON_SPIRIT = 115,
  MOVE_MOUNTAINS = 116,
  CHARM_FOE = 117,
  DISEASE = 118,
  AWAKEN = 119,
  HEAL = 120,
  HEAL_ALL_LIGHT = 121,
  HOLY_SCOURGE = 122,
  DETECT_LIFE = 123,
  PARALYSIS_CURE = 124,
  MANNA = 125,
  FORCEFIELD = 126,
  DISEASE_CURE = 127,
  RESTORE_MIND = 128,
  SMITE = 129,
  POISON_CURE_ALL = 130,
  CURSE_ALL = 131,
  DISPEL_UNDEAD = 132,
  CURSE_REMOVE = 133,
  STICKS_TO_SNAKES = 134,
  MARTYRS_SHIELD = 135,
  CLEANSE = 136,
  FIREWALK = 137,
  BLESS_PARTY = 138,
  HEAL_MAJOR = 139,
  RAISE_DEAD = 140,
  FLAMESTRIKE = 141,
  SANCTUARY_MASS = 142,
  SUMMON_HOST = 143,
  SHATTER = 144,
  DISPEL_SPHERE = 145,
  HEAL_ALL = 146,
  REVIVE = 147,
  HYPERACTIVITY = 148,
  DESTONE = 149,
  SUMMON_GUARDIAN = 150,
  CHARM_MASS = 151,
  PROTECTIVE_CIRCLE = 152,
  PESTILENCE = 153,
  REVIVE_ALL = 154,
  RAVAGE_SPIRIT = 155,
  RESURRECT = 156,
  DIVINE_THUD = 157,
  AVATAR = 158,
  WALL_BLADES = 159,
  WORD_RECALL = 160,
  CLEANSE_MAJOR = 161,
  DISPEL_FIELD = 162,
  MOVE_MOUNTAINS_MASS = 163,
  WRACK = 164,
  UNHOLY_RAVAGING = 165,
  AUGMENTATION = 166,
  NIRVANA = 167,
}

/** The first special (scenario-granted) mage spell; 0..61 are the real list. */
export const NUM_NORMAL_SPELLS = 62;

export interface SpellInfo {
  refer: SpellRefer;
  cost?: number;
  range?: number;
  level?: number;
  select?: SpellSelect;
  /** The skill that governs it. The special spells leave this unset. */
  type?: Skill;
  /** A bit field of SpellWhen; 0 means the spell is never castable directly. */
  when?: number;
  peaceful?: boolean;
  targetLock?: boolean;
}

/** `cSpell::dictionary` — every spell in the game, keyed by its number. */
export const SPELLS: Partial<Record<Spell, SpellInfo>> = {
  [Spell.LIGHT]: { refer: SpellRefer.YES, cost: 1, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.SPARK]: { refer: SpellRefer.TARGET, cost: 1, range: 6, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.HASTE_MINOR]: { refer: SpellRefer.IMMED, cost: 1, level: 1, select: SpellSelect.ACTIVE, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.STRENGTH]: { refer: SpellRefer.IMMED, cost: 1, level: 1, select: SpellSelect.ACTIVE, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.SCARE]: { refer: SpellRefer.TARGET, cost: 1, range: 7, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true, targetLock: true },
  [Spell.CLOUD_FLAME]: { refer: SpellRefer.TARGET, cost: 2, range: 7, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.IDENTIFY]: { refer: SpellRefer.YES, cost: 50, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.SCRY_MONSTER]: { refer: SpellRefer.TARGET, cost: 2, range: 14, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, peaceful: true, targetLock: true },
  [Spell.GOO]: { refer: SpellRefer.TARGET, cost: 1, range: 8, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.TRUE_SIGHT]: { refer: SpellRefer.YES, cost: 3, level: 1, type: Skill.MAGE_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.POISON_MINOR]: { refer: SpellRefer.TARGET, cost: 2, range: 6, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.FLAME]: { refer: SpellRefer.TARGET, cost: 3, range: 8, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SLOW]: { refer: SpellRefer.TARGET, cost: 2, range: 7, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.DUMBFOUND]: { refer: SpellRefer.TARGET, cost: 2, range: 10, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.ENVENOM]: { refer: SpellRefer.IMMED, cost: 2, level: 2, select: SpellSelect.ACTIVE, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.CLOUD_STINK]: { refer: SpellRefer.TARGET, cost: 2, range: 8, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SUMMON_BEAST]: { refer: SpellRefer.TARGET, cost: 4, range: 3, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.CONFLAGRATION]: { refer: SpellRefer.TARGET, cost: 4, range: 8, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.DISPEL_SQUARE]: { refer: SpellRefer.TARGET, cost: 2, range: 10, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, peaceful: true },
  [Spell.CLOUD_SLEEP]: { refer: SpellRefer.TARGET, cost: 6, range: 6, level: 2, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.UNLOCK]: { refer: SpellRefer.YES, cost: 3, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.HASTE]: { refer: SpellRefer.IMMED, cost: 3, level: 3, select: SpellSelect.ACTIVE, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.FIREBALL]: { refer: SpellRefer.TARGET, cost: 5, range: 12, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.LIGHT_LONG]: { refer: SpellRefer.YES, cost: 3, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.FEAR]: { refer: SpellRefer.TARGET, cost: 3, range: 10, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true, targetLock: true },
  [Spell.WALL_FORCE]: { refer: SpellRefer.TARGET, cost: 5, range: 12, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SUMMON_WEAK]: { refer: SpellRefer.FANCY, cost: 6, range: 4, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.ARROWS_FLAME]: { refer: SpellRefer.FANCY, cost: 4, range: 10, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.WEB]: { refer: SpellRefer.TARGET, cost: 6, range: 8, level: 3, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.RESIST_MAGIC]: { refer: SpellRefer.IMMED, cost: 4, level: 3, select: SpellSelect.ACTIVE, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.POISON]: { refer: SpellRefer.TARGET, cost: 4, range: 8, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.ICE_BOLT]: { refer: SpellRefer.TARGET, cost: 5, range: 12, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SLOW_GROUP]: { refer: SpellRefer.IMMED, cost: 4, range: 12, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT },
  [Spell.MAGIC_MAP]: { refer: SpellRefer.YES, cost: 8, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.CAPTURE_SOUL]: { refer: SpellRefer.TARGET, cost: 30, range: 10, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, targetLock: true },
  [Spell.SIMULACRUM]: { refer: SpellRefer.TARGET, cost: -1, range: 4, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT },
  [Spell.ARROWS_VENOM]: { refer: SpellRefer.FANCY, cost: 8, range: 8, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.WALL_ICE]: { refer: SpellRefer.TARGET, cost: 6, range: 8, level: 4, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.STEALTH]: { refer: SpellRefer.YES, cost: 5, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.HASTE_MAJOR]: { refer: SpellRefer.IMMED, cost: 8, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.FIRESTORM]: { refer: SpellRefer.TARGET, cost: 8, range: 14, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.DISPEL_BARRIER]: { refer: SpellRefer.YES, cost: 6, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.BARRIER_FIRE]: { refer: SpellRefer.TARGET, cost: 9, range: 2, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, targetLock: true },
  [Spell.SUMMON]: { refer: SpellRefer.FANCY, cost: 10, range: 4, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.SHOCKSTORM]: { refer: SpellRefer.TARGET, cost: 6, range: 10, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SPRAY_FIELDS]: { refer: SpellRefer.FANCY, cost: 6, range: 12, level: 5, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.POISON_MAJOR]: { refer: SpellRefer.TARGET, cost: 7, range: 8, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.FEAR_GROUP]: { refer: SpellRefer.IMMED, cost: 6, range: 12, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.KILL]: { refer: SpellRefer.TARGET, cost: 8, range: 6, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.PARALYZE]: { refer: SpellRefer.FANCY, cost: 7, range: 8, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.DEMON]: { refer: SpellRefer.TARGET, cost: 12, range: 5, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.ANTIMAGIC]: { refer: SpellRefer.TARGET, cost: 10, range: 8, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, targetLock: true },
  [Spell.MINDDUEL]: { refer: SpellRefer.TARGET, cost: 12, range: 40, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.FLIGHT]: { refer: SpellRefer.YES, cost: 20, level: 6, type: Skill.MAGE_SPELLS, when: SpellWhen.OUTDOORS, peaceful: true },
  [Spell.SHOCKWAVE]: { refer: SpellRefer.IMMED, cost: 12, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT },
  [Spell.BLESS_MAJOR]: { refer: SpellRefer.IMMED, cost: 8, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.PARALYSIS_MASS]: { refer: SpellRefer.IMMED, cost: 20, range: 8, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT },
  [Spell.PROTECTION]: { refer: SpellRefer.YES, cost: 10, level: 7, select: SpellSelect.ACTIVE, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, peaceful: true },
  [Spell.SUMMON_MAJOR]: { refer: SpellRefer.FANCY, cost: 14, range: 4, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.BARRIER_FORCE]: { refer: SpellRefer.TARGET, cost: 10, range: 2, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, peaceful: true, targetLock: true },
  [Spell.QUICKFIRE]: { refer: SpellRefer.TARGET, cost: 50, range: 4, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, targetLock: true },
  [Spell.ARROWS_DEATH]: { refer: SpellRefer.FANCY, cost: 10, range: 6, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.BLESS_MINOR]: { refer: SpellRefer.IMMED, cost: 1, level: 1, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.HEAL_MINOR]: { refer: SpellRefer.YES, cost: 1, level: 1, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.POISON_WEAKEN]: { refer: SpellRefer.YES, cost: 1, level: 1, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.TURN_UNDEAD]: { refer: SpellRefer.TARGET, cost: 2, range: 8, level: 1, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.LOCATION]: { refer: SpellRefer.YES, cost: 1, level: 1, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.SANCTUARY]: { refer: SpellRefer.YES, cost: 1, level: 1, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.SYMBIOSIS]: { refer: SpellRefer.YES, cost: 3, level: 1, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.MANNA_MINOR]: { refer: SpellRefer.YES, cost: 5, level: 1, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.RITUAL_SANCTIFY]: { refer: SpellRefer.YES, cost: 50, level: 1, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.STUMBLE]: { refer: SpellRefer.TARGET, cost: 1, range: 10, level: 1, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.BLESS]: { refer: SpellRefer.IMMED, cost: 2, level: 2, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.POISON_CURE]: { refer: SpellRefer.YES, cost: 2, level: 2, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.CURSE]: { refer: SpellRefer.TARGET, cost: 2, range: 10, level: 2, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.LIGHT_DIVINE]: { refer: SpellRefer.YES, cost: 2, level: 2, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.WOUND]: { refer: SpellRefer.TARGET, cost: 3, range: 6, level: 2, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SUMMON_SPIRIT]: { refer: SpellRefer.TARGET, cost: 5, range: 4, level: 2, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.MOVE_MOUNTAINS]: { refer: SpellRefer.YES, cost: 8, level: 2, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.CHARM_FOE]: { refer: SpellRefer.TARGET, cost: 6, range: 6, level: 2, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.DISEASE]: { refer: SpellRefer.FANCY, cost: 4, range: 6, level: 2, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.AWAKEN]: { refer: SpellRefer.YES, cost: 2, level: 2, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.HEAL]: { refer: SpellRefer.YES, cost: 3, level: 3, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.HEAL_ALL_LIGHT]: { refer: SpellRefer.YES, cost: 4, level: 3, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.HOLY_SCOURGE]: { refer: SpellRefer.TARGET, cost: 3, range: 8, level: 3, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.DETECT_LIFE]: { refer: SpellRefer.YES, cost: 3, level: 3, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.PARALYSIS_CURE]: { refer: SpellRefer.YES, cost: 3, level: 3, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.MANNA]: { refer: SpellRefer.YES, cost: 10, level: 3, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.FORCEFIELD]: { refer: SpellRefer.TARGET, cost: 5, range: 8, level: 3, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.DISEASE_CURE]: { refer: SpellRefer.YES, cost: 3, level: 3, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.RESTORE_MIND]: { refer: SpellRefer.YES, cost: 4, level: 3, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.SMITE]: { refer: SpellRefer.FANCY, cost: 6, range: 8, level: 3, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.POISON_CURE_ALL]: { refer: SpellRefer.YES, cost: 5, level: 4, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.CURSE_ALL]: { refer: SpellRefer.IMMED, cost: 5, range: 10, level: 4, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT },
  [Spell.DISPEL_UNDEAD]: { refer: SpellRefer.TARGET, cost: 5, range: 8, level: 4, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.CURSE_REMOVE]: { refer: SpellRefer.YES, cost: 15, level: 4, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.STICKS_TO_SNAKES]: { refer: SpellRefer.FANCY, cost: 6, range: 6, level: 4, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.MARTYRS_SHIELD]: { refer: SpellRefer.YES, cost: 5, level: 4, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.CLEANSE]: { refer: SpellRefer.YES, cost: 5, level: 4, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.FIREWALK]: { refer: SpellRefer.YES, cost: 8, level: 4, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.BLESS_PARTY]: { refer: SpellRefer.IMMED, cost: 6, level: 5, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.HEAL_MAJOR]: { refer: SpellRefer.YES, cost: 7, level: 5, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.RAISE_DEAD]: { refer: SpellRefer.YES, cost: 25, level: 5, select: SpellSelect.DEAD, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.FLAMESTRIKE]: { refer: SpellRefer.TARGET, cost: 8, range: 9, level: 5, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SANCTUARY_MASS]: { refer: SpellRefer.YES, cost: 10, level: 5, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.SUMMON_HOST]: { refer: SpellRefer.FANCY, cost: 12, range: 4, level: 5, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.SHATTER]: { refer: SpellRefer.YES, cost: 12, level: 5, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN, peaceful: true },
  [Spell.DISPEL_SPHERE]: { refer: SpellRefer.TARGET, cost: 6, range: 8, level: 5, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN, peaceful: true },
  [Spell.HEAL_ALL]: { refer: SpellRefer.YES, cost: 8, level: 6, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.REVIVE]: { refer: SpellRefer.YES, cost: 7, level: 6, select: SpellSelect.ACTIVE, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.HYPERACTIVITY]: { refer: SpellRefer.YES, cost: 8, level: 6, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.DESTONE]: { refer: SpellRefer.YES, cost: 8, level: 6, select: SpellSelect.STONE, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.SUMMON_GUARDIAN]: { refer: SpellRefer.TARGET, cost: 14, range: 4, level: 6, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.CHARM_MASS]: { refer: SpellRefer.IMMED, cost: 17, range: 8, level: 6, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT },
  [Spell.PROTECTIVE_CIRCLE]: { refer: SpellRefer.IMMED, cost: 8, level: 6, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT },
  [Spell.PESTILENCE]: { refer: SpellRefer.IMMED, cost: 7, range: 8, level: 6, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT },
  [Spell.REVIVE_ALL]: { refer: SpellRefer.YES, cost: 10, level: 7, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.RAVAGE_SPIRIT]: { refer: SpellRefer.TARGET, cost: 10, range: 4, level: 7, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.RESURRECT]: { refer: SpellRefer.YES, cost: 35, level: 7, select: SpellSelect.DEAD, type: Skill.PRIEST_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.DIVINE_THUD]: { refer: SpellRefer.TARGET, cost: 10, range: 12, level: 7, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.AVATAR]: { refer: SpellRefer.IMMED, cost: 12, level: 7, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.WALL_BLADES]: { refer: SpellRefer.TARGET, cost: 12, range: 10, level: 7, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.WORD_RECALL]: { refer: SpellRefer.YES, cost: 30, level: 7, type: Skill.PRIEST_SPELLS, when: SpellWhen.OUTDOORS, peaceful: true },
  [Spell.CLEANSE_MAJOR]: { refer: SpellRefer.YES, cost: 10, level: 7, type: Skill.PRIEST_SPELLS, when: SpellWhen.COMBAT | SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.STRENGTHEN_TARGET]: { refer: SpellRefer.TARGET, range: 10, when: SpellWhen.COMBAT, peaceful: true, targetLock: true },
  [Spell.SUMMON_RAT]: { refer: SpellRefer.TARGET, range: 8, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.WALL_ICE_BALL]: { refer: SpellRefer.TARGET, range: 8, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.GOO_BOMB]: { refer: SpellRefer.TARGET, range: 12, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.FOUL_VAPOR]: { refer: SpellRefer.TARGET, range: 8, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.CLOUD_SLEEP_LARGE]: { refer: SpellRefer.TARGET, range: 10, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.ACID_SPRAY]: { refer: SpellRefer.TARGET, range: 10, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.PARALYZE_BEAM]: { refer: SpellRefer.TARGET, range: 10, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.SLEEP_MASS]: { refer: SpellRefer.TARGET, range: 10, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.RAVAGE_ENEMIES]: { refer: SpellRefer.TARGET, range: 12, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.BLADE_AURA]: { refer: SpellRefer.IMMED, when: SpellWhen.COMBAT },
  [Spell.DISPEL_FIELD]: { refer: SpellRefer.TARGET, range: 10, when: SpellWhen.COMBAT | SpellWhen.TOWN, peaceful: true },
  [Spell.MOVE_MOUNTAINS_MASS]: { refer: SpellRefer.TARGET, range: 8, when: SpellWhen.TOWN, peaceful: true },
  [Spell.WRACK]: { refer: SpellRefer.TARGET, range: 6, level: 1, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.UNHOLY_RAVAGING]: { refer: SpellRefer.TARGET, range: 12, level: 6, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.ICY_RAIN]: { refer: SpellRefer.TARGET, range: 10, when: SpellWhen.COMBAT, targetLock: true },
  [Spell.FLAME_AURA]: { refer: SpellRefer.IMMED, when: SpellWhen.COMBAT },
  [Spell.SUMMON_AID]: { refer: SpellRefer.TARGET, range: 4, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.SUMMON_AID_MAJOR]: { refer: SpellRefer.TARGET, range: 4, when: SpellWhen.COMBAT | SpellWhen.TOWN },
  [Spell.FLASH_STEP]: { refer: SpellRefer.TARGET, range: 8, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.RECHARGE]: { refer: SpellRefer.YES, cost: 50, level: 7, type: Skill.MAGE_SPELLS, when: SpellWhen.TOWN | SpellWhen.OUTDOORS, peaceful: true },
  [Spell.AUGMENTATION]: { refer: SpellRefer.IMMED, range: 10, select: SpellSelect.ACTIVE, when: SpellWhen.COMBAT, peaceful: true },
  [Spell.NIRVANA]: { refer: SpellRefer.IMMED, range: 10, select: SpellSelect.ACTIVE, when: SpellWhen.COMBAT, peaceful: true },
};

/**
 * `isMage` / `isPriest` (spell.hpp:58) — whether a spell is one of the 62 a PC
 * learns and casts from the list. The special spells above those ranges belong
 * to scenario scripting and monsters, and deliberately answer *no* to both.
 */
export function isMage(spell: Spell): boolean {
  return spell >= 0 && spell < NUM_NORMAL_SPELLS;
}

export function isPriest(spell: Spell): boolean {
  return spell >= 100 && spell < 100 + NUM_NORMAL_SPELLS;
}

/**
 * `cSpell::is_priest` — note this asks where the spell is *implemented*, not
 * which skill it needs, so it takes in the special priest spells too.
 */
export function isPriestSide(spell: Spell): boolean {
  return spell >= 100;
}

/** `cSpell::fromNum(type, num)` — the n'th spell on one of the two lists. */
export function spellFromNum(type: Skill, num: number): Spell {
  if (num < 0 || num >= NUM_NORMAL_SPELLS) return Spell.NONE;
  if (type === Skill.MAGE_SPELLS) return num as Spell;
  if (type === Skill.PRIEST_SPELLS) return (num + 100) as Spell;
  return Spell.NONE;
}

/** `cSpell::fromNum(num)` — a raw number, if it names a spell at all. */
export function spellFromRawNum(num: number): Spell {
  return SPELLS[num as Spell] ? (num as Spell) : Spell.NONE;
}

/** `cSpell::name` — the display name, out of the magic-names string table. */
export function spellName(spell: Spell): string {
  if (spell === Spell.NONE) return 'INVALID SPELL';
  return getStr('magic-names', spell + 1);
}
