/**
 * The specials VM — run_special (boe.specials.cpp:2022).
 *
 * A chain is a linked list of 15-short nodes: each one acts, then names the
 * next in `jumpto` (or -1 to stop). The machinery *around* each node is the
 * part that matters most for fidelity, so it's ported first and verbatim:
 *
 *  - **Pointer resolution.** Any field <= -10 is not a value but a pointer;
 *    -N reads party pointer N. This happens to every field of every node
 *    before the node runs (resolve_pointers, :4683).
 *  - **The reserved pointers.** Before a chain starts, pointers 10, 11 and 12
 *    are forced to the trigger location and its terrain.
 *  - **One chain at a time.** A node that starts another chain queues it
 *    instead of nesting; the queue drains when the current chain ends.
 *  - **Messages.** Nodes with a `check_mess` flag print their m1/m2 strings
 *    after acting — except in TALK mode, where the strings become the
 *    conversation's reply instead of a dialog.
 *
 * The C++ blocks on dialogs via ASYNCIFY; every handler here is async and
 * awaits the host instead.
 */

import { Location, loc } from '../../core/location';
import { SpecType, SpecialNode, emptySpecialNode } from '../../data/special';
import { Universe } from '../../universe/universe';
import {
  PendingSpecial, SpecCat, SpecCtx, SpecCtxType, SpecialCtx, SpecialHost, categoryOf,
} from './context';
import { generalSpec } from './general';
import { ifThenSpec } from './ifthen';
import { oneshotSpec } from './oneshot';
import { townSpec } from './town';
import { rectSpec } from './rect';
import { outdoorSpec } from './outdoor';
import { affectSpec } from './affect';

/** What a chain hands back to whatever triggered it. */
export interface SpecialResult {
  a: number;
  b: number;
  redraw: boolean;
}

/**
 * Owns the one-chain-at-a-time rule and the pending queue. One instance lives
 * on the GameSession.
 */
export class SpecialsEngine {
  private inProgress = false;
  private queue: PendingSpecial[] = [];
  /** Set by END_SCENARIO; stops everything. */
  endScenario = false;

  constructor(
    private univ: Universe,
    private host: SpecialHost,
  ) {}

  /** get_node (boe.specials.cpp:2178) — fetch by number from the right list. */
  private getNode(which: number, type: SpecCtxType): SpecialNode {
    const invalid = { ...emptySpecialNode(), type: SpecType.INVALID };
    let node: SpecialNode | undefined;
    switch (type) {
      case SpecCtxType.SCEN:
        node = this.univ.scenario.scenSpecials.get(which);
        break;
      case SpecCtxType.OUTDOOR:
        node = this.univ.out.sector.specials.get(which);
        break;
      case SpecCtxType.TOWN:
        node = this.univ.town?.record.specials.get(which);
        break;
    }
    if (!node) {
      this.univ.addStringToBuf(`The scenario called a special node out of range: ${which}`);
      return invalid;
    }
    return node;
  }

  /**
   * resolve_pointers (:4683) — a field <= -10 names a party pointer rather
   * than holding a value. Returns a copy; the stored node is never modified.
   */
  private resolvePointers(node: SpecialNode): SpecialNode {
    const deref = (v: number): number => (v <= -10 ? this.univ.party.getPtr(-v) : v);
    return {
      type: node.type,
      sd1: deref(node.sd1), sd2: deref(node.sd2),
      m1: deref(node.m1), m2: deref(node.m2), m3: deref(node.m3),
      pic: deref(node.pic), pictype: deref(node.pictype),
      ex1a: deref(node.ex1a), ex1b: deref(node.ex1b), ex1c: deref(node.ex1c),
      ex2a: deref(node.ex2a), ex2b: deref(node.ex2b), ex2c: deref(node.ex2c),
      jumpto: deref(node.jumpto),
    };
  }

