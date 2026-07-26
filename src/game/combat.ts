/**
 * Combat — turn order, action points, party placement and the melee attack.
 * Ports `start_town_combat` / `end_town_combat` / `place_party` (boe.town.cpp:683),
 * `set_pc_moves` / `take_ap` (boe.party.cpp:2788), `pick_next_pc` and
 * `pc_attack` / `pc_attack_weapon` (boe.combat.cpp:355 and :535).
 *
 * The `get_ran` order is the spec here more than anywhere else in the port: a
 * to-hit roll and a damage roll happen per swing, in that order, and the C++
 * makes some of them even when the result is thrown away.
 */

import { Direction, Location, loc, locsEqual, minmax } from '../core/location';
import { ItemAbil, ItemType, SKILL_INVALID } from '../data/item';
import { DamageType } from '../data/monster';
import { Creature } from '../universe/creature';
import { freeWeight, getProtLevel, hasAbilEquip } from '../universe/inventory';
import { Living, livingSound } from '../universe/living';
import { NUM_INVEN_SLOTS, Player } from '../universe/player';
import { MainStatus, Race, Skill, Status, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';
import { damageMonst, damagePc, hitChance } from './damage';
import { calcSpecDam } from './missiles';
import { onHitItemAbility } from './weaponAbilities';
import type { GameSession } from './session';
import type { Item } from '../data/item';

/**
 * The order combatants are placed in, relative to the party's square, for a
 * cardinal (hor_vert_place) and a diagonal (diag_place) facing —
 * boe.combat.cpp:77. Index 0 is where the party itself stood.
 */
const HOR_VERT_PLACE: Location[] = [
  loc(0, 0), loc(-1, 1), loc(1, 1), loc(-2, 2), loc(0, 2),
  loc(2, 2), loc(0, 1), loc(-1, 2), loc(1, 2), loc(-1, 3),
  loc(1, 3), loc(0, 3), loc(0, 4), loc(0, 5),
];
const DIAG_PLACE: Location[] = [
  loc(0, 0), loc(-1, 0), loc(0, 1), loc(-1, 1), loc(-2, 0),
  loc(0, 2), loc(-2, 1), loc(-1, 2), loc(-2, 2), loc(-3, 2),
  loc(-2, 3), loc(-3, 3), loc(-4, 3), loc(-3, 4),
];

/** Sentinel for "nobody": cur_pc and target both use 6 for it. */
export const NO_ONE = 6;
/** A monster target is its index + 100 (cUniverse::get_target_i). */
export const MONSTER_TARGET_BASE = 100;

/**
 * cPlayer::total_encumbrance — how much the PC's gear slows them down. A good
 * defence skill lets them carry it better, and each roll is per item, so this
 * consumes RNG in a way the call order depends on.
 */
export function totalEncumbrance(univ: Universe, pc: Player): number {
  let total = 0;
  const burden = freeWeight(pc);
  if (burden < 0) total += Math.trunc(burden / -10);

  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (!pc.equip[i]) continue;
    const item = pc.items[i]!;
    let encumbrance = item.awkward;
    if (item.ability === ItemAbil.ENCUMBERING) encumbrance += item.abilStrength;
    const skill = hitChance(pc.skill(Skill.DEFENSE));
    if (encumbrance === 1 && univ.rng.getRan(1, 0, 130) < skill) encumbrance--;
    if (encumbrance > 1 && univ.rng.getRan(1, 0, 70) < skill) encumbrance--;
    total += encumbrance;
  }
  return total;
}

/**
 * set_pc_moves (boe.party.cpp:2788) — hand out this round's action points.
 * Four normally, three if sluggish, less for the weight you're carrying, and
 * doubled or tripled by haste. Being slowed costs you every other round
 * outright, and webs can leave you with nothing but a turn spent tearing free.
 */
