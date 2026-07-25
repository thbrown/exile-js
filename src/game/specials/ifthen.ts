/**
 * The IF_THEN opcode group — ifthen_spec (boe.specials.cpp:3351). Every node
 * here is a branch: it tests something and, if it passes, redirects the chain
 * by setting `nextSpec` to a node number other than the default `jumpto`.
 *
 * The comparison-mode convention recurs throughout: -2 is <=, -1 is <, 0 is ==,
 * 1 is >, 2 is >=.
 */

import { FieldType } from '../../data/fields';
import { ItemType } from '../../data/item';
import { SpecType } from '../../data/special';
import { NUM_INVEN_SLOTS } from '../../universe/player';
import { MainStatus, Skill, Status } from '../../universe/skills';
import { takeItem } from '../../universe/inventory';
import { Universe } from '../../universe/universe';
import { SpecCtx, SpecCtxType, SpecialCtx } from './context';
import { handleMessage, setSdf } from './vm';
import { reportUnsupported } from './general';

/** The shared comparison-mode test. */
function compare(mode: number, value: number, against: number): boolean {
  switch (mode) {
    case -2: return value <= against;
    case -1: return value < against;
    case 0: return value === against;
    case 1: return value > against;
    case 2: return value >= against;
    default: return false;
  }
}

/** party_size(count_only_alive). */
function partySize(univ: Universe, onlyAlive: boolean): number {
  return univ.party.pcs.filter((pc) => (onlyAlive
    ? pc.mainStatus === MainStatus.ALIVE
    : pc.mainStatus !== MainStatus.ABSENT)).length;
}

/**
 * check_party_stat's modes: 0 cumulative, 1 average, 2 minimum, 3 maximum,
 * 10+n a specific PC.
 */
function partyStat(univ: Universe, skill: Skill, mode: number): number {
  const read = (pc: (typeof univ.party.pcs)[number]): number => {
    switch (skill) {
      case Skill.CUR_HP: return pc.curHealth;
      case Skill.CUR_SP: return pc.curSp;
      case Skill.CUR_XP: return pc.experience;
      case Skill.CUR_SKILL: return pc.skillPts;
      case Skill.CUR_LEVEL: return pc.level;
      case Skill.MAX_HP: return pc.maxHealth;
      case Skill.MAX_SP: return pc.maxSp;
      default: return pc.skills[skill] ?? 0;
    }
  };
  if (mode >= 10) return read(univ.party.pcs[mode - 10] ?? univ.party.pcs[0]!);
  const alive = univ.party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE);
  if (alive.length === 0) return 0;
  const values = alive.map(read);
  switch (mode) {
    case 1: return Math.trunc(values.reduce((a, b) => a + b, 0) / values.length);
    case 2: return Math.min(...values);
    case 3: return Math.max(...values);
    default: return values.reduce((a, b) => a + b, 0);
  }
}

/** Which PC a node acts on: SELECT_TARGET's pick, else the party as a whole. */
function targetPc(univ: Universe, ctx: SpecialCtx): number {
  return ctx.curTarget ?? -1;
}

