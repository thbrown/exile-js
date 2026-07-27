/**
 * `process_fields` (boe.combat.cpp:5099) — what the fields lying on the ground
 * do once a turn, which is the half of the field system `fieldEffects.ts`
 * doesn't cover.
 *
 * `place_spell_pattern` puts a wall of fire down and burns whoever it lands on;
 * this is what happens on every turn *after* that: the fire keeps burning, the
 * quickfire spreads, the clouds curse and sleep whoever is standing in them,
 * webs catch monsters, force cages tick down and are broken out of, and each
 * field rolls to see whether it has finally gone out.
 *
 * ## Who the damage comes from
 *
 * The C++ steers `hit_space`'s attribution with two globals, `processing_fields`
 * and `monsters_going`, which decide whether a hurt monster blames a PC, the
 * party as a whole, or another monster. This port passes that as an argument
 * instead — the rest of the combat code already does the same (`whoHit: 7` in
 * `monsterTurn.ts`), and a global that has to be set and unset around a call is
 * exactly the kind of thing that goes wrong quietly.
 *
 * Worth knowing while reading the C++: inside `process_fields` both globals are
 * dead letters. Every call there goes through `hit_pcs_in_space`, which adds 10
 * to `hit_all` and so turns monster-hitting *off* — monsters take their field
 * damage from `monst_inflict_fields` instead. The flags only matter to other
 * callers of `hit_space`.
 */

import { Location } from '../core/location';
import { FieldType } from '../data/fields';
import { DamageType } from '../data/monster';
import { MonstAbil } from '../data/monsterAbility';
import { TerSpec } from '../data/terrain';
import { Creature } from '../universe/creature';
import { Living, SpellNote, livingSound } from '../universe/living';
import { Player } from '../universe/player';
import { MainStatus, Race, Skill, Status } from '../universe/skills';
import { Universe } from '../universe/universe';
import { damageMonst, damagePc, hitParty } from './damage';
import { breakForceCage, scloudSpace, sleepCloudSpace } from './fieldEffects';
import { isCombat } from './modes';
import type { GameSession } from './session';

/**
 * `univ.cur_pc`'s stand-ins in the `who_hit` argument: 6 is "the whole party",
 * which is what field damage counts as, and 7 is "another monster".
 */
export const WHO_HIT_PARTY = 6;
export const WHO_HIT_MONSTER = 7;

/**
 * `cUniverse::get_target_i` (universe.cpp:1122) — the index `process_force_cage`
 * takes: a PC is their slot, a monster is 100 + its slot, and -1 is nobody.
 */
function targetIndexOf(univ: Universe, who: Living | null): number {
  if (who instanceof Player) return univ.party.pcs.indexOf(who);
  if (who instanceof Creature) {
    const at = univ.town?.monsters.indexOf(who) ?? -1;
    return at < 0 ? -1 : at + 100;
  }
  return -1;
}

/** `cUniverse::target_there` — the PC on a square first, then the creature. */
function targetThere(univ: Universe, where: Location): Living | null {
  for (const pc of univ.party.pcs) {
    const at = pc.getLoc();
    if (pc.isAlive && at.x === where.x && at.y === where.y) return pc;
  }
  return univ.town?.monsterAt(where) ?? null;
}

/**
 * `hit_space` (boe.combat.cpp:4315) — everything standing on a square takes
 * `dam`.
 *
 * `hitAll` is the C++'s packed flag: 0 nails only the top thing in the space, 1
 * hits everyone in it, and +10 on top of either means "leave the monsters out
 * of it". `whoHit` is who gets blamed for any monster that dies (see the note
 * at the top of this file).
 */
