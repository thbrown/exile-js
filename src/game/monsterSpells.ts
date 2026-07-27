/**
 * Monsters casting spells — `monst_cast_mage` (boe.combat.cpp:3207) and
 * `monst_cast_priest` (:3550), plus the four targeting helpers they lean on
 * (:3875-3945).
 *
 * A monster doesn't pick from the spell list the way a PC does. It rolls
 * against a **table indexed by its magic level**, biased by four emergency
 * cases the C++ checks first, in this order:
 *
 *   0. it is slowed (or merely un-hasted) — haste itself;
 *   1. its side is outnumbered nearby — summon help;
 *   2. the enemy is bunched up — drop an area spell on them;
 *   3. it is below a quarter health — the panic column.
 *
 * Emergency 3 is tested *first* despite being last in the table, so a badly
 * hurt monster heals or lashes out before it thinks about anything else.
 */

import { Location, dist, vdist } from '../core/location';
import { FieldType } from '../data/fields';
import { DamageType } from '../data/monster';
import { SpellPat } from '../data/pattern';
import { Spell, SPELLS, spellName } from '../data/spell';
import { SIGHT_BLOCKED, canSee } from '../core/sight';
import { Creature, CreatureStatus } from '../universe/creature';
import { Living, SpellNote, livingSound } from '../universe/living';
import { Player } from '../universe/player';
import { MainStatus, Race, Status } from '../universe/skills';
import { damageTarget } from './combat';
import { GameMode, isCombat } from './modes';
import { getSummonMonster, summonMonster } from './monsterPlace';
import { placeSpellPattern } from './spellPatterns';
import { doShockwave } from './spellCombat';
import type { GameSession } from './session';

/** The 7x18 mage table, indexed by the caster's magic level then a d18. */
const MAGE_TABLE: Spell[][] = [
  [Spell.SPARK, Spell.SPARK, Spell.SPARK, Spell.HASTE_MINOR, Spell.HASTE_MINOR,
    Spell.HASTE_MINOR, Spell.SPARK, Spell.STRENGTH, Spell.CLOUD_FLAME, Spell.CLOUD_FLAME,
    Spell.SPARK, Spell.SPARK, Spell.SPARK, Spell.HASTE_MINOR, Spell.HASTE_MINOR,
    Spell.HASTE_MINOR, Spell.STRENGTH, Spell.CLOUD_FLAME],
  [Spell.FLAME, Spell.FLAME, Spell.FLAME, Spell.POISON_MINOR, Spell.SLOW,
    Spell.DUMBFOUND, Spell.CLOUD_STINK, Spell.SUMMON_BEAST, Spell.CONFLAGRATION,
    Spell.CONFLAGRATION, Spell.HASTE_MINOR, Spell.HASTE_MINOR, Spell.HASTE_MINOR,
    Spell.FLAME, Spell.SLOW, Spell.SUMMON_BEAST, Spell.SUMMON_BEAST, Spell.FLAME],
  [Spell.FLAME, Spell.FLAME, Spell.HASTE_MINOR, Spell.CLOUD_STINK, Spell.CONFLAGRATION,
    Spell.FIREBALL, Spell.FIREBALL, Spell.FIREBALL, Spell.WEB, Spell.SUMMON_WEAK,
    Spell.SUMMON_WEAK, Spell.FIREBALL, Spell.FIREBALL, Spell.HASTE_MINOR,
    Spell.HASTE_MINOR, Spell.HASTE_MINOR, Spell.HASTE_MINOR, Spell.HASTE_MINOR],
  [Spell.POISON, Spell.POISON, Spell.ICE_BOLT, Spell.SLOW_GROUP, Spell.SLOW_GROUP,
    Spell.FLAME, Spell.FIREBALL, Spell.FIREBALL, Spell.SUMMON_WEAK, Spell.SUMMON_WEAK,
    Spell.SLOW_GROUP, Spell.SLOW_GROUP, Spell.ICE_BOLT, Spell.SLOW_GROUP, Spell.ICE_BOLT,
    Spell.HASTE_MINOR, Spell.HASTE_MINOR, Spell.HASTE_MINOR],
  [Spell.POISON, Spell.HASTE_MAJOR, Spell.FIRESTORM, Spell.FIRESTORM, Spell.SUMMON,
    Spell.SUMMON, Spell.SHOCKSTORM, Spell.SHOCKSTORM, Spell.ICE_BOLT, Spell.SLOW_GROUP,
    Spell.HASTE_MAJOR, Spell.HASTE_MAJOR, Spell.HASTE_MAJOR, Spell.HASTE_MAJOR,
    Spell.FIRESTORM, Spell.FIRESTORM, Spell.FIRESTORM, Spell.SUMMON],
  [Spell.KILL, Spell.KILL, Spell.POISON_MAJOR, Spell.POISON_MAJOR, Spell.SHOCKSTORM,
    Spell.SHOCKSTORM, Spell.SUMMON, Spell.DEMON, Spell.FIRESTORM, Spell.HASTE_MAJOR,
    Spell.HASTE_MAJOR, Spell.HASTE_MAJOR, Spell.HASTE_MAJOR, Spell.HASTE_MAJOR,
    Spell.HASTE_MAJOR, Spell.KILL, Spell.KILL, Spell.FIRESTORM],
  [Spell.KILL, Spell.KILL, Spell.DEMON, Spell.BLESS_MAJOR, Spell.SUMMON_MAJOR,
    Spell.SHOCKWAVE, Spell.FIRESTORM, Spell.POISON_MAJOR, Spell.FIRESTORM,
    Spell.HASTE_MAJOR, Spell.HASTE_MAJOR, Spell.HASTE_MAJOR, Spell.HASTE_MAJOR,
    Spell.HASTE_MAJOR, Spell.SUMMON_MAJOR, Spell.DEMON, Spell.DEMON, Spell.KILL],
];

