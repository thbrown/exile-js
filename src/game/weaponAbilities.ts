/**
 * What a weapon does *on top of* the damage — `apply_weapon_status`
 * (boe.combat.cpp:459) and the on-hit item-ability chain that both
 * `pc_attack_weapon` (:668) and `fire_missile` (:1676) run.
 *
 * The two callers differ only in the word the messages use ("Blade" or
 * "Missile"), which special context WEAPON_CALL_SPECIAL fires in, and how many
 * action points a chain that returns true hands back.
 */

import { GameRng } from '../core/rng';
import { Item, ItemAbil } from '../data/item';
import { Creature } from '../universe/creature';
import { Living } from '../universe/living';
import { Player } from '../universe/player';
import { Skill, Status } from '../universe/skills';
import { Universe } from '../universe/universe';
import { SpecCtx, SpecCtxType } from './specials/context';
import type { GameSession } from './session';

/**
 * apply_weapon_status — the STATUS_WEAPON effect. Note that the four
 * "protective" statuses are applied *negated*: the weapon strips them.
 * `dmg` is the blow that carried the effect, and it makes sleep, paralysis and
 * force cages much harder to shrug off.
 */
export function applyWeaponStatus(
  univ: Universe,
  status: Status,
  howMuch: number,
  dmg: number,
  target: Living,
  weapType: string,
): void {
  const rng: GameRng = univ.rng;
  const say = (what: string): void => univ.addStringToBuf(`  ${weapType} ${what}`);
  const half = Math.trunc(howMuch / 2);
  switch (status) {
    case Status.INVISIBLE:
    case Status.MAGIC_RESISTANCE:
    case Status.INVULNERABLE:
    case Status.POISONED_WEAPON:
    case Status.MARTYRS_SHIELD:
      say('leaks an odd-coloured aura.');
      target.applyStatus(status, Math.trunc(howMuch / -2));
      break;
    case Status.POISON: say('drips venom.'); target.poison(half, rng); break;
    case Status.ACID: say('drips acid.'); target.acid(half); break;
    case Status.BLESS_CURSE: say('leaks a dark aura.'); target.curse(half); break;
    case Status.HASTE_SLOW: say('leaks a smoky aura.'); target.slow(half); break;
    case Status.WEBS: say('drips goo.'); target.web(half); break;
    case Status.DISEASE: say('drips bile.'); target.disease(half, rng); break;
    case Status.DUMB: say('leaks a misty aura.'); target.dumbfound(half, rng); break;
    case Status.ASLEEP:
      say('emits coruscating lights.');
      target.sleep(Status.ASLEEP, half, 20 + dmg, rng);
      break;
    case Status.PARALYZED:
      say('emits a purple flash.');
      target.sleep(Status.PARALYZED, half, 20 + dmg, rng);
      break;
    case Status.CHARM:
      say('leaks a bright aura.');
      target.sleep(Status.CHARM, 0, 20 + dmg - half, rng);
      break;
    case Status.FORCECAGE:
      say('emits a green flash.');
      target.sleep(Status.FORCECAGE, howMuch, dmg - half, rng);
      break;
    // MAIN isn't a valid status here.
    default:
      break;
  }
}

/** Which of the two callers is asking, since the messages and costs differ. */
export type HitSource = 'melee' | 'missile';

/**
 * The `if(weap.ability == STATUS_WEAPON) … else if …` chain that runs after a
 * blow has landed. Exactly one of these fires — they are chained with `else`,
 * so a weapon can only have one of them anyway.
 *
 * WEAPON_CALL_SPECIAL is the odd one out: the C++ blocks on `run_special` and
 * reads its `a` return to decide whether the swing was free. This port can't
 * block here (the whole melee path is synchronous), so the chain is launched
 * fire-and-forget and the action points are handed back when it resolves.
 */
