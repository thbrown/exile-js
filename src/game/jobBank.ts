/**
 * The job board — `show_job_bank` and `fill_job_bank` (boe.dlgutil.cpp:770/794).
 *
 * A job board is a dispatcher who hands out quests. The board's six slots hold
 * quest numbers (only the first four are ever shown; 4 and 5 are spares that
 * swap in when one is taken), and its `anger` rises when the party misses a
 * deadline — a board angry enough refuses to talk at all, which is the JOB_BANK
 * talk node's own test.
 *
 * The rules live here rather than in the host so they can be tested headless;
 * the host owns only the dialog.
 *
 * *Two oddities in the C++ worth knowing*, both noted where they apply below:
 * `show_job_bank` asks the resource manager for a dialog called `job-bank`
 * while the file that exists is `job-board.xml`, and it writes its mood line
 * into a control named `prompt` where that file's field is called `feedback`.
 * The behaviour ported here is what the code plainly means to do.
 */

import { Job, JobBank, QuestStatus, makeJob } from '../data/quest';
import { Universe } from '../universe/universe';

/** One slot's worth of board copy: what `fill_job_bank` writes into `jobN`. */
export interface JobOffer {
  /** Which of the board's six slots this came from. */
  slot: number;
  /** The quest number, i.e. an index into `scenario.quests`. */
  quest: number;
  /** The description, deadline and pay, joined the way the C++ joins them. */
  text: string;
}

/**
 * `fill_job_bank`'s per-slot text. Only slots 0..3 have a control to write to,
 * so only those are offered; a slot holding -1 (or a quest number the scenario
 * doesn't have) hides its Take button, which here means no row at all.
 */
export function jobBoardOffers(univ: Universe, bank: JobBank): JobOffer[] {
  const offers: JobOffer[] = [];
  for (let i = 0; i < 4; i++) {
    const which = bank.jobs[i]!;
    if (which < 0 || which >= univ.scenario.quests.length) continue;
    const quest = univ.scenario.quests[which]!;
    const lines = [quest.descr];
    if (quest.deadline > 0) {
      lines.push(
        quest.deadlineIsRelative
          ? `Must be completed in ${quest.deadline} days.`
          : `Must be completed by day ${quest.deadline}.`,
      );
    }
    lines.push(`Pay is ${quest.gold} gold.`);
    offers.push({ slot: i, quest: which, text: lines.join(' ') });
  }
  return offers;
}

/**
 * The dispatcher's mood line (`show_job_bank`'s four bands). The last band is
 * open-ended, but a board at 50 or over never opens at all — the JOB_BANK talk
 * node turns the party away first — so "rather angry" is as bad as it reads.
 */
export function dispatcherMood(anger: number): string {
  if (anger < 10) return 'Dispatcher is neutral towards you.';
  if (anger < 20) return 'Dispatcher is a little annoyed at you.';
  if (anger < 35) return 'Dispatcher is annoyed at you.';
  return 'Dispatcher is rather angry at you.';
}

/**
 * The board as the player first sees it: created if this is a new one, and
 * rolled if it has never been rolled before. `generate_job_bank` is called
 * lazily here and nowhere else, which is why anger from a missed deadline only
 * bites on a board's *next* refresh.
 */
export function openJobBank(univ: Universe, which: number): JobBank {
  const bank = univ.party.jobBank(which);
  if (!bank.inited) univ.generateJobBank(which);
  return bank;
}

/**
 * Taking a job: `show_job_bank`'s click handler. The quest is recorded as
 * started today, and the slot is refilled from one of the two spares if either
 * is holding something.
 *
 * *Gotcha, kept*: the C++'s comment there reads "Now, if there are spare jobs
 * available, fill in. Otherwise, clear space" — but the `else` branch doesn't
 * exist. With both spares empty (which is every board `generate_job_bank`
 * rolls, since it only ever fills four of the six slots) the taken job stays
 * on the board, and Take can be clicked on it again. The second click is
 * harmless: it rewrites the same job with today's date.
 *
 * *Gotcha, kept*: the source recorded on the job is the **personality** of
 * whoever is being talked to, not the board number — even though
 * `special_increase_age` then uses that source to index `job_banks` when a
 * deadline is missed. On a one-board scenario with a low personality it makes
 * no difference; on any other it angers the wrong dispatcher. It's what the
 * C++ writes.
 */
export function takeJob(univ: Universe, bank: JobBank, slot: number, personality: number): Job {
  const which = bank.jobs[slot]!;
  const job = makeJob(univ.party.calcDay(), personality);
  univ.party.activeQuests.set(which, job);
  if (bank.jobs[4]! >= 0) {
    bank.jobs[slot] = bank.jobs[4]!;
    bank.jobs[4] = which;
  } else if (bank.jobs[5]! >= 0) {
    bank.jobs[slot] = bank.jobs[5]!;
    bank.jobs[5] = which;
  }
  return job;
}

/**
 * `RECEIVE_QUEST` (boe.dlgutil.cpp:1148) — an NPC handing over a quest
 * directly, with no board behind it (so no source). Returns what the node
 * should do with its two strings:
 *
 * - `given` — the quest is now started (it was available), show str1.
 * - `held` — already started; show str1 anyway, silently.
 * - `done` — already completed, so str2 is the "you did that already" line.
 * - `failed` — the C++ bails out here with a TODO wondering what to do; the
 *   reply is left exactly as it was.
 */
export function receiveQuest(univ: Universe, which: number): 'given' | 'held' | 'done' | 'failed' {
  const status = univ.party.activeQuests.get(which)?.status ?? QuestStatus.AVAILABLE;
  switch (status) {
    case QuestStatus.AVAILABLE:
      univ.party.activeQuests.set(which, makeJob(univ.party.calcDay()));
      return 'given';
    case QuestStatus.STARTED:
      return 'held';
    case QuestStatus.COMPLETED:
      return 'done';
    default:
      return 'failed';
  }
}