/** Mage emergencies: slowed / outnumbered / enemy clustered / badly hurt. */
const MAGE_EMERGENCY: Spell[][] = [
  [Spell.HASTE_MINOR, Spell.NONE, Spell.NONE, Spell.FLAME],
  [Spell.HASTE_MINOR, Spell.SUMMON_BEAST, Spell.CONFLAGRATION, Spell.SLOW],
  [Spell.HASTE_MINOR, Spell.SUMMON_WEAK, Spell.FIREBALL, Spell.SUMMON_WEAK],
  [Spell.HASTE_MINOR, Spell.SUMMON_WEAK, Spell.FIREBALL, Spell.SUMMON_WEAK],
  [Spell.HASTE_MAJOR, Spell.SUMMON, Spell.FIRESTORM, Spell.HASTE_MAJOR],
  [Spell.HASTE_MAJOR, Spell.DEMON, Spell.FIRESTORM, Spell.DEMON],
  [Spell.HASTE_MAJOR, Spell.SUMMON_MAJOR, Spell.FIRESTORM, Spell.SHOCKWAVE],
];

const MAGE_AREA = new Set<Spell>([
  Spell.CLOUD_STINK, Spell.CONFLAGRATION, Spell.FIREBALL, Spell.WEB,
  Spell.FIRESTORM, Spell.SHOCKSTORM,
]);

/** The 7x10 priest table. */
const PRIEST_TABLE: Spell[][] = [
  [Spell.BLESS_MINOR, Spell.BLESS_MINOR, Spell.BLESS_MINOR, Spell.BLESS_MINOR,
    Spell.WRACK, Spell.WRACK, Spell.WRACK, Spell.GOO, Spell.GOO, Spell.GOO],
  [Spell.BLESS, Spell.BLESS, Spell.CURSE, Spell.CURSE, Spell.WOUND,
    Spell.WOUND, Spell.SUMMON_SPIRIT, Spell.SUMMON_SPIRIT, Spell.SUMMON_SPIRIT,
    Spell.DISEASE],
  [Spell.DISEASE, Spell.CURSE, Spell.CURSE, Spell.SUMMON_SPIRIT, Spell.HOLY_SCOURGE,
    Spell.SMITE, Spell.SMITE, Spell.BLESS, Spell.BLESS, Spell.SMITE],
  [Spell.SMITE, Spell.SMITE, Spell.CURSE_ALL, Spell.CURSE_ALL, Spell.STICKS_TO_SNAKES,
    Spell.DISEASE, Spell.DISEASE, Spell.STICKS_TO_SNAKES, Spell.STICKS_TO_SNAKES,
    Spell.MARTYRS_SHIELD],
  [Spell.SUMMON_HOST, Spell.FLAMESTRIKE, Spell.CURSE_ALL, Spell.SUMMON_HOST,
    Spell.MARTYRS_SHIELD, Spell.FLAMESTRIKE, Spell.FLAMESTRIKE, Spell.SUMMON_HOST,
    Spell.BLESS_PARTY, Spell.FLAMESTRIKE],
  [Spell.SUMMON_GUARDIAN, Spell.FLAMESTRIKE, Spell.BLESS_PARTY, Spell.SUMMON_HOST,
    Spell.FLAMESTRIKE, Spell.FLAMESTRIKE, Spell.UNHOLY_RAVAGING, Spell.SUMMON_GUARDIAN,
    Spell.PESTILENCE, Spell.PESTILENCE],
  [Spell.DIVINE_THUD, Spell.DIVINE_THUD, Spell.AVATAR, Spell.REVIVE_ALL,
    Spell.DIVINE_THUD, Spell.SUMMON_GUARDIAN, Spell.REVIVE_ALL, Spell.SUMMON_GUARDIAN,
    Spell.DIVINE_THUD, Spell.AVATAR],
];

