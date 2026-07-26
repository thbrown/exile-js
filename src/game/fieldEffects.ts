/**
 * Putting a field on a square and taking one off — the small helpers
 * `place_spell_pattern` and the scripting opcodes both lean on.
 *
 * Each of these does two things: it sets (or clears) the field, and it applies
 * whatever the field does to whoever is standing there *right now*. The
 * ongoing effect — walking into a wall of fire next turn — is `process_fields`,
 * which is separate.
 */

import { Location } from '../core/location';
import { FieldType } from '../data/fields';
import { TerSpec } from '../data/terrain';
import { livingSound } from '../universe/living';
import { Player } from '../universe/player';
import { MainStatus, Status } from '../universe/skills';
import { isCombat } from './modes';
import type { GameSession } from './session';

/**
 * Everyone the field lands on. In combat that is whoever's `combatPos` is the
 * square; out of combat the party occupies one square together, so a field on
 * it catches all six.
 *
 * The C++ writes this out inline in each of the three `*_space` helpers, and
 * they don't agree with each other: `web_space` checks `main_status == ALIVE`
 * in combat but not in town, `scloud_space` checks it in both, and
 * `sleep_cloud_space` puts the whole party to sleep in town without looking.
 * `aliveOnly` keeps each caller's own rule.
 */
function pcsOn(session: GameSession, where: Location, aliveOnly: boolean): Player[] {
  const { univ } = session;
  if (isCombat(session.mode)) {
    return univ.party.pcs.filter((pc) =>
      pc.mainStatus === MainStatus.ALIVE
      && pc.combatPos.x === where.x && pc.combatPos.y === where.y);
  }
  if (univ.party.townLoc.x !== where.x || univ.party.townLoc.y !== where.y) return [];
  return aliveOnly
    ? univ.party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE)
    : univ.party.pcs;
}

/** web_space (boe.combat.cpp:5253) — a web lands, and catches who is in it. */
export function webSpace(session: GameSession, where: Location): void {
  session.univ.town?.setField(where.x, where.y, FieldType.FIELD_WEB, true);
  // In town the C++ skips the alive check, so a dead PC is webbed too. Kept.
  for (const pc of pcsOn(session, where, false)) pc.web(3);
}

/** scloud_space (:5231) — a stinking cloud, which curses whoever breathes it. */
export function scloudSpace(session: GameSession, where: Location): void {
  const { univ } = session;
  univ.town?.setField(where.x, where.y, FieldType.CLOUD_STINK, true);
  for (const pc of pcsOn(session, where, true)) pc.curse(univ.rng.getRan(1, 1, 2));
}

/** sleep_cloud_space (:5269) — a sleep cloud, and everyone in it drops. */
export function sleepCloudSpace(session: GameSession, where: Location): void {
  const { univ } = session;
  univ.town?.setField(where.x, where.y, FieldType.CLOUD_SLEEP, true);
  for (const pc of pcsOn(session, where, false)) {
    pc.sleep(Status.ASLEEP, 3, 0, univ.rng);
  }
}

/**
 * break_force_cage (:5047) — the cage comes down and lets go of whoever it
 * held, PC or monster.
 */
export function breakForceCage(session: GameSession, where: Location): void {
  const { univ } = session;
  for (const pc of univ.party.pcs) {
    const at = pc.getLoc();
    if (at.x === where.x && at.y === where.y) pc.status[Status.FORCECAGE] = 0;
  }
  for (const m of univ.town?.monsters ?? []) {
    if (m.curLoc.x === where.x && m.curLoc.y === where.y) m.status[Status.FORCECAGE] = 0;
  }
  univ.town?.setField(where.x, where.y, FieldType.BARRIER_CAGE, false);
}

/**
 * dispel_fields (boe.party.cpp:1562) — clear a square, mostly.
 *
 * Fire walls, force walls and stinking clouds always go. Everything else gets
 * a saving roll — at **mode 0** the spell version, where a web usually
 * survives and an ice wall usually doesn't.
 *
 * `mode >= 1` sets the adjustment to **-10**, which no roll can recover from,
 * so every one of those conditions passes and the square is swept clean. That
 * is the *stronger* dispel, and it is the one the scripting opcodes use. The
 * six rolls still happen either way, so the RNG sequence matches.
 *
 * mode 2 additionally clears the barriers, crates and barrels up front —
 * things the rolls never touch at all.
 */
export function dispelFields(session: GameSession, where: Location, mode: number): void {
  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const { x, y } = where;
  const set = (which: FieldType, on: boolean): void => town.setField(x, y, which, on);

  if (mode === 2) {
    set(FieldType.BARRIER_FIRE, false);
    set(FieldType.BARRIER_FORCE, false);
    set(FieldType.OBJECT_BARREL, false);
    set(FieldType.OBJECT_CRATE, false);
    set(FieldType.FIELD_WEB, false);
  }
  const adj = mode >= 1 ? -10 : mode;

  set(FieldType.WALL_FIRE, false);
  set(FieldType.WALL_FORCE, false);
  set(FieldType.CLOUD_STINK, false);
  if (univ.rng.getRan(1, 1, 6) + adj <= 1) set(FieldType.FIELD_WEB, false);
  if (univ.rng.getRan(1, 1, 6) + adj < 6) set(FieldType.WALL_ICE, false);
  if (univ.rng.getRan(1, 1, 6) + adj < 5) set(FieldType.CLOUD_SLEEP, false);
  if (univ.rng.getRan(1, 1, 8) + adj <= 1) set(FieldType.FIELD_QUICKFIRE, false);
  if (univ.rng.getRan(1, 1, 7) + adj < 5) set(FieldType.WALL_BLADES, false);
  if (univ.rng.getRan(1, 1, 12) + adj < 3) breakForceCage(session, where);
}

/**
 * crumble_wall (boe.party.cpp:1482) — a CRUMBLING terrain turns into whatever
 * `flag1` names. `flag2 >= 2` marks a wall too solid to smash.
 */
export function crumbleWall(session: GameSession, where: Location): void {
  const { univ } = session;
  const town = univ.town;
  if (!town || !town.isOnMap(where.x, where.y)) return;
  const ter = town.record.terrain[where.x]![where.y]!;
  const info = univ.terrainType(ter);
  if (info.special !== TerSpec.CRUMBLING || info.flag2 >= 2) return;
  // The C++ notes this is probably the wrong sound, and keeps it anyway.
  livingSound(60);
  town.record.terrain[where.x]![where.y] = info.flag1;
  univ.addStringToBuf('  Barrier crumbles.');
}