  /**
   * run_special. `startSpec` < 0 is a no-op. Returns the two values the caller
   * cares about — for movement, `a` means blocked and `b` means forced.
   */
  async run(
    whichMode: SpecCtx,
    whichType: SpecCtxType,
    startSpec: number,
    specLoc: Location,
  ): Promise<SpecialResult> {
    if (startSpec < 0) return { a: -1, b: -1, redraw: false };

    // Only one chain at a time: anything triggered mid-chain waits its turn.
    if (this.inProgress) {
      this.queue.push({
        spec: startSpec,
        mode: whichMode,
        type: whichType,
        where: specLoc,
        triggerTime: this.univ.party.age,
      });
      return { a: -1, b: -1, redraw: false };
    }

    const ctx: SpecialCtx = {
      whichMode,
      nextSpec: startSpec,
      nextSpecType: whichType,
      curSpecType: whichType,
      curSpec: emptySpecialNode(),
      specLoc,
      // -1 is "nothing to report"; TALK mode uses these slots for string
      // numbers, where 0 is a real answer.
      retA: -1,
      retB: -1,
      redraw: false,
      curTarget: null,
      host: this.host,
    };
    this.inProgress = true;

    if (this.endScenario) {
      this.inProgress = false;
      return { a: -1, b: -1, redraw: false };
    }

    // Reserved pointers 10/11/12: where the chain fired and what's there.
    this.univ.party.forcePtr(10, specLoc.x);
    this.univ.party.forcePtr(11, specLoc.y);
    this.univ.party.forcePtr(12, this.terrainAt(specLoc));

    // A chain that loops forever would hang the browser, which the C++ can at
    // least be force-quit out of; cap it and say so.
    let steps = 0;
    const MAX_STEPS = 20000;

    while (ctx.nextSpec >= 0) {
      const curSpec = ctx.nextSpec;
      ctx.curSpecType = ctx.nextSpecType;
      ctx.nextSpec = -1;
      ctx.curSpec = this.resolvePointers(this.getNode(curSpec, ctx.curSpecType));

      if (ctx.curSpec.type === SpecType.INVALID) break;

      switch (categoryOf(ctx.curSpec.type)) {
        case SpecCat.GENERAL: await generalSpec(this.univ, ctx, this); break;
        case SpecCat.ONCE: await oneshotSpec(this.univ, ctx); break;
        case SpecCat.AFFECT: await affectSpec(this.univ, ctx); break;
        case SpecCat.IF_THEN: await ifThenSpec(this.univ, ctx); break;
        case SpecCat.TOWN: await townSpec(this.univ, ctx); break;
        case SpecCat.RECT: await rectSpec(this.univ, ctx); break;
        case SpecCat.OUTDOOR: await outdoorSpec(this.univ, ctx); break;
        default:
          ctx.nextSpec = -1;
          break;
      }

      if (++steps > MAX_STEPS) {
        this.univ.addStringToBuf('SPECIAL ENCOUNTER INTERRUPTED.');
        ctx.nextSpec = -1;
      }
    }

    this.inProgress = false;

    // Drain whatever the chain queued, carrying each one's trigger time.
    const pending = this.queue.shift();
    if (pending) {
      const storeTime = this.univ.party.age;
      this.univ.party.age = pending.triggerTime;
      const nested = await this.run(pending.mode, pending.type, pending.spec, pending.where);
      this.univ.party.age = Math.max(this.univ.party.age, storeTime);
      return {
        a: Math.max(ctx.retA, nested.a),
        b: Math.max(ctx.retB, nested.b),
        redraw: ctx.redraw || nested.redraw,
      };
    }

    return { a: ctx.retA, b: ctx.retB, redraw: ctx.redraw };
  }

  /** coord_to_ter — the terrain type at a location, wherever the party is. */
  terrainAt(where: Location): number {
    const town = this.univ.town;
    if (town) return town.record.terrain[where.x]?.[where.y] ?? 0;
    return this.univ.out.at(where.x, where.y);
  }

  /** Whether a chain is running, so callers know not to expect an answer yet. */
  get busy(): boolean {
    return this.inProgress;
  }
}

/** setsd (:4617) — write an SDF, complaining if it doesn't exist. */
export function setSdf(univ: Universe, row: number, col: number, value: number): void {
  if (!univ.party.sdLegit(row, col)) {
    univ.addStringToBuf('The scenario attempted to change an out of range Stuff Done flag.');
    return;
  }
  univ.party.setSdf(row, col, value);
}

/**
 * handle_message (:4625) — print a node's m1/m2 strings. In TALK mode they
 * become the conversation's reply instead, which is how a special can answer
 * for an NPC.
 */
export async function handleMessage(
  univ: Universe,
  ctx: SpecialCtx,
  title = '',
  pic = -1,
  picType = 0,
): Promise<void> {
  const node = ctx.curSpec;
  if (node.m1 < 0 && node.m2 < 0) return;
  if (ctx.whichMode === SpecCtx.TALK) {
    ctx.retA = node.m1;
    ctx.retB = node.m2;
    return;
  }
  const [str1, str2] = univ.getStrs(ctx.curSpecType, node.m1, node.m2);
  if (str1.length === 0 && str2.length === 0) return;
  await ctx.host.message(str1, str2, title, pic, picType);
}

/** A location built from a node's two coordinate fields. */
export function nodeLoc(x: number, y: number): Location {
  return loc(x, y);
}
