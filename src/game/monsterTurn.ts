/**
 * The monsters' half of a combat round — `do_monster_turn` (boe.combat.cpp:2056),
 * `monster_attack` (:2629), and the movement helpers from boe.monster.cpp
 * (`monst_pick_target`, `seek_party`, `try_move`, `combat_move_monster`).
 *
 * This is the M5b slice that makes a fight a fight: monsters notice the party,
 * get action points, pick a target, close on it and hit it. What it does *not*
 * do yet is monster spellcasting; missiles, breath, summoning and the touch
 * effects are all here, and the remaining gaps are marked where they belong.
 */

import { Location, dist, loc, locsEqual } from '../core/location';
import { Attack, Attitude, DamageType } from '../data/monster';
import { Creature, CreatureStatus } from '../universe/creature';
import { Living, SpellNote, livingSound } from '../universe/living';
import { MonstMelee } from '../data/monster';
import { Player } from '../universe/player';
import { MainStatus, Race, Skill, Status } from '../universe/skills';
import { Universe } from '../universe/universe';
import {
  MonstAbil, MonstAbilCat, MonstGen, abilityCategory,
} from '../data/monsterAbility';
import { NO_ONE } from './combat';
import {
  abilityCost, monstFireMissile, monsterBasicAbil, monsterSummon, pickMonsterAbility,
} from './monsterAbilities';
import { GameMode } from './modes';
import { damageMonst, damagePc, hitChance } from './damage';
import { onHitTargetSpecial } from './weaponAbilities';
import { ItemAbil } from '../data/item';
import { FieldType } from '../data/fields';
import { hasAbilEquip } from '../universe/inventory';
import { focusOn } from './anim';
import { doPoison, handleAcid, handleDisease } from './increaseAge';
import { processFields } from './processFields';
import { placeSpellPattern } from './spellPatterns';
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

/**
 * rand_move (boe.monster.cpp) — idle wandering. A monster keeps a `targLoc` it
 * is drifting toward and picks a new one when it arrives or gets stuck; the
 * town's own wandering_locs are among the candidates.
 */
function randMove(session: GameSession, monst: Creature): boolean {
  const univ = session.univ;
  if (locsEqual(monst.targLoc, monst.curLoc)) monst.targLoc = loc(0, monst.targLoc.y);

  let actedYet = false;
  if (monst.targLoc.x > 0) actedYet = seekParty(session, monst, monst.targLoc);
  if (actedYet) return true;

  monst.targLoc = loc(0, monst.targLoc.y);
  for (let j = 0; j < 3; j++) {
    const spot = loc(
      monst.curLoc.x + univ.rng.getRan(1, 0, 24) - 12,
      monst.curLoc.y + univ.rng.getRan(1, 0, 24) - 12);
    if (!session.locOffActiveArea(spot) && session.canSeeLight(monst.curLoc, spot) < 5) {
      monst.targLoc = spot;
      break;
    }
  }

  if (monst.targLoc.x === 0) {
    const wandering = univ.townRecord?.wanderingLocs ?? [];
    if (wandering.length > 0) {
      const spot = wandering[univ.rng.getRan(1, 0, wandering.length - 1)]!;
      if (!session.locOffActiveArea(spot) && univ.rng.getRan(1, 0, 1) === 1) {
        monst.targLoc = { ...spot };
      }
    }
    if (monst.targLoc.x === 0) {
      const spot = loc(
        monst.curLoc.x + univ.rng.getRan(1, 0, 20) - 10,
        monst.curLoc.y + univ.rng.getRan(1, 0, 20) - 10);
      if (!session.locOffActiveArea(spot)) monst.targLoc = spot;
    }
  }
  if (monst.targLoc.x > 0) actedYet = seekParty(session, monst, monst.targLoc);
  return actedYet;
}

/** select_active_pc — a living PC at random, for a town-mode attack. */
function selectActivePc(univ: Universe): number {
  let r1 = univ.rng.getRan(1, 0, 5);
  let tries = 0;
  while (!univ.party.pcs[r1]?.isAlive && tries++ < 50) r1 = univ.rng.getRan(1, 0, 5);
  return r1;
}

