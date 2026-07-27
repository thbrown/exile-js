/**
 * `do_mage_spell` (boe.party.cpp:616) and `do_priest_spell` (:873) — what a
 * spell actually *does* when it is cast outside combat, plus the `cast_spell`
 * entry point (:494) that gets you there.
 *
 * The two functions are one giant switch each. Their shape is worth knowing
 * before reading: almost every arm deducts the cost itself rather than the
 * caller doing it once, because several spells decide *not* to charge you —
 * a summon that fails, an Identify with nothing to identify, a Flight cast
 * while already flying. `freebie` means the spell came from an item rather
 * than from the caster, and never costs points.
 *
 * `adj` is the caster's intelligence bonus (1 for a freebie) and `level` their
 * level, both of which most of the dice roll off.
 *
 * Spells that need a square picked hand off to `start_town_targeting`, which
 * is a targeting mode this port doesn't have yet — those arms report
 * themselves and are marked TODO(M5c), in the same style the specials
 * interpreter uses for opcodes waiting on a later milestone.
 */

import { Spell, SPELLS, spellName } from '../data/spell';
import { ItemAbil } from '../data/item';
import { FieldType } from '../data/fields';
import { Skill, MainStatus, PartyStatus, Status, Trait } from '../universe/skills';
import { getProtLevel, hasAbilEquip } from '../universe/inventory';
import { livingSound, SpellNote } from '../universe/living';
import { Player } from '../universe/player';
import { crumbleWall } from './fieldEffects';
import { summonMonster, getSummonMonster } from './monsterPlace';
import { Attitude } from '../data/monster';
import { GameMode } from './modes';
import { SpellPat } from '../data/pattern';
import { startTownTargeting } from './spellTarget';
import type { GameSession } from './session';

/** `increase_light` (boe.party.cpp:288) — brighten the party's own lantern. */
export function increaseLight(session: GameSession, amount: number): void {
  const { univ } = session;
  univ.party.lightLevel += amount;
  if (univ.party.lightLevel < 0) univ.party.lightLevel = 0;
  session.updateExplored(univ.party.getLoc());
}

/** `give_food` (boe.items.cpp:76) — negative amounts are ignored, not taken. */
export function giveFood(session: GameSession, amount: number): void {
  if (amount < 0) return;
  session.univ.party.food += amount;
}

/** `cParty::heal` / `cParty::cure` — the same to every PC, dead ones included. */
function healParty(session: GameSession, amount: number): void {
  for (const pc of session.univ.party.pcs) pc.heal(amount);
}

function cureParty(session: GameSession, amount: number): void {
  for (const pc of session.univ.party.pcs) pc.cure(amount);
}

/** `minmax(lo, hi, x)` — the C++'s clamp, argument order and all. */
function minmax(lo: number, hi: number, x: number): number {
  return Math.max(lo, Math.min(hi, x));
}


/** Spend the spell's cost unless this casting is free. */
function spendSp(pc: Player, spell: Spell, freebie: boolean): void {
  if (!freebie) pc.curSp -= SPELLS[spell]?.cost ?? 0;
}

/**
 * `do_mage_spell` — the town/outdoors half of the mage list.
 *
 * `storeItemSpellLevel` stands in for the C++ global of the same name: the
 * level a spell cast from an item is treated as having.
 */
