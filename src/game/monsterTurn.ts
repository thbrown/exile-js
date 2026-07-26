/**
 * The monsters' half of a combat round — `do_monster_turn` (boe.combat.cpp:2056),
 * `monster_attack` (:2629), and the movement helpers from boe.monster.cpp
 * (`monst_pick_target`, `seek_party`, `try_move`, `combat_move_monster`).
 *
 * This is the M5b slice that makes a fight a fight: monsters notice the party,
 * get action points, pick a target, close on it and hit it. What it does *not*
 * do yet is anything that needs the `uAbility` port — breath weapons, missiles,
 * spellcasting, summoning, touch effects — and each of those is marked where it
 * belongs so the rest can be dropped in without rearranging this.
 */

import { Location, dist, loc } from '../core/location';
import { Attack, Attitude, DamageType } from '../data/monster';
import { Creature, CreatureStatus } from '../universe/creature';
import { Living, SpellNote, livingSound } from '../universe/living';
import { Player } from '../universe/player';
import { MainStatus, Race, Skill, Status } from '../universe/skills';
import { Universe } from '../universe/universe';
import { NO_ONE } from './combat';
import { damageMonst, damagePc, hitChance } from './damage';
import type { GameSession } from './session';

/** move_to_zero — one step toward zero from either side. */
function moveToZero(value: number): number {
  if (value > 0) return value - 1;
  if (value < 0) return value + 1;
  return 0;
}

/** adjacent (boe.locutils.cpp) — within one square, diagonals included. */
function adjacent(a: Location, b: Location): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

/**
 * monst_adjacent (boe.locutils.cpp:340) — a big creature counts from any of
 * the squares it covers.
 */
export function monstAdjacent(monst: Creature, where: Location): boolean {
  for (let i = 0; i < monst.xWidth; i++)
    for (let j = 0; j < monst.yWidth; j++)
      if (adjacent(loc(monst.curLoc.x + i, monst.curLoc.y + j), where)) return true;
  return false;
}

/** monst_can_see (boe.locutils.cpp:353) — line of sight from any of its squares. */
export function monstCanSee(session: GameSession, monst: Creature, where: Location): boolean {
  for (let i = 0; i < monst.xWidth; i++)
    for (let j = 0; j < monst.yWidth; j++) {
      const from = loc(monst.curLoc.x + i, monst.curLoc.y + j);
      if (session.canSeeLight(from, where) < 5) return true;
    }
  return false;
}

/** closest_pc — the index of the nearest living PC, or 6 for none. */
export function closestPc(univ: Universe, where: Location): number {
  let best = NO_ONE;
  let howClose = 200;
  for (let i = 0; i < univ.party.pcs.length; i++) {
    const pc = univ.party.pcs[i]!;
    if (!pc.isAlive) continue;
    const d = dist(where, pc.combatPos);
    if (d < howClose) {
      best = i;
      howClose = d;
    }
  }
  return best;
}

/** closest_pc_loc — where that PC is standing. */
function closestPcLoc(univ: Universe, where: Location): Location {
  const who = closestPc(univ, where);
  return who === NO_ONE ? where : univ.party.pcs[who]!.combatPos;
}

/**
 * monst_pick_target_pc (boe.monster.cpp) — a visible PC at random, then a
 * second pass preferring one within four squares. The rolls are kept because
 * the number of them is part of the RNG sequence.
 */
function pickTargetPc(session: GameSession, monst: Creature): number {
  const univ = session.univ;
  if (monst.isFriendly) return NO_ONE;
  let tries = 0;
  let r1 = univ.rng.getRan(1, 0, 5);
  const unusable = (i: number): boolean => {
    const pc = univ.party.pcs[i];
    return !pc || !pc.isAlive || !monstCanSee(session, monst, pc.combatPos);
  };
  while (tries < 6 && unusable(r1)) {
    r1 = univ.rng.getRan(1, 0, 5);
    tries++;
  }
  const stored = tries < 6 ? r1 : NO_ONE;

  r1 = univ.rng.getRan(1, 0, 5);
  const tooFar = (i: number): boolean => {
    const pc = univ.party.pcs[i];
    return !pc || !pc.isAlive || dist(monst.curLoc, pc.combatPos) > 4
      || !monstCanSee(session, monst, pc.combatPos);
  };
  while (tries < 6 && tooFar(r1)) {
    r1 = univ.rng.getRan(1, 0, 5);
    tries++;
  }
  return tries < 6 ? r1 : stored;
}

