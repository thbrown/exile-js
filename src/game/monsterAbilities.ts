/**
 * What a monster does at range — the ability-picking loop from
 * `do_monster_turn` (boe.combat.cpp:2303), `monst_fire_missile`
 * (boe.combat.cpp:2865) and `monst_basic_abil` (boe.combat.cpp:3043).
 *
 * This is what makes an archer shoot instead of walking up to you, and a
 * drake breathe. The projectile that flies across the screen while it happens
 * is `run_a_missile`, in `missileAnim.ts`.
 */

import { Location, dist } from '../core/location';
import { DamageType } from '../data/monster';
import { FieldType } from '../data/fields';
import {
  Ability, MonstAbil, MonstGen, MonstMissile, MonstSummon, abilityApCost,
} from '../data/monsterAbility';
import { getSummonMonster, summonMonster } from './monsterPlace';
import { ItemAbil } from '../data/item';
import { Creature } from '../universe/creature';
import { hasAbilEquip } from '../universe/inventory';
import { Living, SpellNote, livingSound } from '../universe/living';
import { Player } from '../universe/player';
import { MainStatus, Status } from '../universe/skills';
import { damageMonst, damagePc, hitChance } from './damage';
import { runAMissile } from './missileAnim';
import { isCombat } from './modes';
import type { GameSession } from './session';

/** The ability a monster picked this turn, and which slot it came from. */
export interface PickedAbility {
  key: MonstAbil;
  abil: Ability;
}

/**
 * The `for(auto& abil : cur_monst->abil)` loop in do_monster_turn: walk the
 * active abilities in key order and take the first one that is in range, isn't
 * better served by a melee swing, and passes its odds roll. Odds are in
 * thousandths, and the comparison is `get_ran(1,1,1000) >= odds` to *reject*.
 *
 * SUMMON and SPECIAL aren't here because the C++ handles them outside this
 * loop — see `monsterSummon` below.
 *
 * TODO(M5b): DRAIN_SP's search for someone worth draining, which can retarget
 * the whole attack.
 */
export function pickMonsterAbility(
  session: GameSession,
  monst: Creature,
  targSpace: { x: number; y: number },
  adjacent: boolean,
): PickedAbility | null {
  const rng = session.univ.rng;
  const range = dist(monst.curLoc, targSpace);

  for (let key = MonstAbil.MISSILE; key <= MonstAbil.SUMMON; key++) {
    const abil = monst.mon.abil[key];
    if (!abil?.active) continue;

    switch (key) {
      case MonstAbil.MISSILE:
        if (range > abil.missile.range) break;
        // Spines fire point-blank; everything else prefers to swing when the
        // target is right there.
        if (abil.missile.type !== MonstMissile.SPINE && adjacent) break;
        if (rng.getRan(1, 1, 1000) >= abil.missile.odds) break;
        return { key, abil };

      case MonstAbil.DAMAGE:
      case MonstAbil.DAMAGE2:
      case MonstAbil.STATUS:
      case MonstAbil.STATUS2:
      case MonstAbil.STUN:
      case MonstAbil.FIELD:
      case MonstAbil.PETRIFY:
      case MonstAbil.DRAIN_SP:
      case MonstAbil.DRAIN_XP:
      case MonstAbil.KILL:
      case MonstAbil.STEAL_FOOD:
      case MonstAbil.STEAL_GOLD:
        // A touch rides along with the melee attack; this loop wants reach.
        if (abil.gen.type === MonstGen.TOUCH) break;
        if (range > abil.gen.range) break;
        // Spitting, like a thrown missile, is saved for a target further off.
        if (abil.gen.type === MonstGen.SPIT && adjacent) break;
        if (rng.getRan(1, 1, 1000) >= abil.gen.odds) break;
        return { key, abil };

      case MonstAbil.MISSILE_WEB:
      case MonstAbil.RAY_HEAT:
        // These two keep their range and odds in the special parameters.
        if (range > abil.special.extra1) break;
        if (rng.getRan(1, 1, 1000) >= abil.special.extra2) break;
        return { key, abil };

      default:
        break;
    }
  }
  return null;
}