export function doMageSpell(
  session: GameSession, pcNum: number, spellNum: Spell,
  freebie = false, storeItemSpellLevel = 1,
): void {
  const { univ } = session;
  const pc = univ.party.pcs[pcNum];
  if (!pc) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  if (pc.traits[Trait.ANAMA]) {
    univ.addStringToBuf("Cast: You're an Anama!");
    return;
  }
  if (pc.traits[Trait.PACIFIST] && spellNum !== Spell.NONE && !info.peaceful) {
    univ.addStringToBuf("Cast: You're a pacifist!");
    return;
  }

  const where = univ.party.townLoc;
  livingSound(25);

  const adj = freebie ? 1 : pc.statAdj(Skill.INTELLIGENCE);
  let level = freebie ? storeItemSpellLevel : pc.level;
  // A Magery item raises the level of any spell up to its own strength.
  if (!freebie && (info.level ?? 0) <= getProtLevel(pc, ItemAbil.MAGERY)) level++;

  const summon = (
    which: number, strength: number, count = 1,
  ): void => {
    for (let i = 0; i < count; i++) {
      if (!summonMonster(session, which, where, strength, Attitude.FRIENDLY, true)) {
        univ.addStringToBuf('  Summon failed.');
      }
    }
  };

  switch (spellNum) {
    case Spell.LIGHT:
      spendSp(pc, spellNum, freebie);
      increaseLight(session, 50);
      break;

    case Spell.LIGHT_LONG:
      spendSp(pc, spellNum, freebie);
      increaseLight(session, 200);
      break;

    case Spell.TRUE_SIGHT: {
      spendSp(pc, spellNum, freebie);
      const town = univ.town;
      if (town) {
        for (let x = 0; x < 64; x++) {
          for (let y = 0; y < 64; y++) {
            const dx = x - where.x;
            const dy = y - where.y;
            if (Math.max(Math.abs(dx), Math.abs(dy)) <= 2) town.makeExplored(x, y);
          }
        }
      }
      break;
    }

    case Spell.STEALTH:
      spendSp(pc, spellNum, freebie);
      univ.party.partyStatus[PartyStatus.STEALTH] += Math.max(6, level * 2);
      break;

    case Spell.FLIGHT:
      // Note the early `return`: flying already costs nothing and doesn't even
      // reach the sound at the top on a re-cast... except it does, because the
      // sound plays before the switch. Kept.
      if (univ.party.partyStatus[PartyStatus.FLIGHT] > 0) {
        univ.addStringToBuf('  Not while already flying.');
        return;
      }
      spendSp(pc, spellNum, freebie);
      univ.addStringToBuf('  You start flying!');
      univ.party.partyStatus[PartyStatus.FLIGHT] = 3;
      break;

    // --- the summons -------------------------------------------------------
    case Spell.SUMMON_BEAST: {
      const which = getSummonMonster(session, 1);
      if (which < 0) break;
      spendSp(pc, spellNum, freebie);
      summon(which, univ.rng.getRan(3, 1, 4) + adj);
      break;
    }
    case Spell.SUMMON_WEAK: {
      // The C++ computes a `store` here and then throws it away before
      // recomputing it below; its own comment asks why. The roll still happens,
      // so it still moves the RNG, and that is why it is kept.
      univ.rng.getRan(1, 0, 2);
      const which = getSummonMonster(session, 1);
      if (which < 0) break;
      spendSp(pc, spellNum, freebie);
      const store = univ.rng.getRan(4, 1, 4) + adj;
      summon(which, store, minmax(1, 7, store));
      break;
    }
    case Spell.SUMMON: {
      univ.rng.getRan(1, 0, 1); // discarded, as above
      const which = getSummonMonster(session, 2);
      if (which < 0) break;
      spendSp(pc, spellNum, freebie);
      const store = univ.rng.getRan(5, 1, 4) + adj;
      summon(which, store, minmax(1, 6, store));
      break;
    }
    case Spell.SUMMON_MAJOR: {
      univ.rng.getRan(1, 0, 1); // discarded, as above
      const which = getSummonMonster(session, 3);
      if (which < 0) break;
      spendSp(pc, spellNum, freebie);
      const store = univ.rng.getRan(7, 1, 4) + adj;
      summon(which, store, minmax(1, 5, store));
      break;
    }
    case Spell.SUMMON_AID: {
      const which = getSummonMonster(session, 2);
      if (which < 0) break;
      // Note: no cost. It's a scenario-granted spell.
      summon(which, univ.rng.getRan(5, 1, 4) + adj);
      break;
    }
    case Spell.SUMMON_AID_MAJOR: {
      const which = getSummonMonster(session, 3);
      if (which < 0) break;
      summon(which, univ.rng.getRan(7, 1, 4) + adj);
      break;
    }
    case Spell.DEMON: {
      // The cost is only paid if the demon actually turns up.
      const store = univ.rng.getRan(5, 1, 4) + 2 * adj;
      if (!summonMonster(session, 85, where, store, Attitude.FRIENDLY, true)) {
        univ.addStringToBuf('  Summon failed.');
      } else spendSp(pc, spellNum, freebie);
      break;
    }
    case Spell.SUMMON_RAT: {
      const store = univ.rng.getRan(5, 1, 4) + 2 * adj;
      if (!summonMonster(session, 80, where, store, Attitude.FRIENDLY, true)) {
        univ.addStringToBuf('  Summon failed.');
      }
      break;
    }

    case Spell.MAGIC_MAP: {
      const sapphire = hasAbilEquip(pc, ItemAbil.SAPPHIRE);
      if (!sapphire && !freebie) {
        univ.addStringToBuf(`  ${pc.name} needs a sapphire.`);
      } else if (univ.townRecord?.defyScrying || univ.townRecord?.defyMapping) {
        univ.addStringToBuf('  The spell fails.');
      } else {
        if (freebie) univ.addStringToBuf('  You have a vision.');
        else {
          if (sapphire) sapphire.item.charges--;
          pc.curSp -= SPELLS[spellNum]?.cost ?? 0;
          univ.addStringToBuf('  As the sapphire dissolves, you have a vision.');
        }
        const town = univ.town;
        if (town) {
          for (let i = 0; i < 64; i++) for (let j = 0; j < 64; j++) town.makeExplored(i, j);
        }
      }
      break;
    }

    case Spell.RESIST_MAGIC:
    case Spell.PROTECTION: {
      // `store_spell_target` — the PC the casting dialog aimed at. With nobody
      // chosen (6) the C++ arm does nothing at all, not even charge.
      const target = univ.party.pcs[session.spellTarget];
      if (!target) break;
      spendSp(pc, spellNum, freebie);
      if (spellNum === Spell.PROTECTION) {
        target.status[Status.INVULNERABLE] =
          (target.status[Status.INVULNERABLE] ?? 0) + 2 + adj + univ.rng.getRan(2, 1, 2);
        for (const other of univ.party.pcs) {
          if (other.mainStatus !== MainStatus.ALIVE) continue;
          other.status[Status.MAGIC_RESISTANCE] =
            (other.status[Status.MAGIC_RESISTANCE] ?? 0) + 4 + Math.trunc(level / 3) + adj;
        }
        univ.addStringToBuf('  Party protected.');
      } else {
        target.status[Status.MAGIC_RESISTANCE] =
          (target.status[Status.MAGIC_RESISTANCE] ?? 0) + 2 + adj + univ.rng.getRan(2, 1, 2);
        target.spellNote(SpellNote.PROTECTED);
      }
      break;
    }

    // --- the ones that want a square, or an item screen --------------------
    // Dispel Square lays a 3x3, Antimagic a radius-2 cloud; the rest are
    // single squares.
    case Spell.DISPEL_SQUARE:
      startTownTargeting(session, spellNum, pcNum, freebie, SpellPat.SQUARE, storeItemSpellLevel);
      break;
    case Spell.ANTIMAGIC:
      startTownTargeting(session, spellNum, pcNum, freebie, SpellPat.RADIUS_2, storeItemSpellLevel);
      break;
    case Spell.SCRY_MONSTER:
    case Spell.UNLOCK:
    case Spell.CAPTURE_SOUL:
    case Spell.DISPEL_BARRIER:
    case Spell.BARRIER_FIRE:
    case Spell.BARRIER_FORCE:
    case Spell.QUICKFIRE:
      startTownTargeting(session, spellNum, pcNum, freebie, SpellPat.SINGLE, storeItemSpellLevel);
      break;

    case Spell.IDENTIFY:
    case Spell.RECHARGE:
      // TODO(M5c): these open MODE_ITEM_TARGET, the pick-items-to-treat screen
      // the shop already has a version of (`itemShop.ts`).
      univ.addStringToBuf(`  ${spellName(spellNum)} needs the item screen; not in yet.`);
      break;

    default:
      univ.addStringToBuf(
        `  Error: Mage spell ${spellName(spellNum)} not implemented for town mode.`);
      break;
  }
}