/**
 * do_monsters (boe.monster.cpp:193), the town-mode half — this is what makes an
 * encounter happen at all: hostile monsters notice the party from up to eight
 * squares away, say so, and walk over. It runs after **every** party action,
 * not only in combat.
 */
export function doMonsters(session: GameSession): void {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return;
  const partyLoc = univ.party.townLoc;

  for (const monst of town.monsters) {
    if (!monst.isAlive) continue;
    if ((monst.status[Status.ASLEEP] ?? 0) > 0 || (monst.status[Status.PARALYZED] ?? 0) > 0) {
      continue;
    }

    // Pick a target: in town it's the party as a whole, and only when close.
    let target = NO_ONE;
    if (monst.active !== CreatureStatus.IDLE && !monst.isFriendly) {
      if (dist(monst.curLoc, partyLoc) <= 8) target = 0;
    }
    monst.target = target;

    if (monst.active === CreatureStatus.ALERTED || monst.isFriendly) {
      // Nothing to chase: drift, or drift *toward* the party if it's nasty.
      // Once the town has turned hostile nobody drifts idly any more.
      if ((monst.attitude === Attitude.DOCILE || target === NO_ONE) && !town.monstHostile
        && monst.mobile) {
        if (monst.isFriendly || univ.rng.getRan(1, 0, 1) === 0) randMove(session, monst);
        else seekParty(session, monst, partyLoc);
      }
      // The C++ doesn't gate this second block on the first having done
      // nothing, and the only way to reach it having already drifted is a
      // docile creature in a hostile town — which then really does get both.
      if ((monst.attitude !== Attitude.DOCILE || town.monstHostile)
        && monst.mobile && target !== NO_ONE) {
        const canFlee = !monst.mon.mindless && monst.mon.race !== Race.UNDEAD
          && monst.mon.race !== Race.SKELETAL;
        if (monst.morale < 0 && canFlee) {
          fleeParty(session, monst, partyLoc);
          if (univ.rng.getRan(1, 0, 10) < 6) monst.morale++;
        } else if (monst.mon.mu === 0 || session.canSeeLight(monst.curLoc, partyLoc) > 3) {
          // A spellcaster keeps its distance unless it can't see you anyway.
          seekParty(session, monst, partyLoc);
        }
      }
    }

    // Notice the party — and tell the player, which is the cue to fight or run.
    if (monst.active === CreatureStatus.IDLE && !monst.isFriendly
      && dist(monst.curLoc, partyLoc) <= 8) {
      const r1 = univ.rng.getRan(1, 1, 100)
        + session.canSeeLight(monst.curLoc, partyLoc) * 10;
      if (r1 < 50) {
        monst.active = CreatureStatus.ALERTED;
        univ.addStringToBuf('Monster saw you!');
        livingSound(monst.mon.race === Race.GIANT || monst.mon.race <= Race.VAHNATAI
          || monst.mon.race === Race.HUMANOID || monst.mon.race === Race.GOBLIN ? 18 : 46);
      }
      for (const other of town.monsters) {
        if (other.active === CreatureStatus.ALERTED && dist(monst.curLoc, other.curLoc) <= 5) {
          monst.active = CreatureStatus.ALERTED;
        }
      }
    }
  }
}

/** flee_party — the mirror image of seekParty, moving away instead. */
function fleeParty(session: GameSession, monst: Creature, target: Location): boolean {
  const from = monst.curLoc;
  const away = loc(from.x + (from.x - target.x), from.y + (from.y - target.y));
  return seekParty(session, monst, away);
}

/**
 * get_monst_sound (boe.combat.cpp:5296) — which *sound type* one of a monster's
 * attacks uses. The return value is an index into `boom_space`'s lookup table,
 * not a sound file: playing it directly is what made a rat's bite sound like a
 * cash register. It is handed to `damagePc`/`damageMonst` as `soundType` and
 * they pass it on to `boomSpace`.
 *
 * eMonstMelee: 0 claw, 1 bite, 2 sting, 3 web, 4 wall touch, 5 punch,
 * 6 club, 7 burn, 8 harm, 9 slime, 10 stab, 11 swing.
 */
