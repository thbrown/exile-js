/**
 * The `iLiving` seam (universe/living.hpp:36, living.cpp) — the abstract base
 * over a party member and a monster. Every damage, status and spell effect in
 * the C++ targets this interface rather than either concrete class, which is
 * what makes `boe.combat.cpp` portable nearly line for line. PLAN.md §2.4 calls
 * for introducing it *before* combat, not after.
 *
 * Two deliberate departures from the C++:
 *
 * - `status` is a dense array indexed by `Status` instead of a `std::map`. The
 *   map's default-construct-on-read is what `status[x]` relies on, and an array
 *   of zeros gives the same reads without the mutable-map hack.
 * - `get_ran` is a global in the C++ but an injected instance here, so the four
 *   methods that roll dice take the RNG as a parameter.
 */

import { Direction, Location, minmax } from '../core/location';
import { GameRng } from '../core/rng';
import { NUM_STATUSES, Status, statusBounds, statusInfo } from './skills';

/** eSpellNote (living.hpp:20) — the transcript line an effect prints. */
export enum SpellNote {
  NONE = 0,
  SCARED = 1, SLOWED = 2, WEAKENED = 3, POISONED = 4, CURSED = 5,
  RAVAGED = 6, UNDAMAGED = 7, STONED = 8, GAZES = 9, RESISTS = 10,
  DRAINS = 11, SHOOTS = 12, THROWS_SPEAR = 13, THROWS_ROCK = 14, THROWS_RAZORDISK = 15,
  HITS = 16, DISAPPEARS = 17, MISSES = 18, WEBBED = 19, CHOKES = 20,
  SUMMONED = 21, DUMBFOUNDED = 22, CHARMED = 23, RECORDED = 24, DISEASED = 25,
  AVATAR = 26, SPLITS = 27, ASLEEP = 28, AWAKE = 29, PARALYZED = 30,
  ACID = 31, SPINES = 32, SUMMONS = 33, CURED = 34, HASTED = 35,
  BLESSED = 36, CLEANS_WEBS = 37, FEEL_BETTER = 38, MIND_CLEAR = 39, ALERT = 40,
  HEALED = 41, DRAINED_HP = 42, SP_RECHARGED = 43, DRAINED_SP = 44, REVIVED = 45,
  DIES = 46, RALLIES = 47, CLEANS_ACID = 48, BREAKS_BARRIER = 49, BREAKS_FORCECAGE = 50,
  OBLITERATED = 51, TRAPPED = 52, THROWS_DART = 53, THROWS_KNIFE = 54, FIRES_RAY = 55,
  GAZES2 = 56, BREATHES_ON = 57, THROWS_WEB = 58, SPITS = 59, BREATHES = 60,
  HEAT_RAY = 61, DRAINED_XP = 62, PROTECTED = 63, KILLED = 64,
}

/**
 * iLiving::spell_note's message table (living.cpp:71). `{}` takes the name.
 * Note the leading double space on nearly all of them, and that CURSED has a
 * single space — that inconsistency is in the original.
 */
