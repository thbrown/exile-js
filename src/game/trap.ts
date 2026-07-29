/**
 * `run_trap` (boe.townspec.cpp:41) — the trap a ONCE_TRAP node springs when the
 * party decides to meddle with it, and the disarming roll that comes first.
 *
 * Returns true when nothing went off: the trap was disarmed, or it was a false
 * alarm all along.
 */

import { ItemAbil } from '../data/item';
import { DamageType } from '../data/monster';
import { Universe } from '../universe/universe';
import { getProtLevel } from '../universe/inventory';
import { Race, Skill, Status, Trait } from '../universe/skills';
import type { GameSession } from './session';
import { damagePc, hitParty } from './damage';
import { makeTownHostile } from './townAttitude';

/** eTrapType (boe.consts.hpp:81). */
export enum TrapType {
  RANDOM = 0,
  BLADE = 1,
  DART = 2,
  /** Poisons the whole party. */
  GAS = 3,
  /** Damages all — and scales off the town's difficulty, not the trap level. */
  EXPLOSION = 4,
  /** Named for a sleep ray; the C++ notes it actually paralyses. Kept. */
  SLEEP_RAY = 5,
  FALSE_ALARM = 6,
  DRAIN_XP = 7,
  ALERT = 8,
  FLAMES = 9,
  DUMBFOUND = 10,
  DISEASE = 11,
  DISEASE_ALL = 12,
  /** The scenario handles it: the node jumps somewhere instead. */
  CUSTOM = 13,
}

/** trap_odds — the chance of disarming, indexed by the capped skill 0..20. */
const TRAP_ODDS = [
  5, 30, 35, 42, 48, 55, 63, 69, 75, 77,
  78, 80, 82, 84, 86, 88, 90, 92, 94, 96, 98, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

export async function runTrap(
  session: GameSession,
  pcNum: number,
  trapType: TrapType,
  trapLevel: number,
  diff: number,
): Promise<boolean> {
  const univ: Universe = session.univ;
  const rng = univ.rng;
  const numHits = 1 + trapLevel;
  const difficulty = univ.town?.record.difficulty ?? 0;

  let type = trapType;
  if (type === TrapType.RANDOM) type = rng.getRan(1, 1, 4) as TrapType;
  if (type === TrapType.FALSE_ALARM) return true;

  const disarmer = univ.party.pcs[pcNum] ?? univ.currentPc;

  // pc_num 6 is "nobody is disarming it", which skips straight to the effect.
  if (pcNum < 6) {
    let i = disarmer.statAdj(Skill.DEXTERITY);
    i += Math.trunc(getProtLevel(disarmer, ItemAbil.THIEVING) / 2);
    const skill = Math.max(0, Math.min(20,
      disarmer.skill(Skill.DISARM_TRAPS)
      + Math.trunc(disarmer.skill(Skill.LUCK) / 2) + 1 - difficulty + 2 * i));

    let r1 = rng.getRan(1, 1, 100) + diff;
    if (disarmer.traits[Trait.NIMBLE]) r1 -= 6;

    if (r1 < TRAP_ODDS[skill]!) {
      univ.addStringToBuf('  Trap disarmed.');
      return true;
    }
    univ.addStringToBuf('  Disarm failed.');
  }

  switch (type) {
    case TrapType.BLADE:
      for (let i = 0; i < numHits; i++) {
        univ.addStringToBuf('  A knife flies out!');
        await damagePc(univ, disarmer,
          rng.getRan(2 + Math.trunc(difficulty / 14), 1, 10), DamageType.WEAPON, Race.UNKNOWN);
      }
      break;

    case TrapType.DART:
      univ.addStringToBuf('  A dart flies out.');
      disarmer.poison(3 + Math.trunc(difficulty / 14) + trapLevel * 2, rng);
      break;

    case TrapType.GAS:
      univ.addStringToBuf('  Poison gas pours out.');
      univ.party.poisonAll(2 + Math.trunc(difficulty / 14) + trapLevel * 2, rng);
      break;

    case TrapType.EXPLOSION:
      for (let i = 0; i < numHits; i++) {
        univ.addStringToBuf('  There is an explosion.');
        await hitParty(univ, rng.getRan(3 + Math.trunc(difficulty / 13), 1, 8), DamageType.FIRE);
      }
      break;

    case TrapType.SLEEP_RAY:
      univ.addStringToBuf('  A purple ray flies out.');
      disarmer.sleep(Status.PARALYZED, 200 + difficulty * 100 + trapLevel * 400, 50, rng);
      break;

    case TrapType.DRAIN_XP:
      univ.addStringToBuf('  You feel weak.');
      disarmer.experience = Math.max(0, disarmer.experience - (40 + trapLevel * 30));
      break;

    case TrapType.ALERT:
      univ.addStringToBuf('  An alarm goes off!!!');
      makeTownHostile(session);
      break;

    case TrapType.FLAMES:
      univ.addStringToBuf('  Flames shoot from the walls.');
      await hitParty(univ, rng.getRan(10 + trapLevel * 5, 1, 8), DamageType.FIRE);
      break;

    case TrapType.DUMBFOUND:
      univ.addStringToBuf('  You feel disoriented.');
      univ.party.dumbfoundAll(2 + trapLevel * 2, rng);
      break;

    case TrapType.DISEASE:
      univ.addStringToBuf('  You prick your finger.');
      disarmer.disease(3 + Math.trunc(difficulty / 14) + trapLevel * 2, rng);
      break;

    case TrapType.DISEASE_ALL:
      univ.addStringToBuf('  A foul substance sprays out.');
      univ.party.diseaseAll(2 + Math.trunc(difficulty / 14) + trapLevel * 2, rng);
      break;

    case TrapType.CUSTOM:
      // The node's own chain does the work; the level is handed to it through
      // reserved pointer 15.
      univ.party.forcePtr(15, trapLevel);
      break;

    default:
      univ.addStringToBuf('ERROR: Invalid trap type.');
      break;
  }
  return false;
}