const PRIEST_EMERGENCY: Spell[][] = [
  [Spell.NONE, Spell.BLESS_MINOR, Spell.NONE, Spell.HEAL_MINOR],
  [Spell.NONE, Spell.SUMMON_SPIRIT, Spell.NONE, Spell.HEAL_MINOR],
  [Spell.NONE, Spell.SUMMON_SPIRIT, Spell.NONE, Spell.HEAL],
  [Spell.NONE, Spell.STICKS_TO_SNAKES, Spell.NONE, Spell.HEAL],
  [Spell.NONE, Spell.SUMMON_HOST, Spell.FLAMESTRIKE, Spell.HEAL_MAJOR],
  [Spell.NONE, Spell.SUMMON_HOST, Spell.FLAMESTRIKE, Spell.HEAL_ALL],
  [Spell.AVATAR, Spell.AVATAR, Spell.DIVINE_THUD, Spell.REVIVE_ALL],
];

const PRIEST_AREA = new Set<Spell>([Spell.FLAMESTRIKE, Spell.DIVINE_THUD]);

const NO_TARGET_LOC: Location = { x: -1, y: 0 };

// --------------------------------------------------------------- the helpers

/** `monst_near` (:3941) — `active` 1 means the monster must be alerted. */
export function monstNear(
  monst: Creature, where: Location, radius: number, active = 0,
): boolean {
  if (!monst.isAlive) return false;
  if (vdist(monst.curLoc, where) > radius) return false;
  return active === 0 || monst.active === CreatureStatus.ALERTED;
}

/** `pc_near` (:3927) — in combat each PC stands alone; in town they share a square. */
export function pcNear(
  session: GameSession, pc: Player, where: Location, radius: number,
): boolean {
  if (pc.mainStatus !== MainStatus.ALIVE) return false;
  const at = session.mode >= GameMode.COMBAT
    ? pc.combatPos : session.univ.party.townLoc;
  return vdist(at, where) <= radius;
}

/**
 * `count_levels` (:3906) — how badly a square is stacked against the monsters.
 * Friendly creatures count up by their level, hostile ones down; a PC in
 * combat is worth a flat 10, and the whole party in town a flat 20.
 */
export function countLevels(
  session: GameSession, where: Location, radius: number,
): number {
  const { univ } = session;
  let store = 0;
  for (const monst of univ.town?.monsters ?? []) {
    if (!monstNear(monst, where, radius)) continue;
    store += monst.isFriendly ? monst.getLevel() : -monst.getLevel();
  }
  if (isCombat(session.mode)) {
    for (const pc of univ.party.pcs) {
      if (pcNear(session, pc, where, radius)) store += 10;
    }
  } else if (session.inTown) {
    const at = univ.party.townLoc;
    if (vdist(where, at) <= radius
      && canSee(where, at, session.sightObscurity) < SIGHT_BLOCKED) store += 20;
  }
  return store;
}