const SPELL_NOTE_MSG: Partial<Record<SpellNote, string>> = {
  [SpellNote.SCARED]: '  {} scared.',
  [SpellNote.SLOWED]: '  {} slowed.',
  [SpellNote.WEAKENED]: '  {} weakened.',
  [SpellNote.POISONED]: '  {} poisoned.',
  [SpellNote.CURSED]: ' {} cursed.',
  [SpellNote.RAVAGED]: '  {} ravaged.',
  [SpellNote.UNDAMAGED]: '  {} undamaged.',
  [SpellNote.STONED]: '  {} is stoned.',
  [SpellNote.GAZES]: '  Gazes at {}.',
  [SpellNote.RESISTS]: '  {} resists.',
  [SpellNote.DRAINS]: '  Drains {}.',
  [SpellNote.SHOOTS]: '  Shoots at {}.',
  [SpellNote.THROWS_SPEAR]: '  Throws spear at {}.',
  [SpellNote.THROWS_ROCK]: '  Throws rock at {}.',
  [SpellNote.THROWS_RAZORDISK]: '  Throws razordisk at {}.',
  [SpellNote.HITS]: '  Hits {}.',
  [SpellNote.DISAPPEARS]: '  {} disappears.',
  [SpellNote.MISSES]: '  Misses {}.',
  [SpellNote.WEBBED]: '  {} is webbed.',
  [SpellNote.CHOKES]: '  {} chokes.',
  [SpellNote.SUMMONED]: '  {} summoned.',
  [SpellNote.DUMBFOUNDED]: '  {} is dumbfounded.',
  [SpellNote.CHARMED]: '  {} is charmed.',
  [SpellNote.RECORDED]: '  {} is recorded.',
  [SpellNote.DISEASED]: '  {} is diseased.',
  [SpellNote.AVATAR]: '  {} is an avatar!',
  [SpellNote.SPLITS]: '  {} splits!',
  [SpellNote.ASLEEP]: '  {} falls asleep.',
  [SpellNote.AWAKE]: '  {} wakes up.',
  [SpellNote.PARALYZED]: '  {} paralyzed.',
  [SpellNote.ACID]: '  {} covered with acid.',
  [SpellNote.SPINES]: '  Fires spines at {}.',
  [SpellNote.SUMMONS]: '  {} summons aid.',
  [SpellNote.CURED]: '  {} is cured.',
  [SpellNote.HASTED]: '  {} is hasted.',
  [SpellNote.BLESSED]: '  {} is blessed.',
  [SpellNote.CLEANS_WEBS]: '  {} cleans webs.',
  [SpellNote.FEEL_BETTER]: '  {} feels better.',
  [SpellNote.MIND_CLEAR]: '  {} mind cleared.',
  [SpellNote.ALERT]: '  {} feels alert.',
  [SpellNote.HEALED]: '  {} is healed.',
  [SpellNote.DRAINED_HP]: '  {} drained of health.',
  [SpellNote.SP_RECHARGED]: '  {} magic recharged.',
  [SpellNote.DRAINED_SP]: '  {} drained of magic.',
  [SpellNote.REVIVED]: '  {} returns to life!',
  [SpellNote.DIES]: '  {} dies.',
  [SpellNote.RALLIES]: '  {} rallies its courage.',
  [SpellNote.CLEANS_ACID]: '  {} cleans off acid.',
  [SpellNote.BREAKS_BARRIER]: '  {} breaks barrier.',
  [SpellNote.BREAKS_FORCECAGE]: '  {} breaks force cage.',
  [SpellNote.OBLITERATED]: '  {} is obliterated!',
  [SpellNote.TRAPPED]: '  {} is trapped!',
  [SpellNote.THROWS_DART]: '  Throws dart at {}.',
  [SpellNote.THROWS_KNIFE]: '  Throws knife at {}.',
  [SpellNote.FIRES_RAY]: '  Fires ray at {}.',
  [SpellNote.GAZES2]: '  Gazes at {}.',
  [SpellNote.BREATHES_ON]: '  Breathes on {}.',
  [SpellNote.THROWS_WEB]: '  Throws web at {}.',
  [SpellNote.SPITS]: '  Spits at {}.',
  [SpellNote.BREATHES]: '  {} breaths.',
  [SpellNote.HEAT_RAY]: '  Hits {} with heat ray!',
  [SpellNote.DRAINED_XP]: '  {} drained.',
  [SpellNote.PROTECTED]: '  {} protected.',
  [SpellNote.KILLED]: '  {} is killed.',
};

/**
 * `iLiving::print_result` (living.hpp:83) — a static hook the game points at the
 * transcript. Kept as a module-level sink for the same reason the C++ keeps it
 * static: status effects fire from deep inside the damage pipeline and don't
 * have the Universe to hand. `Universe`'s constructor installs it; tests that
 * only exercise arithmetic can leave it unset, which silences the messages
 * exactly as a null `print_result` does.
 */
let printResultSink: ((line: string) => void) | null = null;

export function setPrintResult(fn: ((line: string) => void) | null): void {
  printResultSink = fn;
}

export function printResult(line: string): void {
  printResultSink?.(line);
}

/**
 * `one_sound`/`play_sound` are globals in the C++ too, and status effects call
 * them from just as deep. Same arrangement as `printResult`: the game installs
 * a sink, and with none installed the effects are simply silent.
 */
let soundSink: ((which: number) => void) | null = null;

export function setLivingSound(fn: ((which: number) => void) | null): void {
  soundSink = fn;
}

export function livingSound(which: number): void {
  soundSink?.(which);
}

/**
 * `get_ran` is a global in the C++ as well, and a handful of effects reach for
 * it from methods this port gives no `rng` argument (`magic_adjust` is called
 * by acid, curse, web, drain and half a dozen others). Same arrangement again:
 * the game installs the stream. With none installed the roll falls back to a
 * throwaway generator, which keeps tests that build a bare Creature working
 * without silently changing the shared stream.
 */
let rngSink: GameRng | null = null;

export function setLivingRng(rng: GameRng | null): void {
  rngSink = rng;
}

