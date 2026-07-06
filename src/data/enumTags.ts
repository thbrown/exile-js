/**
 * Enum ↔ string-tag tables from ../exile-wasm/src/fileio/estreams.cpp
 * (cEnumLookup): the array index IS the enum's numeric value.
 */

export const terTypes = [
  'none', 'step-change', 'dmg', 'bridge', 'bed', 'danger', '', 'fragile', 'lock', 'unlock',
  '', 'sign', 'step-spec', '', 'box', 'wild-cave', 'wild-wood', 'falls-cave', 'falls-mntn', 'belt',
  'monst-block', 'town', 'use-change', 'use-spec',
] as const;

export const terTrims = [
  'none', 'wall', 's', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw',
  'ne-inner', 'se-inner', 'sw-inner', 'nw-inner', 'frills', 'road', 'walkway', 'waterfall', 'city',
] as const;

export const terBlocks = [
  'none', 'sight', 'monsters', 'move', 'move-and-shoot', 'move-and-sight',
] as const;

export const stepSounds = ['step', 'squish', 'crunch', 'none', 'splash'] as const;

export const lightTypes = ['lit', 'dark', 'drains', 'none'] as const;

/**
 * readEnum: tag string → numeric enum value. Throws on unknown tags, like
 * the C++ stream operators setting failbit.
 */
export function readEnumTag(tags: readonly string[], value: string, what: string): number {
  const idx = tags.indexOf(value);
  if (idx < 0) throw new Error(`unknown ${what} tag '${value}'`);
  return idx;
}
