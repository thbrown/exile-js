/**
 * Field graphics — the sprite each space-content type draws, from draw_fields
 * (boe.graphutil.cpp:379).
 *
 * The draw order there is deliberate and is preserved here: decals on the floor
 * first, then the permanent things standing in the space (crates, webs,
 * barriers), then the transient magical walls and clouds, and finally the
 * special-encounter marker, which is non-diegetic and always visible.
 */

import { FieldType } from '../data/fields';

/** Where a field's sprite sits on fields.png, as calc_rect(column, row). */
export interface FieldSprite {
  col: number;
  row: number;
  /** Barriers animate out of teranim.png instead. */
  animated?: boolean;
}

/** Floor decals, drawn under everything (fields.png row 3). */
export const SFX_SPRITES: [FieldType, FieldSprite][] = [
  [FieldType.SFX_SMALL_BLOOD, { col: 0, row: 3 }],
  [FieldType.SFX_MEDIUM_BLOOD, { col: 1, row: 3 }],
  [FieldType.SFX_LARGE_BLOOD, { col: 2, row: 3 }],
  [FieldType.SFX_SMALL_SLIME, { col: 3, row: 3 }],
  [FieldType.SFX_LARGE_SLIME, { col: 4, row: 3 }],
  [FieldType.SFX_ASH, { col: 5, row: 3 }],
  [FieldType.SFX_BONES, { col: 6, row: 3 }],
  [FieldType.SFX_RUBBLE, { col: 7, row: 3 }],
];

/** Things occupying the space, more or less permanently. */
export const SOLID_SPRITES: [FieldType, FieldSprite][] = [
  [FieldType.OBJECT_CRATE, { col: 6, row: 0 }],
  [FieldType.OBJECT_BARREL, { col: 7, row: 0 }],
  [FieldType.OBJECT_BLOCK, { col: 3, row: 0 }],
  [FieldType.FIELD_WEB, { col: 5, row: 0 }],
  [FieldType.BARRIER_FIRE, { col: 8, row: 4, animated: true }],
  [FieldType.BARRIER_FORCE, { col: 8, row: 4, animated: true }],
  [FieldType.FIELD_QUICKFIRE, { col: 7, row: 1 }],
  [FieldType.BARRIER_CAGE, { col: 1, row: 0 }],
];

/** The magical walls and clouds a fight throws around. */
export const TRANSIENT_SPRITES: [FieldType, FieldSprite][] = [
  [FieldType.WALL_FORCE, { col: 0, row: 1 }],
  [FieldType.WALL_FIRE, { col: 1, row: 1 }],
  [FieldType.WALL_ICE, { col: 4, row: 1 }],
  [FieldType.WALL_BLADES, { col: 5, row: 1 }],
  [FieldType.FIELD_ANTIMAGIC, { col: 2, row: 1 }],
  [FieldType.CLOUD_STINK, { col: 3, row: 1 }],
  [FieldType.CLOUD_SLEEP, { col: 6, row: 1 }],
];

/** The white special-encounter marker, drawn last so nothing hides it. */
export const SPECIAL_SPOT_SPRITE: FieldSprite = { col: 4, row: 0 };