export function hitSpace(
  session: GameSession,
  target: Location,
  dam: number,
  damType: DamageType,
  report: number,
  hitAll: number,
  whoHit: number,
): void {
  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  // The C++ bounds-checks against the 64x64 maximum rather than the town's own
  // size, and so does this.
  if (target.x < 0 || target.x > 63 || target.y < 0 || target.y > 63) return;

  let hitMonsters = true;
  if (hitAll >= 10) {
    hitMonsters = false;
    hitAll -= 10;
  }

  // An antimagic field swallows the three magical damage types outright — no
  // save, no message. Weapon and poison damage go through it.
  if (town.hasField(target.x, target.y, FieldType.FIELD_ANTIMAGIC)
    && (damType === DamageType.FIRE || damType === DamageType.MAGIC
      || damType === DamageType.COLD)) return;

  if (dam <= 0) {
    univ.addStringToBuf('  No damage.');
    return;
  }

  // `stop_hitting` is what makes hitAll 0 mean "the top thing only": the first
  // victim sets it and everyone behind them is skipped.
  let stopHitting = false;
  for (const monst of town.monsters) {
    if (!hitMonsters || stopHitting) break;
    if (!monst.isAlive || !monst.onSpace(target)) continue;
    damageMonst(univ, monst, whoHit, dam, damType, { session });
    stopHitting = hitAll !== 1;
  }

  if (isCombat(session.mode)) {
    for (const pc of univ.party.pcs) {
      if (stopHitting) break;
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      if (pc.combatPos.x !== target.x || pc.combatPos.y !== target.y) continue;
      damagePc(univ, pc, dam, damType, Race.UNKNOWN);
      stopHitting = hitAll !== 1;
    }
  } else {
    const at = univ.party.townLoc;
    if (at.x === target.x && at.y === target.y) {
      // `fast_bang` only shortens the explosion animation, which this port
      // doesn't block on anyway.
      hitParty(univ, dam, damType);
      stopHitting = hitAll !== 1;
    }
  }

  if (report === 1 && hitAll === 0 && !stopHitting) univ.addStringToBuf('  Missed.');
}

/**
 * `hit_pcs_in_space` (:4307) — the same, with the monsters left alone. That is
 * the whole of the difference: it adds 10 to `hit_all`.
 */
export function hitPcsInSpace(
  session: GameSession,
  target: Location,
  dam: number,
  damType: DamageType,
  report: number,
  hitAll: number,
): void {
  hitSpace(session, target, dam, damType, report, 10 + hitAll, WHO_HIT_PARTY);
}

/** move_to_zero — one step toward 0 from either side. */
function moveToZero(value: number): number {
  if (value > 0) return value - 1;
  if (value < 0) return value + 1;
  return 0;
}

/**
 * How long a force cage holds someone who walks into one, from
 * `sync_force_cages`' table. Indexed by a d10, so the short sentences are much
 * the likelier.
 */
const FC_MULTIPLIERS = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4];

/**
 * `sync_force_cages` (:1751) — keep the cage barriers and the FORCECAGE status
 * agreeing with each other.
 *
 * The status is the real state; the barrier on the map is drawn from it. So
 * anyone still caged re-asserts their barrier, and anyone standing on a barrier
 * without the status has just walked into it and gets caged.
 *
 * Returns whether anything changed, which is what tells the caller to redraw.
 */
export function syncForceCages(session: GameSession): boolean {
  const { univ } = session;
  const town = univ.town;
  if (!town) return false;
  let changed = false;

  const sync = (who: Player | Creature): void => {
    const at = who.getLoc();
    if ((who.status[Status.FORCECAGE] ?? 0) > 0) {
      changed = true;
      town.setField(at.x, at.y, FieldType.BARRIER_CAGE, true);
    } else if (town.hasField(at.x, at.y, FieldType.BARRIER_CAGE)
      && (who.status[Status.FORCECAGE] ?? 0) === 0) {
      changed = true;
      who.status[Status.FORCECAGE] =
        univ.rng.getRan(2, 2, 7) * FC_MULTIPLIERS[univ.rng.getRan(1, 1, 10) - 1]!;
    }
  };

  for (const pc of univ.party.pcs) sync(pc);
  for (const monst of town.monsters) sync(monst);
  return changed;
}

/**
 * `process_force_cage` (:5059) — a cage ticks down, and whoever is inside rolls
 * to break out.
 *
 * `who` is `get_target_i`'s encoding. The C++ comment on the PC branch is worth
 * keeping in mind: everyone must have *some* chance of breaking out, because a
 * cage never expires on its own and being stuck in one stops you ending combat.
 * An empty cage is the exception — it rolls 1 in 1000 and can stand for a very
 * long time.
 */
