/**
 * Targeted spells in combat — `start_spell_targeting` (boe.combat.cpp:4910)
 * and `do_combat_cast` (:839).
 *
 * `combat_cast_*_spell` hands off to here for anything with `REFER_TARGET`:
 * the game drops into `MODE_SPELL_TARGET`, remembers the spell, and the next
 * click on the terrain is where it lands.
 *
 * `do_combat_cast` is one long switch, and its shape is worth knowing:
 *
 * - the *cost* is taken once, on the first target that resolves, not up front;
 * - the *action points* likewise, and only 5 of them, not the 6 a REFER_YES or
 *   REFER_IMMED spell pays through `combat_cast_*_spell`;
 * - the arms fall into three groups — fields laid with `place_spell_pattern`,
 *   spells that fly at a square, and spells that need somebody standing there.
 */

import { Location, dist } from '../core/location';
import { FieldType } from '../data/fields';
import { DamageType } from '../data/monster';
import { SpellPat } from '../data/pattern';
import { Spell, SPELLS, isMage, isPriestSide, spellName } from '../data/spell';
import { ItemAbil } from '../data/item';
import { SIGHT_BLOCKED } from '../core/sight';
import { Creature } from '../universe/creature';
import { getProtLevel } from '../universe/inventory';
import { livingSound } from '../universe/living';
import { Player } from '../universe/player';
import { Race, Skill, Status, Trait } from '../universe/skills';
import { takeAp } from './combat';
import { damageMonst, damagePc, hitChance } from './damage';
import { targetThere } from './missiles';
import { GameMode } from './modes';
import { getSummonMonster, summonMonster } from './monsterPlace';
import { Attitude } from '../data/monster';
import { hitSpace } from './processFields';
import { placeSpellPattern } from './spellPatterns';
import { makeTownHostile } from './townAttitude';
import type { GameSession } from './session';

/** What `start_spell_targeting` parks while it waits for a square. */
export interface SpellTarget {
  spell: Spell;
  freebie: boolean;
  pattern: SpellPat;
  range: number;
  itemSpellLevel: number;
}

/**
 * `spray_type_array` — Spray Fields rolls one of fifteen slots, so the odds are
 * weighted: webs three ways, fire three, force/antimagic/stink/ice two each,
 * and blades only one.
 */
const SPRAY_FIELDS: FieldType[] = [
  FieldType.FIELD_WEB, FieldType.FIELD_WEB, FieldType.FIELD_WEB,
  FieldType.WALL_FORCE, FieldType.WALL_FORCE,
  FieldType.WALL_FIRE, FieldType.WALL_FIRE, FieldType.WALL_FIRE,
  FieldType.FIELD_ANTIMAGIC, FieldType.FIELD_ANTIMAGIC,
  FieldType.CLOUD_STINK, FieldType.CLOUD_STINK,
  FieldType.WALL_ICE, FieldType.WALL_ICE, FieldType.WALL_BLADES,
];

/** The target shape each spell uses (`start_spell_targeting`'s own switch). */
function patternFor(spell: Spell): SpellPat {
  switch (spell) {
    case Spell.CLOUD_SLEEP:
      return SpellPat.SMALL_SQUARE;
    case Spell.DISPEL_SQUARE: case Spell.FIREBALL: case Spell.CLOUD_STINK:
    case Spell.FLAMESTRIKE: case Spell.FORCEFIELD:
      return SpellPat.SQUARE;
    case Spell.CONFLAGRATION: case Spell.FIRESTORM: case Spell.SHOCKSTORM:
    case Spell.WEB: case Spell.ANTIMAGIC: case Spell.WALL_ICE_BALL:
    case Spell.CLOUD_SLEEP_LARGE: case Spell.DIVINE_THUD: case Spell.DISPEL_SPHERE:
      return SpellPat.RADIUS_2;
    case Spell.PESTILENCE: case Spell.GOO_BOMB: case Spell.FOUL_VAPOR:
      return SpellPat.RADIUS_3;
    case Spell.WALL_FORCE: case Spell.WALL_ICE: case Spell.WALL_BLADES:
      return SpellPat.WALL;
    default:
      return SpellPat.SINGLE;
  }
}

