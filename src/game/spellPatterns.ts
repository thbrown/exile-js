/**
 * `place_spell_pattern` (boe.combat.cpp:3956) — laying a 9×9 pattern over the
 * map: raising walls and barriers, dropping clouds, and hurting whatever is
 * standing in the way.
 *
 * This is what turns a fireball into an explosion, an exploding arrow into a
 * blast, and a monster's RADIATE ability into the cloud it drags around.
 *
 * The C++'s nine overloads collapse into one function here: what varies is the
 * `unsigned short` *code* written into every non-zero cell, and there are only
 * three ways to make one —
 * - nothing at all (code 0), leaving the pattern's own cells alone;
 * - a field type, which is its own small number;
 * - a damage type and a dice count, encoded as `50 + type * 40 + dice`.
 *
 * The order of operations is load-bearing and the C++ says so: **build the
 * barriers first, then inflict the damage**, so a wall of force raised under a
 * monster is already there when the same call comes to hurt it.
 */

import { Location, dist } from '../core/location';
import { FieldType } from '../data/fields';
import { DamageType } from '../data/monster';
import {
  EffectPattern, SpellPat, copyPattern, getBuiltinPattern,
} from '../data/pattern';
import { MonstAbil } from '../data/monsterAbility';
import { Race, Status } from '../universe/skills';
import { damageMonst, damagePc } from './damage';
import {
  crumbleWall, dispelFields, scloudSpace, sleepCloudSpace, webSpace,
} from './fieldEffects';
import { isCombat } from './modes';
import type { GameSession } from './session';

/** modify_pattern — stamp `code` over every cell of the shape. */
export function modifyPattern(pat: EffectPattern, code: number): void {
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 9; j++)
      if (pat[i]![j]! > 0) pat[i]![j] = code;
}

/**
 * The damage overload's encoding: `50 + type * 40 + dice`, with the dice count
 * clamped to 1..30. MARKED is not a real damage type and the C++ bails on it.
 */
export function damageCode(type: DamageType, dice: number): number | null {
  if (type === DamageType.MARKED) return null;
  return 50 + type * 40 + Math.max(1, Math.min(30, dice));
}

/** Decode a cell back into a damage type and dice, or null if it isn't one. */
function decodeDamage(effect: number): { type: DamageType; dice: number } | null {
  if (effect < 50) return null;
  const dice = (effect - 50) % 40;
  // Anything above 400, or with more than 30 dice, decodes as MARKED — which
  // is the C++'s way of saying "not damage", and 0xffff lands here.
  if (dice > 30 || effect > 400) return null;
  return { type: Math.trunc((effect - 50) / 40) as DamageType, dice };
}

const minmax = (lo: number, hi: number, v: number): number => Math.max(lo, Math.min(hi, v));

export interface PatternOptions {
  /** Overwrite the shape with this field type. */
  field?: FieldType;
  /** Overwrite the shape with this damage type and dice count. */
  damage?: { type: DamageType; dice: number };
  /** Which PC gets the credit for a kill (`who_hit`). */
  whoHit?: number;
  /** Rotation, for the one rotatable builtin (PAT_WALL). */
  rot?: number;
}

/** The `eSpellPat` overloads — look the shape up, then place it. */
export function placeSpellPattern(
  session: GameSession, pat: SpellPat, center: Location, options?: PatternOptions,
): Promise<void>;
/** The `effect_pat_type` overloads — place a grid that is already in hand. */
export function placeSpellPattern(
  session: GameSession, pat: EffectPattern, center: Location, options?: PatternOptions,
): Promise<void>;
export async function placeSpellPattern(
  session: GameSession,
  pat: SpellPat | EffectPattern,
  center: Location,
  options: PatternOptions = {},
): Promise<void> {
  const grid = copyPattern(
    typeof pat === 'number' ? getBuiltinPattern(pat, options.rot ?? 0) : pat);

  let code = 0;
  if (options.damage) {
    const encoded = damageCode(options.damage.type, options.damage.dice);
    if (encoded === null) return; // MARKED: not valid, do nothing
    code = encoded;
  } else if (options.field !== undefined) {
    code = options.field;
  }
  if (code !== 0) modifyPattern(grid, code);

  await placeGrid(session, grid, center, options.whoHit ?? 0);
}