export function onHitItemAbility(
  univ: Universe,
  attacker: Player,
  weap: Item,
  target: Living,
  damageDone: number,
  source: HitSource,
  session?: GameSession,
  /**
   * Which node WEAPON_CALL_SPECIAL runs. Defaults to the weapon's own
   * `abilStrength`; the missile path passes the *launcher's*, because
   * `fire_missile` tests the ability on the ammunition but reads the node off
   * the bow ("Should this be checked on the missile as well as on the ammo?"
   * says the C++, and leaves it).
   */
  specialNode = weap.abilStrength,
): void {
  const word = source === 'melee' ? 'Blade' : 'Missile';
  const apRefund = source === 'melee' ? 4 : 3;

  if (weap.ability === ItemAbil.STATUS_WEAPON) {
    // A coin flip, and the roll happens whether or not the weapon has a status.
    if (univ.rng.getRan(1, 0, 1) === 1) {
      applyWeaponStatus(
        univ, weap.abilData as Status, weap.abilStrength, damageDone, target, word);
    }
    return;
  }
  if (weap.ability === ItemAbil.SOULSUCKER) {
    if (univ.rng.getRan(1, 0, 1) === 1) {
      univ.addStringToBuf(`  ${word} drains life.`);
      attacker.heal(Math.trunc(weap.abilStrength / 2));
    }
    return;
  }
  if (weap.ability === ItemAbil.ANTIMAGIC_WEAPON) {
    const before = target.getMagic();
    let mage = 0;
    let cleric = 0;
    if (target instanceof Creature) {
      mage = target.mon.mu;
      cleric = target.mon.cl;
    } else if (target instanceof Player) {
      mage = target.skill(Skill.MAGE_SPELLS);
      cleric = target.skill(Skill.PRIEST_SPELLS);
    }
    if (mage + cleric > 0 && univ.rng.getRan(1, 0, 1) === 1) {
      target.drainSp(weap.abilStrength, true);
    }
    if (before > target.getMagic()) {
      univ.addStringToBuf(`  ${word} drains energy.`);
      // Melee restores a third of what the target *had*, missiles a third of
      // what was actually drained. Both are kept as written.
      attacker.restoreSp(source === 'melee'
        ? Math.trunc(before / 3)
        : Math.trunc((before - target.getMagic()) / 3));
    }
    return;
  }
  if (weap.ability === ItemAbil.WEAPON_CALL_SPECIAL) {
    if (!session) return;
    const where = target.getLoc();
    univ.party.forcePtr(21, where.x);
    univ.party.forcePtr(22, where.y);
    univ.party.forcePtr(20, targetIndex(univ, target));
    const ctx = source === 'melee' ? SpecCtx.ATTACKING_MELEE : SpecCtx.ATTACKING_RANGE;
    void session.runSpecial(ctx, SpecCtxType.SCEN, specialNode, attacker.combatPos)
      .then(({ blocked }) => { if (blocked) attacker.ap += apRefund; });
  }
}

/**
 * The chain a *target* runs when it is hit: a creature's HIT_TRIGGER ability,
 * or a PC's HIT_CALL_SPECIAL item. Same fire-and-forget caveat as above.
 */
export function onHitTargetSpecial(
  univ: Universe,
  attacker: Player | Creature,
  target: Living,
  node: number,
  source: HitSource,
  session?: GameSession,
): void {
  if (!session || node < 0) return;
  const where = target.getLoc();
  const from = attacker instanceof Player ? attacker.combatPos : attacker.curLoc;
  univ.party.forcePtr(21, where.x);
  univ.party.forcePtr(22, where.y);
  univ.party.forcePtr(20, targetIndex(univ, target));
  const ctx = source === 'melee' ? SpecCtx.ATTACKED_MELEE : SpecCtx.ATTACKED_RANGE;
  const apRefund = source === 'melee' ? 4 : 3;
  void session.runSpecial(ctx, SpecCtxType.SCEN, node, from)
    .then(({ blocked }) => { if (blocked) attacker.ap += apRefund; });
}

/** cUniverse::get_target_i — the slot number a special reads out of pointer 20. */
function targetIndex(univ: Universe, target: Living): number {
  if (target instanceof Player) return univ.party.pcs.indexOf(target);
  if (target instanceof Creature) return univ.town?.monsters.indexOf(target) ?? -1;
  return -1;
}