/**
 * monst_pick_target (boe.monster.cpp) — cut down to the PC half. A monster
 * drops a dead target, sometimes drops a live one just to shift attention, and
 * otherwise keeps whoever it was already after.
 *
 * TODO(M5b): monst_pick_target_monst, so a charmed monster or a summoned ally
 * can be picked on, and the spell-caster/missile-firer priority (which needs
 * those two actions to exist first).
 */
export function monstPickTarget(session: GameSession, monst: Creature): number {
  const univ = session.univ;
  if (monst.target < NO_ONE) {
    const pc = univ.party.pcs[monst.target];
    if (!pc || !pc.isAlive || univ.rng.getRan(1, 0, 3) === 1) monst.target = NO_ONE;
  }
  if (monst.target < NO_ONE) {
    const pc = univ.party.pcs[monst.target]!;
    if (monstCanSee(session, monst, pc.combatPos)) return monst.target;
  }
  return pickTargetPc(session, monst);
}

/** combat_move_monster (boe.monster.cpp:710) — one step, if the square allows it. */
function combatMoveMonster(session: GameSession, monst: Creature, dest: Location): boolean {
  if (!session.monstCanBeAt(monst, dest)) return false;
  // TODO(M5b): monst_check_special_terrain and monst_inflict_fields.
  monst.direction = dirToward(monst.curLoc, dest);
  monst.curLoc = { ...dest };
  return true;
}

function dirToward(from: Location, to: Location): number {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === -1) return 0;
  if (dx === 1 && dy === -1) return 1;
  if (dx === 1 && dy === 0) return 2;
  if (dx === 1 && dy === 1) return 3;
  if (dx === 0 && dy === 1) return 4;
  if (dx === -1 && dy === 1) return 5;
  if (dx === -1 && dy === 0) return 6;
  if (dx === -1 && dy === -1) return 7;
  return 8;
}

/**
 * seek_party (boe.monster.cpp) — greedy movement toward a square: the diagonal
 * first, then each axis, then a random step if everything is blocked. It's
 * deliberately not pathfinding, which is why monsters get stuck on corners in
 * the original too.
 */
function seekParty(session: GameSession, monst: Creature, target: Location): boolean {
  const from = monst.curLoc;
  const tries: [number, number][] = [];
  if (from.x > target.x && from.y > target.y) tries.push([-1, -1]);
  if (from.x < target.x && from.y < target.y) tries.push([1, 1]);
  if (from.x > target.x && from.y < target.y) tries.push([-1, 1]);
  if (from.x < target.x && from.y > target.y) tries.push([1, -1]);
  if (from.x > target.x) tries.push([-1, 0]);
  if (from.x < target.x) tries.push([1, 0]);
  if (from.y < target.y) tries.push([0, 1]);
  if (from.y > target.y) tries.push([0, -1]);

  for (const [dx, dy] of tries) {
    if (combatMoveMonster(session, monst, loc(from.x + dx, from.y + dy))) return true;
  }
  // Boxed in: flail in a random direction.
  const m = session.univ.rng.getRan(1, 0, 2) - 1;
  const n = session.univ.rng.getRan(1, 0, 2) - 1;
  return combatMoveMonster(session, monst, loc(from.x + m, from.y + n));
}

/** flee_party — the mirror image of seekParty, moving away instead. */
function fleeParty(session: GameSession, monst: Creature, target: Location): boolean {
  const from = monst.curLoc;
  const away = loc(from.x + (from.x - target.x), from.y + (from.y - target.y));
  return seekParty(session, monst, away);
}

