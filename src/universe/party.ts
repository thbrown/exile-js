/**
 * The party: shared resources, world position, and the Stuff Done Flags.
 * Port of the M2-relevant parts of cParty (universe/party.cpp:25).
 *
 * Outdoor position model, kept faithful because specials and save files
 * depend on it: the engine keeps a 96x96 window (`CurOut`) assembled from a
 * 2x2 block of 48x48 sectors whose top-left is `outdoorCorner`. `outLoc` is
 * the party position *within that window* (0..95), `iwc` says which of the
 * four sectors the party is currently standing in, and `locInSec` is the
 * position within that sector (0..47).
 */

import { Direction, Location, loc } from '../core/location';
import { GameRng } from '../core/rng';
import { Job, JobBank, makeJobBank } from '../data/quest';
import { SpecCtxType } from '../game/specials/context';
import { OutdoorCreature } from './outdoorCreature';
import { PartyStatus, Skill, Status } from './skills';

/**
 * cTimer (special.hpp:125) as the party stores it: a countdown, the node to
 * run when it expires, and which list that node number indexes.
 */
export interface PartyTimer {
  time: number;
  nodeType: SpecCtxType;
  node: number;
}

/** cTimer::is_valid (special.cpp:30) — a blanked-out slot is not valid. */
export function timerIsValid(t: PartyTimer): boolean {
  return t.time >= 0 && t.node >= 0;
}

/** `eEncNoteType` (party.hpp:59) — which list a recorded note belongs to. */
export enum EncNoteType {
  SCEN = 0,
  OUT = 1,
  TOWN = 2,
}

/** `cParty::cEncNote` — one line of the party's encounter notes. */
export interface EncNote {
  type: EncNoteType;
  theStr: string;
  /** The town or outdoor sector it was found in, for grouping. */
  where: string;
}

export const SDF_ROWS = 350;
export const SDF_COLUMNS = 50;
export const MAX_GOLD = 30000;
export const MAX_FOOD = 25000;

/** Sentinel town number meaning "not in a town" (i.e. outdoors). */
export const TOWN_NUM_OUTDOORS = 200;

export class Party {
  gold = 200;
  food = 100;
  /** Ticks since the game started; a day is 3700 (cParty::calc_day). */
  age = 0;
  direction: Direction = Direction.N;

  outdoorCorner: Location = loc(7, 8);
  iwc: Location = loc(1, 1);
  locInSec: Location = loc(36, 36);
  outLoc: Location = loc(84, 84);
  townLoc: Location = loc(0, 0);
  townNum = TOWN_NUM_OUTDOORS;

  inBoat = -1;
  inHorse = -1;
  /**
   * The party's own copies of the scenario's vehicle templates
   * (`cParty::boats`/`horses`) — only the ones that `exist`, populated at
   * `enter_scenario` and restored per-town on entry. `inBoat`/`inHorse` index
   * into these.
   */
  boats: import('../data/vehicle').Vehicle[] = [];
  horses: import('../data/vehicle').Vehicle[] = [];
  /** Halves every monster's health (cParty::easy_mode). */
  easyMode = false;
  /** Running totals the endgame summary reports (cParty::total_*). */
  totalDamTaken = 0;
  totalDamDone = 0;
  totalMKilled = 0;
  totalXpGained = 0;
  /** Accumulated light from spells/items; drives light_radius in dark towns. */
  lightLevel = 0;
  /**
   * `cParty::status` — the four effects that sit on the party rather than on
   * any one PC (ePartyStatus, damage.hpp:59). Each is a countdown in turns.
   */
  partyStatus: Record<PartyStatus, number> = {
    [PartyStatus.STEALTH]: 0,
    [PartyStatus.FLIGHT]: 0,
    [PartyStatus.DETECT_LIFE]: 0,
    [PartyStatus.FIREWALK]: 0,
  };
  /**
   * The ten wandering encounters roaming the outdoor map (cParty::out_c). They
   * live on the *party*, not on the outdoors, because they follow it across
   * sector boundaries — `boe.fileio.cpp` shifts or drops them when the window
   * slides.
   */
  outC: OutdoorCreature[] = Array.from({ length: 10 }, () => new OutdoorCreature());

  /** Special items the party has acquired, by index (cParty::spec_items). */
  specItems = new Set<number>();
  /**
   * `cParty::m_noted` — monster types Scry Monster has identified, which is
   * what unlocks their entry in the monster-info menu.
   */
  mNoted = new Set<number>();
  /**
   * Monsters the party's own items can summon that don't come from this
   * scenario (cParty::summons). A monster number >= 10000 indexes this list
   * with 10000 subtracted; it stays empty until a save file or an item fills
   * it, which is why `placeMonster` can find nothing there and give up.
   */
  summons: import('../data/monster').Monster[] = [];
  /**
   * The soul crystal's four slots (`cParty::imprisoned_monst`): monster
   * numbers Capture Soul has caught, which Simulacrum then summons. 0 is an
   * empty slot, so monster 0 can never be stored — the C++ has the same hole.
   */
  imprisonedMonst: number[] = [0, 0, 0, 0];
  /** Alchemy recipes the party knows (cParty::alchemy). */
  alchemy: boolean[] = new Array<boolean>(20).fill(false);
  /**
   * Rolled stock for random shops: magicStoreItems[shop][slot]. Random shops
   * re-roll only when refresh_store_items runs, so the same wares are on the
   * shelf until then (cParty::magic_store_items).
   */
  magicStoreItems = new Map<number, Map<number, import('../data/item').Item>>();
  /** How much of a limited-stock entry is left: storeLimitedStock[shop][slot]. */
  storeLimitedStock = new Map<number, Map<number, number>>();

