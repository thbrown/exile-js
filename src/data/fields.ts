/**
 * Field/space-content types — eFieldType from ../exile-wasm/src/fields.hpp.
 * Values are part of the .map file format; keep them verbatim.
 */

export enum FieldType {
  SPECIAL_EXPLORED = 0,
  WALL_FORCE = 1,
  WALL_FIRE = 2,
  FIELD_ANTIMAGIC = 3,
  CLOUD_STINK = 4,
  WALL_ICE = 5,
  WALL_BLADES = 6,
  CLOUD_SLEEP = 7,
  OBJECT_BLOCK = 8,
  SPECIAL_SPOT = 9,
  FIELD_WEB = 10,
  OBJECT_CRATE = 11,
  OBJECT_BARREL = 12,
  BARRIER_FIRE = 13,
  BARRIER_FORCE = 14,
  FIELD_QUICKFIRE = 15,
  SFX_SMALL_BLOOD = 16,
  SFX_MEDIUM_BLOOD = 17,
  SFX_LARGE_BLOOD = 18,
  SFX_SMALL_SLIME = 19,
  SFX_LARGE_SLIME = 20,
  SFX_ASH = 21,
  SFX_BONES = 22,
  SFX_RUBBLE = 23,
  BARRIER_CAGE = 24,
  SPECIAL_ROAD = 25,
  FIELD_DISPEL = 32,
  FIELD_SMASH = 33,
}

/** The transient magical fields a Dispel Fields clears (dispel_fields). */
export const DISPELLABLE: FieldType[] = [
  FieldType.WALL_FORCE, FieldType.WALL_FIRE, FieldType.WALL_ICE, FieldType.WALL_BLADES,
  FieldType.CLOUD_STINK, FieldType.CLOUD_SLEEP, FieldType.FIELD_ANTIMAGIC,
  FieldType.FIELD_QUICKFIRE, FieldType.FIELD_WEB,
];

/** The permanent barriers, which only a stronger dispel removes. */
export const BARRIERS: FieldType[] = [
  FieldType.BARRIER_FIRE, FieldType.BARRIER_FORCE, FieldType.BARRIER_CAGE,
];

/** The decals a fight leaves behind; drawn under everything else. */
export const SFX_FIELDS: FieldType[] = [
  FieldType.SFX_SMALL_BLOOD, FieldType.SFX_MEDIUM_BLOOD, FieldType.SFX_LARGE_BLOOD,
  FieldType.SFX_SMALL_SLIME, FieldType.SFX_LARGE_SLIME,
  FieldType.SFX_ASH, FieldType.SFX_BONES, FieldType.SFX_RUBBLE,
];
