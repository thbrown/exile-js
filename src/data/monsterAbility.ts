/**
 * uAbility — the monster ability union from
 * ../exile-wasm/src/scenario/monster_abilities.hpp:83, and the enums around
 * it. Replaces the lossless `RawAbility` capture the parser used up to M5a.
 *
 * The C++ is a genuine union: `missile`, `gen`, `summon`, `radiate` and
 * `special` share storage, and which one is live is decided by the *key* the
 * ability is filed under, through `getMonstAbilCategory`. TypeScript has no
 * unions over storage, so each group is its own object here and only the one
 * the category names is meaningful. `abilityCategory(key)` is the single place
 * that decision is made, exactly as in the C++.
 *
 * A monster's abilities are an array indexed by `MonstAbil`, so
 * `mon.abil[MonstAbil.SPLITS].active` reads the same as
 * `monst.abil[eMonstAbil::SPLITS].active` does there.
 */

/** eMonstAbil (monster_abilities.hpp:20) — the ability slots, in order. */
export enum MonstAbil {
  NO_ABIL = 0,
  MISSILE = 1,

  DAMAGE = 2,
  STATUS = 3,
  FIELD = 4,
  PETRIFY = 5,
  DRAIN_SP = 6,
  DRAIN_XP = 7,
  KILL = 8,
  STEAL_FOOD = 9,
  STEAL_GOLD = 10,
  STUN = 11,
  DAMAGE2 = 12,
  STATUS2 = 13,

  SPLITS = 14,
  MARTYRS_SHIELD = 15,
  ABSORB_SPELLS = 16,
  MISSILE_WEB = 17,
  RAY_HEAT = 18,
  SPECIAL = 19,
  HIT_TRIGGER = 20,
  DEATH_TRIGGER = 21,

  RADIATE = 22,
  SUMMON = 23,
}

/** How many slots a monster carries — one per eMonstAbil. */
export const NUM_MONST_ABIL = 24;

/** eMonstMissile — which projectile graphic and sound a shot uses. */
export enum MonstMissile {
  DART = 0, ARROW = 1, SPEAR = 2, ROCK = 3, RAZORDISK = 4,
  SPINE = 5, KNIFE = 6, BOLT = 7, BOULDER = 8, RAPID_ARROW = 9,
}

/** eMonstGen — how a general ability reaches its target. */
export enum MonstGen {
  RAY = 0, TOUCH = 1, GAZE = 2, BREATH = 3, SPIT = 4,
}

/** eMonstSummon — what the `what` field of a summon means. */
export enum MonstSummon {
  TYPE = 0, LEVEL = 1, SPECIES = 2,
}

/** eSpellPat (pattern.hpp:14) — the shape an effect covers. */
export enum SpellPat {
  SINGLE = 0,
  SQUARE = 1,
  SMALL_SQUARE = 2,
  OPEN_SQUARE = 3,
  RADIUS_2 = 4,
  RADIUS_3 = 5,
  PLUS = 6,
  WALL = 7,
  /** PAT_WALL + 8 — the eight protective-wall variants sit in between. */
  PROT = 15,
  CUSTOM = 16,
  CURRENT = -1,
}

/** eMonstAbilCat — which arm of the union a key selects. */
export enum MonstAbilCat {
  INVALID = 0, MISSILE = 1, GENERAL = 2, SUMMON = 3, RADIATE = 4, SPECIAL = 5,
}

/**
 * getMonstAbilCategory (monster_abilities.hpp:46). The range comparisons
 * depend on the enum order — don't reshuffle `MonstAbil`.
 */
export function abilityCategory(what: MonstAbil): MonstAbilCat {
  if (what === MonstAbil.NO_ABIL) return MonstAbilCat.SPECIAL;
  if (what === MonstAbil.MISSILE) return MonstAbilCat.MISSILE;
  if (what >= MonstAbil.DAMAGE && what <= MonstAbil.STATUS2) return MonstAbilCat.GENERAL;
  if (what >= MonstAbil.SPLITS && what <= MonstAbil.DEATH_TRIGGER) return MonstAbilCat.SPECIAL;
  if (what === MonstAbil.RADIATE) return MonstAbilCat.RADIATE;
  if (what === MonstAbil.SUMMON) return MonstAbilCat.SUMMON;
  return MonstAbilCat.INVALID;
}