export function setPcMoves(univ: Universe): void {
  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) {
      pc.ap = 0;
      continue;
    }
    pc.ap = pc.traits[Trait.SLUGGISH] ? 3 : 4;
    const encumbrance = totalEncumbrance(univ, pc);
    pc.ap = minmax(1, 8, pc.ap - Math.trunc(encumbrance / 3));

    pc.ap += getProtLevel(pc, ItemAbil.SPEED);
    pc.ap -= getProtLevel(pc, ItemAbil.SLOW_WEARER);

    const haste = pc.status[Status.HASTE_SLOW] ?? 0;
    if (haste < 0 && univ.party.age % 2 === 1) {
      pc.ap = 0;
    } else {
      const webs = pc.status[Status.WEBS] ?? 0;
      pc.ap = Math.max(0, pc.ap - Math.trunc(webs / 2));
      if (pc.ap === 0) {
        univ.addStringToBuf(`${pc.name} must clean webs.`);
        pc.status[Status.WEBS] = Math.max(0, webs - 3);
      }
    }
    if (haste > 7) pc.ap *= 3;
    else if (haste > 0) pc.ap *= 2;
    if ((pc.status[Status.ASLEEP] ?? 0) > 0 || (pc.status[Status.PARALYZED] ?? 0) > 0) pc.ap = 0;
  }
}

/** take_ap — spend the current PC's action points, never below zero. */
export function takeAp(univ: Universe, num: number): void {
  const pc = univ.currentPc;
  pc.ap = Math.max(0, pc.ap - num);
}

/**
 * pick_next_pc (boe.combat.cpp:1831) — advance to the next PC with moves left,
 * wrapping once. Returns true when nobody has any, which is the signal that the
 * round is over and the monsters go.
 *
 * `activePc` under 6 means one PC is mid-action (firing, casting), and everyone
 * else's moves are burnt rather than skipped.
 */
export function pickNextPc(univ: Universe, activePc = NO_ONE): boolean {
  let store = false;
  if (univ.curPc === NO_ONE) univ.curPc = 0;

  const burnIfNotActive = (): void => {
    if (activePc < NO_ONE && activePc !== univ.curPc) univ.currentPc.ap = 0;
  };
  burnIfNotActive();

  while (univ.currentPc.ap <= 0 && univ.curPc < NO_ONE) {
    univ.curPc++;
    if (univ.curPc < NO_ONE) burnIfNotActive();
  }

  if (univ.curPc === NO_ONE) {
    univ.curPc = 0;
    burnIfNotActive();
    while (univ.currentPc.ap <= 0 && univ.curPc < NO_ONE) {
      univ.curPc++;
      if (univ.curPc < NO_ONE) burnIfNotActive();
    }
    if (univ.curPc === NO_ONE) {
      store = true;
      univ.curPc = 0;
    }
  }
  return store;
}

/**
 * place_party (boe.town.cpp:757) — spread the party out behind where it stood,
 * facing `direction`. The layout table is mirrored and transposed according to
 * the facing; a party in a forcecage all lands on the one square.
 */
export function placeParty(session: GameSession, direction: Direction): void {
  const univ = session.univ;
  if (univ.party.pcs.some((pc) => (pc.status[Status.FORCECAGE] ?? 0) > 0)) {
    for (const pc of univ.party.pcs) pc.combatPos = { ...univ.party.townLoc };
    return;
  }

  const dir = direction as number;
  const spotOk: boolean[] = new Array<boolean>(14).fill(true);
  const posLocs: Location[] = [];
  let howManyOk = 1;

  for (let i = 0; i < 14; i++) {
    const table = dir % 2 === 0 ? HOR_VERT_PLACE : DIAG_PLACE;
    const entry = table[i]!;
    // For the north/south axis the table is used as-is; east/west swaps x and y.
    let xAdj = dir % 4 < 2 ? entry.x : entry.y;
    if (dir % 2 === 0) xAdj = dir < 4 ? xAdj : -xAdj;
    else xAdj = (dir === 1 || dir === 7) ? -xAdj : xAdj;

    let yAdj = dir % 4 < 2 ? entry.y : entry.x;
    if (dir % 2 === 0) yAdj = (dir > 1 && dir < 6) ? yAdj : -yAdj;
    else yAdj = (dir === 3 || dir === 1) ? -yAdj : yAdj;

    const where = loc(univ.party.townLoc.x - xAdj, univ.party.townLoc.y - yAdj);
    posLocs.push(where);

    // `is_blocked` is the broad test — terrain, creatures, the party, barriers
    // and (in combat) marked specials and portals — which is what keeps a PC
    // from being placed inside a wall or on top of a monster. `is_special` is a
    // boolean test in the C++ and `specialAt` returns -1 for none, which is
    // truthy, so it has to be compared rather than negated.
    const usable = !session.isBlocked(where) && session.specialAt(where) < 0
      && session.sightObscurity(where.x, where.y) === 0 && !session.locOffActiveArea(where);
    spotOk[i] = usable;
    if (usable && i > 1) howManyOk++;
    // The party's own square is always allowed, blocked or not.
    if (i === 0) spotOk[i] = true;
  }

  let whereInA = 0;
  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    pc.combatPos = { ...posLocs[whereInA]! };
    if (howManyOk === 1) continue;
    if (howManyOk > 1) whereInA++;
    howManyOk--;
    while (whereInA < 14 && !spotOk[whereInA]) whereInA++;
    if (whereInA >= 14) whereInA = 13;
  }
}