/**
 * `find_fireball_loc` (:3875) — the best square within eight to drop an area
 * spell on. `mode` 1 flips the sign, so a *friendly* caster looks for a knot of
 * the party's enemies rather than of the party.
 *
 * Returns `{x: -1}` when nowhere is worth it, and the level total through
 * `levels`. Note the deliberate tie-break coin flip, which moves the RNG.
 */
export function findFireballLoc(
  session: GameSession, where: Location, radius: number, friendly: boolean,
): { at: Location; levels: number } {
  const { univ } = session;
  const town = univ.town;
  if (!town) return { at: { ...NO_TARGET_LOC }, levels: 10 };
  let best: Location = { ...NO_TARGET_LOC };
  let levelMax = 10;
  const dim = town.record.maxDim;
  for (let x = 1; x < dim - 1; x++) {
    for (let y = 1; y < dim - 1; y++) {
      const at = { x, y };
      if (dist(where, at) > 8) continue;
      if (canSee(where, at, session.sightObscurity) >= SIGHT_BLOCKED) continue;
      if (session.sightObscurity(x, y) >= SIGHT_BLOCKED) continue;
      let cur = countLevels(session, at, radius);
      if (friendly) cur = -cur;
      if ((cur > levelMax || (cur === levelMax && univ.rng.getRan(1, 0, 1) === 0))
        && dist(where, at) > radius) {
        levelMax = cur;
        best = at;
      }
    }
  }
  return { at: best, levels: levelMax };
}

// ------------------------------------------------------------------ the casts

/** `univ.get_target(targ)` — the encoding monster AI passes around. */
function targetOf(session: GameSession, targ: number): Living | null {
  const { univ } = session;
  if (targ < 6) return univ.party.pcs[targ] ?? null;
  if (targ >= 100) return univ.town?.monsters[targ - 100] ?? null;
  return null;
}

/** `iLiving::cast_spell_note` — "X casts:" then the spell's name. */
function castNote(session: GameSession, caster: Creature, spell: Spell): void {
  session.univ.addStringToBuf(`${caster.getName()} casts:`);
  session.univ.addStringToBuf(`  ${spellName(spell)}`);
}

/** Shared front half of both casters: is this even possible, and on what? */
function castable(session: GameSession, caster: Creature, targ: number): boolean {
  const town = session.univ.town;
  if (!town) return false;
  // A caster standing in antimagic can do nothing at all.
  if (town.hasField(caster.curLoc.x, caster.curLoc.y, FieldType.FIELD_ANTIMAGIC)) {
    return false;
  }
  if (targ < 6 && session.univ.party.pcs[targ]?.mainStatus !== MainStatus.ALIVE) return false;
  if (targ >= 100 && town.monsters[targ - 100]?.active === CreatureStatus.DEAD) return false;
  return true;
}

/** Whichever of the four emergencies applies, else a roll on the table. */
function pickSpell(
  session: GameSession, caster: Creature, level: number,
  table: Spell[][], emergency: Spell[][], sides: number,
  hasteRule: 'mage' | 'priest',
): { spell: Spell; target: Location; targetLevels: number } {
  const rng = session.univ.rng;
  const { at, levels } = findFireballLoc(session, caster.curLoc, 1, caster.isFriendly);
  const friendLevels = caster.isFriendly
    ? countLevels(session, caster.curLoc, 3)
    : -countLevels(session, caster.curLoc, 3);
  const row = emergency[level] ?? [];
  const haste = caster.status[Status.HASTE_SLOW] ?? 0;

  let spell: Spell;
  if (caster.health * 4 < caster.maxHealth && rng.getRan(1, 0, 10) < 9) {
    spell = row[3] ?? Spell.NONE;
  } else if (hasteRule === 'mage'
    && ((haste < 0 && rng.getRan(1, 0, 10) < 7) || (haste === 0 && rng.getRan(1, 0, 10) < 5))
    && (row[0] ?? Spell.NONE) !== Spell.NONE) {
    spell = row[0]!;
  } else if (hasteRule === 'priest'
    && haste < 0 && rng.getRan(1, 0, 10) < 7 && (row[0] ?? Spell.NONE) !== Spell.NONE) {
    spell = row[0]!;
  } else if (friendLevels <= -10 && rng.getRan(1, 0, 10) < 7
    && (row[1] ?? Spell.NONE) !== Spell.NONE) {
    spell = row[1]!;
  } else if (levels > 50 && rng.getRan(1, 0, 10) < 7
    && (row[2] ?? Spell.NONE) !== Spell.NONE) {
    spell = row[2]!;
  } else {
    spell = table[level]?.[rng.getRan(1, 0, sides - 1)] ?? Spell.NONE;
  }
  return { spell, target: at, targetLevels: levels };
}