/** The spell note and sound a thrown or fired missile announces itself with. */
function missileNote(type: MonstMissile): { note: SpellNote; sound: number } {
  switch (type) {
    case MonstMissile.ARROW:
    case MonstMissile.BOLT:
    case MonstMissile.RAPID_ARROW:
      return { note: SpellNote.SHOOTS, sound: 12 };
    case MonstMissile.SPEAR: return { note: SpellNote.THROWS_SPEAR, sound: 14 };
    case MonstMissile.RAZORDISK: return { note: SpellNote.THROWS_RAZORDISK, sound: 14 };
    case MonstMissile.SPINE: return { note: SpellNote.SPINES, sound: 14 };
    case MonstMissile.DART: return { note: SpellNote.THROWS_DART, sound: 14 };
    case MonstMissile.ROCK:
    case MonstMissile.BOULDER:
      return { note: SpellNote.THROWS_ROCK, sound: 14 };
    case MonstMissile.KNIFE: return { note: SpellNote.THROWS_KNIFE, sound: 14 };
    default: return { note: SpellNote.SHOOTS, sound: 14 };
  }
}

/**
 * monst_fire_missile (boe.combat.cpp:2865) — everything a monster does at
 * range. The C++ funnels all four kinds through here, and so does this: a
 * missile, a thrown web, a heat ray, or one of the general abilities arriving
 * as a ray, a gaze, a breath or a spit.
 */
export function monstFireMissile(
  session: GameSession,
  monst: Creature,
  key: MonstAbil,
  abil: Ability,
  target: Living,
): void {
  if (!target.isAlive) return;
  const targSpace = target.getLoc();
  const source = monst.curLoc;

  if (key === MonstAbil.MISSILE) {
    monstFireMissileProper(session, monst, abil, target);
    return;
  }

  if (key === MonstAbil.MISSILE_WEB) {
    target.spellNote(SpellNote.THROWS_WEB);
    runAMissile(source, targSpace, 8, 0, 14, 0, 0, 100);
    webSpace(session, targSpace);
    return;
  }

  if (key === MonstAbil.RAY_HEAT) {
    target.spellNote(SpellNote.HEAT_RAY);
    runAMissile(source, targSpace, 13, 0, 51, 0, 0, 100);
    // The C++ builds a throwaway DAMAGE ability out of the ray's parameters and
    // runs that, so the heat ray is fire damage of strength extra3.
    const proxy: Ability = {
      ...abil,
      gen: {
        ...abil.gen,
        type: MonstGen.RAY,
        strength: abil.special.extra3,
        extra: DamageType.FIRE,
      },
    };
    monsterBasicAbil(session, monst, MonstAbil.DAMAGE, proxy, target);
    return;
  }

  // Everything else: announce how it arrives, then resolve it.
  //
  // TODO(M5b): DRAIN_SP's retargeting, which looks for someone who still has
  // spell points before the attack lands.
  let snd = 0;
  let pathType = 0;
  switch (abil.gen.type) {
    case MonstGen.TOUCH: return; // never reached — a touch rides a melee swing
    case MonstGen.RAY:
      snd = 51;
      target.spellNote(SpellNote.FIRES_RAY);
      break;
    case MonstGen.GAZE:
      snd = 43;
      target.spellNote(SpellNote.GAZES2);
      break;
    case MonstGen.BREATH:
      snd = 44;
      target.spellNote(SpellNote.BREATHES_ON);
      break;
    case MonstGen.SPIT:
      pathType = 1;
      snd = 64;
      target.spellNote(SpellNote.SPITS);
      break;
    default:
      break;
  }
  if (abil.gen.pic < 0) livingSound(snd);
  else runAMissile(source, targSpace, abil.gen.pic, pathType, snd, 0, 0, 100);
  monsterBasicAbil(session, monst, key, abil, target);
}

