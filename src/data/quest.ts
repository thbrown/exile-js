/**
 * Quests and job banks — a port of scenario/quest.hpp.
 *
 * A `Quest` is scenario data (the definition: name, deadline, reward). A `Job`
 * is *party* data: the record that this party has taken quest N on day D, and
 * where they got it from. The C++ keeps the two apart the same way, with
 * `cParty::active_quests` a map from quest number to `cJob`.
 */

/** eQuestStatus (quest.hpp:15). Stored in saves, so the order is verbatim. */
export enum QuestStatus {
  AVAILABLE = 0,
  STARTED = 1,
  COMPLETED = 2,
  FAILED = 3,
}

/** The tag spelling used in save files and the XML (quest.cpp's operator>>). */
export const QUEST_STATUS_TAGS = ['available', 'started', 'completed', 'failed'];

/** cQuest (quest.hpp:17) — the scenario's definition of a quest. */
export interface Quest {
  /** A relative deadline counts from the day the quest was *taken*. */
  deadlineIsRelative: boolean;
  /** The party holds this quest from the moment the scenario starts. */
  autoStart: boolean;
  /** -1 for none; the day the quest must be finished by. */
  deadline: number;
  /** If this key event has happened by the deadline, the deadline is waived. */
  event: number;
  /** Awarded automatically when the quest is marked complete. */
  xp: number;
  gold: number;
  /** Which job bank(s) offer this quest; -1 for none. */
  bank1: number;
  bank2: number;
  name: string;
  descr: string;
}

export function makeQuest(): Quest {
  return {
    deadlineIsRelative: false,
    autoStart: false,
    deadline: -1,
    event: -1,
    xp: 0,
    gold: 0,
    bank1: -1,
    bank2: -1,
    name: '',
    descr: '',
  };
}

/** cJob (quest.hpp:33) — the party's record of one quest it holds. */
export interface Job {
  status: QuestStatus;
  /** The day the quest was started; relative deadlines count from here. */
  start: number;
  /** The job board it came from, or -1 if a special node or NPC gave it. */
  source: number;
}

/**
 * The one-argument cJob constructor (quest.hpp:35) starts the quest; the
 * default constructor leaves it AVAILABLE with start 0 and source -1.
 */
export function makeJob(start: number, source = -1): Job {
  return { status: QuestStatus.STARTED, start, source };
}

/** job_bank_t (party.hpp:53) — a job board's six offers and its temper. */
export interface JobBank {
  /** Six quest numbers, -1 for an empty slot. */
  jobs: number[];
  /** Rises when a deadline is missed; falls again over time. */
  anger: number;
  /** False until generate_job_bank has filled the six slots. */
  inited: boolean;
}

export function makeJobBank(): JobBank {
  return { jobs: new Array<number>(6).fill(-1), anger: 0, inited: false };
}

/** cSpecItem (item.hpp:97) — a scenario's special (quest) item definition. */
export interface SpecItem {
  /**
   * A bit field, not a count: `+1` means the item can be Used, `+10` means the
   * party starts the scenario holding it. The C++ literally adds 10 and 1.
   */
  flags: number;
  /** The special node Using the item runs, or -1. */
  special: number;
  name: string;
  descr: string;
}

export function makeSpecItem(): SpecItem {
  return { flags: 0, special: -1, name: '', descr: '' };
}

/** The `useable` half of cSpecItem::flags. */
export function specItemUseable(item: SpecItem): boolean {
  return item.flags % 10 === 1;
}

/** The `start-with` half of cSpecItem::flags. */
export function specItemStartWith(item: SpecItem): boolean {
  return item.flags >= 10;
}