/** `monst_cast_mage` (:3207). Returns whether the monster actually acted. */
export function monstCastMage(
  session: GameSession, caster: Creature, targ: number,
): boolean {
  const { univ } = session;
  const town = univ.town;
  if (!town || !castable(session, caster, targ)) return false;
  const rng = univ.rng;

  const level = Math.max(1, Math.min(7,
    caster.mon.mu - (caster.status[Status.DUMB] ?? 0))) - 1;
  let { spell, target } = pickSpell(
    session, caster, level, MAGE_TABLE, MAGE_EMERGENCY, 18, 'mage');

  // Hastes come up often in the table; don't waste one on an already-hasted
  // caster — fall through to the panic column instead.
  if ((caster.status[Status.HASTE_SLOW] ?? 0) > 0
    && (spell === Spell.HASTE_MINOR || spell === Spell.HASTE_MAJOR)) {
    spell = MAGE_EMERGENCY[level]?.[3] ?? Spell.NONE;
  }
  // No good spot for an area spell? Re-roll once, then give up.
  if (target.x < 0 && MAGE_AREA.has(spell)) {
    spell = MAGE_TABLE[level]?.[rng.getRan(1, 0, 17)] ?? Spell.NONE;
    if (target.x < 0 && MAGE_AREA.has(spell)) return false;
  }
  if (MAGE_AREA.has(spell)) targ = 6;

  const victim = targetOf(session, targ);
  const victLoc = victim ? victim.getLoc() : target;

  // Antimagic on the far end stops it too.
  if (targ === 6 && town.hasField(target.x, target.y, FieldType.FIELD_ANTIMAGIC)) return false;
  if (victim && town.hasField(victLoc.x, victLoc.y, FieldType.FIELD_ANTIMAGIC)) return false;

  // Shockwave hits everything, so it is only worth it in a real crowd — and a
  // friendly caster never uses it at all.
  if (spell === Spell.SHOCKWAVE
    && (caster.isFriendly || countLevels(session, caster.curLoc, 10) < 45)) {
    spell = Spell.SUMMON_MAJOR;
  }

  // Fireball and the two cheap summons are priced at 4 rather than by level.
  let cost = SPELLS[spell]?.level ?? 0;
  if (spell === Spell.SUMMON_BEAST || spell === Spell.FIREBALL
    || spell === Spell.SUMMON_WEAK) cost = 4;

  if (caster.mp < cost) {
    // A monster that can't afford anything slowly regains a point.
    caster.mp++;
    return false;
  }
  castNote(session, caster, spell);
  caster.mp -= cost;

  const hit = (dam: number, type: DamageType): void => {
    if (victim) damageTarget(univ, victim, dam, type, 7, Race.UNKNOWN, true, session);
  };
  const summonN = (which: number, count: number, dice: number): void => {
    if (which === 0) return;
    const strength = rng.getRan(dice, 1, 4);
    for (let i = 0; i < count; i++) {
      if (!summonMonster(session, which, caster.curLoc, strength,
        caster.attitude, caster.isFriendly, true)) {
        univ.addStringToBuf('  Summon failed.');
        break;
      }
    }
  };

  switch (spell) {
    case Spell.SPARK: hit(rng.getRan(2, 1, 4), DamageType.MAGIC); break;
    case Spell.HASTE_MINOR: livingSound(25); caster.slow(-2); break;
    case Spell.STRENGTH: livingSound(25); caster.curse(-3); break;
    case Spell.CLOUD_FLAME:
      placeSpellPattern(session, SpellPat.SINGLE, victLoc,
        { field: FieldType.WALL_FIRE, whoHit: 7 });
      break;
    case Spell.FLAME:
      hit(rng.getRan(Math.min(15, caster.getLevel()), 1, 4), DamageType.FIRE);
      break;
    case Spell.POISON_MINOR:
      victim?.poison(2 + rng.getRan(1, 0, Math.trunc(caster.getLevel() / 2)), rng);
      break;
    case Spell.SLOW: victim?.slow(2 + Math.trunc(caster.getLevel() / 2)); break;
    case Spell.DUMBFOUND: victim?.dumbfound(2, rng); break;
    case Spell.CLOUD_STINK:
      placeSpellPattern(session, SpellPat.SQUARE, target,
        { field: FieldType.CLOUD_STINK, whoHit: 7 });
      break;
    case Spell.SUMMON_BEAST:
      livingSound(25);
      summonN(getSummonMonster(session, 1), 1, 3);
      break;
    case Spell.CONFLAGRATION:
      placeSpellPattern(session, SpellPat.RADIUS_2, target,
        { field: FieldType.WALL_FIRE, whoHit: 7 });
      break;
    case Spell.FIREBALL:
      placeSpellPattern(session, SpellPat.SQUARE, target, {
        damage: {
          type: DamageType.FIRE,
          dice: Math.min(29, 1 + Math.trunc((caster.getLevel() * 3) / 4)),
        },
        whoHit: 7,
      });
      break;
    case Spell.SUMMON_WEAK:
      livingSound(25);
      summonN(getSummonMonster(session, 1), rng.getRan(2, 1, 3) + 1, 4);
      break;
    case Spell.SUMMON:
      livingSound(25);
      summonN(getSummonMonster(session, 2), rng.getRan(2, 1, 2) + 1, 4);
      break;
    case Spell.SUMMON_MAJOR:
      livingSound(25);
      summonN(getSummonMonster(session, 3), rng.getRan(1, 2, 3), 4);
      break;
    case Spell.WEB:
      livingSound(25);
      placeSpellPattern(session, SpellPat.RADIUS_2, target,
        { field: FieldType.FIELD_WEB, whoHit: 7 });
      break;
    case Spell.POISON:
      victim?.poison(4 + rng.getRan(1, 0, Math.trunc(caster.getLevel() / 2)), rng);
      break;
    case Spell.ICE_BOLT:
      hit(rng.getRan(5 + Math.trunc(caster.getLevel() / 5), 1, 8), DamageType.COLD);
      break;
    case Spell.SLOW_GROUP: {
      livingSound(25);
      const amount = 2 + Math.trunc(caster.getLevel() / 4);
      if (!caster.isFriendly) {
        for (const pc of univ.party.pcs) {
          if (pcNear(session, pc, caster.curLoc, 8)) pc.slow(amount);
        }
      }
      for (const m of town.monsters) {
        if (m.isAlive && !caster.isFriendlyTo(m) && dist(caster.curLoc, m.curLoc) <= 7) {
          m.slow(amount);
        }
      }
      break;
    }
    case Spell.HASTE_MAJOR:
      livingSound(25);
      for (const m of town.monsters) {
        if (monstNear(m, caster.curLoc, 8) && caster.attitude === m.attitude) m.slow(-3);
      }
      livingSound(4);
      break;
    case Spell.FIRESTORM:
      placeSpellPattern(session, SpellPat.RADIUS_2, target, {
        damage: {
          type: DamageType.FIRE,
          dice: Math.min(29, 1 + Math.trunc((caster.getLevel() * 3) / 4) + 3),
        },
        whoHit: 7,
      });
      break;
    case Spell.SHOCKSTORM:
      placeSpellPattern(session, SpellPat.RADIUS_2, target,
        { field: FieldType.WALL_FORCE, whoHit: 7 });
      break;
    case Spell.POISON_MAJOR:
      victim?.poison(6 + rng.getRan(1, 1, 2), rng);
      break;
    case Spell.KILL:
      hit(35 + rng.getRan(3, 1, 10), DamageType.MAGIC);
      break;
    case Spell.DEMON:
      livingSound(25);
      summonN(85, 1, 3);
      break;
    case Spell.BLESS_MAJOR:
      livingSound(25);
      for (const m of town.monsters) {
        if (!monstNear(m, caster.curLoc, 8) || caster.attitude !== m.attitude) continue;
        m.health += rng.getRan(2, 1, 10);
        m.curse(-rng.getRan(3, 1, 4));
        m.status[Status.WEBS] = 0;
        if ((m.status[Status.HASTE_SLOW] ?? 0) < 0) m.status[Status.HASTE_SLOW] = 0;
        m.morale += rng.getRan(3, 1, 10);
      }
      livingSound(4);
      break;
    case Spell.SHOCKWAVE:
      doShockwave(session, caster.curLoc);
      break;
    default:
      univ.addStringToBuf(
        `  Error: Mage spell ${spellName(spell)} not implemented for monsters.`);
      break;
  }
  return true;
}