  /** Stuff Done Flags — the scenario-visible persistent state array. */
  stuffDone: Uint8Array[] = Array.from({ length: SDF_ROWS }, () => new Uint8Array(SDF_COLUMNS));

  /**
   * Magic pointers (cParty::magic_ptrs) — 10..99 are values the engine writes
   * for scripts to read back (10/11 are the trigger location, 12 its terrain).
   */
  magicPtrs: number[] = new Array<number>(90).fill(0);
  /** Named pointers 100..199, each aliasing an SDF cell (cParty::pointers). */
  pointers = new Map<number, [number, number]>();
  /** Days on which each major event happened (cParty::key_times). */
  keyTimes = new Map<number, number>();

  /**
   * `cParty::active_quests` — quest number → the party's record of it. A quest
   * the party has never heard of simply isn't in the map; one it has *finished*
   * stays in, with status COMPLETED, because that is what IF_QUEST asks about.
   */
  activeQuests = new Map<number, Job>();
  /**
   * `cParty::job_banks` — one per job board, grown on demand. The C++ resizes
   * the vector wherever a bank number turns out to be past the end (there's a
   * "safety valve in case it was given by a special node" comment at one such
   * site), so `jobBank()` below does the same.
   */
  jobBanks: JobBank[] = [];
  /**
   * `cParty::party_event_timers` — one-shot countdowns a special node started.
   * Unlike town and scenario timers these are *not* periodic: they fire once
   * and are then blanked (time 0, node -1) rather than removed, so the slot
   * numbering in a save file stays put.
   */
  partyEventTimers: PartyTimer[] = [];

  /**
   * `cParty::special_notes` — the encounter notes, which is what the Record
   * button on a message box writes to. Each note remembers where it was found
   * so the journal can group them.
   */
  specialNotes: EncNote[] = [];

  /**
   * `cParty::record` (party.cpp:412) — add a note, refusing an exact duplicate
   * and returning whether anything was added. The C++ compares the whole
   * record, so the same text found in two different places is two notes.
   */
  record(type: EncNoteType, what: string, where: string): boolean {
    const already = this.specialNotes.some(
      (n) => n.type === type && n.theStr === what && n.where === where);
    if (already) return false;
    this.specialNotes.push({ type, theStr: what, where });
    return true;
  }

  // --- cParty's iLiving half (party.cpp:426-570) ---------------------------
  //
  // The party is itself an iLiving in the C++, and every one of these just
  // forwards to all six PCs — which is what "affects the whole party" means for
  // an item or a spell. The ones the PC versions need an rng for take one here;
  // the C++ reaches for the global instead.

  applyStatusAll(which: Status, howMuch: number): void {
    for (const pc of this.pcs) pc.applyStatus(which, howMuch);
  }

  healAll(howMuch: number): void {
    for (const pc of this.pcs) pc.heal(howMuch);
  }

  restoreSpAll(howMuch: number): void {
    for (const pc of this.pcs) pc.restoreSp(howMuch);
  }

  poisonAll(howMuch: number, rng: GameRng): void {
    for (const pc of this.pcs) pc.poison(howMuch, rng);
  }

  cureAll(howMuch: number): void {
    for (const pc of this.pcs) pc.cure(howMuch);
  }

  acidAll(howMuch: number): void {
    for (const pc of this.pcs) pc.acid(howMuch);
  }

  curseAll(howMuch: number): void {
    for (const pc of this.pcs) pc.curse(howMuch);
  }

  slowAll(howMuch: number): void {
    for (const pc of this.pcs) pc.slow(howMuch);
  }

  webAll(howMuch: number): void {
    for (const pc of this.pcs) pc.web(howMuch);
  }

  diseaseAll(howMuch: number, rng: GameRng): void {
    for (const pc of this.pcs) pc.disease(howMuch, rng);
  }

  dumbfoundAll(howMuch: number, rng: GameRng): void {
    for (const pc of this.pcs) pc.dumbfound(howMuch, rng);
  }