export async function ifThenSpec(univ: Universe, ctx: SpecialCtx): Promise<void> {
  const spec = ctx.curSpec;
  const { party } = univ;
  let checkMess = false;
  ctx.nextSpec = spec.jumpto;

  switch (spec.type) {
    case SpecType.IF_SDF:
      // Two independent tests: at-or-above ex1a, or below ex2a.
      if (party.sdLegit(spec.sd1, spec.sd2)) {
        const value = party.getSdf(spec.sd1, spec.sd2);
        if (spec.ex1a >= 0 && value >= spec.ex1a) ctx.nextSpec = spec.ex1b;
        else if (spec.ex2a >= 0 && value < spec.ex2a) ctx.nextSpec = spec.ex2b;
      }
      break;

    case SpecType.IF_SDF_EQ:
      if (party.sdLegit(spec.sd1, spec.sd2)
        && party.getSdf(spec.sd1, spec.sd2) === spec.ex1a) ctx.nextSpec = spec.ex1b;
      break;

    case SpecType.IF_SDF_COMPARE:
      if (party.sdLegit(spec.sd1, spec.sd2) && party.sdLegit(spec.ex1a, spec.ex1b)) {
        if (party.getSdf(spec.ex1a, spec.ex1b) < party.getSdf(spec.sd1, spec.sd2))
          ctx.nextSpec = spec.ex2b;
      } else univ.addStringToBuf('A Stuff Done flag is out of range.');
      break;

    case SpecType.IF_TOWN_NUM:
      if (univ.isInTown() && party.townNum === spec.ex1a) ctx.nextSpec = spec.ex1b;
      break;

    case SpecType.IF_RANDOM:
      if (univ.rng.getRan(1, 1, 100) < spec.ex1a) ctx.nextSpec = spec.ex1b;
      break;

    case SpecType.IF_HAVE_SPECIAL_ITEM:
      if (spec.ex1a < 0 || spec.ex1a > 49) univ.addStringToBuf('Special item is out of range.');
      else if (party.specItems.has(spec.ex1a)) ctx.nextSpec = spec.ex1b;
      break;

    case SpecType.IF_TER_TYPE: {
      const town = univ.town;
      const at = town
        ? town.record.terrain[spec.ex1a]?.[spec.ex1b]
        : univ.out.at(spec.ex1a, spec.ex1b);
      if (at === spec.ex2a) ctx.nextSpec = spec.ex2b;
      break;
    }

    case SpecType.IF_HAS_GOLD:
      if (party.gold >= spec.ex1a) {
        // ex2a means "and take it".
        if (spec.ex2a > 0) {
          party.gold -= spec.ex1a;
          univ.addStringToBuf(`  You give up ${spec.ex1a} gold.`);
        }
        ctx.nextSpec = spec.ex1b;
      }
      break;

    case SpecType.IF_HAS_FOOD:
      if (party.food >= spec.ex1a) {
        if (spec.ex2a > 0) {
          party.food -= spec.ex1a;
          univ.addStringToBuf(`  You give up ${spec.ex1a} food.`);
        }
        ctx.nextSpec = spec.ex1b;
      }
      break;

    case SpecType.IF_ITEM_CLASS_ON_SPACE: {
      const town = univ.town;
      if (!town) break;
      for (const item of town.items) {
        if (item.variety === ItemType.NO_ITEM) continue;
        if (item.specialClass !== spec.ex2a) continue;
        if (item.itemLoc.x !== spec.ex1a || item.itemLoc.y !== spec.ex1b) continue;
        ctx.nextSpec = spec.ex2b;
        // ex2c means "and consume it".
        if (spec.ex2c > 0) {
          ctx.redraw = true;
          item.variety = ItemType.NO_ITEM;
        }
      }
      break;
    }

    case SpecType.IF_HAVE_ITEM_CLASS: {
      // ex2a means "take one if found".
      let found = false;
      for (const pc of party.pcs) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
          const item = pc.items[i]!;
          if (item.variety === ItemType.NO_ITEM || item.specialClass !== spec.ex1a) continue;
          found = true;
          if (spec.ex2a > 0) {
            takeItem(pc, i);
            ctx.redraw = true;
          }
          break;
        }
        if (found) break;
      }
      if (found) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.IF_EQUIP_ITEM_CLASS:
      for (const pc of party.pcs) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
          if (!pc.equip[i]) continue;
          if (pc.items[i]!.specialClass !== spec.ex1a) continue;
          ctx.nextSpec = spec.ex1b;
          if (spec.ex2a > 0) {
            takeItem(pc, i);
            ctx.redraw = true;
          }
          break;
        }
      }
      break;

    case SpecType.IF_MAGE_SPELL:
    case SpecType.IF_PRIEST_SPELL: {
      if (spec.ex1a < 0 || spec.ex1a >= 62) break;
      const book = (pc: (typeof party.pcs)[number]) =>
        (spec.type === SpecType.IF_MAGE_SPELL ? pc.mageSpells : pc.priestSpells);
      const who = targetPc(univ, ctx);
      const pass = who >= 0 && who < 6
        ? book(party.pcs[who]!)[spec.ex1a] === true
        : party.pcs.some((pc) => book(pc)[spec.ex1a] === true);
      if (pass) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.IF_RECIPE:
      if (spec.ex1a < 0 || spec.ex1a >= 20)
        univ.addStringToBuf('Alchemy recipe out of range (0 - 19).');
      else if (party.alchemy[spec.ex1a]) ctx.nextSpec = spec.ex1b;
      break;

    case SpecType.IF_ALIVE: {
      const who = targetPc(univ, ctx);
      if (spec.ex1a === -1) {
        // "Is the target alive?" — with no chosen target that's the party.
        const alive = who >= 0
          ? party.pcs[who]?.mainStatus === MainStatus.ALIVE
          : party.pcs.some((pc) => pc.mainStatus === MainStatus.ALIVE);
        if (alive) ctx.nextSpec = spec.ex1b;
        break;
      }
      const WANTED: Record<number, MainStatus> = {
        0: MainStatus.DEAD, 1: MainStatus.DUST, 2: MainStatus.STONE,
        3: MainStatus.FLED, 4: MainStatus.SPLIT, 5: MainStatus.ABSENT,
      };
      const wanted = WANTED[spec.ex1a];
      if (wanted === undefined) break;
      const pass = who >= 0 && who < 6
        ? party.pcs[who]?.mainStatus === wanted
        : party.pcs.some((pc) => pc.mainStatus === wanted);
      if (pass) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.IF_STATUS: {
      if (spec.ex1a < 0 || spec.ex1a > 14) {
        univ.addStringToBuf('Invalid status effect (0...14)');
        break;
      }
      const status = spec.ex1a as Status;
      const who = targetPc(univ, ctx);
      let k: number;
      if (who >= 0 && who < 6) {
        const pc = party.pcs[who];
        k = pc?.mainStatus === MainStatus.ALIVE ? (pc.status[status] ?? 0) : 0;
      } else {
        // Across the party: ex2b picks total (0), average (1), min (2), max (3).
        const alive = party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE);
        const values = alive.map((pc) => pc.status[status] ?? 0);
        if (values.length === 0) k = 0;
        else if (spec.ex2b === 1) k = Math.trunc(values.reduce((a, b) => a + b, 0) / values.length);
        else if (spec.ex2b === 2) k = Math.min(...values);
        else if (spec.ex2b === 3) k = Math.max(...values);
        else k = values.reduce((a, b) => a + b, 0);
      }
      if (compare(spec.ex2c, k, spec.ex2a)) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.IF_DAY_REACHED:
      if (party.calcDay() >= spec.ex1a) ctx.nextSpec = spec.ex1b;
      break;

    case SpecType.IF_EVENT_OCCURRED: {
      // day_reached(day, event): the event must have happened, and its day plus
      // the delay must have passed.
      const when = party.keyTimes.get(spec.ex1b);
      if (spec.ex1b === 0) {
        if (party.calcDay() >= spec.ex1a) ctx.nextSpec = spec.ex2b;
      } else if (when !== undefined && party.calcDay() >= when + spec.ex1a) {
        ctx.nextSpec = spec.ex2b;
      }
      break;
    }

    case SpecType.IF_PARTY_SIZE: {
      // ex1a <= 0 counts only the living.
      const size = partySize(univ, spec.ex1a <= 0);
      if (spec.ex2a < 1 ? size === spec.ex2b : size >= spec.ex2b) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.IF_SPECIES:
    case SpecType.IF_TRAIT: {
      const limit = spec.type === SpecType.IF_SPECIES ? 21 : 16;
      if (spec.ex1a < 0 || spec.ex1a > limit) break;
      const count = spec.type === SpecType.IF_SPECIES
        ? party.pcs.filter((pc) =>
          pc.mainStatus === MainStatus.ALIVE && pc.race === spec.ex1a).length
        : party.pcs.filter((pc) =>
          pc.mainStatus === MainStatus.ALIVE && pc.traits[spec.ex1a] === true).length;
      const against = Math.max(1, Math.min(partySize(univ, true), spec.ex2a));
      if (compare(spec.ex2b, count, against)) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.IF_STATISTIC: {
      const valid = (spec.ex2a >= 0 && spec.ex2a <= 20) || (spec.ex2a >= 100 && spec.ex2a <= 104);
      if (!valid) {
        univ.addStringToBuf('Attempted to check an invalid statistic (0...20 or 100...104).');
        break;
      }
      let mode = spec.ex2b < -1 || spec.ex2b > 3 ? 0 : spec.ex2b;
      if (mode === -1) {
        // -1 means the PC chosen by SELECT_TARGET; without one, fall back.
        const who = targetPc(univ, ctx);
        if (who >= 0 && who < 6) {
          if (partyStat(univ, spec.ex2a as Skill, 10 + who) >= spec.ex1a)
            ctx.nextSpec = spec.ex1b;
          break;
        }
        mode = 0;
      }
      if (partyStat(univ, spec.ex2a as Skill, mode) >= spec.ex1a) ctx.nextSpec = spec.ex1b;
      break;
    }

    case SpecType.IF_TEXT_RESPONSE: {
      // Compares the first `pic` characters of the answer against two strings.
      const prompt = univ.getStr(SpecCtxType.SCEN, spec.m1) ?? '';
      const answer = await ctx.host.askText(prompt);
      const chars = Math.max(0, Math.min(50, spec.pic));
      const [str1, str2] = univ.getStrs(SpecCtxType.SCEN, spec.ex1a, spec.ex2a);
      const matches = (against: string): boolean =>
        answer.slice(0, chars).toLowerCase() === against.slice(0, chars).toLowerCase();
      if (spec.ex1a >= 0 && matches(str1)) ctx.nextSpec = spec.ex1b;
      if (spec.ex2a >= 0 && matches(str2)) ctx.nextSpec = spec.ex2b;
      break;
    }

    case SpecType.IF_NUM_RESPONSE: {
      // Two independent tests over one typed number; which pair passed picks
      // the destination (ex1c, ex2c, or pictype when both do).
      let lo = spec.m2;
      let hi = spec.m3;
      if (lo > hi) [lo, hi] = [hi, lo];
      const prompt = univ.getStr(SpecCtxType.SCEN, spec.m1) ?? '';
      const answer = await ctx.host.askText(`${prompt} (${lo}-${hi})`);
      const i = Math.max(lo, Math.min(hi, parseInt(answer, 10) || 0));
      setSdf(univ, spec.sd1, spec.sd2, Math.abs(i));

      const mode = Math.max(0, Math.min(2, spec.pic));
      let j = 0;
      const inRange = (a: number, b: number): boolean => a >= 0 && a < b && i >= a && i <= b;
      if (mode === 0) {
        if (inRange(spec.ex1a, spec.ex1b)) j += 1;
        if (inRange(spec.ex2a, spec.ex2b)) j += 2;
      } else if (mode === 1) {
        if (spec.ex1a >= 0 && spec.ex1a < spec.ex1b && !inRange(spec.ex1a, spec.ex1b)) j += 1;
        if (spec.ex2a >= 0 && spec.ex2a < spec.ex2b && !inRange(spec.ex2a, spec.ex2b)) j += 2;
      } else {
        if (spec.ex1a >= 0 && compare(spec.ex1b, i, spec.ex1a)) j += 1;
        if (spec.ex2a >= 0 && compare(spec.ex2b, i, spec.ex2a)) j += 2;
      }
      if (j === 1) ctx.nextSpec = spec.ex1c;
      else if (j === 2) ctx.nextSpec = spec.ex2c;
      else if (j === 3) ctx.nextSpec = spec.pictype;
      break;
    }

    case SpecType.IF_CONTEXT:
      if (ctx.whichMode === (spec.ex1a as SpecCtx)) {
        // For the three movement contexts this also decides whether to block.
        if (ctx.whichMode <= SpecCtx.COMBAT_MOVE) {
          ctx.retA = spec.ex1b ? 1 : 0;
          if (ctx.retA) {
            if (ctx.whichMode === SpecCtx.OUT_MOVE)
              univ.addStringToBuf("Can't go here while outdoors.");
            else if (ctx.whichMode === SpecCtx.TOWN_MOVE)
              univ.addStringToBuf("Can't go here while in town mode.");
            else univ.addStringToBuf("Can't go here during combat.");
          }
        }
        ctx.nextSpec = spec.ex1c;
      }
      break;

    case SpecType.IF_LOOKING:
      if (ctx.whichMode === SpecCtx.OUT_LOOK || ctx.whichMode === SpecCtx.TOWN_LOOK)
        ctx.nextSpec = spec.ex1c;
      break;

    case SpecType.IF_IN_BOAT:
      if (party.inBoat >= 0 && (spec.ex1b < 0 || spec.ex1b === party.inBoat))
        ctx.nextSpec = spec.ex1c;
      break;

    case SpecType.IF_ON_HORSE:
      if (party.inHorse >= 0 && (spec.ex1b < 0 || spec.ex1b === party.inHorse))
        ctx.nextSpec = spec.ex1c;
      break;

    case SpecType.IF_FIELDS: {
      // Count the squares in a rectangle carrying a field, and branch when the
      // total falls between sd1 and sd2 (boe.specials.cpp:3447).
      const town = univ.town;
      if (!town) break;
      const field = spec.m1 as FieldType;
      // Note the C++ uses one variable as both the running total and the x
      // coordinate (`i += univ.town.is_fire_wall(i,j)`). It reads like a typo,
      // but scenarios were authored against it, so it's reproduced.
      let count = 0;
      for (let j = spec.ex1b; j < Math.min(spec.ex2b, town.record.maxDim); j++)
        for (let k = spec.ex1a; k < Math.min(spec.ex2a, town.record.maxDim); k++) {
          // A non-zero pic means the border only.
          if (spec.pic > 0 && count > spec.ex1b && count < spec.ex2b
            && j > spec.ex1a && j < spec.ex2a) continue;
          if (town.hasField(count, j, field)) count++;
        }
      if (count >= spec.sd1 && count <= spec.sd2) ctx.nextSpec = spec.m2;
      break;
    }

    case SpecType.IF_QUEST:
      // TODO(M6): quests need the party's active_quests table.
      reportUnsupported(univ, spec.type);
      break;

    default:
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
}
