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

/**
 * One tick of the original's clock — `time_in_ticks` (mathutil.cpp:67) counts
 * in sixtieths of a second, which is what every `pause(n)` below is expressed
 * in.
 */
export const TICK_MS = 1000 / 60;

/**
 * **A play-testing knob that is not in the original.** Every animation length
 * below is multiplied by this, so `1` is the faithful speed and larger numbers
 * are slow motion. The original's own answer to "combat is too fast" is the
 * GameSpeed preference, which only stretches one of the pauses (see
 * `MONSTER_DWELL_TICKS`); this stretches all of them together, which is what
 * you want while checking that a monster's turn does what it should.
 *
 * Left at 3 while combat is being play-tested. Set it back to 1 — or press
 * `-`/`=` in the running game, which is `setCombatPace` — once a fight reads
 * correctly at speed.
 */
const DEFAULT_COMBAT_PACE = 3;

let pace = DEFAULT_COMBAT_PACE;

export function combatPace(): number {
  return pace;
}

export function setCombatPace(value: number): void {
  pace = Math.max(0.25, Math.min(10, value));
}

/** A faithful duration in ms, stretched by the current play-testing pace. */
export function paced(ms: number): number {
  return ms * pace;
}

/** When the next animation should start. Never earlier than now. */
export function animAt(): number {
  const now = performance.now();
  return cursor > now ? cursor : now;
}

/**
 * Book `ms` on the timeline, and hand back when that slot starts.
 *
 * **There is no depth cap.** There used to be one — past 1500ms of backlog a
 * new animation started at once rather than queueing — from when the game
 * logic ran straight through underneath the display and a crowded fight could
 * leave damage numbers arriving ten seconds after the turn had resolved.
 * Two things retired it:
 * - The turn `animSettle`s now, and the player's input waits on the queue too
 *   (`midAction` in main.ts, which is the C++'s `flushingInput`), so the model
 *   can no longer run away from the screen in the first place.
 * - The cap broke the one thing this queue exists to guarantee. Once a blast
 *   books time of its own, a busy queue meant `animBook` handed a hit and the
 *   missile it belongs to the *same* start — and an explosion that beats its
 *   projectile is the exact bug the timeline was built to fix.
 *
 * The C++ has no such limit either: it blocks, so a turn takes exactly as long
 * as its animations do. If a fight ever does feel too long, that is what the
 * pace knob is for.
 */
export function animBook(ms: number): number {
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
 * How long the view rests on a monster before it acts, in the original's ticks
 * — `draw_terrain(0); pause(speed == 3 ? 9 : speed)` (boe.combat.cpp:2213),
 * where `speed` is the GameSpeed preference. The four settings the original's
 * Preferences dialog offers are 0, 1, 2 and 9 ticks, and it ships on **0**: the
 * default dwell is just the redraw, one frame.
 *
 * This is the original's own knob for "the monsters' turn reads too fast", so
 * it is set to the slowest of the four rather than the shipped default. The
 * dwell is the only thing that says *which* monster is acting before its spear
 * is in the air, and at 0 there is nothing to see.
 */
export const MONSTER_DWELL_TICKS = 9;

/** The GameSpeed dwell in ms, at the current pace. */
export function monsterPauseMs(): number {
  return paced(MONSTER_DWELL_TICKS * TICK_MS);
}

/**
 * The beat after a monster's action lands — `do_monster_turn`'s own
 * `print_buf(); pause(8);` (boe.combat.cpp:2428), right after a flee, a
 * spell, a ranged shot or a melee swing resolves and before the loop moves
 * on. Unlike the GameSpeed dwell this one is **not** gated by that pref at
 * all — it always runs, which is what gives every monster's turn a
 * perceptible beat regardless of the speed setting. 8 ticks at ~16.67ms
 * each (`time_in_ticks`, mathutil.cpp:67) is ~133ms.
 *
 * This was missing outright rather than approximated, unlike the GameSpeed
 * dwell — there was no placeholder for it at all, which is most
 * of why combat read as faster than the original: nothing paced the moment
 * *between* one monster's swing and the next monster's turn starting.
 *
 * For a while raising this did nothing at all — `doMonsterTurn` resolved
 * every monster's move and damage roll before any of the pacing was observed,
 * so the booked time only ever guarded a static frame. Now that the turn
 * `animSettle`s on it, the number is real: a four-monster round measured
 * 1264ms at 133 and 2593ms at 400. Kept at the faithful 8 ticks; the
 * play-testing slowdown is `paced()`, applied here with everything else.
 */
export const ACTION_PAUSE_MS = 8 * TICK_MS;

/** The post-action beat in ms, at the current pace. */
export function actionPauseMs(): number {
  return paced(ACTION_PAUSE_MS);
}

/** Book the post-action beat on the shared timeline; see `ACTION_PAUSE_MS`. */
export function bookActionPause(): void {
  animBook(actionPauseMs());
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
  const at = animBook(monsterPauseMs());
  focusSink?.({ center: { ...where }, at });
}

/**
 * Move the camera at an already-booked moment, without booking any time of its
 * own. `do_missile_anim` does exactly this: it re-centres *inside* the flight
 * loop, on the frame where the shot passes the halfway mark, and the flight is
 * no longer for it.
 */
export function focusAt(where: Location, at: number): void {
  focusSink?.({ center: { ...where }, at });
}