/**
 * start_town_combat (boe.town.cpp:683) — place the party, reset every monster's
 * target, hand out the first round's moves and pick whoever goes first.
 */
export function startTownCombat(session: GameSession, direction: Direction): void {
  const univ = session.univ;
  placeParty(session, direction);
  if (univ.curPc === NO_ONE) univ.curPc = univ.firstActivePc();

  for (const monst of univ.town?.monsters ?? []) monst.target = NO_ONE;

  for (const pc of univ.party.pcs) {
    pc.lastAttacked = null;
    pc.parry = 0;
    pc.direction = direction;
    if (pc.mainStatus === MainStatus.ALIVE) session.updateExplored(pc.combatPos);
  }

  session.storeCurrentPc = univ.curPc;
  univ.curPc = 0;
  setPcMoves(univ);
  pickNextPc(univ);
}

/**
 * end_town_combat (boe.town.cpp:720) — regroup on a random survivor's square
 * and return the direction they were facing, which is where the party ends up
 * looking. Returns `Direction.Here` when it refuses, which happens when some
 * of the party (but not all of it) is caged.
 */
export function endTownCombat(session: GameSession): Direction {
  const univ = session.univ;
  let inCage = 0;
  let cageLoc: Location | null = null;
  let sameCage = true;
  for (const pc of univ.party.pcs) {
    if ((pc.status[Status.FORCECAGE] ?? 0) > 0) {
      if (inCage === 0) cageLoc = pc.getLoc();
      inCage++;
    }
    if (cageLoc && !locsEqual(pc.getLoc(), cageLoc)) sameCage = false;
  }
  const alive = univ.party.pcs.filter((pc) => pc.isAlive).length;
  if (inCage !== 0 && inCage !== alive && !sameCage) {
    univ.addStringToBuf('  Someone trapped.');
    return Direction.Here;
  }

  let r1 = univ.rng.getRan(1, 0, 5);
  let tries = 0;
  while (!univ.party.pcs[r1]?.isAlive && tries++ < 1000) r1 = univ.rng.getRan(1, 0, 5);
  const chosen = univ.party.pcs[r1] ?? univ.party.pcs[0]!;
  univ.party.townLoc = { ...chosen.combatPos };
  univ.curPc = session.storeCurrentPc;
  if (!univ.currentPc.isAlive) univ.curPc = univ.firstActivePc();
  for (const pc of univ.party.pcs) {
    pc.parry = 0;
    pc.combatPos = loc(-1, -1);
  }
  return chosen.direction;
}

/**
 * damage_target (boe.combat.cpp) — the dispatch that lets an attack hit either
 * kind of combatant. `target` is a PC slot (0-5) or a monster index + 100.
 */
export function damageTarget(
  univ: Universe,
  target: Living,
  dam: number,
  type: DamageType,
  whoHit: number,
  race: Race,
  doPrint = false,
  session?: GameSession,
  soundType = -1,
): number {
  if (target instanceof Player) {
    return damagePc(univ, target, dam, type, race, { doPrint, soundType });
  }
  if (target instanceof Creature) {
    return damageMonst(univ, target, whoHit, dam, type, { doPrint, soundType, session });
  }
  return 0;
}

/** cPlayer::get_weapons — the primary and, if it's one-handed, the off-hand. */
export function getWeapons(pc: Player): [Item | null, Item | null] {
  const findEquipped = (variety: ItemType, skipSlot = -1): { slot: number; item: Item } | null => {
    for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
      if (i === skipSlot || !pc.equip[i]) continue;
      if (pc.items[i]!.variety === variety) return { slot: i, item: pc.items[i]! };
    }
    return null;
  };
  const oneHanded = findEquipped(ItemType.ONE_HANDED);
  if (oneHanded) {
    const second = findEquipped(ItemType.ONE_HANDED, oneHanded.slot);
    return [oneHanded.item, second?.item ?? null];
  }
  return [findEquipped(ItemType.TWO_HANDED)?.item ?? null, null];
}