export function processForceCage(
  session: GameSession, loc: Location, who: number, adjust = 0,
): void {
  const { univ } = session;
  const town = univ.town;
  if (!town || !town.hasField(loc.x, loc.y, FieldType.BARRIER_CAGE)) return;

  if (who >= 100) {
    const monst = town.monsters[who - 100];
    if (!monst) return;
    monst.status[Status.FORCECAGE] = moveToZero(monst.status[Status.FORCECAGE] ?? 0);
    if (monst.status[Status.FORCECAGE] === 0) {
      univ.addStringToBuf('  Force cage flickers out.');
      breakForceCage(session, loc);
      return;
    }
    if (!monst.isFriendly
      && univ.rng.getRan(1, 1, 100) < monst.mon.mu * 10 + monst.mon.cl * 4 + 5 + adjust) {
      // The C++ notes this sound is not the right one, and keeps it.
      livingSound(60);
      monst.spellNote(SpellNote.BREAKS_FORCECAGE);
      breakForceCage(session, loc);
    }
    return;
  }

  if (who < 0) {
    if (univ.rng.getRan(1, 1, 1000) === 1) breakForceCage(session, loc);
    return;
  }

  if (who < 6) {
    const pc = univ.party.pcs[who];
    if (!pc) return;
    pc.status[Status.FORCECAGE] = moveToZero(pc.status[Status.FORCECAGE] ?? 0);
    if (pc.status[Status.FORCECAGE] === 0) {
      univ.addStringToBuf('  Force cage flickers out.');
      breakForceCage(session, loc);
      return;
    }
    const bonus = 5 + pc.skill(Skill.MAGE_LORE) + adjust;
    const odds = pc.skill(Skill.MAGE_SPELLS) * 10 + pc.skill(Skill.PRIEST_SPELLS) * 4 + bonus;
    if (univ.rng.getRan(1, 1, 100) < odds) {
      livingSound(60);
      univ.addStringToBuf(`  ${pc.name} breaks force cage.`);
      breakForceCage(session, loc);
    }
  }
}

/**
 * `monst_inflict_fields` (boe.monster.cpp:802) — a monster pays for the ground
 * it is standing on, and flattens any crate or barrel it is standing on.
 *
 * Two quirks are carried over verbatim. First, every field arm ends in a
 * `break`, so a monster only ever suffers the *first* field on its square, in
 * the order written here — the C++ has a TODO wondering about that. Second, the
 * RADIATE check is inverted from what it reads like: a monster is only hurt by
 * a field if it radiates *some other* field. A monster that radiates nothing at
 * all walks through walls of blades untouched. Quickfire is the exception that
 * always burns.
 */
