/**
 * The party's missiles — `load_missile` (boe.combat.cpp:1459), `fire_missile`
 * (:1531) and `calc_spec_dam` (:711).
 *
 * `load_missile` decides *what* the current PC would shoot with and puts the
 * game into MODE_FIRING or MODE_THROWING; `fireMissile` resolves the shot at a
 * square, with `run_a_missile` (see `missileAnim.ts`) throwing the projectile
 * across the screen as it goes.
 */

import { Location, dist } from '../core/location';
import { DamageType } from '../data/monster';
import { Item, ItemAbil, ItemType } from '../data/item';
import { Creature } from '../universe/creature';
import { getProtLevel, hasAbilEquip, takeItem } from '../universe/inventory';
import { Living } from '../universe/living';
import { Player } from '../universe/player';
import { Race, Skill, Status, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';
import { MonstAbil } from '../data/monsterAbility';
import { runAMissile } from './missileAnim';
import { SpellPat } from '../data/pattern';
import { placeSpellPattern } from './spellPatterns';
import { takeAp } from './combat';
import { onHitItemAbility, onHitTargetSpecial } from './weaponAbilities';
import { damageMonst, damagePc, hitChance } from './damage';
import { GameMode } from './modes';
import type { GameSession } from './session';

/** Which slots `load_missile` settled on, and how far the shot can reach. */
export interface LoadedMissile {
  /** The bow, crossbow or thrown weapon itself. */
  missileSlot: number;
  /** What actually flies — arrows, bolts, or the thrown weapon again. */
  ammoSlot: number;
  range: number;
  mode: GameMode.FIRING | GameMode.THROWING;
}

/** The refusal `load_missile` printed instead of arming, if it refused. */
export interface MissileRefusal {
  message: string;
  extra?: string;
}

export type LoadMissileResult = LoadedMissile | MissileRefusal;

export function isLoaded(r: LoadMissileResult): r is LoadedMissile {
  return (r as LoadedMissile).missileSlot !== undefined;
}

/** cPlayer::has_type_equip — the first *equipped* item of a given variety. */
function hasTypeEquip(pc: Player, variety: ItemType): { slot: number; item: Item } | null {
  for (let i = 0; i < pc.items.length; i++) {
    const item = pc.items[i]!;
    if (!pc.equip[i] || item.variety === ItemType.NO_ITEM) continue;
    if (item.variety === variety) return { slot: i, item };
  }
  return null;
}

/**
 * load_missile — work out what the current PC is armed with. A thrown weapon
 * wins outright and reaches 8; a bow with arrows or a crossbow with bolts
 * reaches 12; an ammunition-less launcher (a sling, a wand) also reaches 12.
 * DISTANCE_MISSILE on the *ammunition* extends whichever it is.
 *
 * The mismatched-ammunition cases each get their own refusal, which is how a
 * player finds out that bolts don't fit a bow.
 */
export function loadMissile(univ: Universe): LoadMissileResult {
  const pc = univ.currentPc;
  if (pc.traits[Trait.PACIFIST]) return { message: "Shoot: You're a pacifist!" };

  const thrown = hasTypeEquip(pc, ItemType.THROWN_MISSILE);
  const bow = hasTypeEquip(pc, ItemType.BOW);
  const arrow = hasTypeEquip(pc, ItemType.ARROW);
  const crossbow = hasTypeEquip(pc, ItemType.CROSSBOW);
  const bolts = hasTypeEquip(pc, ItemType.BOLTS);
  const noAmmo = hasTypeEquip(pc, ItemType.MISSILE_NO_AMMO);

  const withDistance = (base: number, ammo: Item): number => (
    ammo.ability === ItemAbil.DISTANCE_MISSILE ? base + ammo.abilStrength : base);

  if (thrown) {
    return {
      missileSlot: thrown.slot,
      ammoSlot: thrown.slot,
      range: withDistance(8, thrown.item),
      mode: GameMode.THROWING,
    };
  }
  if ((bow && bolts) || (crossbow && arrow)) return { message: 'Fire: Wrong ammunition.' };
  if (bow && !arrow) return { message: 'Fire: Equip some arrows.' };
  if (crossbow && !bolts) return { message: 'Fire: Equip some bolts.' };
  if (bow && arrow) {
    return {
      missileSlot: bow.slot,
      ammoSlot: arrow.slot,
      range: withDistance(12, arrow.item),
      mode: GameMode.FIRING,
    };
  }
  if (crossbow && bolts) {
    return {
      missileSlot: crossbow.slot,
      ammoSlot: bolts.slot,
      range: withDistance(12, bolts.item),
      mode: GameMode.FIRING,
    };
  }
  if (noAmmo) {
    return {
      missileSlot: noAmmo.slot,
      ammoSlot: noAmmo.slot,
      range: withDistance(12, noAmmo.item),
      mode: GameMode.FIRING,
    };
  }
  return { message: 'Fire: Equip a missile.' };
}

/** The slayer multiplier table from calc_spec_dam's race switch. */
function slayerMultiplier(race: Race): number {
  switch (race) {
    case Race.DEMON:
    case Race.GIANT:
    case Race.STONE:
    case Race.DRAGON: return 8;
    case Race.UNDEAD:
    case Race.SKELETAL: return 6;
    case Race.REPTILE:
    case Race.BEAST:
    case Race.BIRD: return 5;
    case Race.MAGE:
    case Race.PRIEST:
    case Race.MAGICAL: return 4;
    case Race.BUG:
    case Race.PLANT:
    case Race.SLIME: return 7;
    case Race.HUMAN:
    case Race.NEPHIL:
    case Race.SLITH:
    case Race.VAHNATAI:
    case Race.GOBLIN:
    case Race.HUMANOID: return 3;
    // "Part of the point of this race is to make them immune to slayer
    // abilities. However, a slayer ability made specifically for VIPs
    // shouldn't be useless, either."
    case Race.IMPORTANT: return 0.5;
    // UNKNOWN is a negative value the editor won't allow; neutralise it.
    default: return 0;
  }
}

/** isHumanoid / isHuman (race.hpp), which the humanoid-bane rule needs. */
function isHumanoid(race: Race): boolean {
  return race === Race.HUMAN || race === Race.NEPHIL || race === Race.SLITH
    || race === Race.VAHNATAI || race === Race.HUMANOID || race === Race.GOBLIN;
}
function isHuman(race: Race): boolean {
  return race === Race.HUMAN;
}

/** What calc_spec_dam worked out: extra damage and the type it arrives as. */
export interface SpecDam {
  damage: number;
  damType: DamageType;
}

/**
 * calc_spec_dam (boe.combat.cpp:711) — the extra damage a weapon's own ability
 * adds on top of the blow. Both the melee swing and a missile call it.
 *
 * Note the two widened bane rules: a humanoid-bane weapon also bites nephilim,
 * sliths, vahnatai and goblins (but not humans), and an undead-bane weapon
 * also bites the skeletal.
 */
export function calcSpecDam(
  univ: Universe, abil: ItemAbil, abilStr: number, abilDat: number, target: Living,
): SpecDam {
  let damType = DamageType.SPECIAL;
  if (abil === ItemAbil.DAMAGING_WEAPON) {
    const store = univ.rng.getRan(abilStr, 1, 6);
    damType = abilDat as DamageType;
    // Nothing but assassination deals true SPECIAL damage.
    if (damType >= DamageType.SPECIAL) damType = DamageType.UNBLOCKABLE;
    return { damage: store, damType };
  }
  if (abil === ItemAbil.SLAYER_WEAPON) {
    const race: Race | null = target instanceof Creature ? target.mon.race
      : target instanceof Player ? target.race : null;
    if (race === null) return { damage: 0, damType };
    const bane = abilDat as Race;
    const widened = (bane === Race.HUMANOID && isHumanoid(race) && !isHuman(race))
      || (bane === Race.UNDEAD && race === Race.SKELETAL);
    if (!widened && race !== bane) return { damage: 0, damType };
    return { damage: Math.trunc(abilStr * slayerMultiplier(bane)), damType };
  }
  if (abil === ItemAbil.CAUSES_FEAR) {
    target.scare(abilStr * 10);
  }
  return { damage: 0, damType };
}

/** cUniverse::target_there — the PC on a square first, then the creature. */
export function targetThere(univ: Universe, where: Location): Living | null {
  for (const pc of univ.party.pcs) {
    const loc = pc.getLoc();
    if (pc.isAlive && loc.x === where.x && loc.y === where.y) return pc;
  }
  return univ.town?.monsterAt(where) ?? null;
}

/**
 * The SEEKING_MISSILE branch: a shot aimed at nothing (or at a friend) looks
 * around the square for someone worth hitting, and each candidate rolls
 * separately — a friendly or invisible one is much less likely to be picked.
 * Aiming a seeking missile at a legitimate target instead just steadies it.
 */
function seekTarget(
  univ: Universe, target: Location,
): { target: Location; hitBonus: number } {
  const victim = targetThere(univ, target);
  if (victim !== null && !victim.isFriendly) return { target, hitBonus: 10 };

  const candidates: Living[] = [];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      const found = targetThere(univ, { x: target.x + i, y: target.y + j });
      if (!found) continue;
      const invisible = (found.status[Status.INVISIBLE] ?? 0) > 0
        || (found instanceof Creature && found.mon.invisible);
      const friendly = found.isFriendly;
      let seekChance = 10;
      if (invisible && friendly) seekChance -= 8;
      else if (invisible) seekChance -= 5;
      else if (friendly) seekChance -= 9;
      if (univ.rng.getRan(1, 1, 10) <= seekChance) candidates.push(found);
    }
  }
  if (candidates.length === 0) return { target, hitBonus: 0 };
  const pick = candidates[univ.rng.getRan(1, 1, candidates.length) - 1]!;
  return { target: pick.getLoc(), hitBonus: 0 };
}

