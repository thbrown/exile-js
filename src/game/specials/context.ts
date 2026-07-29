/**
 * The specials VM's shared vocabulary: what triggered a chain, where its nodes
 * live, and the runtime state threaded through every handler.
 *
 * Enum values are verbatim (special.hpp:121-155) because `.spec` files and save
 * files store them.
 */

import { Location } from '../../core/location';
import { SpecType, SpecialNode } from '../../data/special';
import type { GameSession } from '../session';
import type { Skill } from '../../universe/skills';

/** eSpecCtx (special.hpp:135) — what caused this chain to run. */
export enum SpecCtx {
  OUT_MOVE = 0, TOWN_MOVE, COMBAT_MOVE, OUT_LOOK, TOWN_LOOK,
  ENTER_TOWN, LEAVE_TOWN, TALK, USE_SPEC_ITEM, TOWN_TIMER,
  SCEN_TIMER, PARTY_TIMER, KILL_MONST, OUTDOOR_ENC, FLEE_ENCOUNTER,
  WIN_ENCOUNTER, TARGET, USE_SPACE, SEE_MONST, MONST_SPEC_ABIL,
  TOWN_HOSTILE, ATTACKING_MELEE, ATTACKING_RANGE, ATTACKED_MELEE, ATTACKED_RANGE,
  HAIL, SHOPPING, DROP_ITEM, STARTUP,
}

/** eSpecCtxType (special.hpp:121) — which list a node number indexes. */
export enum SpecCtxType {
  SCEN = 0,
  OUTDOOR = 1,
  TOWN = 2,
}

/** eSpecCat (special.hpp:152). */
export enum SpecCat {
  INVALID = -1,
  GENERAL, ONCE, AFFECT, IF_THEN, TOWN, RECT, OUTDOOR,
}

/**
 * Category ranges, from the CAT_* definitions in scenario/special-*.cpp. Each
 * category is a contiguous run of type numbers, so a range check is enough.
 */
const CATEGORY_RANGES: [SpecCat, SpecType, SpecType][] = [
  [SpecCat.GENERAL, SpecType.NONE, SpecType.STR_BUF_TO_SIGN],
  [SpecCat.ONCE, SpecType.ONCE_GIVE_ITEM, SpecType.ONCE_TRAP],
  [SpecCat.AFFECT, SpecType.SELECT_TARGET, SpecType.UNSTORE_PC],
  [SpecCat.IF_THEN, SpecType.IF_SDF, SpecType.IF_QUEST],
  [SpecCat.TOWN, SpecType.MAKE_TOWN_HOSTILE, SpecType.TOWN_PLACE_LABEL],
  [SpecCat.RECT, SpecType.RECT_PLACE_FIELD, SpecType.RECT_UNLOCK],
  [SpecCat.OUTDOOR, SpecType.OUT_MAKE_WANDER, SpecType.OUT_MOVE_PARTY],
];

export function categoryOf(type: SpecType): SpecCat {
  for (const [cat, first, last] of CATEGORY_RANGES)
    if (type >= first && type <= last) return cat;
  return SpecCat.INVALID;
}

/**
 * What the VM needs from the host to do anything visible. Everything here is
 * async because the C++ blocks on a dialog and we await one instead.
 */
export interface SpecialHost {
  /** cStrDlog — two paragraphs, a title and a picture. */
  message(str1: string, str2: string, title: string, pic: number, picType: number): Promise<void>;
  /** A dialog with up to three labelled buttons; resolves to the index picked. */
  choice(
    strs: string[], buttons: string[], title: string, pic: number, picType: number,
  ): Promise<number>;
  /** get_text_response — a typed answer, for IF_TEXT_RESPONSE. */
  askText(prompt: string): Promise<string>;
  /** select_pc, for the nodes that need a specific party member. */
  /**
   * `select_pc(ONLY_LIVING, prompt, skill)`. `highlight` is the skill the
   * dialog shows and marks the best value of — the disarm roll picks a PC by
   * Disarm Traps, for instance.
   */
  selectPc(prompt: string, highlight?: Skill): Promise<number>;
  /** start_shop_mode, for ENTER_SHOP. */
  startShop(which: number, costAdj: number, name: string): boolean;
  /** start_talk_mode, for START_TALK. */
  startTalk(monsterIndex: number, personality: number, monsterType: number, pic: number): void;
  /** play_sound; a negative number means "asynchronously" as in the C++. */
  sound(which: number): void;
  /** do_rest, for the REST node. */
  rest(length: number, hp: number, sp: number): void;
  /** Move the party, for the town/outdoor relocation nodes. */
  moveParty(where: Location): void;
  /** Change level, for TOWN_STAIR and friends. */
  changeLevel(town: number, where: Location): void;
  /** The scenario is over. */
  endScenario(): void;
}

/** The `runtime_state` struct (boe.specials.cpp), plus the async host. */
export interface SpecialCtx {
  /** What triggered this chain. */
  whichMode: SpecCtx;
  /** The node about to run, or -1 to stop. */
  nextSpec: number;
  nextSpecType: SpecCtxType;
  curSpecType: SpecCtxType;
  /** The node currently running, with pointers already resolved. */
  curSpec: SpecialNode;
  /** Where the trigger happened. */
  specLoc: Location;
  /**
   * The two return slots. Their meaning depends on whichMode:
   * movement a=blocked, b=forced; look a=search blocked; talk a,b=strings;
   * encounter a=monsters flee, b=forced.
   */
  retA: number;
  retB: number;
  redraw: boolean;
  /**
   * SELECT_TARGET's choice, or null for "the default target" — the whole party
   * outside combat, the active PC inside it.
   */
  curTarget: number | null;
  host: SpecialHost;
  /**
   * The running game. The C++ reaches for the `univ` global plus a handful of
   * free functions (`set_town_attitude`, `start_town_combat`…); those live on
   * GameSession here, so a node that needs one gets at it through this.
   */
  session: GameSession;
}

/** A chain waiting for the current one to finish (special_queue). */
export interface PendingSpecial {
  spec: number;
  mode: SpecCtx;
  type: SpecCtxType;
  where: Location;
  triggerTime: number;
}
