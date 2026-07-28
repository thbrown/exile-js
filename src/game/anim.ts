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
 * books the next slot on it, and the renderer plays the queue back.
 *
 * Spreading out the *drawing* was only half of it, though. The game logic ran
 * straight through underneath, so a turn's HP and positions were at their
 * final values before the first booked frame was ever shown, and the pauses
 * played over a picture that had already finished — which is why raising the
 * constants below did nothing. `animSettle` is the other half: the turn waits
 * here for the queue it booked, so the model advances at the rate the screen
 * does, the way it does in the C++ for the simple reason that the C++ blocks.
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
  // A turn parked in `animSettle` must not be stranded by this: the queue it
  // was waiting on is gone, so its wait is over.
  const waiting = settleWaiters;
  settleWaiters = [];
  for (const resolve of waiting) resolve();
}

const scheduled = new Set<ReturnType<typeof setTimeout>>();

/**
 * How the host makes a caller wait — `setAnimWaiter` in main.ts. Left unset it
 * stays null and `animSettle` returns at once, which is what tests, headless
 * runs and `verify-screen` want: same code path, no wall-clock cost. This is
 * the shape `Universe.transcriptClock` already uses for the same reason.
 */
let waiter: ((ms: number) => Promise<void>) | null = null;
let settleWaiters: (() => void)[] = [];

export function setAnimWaiter(fn: ((ms: number) => Promise<void>) | null): void {
  waiter = fn;
}

/**
 * The C++'s blocking `pause()`, which is the whole reason combat there has a
 * pulse: `do_monster_turn` centres the view, sleeps, resolves the action,
 * sleeps again, and only then moves on to the next monster. Display and model
 * advance in lockstep because nothing else *can* run in between.
 *
 * This port resolves the model synchronously and books the drawing on the
 * shared timeline, so without this the two come apart: every HP bar and
 * monster position reaches its final value before the first booked frame is
 * ever shown, and the pauses then play over a picture that has already
 * finished. Awaiting here is what puts them back together — the caller stops
 * until the queue it just booked has actually been drawn.
 */
export async function animSettle(): Promise<void> {
  const ms = animPending();
  if (ms <= 0 || waiter === null) return;
  let release = (): void => {};
  const cleared = new Promise<void>((resolve) => { release = resolve; });
  settleWaiters.push(release);
  try {
    // Whichever comes first: the queue draining, or `animClear` dropping it.
    await Promise.race([waiter(ms), cleared]);
  } finally {
    settleWaiters = settleWaiters.filter((r) => r !== release);
  }
}


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

/**
 * The beat after a monster's action lands — `do_monster_turn`'s own
 * `print_buf(); pause(8);` (boe.combat.cpp:2428), right after a flee, a
 * spell, a ranged shot or a melee swing resolves and before the loop moves
 * on. Unlike `MONSTER_PAUSE_MS` this one is **not** gated by GameSpeed at
 * all — it always runs, which is what gives every monster's turn a
 * perceptible beat regardless of the speed setting. 8 ticks at ~16.67ms
 * each (`time_in_ticks`, mathutil.cpp:67) is ~133ms.
 *
 * This was missing outright rather than approximated, unlike
 * `MONSTER_PAUSE_MS` — there was no placeholder for it at all, which is most
 * of why combat read as faster than the original: nothing paced the moment
 * *between* one monster's swing and the next monster's turn starting.
 *
 * For a while raising this did nothing at all — `doMonsterTurn` resolved
 * every monster's move and damage roll before any of the pacing was observed,
 * so the booked time only ever guarded a static frame. Now that the turn
 * `animSettle`s on it, the number is real: a four-monster round measured
 * 1264ms at 133 and 2593ms at 400. Left at the faithful 133 — that is the
 * C++'s 8 ticks — but it is a working knob again if a fight reads too fast.
 */
export const ACTION_PAUSE_MS = 133;

/** Book the post-action beat on the shared timeline; see `ACTION_PAUSE_MS`. */
export function bookActionPause(): void {
  animBook(ACTION_PAUSE_MS);
}

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