/**
 * fire_missile (boe.combat.cpp:1531) — resolve the current PC's shot at
 * `target`. The caller has already put the game in FIRING or THROWING mode and
 * knows which slots are in play.
 *
 */
export async function fireMissile(
  session: GameSession, loaded: LoadedMissile, target: Location,
): Promise<void> {
  const univ = session.univ;
  const firer = univ.currentPc;
  const missile = firer.items[loaded.missileSlot]!;
  const ammo = firer.items[loaded.ammoSlot]!;
  const firing = loaded.mode === GameMode.FIRING;

  // Which skill aims it: normally archery, but a weapon can key off thrown
  // weapons, or off how healthy or how rested the firer is.
  let skill: number;
  if (missile.weapType < 0) skill = firer.skill(Skill.ARCHERY);
  else if (missile.weapType === Skill.MAX_HP) {
    skill = Math.trunc((20 * firer.curHealth) / Math.max(1, firer.maxHealth));
  } else if (missile.weapType === Skill.MAX_SP) {
    skill = Math.trunc((20 * firer.curSp) / Math.max(1, firer.maxSp));
  } else skill = firer.skill(missile.weapType as Skill);

  // The *hard* range cap is the mode's, not the DISTANCE_MISSILE-extended one
  // the targeting cursor was given — an oddity kept from the C++.
  const range = firing ? 12 : 8;
  const bless = Math.max(-8, Math.min(8, firer.status[Status.BLESS_CURSE] ?? 0));
  const dam = ammo.itemLevel;
  let damBonus = ammo.bonus + bless;
  let hitBonus = firing ? missile.bonus : 0;
  hitBonus += firer.statAdj(Skill.DEXTERITY)
    - session.canSeeLight(firer.combatPos, target) + bless;
  const skillItem = Math.trunc(getProtLevel(firer, ItemAbil.ACCURACY) / 2);
  hitBonus += skillItem;
  damBonus += skillItem;

  let aim = target;
  if (ammo.ability === ItemAbil.SEEKING_MISSILE) {
    const sought = seekTarget(univ, aim);
    aim = sought.target;
    hitBonus += sought.hitBonus;
  }
  // Nephilim are born to it.
  if (firer.race === Race.NEPHIL) hitBonus += 2;

  if (dist(firer.combatPos, aim) > range) {
    univ.addStringToBuf('  Out of range.');
    return;
  }
  if (session.canSeeLight(firer.combatPos, aim) >= 5) {
    univ.addStringToBuf("  Can't see target.");
    return;
  }

  if (ammo.ability === ItemAbil.EXPLODING_WEAPON) {
    // An exploding arrow never rolls to hit: it flies to the square and the
    // blast does the work, so the shot can't miss but also can't crit.
    takeAp(univ, firing ? 3 : 2);
    firer.voidSanctuary();
    univ.addStringToBuf('  The arrow explodes!');
    runAMissile(firer.combatPos, aim, 2, 1, 5, 0, 0, 100);
    await placeSpellPattern(session, SpellPat.RADIUS_2, aim, {
      damage: { type: ammo.abilData as DamageType, dice: ammo.abilStrength * 2 },
      whoHit: univ.curPc,
    });
    return;
  }

  firer.voidSanctuary();
  takeAp(univ, firing ? 3 : 2);

  let r1 = univ.rng.getRan(1, 1, 100) - 5 * hitBonus - 10;
  r1 += 5 * Math.trunc((firer.status[Status.WEBS] ?? 0) / 3);
  let r2 = univ.rng.getRan(1, 1, dam) + damBonus;
  r2 = applyAmmoDamageAbility(r2, ammo, firer);
  univ.addStringToBuf(`${firer.name} fires.`);

  // The projectile itself. Note it flies at `aim` — a seeking missile visibly
  // curves to the target it found, not the square that was clicked.
  runAMissile(firer.combatPos, aim, ammo.missile, 1, firing ? 12 : 14, 0, 0, 100);

  const victim = targetThere(univ, aim);
  if (r1 > hitChance(skill)) {
    univ.addStringToBuf('  Missed.');
  } else if (victim) {
    const spec = calcSpecDam(univ, ammo.ability, ammo.abilStrength, ammo.abilData, victim);
    let weaponDamage = 0;
    let specialDamage = 0;
    if (ammo.ability === ItemAbil.HEALING_WEAPON) {
      univ.addStringToBuf('  There is a flash of light.');
      victim.heal(r2);
    } else if (victim instanceof Creature) {
      weaponDamage = await damageMonst(univ, victim, univ.curPc, r2, DamageType.WEAPON,
        { soundType: 13, doPrint: false, session });
      if (spec.damage > 0) {
        specialDamage = await damageMonst(univ, victim, univ.curPc, spec.damage, spec.damType,
          { soundType: 0, doPrint: false, session });
      }
      victim.damagedMsg(weaponDamage, specialDamage);
    } else if (victim instanceof Player) {
      // "Should the race really be included here? Maybe it's meant for melee
      // attacks only." — kept as it is.
      weaponDamage = await damagePc(univ, victim, r2, DamageType.WEAPON, firer.race,
        { soundType: 0, doPrint: false });
      if (spec.damage > 0) {
        specialDamage = await damagePc(univ, victim, spec.damage, spec.damType, firer.race,
          { soundType: 0, doPrint: false });
      }
      victim.damagedMsg(weaponDamage, specialDamage);
    }

    // Poison only rides the ammunition it was actually applied to.
    const poisoned = firer.status[Status.POISONED_WEAPON] ?? 0;
    if (poisoned > 0 && firer.weapPoisoned === ammo) {
      let amount = poisoned;
      if (hasAbilEquip(firer, ItemAbil.POISON_AUGMENT)) amount++;
      victim.poison(amount, univ.rng);
    }
    // The ammunition's own on-hit ability. WEAPON_CALL_SPECIAL is tested on
    // the ammunition but takes its node from the *launcher* — kept as written.
    onHitItemAbility(univ, firer, ammo, victim, r2 + spec.damage, 'missile', session,
      missile.abilStrength);

    // And what the target does about being shot.
    if (victim instanceof Creature) {
      const trigger = victim.mon.abil[MonstAbil.HIT_TRIGGER];
      if (trigger?.active) {
        onHitTargetSpecial(univ, firer, victim, trigger.special.extra1, 'missile', session);
      }
    } else if (victim instanceof Player) {
      const specItem = hasAbilEquip(victim, ItemAbil.HIT_CALL_SPECIAL);
      if (specItem) {
        onHitTargetSpecial(univ, firer, victim, specItem.item.abilStrength, 'missile', session);
      }
    }
  }

  spendAmmo(univ, loaded);

  firer.status[Status.POISONED_WEAPON] = moveToZero(firer.status[Status.POISONED_WEAPON] ?? 0);
}

