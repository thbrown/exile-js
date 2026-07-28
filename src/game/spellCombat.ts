/**
 * Casting in combat — `combat_cast_mage_spell` (boe.combat.cpp:4517),
 * `combat_cast_priest_spell` (:4745) and the two `combat_immed_*_cast`
 * functions under them (:4596, :4798).
 *
 * The important difference from town casting: **there is no caster to choose.**
 * The C++ calls `pick_spell(univ.cur_pc, …)`, which sets `can_choose_caster`
 * false — in combat the active PC is the one casting, full stop. Out of combat
 * `cast_spell` passes 6 instead, which is what opens the caster buttons.
 *
 * `combat_cast_*_spell` is really a dispatcher on the spell's `refer`:
 *
 * - `REFER_YES`   — the town implementation does the work; spend 6 AP first.
 * - `REFER_IMMED` — a combat-only effect that resolves at once, below.
 * - `REFER_TARGET`/`REFER_FANCY` — ask for a square, then `do_combat_cast`.
 */

import { dist } from '../core/location';
import { DamageType } from '../data/monster';
import { SpellPat } from '../data/pattern';
import { Spell, SPELLS, SpellRefer, spellName } from '../data/spell';
import { ItemAbil } from '../data/item';
import { FieldType } from '../data/fields';
import { getProtLevel } from '../universe/inventory';
import { livingSound } from '../universe/living';
import { MainStatus, Skill, Status, Trait } from '../universe/skills';
import { takeAp } from './combat';
import { damageMonst, damagePc } from './damage';
import { placeSpellPattern } from './spellPatterns';
import { doMageSpell, doPriestSpell } from './spellTown';
import { startFancySpellTargeting, startSpellTargeting } from './spellCombatTarget';
import { SIGHT_BLOCKED } from '../core/sight';
import type { GameSession } from './session';

/** The AP a spell costs, win or lose (`take_ap(6)`). */
const SPELL_AP = 6;

/**
 * `poison_weapon` — the Envenom effect. The C++ helper also prints and picks a
 * sound; only the status matters here.
 */
function poisonWeapon(session: GameSession, pcNum: number, howMuch: number): void {
  const pc = session.univ.party.pcs[pcNum];
  if (!pc) return;
  pc.status[Status.POISONED_WEAPON] = (pc.status[Status.POISONED_WEAPON] ?? 0) + howMuch;
}

/**
 * `do_shockwave` (boe.combat.cpp:4261) — unblockable damage to everything
 * within ten squares *except* whoever is standing on the centre, and the
 * further away the harder it lands.
 */
export function doShockwave(session: GameSession, target: { x: number; y: number }): void {
  const { univ } = session;
  for (const pc of univ.party.pcs) {
    const d = dist(target, pc.combatPos);
    if (d <= 0 || d >= 11 || pc.mainStatus !== MainStatus.ALIVE) continue;
    damagePc(univ, pc, univ.rng.getRan(2 + Math.trunc(d / 2), 1, 6), DamageType.UNBLOCKABLE);
  }
  for (const monst of univ.town?.monsters ?? []) {
    if (!monst.isAlive) continue;
    const d = dist(target, monst.curLoc);
    if (d <= 0 || d >= 11) continue;
    if (session.canSeeLight(target, monst.curLoc) >= SIGHT_BLOCKED) continue;
    damageMonst(univ, monst, univ.curPc,
      univ.rng.getRan(2 + Math.trunc(d / 2), 1, 6), DamageType.UNBLOCKABLE, { session });
  }
}

/**
 * `combat_immed_mage_cast` — the mage spells that resolve the moment they are
 * cast, with no square to pick.
 *
 * The single-target arms read `store_spell_target`, the PC chosen in the
 * casting dialog. As in `spellTown.ts`, and for the same reason, the caster
 * stands in for that until the dialog exists.
 */
