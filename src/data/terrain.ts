/**
 * Terrain type definition — cTerrain from
 * ../exile-wasm/src/scenario/terrain.hpp (defaults match the C++ member
 * initializers) and terrain_abilities.hpp enums.
 */

export enum TerSpec {
  NONE = 0,
  CHANGE_WHEN_STEP_ON = 1,
  DAMAGING = 2,
  BRIDGE = 3,
  BED = 4,
  DANGEROUS = 5,
  UNUSED1 = 6,
  CRUMBLING = 7,
  LOCKABLE = 8,
  UNLOCKABLE = 9,
  UNUSED2 = 10,
  IS_A_SIGN = 11,
  CALL_SPECIAL = 12,
  UNUSED3 = 13,
  IS_A_CONTAINER = 14,
  WILDERNESS_CAVE = 15,
  WILDERNESS_SURFACE = 16,
  WATERFALL_CAVE = 17,
  WATERFALL_SURFACE = 18,
  CONVEYOR = 19,
  BLOCKED_TO_MONSTERS = 20,
  TOWN_ENTRANCE = 21,
  CHANGE_WHEN_USED = 22,
  CALL_SPECIAL_WHEN_USED = 23,
}

export enum TerObstruct {
  CLEAR = 0,
  BLOCK_SIGHT = 1,
  BLOCK_MONSTERS = 2,
  BLOCK_MOVE = 3,
  BLOCK_MOVE_AND_SHOOT = 4,
  BLOCK_MOVE_AND_SIGHT = 5,
}

export enum TrimType {
  NONE = 0,
  WALL = 1,
  S = 2,
  SE = 3,
  E = 4,
  NE = 5,
  N = 6,
  NW = 7,
  W = 8,
  SW = 9,
  NE_INNER = 10,
  SE_INNER = 11,
  SW_INNER = 12,
  NW_INNER = 13,
  FRILLS = 14,
  ROAD = 15,
  WALKWAY = 16,
  WATERFALL = 17,
  CITY = 18,
}

export enum StepSound {
  STEP = 0,
  SQUISH = 1,
  CRUNCH = 2,
  NONE = 3,
  SPLASH = 4,
}

export interface Terrain {
  name: string;
  picture: number;
  blockage: TerObstruct;
  flag1: number;
  flag2: number;
  flag3: number;
  special: TerSpec;
  transToWhat: number;
  flyOver: boolean;
  boatOver: boolean;
  blockHorse: boolean;
  isArchetype: boolean;
  lightRadius: number;
  stepSound: StepSound;
  shortcutKey: string;
  objNum: number;
  groundType: number;
  trimType: TrimType;
  trimTer: number;
  frillFor: number;
  frillChance: number;
  combatArena: number;
  objPos: { x: number; y: number };
  objSize: { x: number; y: number };
  mapPic: number;
}

export function defaultTerrain(): Terrain {
  return {
    name: '',
    picture: 0,
    blockage: TerObstruct.CLEAR,
    flag1: -1,
    flag2: 0,
    flag3: 0,
    special: TerSpec.NONE,
    transToWhat: 0,
    flyOver: false,
    boatOver: false,
    blockHorse: false,
    isArchetype: false,
    lightRadius: 0,
    stepSound: StepSound.STEP,
    shortcutKey: '',
    objNum: 0,
    groundType: 0,
    trimType: TrimType.NONE,
    trimTer: 0,
    frillFor: -1,
    frillChance: 0,
    combatArena: 0,
    objPos: { x: 0, y: 0 },
    objSize: { x: 0, y: 0 },
    mapPic: -1,
  };
}

/** blocksMove() from terrain.cpp. */
export function blocksMove(ter: Terrain): boolean {
  return (
    ter.blockage === TerObstruct.BLOCK_MOVE ||
    ter.blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT ||
    ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT
  );
}
