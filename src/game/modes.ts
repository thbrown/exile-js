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

/** is_out (boe.locutils.cpp:44) — shopping delegates to the pre-shop mode. */
export function isOut(mode: GameMode): boolean {
  return mode === GameMode.OUTDOORS || mode === GameMode.LOOK_OUTDOORS;
}

/** is_town (boe.locutils.cpp:60) */
export function isTown(mode: GameMode): boolean {
  return (
    (mode > GameMode.OUTDOORS && mode < GameMode.COMBAT) || mode === GameMode.LOOK_TOWN
  );
}

/** is_combat (boe.locutils.cpp:76) */
export function isCombat(mode: GameMode): boolean {
  return (mode >= GameMode.COMBAT && mode < GameMode.TALKING) || mode === GameMode.LOOK_COMBAT;
}
