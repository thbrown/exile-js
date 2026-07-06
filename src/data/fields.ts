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