/** `start_spell_targeting` — go into targeting with `spell` in the air. */
export function startSpellTargeting(
  session: GameSession, spell: Spell, freebie = false, itemSpellLevel = 1,
): void {
  const { univ } = session;
  univ.addStringToBuf('  Target spell.');
  univ.addStringToBuf(isMage(spell) ? "  (Hit 'm' to cancel.)" : "  (Hit 'p' to cancel.)");
  session.mode = GameMode.SPELL_TARGET;
  session.spellTargeting = {
    spell,
    freebie,
    pattern: patternFor(spell),
    range: SPELLS[spell]?.range ?? 0,
    itemSpellLevel,
  };
}

/** Back out of targeting; nothing has been spent. */
export function cancelSpellTargeting(session: GameSession): void {
  if (session.spellTargeting === null) return;
  session.spellTargeting = null;
  session.mode = GameMode.COMBAT;
}

/**
 * `do_combat_cast` — the click landed on `target`; resolve the spell in the
 * air. Returns to COMBAT either way.
 */
export function doCombatCast(session: GameSession, target: Location): void {
  const armed = session.spellTargeting;
  if (!armed) return;
  session.spellTargeting = null;
  session.mode = GameMode.COMBAT;

  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const caster = univ.currentPc;
  const spell = armed.spell;
  const info = SPELLS[spell];
  if (!info) return;
  const freebie = armed.freebie;

  // Note `level` here is *not* the caster's level: it is a spell-power figure
  // that starts at half of it. Every damage roll below leans on this.
  let level: number;
  let bonus = 1;
  if (freebie) {
    level = Math.max(2, Math.min(20, armed.itemSpellLevel));
  } else {
    level = 1 + Math.trunc(caster.level / 2);
    bonus = caster.statAdj(Skill.INTELLIGENCE);
    if ((info.level ?? 0) <= getProtLevel(caster, ItemAbil.MAGERY)) level++;
    if (caster.traits[Trait.ANAMA] && isPriestSide(spell)) level++;
  }

  // Casting drops Sanctuary, whatever the spell.
  caster.status[Status.INVISIBLE] = 0;

  const spend = (): void => { if (!freebie) caster.curSp -= info.cost ?? 0; };
  const rng = univ.rng;
  const min = Math.min;

  // --- the refusals, in the C++'s order ------------------------------------
  const adjust = session.canSeeLight(caster.combatPos, target);
  const allowObstructed = spell === Spell.DISPEL_BARRIER;
  spend();

  if (adjust > 4) {
    univ.addStringToBuf("  Can't see target.");
    return;
  }
  const rect = town.record.inTownRect;
  if (target.x < rect.left || target.x > rect.right
    || target.y < rect.top || target.y > rect.bottom) {
    univ.addStringToBuf('  Space not in town.');
    return;
  }
  if (dist(caster.combatPos, target) > armed.range) {
    univ.addStringToBuf('  Target out of range.');
    return;
  }
  if (session.sightObscurity(target.x, target.y) === 5 && !allowObstructed) {
    univ.addStringToBuf('  Target space obstructed.');
    return;
  }
  if (town.hasField(target.x, target.y, FieldType.FIELD_ANTIMAGIC)) {
    univ.addStringToBuf('  Target in antimagic field.');
    return;
  }

  // A targeted spell costs 5 AP, not the 6 an untargeted one pays.
  if (!freebie) takeAp(univ, 5);

  const pat = armed.pattern;
  const who = univ.curPc;
  const field = (which: FieldType): void => {
    placeSpellPattern(session, pat, target, { field: which, whoHit: who });
  };
  const blast = (type: DamageType, dice: number, shape = pat): void => {
    placeSpellPattern(session, shape, target, { damage: { type, dice }, whoHit: who });
  };

  switch (spell) {
    // --- fields ------------------------------------------------------------
    case Spell.GOO: case Spell.WEB: case Spell.GOO_BOMB:
      field(FieldType.FIELD_WEB);
      return;
    case Spell.CLOUD_FLAME: case Spell.CONFLAGRATION:
      field(FieldType.WALL_FIRE);
      return;
    case Spell.CLOUD_STINK: case Spell.FOUL_VAPOR:
      field(FieldType.CLOUD_STINK);
      return;
    case Spell.WALL_FORCE: case Spell.SHOCKSTORM: case Spell.FORCEFIELD:
      field(FieldType.WALL_FORCE);
      return;
    case Spell.WALL_ICE: case Spell.WALL_ICE_BALL:
      field(FieldType.WALL_ICE);
      return;
    case Spell.ANTIMAGIC:
      field(FieldType.FIELD_ANTIMAGIC);
      return;
    case Spell.CLOUD_SLEEP: case Spell.CLOUD_SLEEP_LARGE:
      field(FieldType.CLOUD_SLEEP);
      return;
    case Spell.WALL_BLADES:
      field(FieldType.WALL_BLADES);
      return;
    case Spell.DISPEL_FIELD: case Spell.DISPEL_SPHERE: case Spell.DISPEL_SQUARE:
      field(FieldType.FIELD_DISPEL);
      return;
    case Spell.QUICKFIRE:
      town.setField(target.x, target.y, FieldType.FIELD_QUICKFIRE, true);
      return;
    case Spell.SPRAY_FIELDS:
      field(SPRAY_FIELDS[rng.getRan(1, 0, 14)] ?? FieldType.FIELD_WEB);
      return;

    case Spell.BARRIER_FIRE:
    case Spell.BARRIER_FORCE: {
      livingSound(68);
      // Both barriers scorch the square as they go up, and both do it with
      // *fire* damage — the force one included, which reads like a slip but is
      // what the C++ does.
      const dice = spell === Spell.BARRIER_FIRE ? 3 : 7;
      hitSpace(session, target, rng.getRan(dice, 2, 7), DamageType.FIRE, 1, 1, who);
      const which = spell === Spell.BARRIER_FIRE
        ? FieldType.BARRIER_FIRE : FieldType.BARRIER_FORCE;
      town.setField(target.x, target.y, which, true);
      univ.addStringToBuf(town.hasField(target.x, target.y, which)
        ? '  You create the barrier.' : '  Failed.');
      return;
    }

    // --- things that fly at a square ---------------------------------------
    case Spell.DIVINE_THUD:
      blast(DamageType.MAGIC, min(18, Math.trunc((level * 7) / 10) + 2 * bonus),
        SpellPat.RADIUS_2);
      return;
    case Spell.SPARK:
    case Spell.ICE_BOLT: {
      const dam = spell === Spell.SPARK
        ? rng.getRan(2, 1, 4) : rng.getRan(min(20, level + bonus), 1, 4);
      hitSpace(session, target, dam,
        spell === Spell.SPARK ? DamageType.MAGIC : DamageType.COLD, 1, 0, who);
      return;
    }
    case Spell.ARROWS_FLAME:
      hitSpace(session, target, rng.getRan(2, 1, 4), DamageType.FIRE, 1, 0, who);
      return;
    case Spell.SMITE:
      hitSpace(session, target, rng.getRan(2, 1, 5), DamageType.COLD, 1, 0, who);
      return;
    case Spell.WOUND:
    case Spell.WRACK: {
      const dam = spell === Spell.WRACK
        ? rng.getRan(2 + Math.trunc(bonus / 2), 1, 4)
        : rng.getRan(min(7, 2 + bonus + Math.trunc(level / 2)), 1, 4);
      hitSpace(session, target, dam, DamageType.UNBLOCKABLE, 1, 0, who);
      return;
    }
    case Spell.FLAME:
      hitSpace(session, target,
        rng.getRan(min(10, 1 + Math.trunc(level / 3) + bonus), 1, 6),
        DamageType.FIRE, 1, 0, who);
      return;
    case Spell.FIREBALL:
    case Spell.FLAMESTRIKE: {
      let dam = min(9, 1 + Math.trunc((level * 2) / 3) + bonus) + 1;
      if (spell === Spell.FLAMESTRIKE) dam = Math.trunc((dam * 14) / 10);
      else if (dam > 10) dam = Math.trunc((dam * 8) / 10);
      if (dam <= 0) dam = 1;
      blast(DamageType.FIRE, dam, SpellPat.SQUARE);
      return;
    }
    case Spell.FIRESTORM:
    case Spell.ICY_RAIN: {
      let dam = min(12, 1 + Math.trunc((level * 2) / 3) + bonus) + 2;
      if (dam > 20) dam = Math.trunc((dam * 8) / 10);
      blast(spell === Spell.FIRESTORM ? DamageType.FIRE : DamageType.COLD,
        dam, SpellPat.RADIUS_2);
      return;
    }
    case Spell.KILL:
      hitSpace(session, target, 40 + rng.getRan(3, 0, 10) + caster.level * 2,
        DamageType.MAGIC, 1, 0, who);
      return;
    case Spell.ARROWS_DEATH:
      hitSpace(session, target,
        rng.getRan(3, 0, 10) + caster.level + 3 * bonus, DamageType.MAGIC, 1, 0, who);
      return;

    // --- summoning ---------------------------------------------------------
    case Spell.SUMMON_BEAST: case Spell.SUMMON_WEAK:
    case Spell.SUMMON: case Spell.SUMMON_AID:
    case Spell.SUMMON_MAJOR: case Spell.SUMMON_AID_MAJOR:
    case Spell.DEMON: case Spell.SUMMON_RAT: case Spell.SUMMON_SPIRIT:
    case Spell.STICKS_TO_SNAKES: case Spell.SUMMON_HOST:
    case Spell.SUMMON_GUARDIAN: {
      const adj = caster.statAdj(Skill.INTELLIGENCE);
      let which = 0;
      let dice = 3;
      switch (spell) {
        case Spell.SUMMON_BEAST: which = getSummonMonster(session, 1); dice = 3; break;
        case Spell.SUMMON_WEAK: which = getSummonMonster(session, 1); dice = 4; break;
        case Spell.SUMMON: case Spell.SUMMON_AID:
          which = getSummonMonster(session, 2); dice = 5; break;
        case Spell.SUMMON_MAJOR: case Spell.SUMMON_AID_MAJOR:
          which = getSummonMonster(session, 3); dice = 7; break;
        case Spell.DEMON: which = 85; dice = 5; break;
        case Spell.SUMMON_RAT: which = 80; dice = 3; break;
        case Spell.SUMMON_SPIRIT: which = 125; dice = 2; break;
        case Spell.SUMMON_HOST: which = 126; dice = 2; break;
        case Spell.SUMMON_GUARDIAN: which = 122; dice = 6; break;
        default: {
          // Sticks to Snakes rolls which of the two snakes it gets.
          const r1 = rng.getRan(1, 0, 7);
          which = r1 === 1 ? 100 : 99;
          dice = 2;
          break;
        }
      }
      const sides = spell === Spell.SUMMON_SPIRIT || spell === Spell.STICKS_TO_SNAKES ? 5 : 4;
      const strength = rng.getRan(dice, 1, sides) + adj;
      if (which === 0
        || !summonMonster(session, which, target, strength, Attitude.FRIENDLY, true)) {
        univ.addStringToBuf('  Summon failed.');
      }
      return;
    }

    case Spell.FLASH_STEP:
      if (session.isBlocked(target)) univ.addStringToBuf('  Teleport failed.');
      else {
        univ.addStringToBuf('  Flash step!');
        caster.combatPos = { ...target };
        // This can carry you *out* of a force cage without breaking it. Walking
        // into one is caught later by sync_force_cages.
        caster.status[Status.FORCECAGE] = 0;
      }
      return;

    default:
      break;
  }

  // --- everything left needs somebody standing there ------------------------
  const victim = targetThere(univ, target);
  if (!victim) {
    univ.addStringToBuf('  Nobody there.');
    return;
  }
  const monst = victim instanceof Creature ? victim : null;
  // Aiming at a friendly is an act of war, unless you were only looking.
  if (monst?.isFriendly && spell !== Spell.SCRY_MONSTER && spell !== Spell.CAPTURE_SOUL) {
    makeTownHostile(session);
  }

  switch (spell) {
    case Spell.ACID_SPRAY: victim.acid(level); livingSound(24); break;
    case Spell.PARALYZE_BEAM: victim.sleep(Status.PARALYZED, 500, 0, rng); break;
    case Spell.UNHOLY_RAVAGING: {
      const r2 = rng.getRan(1, 0, 2);
      if (monst) damageMonst(univ, monst, 7, rng.getRan(4, 1, 8), DamageType.MAGIC, { session });
      victim.slow(4 + r2);
      victim.poison(5 + r2, rng);
      break;
    }
    case Spell.SCRY_MONSTER:
      if (!monst) { univ.addStringToBuf('  Nobody there.'); break; }
      livingSound(52);
      univ.party.mNoted.add(monst.number);
      univ.addStringToBuf(`  ${monst.mon.name} noted.`);
      break;
    case Spell.CAPTURE_SOUL:
      if (!monst) { univ.addStringToBuf('  Nobody there.'); break; }
      // TODO(M6): record_monst — the roster Simulacrum draws from.
      univ.addStringToBuf('  Capture Soul is not in yet.');
      break;
    case Spell.MINDDUEL:
      // TODO(M6): do_mindduel, which also wants a smoky crystal.
      univ.addStringToBuf('  Mindduel is not in yet.');
      break;
    case Spell.CHARM_FOE:
      victim.sleep(Status.CHARM, 0, -1 * (bonus + Math.trunc(caster.level / 8)), rng);
      break;
    case Spell.DISEASE:
      victim.disease(2 + rng.getRan(1, 0, 1) + bonus, rng);
      break;
    case Spell.STRENGTHEN_TARGET:
      victim.heal(20);
      break;
    case Spell.DUMBFOUND:
      victim.dumbfound(1 + Math.trunc(bonus / 3), rng);
      break;
    case Spell.SCARE:
      victim.scare(rng.getRan(2 + bonus, 1, 6));
      break;
    case Spell.FEAR:
      victim.scare(rng.getRan(min(20, Math.trunc(caster.level / 2) + bonus), 1, 8));
      break;
    case Spell.SLOW:
      victim.slow(2 + rng.getRan(1, 0, 1) + bonus);
      break;
    case Spell.POISON_MINOR: case Spell.ARROWS_VENOM:
      victim.poison(2 + Math.trunc(bonus / 2), rng);
      break;
    case Spell.PARALYZE:
      victim.sleep(Status.PARALYZED, 1000, -10, rng);
      break;
    case Spell.POISON:
      victim.poison(4 + Math.trunc(bonus / 2), rng);
      break;
    case Spell.POISON_MAJOR:
      victim.poison(8 + Math.trunc(bonus / 2), rng);
      break;
    case Spell.STUMBLE:
      victim.curse(4 + bonus);
      break;
    case Spell.CURSE:
      victim.curse(2 + bonus);
      break;
    case Spell.HOLY_SCOURGE:
      victim.curse(2 + Math.trunc(caster.level / 2));
      break;

    case Spell.TURN_UNDEAD:
    case Spell.DISPEL_UNDEAD: {
      const race = monst ? monst.mon.race : (victim as Player).race;
      if (race !== Race.UNDEAD && race !== Race.SKELETAL) {
        univ.addStringToBuf('  Not undead.');
        break;
      }
      const roll = rng.getRan(1, 0, 90);
      const odds = hitChance(Math.max(0, Math.min(19,
        bonus * 2 + level * 4 - Math.trunc(victim.getLevel() / 2) + 3)));
      if (roll > odds) {
        univ.addStringToBuf('  Monster resisted.');
        break;
      }
      let dam = rng.getRan(spell === Spell.TURN_UNDEAD ? 2 : 6, 1, 14);
      if (caster.traits[Trait.ANAMA]) dam += 15;
      if (monst) damageMonst(univ, monst, who, dam, DamageType.UNBLOCKABLE, { session });
      else damagePc(univ, victim as Player, dam, DamageType.UNBLOCKABLE);
      break;
    }

    case Spell.RAVAGE_SPIRIT: {
      const race = monst ? monst.mon.race : (victim as Player).race;
      if (race !== Race.DEMON) {
        univ.addStringToBuf('  Not a demon.');
        break;
      }
      const roll = rng.getRan(1, 1, 100);
      const odds = hitChance(Math.max(0, Math.min(19,
        level * 4 - victim.getLevel() + 10)));
      if (roll > odds) {
        univ.addStringToBuf('  Demon resisted.');
        break;
      }
      let dam = rng.getRan(8 + bonus * 2, 1, 11);
      const dumb = caster.status[Status.DUMB] ?? 0;
      // Enlightenment (a negative DUMB) makes this hit far harder; the Anama
      // bonus is an either/or with it, not a stack.
      if (dumb < 0) dam += Math.trunc((-25 * dumb) / 3);
      else if (caster.traits[Trait.ANAMA]) dam += 25;
      if (monst) damageMonst(univ, monst, who, dam, DamageType.UNBLOCKABLE, { session });
      else damagePc(univ, victim as Player, dam, DamageType.UNBLOCKABLE);
      break;
    }

    default:
      univ.addStringToBuf(
        `  Error: Spell not implemented for combat mode. ${spellName(spell)}`);
      break;
  }
}