/** `monst_cast_priest` (:3550). */
export function monstCastPriest(
  session: GameSession, caster: Creature, targ: number,
): boolean {
  const { univ } = session;
  const town = univ.town;
  if (!town || !castable(session, caster, targ)) return false;
  const rng = univ.rng;

  const level = Math.max(1, Math.min(7,
    caster.mon.cl - (caster.status[Status.DUMB] ?? 0))) - 1;
  let { spell, target } = pickSpell(
    session, caster, level, PRIEST_TABLE, PRIEST_EMERGENCY, 10, 'priest');

  if (target.x < 0 && PRIEST_AREA.has(spell)) {
    spell = PRIEST_TABLE[level]?.[rng.getRan(1, 0, 9)] ?? Spell.NONE;
    if (target.x < 0 && PRIEST_AREA.has(spell)) return false;
  }
  if (PRIEST_AREA.has(spell)) targ = 6;

  const victim = targetOf(session, targ);
  const victLoc = victim ? victim.getLoc() : target;

  if (targ === 6 && town.hasField(target.x, target.y, FieldType.FIELD_ANTIMAGIC)) return false;
  if (victim && town.hasField(victLoc.x, victLoc.y, FieldType.FIELD_ANTIMAGIC)) return false;

  // A healthy caster wastes no time healing; the C++ swaps the two big heals
  // for something useful and notes it should probably do the same for the
  // small one.
  if (caster.health === caster.maxHealth) {
    if (spell === Spell.HEAL_MAJOR) spell = Spell.BLESS_PARTY;
    if (spell === Spell.HEAL_ALL) spell = Spell.SUMMON_HOST;
  }

  let cost = SPELLS[spell]?.level ?? 0;
  if (spell === Spell.SUMMON_SPIRIT || spell === Spell.PESTILENCE || cost === 7) cost = 8;
  if (spell === Spell.SUMMON_GUARDIAN || spell === Spell.SUMMON_HOST) cost = 10;

  if (caster.mp < cost) {
    caster.mp++;
    return false;
  }
  castNote(session, caster, spell);
  caster.mp -= cost;

  const hit = (dam: number, type: DamageType): void => {
    if (victim) damageTarget(univ, victim, dam, type, 7, Race.UNKNOWN, true, session);
  };
  const summon1 = (which: number, dice: number): boolean =>
    summonMonster(session, which, caster.curLoc, rng.getRan(dice, 1, 4),
      caster.attitude, caster.isFriendly, true);

  switch (spell) {
    case Spell.WRACK: hit(rng.getRan(2, 1, 4), DamageType.UNBLOCKABLE); break;
    case Spell.GOO:
      livingSound(24);
      placeSpellPattern(session, SpellPat.SINGLE, victLoc,
        { field: FieldType.FIELD_WEB, whoHit: 7 });
      break;
    case Spell.BLESS_MINOR: case Spell.BLESS:
      livingSound(24);
      caster.curse(-(spell === Spell.BLESS ? 5 : 3));
      livingSound(4);
      break;
    case Spell.CURSE: victim?.curse(2 + rng.getRan(1, 0, 1)); break;
    case Spell.WOUND: hit(rng.getRan(2, 1, 6) + 2, DamageType.UNBLOCKABLE); break;
    case Spell.SUMMON_SPIRIT: case Spell.SUMMON_GUARDIAN:
      livingSound(24);
      summon1(spell === Spell.SUMMON_SPIRIT ? 125 : 122, 3);
      break;
    case Spell.DISEASE: victim?.disease(2 + rng.getRan(1, 0, 2), rng); break;
    case Spell.HOLY_SCOURGE:
      // A PC gets the full dose; another monster gets a much smaller one. The
      // C++ has a TODO asking why, and keeps it.
      if (targ < 6) {
        victim?.slow(2 + rng.getRan(1, 0, 2));
        victim?.curse(3 + rng.getRan(1, 0, 2));
      } else {
        victim?.slow(rng.getRan(1, 0, 2));
        victim?.curse(rng.getRan(1, 0, 2));
      }
      break;
    case Spell.SMITE: hit(rng.getRan(4, 1, 6) + 2, DamageType.COLD); break;
    case Spell.STICKS_TO_SNAKES: {
      livingSound(24);
      const n = rng.getRan(1, 1, 4) + 2;
      for (let i = 0; i < n; i++) {
        const r2 = rng.getRan(1, 0, 7);
        summon1(r2 === 1 ? 100 : 99, 3);
      }
      break;
    }
    case Spell.MARTYRS_SHIELD:
      livingSound(24);
      caster.status[Status.MARTYRS_SHIELD] =
        Math.min(10, (caster.status[Status.MARTYRS_SHIELD] ?? 0) + 5);
      break;
    case Spell.SUMMON_HOST:
      livingSound(24);
      summon1(126, 3);
      for (let i = 0; i < 4; i++) if (!summon1(125, 3)) break;
      break;
    case Spell.CURSE_ALL: case Spell.PESTILENCE: {
      livingSound(24);
      const r1 = rng.getRan(2, 0, 2);
      const r2 = rng.getRan(1, 0, 2);
      const apply = (who: Living): void => {
        if (spell === Spell.CURSE_ALL) who.curse(2 + r1);
        else who.disease(2 + r2, rng);
      };
      if (!caster.isFriendly) {
        for (const pc of univ.party.pcs) {
          if (pcNear(session, pc, caster.curLoc, 8)) apply(pc);
        }
      }
      for (const m of town.monsters) {
        if (m.isAlive && !caster.isFriendlyTo(m) && dist(caster.curLoc, m.curLoc) <= 7) {
          apply(m);
        }
      }
      break;
    }
    case Spell.HEAL_MINOR: case Spell.HEAL:
    case Spell.HEAL_MAJOR: case Spell.HEAL_ALL: {
      livingSound(24);
      const amount = spell === Spell.HEAL_MINOR ? rng.getRan(2, 1, 4) + 2
        : spell === Spell.HEAL ? rng.getRan(3, 1, 6)
          : spell === Spell.HEAL_MAJOR ? rng.getRan(5, 1, 6) + 3 : 50;
      caster.heal(amount);
      break;
    }
    case Spell.BLESS_PARTY: case Spell.REVIVE_ALL: {
      livingSound(24);
      const r1 = rng.getRan(2, 1, 4);
      // The C++ rolls a second value here and never uses it; its own comment
      // wonders whether Revive All was meant to. Kept, since it moves the RNG.
      rng.getRan(3, 1, 6);
      for (const m of town.monsters) {
        if (!monstNear(m, caster.curLoc, 8) || caster.attitude !== m.attitude) continue;
        if (spell === Spell.BLESS_PARTY) m.curse(-r1);
        else m.health += r1;
      }
      livingSound(4);
      break;
    }
    case Spell.FLAMESTRIKE:
      placeSpellPattern(session, SpellPat.SQUARE, target, {
        damage: { type: DamageType.FIRE, dice: 2 + Math.trunc(caster.getLevel() / 2) + 2 },
        whoHit: 7,
      });
      break;
    case Spell.UNHOLY_RAVAGING: {
      const r2 = rng.getRan(1, 0, 2);
      hit(rng.getRan(4, 1, 8), DamageType.MAGIC);
      victim?.slow(6);
      victim?.poison(5 + r2, rng);
      break;
    }
    case Spell.AVATAR:
      livingSound(24);
      caster.spellNote(SpellNote.AVATAR);
      caster.avatar();
      break;
    case Spell.DIVINE_THUD:
      placeSpellPattern(session, SpellPat.RADIUS_2, target, {
        damage: {
          type: DamageType.MAGIC,
          dice: Math.min(29, Math.trunc((caster.getLevel() * 3) / 4) + 5),
        },
        whoHit: 7,
      });
      break;
    default:
      univ.addStringToBuf(
        `  Error: Priest spell ${spellName(spell)} not implemented for monsters.`);
      break;
  }
  return true;
}
