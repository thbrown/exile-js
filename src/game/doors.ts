/**
 * Doors and locks — pick_lock and bash_door (boe.town.cpp:1156 and :1204),
 * plus the terrain-special cases that open a door when you walk into it.
 *
 * The RNG call order matters here: these are the first formulas in the port
 * that consume `get_ran`, and replays depend on the sequence, so the calls
 * stay exactly where the C++ makes them even when the result is unused.
 */

import { Location } from '../core/location';
import { ItemAbil, ItemType } from '../data/item';
import { TerSpec } from '../data/terrain';
import { Skill, Trait } from '../universe/skills';
import { Player } from '../universe/player';
import { Universe } from '../universe/universe';

/** skill_bonus (shop.cpp:43) — the stat bonus table, indexed by skill level. */
const SKILL_BONUS = [
  -3, -3, -2, -1, 0, 0, 1, 1, 1, 2,
  2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5,
];

/** cPlayer::stat_adj (pc.cpp:336), minus the equipment bonus. */
export function statAdj(pc: Player, which: Skill): number {
  let tr = SKILL_BONUS[Math.min(pc.skills[which] ?? 0, SKILL_BONUS.length - 1)] ?? 0;
  if (which === Skill.INTELLIGENCE && pc.traits[Trait.MAGICALLY_APT]) tr++;
  if (which === Skill.STRENGTH) {
    if (pc.traits[Trait.STRENGTH]) tr++;
    // TODO(M5): the Vahnatai strength penalty needs that race to be selectable.
  }
  // TODO(M3): BOOST_STAT equipment adds one here, once items can be equipped.
  return tr;
}

/** The first equipped item with the given ability, or null. */
function equippedWithAbility(pc: Player, abil: ItemAbil): { slot: number; strength: number } | null {
  for (let i = 0; i < pc.items.length; i++) {
    const item = pc.items[i]!;
    if (item.variety === ItemType.NO_ITEM) continue;
    if (item.ability !== abil) continue;
    return { slot: i, strength: item.abilStrength };
  }
  return null;
}

export type DoorResult = 'opened' | 'failed' | 'no-picks' | 'wrong-terrain';

/** pick_lock (boe.town.cpp:1156). */
export function pickLock(univ: Universe, where: Location, pcNum: number): DoorResult {
  const town = univ.town;
  if (!town) return 'wrong-terrain';
  const pc = univ.party.pcs[pcNum];
  if (!pc) return 'wrong-terrain';
  const terrain = town.record.terrain[where.x]![where.y]!;
  const picks = equippedWithAbility(pc, ItemAbil.LOCKPICKS);
  if (!picks) {
    univ.addStringToBuf('  Need lockpick equipped.');
    return 'no-picks';
  }

  let r1 = univ.rng.getRan(1, 1, 100) + picks.strength * 7;
  const willBreak = r1 < 75;

  r1 =
    univ.rng.getRan(1, 1, 100) -
    5 * statAdj(pc, Skill.DEXTERITY) +
    town.record.difficulty * 7 -
    5 * (pc.skills[Skill.LOCKPICKING] ?? 0) -
    picks.strength * 7;
  if (pc.traits[Trait.NIMBLE]) r1 -= 8;
  if (equippedWithAbility(pc, ItemAbil.THIEVING)) r1 -= 12;

  const unlockAdjust = univ.terrainType(terrain).flag2;
  if (unlockAdjust >= 5 || r1 > unlockAdjust * 15 + 30) {
    univ.addStringToBuf("  Didn't work.");
    if (willBreak) {
      univ.addStringToBuf('  Pick breaks.');
      // TODO(M3): removing a charge needs the inventory model.
    }
    return 'failed';
  }
  univ.addStringToBuf('  Door unlocked.');
  unlockDoor(univ, where, terrain);
  return 'opened';
}

/** bash_door (boe.town.cpp:1204). */
export function bashDoor(univ: Universe, where: Location, pcNum: number): DoorResult {
  const town = univ.town;
  if (!town) return 'wrong-terrain';
  const pc = univ.party.pcs[pcNum];
  if (!pc) return 'wrong-terrain';
  const terrain = town.record.terrain[where.x]![where.y]!;
  const spec = univ.terrainType(terrain);
  const r1 =
    univ.rng.getRan(1, 1, 100) - 15 * statAdj(pc, Skill.STRENGTH) + town.record.difficulty * 4;

  if (spec.special !== TerSpec.UNLOCKABLE) {
    univ.addStringToBuf('  Wrong terrain type.');
    return 'wrong-terrain';
  }

  const unlockAdjust = spec.flag2;
  if (unlockAdjust >= 5 || r1 > unlockAdjust * 15 + 40 || spec.flag3 !== 1) {
    univ.addStringToBuf("  Didn't work.");
    // A failed bash hurts: 1d4, unblockable.
    const hurt = univ.rng.getRan(1, 1, 4);
    pc.curHealth = Math.max(0, pc.curHealth - hurt);
    // TODO(M5): damage_pc also handles death, statuses and the damage animation.
    return 'failed';
  }
  univ.addStringToBuf('  Lock breaks.');
  unlockDoor(univ, where, terrain);
  return 'opened';
}

/**
 * Swap a locked door for its unlocked form and remember it, so re-entering the
 * town doesn't re-lock it (start_town_mode replays door_unlocked).
 */
function unlockDoor(univ: Universe, where: Location, terrain: number): void {
  const town = univ.town!;
  town.record.terrain[where.x]![where.y] = univ.terrainType(terrain).flag1;
  town.record.doorUnlocked.push({ ...where });
}
