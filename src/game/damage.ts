/**
 * Taking damage and dying — `damage_pc` (boe.party.cpp), `damage_monst` and
 * `kill_monst` (boe.specials.cpp:1442 and :1599), `kill_pc` (boe.party.cpp:2713)
 * and `hit_party`. This is the layer everything in combat funnels through, so
 * the order of the reductions and of the `get_ran` calls is the spec: a replay
 * that matches C++ has to make the same rolls in the same sequence.
 *
 * Both damage functions return the damage actually dealt (0 for none), which is
 * what the C++'s `short` return means at every call site.
 *
 * TODO(M5): `boom_space` / `add_explosion` — the hit animation and its sound
 * type are computed here and handed to the host, but nothing draws them yet.
 */

import { Location } from '../core/location';
import { FieldType } from '../data/fields';
import { ItemAbil, ItemType } from '../data/item';
import { variety } from '../data/itemVariety';
import { DamageType } from '../data/monster';
import { Creature, CreatureStatus } from '../universe/creature';
import { getProtLevel, hasAbilEquip, takeItem } from '../universe/inventory';
import { SpellNote, livingSound } from '../universe/living';
import { boomSpace } from './booms';
import { NUM_INVEN_SLOTS, Player } from '../universe/player';
import { MainStatus, Race, Skill, Status, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';
import { SpecCtx, SpecCtxType } from './specials/context';
import type { GameSession } from './session';

/**
 * hit_chance (boe.combat.cpp:66) — the percentage a skill level buys, indexed
 * by that level. It flattens out at 99 from level 20 on.
 */
export const HIT_CHANCE = [
  20, 30, 40, 45, 50, 55, 60, 65, 69, 73,
  77, 81, 84, 87, 90, 92, 94, 96, 97, 98, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

export function hitChance(level: number): number {
  return HIT_CHANCE[Math.max(0, Math.min(HIT_CHANCE.length - 1, level))] ?? 99;
}

/** boom_gr (boe.specials.cpp:61) — which explosion graphic a damage type uses. */
const BOOM_GR: Partial<Record<DamageType, number>> = {
  [DamageType.WEAPON]: 3,
  [DamageType.FIRE]: 0,
  [DamageType.POISON]: 2,
  [DamageType.MAGIC]: 1,
  [DamageType.ACID]: 6,
  [DamageType.UNBLOCKABLE]: 5,
  [DamageType.COLD]: 4,
  [DamageType.UNDEAD]: 3,
  [DamageType.DEMON]: 3,
  [DamageType.SPECIAL]: 1,
};

/**
 * get_sound_type — the hit sound for a damage type. -1 means "the default for
 * this type"; passing 0 explicitly is how a caller forces the plain thud.
 */
export function getSoundType(damType: DamageType, forced = -1): number {
  if (forced !== -1) return forced;
  switch (damType) {
    case DamageType.FIRE: case DamageType.UNBLOCKABLE: return 5;
    case DamageType.ACID: return 8;
    case DamageType.COLD: return 7;
    case DamageType.MAGIC: return 12;
    case DamageType.POISON: return 11;
    default: return 0;
  }
}

/** Damage types a shield and a suit of armour actually stop. */
const ARMOUR_RESISTS = new Set([
  DamageType.WEAPON, DamageType.UNDEAD, DamageType.DEMON,
]);
/** Damage types the magic-resistance status halves (or doubles, if cursed). */
const MAGIC_RESISTS = new Set([DamageType.FIRE, DamageType.COLD]);
/** Damage types a ring of full protection blunts. */
const MAJOR_RESISTS = new Set([
  DamageType.FIRE, DamageType.POISON, DamageType.MAGIC, DamageType.ACID, DamageType.COLD,
]);

const isHumanoid = (race: Race): boolean => [
  Race.HUMAN, Race.NEPHIL, Race.SLITH, Race.VAHNATAI, Race.HUMANOID, Race.GOBLIN,
].includes(race);
const isHuman = (race: Race): boolean => race === Race.HUMAN;

export interface DamageOptions {
  /** Forced hit sound; -1 takes the damage type's default. */
  soundType?: number;
  /** Whether to print the "takes N" line. */
  doPrint?: boolean;
  /** Whether to run the hit animation (the C++'s `boom`). */
  boom?: boolean;
}

/**
 * damage_pc — run `howMuch` through everything that might reduce it and apply
 * what's left. `attackerRace` drives the protect-from-species items.
 */
export function damagePc(
  univ: Universe,
  pc: Player,
  howMuch: number,
  damType: DamageType,
  attackerRace: Race = Race.UNKNOWN,
  options: DamageOptions = {},
): number {
  if (pc.mainStatus !== MainStatus.ALIVE) return 0;
  const { doPrint = true, boom = true } = options;

  // Armour, and the shield-and-blessing bonus that comes with it.
  if (ARMOUR_RESISTS.has(damType)) {
    howMuch -= Math.max(-5, Math.min(5, pc.status[Status.BLESS_CURSE] ?? 0));
    for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
      const item = pc.items[i]!;
      if (item.variety === ItemType.NO_ITEM || !pc.equip[i]) continue;
      if (variety(item.variety).isArmour) {
        let defense = 0;
        if (item.itemLevel > 0) defense = univ.rng.getRan(1, 1, item.itemLevel);
        // An enchantment helps; a cursed item hurts by its full amount.
        if (item.bonus > 0) defense += univ.rng.getRan(1, 1, item.bonus) + Math.trunc(item.bonus / 2);
        else if (item.bonus < 0) defense -= item.bonus;
        howMuch -= defense;
        // A defence skill high enough to matter shaves one more off.
        const roll = univ.rng.getRan(1, 1, 100);
        if (roll < hitChance(pc.skill(Skill.DEFENSE)) - 20) howMuch -= 1;
      }
      if (item.protection > 0) howMuch -= univ.rng.getRan(1, 1, item.protection);
      else if (item.protection < 0) howMuch += univ.rng.getRan(1, 1, -item.protection);
    }
  }

  // Parry — only against weapons, and only while it's under 100.
  if (damType === DamageType.WEAPON && pc.parry < 100) howMuch -= Math.trunc(pc.parry / 4);

  if (damType !== DamageType.MARKED) {
    if (univ.party.easyMode) howMuch -= 3;
    if (pc.traits[Trait.TOUGHNESS]) howMuch--;
    if (univ.rng.getRan(1, 1, 100) < 2 * (hitChance(pc.skill(Skill.LUCK)) - 20)) howMuch -= 1;
  }

  let protFromDmg = getProtLevel(pc, ItemAbil.DAMAGE_PROTECTION, damType);
  // Acid used to be a kind of magic damage, so magic protection still counts.
  if (damType === DamageType.ACID) {
    protFromDmg += getProtLevel(pc, ItemAbil.DAMAGE_PROTECTION, DamageType.MAGIC);
  }
  if (protFromDmg > 0) {
    // Against weapons it subtracts; against anything else it halves, which
    // means the ability's strength stops mattering. That asymmetry is in the
    // original, flagged there with a TODO of its own.
    if (damType === DamageType.WEAPON) howMuch -= protFromDmg;
    else howMuch = Math.trunc(howMuch / 2);
  }

  if (getProtLevel(pc, ItemAbil.PROTECT_FROM_SPECIES, attackerRace) > 0) {
    howMuch = Math.trunc(howMuch / 2);
  }
  // Protection from humanoids also covers the specific humanoid races — but not
  // HUMANOID itself, or it would count twice.
  if (isHumanoid(attackerRace) && !isHuman(attackerRace) && attackerRace !== Race.HUMANOID) {
    if (getProtLevel(pc, ItemAbil.PROTECT_FROM_SPECIES, Race.HUMANOID) > 0) {
      howMuch = Math.trunc(howMuch / 2);
    }
  }
  // Protection from undead covers skeletons too.
  if (attackerRace === Race.SKELETAL) {
    if (getProtLevel(pc, ItemAbil.PROTECT_FROM_SPECIES, Race.UNDEAD) > 0) {
      howMuch = Math.trunc(howMuch / 2);
    }
  }

  // Invulnerability stops everything but assassination damage.
  if (damType !== DamageType.SPECIAL && (pc.status[Status.INVULNERABLE] ?? 0) > 0) howMuch = 0;

  if (MAGIC_RESISTS.has(damType)) {
    const magicRes = pc.status[Status.MAGIC_RESISTANCE] ?? 0;
    if (magicRes > 0) howMuch = Math.trunc(howMuch / 2);
    else if (magicRes < 0) howMuch *= 2;
  }

  const fullProt = getProtLevel(pc, ItemAbil.FULL_PROTECTION);
  if (MAJOR_RESISTS.has(damType) && fullProt > 0) {
    howMuch = Math.trunc(howMuch / (fullProt >= 7 ? 4 : 2));
  }

  if (howMuch <= 0) {
    // The "clang off the armour" sound, which really is file 2.
    if (ARMOUR_RESISTS.has(damType)) livingSound(2);
    univ.addStringToBuf('  No damage.');
    return 0;
  }

  // Being hit stirs a sleeping PC toward waking.
  if ((pc.status[Status.ASLEEP] ?? 0) > 0) pc.status[Status.ASLEEP]!--;
  if (doPrint) univ.addStringToBuf(`  ${pc.name} takes ${howMuch}.`);
  if (damType !== DamageType.MARKED && boom) {
    boomSpace(hitLocation(univ, pc), boomType(damType), howMuch,
      getSoundType(damType, options.soundType ?? -1));
  }
  univ.party.totalDamTaken += howMuch;

  if (pc.curHealth >= howMuch) pc.curHealth -= howMuch;
  else if (pc.curHealth > 0) pc.curHealth = 0;
  // Note the PC only dies from a hit taken while *already* at zero: a blow that
  // empties the health bar leaves them standing, and the next one kills.
  else if (howMuch > 25) {
    pc.spellNote(SpellNote.OBLITERATED);
    killPc(univ, pc, MainStatus.DUST);
  } else {
    pc.spellNote(SpellNote.KILLED);
    killPc(univ, pc, MainStatus.DEAD);
  }
  if (pc.curHealth === 0 && pc.mainStatus === MainStatus.ALIVE) livingSound(3);

  return howMuch;
}

/** The gore a death leaves behind, by race (kill_pc / kill_monst). */
function goreField(race: Race, big: boolean): FieldType | null {
  switch (race) {
    case Race.DEMON: return FieldType.SFX_ASH;
    case Race.UNDEAD: return null; // undead leave nothing
    case Race.SKELETAL: return FieldType.SFX_BONES;
    case Race.SLIME: case Race.PLANT: case Race.BUG:
      return big ? FieldType.SFX_LARGE_SLIME : FieldType.SFX_SMALL_SLIME;
    case Race.STONE: return FieldType.SFX_RUBBLE;
    default:
      return big ? FieldType.SFX_LARGE_BLOOD : FieldType.SFX_SMALL_BLOOD;
  }
}

/**
 * kill_pc (boe.party.cpp:2713) — with two ways out of it: luck can save you
 * outright, and a life-saving item is spent instead of your life. Otherwise the
 * PC's gear falls on the floor where they stood.
 *
 * A `MainStatus` of SPLIT + something means "no saving throw" (a split-off
 * duplicate dying), which is how the C++ smuggles the flag through.
 */
export function killPc(univ: Universe, pc: Player, type: MainStatus): void {
  let noSave = false;
  if (type >= MainStatus.SPLIT) {
    type -= MainStatus.SPLIT;
    noSave = true;
  }

  // Petrification isn't a death a life-saving amulet understands.
  const lifeSaver = type === MainStatus.STONE
    ? null : hasAbilEquip(pc, ItemAbil.LIFE_SAVING);

  const luck = pc.skill(Skill.LUCK);
  if (!noSave && type !== MainStatus.ABSENT && luck > 0
    && univ.rng.getRan(1, 1, 100) < hitChance(luck)) {
    univ.addStringToBuf('  But you luck out!');
    pc.curHealth = 0;
    return;
  }

  if (!lifeSaver || type === MainStatus.ABSENT) {
    for (let i = 0; i < NUM_INVEN_SLOTS; i++) pc.equip[i] = false;
    const where = pc.combatPos.x >= 0 ? pc.combatPos : univ.party.townLoc;
    const town = univ.town;

    if (town) {
      const field = type === MainStatus.DUST
        ? FieldType.SFX_ASH
        : type === MainStatus.ABSENT ? null : goreField(pc.race, true);
      if (field !== null) town.setField(where.x, where.y, field);

      // Everything they carried drops where they fell — but not outdoors,
      // where there is nowhere to drop it.
      for (const item of pc.items) {
        if (item.variety === ItemType.NO_ITEM) continue;
        town.items.push({ ...item, itemLoc: { ...where }, isSpecial: 0 });
        item.variety = ItemType.NO_ITEM;
      }
    }
    if (type === MainStatus.DEAD || type === MainStatus.DUST) livingSound(21);
    pc.mainStatus = type;
    pc.ap = 0;
  } else {
    univ.addStringToBuf('  Life saved!');
    takeItem(pc, lifeSaver.slot);
    pc.heal(200);
  }

  if (!univ.currentPc.isAlive) univ.curPc = univ.firstActivePc();
}

/**
 * damage_monst (boe.specials.cpp:1442). `whoHit` is the PC slot responsible,
 * 6 for "the party as a whole" and 7+ for another monster — it decides who gets
 * the experience and whether hurting a friendly counts as a crime.
 */
export function damageMonst(
  univ: Universe,
  victim: Creature,
  whoHit: number,
  howMuch: number,
  damType: DamageType,
  options: DamageOptions & { session?: GameSession } = {},
): number {
  if (victim.active === CreatureStatus.DEAD) return 0;
  const { doPrint = true } = options;

  // Resistances only apply below SPECIAL: assassination damage can't be stopped.
  if (damType < DamageType.SPECIAL) {
    howMuch = Math.trunc((howMuch * (victim.mon.resist[damType] ?? 100)) / 100);
  }
  // TODO(M5b): ABSORB_SPELLS lets a monster swallow fire/magic/cold/acid whole
  // and heal from it; that needs the uAbility port.

  // Saving throw — a tough monster shrugs off half of an elemental hit.
  if ((damType === DamageType.FIRE || damType === DamageType.COLD)
    && univ.rng.getRan(1, 0, 20) <= victim.mon.level) howMuch = Math.trunc(howMuch / 2);
  if ((damType === DamageType.MAGIC || damType === DamageType.ACID)
    && univ.rng.getRan(1, 0, 24) <= victim.mon.level) howMuch = Math.trunc(howMuch / 2);

  // Invulnerability divides by ten rather than zeroing, and both sources stack.
  if (damType !== DamageType.SPECIAL && victim.mon.invuln) howMuch = Math.trunc(howMuch / 10);
  if (damType !== DamageType.SPECIAL && (victim.status[Status.INVULNERABLE] ?? 0) > 0) {
    howMuch = Math.trunc(howMuch / 10);
  }

  if (MAGIC_RESISTS.has(damType)) {
    const magicRes = victim.status[Status.MAGIC_RESISTANCE] ?? 0;
    if (magicRes > 0) howMuch = Math.trunc(howMuch / 2);
    else if (magicRes < 0) howMuch *= 2;
  }

  // Monster armour only stops weapons — unlike a PC's, which also blunts
  // undead and demon damage.
  if (damType === DamageType.WEAPON) {
    let r1 = univ.rng.getRan(1, 0, Math.trunc((victim.mon.armor * 5) / 4));
    r1 += Math.trunc(victim.mon.level / 4);
    howMuch -= r1;
  }

  if (howMuch <= 0) {
    victim.spellNote(SpellNote.UNDAMAGED);
    if (ARMOUR_RESISTS.has(damType)) livingSound(2);
    return 0;
  }

  if (doPrint) victim.damagedMsg(howMuch, 0);
  if (damType !== DamageType.MARKED) {
    boomSpace(victim.curLoc, boomType(damType), howMuch,
      getSoundType(damType, options.soundType ?? -1));
  }
  victim.health -= howMuch;
  // TODO(M5b): a SPLITS monster spawns a copy of itself here.
  if (whoHit < 7) univ.party.totalDamDone += howMuch;

  // Anything that gets hurt notices.
  victim.active = CreatureStatus.ALERTED;

  if (victim.health < 0) {
    victim.spellNote(SpellNote.DIES);
    killMonst(univ, victim, whoHit, MainStatus.DEAD, options.session);
  } else {
    // Morale falls further the harder the hit was; the steps are cumulative.
    if (howMuch > 0) victim.morale -= 1;
    if (howMuch > 5) victim.morale -= 1;
    if (howMuch > 10) victim.morale -= 1;
    if (howMuch > 20) victim.morale -= 2;
  }

  // Attacking a townsperson turns the town against you.
  if (victim.isFriendly && whoHit < 7) {
    univ.addStringToBuf('Damaged an innocent.');
    victim.attitude = 1; // HOSTILE_A
    // TODO(M5b): make_town_hostile turns the rest of the town on you too.
  }

  return howMuch;
}

/**
 * kill_monst (boe.specials.cpp:1599) — the death rattle, the SDF a scenario
 * watches for, the kill special, the experience, and the mess left on the
 * floor. `spec1` is zeroed so a specially-summoned monster can't come back.
 *
 * TODO(M5b): place_treasure and place_glands — what the corpse leaves to loot.
 */
export function killMonst(
  univ: Universe,
  monst: Creature,
  whoKilled: number,
  type: MainStatus = MainStatus.DEAD,
  session?: GameSession,
): void {
  deathSound(univ, monst.mon.race);

  // The flag a scenario watches to know this one is gone.
  if (univ.party.sdLegit(monst.spec1, monst.spec2)) {
    univ.party.setSdf(monst.spec1, monst.spec2, 1);
  }
  if (monst.specialOnKill >= 0 && session) {
    // Fire and forget: the VM serialises chains through its own queue, which is
    // how the rest of this port launches a special from inside a sync path.
    void session.runSpecial(
      SpecCtx.KILL_MONST, SpecCtxType.TOWN, monst.specialOnKill, monst.curLoc);
  }
  // TODO(M5b): the DEATH_TRIGGER monster ability runs a scenario special too.

  // No experience for something the party summoned itself.
  if (monst.summonTime === 0 || !monst.partySummoned) {
    const xp = monst.mon.level * 2;
    if (whoKilled < 6) awardXp(univ, whoKilled, xp);
    else if (whoKilled === 6) awardPartyXp(univ, Math.trunc(xp / 6) + 1);
    if (whoKilled < 7) {
      univ.party.totalMKilled++;
      awardPartyXp(univ, Math.max(Math.trunc(xp / 6), 1));
    }
  }

  const town = univ.town;
  if (town) {
    const field = type === MainStatus.DUST
      ? FieldType.SFX_ASH
      : (type === MainStatus.ABSENT || type === MainStatus.STONE)
        ? null : goreField(monst.mon.race, false);
    if (field !== null) town.setField(monst.curLoc.x, monst.curLoc.y, field);
    if (monst.summonTime === 0) town.monstersKilled++;
  }

  monst.spec1 = 0;
  monst.active = CreatureStatus.DEAD;
}

/** The dying sound, which depends on what kind of thing it was. */
function deathSound(univ: Universe, race: Race): void {
  if (isHumanoid(race)) {
    livingSound(29 + (race === Race.GOBLIN ? 4 : univ.rng.getRan(1, 0, 1)));
    return;
  }
  switch (race) {
    case Race.GIANT:
      livingSound(29);
      break;
    case Race.REPTILE: case Race.BEAST: case Race.DEMON:
    case Race.UNDEAD: case Race.SKELETAL: case Race.STONE:
      livingSound(31 + univ.rng.getRan(1, 0, 1));
      break;
    default:
      livingSound(33);
      break;
  }
}

/**
 * xp_percent (award_xp) — the percentage of an award a PC actually banks,
 * indexed by half their level. Levelling gets steeply less rewarding.
 */
const XP_PERCENT = [
  150, 120, 100, 90, 80, 70, 60, 50, 50, 50,
  45, 40, 40, 40, 40, 35, 30, 25, 23, 20,
  15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
];

/**
 * award_xp (boe.party.cpp) — give one PC experience and level them up as far
 * as it takes them. Note the level-up loop can run more than once.
 */
export function awardXp(univ: Universe, pcNum: number, amount: number): void {
  const pc = univ.party.pcs[pcNum];
  if (!pc) return;
  if (pc.level > 49) {
    pc.level = 50;
    return;
  }
  if (amount < 0) return;
  if (!pc.isAlive) return;

  const bracket = XP_PERCENT[Math.min(Math.trunc(pc.level / 2), XP_PERCENT.length - 1)] ?? 15;
  const adjust = pc.level >= 40 ? 15 : bracket;
  // Past level 7 there's a chance a point simply evaporates before the scaling.
  if (amount > 0 && pc.level > 7 && univ.rng.getRan(1, 1, 100) < bracket) amount--;
  if (amount <= 0) return;

  amount = Math.trunc((amount * adjust) / 100);
  amount = Math.max(amount, 0);
  amount = Math.trunc((amount * pc.expAdj) / 100);
  pc.experience += amount;
  univ.party.totalXpGained += amount;

  if (pc.experience > 15000) {
    pc.experience = 15000;
    return;
  }

  while (pc.experience >= pc.level * pc.getTnl()) {
    livingSound(7);
    pc.level++;
    univ.addStringToBuf(`  ${pc.name} is level ${pc.level}!`);
    pc.skillPts += pc.level < 20 ? 5 : 4;
    // Health stops growing on its own at 26; after that only a strength bonus
    // adds anything.
    const strBonus = pc.statAdj(Skill.STRENGTH);
    let addHp = pc.level < 26
      ? univ.rng.getRan(1, 2, 6) + strBonus
      : Math.max(strBonus, 0);
    if (addHp < 0) addHp = 0;
    pc.maxHealth = Math.min(250, pc.maxHealth + addHp);
    pc.curHealth = Math.min(250, pc.curHealth + addHp);
  }
}

/** award_party_xp — the same award to everyone still standing. */
export function awardPartyXp(univ: Universe, amount: number): void {
  for (let i = 0; i < univ.party.pcs.length; i++) {
    if (univ.party.pcs[i]!.isAlive) awardXp(univ, i, amount);
  }
}

/** hit_party (boe.party.cpp:2489) — the same blow to every living PC. */
export function hitParty(
  univ: Universe,
  howMuch: number,
  damType: DamageType,
  soundType = -1,
): void {
  for (const pc of univ.party.pcs) {
    if (!pc.isAlive) continue;
    damagePc(univ, pc, howMuch, damType, Race.UNKNOWN, { soundType });
  }
}

/** The explosion graphic a damage type uses, for whoever draws it. */
export function boomType(damType: DamageType): number {
  return BOOM_GR[damType] ?? 3;
}

/** Where a hit should be drawn, for the animation the host will own. */
export function hitLocation(univ: Universe, pc: Player): Location {
  return pc.combatPos.x >= 0 ? pc.combatPos : univ.party.getLoc();
}