/** move_to_zero — a poison charge wearing off by one, from either direction. */
function moveToZero(value: number): number {
  if (value > 0) return value - 1;
  if (value < 0) return value + 1;
  return 0;
}

/**
 * pc_attack (boe.combat.cpp:355) — one PC's whole melee turn against `target`:
 * an unarmed punch, or a swing with each equipped weapon. Costs 4 AP whatever
 * happens, and a martyr's shield sends some of the damage back.
 */
export function pcAttack(
  univ: Universe,
  whoAtt: number,
  target: Living | null,
  session?: GameSession,
): void {
  const attacker = univ.party.pcs[whoAtt];
  if (!attacker || !attacker.isAlive) return;
  if (!target) return;
  if ((attacker.status[Status.ASLEEP] ?? 0) > 0
    || (attacker.status[Status.PARALYZED] ?? 0) > 0) return;
  if (attacker.traits[Trait.PACIFIST]) {
    univ.addStringToBuf("Attack: You're a pacifist!");
    return;
  }

  attacker.lastAttacked = target;
  const [weap1, weap2] = getWeapons(attacker);

  const attBless = minmax(-8, 8, attacker.status[Status.BLESS_CURSE] ?? 0);
  const targBless = minmax(-8, 8, target.status[Status.BLESS_CURSE] ?? 0);
  // A *lower* roll hits, so a blessing on the attacker subtracts.
  let hitAdj = -5 * attBless + 5 * targBless
    - attacker.statAdj(Skill.DEXTERITY) * 5 + totalEncumbrance(univ, attacker) * 5;
  let damAdj = attBless - targBless + attacker.statAdj(Skill.STRENGTH);

  // A sleeping or paralysed target is nearly impossible to miss.
  if ((target.status[Status.ASLEEP] ?? 0) > 0 || (target.status[Status.PARALYZED] ?? 0) > 0) {
    hitAdj -= 80;
    damAdj += 10;
  }

  const skillItem = hasAbilEquip(attacker, ItemAbil.SKILL);
  if (skillItem) {
    hitAdj += 5 * (Math.trunc(skillItem.item.abilStrength / 2) + 1);
    damAdj += Math.trunc(skillItem.item.abilStrength / 2);
  }
  const strengthItem = hasAbilEquip(attacker, ItemAbil.GIANT_STRENGTH);
  if (strengthItem) {
    damAdj += strengthItem.item.abilStrength;
    hitAdj += strengthItem.item.abilStrength * 2;
  }

  // Swinging at something gives away your position.
  attacker.voidSanctuary();
  const storeHp = target.getHealth();

  if (!weap1) {
    univ.addStringToBuf(`${attacker.name} punches.`);
    let r1 = univ.rng.getRan(1, 1, 100) + hitAdj - 20;
    r1 += 5 * Math.trunc((attacker.status[Status.WEBS] ?? 0) / 3);
    if ((attacker.status[Status.FORCECAGE] ?? 0) > 0) r1 += 3;
    if ((target.status[Status.FORCECAGE] ?? 0) > 0) r1 += 1;
    const r2 = univ.rng.getRan(1, 1, 4) + damAdj;
    r1 += pcTargetDefence(target);

    if (r1 <= hitChance(attacker.skill(Skill.DEXTERITY))) {
      let type = DamageType.WEAPON;
      if (attacker.race === Race.UNDEAD || attacker.race === Race.SKELETAL) type = DamageType.UNDEAD;
      else if (attacker.race === Race.DEMON) type = DamageType.DEMON;
      // The punch passes sound type 4 (a thump) in the C++.
      damageTarget(univ, target, r2, type, whoAtt, attacker.race, true, session, 4);
    } else {
      univ.addStringToBuf(`${attacker.name} misses.`);
      livingSound(2);
    }
  }

  if (weap1) {
    pcAttackWeapon(univ, whoAtt, target, hitAdj, damAdj, weap1,
      1 + (weap2 ? 1 : 0), attacker.weapPoisoned === weap1, session);
  }
  if (weap2 && target.isAlive) {
    pcAttackWeapon(univ, whoAtt, target, hitAdj, damAdj, weap2,
      0, attacker.weapPoisoned === weap2, session);
  }
  attacker.status[Status.POISONED_WEAPON] = moveToZero(attacker.status[Status.POISONED_WEAPON] ?? 0);
  takeAp(univ, 4);

  const dealt = storeHp - target.getHealth();
  if (dealt > 0 && target.isShielded(univ.rng)) {
    const shared = target.getSharedDmg(dealt, univ.rng);
    univ.addStringToBuf('  Shares damage!');
    damagePc(univ, attacker, shared, DamageType.MAGIC, Race.UNKNOWN);
  }
}