/** `do_priest_spell` — the town/outdoors half of the priest list. */
export function doPriestSpell(
  session: GameSession, pcNum: number, spellNum: Spell,
  freebie = false, storeItemSpellLevel = 1,
): void {
  const { univ } = session;
  const pc = univ.party.pcs[pcNum];
  if (!pc) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  if (pc.traits[Trait.PACIFIST] && spellNum !== Spell.NONE && !info.peaceful) {
    univ.addStringToBuf("Cast: You're a pacifist!");
    return;
  }

  const where = univ.party.townLoc;
  const adj = freebie ? 1 : pc.statAdj(Skill.INTELLIGENCE);
  let level = freebie ? storeItemSpellLevel : pc.level;
  // Note the C++ reads the *current* PC's Anama trait here, not the caster's.
  // With the caster dialog they are usually the same PC; kept as written.
  if (!freebie && univ.currentPc.traits[Trait.ANAMA]) level++;

  livingSound(24);

  const summon = (which: number, strength: number): void => {
    if (!summonMonster(session, which, where, strength, Attitude.FRIENDLY, true)) {
      univ.addStringToBuf('  Summon failed.');
    }
  };

  switch (spellNum) {
    case Spell.LOCATION: {
      spendSp(pc, spellNum, freebie);
      const at = session.mode === GameMode.OUTDOORS ? univ.party.outLoc : univ.party.townLoc;
      if (session.isOutdoors) {
        const x = at.x + 48 * univ.party.outdoorCorner.x;
        const y = at.y + 48 * univ.party.outdoorCorner.y;
        univ.addStringToBuf(`  You're outside at: x ${x}  y ${y}.`);
      } else {
        univ.addStringToBuf(`  You're at: x ${at.x}  y ${at.y}.`);
      }
      break;
    }

    case Spell.MANNA_MINOR:
    case Spell.MANNA: {
      spendSp(pc, spellNum, freebie);
      const store = Math.trunc(level / 3) + 2 * adj + univ.rng.getRan(2, 1, 4);
      let r1 = Math.max(0, store);
      if (spellNum === Spell.MANNA_MINOR) r1 = Math.trunc(r1 / 3);
      univ.addStringToBuf(`  You gain ${r1} food.`);
      giveFood(session, r1);
      break;
    }

    case Spell.LIGHT_DIVINE:
      spendSp(pc, spellNum, freebie);
      increaseLight(session, 210);
      break;

    case Spell.DETECT_LIFE:
      univ.addStringToBuf('  Monsters now on map.');
      univ.party.partyStatus[PartyStatus.DETECT_LIFE] += 6 + univ.rng.getRan(1, 0, 6);
      spendSp(pc, spellNum, freebie);
      break;

    case Spell.FIREWALK:
      univ.addStringToBuf('  You are now firewalking.');
      univ.party.partyStatus[PartyStatus.FIREWALK] += Math.trunc(level / 12) + 2;
      spendSp(pc, spellNum, freebie);
      break;

    case Spell.SHATTER:
      univ.addStringToBuf('  You send out a burst of energy.');
      spendSp(pc, spellNum, freebie);
      for (let x = where.x - 1; x < where.x + 2; x++) {
        for (let y = where.y - 1; y < where.y + 2; y++) crumbleWall(session, { x, y });
      }
      session.updateExplored(univ.party.townLoc);
      break;

    // --- the summons -------------------------------------------------------
    case Spell.SUMMON_SPIRIT:
      if (!summonMonster(session, 125, where, univ.rng.getRan(2, 1, 4) + adj,
        Attitude.FRIENDLY, true)) {
        univ.addStringToBuf('  Summon failed.');
      } else spendSp(pc, spellNum, freebie);
      break;

    case Spell.STICKS_TO_SNAKES: {
      spendSp(pc, spellNum, freebie);
      const count = Math.trunc(level / 6) + Math.trunc(adj / 3) + univ.rng.getRan(1, 0, 1);
      for (let i = 0; i < count; i++) {
        const r2 = univ.rng.getRan(1, 0, 7);
        const store = univ.rng.getRan(2, 1, 5) + adj;
        summon(r2 === 1 ? 100 : 99, store);
      }
      break;
    }

    case Spell.SUMMON_HOST:
      spendSp(pc, spellNum, freebie);
      summon(126, univ.rng.getRan(2, 1, 4) + adj);
      for (let i = 0; i < 4; i++) summon(125, univ.rng.getRan(2, 1, 4) + adj);
      break;

    case Spell.SUMMON_GUARDIAN:
      if (!summonMonster(session, 122, where, univ.rng.getRan(6, 1, 4) + adj,
        Attitude.FRIENDLY, true)) {
        univ.addStringToBuf('  Summon failed.');
      } else spendSp(pc, spellNum, freebie);
      break;

    // --- the single-target heals and cures ---------------------------------
    case Spell.HEAL_MINOR:
    case Spell.HEAL:
    case Spell.HEAL_MAJOR:
    case Spell.POISON_WEAKEN:
    case Spell.POISON_CURE:
    case Spell.DISEASE_CURE:
    case Spell.RESTORE_MIND:
    case Spell.CLEANSE:
    case Spell.AWAKEN:
    case Spell.PARALYSIS_CURE: {
      const target = univ.party.pcs[session.spellTarget];
      if (!target) break;
      spendSp(pc, spellNum, freebie);
      let line = `  ${target.name}`;
      switch (spellNum) {
        case Spell.HEAL_MINOR:
        case Spell.HEAL:
        case Spell.HEAL_MAJOR: {
          const dice = spellNum === Spell.HEAL_MINOR
            ? 2 : 2 + (spellNum === Spell.HEAL ? 6 : 12);
          const r1 = univ.rng.getRan(dice, 1, 4);
          line += ` healed ${r1}.`;
          target.heal(r1);
          livingSound(52);
          break;
        }
        case Spell.POISON_WEAKEN:
        case Spell.POISON_CURE: {
          line += ' cured.';
          const r1 = (spellNum === Spell.POISON_WEAKEN ? 1 : 3)
            + univ.rng.getRan(1, 0, 2) + Math.trunc(adj / 2);
          target.cure(r1);
          break;
        }
        case Spell.AWAKEN:
          if ((target.status[Status.ASLEEP] ?? 0) <= 0) {
            line += ' is already awake!';
            break;
          }
          line += ' wakes up.';
          target.status[Status.ASLEEP] = 0;
          break;
        case Spell.PARALYSIS_CURE:
          if ((target.status[Status.PARALYZED] ?? 0) <= 0) {
            line += " isn't paralyzed!";
            break;
          }
          line += ' can move now.';
          target.status[Status.PARALYZED] = 0;
          break;
        case Spell.DISEASE_CURE: {
          line += ' recovers.';
          const r1 = 2 + univ.rng.getRan(1, 0, 2) + Math.trunc(adj / 2);
          target.status[Status.DISEASE] = Math.max(0, (target.status[Status.DISEASE] ?? 0) - r1);
          break;
        }
        case Spell.RESTORE_MIND: {
          if ((target.status[Status.DUMB] ?? 0) <= 0) {
            line += " isn't dumbfounded!";
            break;
          }
          line += ' restored.';
          const r1 = 1 + univ.rng.getRan(1, 0, 2) + Math.trunc(adj / 2);
          target.status[Status.DUMB] = Math.max(0, (target.status[Status.DUMB] ?? 0) - r1);
          break;
        }
        case Spell.CLEANSE:
          line += ' cleansed.';
          target.status[Status.DISEASE] = 0;
          target.status[Status.WEBS] = 0;
          break;
        default:
          break;
      }
      univ.addStringToBuf(line);
      break;
    }

    // --- the single-target restorations ------------------------------------
    case Spell.MARTYRS_SHIELD:
    case Spell.SANCTUARY:
    case Spell.REVIVE:
    case Spell.DESTONE:
    case Spell.CURSE_REMOVE:
    case Spell.SYMBIOSIS:
    case Spell.RAISE_DEAD:
    case Spell.RESURRECT: {
      const target = univ.party.pcs[session.spellTarget];
      if (!target) break;
      if (spellNum === Spell.SYMBIOSIS && session.spellTarget === pcNum) {
        // Symbiosis moves damage from the target to the caster, so casting it
        // on yourself would be a no-op.
        univ.addStringToBuf("  Can't cast on self.");
        return;
      }
      if (!freebie && spellNum !== Spell.RAISE_DEAD && spellNum !== Spell.RESURRECT) {
        pc.curSp -= SPELLS[spellNum]?.cost ?? 0;
      }
      let line = `  ${target.name}`;
      if (spellNum === Spell.MARTYRS_SHIELD) {
        line += ' shielded.';
        const r1 = Math.max(1, univ.rng.getRan(Math.trunc((level + 5) / 5), 1, 3) + adj);
        target.status[Status.MARTYRS_SHIELD] = (target.status[Status.MARTYRS_SHIELD] ?? 0) + r1;
      } else if (spellNum === Spell.SANCTUARY) {
        line += ' hidden.';
        const r1 = Math.max(0, univ.rng.getRan(0, 1, 3) + Math.trunc(level / 4) + adj);
        target.status[Status.INVISIBLE] = (target.status[Status.INVISIBLE] ?? 0) + r1;
      } else if (spellNum === Spell.REVIVE) {
        line += ' healed.';
        target.heal(250);
        target.status[Status.POISON] = 0;
        livingSound(52);
      } else if (spellNum === Spell.DESTONE) {
        if (target.mainStatus === MainStatus.STONE) {
          target.mainStatus = MainStatus.ALIVE;
          line += ' destoned.';
          livingSound(53);
        } else line += " wasn't stoned.";
      } else if (spellNum === Spell.CURSE_REMOVE) {
        for (const item of target.items) {
          if (!item.cursed) continue;
          if (univ.rng.getRan(1, 0, 200) - 10 * adj < 60) {
            item.cursed = false;
            item.unsellable = false;
          }
        }
        livingSound(52);
        line = '  Your items glow.';
      } else {
        // RAISE_DEAD and RESURRECT always charge, freebie or not — the C++
        // deducts outside the freebie check here.
        pc.curSp -= SPELLS[spellNum]?.cost ?? 0;
        if (spellNum === Spell.RAISE_DEAD) {
          if (target.mainStatus === MainStatus.DEAD) {
            // The higher the caster's level the less likely this is. Below
            // level 2 the C++ rolls get_ran(1,1,0), which is undefined there;
            // our getRan clamps an empty range and returns 1, so a level-1
            // caster always reduces the body to dust. Nothing sane reaches it.
            if (univ.rng.getRan(1, 1, Math.trunc(level / 2)) === 1) {
              line += ' now dust.';
              livingSound(5);
              target.mainStatus = MainStatus.DUST;
            } else {
              target.mainStatus = MainStatus.ALIVE;
              // Coming back costs you a point of each of the first three
              // skills, two times in three.
              for (let i = 0; i < 3; i++) {
                if (univ.rng.getRan(1, 0, 2) < 2 && (target.skills[i] ?? 0) > 1) {
                  target.skills[i] = (target.skills[i] ?? 0) - 1;
                }
              }
              target.curHealth = 1;
              line += ' raised.';
              livingSound(52);
            }
          } else if (target.mainStatus !== MainStatus.ALIVE) line = "  Didn't work.";
          else line += ' was OK.';
        } else if (target.mainStatus !== MainStatus.ALIVE) {
          target.mainStatus = MainStatus.ALIVE;
          for (let i = 0; i < 3; i++) {
            if (univ.rng.getRan(1, 0, 2) < 1 && (target.skills[i] ?? 0) > 1) {
              target.skills[i] = (target.skills[i] ?? 0) - 1;
            }
          }
          target.curHealth = 1;
          line += ' raised.';
          livingSound(52);
        } else line += ' was OK.';
      }
      univ.addStringToBuf(line);
      break;
    }

    // --- the party-wide ones -----------------------------------------------
    case Spell.HEAL_ALL_LIGHT:
    case Spell.HEAL_ALL:
    case Spell.REVIVE_ALL: {
      spendSp(pc, spellNum, freebie);
      if (spellNum !== Spell.REVIVE_ALL) {
        const r1 = univ.rng.getRan((spellNum === Spell.HEAL_ALL ? 6 : 3) + adj, 1, 4);
        univ.addStringToBuf(`  Party healed ${r1}.`);
        healParty(session, r1);
        livingSound(52);
      } else {
        const r1 = univ.rng.getRan(7 + adj, 1, 4) * 2;
        univ.addStringToBuf('  Party revived.');
        healParty(session, r1);
        cureParty(session, 3 + adj);
      }
      break;
    }

    case Spell.POISON_CURE_ALL:
      spendSp(pc, spellNum, freebie);
      univ.addStringToBuf('  Party cured.');
      cureParty(session, 3 + adj);
      break;

    case Spell.SANCTUARY_MASS:
    case Spell.CLEANSE_MAJOR:
    case Spell.HYPERACTIVITY: {
      spendSp(pc, spellNum, freebie);
      if (spellNum === Spell.SANCTUARY_MASS) univ.addStringToBuf('  Party hidden.');
      else if (spellNum === Spell.CLEANSE_MAJOR) univ.addStringToBuf('  Party cleansed.');
      else univ.addStringToBuf('  Party is now really, REALLY awake.');

      for (const other of univ.party.pcs) {
        if (other.mainStatus !== MainStatus.ALIVE) continue;
        if (spellNum === Spell.SANCTUARY_MASS) {
          const store = univ.rng.getRan(0, 1, 3) + Math.trunc(level / 6) + adj;
          other.status[Status.INVISIBLE] = (other.status[Status.INVISIBLE] ?? 0)
            + Math.max(0, store);
        }
        if (spellNum === Spell.CLEANSE_MAJOR) {
          other.status[Status.WEBS] = 0;
          other.status[Status.DISEASE] = 0;
        }
        if (spellNum === Spell.HYPERACTIVITY) {
          other.status[Status.ASLEEP] = (other.status[Status.ASLEEP] ?? 0) - (6 + 2 * adj);
          other.status[Status.HASTE_SLOW] = Math.max(0, other.status[Status.HASTE_SLOW] ?? 0);
        }
      }
      break;
    }

    case Spell.AVATAR:
      // Note: no cost, in the C++ too.
      pc.avatar();
      break;

    // --- the ones that want a square ---------------------------------------
    case Spell.RITUAL_SANCTIFY:
      univ.addStringToBuf('  Sanctify which space?');
      startTownTargeting(session, spellNum, pcNum, freebie, SpellPat.SINGLE, storeItemSpellLevel);
      break;
    case Spell.MOVE_MOUNTAINS:
    case Spell.MOVE_MOUNTAINS_MASS:
      univ.addStringToBuf('  Destroy what?');
      startTownTargeting(session, spellNum, pcNum, freebie,
        spellNum === Spell.MOVE_MOUNTAINS ? SpellPat.SINGLE : SpellPat.SQUARE,
        storeItemSpellLevel);
      break;
    case Spell.DISPEL_SPHERE:
    case Spell.DISPEL_FIELD:
      startTownTargeting(session, spellNum, pcNum, freebie,
        spellNum === Spell.DISPEL_SPHERE ? SpellPat.RADIUS_2 : SpellPat.SINGLE,
        storeItemSpellLevel);
      break;

    case Spell.WORD_RECALL:
      // TODO(M6): force_town_enter + position_party — moving the party to the
      // scenario's start point, which needs the town-entry plumbing.
      if (!session.isOutdoors) {
        univ.addStringToBuf('  Can only cast outdoors.');
        return;
      }
      univ.addStringToBuf('  Word of Recall is not in yet.');
      break;

    default:
      univ.addStringToBuf(
        `  Error: Priest spell ${spellName(spellNum)} not implemented for town mode.`);
      break;
  }
}

/**
 * `cast_spell` (boe.party.cpp:494) — the entry point. Picking the spell is the
 * caller's job here; the C++ opens a dialog for it.
 */
export function castSpell(
  session: GameSession, pcNum: number, spellNum: Spell, freebie = false,
): void {
  const { univ } = session;
  if (session.mode === GameMode.TOWN
    && univ.town?.hasField(univ.party.townLoc.x, univ.party.townLoc.y,
      FieldType.FIELD_ANTIMAGIC)) {
    univ.addStringToBuf('Cast: Not in antimagic field.');
    return;
  }
  if (spellNum === Spell.NONE) return;
  const pc = univ.party.pcs[pcNum];
  if (!pc) return;
  univ.addStringToBuf(`${pc.name} casts ${spellName(spellNum)}.`);
  if (SPELLS[spellNum]?.type === Skill.PRIEST_SPELLS
    || (spellNum >= 100 && SPELLS[spellNum]?.type === undefined)) {
    doPriestSpell(session, pcNum, spellNum, freebie);
  } else doMageSpell(session, pcNum, spellNum, freebie);
}