/** get_monst_sound (boe.combat.cpp:5296) — the sound one of its attacks makes. */
function monstSound(attack: Attack): number {
  // eMonstMelee: 0 claw/hit, 1 bite, 2 sting/spear, 3 web, 4 wall touch,
  // 5 punch/kick, 6 fire, 7 cold, 8 lightning, 9 slime.
  switch (attack.type) {
    case 1: return 15;
    case 2: return 15;
    case 6: return 5;
    case 7: return 7;
    case 8: return 12;
    default: return 0;
  }
}

/**
 * monster_attack (boe.combat.cpp:2629) — one monster's melee turn, which is up
 * to three attacks from its `attacks` list. Note the to-hit is indexed by
 * `(skill + 4) / 2` rather than by a weapon skill, and that a difficulty
 * adjustment multiplies the damage done to a PC but not to another monster.
 *
 * TODO(M5b): the TOUCH abilities that fire on a landed hit — stun, petrify,
 * drain, steal — need the uAbility port.
 */
export function monsterAttack(
  session: GameSession,
  monst: Creature,
  target: Living,
): void {
  const univ = session.univ;
  // A peaceful monster won't turn on the party or on another ally.
  if (monst.isFriendly && target.isFriendly) return;

  if (monst.mon.attacks.some((a) => a.dice !== 0)) monst.printAttacks(target);

  const pcTarget = target instanceof Player ? target : null;
  const monstTarget = target instanceof Creature ? target : null;

  // Sanctuary: an invisible target may simply not be found. Note this rolls
  // against the *monster's level*, not a skill — a debuff in the original.
  const targetInvisible = (target.status[Status.INVISIBLE] ?? 0) > 0
    || (monstTarget?.mon.invisible ?? false);
  if (targetInvisible) {
    if (univ.rng.getRan(1, 1, 100) > hitChance(Math.trunc(monst.mon.level / 2))) {
      univ.addStringToBuf("  Can't find target!");
      return;
    }
  }

  for (let i = 0; i < monst.mon.attacks.length; i++) {
    const attack = monst.mon.attacks[i]!;
    if (attack.dice <= 0 || !target.isAlive) continue;

    // Hitting a docile creature makes it willing to fight back.
    if (monstTarget && monstTarget.attitude === Attitude.DOCILE) {
      monstTarget.attitude = Attitude.FRIENDLY;
    }

    let r1 = univ.rng.getRan(1, 1, 100);
    r1 -= 5 * Math.min(8, monst.status[Status.BLESS_CURSE] ?? 0);
    r1 += 5 * (target.status[Status.BLESS_CURSE] ?? 0) - 15;
    r1 += 5 * Math.trunc((monst.status[Status.WEBS] ?? 0) / 3);
    if ((monst.status[Status.FORCECAGE] ?? 0) > 0) r1 += 3;
    if ((target.status[Status.FORCECAGE] ?? 0) > 0) r1 += 1;
    if (pcTarget) {
      r1 += 5 * pcTarget.statAdj(Skill.DEXTERITY);
      if (pcTarget.parry < 100) r1 += 5 * pcTarget.parry;
    }

    let r2 = univ.rng.getRan(attack.dice, 1, attack.sides) + 1;
    r2 += Math.min(8, monst.status[Status.BLESS_CURSE] ?? 0);
    r2 -= target.status[Status.BLESS_CURSE] ?? 0;
    if (pcTarget) {
      const adj = univ.difficultyAdjust();
      if (adj > 2) r2 *= 2;
      else if (adj === 2) r2 = Math.trunc((r2 * 3) / 2);
    } else r2 += 1;

    if ((target.status[Status.ASLEEP] ?? 0) > 0 || (target.status[Status.PARALYZED] ?? 0) > 0) {
      r1 -= 80;
      r2 *= 2;
    }

    if (r1 > hitChance(Math.trunc((monst.mon.skill + 4) / 2))) continue;

    let damType = DamageType.WEAPON;
    if (monst.mon.race === Race.UNDEAD || monst.mon.race === Race.SKELETAL) {
      damType = DamageType.UNDEAD;
    } else if (monst.mon.race === Race.DEMON) damType = DamageType.DEMON;

    const storeHp = target.getHealth();
    livingSound(monstSound(attack));
    let damaged = 0;
    if (monstTarget) {
      damaged = damageMonst(univ, monstTarget, 7, r2, damType, { doPrint: false, session });
    } else if (pcTarget) {
      damaged = damagePc(univ, pcTarget, r2, damType, monst.mon.race);
    }
    if (damaged <= 0) continue;

    // A shielded target passes some of it back to the attacker.
    if (target.isShielded(univ.rng)) {
      const shared = monst.getSharedDmg(storeHp - target.getHealth(), univ.rng);
      univ.addStringToBuf('  Shares damage!');
      damageMonst(univ, monst, pcTarget ? 6 : 7, shared, DamageType.MAGIC, { session });
    }

    // Only the first attack carries the poison.
    if (i === 0 && (monst.status[Status.POISONED_WEAPON] ?? 0) > 0) {
      target.poison(monst.status[Status.POISONED_WEAPON] ?? 0, univ.rng);
      monst.status[Status.POISONED_WEAPON] = moveToZero(monst.status[Status.POISONED_WEAPON] ?? 0);
    }
  }
}

