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
 * The C++ draws the sprite, plays the sound and then **sleeps** — 300ms in the
 * WASM build (boe.graphics.cpp:1594) — so nothing else happens until the blast
 * has been seen. This port can't block, so the request goes to a sink the
 * renderer owns and the blast **books its slot on the shared timeline**: that
 * is what makes a caller sitting in `animSettle` wait for it, which is the
 * nearest thing to the sleep. Two hits in one turn play one after the other,
 * as they do in the original, rather than both at once.
 *
 * A *volley* is the exception, and matches `do_explosion_anim`: everything it
 * collected is drawn together over one animation, so it books one slot between
 * the lot of them.
 */

import { Location } from '../core/location';
import { GameRng } from '../core/rng';
import { livingSound } from '../universe/living';
import { animBook, paced } from './anim';

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

/**
 * `boom_type_sound` (do_explosion_anim, boe.newgraph.cpp:562) — **a different
 * table from `SOUND_LOOKUP` above**, indexed by *boom type* rather than sound
 * type, and the source of the one noise a whole volley makes. Playing a
 * volley's explosions through `boom_space`'s table instead is why a fireball
 * used to land with the wrong sound.
 */
const BOOM_TYPE_SOUND = [5, 10, 53, 53, 53, 75];

export interface Boom {
  where: Location;
  /**
   * Which explosion, from `boom_gr`. For a single hit it is the column of the
   * one-frame sprite in row 0 of booms.png; for a volley's explosion it picks
   * the *row* instead — see `animated`.
   */
  type: number;
  /** Printed over the sprite; 0 prints nothing. */
  damage: number;
  /** The sound *file* to play with it; 0 for none. */
  sound: number;
  /** When this boom appears, on the shared animation timeline. */
  starts: number;
  /** When it stops being drawn. */
  expires: number;
  /**
   * True for a volley's explosion: `do_explosion_anim` plays **eight frames**
   * out of row `1 + type` of booms.png, where `boom_space` draws a single
   * frame from row 0. The sheet holds both — one row of hit sprites and six
   * rows of animation — and this port only ever drew the first, which is why
   * a fireball's blast looked like a melee hit.
   */
  animated: boolean;
  /**
   * `store_booms[i].offset` — 0 for the first explosion of a volley and
   * -1 or -2 for the rest, so a dozen of them don't pulse in lockstep.
   */
  offset: number;
  /** Pixel nudges: a big creature's centre, and place_type 1's scatter. */
  xAdj: number;
  yAdj: number;
  /**
   * `place_type` — 1 scatters the explosion up to 25px off its square, which
   * is what the fireball's own blast at the centre of the burn uses. The roll
   * happens when the volley plays, not when it is queued.
   */
  placeType: number;
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
export function runBoomAnim(rng?: GameRng): void {
  const toPlay = queued;
  volleyOpen = false;
  queued = [];
  if (toPlay.length === 0) return;
  // One slot for the whole volley: `do_explosion_anim` draws every explosion
  // it collected in the same frames and sleeps once, so they land together —
  // after whatever the missiles booked, and before whatever comes next.
  const starts = animBook(boomMs());
  // `place_type == 1` scatters an explosion around its square, rolled here
  // (the C++ does it in the set-up loop of `do_explosion_anim`, before the
  // sound), which is what keeps the ordering of these two rolls per explosion.
  for (const boom of toPlay) {
    if (boom.placeType === 1 && rng) {
      boom.xAdj += rng.getRan(1, 0, 50) - 25;
      boom.yAdj += rng.getRan(1, 0, 50) - 25;
    }
  }
  // **One sound for the volley**, from `boom_type_sound` and the *last*
  // explosion's type — `cur_boom_type` is left holding whatever the set-up
  // loop saw last. A type of 6 or more finds nothing in the table and the C++
  // then plays `play_sound(-1 * -1)`, i.e. file 1; ported as written.
  const curBoomType = toPlay[toPlay.length - 1]!.type;
  const file = curBoomType < 6 ? (BOOM_TYPE_SOUND[curBoomType] ?? 1) : 1;
  if (file > 0) livingSound(file);
  for (const boom of toPlay) {
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
  rng?: GameRng,
  options: { placeType?: number; xAdj?: number; yAdj?: number; uniqueRan?: boolean } = {},
): void {
  const { placeType = 0, xAdj = 0, yAdj = 0, uniqueRan = false } = options;
  if (volleyOpen) {
    // add_explosion (boe.newgraph.cpp:320) drops a second explosion on a square
    // that already has one, but takes the larger damage number, and holds 30.
    // It raises **no sound of its own** — the volley makes one noise, in
    // `runBoomAnim` — and it is the animated explosion, not a hit sprite.
    const already = queued.find((b) => b.where.x === where.x && b.where.y === where.y);
    if (already) {
      if (damage > already.damage) already.damage = damage;
      return;
    }
    if (queued.length >= 30) return;
    // `offset = (i == 0) ? 0 : -1 * get_ran(1,0,2,use_unique_ran)`. The roll is
    // part of the sequence, and it comes *after* the two early-outs above.
    const offset = queued.length === 0 || !rng ? 0 : -rng.getRan(1, 0, 2, uniqueRan);
    queued.push({
      where: { ...where }, type, damage, sound: 0, starts: 0, expires: 0,
      animated: true, offset, xAdj, yAdj, placeType,
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
  // A hit takes a slot of its own, because `boom_space` sleeps for its whole
  // length: a second blow in the same turn follows the first rather than
  // landing on top of it, and anything waiting on the timeline — the rest of
  // the monster's turn, the party-death announcement — waits for the blast.
  const starts = animBook(boomMs());
  sink?.({
    where: { ...where }, type, damage, sound: file, starts, expires: starts + boomMs(),
    animated: false, offset: 0, xAdj, yAdj, placeType,
  });
}