function monstSoundType(attacker: Creature, attack: Attack): number {
  switch (attack.type) {
    case MonstMelee.SLIME: return 11;
    case MonstMelee.PUNCH: return 4;
    case MonstMelee.CLAW: return 9;
    case MonstMelee.BITE: return 10;
    case MonstMelee.STING: return 12;
    case MonstMelee.CLUB: return 4;
    case MonstMelee.BURN: return 5;
    case MonstMelee.HARM: return 0;
    case MonstMelee.STAB:
    case MonstMelee.SWING: {
      // A weapon's sound depends on who is swinging it.
      const race = attacker.mon.race;
      if (race === Race.HUMAN) return attack.sides > 9 ? 3 : 2;
      if (race === Race.MAGE) return 1;
      if (race === Race.PRIEST) return 4;
      if (isHumanoidRace(race) || race === Race.GIANT) return 2;
      return 1;
    }
    default: return 0;
  }
}

/** isHumanoid (race.hpp) — the races Protection from Humanoids covers. */
function isHumanoidRace(race: Race): boolean {
  return [
    Race.HUMAN, Race.NEPHIL, Race.SLITH, Race.VAHNATAI, Race.HUMANOID, Race.GOBLIN,
  ].includes(race);
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
    const soundType = monstSoundType(monst, attack);
    let damaged = 0;
    if (monstTarget) {
      damaged = damageMonst(univ, monstTarget, 7, r2, damType,
        { doPrint: false, soundType, session });
    } else if (pcTarget) {
      damaged = damagePc(univ, pcTarget, r2, damType, monst.mon.race, { soundType });
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

    // Touch abilities fire off a blow that landed — the burning touch, the
    // paralysing touch, the pickpocket.
    monsterTouches(session, monst, target, i);

    // And what being hit sets off on the target's side.
    if (pcTarget) {
      const specItem = hasAbilEquip(pcTarget, ItemAbil.HIT_CALL_SPECIAL);
      if (specItem) {
        onHitTargetSpecial(
          univ, monst, pcTarget, specItem.item.abilStrength, 'melee', session);
      }
    } else if (monstTarget) {
      const trigger = monstTarget.mon.abil[MonstAbil.HIT_TRIGGER];
      if (trigger?.active) {
        onHitTargetSpecial(
          univ, monst, monstTarget, trigger.special.extra1, 'melee', session);
      }
    }
  }
}

/**
 * The `for(auto& abil : attacker->abil)` tail of monster_attack: every active
 * GENERAL ability whose delivery is TOUCH announces itself and then runs
 * `monst_basic_abil` on the target it just hit.
 *
 * The odds test is kept verbatim and is **backwards**: the C++ skips the
 * ability when the roll comes in *at or under* its odds, so a 1000-in-1000
 * touch never fires and a 0-odds one always does (0 fails the `> 0` guard).
 * It looks like a slip, but a "fix" would change how hard several monsters
 * hit, so it stays with a test pinning it.
 */
function monsterTouches(
  session: GameSession, monst: Creature, target: Living, attackIndex: number,
): void {
  const univ = session.univ;
  const pcTarget = target instanceof Player ? target : null;

  for (let key = MonstAbil.MISSILE; key <= MonstAbil.SUMMON; key++) {
    const abil = monst.mon.abil[key];
    if (!abil?.active) continue;
    if (abilityCategory(key) !== MonstAbilCat.GENERAL) continue;
    if (abil.gen.type !== MonstGen.TOUCH) continue;
    if (abil.gen.odds > 0 && univ.rng.getRan(1, 1, 1000) <= abil.gen.odds) continue;

    let sound = 0;
    switch (key) {
      case MonstAbil.STUN: univ.addStringToBuf('  Stuns!'); break;
      case MonstAbil.PETRIFY: univ.addStringToBuf('  Petrifying touch!'); break;
      case MonstAbil.DRAIN_SP: univ.addStringToBuf('  Drains magic!'); break;
      case MonstAbil.DRAIN_XP: univ.addStringToBuf('  Drains life!'); break;
      case MonstAbil.KILL: univ.addStringToBuf('  Killing touch!'); break;
      case MonstAbil.STEAL_FOOD:
        // Nothing to steal from another monster.
        if (!pcTarget) continue;
        univ.addStringToBuf('  Steals food!');
        sound = 26;
        break;
      case MonstAbil.STEAL_GOLD:
        if (!pcTarget) continue;
        univ.addStringToBuf('  Steals gold!');
        break;
      case MonstAbil.FIELD: break;
      case MonstAbil.DAMAGE:
      case MonstAbil.DAMAGE2:
        univ.addStringToBuf(damageTouchMsg(abil.gen.extra as DamageType));
        break;
      case MonstAbil.STATUS2:
      case MonstAbil.STATUS: {
        // STATUS2 rides only the first attack; STATUS rides every one.
        if (key === MonstAbil.STATUS2 && attackIndex > 0) continue;
        const msg = statusTouchMsg(abil.gen.extra as Status);
        if (msg === null) continue;
        // Charming something that isn't a creature is meaningless.
        if (abil.gen.extra === Status.CHARM && !(target instanceof Creature)) continue;
        univ.addStringToBuf(msg);
        break;
      }
      default:
        // Everything else isn't a touch at all.
        continue;
    }
    if (sound > 0) livingSound(sound);
    monsterBasicAbil(session, monst, key, abil, target);
  }
}