export function monstInflictFields(session: GameSession, monst: Creature): void {
  const { univ } = session;
  const town = univ.town;
  if (!town || !monst.isAlive) return;

  const radiate = monst.mon.abil[MonstAbil.RADIATE];
  const haveRadiate = radiate?.active ?? false;
  const radiateType = radiate?.radiate?.type;
  /** The C++'s `have_radiate && which_radiate != X`. */
  const hurtBy = (field: FieldType): boolean => haveRadiate && radiateType !== field;

  outer:
  for (let i = 0; i < monst.xWidth; i++) {
    for (let j = 0; j < monst.yWidth; j++) {
      if (!monst.isAlive) break outer;
      const at = { x: monst.curLoc.x + i, y: monst.curLoc.y + j };
      const has = (field: FieldType): boolean => town.hasField(at.x, at.y, field);

      if (has(FieldType.FIELD_QUICKFIRE)) {
        damageMonst(univ, monst, WHO_HIT_MONSTER, univ.rng.getRan(2, 1, 8),
          DamageType.FIRE, { session });
        break outer;
      }
      if (has(FieldType.WALL_BLADES)) {
        const r1 = univ.rng.getRan(6, 1, 8);
        if (hurtBy(FieldType.WALL_BLADES)) {
          damageMonst(univ, monst, WHO_HIT_MONSTER, r1, DamageType.WEAPON, { session });
        }
        break outer;
      }
      if (has(FieldType.WALL_FORCE)) {
        const r1 = univ.rng.getRan(3, 1, 6);
        if (hurtBy(FieldType.WALL_FORCE)) {
          damageMonst(univ, monst, WHO_HIT_MONSTER, r1, DamageType.MAGIC, { session });
        }
        break outer;
      }
      if (has(FieldType.CLOUD_SLEEP)) {
        if (hurtBy(FieldType.CLOUD_SLEEP)) monst.sleep(Status.ASLEEP, 3, 0, univ.rng);
        break outer;
      }
      if (has(FieldType.WALL_ICE)) {
        const r1 = univ.rng.getRan(3, 1, 6);
        if (hurtBy(FieldType.WALL_ICE)) {
          damageMonst(univ, monst, WHO_HIT_MONSTER, r1, DamageType.COLD, { session });
        }
        break outer;
      }
      if (has(FieldType.CLOUD_STINK)) {
        const r1 = univ.rng.getRan(1, 2, 3);
        if (hurtBy(FieldType.CLOUD_STINK)) monst.curse(r1);
        break outer;
      }
      // A web catches anything but a bug, and is used up doing it — the only
      // field here that clears itself.
      if (has(FieldType.FIELD_WEB) && monst.mon.race !== Race.BUG) {
        monst.spellNote(SpellNote.WEBBED);
        monst.web(univ.rng.getRan(1, 2, 3));
        town.setField(at.x, at.y, FieldType.FIELD_WEB, false);
        break outer;
      }
      if (has(FieldType.WALL_FIRE)) {
        const r1 = univ.rng.getRan(2, 1, 6);
        if (hurtBy(FieldType.WALL_FIRE)) {
          damageMonst(univ, monst, WHO_HIT_MONSTER, r1, DamageType.FIRE, { session });
        }
        break outer;
      }
      // The cage is the one arm with no `break` — it falls through to the next
      // square of a big monster.
      if (has(FieldType.BARRIER_CAGE)) {
        processForceCage(session, at, targetIndexOf(univ, monst));
      }
    }
  }

  // Whatever is left of it walks through crates and barrels, spilling what they
  // held, and burns on a fire barrier.
  if (!monst.isAlive) return;
  for (let i = 0; i < monst.xWidth; i++) {
    for (let j = 0; j < monst.yWidth; j++) {
      const at = { x: monst.curLoc.x + i, y: monst.curLoc.y + j };
      if (town.hasField(at.x, at.y, FieldType.OBJECT_CRATE)
        || town.hasField(at.x, at.y, FieldType.OBJECT_BARREL)) {
        for (const item of town.items) {
          if (item.variety === 0 || !item.contained) continue;
          if (item.itemLoc.x === at.x && item.itemLoc.y === at.y) {
            item.contained = false;
            item.held = false;
          }
        }
      }
      town.setField(at.x, at.y, FieldType.OBJECT_CRATE, false);
      town.setField(at.x, at.y, FieldType.OBJECT_BARREL, false);
      if (town.hasField(at.x, at.y, FieldType.BARRIER_FIRE)) {
        damageMonst(univ, monst, WHO_HIT_MONSTER, univ.rng.getRan(2, 1, 10),
          DamageType.FIRE, { session });
      }
    }
  }
}

/**
 * The quickfire spread (:5108). Quickfire creeps outwards one square a turn —
 * four times a turn in combat, since a combat turn is a quarter of a town one.
 *
 * The two-pass shape matters: the first pass marks the neighbours of every
 * burning square in a scratch grid, the second turns the marks into fire. Doing
 * it in one pass would let this turn's new fire spread again in the same turn
 * and race across the map.
 */
function spreadQuickfire(session: GameSession): void {
  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const rect = town.record.inTownRect;
  const dim = town.record.maxDim;

  // 2 is "already burning", 1 is "catches this pass". Only >0 matters after.
  const qf: number[][] = Array.from({ length: dim }, (_, x) =>
    Array.from({ length: dim }, (_, y) =>
      (town.hasField(x, y, FieldType.FIELD_QUICKFIRE) ? 2 : 0)));

  for (let k = 0; k < (isCombat(session.mode) ? 4 : 1); k++) {
    for (let i = rect.left + 1; i < rect.right; i++) {
      for (let j = rect.top + 1; j < rect.bottom; j++) {
        if (!town.hasField(i, j, FieldType.FIELD_QUICKFIRE)) continue;
        // Seven times in eight it reaches; the eighth it stalls this turn.
        if (univ.rng.getRan(1, 1, 8) !== 1) {
          qf[i - 1]![j] = 1;
          qf[i + 1]![j] = 1;
          qf[i]![j + 1] = 1;
          qf[i]![j - 1] = 1;
        }
      }
    }
    for (let i = rect.left + 1; i < rect.right; i++) {
      for (let j = rect.top + 1; j < rect.bottom; j++) {
        if ((qf[i]![j] ?? 0) <= 0) continue;
        const ter = town.record.terrain[i]![j]!;
        const info = univ.terrainType(ter);
        if (info.special === TerSpec.CRUMBLING && info.flag2 > 0) {
          // The C++ has a TODO saying this is probably the wrong sound. Kept.
          livingSound(60);
          town.record.terrain[i]![j] = info.flag1;
          univ.addStringToBuf('  Quickfire burns through barrier.');
        }
        town.setField(i, j, FieldType.FIELD_QUICKFIRE, true);
      }
    }
  }
}