/**
 * web_space (boe.combat.cpp:5253) — a web lands on a square, and anyone
 * standing there is caught in it as well.
 */
function webSpace(session: GameSession, where: Location): void {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return;
  town.setField(where.x, where.y, FieldType.FIELD_WEB, true);
  if (isCombat(session.mode)) {
    for (const pc of univ.party.pcs)
      if (pc.mainStatus === MainStatus.ALIVE
        && pc.combatPos.x === where.x && pc.combatPos.y === where.y) pc.web(3);
  } else if (univ.party.townLoc.x === where.x && univ.party.townLoc.y === where.y) {
    for (const pc of univ.party.pcs) pc.web(3);
  }
}

/**
 * monst_fire_missile's MISSILE branch — the arrow, spear or spine itself.
 *
 * TODO(M5b): the target's HIT_CALL_SPECIAL item ability.
 */
function monstFireMissileProper(
  session: GameSession,
  monst: Creature,
  abil: Ability,
  target: Living,
): void {
  const univ = session.univ;
  const targSpace = target.getLoc();
  const pcTarget = target instanceof Player ? target : null;
  const mTarget = target instanceof Creature ? target : null;

  const { note, sound } = missileNote(abil.missile.type);
  target.spellNote(note);
  // A missile with no picture has nothing to draw, so it only makes its noise.
  if (abil.missile.pic < 0) livingSound(sound);
  else runAMissile(monst.curLoc, targSpace, abil.missile.pic, 1, sound, 0, 0, 100);

  // Sanctuary: an unseen target is hard to hit, and the roll is indexed by the
  // *monster's level* rather than a weapon skill — a debuff, as the C++ notes.
  if ((target.status[Status.INVISIBLE] ?? 0) > 0
    || (mTarget !== null && mTarget.mon.invisible)) {
    if (univ.rng.getRan(1, 1, 100) > hitChance(monst.mon.level)) {
      univ.addStringToBuf("  Can't find target!");
      return;
    }
  }

  const bless = monst.status[Status.BLESS_CURSE] ?? 0;
  const targetBless = target.status[Status.BLESS_CURSE] ?? 0;
  let r1 = univ.rng.getRan(1, 1, 100)
    - 5 * Math.min(8, bless)
    + 5 * targetBless
    - 5 * session.canSeeLight(monst.curLoc, targSpace);
  if (pcTarget) {
    // TODO(M5b): the EVASION item ability adds to this too.
    if (pcTarget.parry < 100) r1 += 5 * pcTarget.parry;
  }

  if (r1 <= hitChance(abil.missile.skill)) {
    const dmg = univ.rng.getRan(abil.missile.dice, 1, abil.missile.sides) + Math.min(10, bless);
    target.spellNote(SpellNote.HITS);
    if (pcTarget) {
      damagePc(univ, pcTarget, dmg, DamageType.WEAPON, monst.mon.race, { soundType: 13 });
    } else if (mTarget) {
      damageMonst(univ, mTarget, 7, dmg, DamageType.WEAPON, { soundType: 13, session });
    }
  } else {
    target.spellNote(SpellNote.MISSES);
  }
}

/**
 * monst_basic_abil — what a general (non-missile) ability actually does once
 * it has reached its target.
 *
 * TODO(M5b): PETRIFY needs petrify_pc/petrify_monst; FIELD needs
 * `place_spell_pattern`, which is M5c.
 */