export function combatImmedMageCast(
  session: GameSession, pcNum: number, spellNum: Spell,
  freebie = false, storeItemSpellLevel = 1,
): void {
  const { univ } = session;
  const caster = univ.party.pcs[pcNum];
  if (!caster) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  const bonus = freebie ? 1 : caster.statAdj(Skill.INTELLIGENCE);
  let level = freebie ? storeItemSpellLevel : caster.level;
  if (!freebie && (info.level ?? 0) <= getProtLevel(caster, ItemAbil.MAGERY)) level++;
  const spend = (): void => { if (!freebie) caster.curSp -= info.cost ?? 0; };
  // `store_spell_target` — the PC the casting dialog aimed at.
  const target = univ.party.pcs[session.spellTarget] ?? caster;

  switch (spellNum) {
    case Spell.SHOCKWAVE:
      spend();
      univ.addStringToBuf('  The ground shakes!');
      doShockwave(session, caster.combatPos);
      break;

    case Spell.HASTE_MINOR:
    case Spell.HASTE:
    case Spell.STRENGTH:
    case Spell.ENVENOM:
    case Spell.RESIST_MAGIC: {
      spend();
      livingSound(4);
      if (spellNum === Spell.ENVENOM) {
        poisonWeapon(session, univ.party.pcs.indexOf(target), 3 + bonus);
        univ.addStringToBuf(`  ${target.name} receives venom.`);
      } else if (spellNum === Spell.STRENGTH) {
        // Strength is a *negative* curse — the same status, pushed the good way.
        target.curse(-3);
        univ.addStringToBuf(`  ${target.name} stronger.`);
      } else if (spellNum === Spell.RESIST_MAGIC) {
        target.status[Status.MAGIC_RESISTANCE] =
          (target.status[Status.MAGIC_RESISTANCE] ?? 0) + 5 + bonus;
        univ.addStringToBuf(`  ${target.name} resistant.`);
      } else {
        // Haste is negative slow, likewise.
        target.slow(spellNum === Spell.HASTE_MINOR
          ? -2 : -Math.max(2, Math.trunc(level / 2) + bonus));
        univ.addStringToBuf(`  ${target.name} hasted.`);
      }
      break;
    }

    case Spell.HASTE_MAJOR:
    case Spell.BLESS_MAJOR:
      spend();
      for (const pc of univ.party.pcs) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        pc.slow(-(spellNum === Spell.HASTE_MAJOR
          ? 1 + Math.trunc(level / 8) + bonus : 3 + bonus));
        if (spellNum === Spell.BLESS_MAJOR) {
          poisonWeapon(session, univ.party.pcs.indexOf(pc), 2);
          pc.curse(-4);
        }
      }
      univ.addStringToBuf(spellNum === Spell.HASTE_MAJOR
        ? '  Party hasted.' : '  Party blessed!');
      break;

    case Spell.SLOW_GROUP:
    case Spell.FEAR_GROUP:
    case Spell.PARALYSIS_MASS:
    case Spell.SLEEP_MASS: {
      spend();
      livingSound(spellNum === Spell.FEAR_GROUP ? 54 : 25);
      univ.addStringToBuf(
        spellNum === Spell.SLOW_GROUP ? '  Enemy slowed:'
          : spellNum === Spell.FEAR_GROUP ? '  Enemy scared:'
            : spellNum === Spell.PARALYSIS_MASS ? '  Enemy paralyzed:'
              : '  Enemy drowsy:');
      for (const monst of univ.town?.monsters ?? []) {
        if (!monst.isAlive || monst.isFriendly) continue;
        if (dist(caster.combatPos, monst.curLoc) > (info.range ?? 0)) continue;
        if (session.canSeeLight(caster.combatPos, monst.curLoc) >= SIGHT_BLOCKED) continue;
        switch (spellNum) {
          case Spell.FEAR_GROUP:
            monst.scare(univ.rng.getRan(Math.trunc(level / 3), 1, 8));
            break;
          case Spell.SLOW_GROUP:
            monst.slow(5 + bonus);
            break;
          case Spell.PARALYSIS_MASS:
            monst.sleep(Status.PARALYZED, 1000, 15, univ.rng);
            break;
          default:
            monst.sleep(Status.ASLEEP, 8, 15, univ.rng);
            break;
        }
      }
      break;
    }

    case Spell.BLADE_AURA:
      // Note: no cost — it's a scenario-granted spell.
      placeSpellPattern(session, SpellPat.RADIUS_2, caster.combatPos,
        { field: FieldType.WALL_BLADES, whoHit: 6 });
      break;

    case Spell.FLAME_AURA:
      placeSpellPattern(session, SpellPat.OPEN_SQUARE, caster.combatPos,
        { damage: { type: DamageType.FIRE, dice: 6 }, whoHit: pcNum });
      break;

    default:
      univ.addStringToBuf(
        `  Error: Mage spell ${spellName(spellNum)} not implemented for combat mode.`);
      break;
  }
}

