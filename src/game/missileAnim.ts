/**
 * `run_a_missile` (boe.newgraph.cpp:297) — the projectile that flies across the
 * terrain view: an arrow, a spear, a web, a ray, a gout of breath.
 *
 * The C++ is `start_missile_anim` / `add_missile` / `do_missile_anim` /
 * `end_missile_anim`, and `do_missile_anim` **blocks**, stepping the sprite
 * along its path and sleeping a couple of milliseconds per step before the shot
 * resolves. This port can't block, so it uses the same arrangement `booms.ts`
 * uses: the request goes to a sink the renderer owns, which keeps the missile
 * for its flight time and redraws until it lands. Same thing on screen, and the
 * shot resolves at once rather than after the flight — the one visible
 * difference is that the hit's explosion pops while the arrow is still in the
 * air.
 *
 * Not ported with it: the mid-flight camera move (`camera_dest`, the
 * `recentered` branch), which follows a missile that leaves the view. Our
 * terrain view doesn't scroll during an animation, so a missile that flies off
 * the edge is simply clipped there.
 */

import { Location } from '../core/location';
import { livingSound } from '../universe/living';

/**
 * How long a missile takes to cross, in ms. The C++ sleeps
 * `2 + 5 * GameSpeed` per step over `num_steps` steps, so at the default speed
 * a 100-step shot is about 200ms.
 */
export const MISSILE_MS = 200;

/** One missile in flight. `store_missiles[i]` in the C++. */
export interface Missile {
  from: Location;
  dest: Location;
  /**
   * The row in missiles.png. Types 0-6 are directional (the column is the
   * heading); 7 and up are animated (the column cycles with the step).
   */
  type: number;
  /** 0 = straight, 1 = a lobbed arc. */
  pathType: number;
  xAdj: number;
  yAdj: number;
  /** `num_steps` — both the frame count and the divisor for the arc. */
  len: number;
  /** Set by the sink: when this missile was launched. */
  started: number;
}

let sink: ((missile: Missile) => void) | null = null;

export function setMissileSink(fn: ((missile: Missile) => void) | null): void {
  sink = fn;
}

/**
 * run_a_missile. `soundNum` is a sound *file*, not a damage type — the C++
 * passes it as `play_sound(-1 * sound_num)`, where the sign only means "don't
 * block on it", which is what our sound layer does anyway.
 */
export function runAMissile(
  from: Location,
  dest: Location,
  type: number,
  pathType: number,
  soundNum: number,
  xAdj = 0,
  yAdj = 0,
  len = 100,
): void {
  if (soundNum > 0) livingSound(soundNum);
  if (type < 0) return;
  // "Eliminate missiles traveling 0 distance" — do_missile_anim drops any
  // missile whose destination is where it started.
  if (from.x === dest.x && from.y === dest.y) return;
  sink?.({
    from: { ...from }, dest: { ...dest }, type, pathType, xAdj, yAdj, len, started: 0,
  });
}

/**
 * get_missile_direction (boe.newgraph.cpp:517) — which of the eight sprite
 * columns a directional missile uses, from the pixel positions of its ends.
 *
 * The C++ renormalises the origin to (149,185) and then runs a set of legacy
 * half-plane tests; the odd constants and the integer `* 34 / 10` slopes are
 * ported verbatim, since they are what decides the boundaries between headings.
 */
export function getMissileDirection(
  origin: { x: number; y: number }, point: { x: number; y: number },
): number {
  const px = point.x + 149 - origin.x;
  const py = point.y + 185 - origin.y;
  let dx = 0;
  let dy = 0;

  if (px < 135 && py >= Math.trunc((px * 34) / 10) - 293
    && py <= -Math.trunc((px * 34) / 10) + 663) dx--;
  if (px > 163 && py <= Math.trunc((px * 34) / 10) - 350
    && py >= -Math.trunc((px * 34) / 10) + 721) dx++;

  if (py < 167 && py <= Math.trunc(px / 2) + 102
    && py <= -Math.trunc(px / 2) + 249) dy--;
  if (py > 203 && py >= Math.trunc(px / 2) + 123
    && py >= -Math.trunc(px / 2) + 268) dy++;

  switch (dy) {
    case 0: return 4 - 2 * dx;
    case -1: return dx === -1 ? 7 : dx;
    case 1: return 4 - dx;
    default: return 0;
  }
}