/**
 * The extra defence a PC target gets — dexterity, evasion gear and a raised
 * parry. The C++ lifts these straight out of the monster-attacks-PC code so
 * that a charmed PC being hit works the same way.
 */
function pcTargetDefence(target: Living): number {
  if (!(target instanceof Player)) return 0;
  let bonus = 5 * target.statAdj(Skill.DEXTERITY);
  bonus += getProtLevel(target, ItemAbil.EVASION);
  if (target.parry < 100) bonus += 5 * target.parry;
  return bonus;
}

/**
 * pc_attack_weapon (boe.combat.cpp:535) — one swing. `primary` is 1 for the
 * only weapon, 2 for the main hand of two, 0 for the off-hand; it changes both
 * the to-hit and the damage.
 *
 * TODO(M5c): EXPLODING_WEAPON needs `place_spell_pattern`; a swing with one
 * currently lands as an ordinary blow.
 */
export function pcAttackWeapon(
  univ: Universe,
  whoAtt: number,
  target: Living,
  hitAdj: number,
  damAdj: number,
  weap: Item,
  primary: number,
  doPoison: boolean,
  session?: GameSession,
): void {
  const attacker = univ.party.pcs[whoAtt]!;

  // An unset weapon type falls back to edged; the two magic values scale the
  // skill with how healthy or how rested the PC is.
  let skill: number;
  if (weap.weapType === SKILL_INVALID) skill = attacker.skill(Skill.EDGED_WEAPONS);
  else if (weap.weapType === Skill.MAX_HP) {
    skill = Math.trunc((20 * attacker.curHealth) / Math.max(1, attacker.maxHealth));
  } else if (weap.weapType === Skill.MAX_SP) {
    skill = Math.trunc((20 * attacker.curSp) / Math.max(1, attacker.maxSp));
  } else skill = attacker.skill(weap.weapType as Skill);

  univ.addStringToBuf(`${attacker.name} swings.`);
  let r1 = univ.rng.getRan(1, 1, 100) + hitAdj - 5 * weap.bonus;
  r1 += 5 * Math.trunc((attacker.status[Status.WEBS] ?? 0) / 3);
  if (primary) r1 -= 5;
  // Fighting with two weapons is clumsy unless you're ambidextrous.
  if (primary !== 1 && !attacker.traits[Trait.AMBIDEXTROUS]) r1 += 25;
  // A cage cramps your swing, though a pole arm suffers less.
  if ((attacker.status[Status.FORCECAGE] ?? 0) > 0) {
    r1 += weap.weapType === Skill.POLE_WEAPONS ? 1 : 3;
  }
  if ((target.status[Status.FORCECAGE] ?? 0) > 0) r1 += 1;
  if (primary && attacker.race === Race.SLITH && weap.weapType === Skill.POLE_WEAPONS) r1 -= 10;

  let r2 = univ.rng.getRan(1, 1, weap.itemLevel) + damAdj + weap.bonus;
  if (primary) r2 += 2; else r2 -= 1;
  if (weap.ability === ItemAbil.WEAK_WEAPON) {
    r2 = Math.trunc((r2 * (10 - weap.abilStrength)) / 10);
  }
  if (weap.ability === ItemAbil.HP_DAMAGE) {
    r2 = Math.max(1, Math.trunc((r2 * attacker.curHealth) / Math.max(1, attacker.maxHealth)));
  }
  if (weap.ability === ItemAbil.SP_DAMAGE) {
    r2 = Math.max(1, Math.trunc((r2 * attacker.curSp) / Math.max(1, attacker.maxSp)));
  }
  if (weap.ability === ItemAbil.HP_DAMAGE_REVERSE) {
    r2 += Math.trunc(weap.abilStrength
      * (1 - attacker.curHealth / Math.max(1, attacker.maxHealth)));
  }
  if (weap.ability === ItemAbil.SP_DAMAGE_REVERSE) {
    r2 += Math.trunc(weap.abilStrength * (1 - attacker.curSp / Math.max(1, attacker.maxSp)));
  }

  r1 += pcTargetDefence(target);

  if (r1 > hitChance(skill)) {
    univ.addStringToBuf(`  ${attacker.name} misses.`);
    livingSound(weap.weapType === Skill.POLE_WEAPONS ? 19 : 2);
    return;
  }

  // The weapon's own ability adds either *special* damage (a slayer bonus) or
  // damage of a named type (DAMAGING_WEAPON). The C++ computes one variable and
  // swaps it into the other when the type came back set, which is why the two
  // are applied with different sound types below.
  const spec = calcSpecDam(univ, weap.ability, weap.abilStrength, weap.abilData, target);
  let specDam = spec.damage;
  let bonusDam = 0;
  if (spec.damType !== DamageType.SPECIAL) {
    bonusDam = specDam;
    specDam = 0;
  }
  if (primary) {
    // Assassination: a big enough skill edge over a low-level target, and one
    // roll, doubles the damage. Amorphous things can't be assassinated.
    const splits = target instanceof Creature && target.mon.amorphous;
    const roll = univ.rng.getRan(1, 1, 100);
    const assassin = attacker.skill(Skill.ASSASSINATION);
    if (attacker.level >= target.getLevel() - 1
      && assassin >= Math.trunc(target.getLevel() / 2) && !splits) {
      if (roll < hitChance(Math.max(assassin - target.getLevel(), 0))) {
        univ.addStringToBuf('  You assassinate.');
        specDam += r2;
      }
    }
  }

  if (weap.ability === ItemAbil.HEALING_WEAPON) {
    univ.addStringToBuf('  There is a flash of light.');
    target.heal(r2);
    return;
  }

  // Note this is a sound *type* (an index into boom_space's table), not a sound
  // file — `damageTarget` passes it on to `boomSpace`, which looks it up.
  const dmgSnd = weaponSoundType(weap);
  const weaponDone = damageTarget(
    univ, target, r2, DamageType.WEAPON, whoAtt, attacker.race, false, session, dmgSnd);
  let specialDone = 0;
  if (specDam) {
    // Special damage always booms with sound type 5.
    specialDone = damageTarget(
      univ, target, specDam, DamageType.SPECIAL, whoAtt, attacker.race, false, session, 5);
  }
  let bonusDone = 0;
  if (bonusDam) {
    bonusDone = damageTarget(
      univ, target, bonusDam, spec.damType, whoAtt, attacker.race, false, session, 0);
  }
  target.damagedMsg(weaponDone, specialDone + bonusDone);

  if (doPoison && (attacker.status[Status.POISONED_WEAPON] ?? 0) > 0) {
    const poisoned = attacker.status[Status.POISONED_WEAPON] ?? 0;
    let amount = poisoned;
    if (hasAbilEquip(attacker, ItemAbil.POISON_AUGMENT)) amount += 2;
    target.poison(amount, univ.rng);
    // move_to_zero runs on the *status*, not on the augmented amount — an
    // earlier version of this port wrote the bonus back and made poison grow.
    attacker.status[Status.POISONED_WEAPON] = moveToZero(poisoned);
  }

  onHitItemAbility(univ, attacker, weap, target, r2 + specDam, 'melee', session);
}

/**
 * The *sound type* a weapon's hit uses (pc_attack_weapon's `dmg_snd`). These
 * are boom_space table indices — 0 is the plain "ouch", 1 and 2 are a light and
 * a heavy blade, 3 a pole arm, 4 a club — not sound file numbers.
 */
function weaponSoundType(weap: Item): number {
  switch (weap.weapType) {
    case Skill.EDGED_WEAPONS: return weap.itemLevel < 8 ? 1 : 2;
    case Skill.BASHING_WEAPONS: return 4;
    case Skill.POLE_WEAPONS: return 3;
    default: return 0;
  }
}
