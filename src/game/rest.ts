/**
 * Resting — do_rest (boe.actions.cpp:3288). Inns call it, and so will the Rest
 * command and the sleep terrain specials. Time passes, statuses clear, and the
 * party heals; the parts that need systems this port hasn't built are marked.
 */

import { ItemAbil } from '../data/item';
import { hasAbilEquip } from '../universe/inventory';
import { MainStatus, Status, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';
import type { GameSession } from './session';
import { specialIncreaseAge } from './specialIncreaseAge';

/**
 * do_rest — advance the clock by `length` ticks and restore the party.
 *
 * The `session` is only needed for the timers at the end; without one they are
 * skipped, which is what the older callers did.
 *
 * TODO(M5): handle_disease runs three times first, and apply_status feeds the
 * OCCASIONAL_STATUS item effects.
 */
export function doRest(
  univ: Universe, length: number, hpRestore: number, spRestore: number, isOutdoors = false,
  session?: GameSession,
): void {
  const ageBefore = univ.party.age;
  univ.party.age += length;

  // Resting clears every timed status, on the party and on each PC.
  for (const pc of univ.party.pcs) pc.status.fill(0);

  // Plants regrow and magic shops restock every 4000 ticks.
  if (length > 4000 || Math.floor(ageBefore / 4000) < Math.floor(univ.party.age / 4000))
    univ.refreshStoreItems();

  for (const pc of univ.party.pcs) {
    pc.heal(hpRestore);
    pc.restoreSp(spRestore);
  }

  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    if (pc.traits[Trait.RECUPERATION] && pc.curHealth < pc.maxHealth)
      pc.heal(Math.trunc(hpRestore / 5));
    // TODO(M5): CHRONIC_DISEASE has a 1-in-111 chance of a bout here.
    if (pc.traits[Trait.CHRONIC_DISEASE]) univ.rng.getRan(1, 0, 110);

    // Regeneration gear tops the PC up — outdoors it only fires sometimes, but
    // when it does it counts for four times as much.
    const regen = hasAbilEquip(pc, ItemAbil.REGENERATE);
    if (regen && pc.curHealth < pc.maxHealth
      && (!isOutdoors || univ.rng.getRan(1, 0, 10) === 5)) {
      const strength = Math.trunc(regen.item.abilStrength / 3);
      let j = univ.rng.getRan(1, 0, strength);
      if (strength === 0) j = univ.rng.getRan(1, 0, 1);
      if (isOutdoors) j *= 4;
      pc.heal(j);
    }
    // Bonus SP and HP wear off with the rest.
    if (pc.curSp > pc.maxSp) pc.curSp = pc.maxSp;
    if (pc.curHealth > pc.maxHealth) pc.curHealth = pc.maxHealth;
  }

  // do_rest's tail (boe.actions.cpp:3353) passes the *whole* length and asks
  // for the chains to be queued, so a week's worth of timers fire once the
  // party is awake rather than from inside the rest.
  if (session) specialIncreaseAge(session, length, true);
}

/**
 * handle_rest (boe.actions.cpp:556) — the outdoor Rest command, which is what
 * the CAMP toolbar button does. It refuses in a boat, when someone's poisoned,
 * on dangerous ground, or with too little food, then passes 1200 ticks and
 * restores the party.
 *
 * TODO(M5): the original also runs 50 ticks of monster movement while you
 * sleep, can spawn a wandering monster, and aborts if one wanders close.
 */
export function handleRest(
  univ: Universe,
  isOutdoors: boolean,
  dangerousHere: boolean,
  sound?: { play(which: number): void } | null,
): boolean {
  const say = (line: string) => univ.addStringToBuf(line);
  if (univ.party.inBoat >= 0) {
    say('Rest:  Not in boat.');
    return false;
  }
  if (univ.party.pcs.some((pc) =>
    pc.mainStatus === MainStatus.ALIVE && (pc.status[Status.POISON] ?? 0) > 0)) {
    say('Rest: Someone poisoned.');
    return false;
  }
  if (univ.party.food <= 12) {
    say('Rest: Not enough food.');
    return false;
  }
  if (dangerousHere) {
    say("Rest: It's dangerous here.");
    return false;
  }
  say('Resting...');
  // Sound 20, asynchronously — the negative is the C++'s "don't block" flag.
  sound?.play(-20);
  univ.party.food -= 6;
  doRest(univ, 1200, univ.rng.getRan(5, 1, 10), 50, isOutdoors);
  say('  Rest successful.');
  return true;
}
