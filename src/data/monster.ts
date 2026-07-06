/**
 * Monster type data — cMonster core fields from
 * ../exile-wasm/src/scenario/monster.hpp; defaults match cMonster()
 * (monster.cpp:403). Detailed uAbility union semantics are combat-time
 * concerns (M5); abilities are captured losslessly as parsed XML records
 * until then.
 */

export enum Attitude {
  DOCILE = 0,
  HOSTILE_A = 1,
  FRIENDLY = 2,
  HOSTILE_B = 3,
}

export enum MonstTime {
  ALWAYS = 0,
  APPEAR_ON_DAY = 1,
  DISAPPEAR_ON_DAY = 2,
  SOMETIMES_A = 3,
  SOMETIMES_B = 4,
  SOMETIMES_C = 5,
  APPEAR_WHEN_EVENT = 6,
  DISAPPEAR_WHEN_EVENT = 7,
  APPEAR_AFTER_CHOP = 8,
}

export interface Attack {
  dice: number;
  sides: number;
  type: number; // eMonstMelee index into monstMelee tags
}

/** Lossless capture of one <abilities> child until M5 ports uAbility. */
export interface RawAbility {
  element: string; // 'general' | 'missile' | 'summon' | 'radiate' | 'special' | 'invisible' | 'guard'…
  abilType: string; // the type= attribute tag ('' for invisible/guard)
  fields: Record<string, string>;
}

export const NUM_DAMAGE_TYPES = 10; // eDamageType weap..spec (dmgNames)

export interface Monster {
  name: string;
  level: number;
  health: number;
  armor: number;
  skill: number;
  attacks: Attack[]; // up to 3
  race: number; // eRace index into raceNames
  speed: number;
  mu: number;
  cl: number;
  treasure: number;
  abilities: RawAbility[];
  corpseItem: number;
  corpseItemChance: number;
  /** resist[eDamageType] = percent (100 = no resistance). */
  resist: number[];
  mindless: boolean;
  invuln: boolean;
  invisible: boolean;
  guard: boolean;
  amorphous: boolean;
  xWidth: number;
  yWidth: number;
  defaultAttitude: Attitude;
  summonType: number;
  defaultFacialPic: number;
  pictureNum: number;
  ambientSound: number;
  seeSpec: number;
}

export function defaultMonster(): Monster {
  return {
    name: '',
    level: 0,
    health: 0,
    armor: 0,
    skill: 0,
    attacks: [],
    race: 0, // HUMAN
    speed: 4,
    mu: 0,
    cl: 0,
    treasure: 0,
    abilities: [],
    corpseItem: 0,
    corpseItemChance: 0,
    resist: new Array<number>(NUM_DAMAGE_TYPES).fill(100),
    mindless: false,
    invuln: false,
    invisible: false,
    guard: false,
    amorphous: false,
    xWidth: 1,
    yWidth: 1,
    defaultAttitude: Attitude.DOCILE,
    summonType: 0,
    defaultFacialPic: 0,
    pictureNum: 149,
    ambientSound: -1,
    seeSpec: -1,
  };
}