/**
 * `process_fields` (:5099) — the whole end-of-turn field pass. Outdoors there
 * are no fields, so it does nothing at all.
 */
export function processFields(session: GameSession): void {
  const { univ } = session;
  const town = univ.town;
  if (!town || session.isOutdoors) return;

  if (town.quickfirePresent) spreadQuickfire(session);

  for (const monst of town.monsters) {
    if (monst.isAlive) monstInflictFields(session, monst);
  }

  syncForceCages(session);

  const dim = town.record.maxDim;
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      const at = { x: i, y: j };
      const has = (field: FieldType): boolean => town.hasField(i, j, field);

      // Each wall hurts whoever stands in it, then rolls to go out. Note the
      // damage is rolled *before* the expiry roll in every case, so the call
      // order of get_ran is the one the C++ has.
      if (has(FieldType.WALL_FORCE)) {
        hitPcsInSpace(session, at, univ.rng.getRan(3, 1, 6), DamageType.MAGIC, 1, 1);
        if (univ.rng.getRan(1, 1, 6) === 2) {
          town.setField(i, j, FieldType.WALL_FORCE, false);
        }
      }
      if (has(FieldType.WALL_FIRE)) {
        hitPcsInSpace(session, at, univ.rng.getRan(2, 1, 6) + 1, DamageType.FIRE, 1, 1);
        if (univ.rng.getRan(1, 1, 4) === 2) {
          town.setField(i, j, FieldType.WALL_FIRE, false);
        }
      }
      // Antimagic does nothing but sit there and thin out.
      if (has(FieldType.FIELD_ANTIMAGIC) && univ.rng.getRan(1, 1, 8) === 2) {
        town.setField(i, j, FieldType.FIELD_ANTIMAGIC, false);
      }
      // The two clouds either disperse or act — never both in a turn.
      if (has(FieldType.CLOUD_STINK)) {
        if (univ.rng.getRan(1, 1, 4) === 2) town.setField(i, j, FieldType.CLOUD_STINK, false);
        else scloudSpace(session, at);
      }
      if (has(FieldType.CLOUD_SLEEP)) {
        if (univ.rng.getRan(1, 1, 4) === 2) town.setField(i, j, FieldType.CLOUD_SLEEP, false);
        else sleepCloudSpace(session, at);
      }
      if (has(FieldType.WALL_ICE)) {
        hitPcsInSpace(session, at, univ.rng.getRan(3, 1, 6), DamageType.COLD, 1, 1);
        if (univ.rng.getRan(1, 1, 6) === 1) {
          town.setField(i, j, FieldType.WALL_ICE, false);
        }
      }
      if (has(FieldType.WALL_BLADES)) {
        hitPcsInSpace(session, at, univ.rng.getRan(6, 1, 8), DamageType.WEAPON, 1, 1);
        if (univ.rng.getRan(1, 1, 5) === 1) {
          town.setField(i, j, FieldType.WALL_BLADES, false);
        }
      }
      if (has(FieldType.BARRIER_CAGE)) {
        let who = targetIndexOf(univ, targetThere(univ, at));
        processForceCage(session, at, who);
        // Having caught one PC, check the rest, since out of combat the whole
        // party shares a square. `loc` moves to each PC in turn, exactly as the
        // C++ does — which means for a monster (who >= 100) the loop condition
        // fails immediately and nothing more happens.
        let loc = at;
        while (++who > 0 && who < 6 && town.hasField(loc.x, loc.y, FieldType.BARRIER_CAGE)) {
          loc = univ.party.pcs[who]!.getLoc();
          processForceCage(session, loc, who);
        }
      }
    }
  }

  // Quickfire burns last, and burns everyone — it is the one field that gets
  // its own pass over the map.
  if (town.quickfirePresent) {
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        if (!town.hasField(i, j, FieldType.FIELD_QUICKFIRE)) continue;
        hitPcsInSpace(session, { x: i, y: j }, univ.rng.getRan(2, 1, 8), DamageType.FIRE, 1, 1);
      }
    }
  }
}