  /**
   * cParty::sleep (party.cpp:532). Forcecage is the exception that proves the
   * rule: a cage traps the *party*, not six people separately, so the best
   * lore-and-spells PC makes the one saving roll and everyone else is given
   * whatever they ended up with. Every other status just goes round the six.
   */
  sleepAll(whatType: Status, howMuch: number, adj: number, rng: GameRng): void {
    if (whatType === Status.FORCECAGE) {
      let who = 0;
      let best = 0;
      for (let i = 0; i < this.pcs.length; i++) {
        const pc = this.pcs[i]!;
        const cur = pc.skill(Skill.MAGE_LORE) + pc.skill(Skill.MAGE_SPELLS)
          + pc.skill(Skill.PRIEST_SPELLS);
        if (pc.isAlive && cur > best) {
          best = cur;
          who = i;
        }
      }
      const chosen = this.pcs[who];
      if (!chosen) return;
      chosen.sleep(whatType, howMuch, adj, rng);
      for (const pc of this.pcs) pc.status[Status.FORCECAGE] = chosen.status[Status.FORCECAGE] ?? 0;
      return;
    }
    for (const pc of this.pcs) pc.sleep(whatType, howMuch, adj, rng);
  }

  /** The job bank numbered `which`, creating it (and any gap) if need be. */
  jobBank(which: number): JobBank {
    while (this.jobBanks.length <= which) this.jobBanks.push(makeJobBank());
    return this.jobBanks[which]!;
  }

  /**
   * cParty::start_timer (party.cpp:714). The C++ refuses when the vector is at
   * `max_size()`, which never happens — its own comment says "Shouldn't be
   * reached" — so this always succeeds too.
   */
  startTimer(time: number, node: number, type: SpecCtxType): boolean {
    this.partyEventTimers.push({ time, nodeType: type, node });
    return true;
  }

  pcs: import('./player').Player[] = [];

  calcDay(): number {
    return Math.floor(this.age / 3700) + 1;
  }

  /**
   * day_reached (boe.text.cpp:1233) — has day `day` arrived, and (when an
   * event is named) did that event happen no earlier than it? Note the test
   * is on the *day the event happened*, not on elapsed time since.
   */
  dayReached(day: number, event = 0): boolean {
    if (event > 0) {
      const when = this.keyTimes.get(event);
      if (when === undefined) return false;
      if (when < day) return false;
    }
    return this.calcDay() >= day;
  }

  wipeSdfs(): void {
    for (const row of this.stuffDone) row.fill(0);
  }

  /** cParty::is_alive (party.cpp:440) — true while anyone still stands. */
  isAlive(): boolean {
    return this.pcs.some((pc) => pc.isAlive);
  }

  sdLegit(row: number, col: number): boolean {
    return row >= 0 && row < SDF_ROWS && col >= 0 && col < SDF_COLUMNS;
  }

  getSdf(row: number, col: number): number {
    return this.sdLegit(row, col) ? this.stuffDone[row]![col]! : 0;
  }

  setSdf(row: number, col: number, value: number): void {
    if (this.sdLegit(row, col)) this.stuffDone[row]![col] = value & 0xff;
  }

  /** cParty::force_ptr — the engine writing one of the reserved 10..99 slots. */
  forcePtr(p: number, value: number): void {
    if (p < 10 || p >= 100) return;
    this.magicPtrs[p - 10] = value & 0xff;
  }

  /** cParty::set_ptr — point a 100..199 pointer at an SDF cell. */
  setPtr(p: number, row: number, col: number): void {
    if (p < 100 || p >= 200) return;
    this.pointers.set(p, [row, col]);
  }

  clearPtr(p: number): void {
    this.pointers.delete(p);
  }

  /** cParty::get_ptr (party.cpp:1178) — 10..99 direct, 100..199 through an SDF. */
  getPtr(p: number): number {
    if (p < 10 || p >= 200) return 0;
    if (p < 100) return this.magicPtrs[p - 10] ?? 0;
    const cell = this.pointers.get(p);
    return cell ? this.getSdf(cell[0], cell[1]) : 0;
  }

  /** cParty::get_level (party.cpp:479) — the living PCs' levels added up. */
  getLevel(): number {
    return this.pcs.reduce((sum, pc) => sum + (pc.isAlive ? pc.level : 0), 0);
  }

  /** cParty::swap_pcs (party.cpp:379) — trade two places in the marching order. */
  swapPcs(a: number, b: number): void {
    if (a < 0 || b < 0 || a >= this.pcs.length || b >= this.pcs.length) return;
    const tmp = this.pcs[a]!;
    this.pcs[a] = this.pcs[b]!;
    this.pcs[b] = tmp;
  }

  /** cParty::get_loc (party.cpp) — whichever of the two positions is live. */
  getLoc(): Location {
    return this.townNum === TOWN_NUM_OUTDOORS ? this.outLoc : this.townLoc;
  }

  /** The sector the party is standing in, in scenario coordinates. */
  get sector(): Location {
    return loc(this.outdoorCorner.x + this.iwc.x, this.outdoorCorner.y + this.iwc.y);
  }

  /** global_to_local (boe.locutils.cpp:115) — window coords to sector coords. */
  globalToLocal(global: Location): Location {
    return loc(global.x >= 48 ? global.x - 48 : global.x, global.y >= 48 ? global.y - 48 : global.y);
  }

  /** local_to_global (boe.locutils.cpp:126) — sector coords to window coords. */
  localToGlobal(local: Location): Location {
    return loc(local.x + (this.iwc.x === 1 ? 48 : 0), local.y + (this.iwc.y === 1 ? 48 : 0));
  }
}
