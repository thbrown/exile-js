/**
 * `boom_space` (boe.graphics.cpp) — the hit animation: an explosion sprite over
 * the square that was hit, the damage number printed on top of it, and the
 * sound.
 *
 * **The numbers passed around here are sound *types*, not sound files.** A
 * damage type maps to a type via `get_sound_type` or `get_monst_sound`, and
 * only `SOUND_LOOKUP` turns that into a file. Playing the type directly is how
 * a rat's bite ends up sounding like a cash register.
 *
 * The C++ draws the sprite, plays the sound and then sleeps. This port can't
 * block, so the request goes to a sink the renderer owns: it keeps each boom
 * for `BOOM_MS` and redraws until they've all expired. Same thing on screen,
 * no blocking.
 */

import { Location } from '../core/location';
import { livingSound } from '../universe/living';
import { animAt } from './anim';

/**
 * sound_lookup (boom_space) — sound type to sound file. A *negative* sound
 * passed to boom_space skips the table and is played directly, which is how the
 * C++ smuggles a specific file through.
 */
const SOUND_LOOKUP = [
  97, 69, 70, 71, 72,
  73, 55, 75, 42, 86,
  87, 88, 89, 98, 0,
  0, 0, 0, 0, 0,
];

/** How long a boom stays on screen. The C++ sleeps 300ms in the WASM build. */
export const BOOM_MS = 300;

export interface Boom {
  where: Location;
  /** 0..6 — the column in booms.png (boom_gr's value for the damage type). */
  type: number;
  /** Printed over the sprite; 0 prints nothing. */
  damage: number;
  /** When this boom appears, on the shared animation timeline. */
  starts: number;
  /** When it stops being drawn. */
  expires: number;
}

let sink: ((boom: Boom) => void) | null = null;

export function setBoomSink(fn: ((boom: Boom) => void) | null): void {
  sink = fn;
}

/**
 * boom_space — show a hit on `where` and play its sound. `soundType` is an
 * index into SOUND_LOOKUP unless it's negative, in which case it's a file.
 */
export function boomSpace(
  where: Location, type: number, damage: number, soundType: number,
): void {
  const file = soundType < 0 ? -soundType : (SOUND_LOOKUP[soundType] ?? 0);
  if (file > 0) livingSound(file);
  if (type < 0 || type > 6) return;
  // A hit shows at the front of the queue rather than booking its own slot:
  // several blows in one turn land together, but a hit that follows a missile
  // still waits for the missile to arrive.
  const starts = animAt();
  sink?.({ where: { ...where }, type, damage, starts, expires: starts + BOOM_MS });
}
