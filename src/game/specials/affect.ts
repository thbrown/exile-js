/**
 * The AFFECT opcode group — affect_spec (boe.specials.cpp:2726). These act on
 * the party or on one chosen member.
 *
 * Two conventions run through the whole group:
 *  - **ex1b is the sign.** 0 means give/heal/add, anything else means
 *    take/harm/subtract.
 *  - **The target is the whole party unless SELECT_TARGET picked someone.**
 *    `ctx.curTarget` holds that choice; null means everyone.
 */

import { SpecType } from '../../data/special';
import { SKILL_MAX } from '../../data/shop';
import { MAX_FOOD, MAX_GOLD } from '../../universe/party';
import { GiveStatus, giveItem } from '../../universe/inventory';
import { Player } from '../../universe/player';
import { MainStatus, Skill, Status } from '../../universe/skills';
import { Universe } from '../../universe/universe';
import { poisonWeapon } from '../itemUse';
import { SpecialCtx } from './context';
import { reportUnsupported } from './general';
import { handleMessage } from './vm';

function clamp(lo: number, hi: number, v: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export async function affectSpec(univ: Universe, ctx: SpecialCtx): Promise<void> {
  const spec = ctx.curSpec;
  const { party } = univ;
  let checkMess = true;
  ctx.nextSpec = spec.jumpto;

  /** Everyone the node applies to: the chosen PC, or the whole party. */
  const targets = (): Player[] => {
    if (ctx.curTarget !== null && ctx.curTarget >= 0 && ctx.curTarget < 6) {
      const pc = party.pcs[ctx.curTarget];
      return pc ? [pc] : [];
    }
    return party.pcs;
  };
  /** ex1b picks the direction: 0 up, anything else down. */
  const signed = (amount: number): number => amount * (spec.ex1b !== 0 ? -1 : 1);

  switch (spec.type) {
    case SpecType.SELECT_TARGET: {
      checkMess = false;
      // ex1a: 0 any PC, 1 a living one, 2 the whole party, 3 a dead one.
      if (spec.ex1a === 2) ctx.curTarget = null;
      else {
        const who = await ctx.host.selectPc('Who?');
        ctx.curTarget = who >= 0 && who < 6 ? who : null;
      }
      break;
    }

    case SpecType.AFFECT_HP:
      for (const pc of targets()) pc.heal(signed(spec.ex1a));
      break;

    case SpecType.AFFECT_SP:
      for (const pc of targets()) {
        if (spec.ex1b === 0) pc.restoreSp(spec.ex1a);
        else pc.curSp = Math.max(0, pc.curSp - spec.ex1a);
      }
      break;

    case SpecType.AFFECT_XP:
      for (const pc of targets()) {
        if (spec.ex1a < 0) continue; // "set to the level's threshold" needs get_tnl (M5)
        pc.experience = Math.max(0, pc.experience + signed(spec.ex1a));
      }
      break;

    case SpecType.AFFECT_SKILL_PTS:
      for (const pc of targets())
        pc.skillPts = clamp(0, 100, pc.skillPts + signed(spec.ex1a));
      break;

    case SpecType.AFFECT_STAT: {
      if (spec.ex2a < 0 || spec.ex2a > 20) {
        univ.addStringToBuf('Skill is out of range.');
        break;
      }
      const skill = spec.ex2a as Skill;
      for (const pc of targets()) {
        // pic is a per-PC percentage chance that it lands.
        if (univ.rng.getRan(1, 1, 100) >= spec.pic) continue;
        const adj = signed(spec.ex1a);
        if (skill === Skill.MAX_HP) pc.maxHealth = clamp(6, 250, pc.maxHealth + adj);
        else if (skill === Skill.MAX_SP) pc.maxSp = clamp(0, 150, pc.maxSp + adj);
        else pc.skills[skill] = clamp(0, SKILL_MAX[skill] ?? 20, (pc.skills[skill] ?? 0) + adj);
      }
      break;
    }

    case SpecType.AFFECT_LEVEL:
      for (const pc of targets()) pc.level = Math.max(1, pc.level + signed(spec.ex1a));
      break;

    case SpecType.AFFECT_DEADNESS:
      for (const pc of targets()) {
        if (spec.ex1b === 0) {
          // Restoring: anything short of "absent" comes back alive.
          if (pc.mainStatus > MainStatus.ABSENT && pc.mainStatus < MainStatus.SPLIT)
            pc.mainStatus = MainStatus.ALIVE;
        } else {
          const KILL: Record<number, MainStatus> = {
            0: MainStatus.DEAD, 1: MainStatus.DUST, 2: MainStatus.STONE,
            3: MainStatus.FLED, 5: MainStatus.ABSENT,
          };
          const to = KILL[spec.ex1a];
          if (to !== undefined) pc.mainStatus = to;
        }
      }
      ctx.redraw = true;
      break;

    case SpecType.AFFECT_STATUS: {
      // affect_spec's AFFECT_STATUS (boe.specials.cpp:2981) routes each
      // status through its own iLiving method rather than nudging the raw
      // number — that's what prints "X poisoned."/"X diseased." and rolls
      // frailty/protection/save-vs-level, so a generic add-and-clamp landed
      // the status with no visible effect at all.
      // The status type lives in ex1c, not ex2a — a slip in the first pass
      // at this fix, and exactly why "you feel ill" still did nothing after
      // it: ex2a is -1 on a real node (unused), so the range guard below
      // caught it and bailed before ever reaching the switch.
      if (spec.ex1c < 0 || spec.ex1c > 15) break;
      const status = spec.ex1c as Status;
      const give = spec.ex1b === 0;
      const amount = spec.ex1a;
      for (const pc of targets()) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        switch (status) {
          case Status.POISON:
            if (give) pc.cure(amount); else pc.poison(amount, univ.rng);
            break;
          case Status.HASTE_SLOW:
            pc.slow(give ? -amount : amount);
            break;
          case Status.INVULNERABLE:
            pc.applyStatus(Status.INVULNERABLE, give ? amount : -amount);
            break;
          case Status.MAGIC_RESISTANCE:
            pc.applyStatus(Status.MAGIC_RESISTANCE, give ? amount : -amount);
            break;
          case Status.WEBS:
            if (give) pc.applyStatus(Status.WEBS, -amount); else pc.web(amount);
            break;
          case Status.DISEASE:
            if (give) pc.applyStatus(Status.DISEASE, -amount); else pc.disease(amount, univ.rng);
            break;
          case Status.INVISIBLE:
            pc.applyStatus(Status.INVISIBLE, give ? amount : -amount);
            break;
          case Status.BLESS_CURSE:
            pc.curse(give ? -amount : amount);
            break;
          case Status.DUMB:
            if (give) pc.applyStatus(Status.DUMB, -amount); else pc.dumbfound(amount, univ.rng);
            break;
          case Status.ASLEEP:
            if (give) pc.applyStatus(Status.ASLEEP, -amount);
            else pc.sleep(Status.ASLEEP, amount, 10, univ.rng);
            break;
          case Status.PARALYZED:
            if (give) pc.applyStatus(Status.PARALYZED, -amount);
            else pc.sleep(Status.PARALYZED, amount, 10, univ.rng);
            break;
          case Status.POISONED_WEAPON: {
            const pcNum = party.pcs.indexOf(pc);
            if (give) pc.applyStatus(Status.POISONED_WEAPON, -amount);
            else poisonWeapon(univ, pcNum, amount, true);
            break;
          }
          case Status.MARTYRS_SHIELD:
            pc.applyStatus(Status.MARTYRS_SHIELD, give ? amount : -amount);
            break;
          case Status.ACID:
            if (give) pc.applyStatus(Status.ACID, -amount); else pc.acid(amount);
            break;
          case Status.FORCECAGE:
            // is_out(): a forcecage only exists indoors.
            if (univ.isInTown()) {
              if (give) pc.applyStatus(Status.FORCECAGE, -amount);
              else pc.sleep(Status.FORCECAGE, amount, 10, univ.rng);
            }
            break;
          // MAIN and CHARM aren't valid targets here (kept, matching the C++).
          case Status.MAIN:
          case Status.CHARM:
            break;
        }
      }
      ctx.redraw = true;
      break;
    }

    case SpecType.AFFECT_MAGE_SPELL:
    case SpecType.AFFECT_PRIEST_SPELL: {
      if (spec.ex1a < 0 || spec.ex1a > 61) {
        univ.addStringToBuf('Spell is out of range (0 - 61).');
        break;
      }
      for (const pc of targets()) {
        const book = spec.type === SpecType.AFFECT_MAGE_SPELL ? pc.mageSpells : pc.priestSpells;
        book[spec.ex1a] = !spec.ex1b;
      }
      break;
    }

    case SpecType.AFFECT_ALCHEMY:
      if (spec.ex1a < 0 || spec.ex1a > 19) univ.addStringToBuf('Alchemy is out of range.');
      else party.alchemy[spec.ex1a] = !spec.ex1b;
      break;

    case SpecType.AFFECT_GOLD:
      if (spec.ex1b === 0) {
        party.gold = Math.min(MAX_GOLD, party.gold + spec.ex1a);
        univ.addStringToBuf(`  You get ${spec.ex1a} gold.`);
      } else party.gold = Math.max(0, party.gold - spec.ex1a);
      break;

    case SpecType.AFFECT_FOOD:
      if (spec.ex1b === 0) {
        party.food = Math.min(MAX_FOOD, party.food + spec.ex1a);
        univ.addStringToBuf(`  You get ${spec.ex1a} food.`);
      } else party.food = Math.max(0, party.food - spec.ex1a);
      break;

    case SpecType.GIVE_ITEM: {
      const item = univ.scenario.scenItems[spec.ex1a];
      if (!item) break;
      let given = false;
      for (const pc of targets()) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        const result = giveItem(pc, party, { ...item });
        if (result.status === GiveStatus.OK) {
          if (result.message) univ.addStringToBuf(result.message);
          given = true;
          break;
        }
      }
      if (!given) univ.addStringToBuf("  Your party can't carry any more.");
      ctx.redraw = true;
      break;
    }

    case SpecType.AFFECT_NAME:
      // The node names the PC after one of the scenario's strings.
      for (const pc of targets()) {
        const name = univ.getStr(ctx.curSpecType, spec.m1);
        if (name) pc.name = name;
      }
      break;

    default:
      // Damage, monster manipulation, soul crystals, party status effects and
      // PC creation all need combat or systems from later milestones.
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
}