/**
 * The first half of do_monster_turn: notice the party, and hand out action
 * points. A monster in town gets a third of its speed, and summons expire.
 */
function giveMonstersMoves(session: GameSession): void {
  const univ = session.univ;
  for (const monst of univ.town?.monsters ?? []) {
    if (monst.active === CreatureStatus.IDLE && !monst.isFriendly) {
      // A hostile monster rolls to notice the party; the further it can see,
      // the worse its chances, and stealth makes it much worse.
      let r1 = univ.rng.getRan(1, 1, 100);
      r1 += session.canSeeLight(monst.curLoc, closestPcLoc(univ, monst.curLoc)) * 10;
      if (r1 < 50) monst.active = CreatureStatus.ALERTED;
      // And a fight nearby alerts it regardless.
      for (const other of univ.town?.monsters ?? []) {
        if (other !== monst && other.isAlive && other.active === CreatureStatus.ALERTED
          && dist(other.curLoc, monst.curLoc) <= 5) {
          monst.active = CreatureStatus.ALERTED;
        }
      }
    }

    monst.ap = 0;
    if (monst.active === CreatureStatus.ALERTED) {
      monst.ap = monst.mon.speed;
      if (session.univ.isInTown()) monst.ap = Math.max(1, Math.trunc(monst.ap / 3));
      if (univ.party.age % 2 === 0 && (monst.status[Status.HASTE_SLOW] ?? 0) < 0) monst.ap = 0;
      if (monst.ap > 0) {
        const webs = monst.status[Status.WEBS] ?? 0;
        monst.ap = Math.max(0, monst.ap - Math.trunc(webs / 2));
        if (monst.ap === 0) monst.status[Status.WEBS] = Math.max(0, webs - 2);
      }
      if ((monst.status[Status.HASTE_SLOW] ?? 0) > 0) monst.ap *= 2;
    }
    if ((monst.status[Status.ASLEEP] ?? 0) > 0 || (monst.status[Status.PARALYZED] ?? 0) > 0) {
      monst.ap = 0;
    }

    // Summons run out.
    if (monst.isAlive) {
      if (monst.summonTime === 1) {
        monst.active = CreatureStatus.DEAD;
        monst.ap = 0;
        monst.spellNote(SpellNote.DISAPPEARS);
      }
      monst.summonTime = moveToZero(monst.summonTime);
    }
  }
}

/**
 * do_monster_turn (boe.combat.cpp:2056) — every alerted monster spends its
 * action points: attack what's next to it, close on its target, or flee when
 * its morale has gone.
 *
 * TODO(M5b): breath weapons, mage and priest spells, missiles, summoning and
 * the SPECIAL ability all slot in between picking a target and swinging; they
 * need the uAbility port.
 */
