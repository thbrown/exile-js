/**
 * special_increase_age (boe.specials.cpp:1871) — the half of the clock that
 * belongs to *scripting*: quest deadlines run out, job boards cool off, and the
 * town, scenario and party timers fire the nodes hung off them.
 *
 * The C++ calls this from three places, all of them ported here:
 *   - increase_age (boe.actions.cpp:3578), once per turn out of combat;
 *   - combat_run_monst (boe.combat.cpp:2018), once per combat round;
 *   - do_rest (boe.actions.cpp:3353), with the whole length of the rest and
 *     `queue` set, so a week's worth of chains run *after* the rest rather than
 *     from inside it.
 */

import { QuestStatus } from '../data/quest';
import { Universe } from '../universe/universe';
import { isCombat } from './modes';
import type { GameSession } from './session';
import { SpecCtx, SpecCtxType } from './specials/context';
import { Location, loc } from '../core/location';

/** move_to_zero — one step towards zero, from either side. */
function moveToZero(value: number): number {
  if (value > 0) return value - 1;
  if (value < 0) return value + 1;
  return 0;
}

/**
 * `length` is how many ticks just passed; `queue` sends the chains to the
 * special queue instead of running them now.
 */
export function specialIncreaseAge(session: GameSession, length = 1, queue = false): void {
  const univ = session.univ;
  const party = univ.party;
  const ageBefore = party.age - length;
  const currentAge = party.age;

  // Where the chains are told they fired. In combat that's the acting PC's
  // square, not the party's — the party has no single position in a fight.
  const inCombat = isCombat(session.mode);
  let triggerLoc: Location = loc(0, 0);
  if (inCombat) triggerLoc = { ...univ.currentPc.combatPos };
  else if (session.inTown) triggerLoc = { ...party.townLoc };
  else if (session.isOutdoors) triggerLoc = { ...party.outLoc };

  let failedJob = false;
  for (const [which, job] of party.activeQuests) {
    if (job.status !== QuestStatus.STARTED) continue;
    const quest = univ.scenario.quests[which];
    if (!quest || quest.deadline <= 0) continue;
    // A relative deadline counts from the day the quest was taken; an absolute
    // one is a date on the calendar.
    const deadline = quest.deadline + (quest.deadlineIsRelative ? job.start : 0);
    // `day_reached(deadline + 1)` — the deadline day itself is still in time.
    if (!party.dayReached(deadline + 1, quest.event)) continue;
    job.status = QuestStatus.FAILED;
    if (job.source >= 0) {
      // The board that handed it out takes it personally. A tight deadline
      // missed angers it more, on the grounds that you should have known.
      const bank = party.jobBank(job.source);
      let addAnger = 1;
      if (quest.deadlineIsRelative) {
        if (quest.deadline < 20) addAnger++;
        if (quest.deadline < 10) addAnger++;
        if (quest.deadline < 5) addAnger++;
      } else if (quest.deadline - job.start > 20) addAnger++;
      bank.anger += addAnger;
    }
    failedJob = true;
  }
  if (failedJob) univ.addStringToBuf('The deadline for one of your quests has passed.');

  // Angered job boards slowly forgive you.
  if (party.age % 30 === 0)
    for (const bank of party.jobBanks) bank.anger = moveToZero(bank.anger);

  const engine = session.specials;
  const fire = (mode: SpecCtx, type: SpecCtxType, node: number, at: number): void => {
    if (!engine) return;
    if (queue) {
      // The queued chain remembers the clock reading it was due at, which is
      // why the C++ winds `age` back before queueing rather than after.
      party.age = at;
      engine.queueSpecial(mode, type, node, triggerLoc);
    } else void engine.run(mode, type, node, triggerLoc);
  };

  // Town timers only tick while the party is in that town — and in an arena
  // fight only if the fight started from inside one (which_combat_type 1).
  const town = univ.town;
  if (town && (session.inTown || (inCombat && session.whichCombatType === 1))) {
    for (const timer of town.record.timers) {
      if (timer.time <= 0) continue;
      const time = timer.time;
      for (let j = ageBefore + 1; j <= currentAge; j++) {
        if (j % time !== 0) continue;
        fire(SpecCtx.TOWN_TIMER, SpecCtxType.TOWN, timer.node, j);
        // Note the C++ zeroes the timer the first time it fires, so a "every
        // N days" town timer is really once only. Kept: scenarios are written
        // against it, and the scenario timers below do the same.
        timer.time = 0;
      }
    }
  }
  party.age = currentAge;

  for (const timer of univ.scenario.scenarioTimers) {
    if (timer.time <= 0) continue;
    const time = timer.time;
    for (let j = ageBefore + 1; j <= currentAge; j++) {
      if (j % time !== 0) continue;
      fire(SpecCtx.SCEN_TIMER, SpecCtxType.SCEN, timer.node, j);
      timer.time = 0;
    }
  }
  party.age = currentAge;

  // Party timers are one-shot countdowns, so they tick down rather than test
  // the clock. Iterating a copy is the C++'s: a chain that starts a new timer
  // mid-loop must not have it ticked in the same pass.
  const partyTimers = party.partyEventTimers.map((t) => ({ ...t }));
  for (let i = 0; i < partyTimers.length; i++) {
    const t = partyTimers[i]!;
    const slot = party.partyEventTimers[i]!;
    if (t.time <= length) {
      fire(SpecCtx.PARTY_TIMER, t.nodeType, t.node, ageBefore + t.time);
      // Blanked, not removed: the slot numbering is part of the save format.
      slot.time = 0;
      slot.node = -1;
    } else slot.time -= length;
  }
  party.age = currentAge;
}
