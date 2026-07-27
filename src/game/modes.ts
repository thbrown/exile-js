/**
 * Game mode state machine — eGameMode from boe.consts.hpp:16, kept flat and
 * in the original order because a great deal of logic compares modes by
 * range (`> MODE_OUTDOORS && < MODE_COMBAT` means "some town mode").
 */

export enum GameMode {
  OUTDOORS = 0,
  // Town modes
  TOWN,
  TALK_TOWN,
  TOWN_TARGET,
  ITEM_TARGET,
  USE_TOWN,
  DROP_TOWN,
  BASH_TOWN,
  PICK_TOWN,
  // Combat modes
  COMBAT,
  SPELL_TARGET,
  FIRING,
  THROWING,
  FANCY_TARGET,
  DROP_COMBAT,
  // Other modes
  TALKING,
  SHOPPING,
  LOOK_OUTDOORS,
  LOOK_TOWN,
  LOOK_COMBAT,
  STARTUP,
  RESTING,
}

/**
 * Where the party physically is while a conversation or a shop is on screen:
 * both modes stash the mode they interrupted, and is_out/is_town ask *that*
 * question instead (boe.locutils.cpp:44 swaps the two and recurses).
 */
export interface PreModes {
  shop: GameMode;
  talk: GameMode;
}

function unwrap(mode: GameMode, pre?: PreModes): GameMode {
  if (!pre) return mode;
  // A shop opened from a conversation nests one level, so keep unwrapping.
  for (let i = 0; i < 4; i++) {
    if (mode === GameMode.SHOPPING) mode = pre.shop;
    else if (mode === GameMode.TALKING) mode = pre.talk;
    else break;
  }
  return mode;
}

/** is_out (boe.locutils.cpp:44). */
export function isOut(mode: GameMode, pre?: PreModes): boolean {
  const m = unwrap(mode, pre);
  return m === GameMode.OUTDOORS || m === GameMode.LOOK_OUTDOORS;
}

/** is_town (boe.locutils.cpp:60) */
export function isTown(mode: GameMode, pre?: PreModes): boolean {
  const m = unwrap(mode, pre);
  return (m > GameMode.OUTDOORS && m < GameMode.COMBAT) || m === GameMode.LOOK_TOWN;
}

/** is_combat (boe.locutils.cpp:76) */
export function isCombat(mode: GameMode): boolean {
  return (mode >= GameMode.COMBAT && mode < GameMode.TALKING) || mode === GameMode.LOOK_COMBAT;
}

/**
 * `scrollableModes` (boe.consts.hpp:44) — the modes in which the view can be
 * scrolled away from the party: while aiming something, or while looking. The
 * pointing arrows are drawn in exactly these modes, and clicking the border
 * around the terrain grid shifts the centre.
 *
 * Note **TOWN_TARGET is not in the set**: a town spell can't scroll the view.
 * This port's Look is a pending flag rather than a mode, so LOOK_TOWN and
 * LOOK_COMBAT are listed for fidelity but never actually reached yet.
 */
const SCROLLABLE_MODES = new Set<GameMode>([
  GameMode.SPELL_TARGET,
  GameMode.FIRING,
  GameMode.THROWING,
  GameMode.FANCY_TARGET,
  GameMode.LOOK_COMBAT,
  GameMode.LOOK_TOWN,
]);

export function isScrollable(mode: GameMode): boolean {
  return SCROLLABLE_MODES.has(mode);
}