async function placeGrid(
  session: GameSession, pat: EffectPattern, center: Location, whoHit: number,
): Promise<void> {
  const { univ } = session;
  const town = univ.town;
  if (!town) return;
  const maxDim = town.record.maxDim;
  const cell = (x: number, y: number): number => pat[x - center.x + 4]![y - center.y + 4]!;

  // Eliminate barriers that can't be seen. Note this walks the *town rect*
  // inset by one, not the whole map, so the outermost ring is never culled.
  const active = town.record.inTownRect;
  for (let i = minmax(active.left + 1, active.right - 1, center.x - 4);
    i <= minmax(active.left + 1, active.right - 1, center.x + 4); i++)
    for (let j = minmax(active.top + 1, active.bottom - 1, center.y - 4);
      j <= minmax(active.top + 1, active.bottom - 1, center.y + 4); j++) {
      if (session.canSeeLight(center, { x: i, y: j }) === 5) {
        pat[i - center.x + 4]![j - center.y + 4] = 0;
      }
    }

  // --- First the barriers themselves ---------------------------------------
  for (let i = minmax(0, maxDim - 1, center.x - 4); i <= minmax(0, maxDim - 1, center.x + 4); i++)
    for (let j = minmax(0, maxDim - 1, center.y - 4); j <= minmax(0, maxDim - 1, center.y + 4); j++) {
      const effect = cell(i, j);
      // A smash goes through regardless; everything else needs a clear line.
      if (effect !== FieldType.FIELD_SMASH && session.sightObscurity(i, j) >= 5) continue;
      const at = { x: i, y: j };
      switch (effect as FieldType) {
        case FieldType.FIELD_WEB: webSpace(session, at); break;
        case FieldType.CLOUD_STINK: scloudSpace(session, at); break;
        case FieldType.CLOUD_SLEEP: sleepCloudSpace(session, at); break;
        case FieldType.FIELD_DISPEL: dispelFields(session, at, 0); break;
        case FieldType.FIELD_SMASH: crumbleWall(session, at); break;
        case FieldType.BARRIER_FIRE:
        case FieldType.BARRIER_FORCE:
        case FieldType.BARRIER_CAGE:
        case FieldType.WALL_FORCE:
        case FieldType.WALL_FIRE:
        case FieldType.WALL_ICE:
        case FieldType.WALL_BLADES:
        case FieldType.FIELD_ANTIMAGIC:
        case FieldType.FIELD_QUICKFIRE:
        case FieldType.OBJECT_CRATE:
        case FieldType.OBJECT_BARREL:
        case FieldType.OBJECT_BLOCK:
        case FieldType.SFX_SMALL_BLOOD:
        case FieldType.SFX_MEDIUM_BLOOD:
        case FieldType.SFX_LARGE_BLOOD:
        case FieldType.SFX_SMALL_SLIME:
        case FieldType.SFX_LARGE_SLIME:
        case FieldType.SFX_ASH:
        case FieldType.SFX_BONES:
        case FieldType.SFX_RUBBLE:
          town.setField(i, j, effect, true);
          break;
        // SPECIAL_EXPLORED / SPECIAL_SPOT / SPECIAL_ROAD aren't placeable, and
        // a damage code or a bare 0xffff isn't a field at all.
        default:
          break;
      }
    }

  // --- Then the damage, to the party --------------------------------------
  for (const pc of univ.party.pcs) {
    if (!pc.isAlive) continue;
    for (let i = minmax(0, maxDim - 1, center.x - 4); i <= minmax(0, maxDim - 1, center.x + 4); i++)
      for (let j = minmax(0, maxDim - 1, center.y - 4); j <= minmax(0, maxDim - 1, center.y + 4); j++) {
        if (session.sightObscurity(i, j) >= 5) continue;
        // The C++ asks combat_pos in combat and town_loc in town, and nothing
        // at all outdoors — not `get_loc`, whose combat position can be stale.
        const at = isCombat(session.mode) ? pc.combatPos : univ.party.townLoc;
        if (at.x !== i || at.y !== j) continue;
        const effect = cell(i, j);
        const dam = decodeDamage(effect);
        if (dam) {
          await damagePc(univ, pc, univ.rng.getRan(dam.dice, 1, 6), dam.type, Race.UNKNOWN);
          continue;
        }
        if (effect >= 50) continue; // a code that decoded as MARKED: nothing
        switch (effect as FieldType) {
          case FieldType.WALL_FORCE:
            await damagePc(univ, pc, univ.rng.getRan(2, 1, 6), DamageType.MAGIC, Race.UNKNOWN);
            break;
          case FieldType.WALL_FIRE:
            await damagePc(univ, pc, univ.rng.getRan(1, 1, 6) + 1, DamageType.FIRE, Race.UNKNOWN);
            break;
          case FieldType.WALL_ICE:
            await damagePc(univ, pc, univ.rng.getRan(2, 1, 6), DamageType.COLD, Race.UNKNOWN);
            break;
          case FieldType.WALL_BLADES:
            await damagePc(univ, pc, univ.rng.getRan(4, 1, 8), DamageType.WEAPON, Race.UNKNOWN);
            break;
          case FieldType.OBJECT_BLOCK:
            await damagePc(univ, pc, univ.rng.getRan(6, 1, 8), DamageType.WEAPON, Race.UNKNOWN);
            break;
          default:
            break;
        }
      }
  }

  // --- And to the monsters -------------------------------------------------
  for (const monst of town.monsters) {
    if (!monst.isAlive) continue;
    if (dist(center, monst.curLoc) > 5) continue;
    // `monster_hit` stops at the first square of a multi-tile monster that the
    // pattern touches, so a big creature is hurt once, not once per square.
    let monsterHit = false;
    for (let i = minmax(0, maxDim - 1, center.x - 4); i <= minmax(0, maxDim - 1, center.x + 4); i++)
      for (let j = minmax(0, maxDim - 1, center.y - 4); j <= minmax(0, maxDim - 1, center.y + 4); j++) {
        if (monsterHit) continue;
        if (session.sightObscurity(i, j) >= 5) continue;
        if (!monst.onSpace({ x: i, y: j })) continue;
        const effect = cell(i, j);
        if (effect > 0) monsterHit = true;
        // A creature is immune to the field it radiates.
        const radiate = monst.mon.abil[MonstAbil.RADIATE];
        if (radiate?.active && effect === radiate.radiate.type) continue;

        const dam = decodeDamage(effect);
        if (dam) {
          await damageMonst(univ, monst, whoHit, univ.rng.getRan(dam.dice, 1, 6), dam.type, { session });
          continue;
        }
        if (effect >= 50) continue;
        switch (effect as FieldType) {
          case FieldType.FIELD_WEB: monst.web(3); break;
          case FieldType.WALL_FORCE:
            await damageMonst(
              univ, monst, whoHit, univ.rng.getRan(3, 1, 6), DamageType.MAGIC, { session });
            break;
          case FieldType.WALL_FIRE:
            await damageMonst(
              univ, monst, whoHit, univ.rng.getRan(2, 1, 6), DamageType.FIRE, { session });
            break;
          case FieldType.WALL_ICE:
            await damageMonst(
              univ, monst, whoHit, univ.rng.getRan(3, 1, 6), DamageType.COLD, { session });
            break;
          case FieldType.WALL_BLADES:
            await damageMonst(
              univ, monst, whoHit, univ.rng.getRan(6, 1, 8), DamageType.WEAPON, { session });
            break;
          case FieldType.OBJECT_BLOCK:
            await damageMonst(
              univ, monst, whoHit, univ.rng.getRan(6, 1, 8), DamageType.WEAPON, { session });
            break;
          case FieldType.CLOUD_STINK: monst.curse(univ.rng.getRan(1, 1, 2)); break;
          case FieldType.CLOUD_SLEEP: monst.sleep(Status.ASLEEP, 3, 0, univ.rng); break;
          case FieldType.BARRIER_CAGE:
            monst.status[Status.FORCECAGE] = Math.max(8, monst.status[Status.FORCECAGE] ?? 0);
            break;
          default:
            break;
        }
      }
  }
}
