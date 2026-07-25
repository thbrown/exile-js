/**
 * The GENERAL opcode group — general_spec (boe.specials.cpp:2213). Flags,
 * arithmetic, messages, terrain edits, and the string buffer.
 */

import { SpecType } from '../../data/special';
import { interestingString } from '../../data/item';
import { BUFFER_STR, Universe } from '../../universe/universe';
import { doRest } from '../rest';
import { SpecCtx, SpecCtxType, SpecialCtx } from './context';
import { SpecialsEngine, handleMessage, setSdf } from './vm';

export async function generalSpec(
  univ: Universe, ctx: SpecialCtx, engine: SpecialsEngine,
): Promise<void> {
  const spec = ctx.curSpec;
  const { party } = univ;
  let checkMess = false;
  ctx.nextSpec = spec.jumpto;

  /** Read an SDF pair, or take ex?a literally when ex?b is -1. */
  const operand = (a: number, b: number): number =>
    (b === -1 ? a : party.getSdf(a, b));

  switch (spec.type) {
    case SpecType.NONE:
      break;

    case SpecType.SET_SDF:
      checkMess = true;
      setSdf(univ, spec.sd1, spec.sd2, spec.ex1a);
      break;

    case SpecType.INC_SDF:
      checkMess = true;
      // ex1b picks the direction: 0 adds, anything else subtracts.
      setSdf(univ, spec.sd1, spec.sd2,
        party.getSdf(spec.sd1, spec.sd2) + (spec.ex1b === 0 ? 1 : -1) * spec.ex1a);
      break;

    case SpecType.FLIP_SDF:
      checkMess = true;
      setSdf(univ, spec.sd1, spec.sd2, party.getSdf(spec.sd1, spec.sd2) === 0 ? 1 : 0);
      break;

    case SpecType.SDF_RANDOM: {
      checkMess = true;
      // A backwards or degenerate range is silently fixed up.
      const value = spec.ex1a === spec.ex1b
        ? spec.ex1b
        : univ.rng.getRan(1, Math.min(spec.ex1a, spec.ex1b), Math.max(spec.ex1a, spec.ex1b));
      setSdf(univ, spec.sd1, spec.sd2, value);
      break;
    }

    // SDF arithmetic: sd1/sd2 is the output, ex1* the left operand, ex2* the
    // right; division also writes its remainder to ex1c/ex2c.
    case SpecType.SDF_ADD:
    case SpecType.SDF_DIFF:
    case SpecType.SDF_TIMES:
    case SpecType.SDF_DIVIDE:
    case SpecType.SDF_POWER: {
      checkMess = true;
      const i = operand(spec.ex1a, spec.ex1b);
      const j = operand(spec.ex2a, spec.ex2b);
      switch (spec.type) {
        case SpecType.SDF_ADD: setSdf(univ, spec.sd1, spec.sd2, i + j); break;
        case SpecType.SDF_DIFF: setSdf(univ, spec.sd1, spec.sd2, i - j); break;
        case SpecType.SDF_TIMES: setSdf(univ, spec.sd1, spec.sd2, i * j); break;
        case SpecType.SDF_DIVIDE:
          if (party.sdLegit(spec.sd1, spec.sd2))
            setSdf(univ, spec.sd1, spec.sd2, j === 0 ? 0 : Math.trunc(i / j));
          if (party.sdLegit(spec.ex1c, spec.ex2c))
            setSdf(univ, spec.ex1c, spec.ex2c, j === 0 ? 0 : i % j);
          break;
        case SpecType.SDF_POWER:
          setSdf(univ, spec.sd1, spec.sd2, i === 2 ? 1 << j : Math.pow(i, j));
          break;
        default: break;
      }
      break;
    }

    case SpecType.SET_SDF_ROW:
      if (spec.sd1 < 0 || spec.sd1 > 299)
        univ.addStringToBuf('Stuff Done flag out of range.');
      else for (let i = 0; i < 50; i++) party.setSdf(spec.sd1, i, spec.ex1a);
      break;

    case SpecType.COPY_SDF:
      if (!party.sdLegit(spec.sd1, spec.sd2) || !party.sdLegit(spec.ex1a, spec.ex1b))
        univ.addStringToBuf('Stuff Done flag out of range.');
      else party.setSdf(spec.sd1, spec.sd2, party.getSdf(spec.ex1a, spec.ex1b));
      break;

    case SpecType.SET_POINTER:
      if (spec.ex1a < 0)
        univ.addStringToBuf('Attempted to assign a pointer out of range (100..199)');
      else if (spec.sd1 < 0 && spec.sd2 < 0) party.clearPtr(spec.ex1a);
      else party.setPtr(spec.ex1a, spec.sd1, spec.sd2);
      break;

    case SpecType.DISPLAY_MSG:
      checkMess = true;
      break;

    case SpecType.TITLED_MSG:
      await handleMessage(univ, ctx,
        univ.getStr(ctx.curSpecType, spec.m3) ?? '', spec.pic, spec.pictype);
      break;

    case SpecType.DISPLAY_SM_MSG: {
      // Straight into the transcript rather than a dialog.
      const [str1, str2] = univ.getStrs(ctx.curSpecType, spec.m1, spec.m2);
      if (spec.m1 >= 0) univ.addStringToBuf(str1);
      if (spec.m2 >= 0) univ.addStringToBuf(str2);
      break;
    }

    case SpecType.DISPLAY_PICTURE:
      await ctx.host.message(
        univ.getStr(ctx.curSpecType, spec.m1) ?? '', '', '', spec.ex1a, spec.pictype);
      break;

    case SpecType.STORY_DIALOG:
      // TODO(M6): story_dialog paginates a run of strings with Back/Next; for
      // now the first page is shown, which is what a one-string story is.
      await ctx.host.message(
        univ.getStr(ctx.curSpecType, spec.m1) ?? '',
        univ.getStr(ctx.curSpecType, spec.m2) ?? '',
        '', spec.pic, spec.pictype);
      break;

    case SpecType.CANT_ENTER:
      checkMess = true;
      if (ctx.whichMode === SpecCtx.TALK) {
        // In a conversation this ends the talk rather than blocking a step.
        ctx.retB = spec.ex1a;
      } else if (spec.ex1a !== 0) {
        ctx.retA = 1;
      } else {
        ctx.retA = 0;
        if (spec.ex2a !== 0) ctx.retB = 1;
      }
      break;

    case SpecType.CHANGE_TIME:
      checkMess = true;
      party.age += spec.ex1a;
      break;

    case SpecType.REST:
      checkMess = true;
      doRest(univ, Math.max(spec.ex1a, 0), Math.max(spec.ex1b, 0), Math.max(spec.ex1b, 0));
      break;

    case SpecType.PLAY_SOUND:
      // ex1b picks synchronous; the C++ negates the number for async.
      ctx.host.sound(spec.ex1b ? spec.ex1a : -spec.ex1a);
      break;

    case SpecType.SET_TOWN_VISIBILITY: {
      checkMess = true;
      const town = univ.scenario.towns[spec.ex1a];
      if (!town) univ.addStringToBuf('Town out of range.');
      else town.canFind = spec.ex2a !== 0;
      ctx.redraw = true;
      break;
    }

    case SpecType.MAJOR_EVENT_OCCURRED:
      checkMess = true;
      if (spec.ex1a < 1 || spec.ex1a > 10) univ.addStringToBuf('Event code out of range.');
      else if (!party.keyTimes.has(spec.ex1a))
        party.keyTimes.set(spec.ex1a, party.calcDay());
      break;

    case SpecType.CALL_GLOBAL:
      // The rest of the chain reads from the scenario's node list.
      ctx.nextSpecType = SpecCtxType.SCEN;
      break;

    case SpecType.END_SCENARIO:
      engine.endScenario = true;
      ctx.host.endScenario();
      break;

    case SpecType.CHANGE_TER:
      alterSpace(univ, spec.ex1a, spec.ex1b, spec.ex2a);
      ctx.redraw = true;
      checkMess = true;
      break;

    case SpecType.SWAP_TER: {
      // Two terrain types trade places on one square.
      const at = engine.terrainAt({ x: spec.ex1a, y: spec.ex1b });
      if (at === spec.ex2a) alterSpace(univ, spec.ex1a, spec.ex1b, spec.ex2b);
      else if (at === spec.ex2b) alterSpace(univ, spec.ex1a, spec.ex1b, spec.ex2a);
      ctx.redraw = true;
      checkMess = true;
      break;
    }

    case SpecType.TRANS_TER: {
      const at = engine.terrainAt({ x: spec.ex1a, y: spec.ex1b });
      const to = univ.scenario.terTypes[at]?.transToWhat ?? -1;
      if (to >= 0) alterSpace(univ, spec.ex1a, spec.ex1b, to);
      ctx.redraw = true;
      checkMess = true;
      break;
    }

    case SpecType.ENTER_SHOP:
      ctx.host.startShop(
        spec.ex1a, Math.max(0, Math.min(6, spec.ex2b)),
        univ.getStr(ctx.curSpecType, spec.m1) ?? '');
      ctx.nextSpec = -1;
      break;

    case SpecType.START_TALK:
      ctx.host.startTalk(-1, spec.ex1a, spec.ex1b, spec.pic);
      ctx.nextSpec = -1;
      break;

    // The string buffer: scripts assemble a line and then print it as
    // message number BUFFER_STR.
    case SpecType.CLEAR_BUF:
      univ.strBuf = '';
      break;

    case SpecType.APPEND_STRING:
      if (spec.pic) univ.strBuf += ' ';
      univ.strBuf += univ.getStr(ctx.curSpecType, spec.ex1a) ?? '';
      break;

    case SpecType.APPEND_NUM:
      if (spec.pic) univ.strBuf += ' ';
      univ.strBuf += String(spec.ex1a);
      break;

    case SpecType.APPEND_MONST:
      if (spec.pic) univ.strBuf += ' ';
      univ.strBuf += spec.ex1a === 0
        ? 'Your party'
        : univ.scenario.scenMonsters[spec.ex1a]?.name ?? '';
      break;

    case SpecType.APPEND_ITEM: {
      if (spec.pic) univ.strBuf += ' ';
      const item = univ.scenario.scenItems[spec.ex1a];
      if (item) {
        if (spec.ex1b === 1) univ.strBuf += item.fullName;
        else if (spec.ex1b === 2) univ.strBuf += interestingString(item);
        else univ.strBuf += item.name;
      }
      break;
    }

    case SpecType.APPEND_TER:
      if (spec.pic) univ.strBuf += ' ';
      univ.strBuf += univ.scenario.terTypes[spec.ex1a]?.name ?? '';
      break;

    case SpecType.SWAP_STR_BUF:
      univ.swapBuf(spec.ex1a);
      break;

    case SpecType.STR_BUF_TO_SIGN: {
      // The buffer and the sign's text trade places, so a script can read a
      // sign by swapping twice.
      if (spec.ex1a < 0) break;
      const signs = univ.town ? univ.town.record.signLocs : univ.out.sector.signLocs;
      const sign = signs[spec.ex1a];
      if (!sign) break;
      const tmp = sign.text;
      sign.text = univ.strBuf;
      univ.strBuf = tmp;
      break;
    }

    case SpecType.PAUSE:
      // The C++ sleeps the whole game; here the frame loop keeps running, so
      // there is nothing to do but let the redraw happen.
      ctx.redraw = true;
      break;

    case SpecType.PRINT_NUMS:
      // Debug-mode only in the original, and this port has no debug mode yet.
      break;

    case SpecType.SCEN_TIMER_START:
      // TODO(M6): scenario timers need cParty::start_timer and the tick loop.
      checkMess = true;
      break;

    case SpecType.FORCED_GIVE:
    case SpecType.BUY_ITEMS_OF_TYPE:
    case SpecType.UPDATE_QUEST:
    case SpecType.SET_CAMP_FLAG:
    case SpecType.CHANGE_HORSE_OWNER:
    case SpecType.CHANGE_BOAT_OWNER:
      // TODO(M6): quests, campaign flags, boats and horses.
      reportUnsupported(univ, spec.type);
      break;

    default:
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
}

/** alter_space — write a terrain type and remember it in the town's map. */
export function alterSpace(univ: Universe, x: number, y: number, ter: number): void {
  if (ter < 0) return;
  const town = univ.town;
  if (town) {
    if (town.record.terrain[x]?.[y] === undefined) return;
    town.record.terrain[x]![y] = ter;
  } else {
    univ.out.set(x, y, ter);
  }
}

const reported = new Set<SpecType>();

/** Say once per type that a node needs a system this port hasn't built. */
export function reportUnsupported(univ: Universe, type: SpecType): void {
  if (reported.has(type)) return;
  reported.add(type);
  univ.addStringToBuf(`(${SpecType[type] ?? type} special nodes are not implemented yet)`);
}

export { BUFFER_STR };
