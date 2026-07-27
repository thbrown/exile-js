/**
 * Putting a new creature on the map — `find_clear_spot` and `place_monster`
 * (boe.monster.cpp:733 and 1116). Splitting monsters need both; summoning and
 * the wandering-monster spawns will use the same two.
 */

import { Location, locsEqual } from '../core/location';
import { Attitude } from '../data/monster';
import { defaultTownperson } from '../data/town';
import { FieldType } from '../data/fields';
import { Creature, CreatureStatus, assignCreature } from '../universe/creature';
import { SpellNote } from '../universe/living';
import { GameMode } from './modes';
import type { GameSession } from './session';

/**
 * find_clear_spot — up to 75 random tries at a square within two of
 * `fromWhere` that is on the map, unblocked, in line of sight, not underfoot
 * and (in combat) not on a PC. `mode` 1 insists on an *adjacent* square but
 * still returns a further one as a fallback, which is why the loop keeps
 * going after a near miss.
 *
 * Returns `{x: 0, y: 0}` when nothing was found — the C++ leaves `store_loc`
 * default-constructed and its callers test `x > 0`.
 *
 * TODO(M6): `is_summon_safe`, the anti-summoning squares a town can mark.
 */
export function findClearSpot(
  session: GameSession, fromWhere: Location, mode: number,
): Location {
  const rng = session.univ.rng;
  let storeLoc: Location = { x: 0, y: 0 };
  for (let tries = 0; tries < 75; tries++) {
    const loc = {
      x: fromWhere.x + rng.getRan(1, -2, 2),
      y: fromWhere.y + rng.getRan(1, -2, 2),
    };
    if (session.locOffActiveArea(loc)) continue;
    if (session.isBlocked(loc)) continue;
    // combat_obscurity, as the C++ passes (boe.monster.cpp:745): a creature
    // is never placed through a wall from the square it's summoned at.
    if (session.canSeeLight(fromWhere, loc, session.combatObscurity) !== 0) continue;
    if (session.mode === GameMode.COMBAT
      && session.univ.party.pcs.some((pc) => pc.isAlive && locsEqual(pc.combatPos, loc))) continue;
    if (session.inTown
      && loc.x === session.univ.party.townLoc.x
      && loc.y === session.univ.party.townLoc.y) continue;
    const adjacent = Math.abs(loc.x - fromWhere.x) <= 1 && Math.abs(loc.y - fromWhere.y) <= 1;
    if (mode === 0 || adjacent) return loc;
    storeLoc = loc;
  }
  return storeLoc;
}

/**
 * place_monster — drop monster type `which` on `where`, reusing the first
 * slot whose occupant is dead and isn't holding a special-encounter code.
 * Returns the slot, or the list length when there was no room (which is how
 * the C++ signals failure, so callers compare against `monsters.length`).
 *
 * Two oddities kept verbatim, both flagged as questionable in the C++ itself:
 * the template is re-assigned over the creature *after* `assign` has already
 * scaled it, which throws the difficulty adjustment away; and a monster whose
 * default attitude is friendly is forced hostile.
 */
export function placeMonster(
  session: GameSession, which: number, where: Location, forced = false,
): number {
  const univ = session.univ;
  const town = univ.town;
  if (!town) return 0;
  if (!forced && town.monsterAt(where)) return town.monsters.length;

  let i = 0;
  while (i < town.monsters.length
    && (town.monsters[i]!.isAlive || town.monsters[i]!.specEncCode > 0)) i++;

  // "10000 or more means an exported summon saved with the party."
  const template = which >= 10000
    ? univ.party.summons[which - 10000]
    : univ.scenario.scenMonsters[which];
  if (!template) return town.monsters.length;

  const preset = defaultTownperson();
  preset.number = which;
  preset.startLoc = { ...where };
  const c: Creature = assignCreature(
    i, preset, template, univ.party.easyMode, univ.difficultyAdjust());
  // "One effect is resetting max health to ignore difficulty_adjust()".
  c.maxHealth = template.health;
  c.health = c.maxHealth;
  c.attitude = template.defaultAttitude;
  if (c.isFriendly) c.attitude = Attitude.HOSTILE_A;
  c.mobile = true;
  c.active = CreatureStatus.ALERTED;
  c.curLoc = { ...where };
  c.summonTime = 0;
  c.target = 6;
  if (i < town.monsters.length) town.monsters[i] = c;
  else town.monsters.push(c);

  // A crate, a barrel or a blocked square gives way to the new arrival.
  town.setField(where.x, where.y, FieldType.OBJECT_CRATE, false);
  town.setField(where.x, where.y, FieldType.OBJECT_BARREL, false);
  town.setField(where.x, where.y, FieldType.OBJECT_BLOCK, false);
  return i;
}

/**
 * get_summon_monster (boe.monster.cpp:1210) — pick a random scenario monster
 * whose `summonType` matches the class asked for. Two hundred blind draws, so
 * a scenario with no monster of that class costs 200 RNG calls and then says
 * so; keep the count, since every later roll depends on it.
 */
export function getSummonMonster(session: GameSession, summonClass: number): number {
  const univ = session.univ;
  const monsters = univ.scenario.scenMonsters;
  for (let i = 0; i < 200; i++) {
    const j = univ.rng.getRan(1, 0, monsters.length - 1);
    if (monsters[j]?.summonType === summonClass) return j;
  }
  univ.addStringToBuf('  Summon failed.');
  return 0;
}

/**
 * summon_monster (boe.monster.cpp:1152) — put a summoned creature next to
 * `where` and give it an expiry.
 *
 * `where` means two different things, exactly as in the C++: in town, or while
 * the monsters are taking their turn, it is the *caster's* square and the
 * creature appears in a clear spot near it; in combat, when the party summons,
 * it is the square to use, and only a PC standing there sends it looking
 * elsewhere.
 */
export function summonMonster(
  session: GameSession,
  which: number,
  where: Location,
  duration: number,
  givenAttitude: Attitude,
  byParty: boolean,
  monstersGoing = false,
): boolean {
  const univ = session.univ;
  const town = univ.town;
  if (which <= 0 || !town) return false;

  let dest: Location;
  if (session.inTown || monstersGoing) {
    dest = findClearSpot(session, where, 0);
    if (dest.x === 0) return false;
  } else {
    let target = where;
    if (univ.party.pcs.some((pc) => pc.isAlive && locsEqual(pc.combatPos, target))) {
      target = findClearSpot(session, target, 0);
      if (target.x === 0) return false;
    }
    if (town.hasField(target.x, target.y, FieldType.OBJECT_BARREL)
      || town.hasField(target.x, target.y, FieldType.OBJECT_CRATE)
      || town.hasField(target.x, target.y, FieldType.OBJECT_BLOCK)) return false;
    dest = target;
  }

  const spot = placeMonster(session, which, dest);
  if (spot >= town.monsters.length) {
    // A long-lived summon complains about the crowd; a brief one goes quietly.
    if (duration < 100) univ.addStringToBuf('  Too many monsters.');
    return false;
  }

  const c = town.monsters[spot]!;
  c.attitude = givenAttitude;
  c.summonTime = duration;
  c.partySummoned = byParty;
  c.spellNote(SpellNote.SUMMONED);
  return true;
}