/** `combat_immed_priest_cast` — the priest half of the same. */
export function combatImmedPriestCast(
  session: GameSession, pcNum: number, spellNum: Spell,
  freebie = false, storeItemSpellLevel = 1,
): void {
  const { univ } = session;
  const caster = univ.party.pcs[pcNum];
  if (!caster) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  const bonus = freebie ? 1 : caster.statAdj(Skill.INTELLIGENCE);
  let level = freebie ? storeItemSpellLevel : caster.level;
  if (!freebie && caster.traits[Trait.ANAMA]) level++;
  const spend = (): void => { if (!freebie) caster.curSp -= info.cost ?? 0; };
  const target = univ.party.pcs[session.spellTarget] ?? caster;

  switch (spellNum) {
    case Spell.BLESS_MINOR:
    case Spell.BLESS:
      spend();
      livingSound(4);
      target.curse(-(spellNum === Spell.BLESS_MINOR
        ? 2 : Math.max(2, Math.trunc((level * 3) / 4) + 1 + bonus)));
      break;

    case Spell.BLESS_PARTY:
      spend();
      for (const pc of univ.party.pcs) {
        if (pc.mainStatus !== MainStatus.ALIVE) continue;
        pc.curse(-Math.trunc(level / 3));
      }
      livingSound(4);
      break;

    case Spell.AVATAR:
      spend();
      univ.addStringToBuf(`  ${caster.name} is an avatar!`);
      caster.avatar();
      break;

    case Spell.CURSE_ALL:
    case Spell.CHARM_MASS:
    case Spell.PESTILENCE:
      spend();
      livingSound(24);
      for (const monst of univ.town?.monsters ?? []) {
        if (!monst.isAlive || monst.isFriendly) continue;
        // Note: unlike the mage group spells, this one does *not* check line of
        // sight. The C++ has a TODO asking whether it should; kept as-is.
        if (dist(caster.combatPos, monst.curLoc) > (info.range ?? 0)) continue;
        if (spellNum === Spell.CURSE_ALL) monst.curse(3 + bonus);
        else if (spellNum === Spell.CHARM_MASS) {
          monst.sleep(Status.CHARM, 0, 28 - bonus, univ.rng);
        } else monst.disease(3 + bonus);
      }
      break;

    case Spell.PROTECTIVE_CIRCLE:
      spend();
      livingSound(24);
      univ.addStringToBuf('  Protective field created.');
      placeSpellPattern(session, SpellPat.PROT, caster.combatPos, { whoHit: 6 });
      break;

    case Spell.AUGMENTATION:
      // Note: no cost, in the C++ too — a scenario-granted spell.
      univ.addStringToBuf('  Health augmented!');
      target.curHealth += univ.rng.getRan(3, 1, 6);
      break;

    case Spell.NIRVANA: {
      univ.addStringToBuf('  Enlightened!');
      const i = univ.rng.getRan(3, 1, 6);
      // A negative DUMB is enlightenment; note the truncation toward zero, so
      // a roll under 3 gives no mental boost at all — only the points.
      target.applyStatus(Status.DUMB, Math.trunc(i / -3));
      target.curSp += i * 2;
      break;
    }

    default:
      univ.addStringToBuf(
        `  Error: Priest spell ${spellName(spellNum)} not implemented for combat mode.`);
      break;
  }
}

/**
 * `combat_cast_mage_spell` / `combat_cast_priest_spell` — cast `spellNum` as
 * the active PC, dispatching on the spell's `refer`.
 *
 * Picking the spell is the caller's job; the C++ opens `pick_spell` here.
 */
export function combatCastSpell(
  session: GameSession, spellNum: Spell, freebie = false,
): void {
  const { univ } = session;
  const pcNum = univ.curPc;
  const caster = univ.party.pcs[pcNum];
  if (!caster) return;
  const info = SPELLS[spellNum];
  if (!info) return;

  if (caster.traits[Trait.PACIFIST] && !info.peaceful) {
    univ.addStringToBuf("Cast: You're a pacifist!");
    return;
  }

  const isPriest = info.type === Skill.PRIEST_SPELLS
    || (spellNum >= 100 && info.type === undefined);
  univ.addStringToBuf(`${caster.name} casts ${spellName(spellNum)}.`);

  switch (info.refer) {
    case SpellRefer.YES:
      // The town implementation does the work; the AP go first either way.
      takeAp(univ, SPELL_AP);
      if (isPriest) doPriestSpell(session, pcNum, spellNum, freebie);
      else doMageSpell(session, pcNum, spellNum, freebie);
      // Casting is a free function, not a GameSession method, so it has to
      // trigger the turn advance itself — see afterCombatAction's doc.
      session.afterCombatAction();
      break;

    case SpellRefer.IMMED:
      takeAp(univ, SPELL_AP);
      if (isPriest) combatImmedPriestCast(session, pcNum, spellNum, freebie);
      else combatImmedMageCast(session, pcNum, spellNum, freebie);
      session.afterCombatAction();
      break;

    case SpellRefer.TARGET:
      startSpellTargeting(session, spellNum, freebie);
      break;

    case SpellRefer.FANCY:
      startFancySpellTargeting(session, spellNum, freebie);
      break;

    default:
      univ.addStringToBuf(
        `  Error: Spell ${spellName(spellNum)} has no way to be cast.`);
      break;
  }
}