export function doMonsterTurn(session: GameSession): void {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return;
  giveMonstersMoves(session);

  for (const monst of town.monsters) {
    if (!univ.party.pcs.some((pc) => pc.isAlive)) return;

    // A monster that can't reach anything shouldn't spin forever: the C++
    // relies on take_m_ap always firing, so the guard is a safety net for the
    // cases this port hasn't filled in yet.
    let guard = 40;
    while (monst.ap > 0 && monst.isAlive && guard-- > 0) {
      const target = monstPickTarget(session, monst);
      monst.target = target;
      const targSpace = target < NO_ONE
        ? univ.party.pcs[target]!.combatPos
        : monst.curLoc;
      let actedYet = false;

      // Flee when its nerve is gone — but the unliving and the mindless never do.
      const canFlee = !monst.mon.mindless && monst.mon.race !== Race.UNDEAD
        && monst.mon.race !== Race.SKELETAL;
      if (target !== NO_ONE && monst.morale <= 0 && canFlee) {
        if (monst.morale < 0) monst.morale++;
        if (monst.health > 50) monst.morale++;
        if (univ.rng.getRan(1, 1, 6) === 3) monst.morale++;
        if (monst.mobile) {
          actedYet = fleeParty(session, monst, targSpace);
          if (actedYet) monst.ap = Math.max(0, monst.ap - 1);
        }
      }

      // Melee, if it can reach.
      if (!actedYet && target !== NO_ONE && monst.attitude !== Attitude.DOCILE) {
        const who: Living | null = target < NO_ONE ? univ.party.pcs[target]! : null;
        if (who && who.isAlive && monstAdjacent(monst, targSpace) && !monst.isFriendly) {
          monsterAttack(session, monst, who);
          monst.ap = Math.max(0, monst.ap - 4);
          actedYet = true;
        }
      }

      // Otherwise close the distance.
      if (!actedYet && monst.mobile) {
        const moveTarget = target !== NO_ONE ? target : closestPc(univ, monst.curLoc);
        if (!monst.isFriendly && moveTarget < NO_ONE) {
          const pc = univ.party.pcs[moveTarget]!;
          if (pc.isAlive) seekParty(session, monst, pc.combatPos);
        }
        monst.ap = Math.max(0, monst.ap - 1);
        actedYet = true;
      }

      if (!actedYet) monst.ap = 0;
    }
    monst.ap = 0;
  }
}

/**
 * combat_run_monst (boe.combat.cpp:1867) — the monsters' turn plus the
 * end-of-round upkeep: the clock, the light burning down, and every timed
 * status ticking toward zero.
 *
 * TODO(M5c): process_fields belongs here — quickfire spreading and clouds
 * doing their damage.
 * TODO(M6): dump_gold and the OCCASIONAL_STATUS item effects.
 */
export function combatRunMonst(session: GameSession): void {
  const univ = session.univ;
  doMonsterTurn(session);

  univ.party.lightLevel = moveToZero(univ.party.lightLevel);
  const lighting = univ.townRecord?.lightingType ?? 0;
  if (lighting === 2) univ.party.lightLevel = Math.max(0, univ.party.lightLevel - 9);
  if (lighting === 3) univ.party.lightLevel = 0;

  univ.party.age++;
  // The long-lived statuses tick every fourth turn; the rest every turn.
  if (univ.party.age % 4 === 0) {
    for (const pc of univ.party.pcs) {
      pc.status[Status.BLESS_CURSE] = moveToZero(pc.status[Status.BLESS_CURSE] ?? 0);
      pc.status[Status.HASTE_SLOW] = moveToZero(pc.status[Status.HASTE_SLOW] ?? 0);
    }
  }
  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    for (const which of [
      Status.INVULNERABLE, Status.MAGIC_RESISTANCE, Status.INVISIBLE,
      Status.MARTYRS_SHIELD, Status.ASLEEP, Status.PARALYZED,
    ]) {
      pc.status[which] = moveToZero(pc.status[which] ?? 0);
    }
  }
  // TODO(M5b): handle_marked_damage, and the poison/disease/acid ticks that
  // ride along with the end of a combat turn.
}
