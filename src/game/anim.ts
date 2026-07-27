/**
 * A shared clock for the combat animations, and the camera moves that go with
 * them.
 *
 * The C++ animates by **blocking**: `do_monster_turn` centres the view on each
 * monster about to act, redraws, pauses, and then `run_a_missile` sleeps for
 * the whole flight before the shot resolves. One thing happens at a time and
 * you watch it happen.
 *
 * This port can't block, and resolving everything at once is what made a
 * monster's turn look like nothing but a row of damage numbers appearing from
 * nowhere. So instead of each animation starting "now", they start *after the
 * one before them*: a cursor runs ahead of the wall clock, every animation
 * books the next slot on it, and the renderer plays the queue back. The game
 * logic stays synchronous — only the drawing is spread out.
 *
 * `animAt()` is "when does the next thing start", and never returns a time in
 * the past, so once the queue drains the cursor snaps back to real time.
 */

import { Location } from '../core/location';

let cursor = 0;

/** When the next animation should start. Never earlier than now. */
export function animAt(): number {
  const now = performance.now();
  return cursor > now ? cursor : now;
}

/**
 * How far ahead the queue is allowed to run. The C++ has no such limit — it
 * blocks, so a turn takes exactly as long as its animations do. A crowded
 * fight can queue a *lot* of them, though, and a player watching damage
 * numbers arrive ten seconds after the turn resolved is worse than a player
 * watching two spears overlap, so past this depth new animations start at once.
 */
const MAX_QUEUE_MS = 1500;

/** Book `ms` on the timeline, and hand back when that slot starts. */
export function animBook(ms: number): number {
  const now = performance.now();
  if (cursor - now > MAX_QUEUE_MS) return now;
  const at = animAt();
  cursor = at + ms;
  return at;
}

/** How long until the queue drains; 0 when nothing is pending. */
export function animPending(): number {
  return Math.max(0, cursor - performance.now());
}

/** Drop everything queued — used when the view jumps for another reason. */
export function animClear(): void {
  cursor = 0;
  for (const id of scheduled) clearTimeout(id);
  scheduled.clear();
}

const scheduled = new Set<ReturnType<typeof setTimeout>>();


/**
 * Run `fn` when the timeline reaches `at`. The C++ has no need for this — it
 * blocks, so anything written after an animation simply happens after it. Here
 * the game logic runs straight through, so a side effect that should be heard
 * or seen *when the animation lands* has to be booked for that moment.
 *
 * The hit sound is the case that matters: played at once, you hear the arrow
 * strike while it is still in the air.
 */
export function animSchedule(fn: () => void, at: number): void {
  const delay = at - performance.now();
  if (delay <= 0) {
    fn();
    return;
  }
  const id = setTimeout(() => {
    scheduled.delete(id);
    fn();
  }, delay);
  scheduled.add(id);
}

/**
 * How long the view rests on a monster before it acts.
 *
 * The C++ does `draw_terrain(0); pause(get_int_pref("GameSpeed"))`, and
 * GameSpeed defaults to **0** — so the original's default dwell is just the
 * redraw itself, one frame. That is what this is: a frame, not an invented
 * pause. The original's Preferences dialog raises it to 1, 2 or 9 *ticks*
 * (~17/33/150ms), which is the knob to turn if the monsters' turn reads too
 * fast.
 */
export const MONSTER_PAUSE_MS = 16;

/** A scheduled camera move — `center = cur_monst->cur_loc; draw_terrain(0);` */
export interface FocusEvent {
  center: Location;
  at: number;
}

let focusSink: ((event: FocusEvent) => void) | null = null;

export function setFocusSink(fn: ((event: FocusEvent) => void) | null): void {
  focusSink = fn;
}

/**
 * Centre the view on `where` when the timeline reaches it, then hold for the
 * game-speed pause. This is what lets you see *which* monster is acting before
 * its spear is in the air.
 */
export function focusOn(where: Location): void {
  const at = animBook(MONSTER_PAUSE_MS);
  focusSink?.({ center: { ...where }, at });
}