/** The ammunition abilities that scale the damage roll. */
function applyAmmoDamageAbility(r2: number, ammo: Item, firer: Player): number {
  const health = firer.curHealth / Math.max(1, firer.maxHealth);
  const sp = firer.curSp / Math.max(1, firer.maxSp);
  switch (ammo.ability) {
    case ItemAbil.WEAK_WEAPON:
      return Math.trunc((r2 * (10 - ammo.abilStrength)) / 10);
    case ItemAbil.HP_DAMAGE:
      return Math.max(1, Math.trunc(r2 * health));
    case ItemAbil.SP_DAMAGE:
      return Math.max(1, Math.trunc(r2 * sp));
    case ItemAbil.HP_DAMAGE_REVERSE:
      return Math.trunc(r2 + ammo.abilStrength * (1 - health));
    case ItemAbil.SP_DAMAGE_REVERSE:
      return Math.trunc(r2 + ammo.abilStrength * (1 - sp));
    default:
      return r2;
  }
}

/**
 * A shot uses up its ammunition — unless the weapon has no ammunition to use.
 * RETURNING_MISSILE snaps back to one charge instead of losing one, and
 * DRAIN_MISSILES on anything the firer wears eats a second charge.
 */
function spendAmmo(univ: Universe, loaded: LoadedMissile): void {
  const firer = univ.currentPc;
  const ammo = firer.items[loaded.ammoSlot]!;
  if (ammo.variety === ItemType.MISSILE_NO_AMMO) return;
  if (ammo.ability !== ItemAbil.RETURNING_MISSILE) ammo.charges--;
  else ammo.charges = 1;
  if (hasAbilEquip(firer, ItemAbil.DRAIN_MISSILES)
    && ammo.ability !== ItemAbil.RETURNING_MISSILE) ammo.charges--;
  if (ammo.charges <= 0) takeItem(firer, loaded.ammoSlot);
}

function moveToZero(value: number): number {
  if (value > 0) return value - 1;
  if (value < 0) return value + 1;
  return 0;
}