export function monsterBasicAbil(
  session: GameSession,
  monst: Creature,
  key: MonstAbil,
  abil: Ability,
  target: Living,
): void {
  if (!target.isAlive) return;
  const univ = session.univ;
  const rng = univ.rng;
  const pcTarget = target instanceof Player ? target : null;
  const mTarget = target instanceof Creature ? target : null;
  const strength = abil.gen.strength;
  const percentOf = (v: number, p: number): number => Math.trunc((v * p) / 100);

  switch (key) {
    case MonstAbil.DAMAGE:
    case MonstAbil.DAMAGE2: {
      // The die size depends on how the attack arrives: a breath is bigger
      // than a ray, and a spit or a touch bigger still.
      let sides = 6;
      if (abil.gen.type === MonstGen.BREATH) sides = 8;
      else if (abil.gen.type === MonstGen.SPIT || abil.gen.type === MonstGen.TOUCH) sides = 10;
      const dmg = rng.getRan(strength, 1, sides);
      let damType = abil.gen.extra as DamageType;
      // Nothing but assassination deals true SPECIAL damage.
      if (damType >= DamageType.SPECIAL) damType = DamageType.UNBLOCKABLE;
      if (pcTarget) damagePc(univ, pcTarget, dmg, damType, monst.mon.race);
      else if (mTarget) damageMonst(univ, mTarget, 7, dmg, damType, { session });
      break;
    }

    case MonstAbil.STUN:
      // A life-saving item shrugs a stun off entirely; short of that it
      // behaves as a status like any other (the C++ falls through to it).
      if (pcTarget && hasAbilEquip(pcTarget, ItemAbil.LIFE_SAVING)) break;
      applyGeneralStatus(session, monst, abil, target);
      break;

    case MonstAbil.STATUS:
    case MonstAbil.STATUS2:
      applyGeneralStatus(session, monst, abil, target);
      break;

    case MonstAbil.DRAIN_SP:
      target.spellNote(SpellNote.DRAINS);
      if (pcTarget) pcTarget.curSp = percentOf(pcTarget.curSp, strength);
      else if (mTarget) mTarget.mp = percentOf(mTarget.mp, strength);
      break;

    case MonstAbil.KILL: {
      // Ten dice per point of strength, so this is the one that just kills you.
      const dmg = rng.getRan(10 * strength, 1, 10);
      if (pcTarget) damagePc(univ, pcTarget, dmg, DamageType.UNBLOCKABLE, monst.mon.race);
      else if (mTarget) damageMonst(univ, mTarget, 7, dmg, DamageType.UNBLOCKABLE, { session });
      break;
    }

    case MonstAbil.STEAL_FOOD:
      if (!pcTarget) break;
      univ.party.food = Math.max(0, univ.party.food - rng.getRan(1, 0, strength) - strength);
      break;

    case MonstAbil.STEAL_GOLD:
      if (!pcTarget) break;
      univ.party.gold = Math.max(0, univ.party.gold - rng.getRan(1, 0, strength) - strength);
      break;

    case MonstAbil.PETRIFY:
      // TODO(M5b): petrify_pc / petrify_monst.
      univ.addStringToBuf('(Petrification needs M5b)');
      break;

    case MonstAbil.DRAIN_XP:
      // TODO(M5b): drain_pc — losing a level, which needs the level-down path.
      univ.addStringToBuf('(Experience drain needs M5b)');
      break;

    case MonstAbil.FIELD:
      // TODO(M5c): place_spell_pattern.
      break;

    default:
      break;
  }
}