/** The DAMAGE/DAMAGE2 half of monster_attack's touch messages. */
function damageTouchMsg(dmg: DamageType): string {
  switch (dmg) {
    case DamageType.FIRE: return '  Burning touch!';
    case DamageType.COLD: return '  Freezing touch!';
    case DamageType.ACID: return '  Acid touch!';
    case DamageType.MAGIC: return '  Shocking touch!';
    case DamageType.SPECIAL:
    case DamageType.UNBLOCKABLE: return '  Eerie touch!';
    case DamageType.POISON: return '  Slimy touch!';
    case DamageType.WEAPON: return '  Drains stamina!';
    case DamageType.UNDEAD: return '  Chilling touch!';
    case DamageType.DEMON: return '  Unholy touch!';
    // MARKED is invalid here, and the C++ prints nothing for it.
    default: return '';
  }
}

/** The STATUS/STATUS2 half. `null` means the ability is skipped entirely. */
function statusTouchMsg(stat: Status): string | null {
  switch (stat) {
    case Status.POISON: return '  Poisonous!';
    case Status.DISEASE: return '  Causes disease!';
    case Status.DUMB: return '  Dumbfounds!';
    case Status.WEBS: return '  Webs!';
    case Status.ASLEEP: return '  Sleeps!';
    case Status.PARALYZED: return '  Paralysis touch!';
    case Status.ACID: return '  Acid touch!';
    case Status.HASTE_SLOW: return '  Slowing touch!';
    case Status.BLESS_CURSE: return '  Cursing touch!';
    case Status.CHARM: return '  Charming touch!';
    case Status.FORCECAGE: return '  Entrapping touch!';
    case Status.INVISIBLE: return '  Revealing touch!';
    case Status.INVULNERABLE: return '  Piercing touch!';
    case Status.MAGIC_RESISTANCE: return '  Overwhelming touch!';
    case Status.MARTYRS_SHIELD: return "  Anti-martyr's touch!";
    case Status.POISONED_WEAPON: return '  Poison-draining touch!';
    // MAIN is invalid.
    default: return null;
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
 * Ranged abilities go first: `pickMonsterAbility` walks the monster's uAbility
 * table before it considers a swing, which is why an archer shoots rather than
 * closing.
 *
 * TODO(M5b): mage and priest spells, summoning and the SPECIAL ability, which
 * the C++ handles alongside this.
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
      // In combat a monster picks a PC; in town the target is the party as a
      // whole, standing on one square, and do_monsters has already chosen it.
      const inCombat = session.mode === GameMode.COMBAT;
      const target = inCombat ? monstPickTarget(session, monst) : monst.target;
      monst.target = target;
      const targSpace = !inCombat
        ? univ.party.townLoc
        : target < NO_ONE ? univ.party.pcs[target]!.combatPos : monst.curLoc;

      // "Draw w. monster in center, if can see" — the view follows whichever
      // monster is about to act, so you see where the spear comes from rather
      // than only the damage number it leaves behind. Combat only: in town the
      // camera stays on the party, which is where the action is anyway.
      if (inCombat && monst.ap > 0 && monst.attitude !== Attitude.DOCILE
        && (target !== NO_ONE || !monst.isFriendly)
        && session.partyCanSeeMonst(monst)) {
        focusOn(monst.curLoc);
      }

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

      // Ranged abilities come before melee — the missile or breath is what an
      // archer or a drake reaches for when the party isn't yet on top of it.
      if (!actedYet && target !== NO_ONE && monst.attitude !== Attitude.DOCILE
        && !monst.isFriendly) {
        const who: Living | null = target < NO_ONE
          ? univ.party.pcs[inCombat ? target : selectActivePc(univ)]!
          : null;
        if (who && who.isAlive) {
          const picked = pickMonsterAbility(
            session, monst, targSpace, monstAdjacent(monst, targSpace));
          if (picked) {
            univ.addStringToBuf(`${monst.mon.name}:`);
            // Everything picked here goes through monst_fire_missile, which
            // sorts out the four kinds of ranged attack itself.
            monstFireMissile(session, monst, picked.key, picked.abil, who);
            // A touch costs -1 and never gets here; anything else costs its own
            // price, and 0 would spin the loop, so it still gives up a point.
            const cost = abilityCost(picked);
            monst.ap = Math.max(0, monst.ap - Math.max(1, cost));
            actedYet = true;
          }
        }
      }

      // Melee, if it can reach.
      if (!actedYet && target !== NO_ONE && monst.attitude !== Attitude.DOCILE) {
        // In town, whoever the blow lands on is picked at random.
        const victim = inCombat ? target : selectActivePc(univ);
        const who: Living | null = target < NO_ONE ? univ.party.pcs[victim]! : null;
        if (who && who.isAlive && monstAdjacent(monst, targSpace) && !monst.isFriendly) {
          monsterAttack(session, monst, who);
          monst.ap = Math.max(0, monst.ap - 4);
          actedYet = true;
        }
      }

      // Otherwise close the distance — but only in combat; town-mode movement
      // is do_monsters' job and has already happened.
      if (!actedYet && monst.mobile && inCombat) {
        const moveTarget = target !== NO_ONE ? target : closestPc(univ, monst.curLoc);
        if (!monst.isFriendly && moveTarget < NO_ONE) {
          const pc = univ.party.pcs[moveTarget]!;
          if (pc.isAlive) seekParty(session, monst, pc.combatPos);
        }
        monst.ap = Math.max(0, monst.ap - 1);
        actedYet = true;
      }

      // Summoning rides along with the action rather than costing one, and it
      // happens once per action the monster takes — the C++ puts it at the
      // bottom of the same loop, gated on the monster actually seeing its foe.
      if (target !== NO_ONE && session.canSeeLight(monst.curLoc, targSpace) < 5) {
        // RADIATE rolls before SUMMON does, and both use the same stream —
        // don't reorder them.
        const radiate = monst.mon.abil[MonstAbil.RADIATE];
        if (radiate?.active && univ.rng.getRan(1, 1, 100) < radiate.radiate.chance) {
          placeSpellPattern(session, radiate.radiate.pat, monst.curLoc, {
            field: radiate.radiate.type as FieldType,
            rot: monst.direction + 6,
            // 7 is out of the 0-5 PC range, so nobody is credited with a kill.
            whoHit: 7,
          });
        }
        monsterSummon(session, monst);
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
 * TODO(M6): dump_gold and the OCCASIONAL_STATUS item effects.
 */
export function combatRunMonst(session: GameSession): void {
  const univ = session.univ;
  doMonsterTurn(session);

  // The fields act right after the monsters do, before the clock and the
  // statuses tick — a wall of fire burns you on the same turn it was cast.
  processFields(session);

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
  // Poison, disease and acid bite far more often in combat than they do on the
  // road: every other round rather than every fiftieth turn.
  if (univ.party.age % 2 === 0) doPoison(session);
  if (univ.party.age % 3 === 0) handleDisease(session);
  handleAcid(session);
  // TODO(M5b): handle_marked_damage.
}