export function livingRng(): GameRng {
  rngSink ??= new GameRng();
  return rngSink;
}

export abstract class Living {
  /** Timed status effects indexed by `Status`; 0 means "not afflicted". */
  status: number[] = new Array<number>(NUM_STATUSES).fill(0);
  /** Action points left this combat turn. */
  ap = 0;
  direction: Direction = Direction.N;
  /** Damage pending display, for the hit animation. */
  markedDamage = 0;

  abstract get isAlive(): boolean;
  /** Friendly *to the party*. */
  abstract get isFriendly(): boolean;
  abstract isFriendlyTo(other: Living): boolean;
  abstract isShielded(rng: GameRng): boolean;
  /** How much of `baseDmg` a martyr's shield passes on to its allies. */
  abstract getSharedDmg(baseDmg: number, rng: GameRng): number;

  abstract heal(howMuch: number): void;
  abstract poison(howMuch: number, rng: GameRng): void;
  abstract cure(howMuch: number): void;
  abstract acid(howMuch: number): void;
  abstract curse(howMuch: number): void;
  abstract slow(howMuch: number): void;
  abstract web(howMuch: number): void;
  abstract disease(howMuch: number, rng: GameRng): void;
  abstract dumbfound(howMuch: number, rng: GameRng): void;
  abstract scare(howMuch: number): void;
  /** Also handles paralysis, charm and forcecage — hence the `type`. */
  abstract sleep(type: Status, howMuch: number, adj: number, rng: GameRng): void;
  abstract avatar(): void;
  abstract drainSp(howMuch: number, allowResist: boolean): void;
  abstract restoreSp(howMuch: number): void;

  abstract getHealth(): number;
  abstract getMagic(): number;
  abstract getLevel(): number;
  abstract getLoc(): Location;
  abstract getName(): string;

  /** iLiving::apply_status (living.cpp:18). */
  applyStatus(which: Status, howMuch: number): void {
    if (!this.isAlive) return;
    let [lo, hi] = statusBounds(which);
    // Sleep and dumbfounding don't wrap through zero: a negative value (the
    // resistance side) can only be made less negative, and vice versa.
    if (which === Status.ASLEEP || which === Status.DUMB) {
      if ((this.status[which] ?? 0) < 0) hi = 0;
      else lo = 0;
    }
    this.status[which] = minmax(lo, hi, (this.status[which] ?? 0) + howMuch);
  }

  /**
   * clear_bad_status (living.cpp:33) — drop the afflictions but keep the
   * benefits. "Bad" is per-status: for a negative status any positive value is
   * the affliction, and for a positive one it's the negative values.
   */
  clearBadStatus(): void {
    for (let i = 0; i < NUM_STATUSES; i++) {
      const value = this.status[i] ?? 0;
      const bad = statusInfo(i as Status).isNegative ? value > 0 : value < 0;
      if (bad) this.status[i] = 0;
    }
  }

  /**
   * clear_brief_status (living.cpp:41) — what a night's rest or a level exit
   * wipes. Poison, disease and dumbfounding stick, and so does a bad case of
   * acid (more than 2).
   */
  clearBriefStatus(): void {
    for (let i = 0; i < NUM_STATUSES; i++) {
      if (i === Status.POISON || i === Status.DISEASE || i === Status.DUMB) continue;
      if (i === Status.ACID && (this.status[i] ?? 0) > 2) continue;
      this.status[i] = 0;
    }
  }

  /** void_sanctuary — anything that gives you away drops invisibility. */
  voidSanctuary(): void {
    if ((this.status[Status.INVISIBLE] ?? 0) > 0) this.status[Status.INVISIBLE] = 0;
  }

  /** iLiving::spell_note (living.cpp:69). */
  spellNote(note: SpellNote): void {
    if (note === SpellNote.NONE) return;
    const msg = SPELL_NOTE_MSG[note] ?? `{}: Unknown action ${note}`;
    printResult(msg.replace('{}', this.getName()));
  }

  /** iLiving::print_attacks (living.cpp:...). */
  printAttacks(target: Living): void {
    const name = target === this ? 'themself' : target.getName();
    printResult(`${this.getName()} attacks ${name}`);
  }

  /** iLiving::damaged_msg — "N+M" when some of the damage was a special type. */
  damagedMsg(howMuch: number, extra: number): void {
    if (howMuch === 0 && extra === 0) return;
    if (extra > 0) printResult(`  ${this.getName()} takes ${howMuch}+${extra}`);
    else printResult(`  ${this.getName()} takes ${howMuch}`);
  }
}