/** The eStatus switch inside monst_basic_abil's STATUS/STATUS2/STUN branch. */
function applyGeneralStatus(
  session: GameSession, monst: Creature, abil: Ability, target: Living,
): void {
  const rng = session.univ.rng;
  const strength = abil.gen.strength;
  const stat = abil.gen.extra as Status;
  switch (stat) {
    case Status.PARALYZED:
    case Status.ASLEEP: {
      // The adjustment is a *bonus to the roll*, so a touch (a large negative)
      // is much harder to resist than a ray from a low-level monster.
      const adj = abil.gen.type === MonstGen.TOUCH
        ? (stat === Status.ASLEEP ? -15 : -5)
        : Math.trunc(monst.mon.level / 2);
      target.sleep(stat, strength, adj, rng);
      break;
    }
    case Status.ACID: target.acid(strength); break;
    case Status.POISON: target.poison(strength, rng); break;
    case Status.BLESS_CURSE: target.curse(strength); break;
    case Status.HASTE_SLOW: target.slow(strength); break;
    case Status.WEBS: target.web(strength); break;
    case Status.DISEASE: target.disease(strength, rng); break;
    case Status.DUMB: target.dumbfound(strength, rng); break;
    case Status.INVULNERABLE:
    case Status.MAGIC_RESISTANCE:
    case Status.INVISIBLE:
    case Status.MARTYRS_SHIELD:
      // Negated: an attack *removes* these, it doesn't grant them.
      target.applyStatus(stat, -strength);
      break;
    case Status.FORCECAGE: target.sleep(stat, 8, strength, rng); break;
    case Status.CHARM: target.sleep(stat, monst.attitude, strength, rng); break;
    // These two make no sense as an attack.
    case Status.MAIN:
    case Status.POISONED_WEAPON:
    default:
      break;
  }
}

/**
 * The SUMMON half of do_monster_turn's trailing "place fields for monsters
 * that create them" block (boe.combat.cpp:2496). It runs *after* the monster
 * has spent its action points, costs nothing, and only when the monster can
 * see its target — a summoner that hasn't noticed anyone stays quiet.
 *
 * Note the chance here is read as a **plain percentage** (`get_ran(1,1,100) <
 * chance`), which is why `readMonstAbilFromXml` leaves the summon chance
 * un-multiplied while everything else goes to tenths.
 */
export function monsterSummon(session: GameSession, monst: Creature): void {
  const univ = session.univ;
  const abil = monst.mon.abil[MonstAbil.SUMMON];
  if (!abil?.active) return;
  if (univ.rng.getRan(1, 1, 100) >= abil.summon.chance) return;

  let whatSummon = 0;
  switch (abil.summon.type) {
    case MonstSummon.TYPE:
      whatSummon = abil.summon.what;
      break;
    case MonstSummon.LEVEL:
      whatSummon = getSummonMonster(session, Math.min(4, Math.max(0, abil.summon.what)));
      break;
    case MonstSummon.SPECIES: {
      const monsters = univ.scenario.scenMonsters;
      for (let k = 0; k < 200; k++) {
        const j = univ.rng.getRan(1, 0, monsters.length - 1);
        if (monsters[j]?.race === abil.summon.what) {
          whatSummon = j;
          break;
        }
      }
      if (!whatSummon) univ.addStringToBuf('  Summon failed.');
      break;
    }
    default:
      break;
  }

  let count = whatSummon ? univ.rng.getRan(1, abil.summon.min, abil.summon.max) : 0;
  if (!count) return;
  const attitude = monst.attitude;
  const byParty = monst.isFriendly;
  if (!summonMonster(
    session, whatSummon, monst.curLoc, abil.summon.len, attitude, byParty, true)) return;

  monst.spellNote(SpellNote.SUMMONS);
  livingSound(61);
  // `while(--r1 && !failed) failed = summon_monster(...)`: `failed` is assigned
  // the return value, which is **true on success**, so the loop stops after one
  // more creature lands and keeps going only while summoning *fails*. It reads
  // like a sign slip in CBoE, but a max of 5 really does place two monsters, so
  // the port keeps it.
  let failed = false;
  while (--count && !failed) {
    failed = summonMonster(
      session, whatSummon, monst.curLoc, abil.summon.len, attitude, byParty, true);
  }
}

/** What the chosen ability costs the monster in action points. */
export function abilityCost(picked: PickedAbility): number {
  return abilityApCost(picked.key, picked.abil);
}

/** Whether a PC still counts as a target for an ability. */
export function targetIsAlive(target: Living): boolean {
  if (target instanceof Player) return target.mainStatus === MainStatus.ALIVE;
  return target.isAlive;
}