export interface MissileAbility {
  type: MonstMissile;
  /** miss_num_t — index into missiles.png. */
  pic: number;
  dice: number;
  sides: number;
  skill: number;
  range: number;
  /** Chance in tenths of a percent: the XML's percentage times 10. */
  odds: number;
}

export interface GeneralAbility {
  type: MonstGen;
  pic: number;
  strength: number;
  range: number;
  odds: number;
  /**
   * The union's third arm: an `eDamageType` for DAMAGE/DAMAGE2, an `eStatus`
   * for STATUS/STATUS2/STUN, and an `eFieldType` for FIELD. Which one it is
   * follows from the key, so it's one number here as it is one union there.
   */
  extra: number;
}

export interface SummonAbility {
  type: MonstSummon;
  /** A monster number, a level or an eRace, per `type`. */
  what: number;
  min: number;
  max: number;
  /** How many turns the summons stick around. */
  len: number;
  chance: number;
}

export interface RadiateAbility {
  /** eFieldType. */
  type: number;
  chance: number;
  pat: SpellPat;
}

export interface SpecialAbility {
  extra1: number;
  extra2: number;
  extra3: number;
}

export interface Ability {
  active: boolean;
  missile: MissileAbility;
  gen: GeneralAbility;
  summon: SummonAbility;
  radiate: RadiateAbility;
  special: SpecialAbility;
}

export function defaultAbility(): Ability {
  return {
    active: false,
    missile: {
      type: MonstMissile.DART, pic: 0, dice: 0, sides: 0, skill: 0, range: 0, odds: 0,
    },
    // `extra` starts at 0, which reads as eDamageType::WEAPON — the union's zero.
    gen: { type: MonstGen.TOUCH, pic: 0, strength: 0, range: 0, odds: 0, extra: 0 },
    summon: { type: MonstSummon.TYPE, what: 0, min: 0, max: 0, len: 0, chance: 0 },
    // "Default radiate pattern is 3x3 square" (readMonstAbilFromXml).
    radiate: { type: 0, chance: 0, pat: SpellPat.SQUARE },
    special: { extra1: 0, extra2: 0, extra3: 0 },
  };
}

/** A fresh, all-inactive ability table for one monster. */
export function defaultAbilities(): Ability[] {
  return Array.from({ length: NUM_MONST_ABIL }, () => defaultAbility());
}

/**
 * uAbility::get_ap_cost (monster.cpp:758) — what using this ability costs a
 * monster out of its action points. A **touch** ability costs -1: it rides
 * along with the melee attack rather than taking a turn of its own. An unknown
 * key is -256, which is the C++'s way of saying "never affordable".
 */
export function abilityApCost(key: MonstAbil, abil: Ability): number {
  switch (key) {
    case MonstAbil.MISSILE:
      switch (abil.missile.type) {
        case MonstMissile.ARROW:
        case MonstMissile.BOLT:
        case MonstMissile.SPINE:
        case MonstMissile.BOULDER:
          return 3;
        default:
          return 2;
      }
    case MonstAbil.RAY_HEAT:
      return 1;
    case MonstAbil.DAMAGE2:
      return 4;
    case MonstAbil.DAMAGE:
    case MonstAbil.STATUS:
    case MonstAbil.STATUS2:
    case MonstAbil.STUN:
    case MonstAbil.FIELD:
    case MonstAbil.PETRIFY:
    case MonstAbil.DRAIN_SP:
    case MonstAbil.DRAIN_XP:
    case MonstAbil.KILL:
    case MonstAbil.STEAL_FOOD:
    case MonstAbil.STEAL_GOLD:
      return abil.gen.type === MonstGen.TOUCH ? -1 : 3;
    case MonstAbil.MISSILE_WEB:
      return 3;
    case MonstAbil.SPECIAL:
      return abil.special.extra2;
    case MonstAbil.ABSORB_SPELLS:
    case MonstAbil.DEATH_TRIGGER:
    case MonstAbil.HIT_TRIGGER:
    case MonstAbil.MARTYRS_SHIELD:
    case MonstAbil.RADIATE:
    case MonstAbil.SPLITS:
    case MonstAbil.SUMMON:
      return 0;
    default:
      return -256;
  }
}
