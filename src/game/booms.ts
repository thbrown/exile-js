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
import { animAt, paced } from './anim';

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

/**
 * How long a boom stays on screen. The C++ sleeps 300ms in the WASM build.
 * `boomMs()` is that stretched by the play-testing pace: a damage number that
 * vanishes before the pause after it is over is one you can't read, so this
 * has to slow down with the rest of the turn.
 */
export const BOOM_MS = 300;

export function boomMs(): number {
  return paced(BOOM_MS);
}

export interface Boom {
  where: Location;
  /** 0..6 — the column in booms.png (boom_gr's value for the damage type). */
  type: number;
  /** Printed over the sprite; 0 prints nothing. */
  damage: number;
  /** The sound *file* to play with it; 0 for none. */
  sound: number;
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
 * `boom_anim_active` (boe.main.cpp:190) — true while a volley of missiles and
 * explosions is being assembled.
 *
 * This is the piece that keeps a spell's explosion from appearing before its
 * projectile. In the C++, `boom_space` returns immediately while the flag is
 * set (boe.graphics.cpp:1506) and the damage routines queue an `add_explosion`
 * instead; the whole set is then played by `do_explosion_anim` *after*
 * `do_missile_anim` has flown the missiles. Without it, a spell that damages
 * inside its own arm — Fireball, and the whole single-target family, whose
 * `add_missile` comes after the switch — booms at cast time and only then
 * launches.
 */
let volleyOpen = false;
let queued: Boom[] = [];

/** Whether a volley is open, so damage should be marked rather than dealt. */
export function boomAnimActive(): boolean {
  return volleyOpen;
}

/** start_missile_anim (boe.newgraph.cpp:258) — open a volley. */
export function startBoomAnim(): void {
  volleyOpen = true;
  queued = [];
}

/**
 * do_explosion_anim (boe.newgraph.cpp:556) — close the volley and play
 * everything it collected, now that the missiles have landed.
 */
export function runBoomAnim(): void {
  const toPlay = queued;
  volleyOpen = false;
  queued = [];
  // `animAt()` is read now, so these sit after whatever the missiles booked.
  const starts = animAt();
  for (const boom of toPlay) {
    if (boom.sound > 0) livingSound(boom.sound);
    if (boom.type < 0 || boom.type > 6) continue;
    sink?.({ ...boom, starts, expires: starts + boomMs() });
  }
}

/**
 * boom_space — show a hit on `where` and play its sound. `soundType` is an
 * index into SOUND_LOOKUP unless it's negative, in which case it's a file.
 */
export function boomSpace(
  where: Location, type: number, damage: number, soundType: number,
): void {
  if (volleyOpen) {
    const file = soundType < 0 ? -soundType : (SOUND_LOOKUP[soundType] ?? 0);
    // add_explosion (boe.newgraph.cpp:320) drops a second explosion on a square
    // that already has one, but takes the larger damage number, and holds 30.
    const already = queued.find((b) => b.where.x === where.x && b.where.y === where.y);
    if (already) {
      if (damage > already.damage) already.damage = damage;
      return;
    }
    if (queued.length >= 30) return;
    queued.push({
      where: { ...where }, type, damage, sound: file, starts: 0, expires: 0,
    });
    return;
  }
  const file = soundType < 0 ? -soundType : (SOUND_LOOKUP[soundType] ?? 0);
  // The sound is raised here, as the C++ does, but the *host* decides when it
  // is actually heard — see the sink in main.ts. The C++ gets the timing for
  // free by sleeping through the missile's flight, so `boom_space` isn't even
  // reached until the thing has landed.
  if (file > 0) livingSound(file);
  if (type < 0 || type > 6) return;
  // A hit shows at the front of the queue rather than booking its own slot:
  // several blows in one turn land together, but a hit that follows a missile
  // still waits for the missile to arrive.
  const starts = animAt();
  sink?.({ where: { ...where }, type, damage, sound: file, starts, expires: starts + boomMs() });
}
