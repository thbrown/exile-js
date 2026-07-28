/**
 * The soul crystal — `record_monst` (boe.monster.cpp:1084), `has_trapped_monst`
 * and `pick_trapped_monst` (boe.party.cpp:2444/2450).
 *
 * Capture Soul puts a monster's *type* into one of four slots on the party;
 * Simulacrum summons a copy of whatever is in a slot. The crystal holds a
 * monster number, not the creature that was caught, so catching a wounded one
 * still gives you a fresh one later.
 */

import { Race } from '../universe/skills';
import { CHARM_ODDS, Creature } from '../universe/creature';
import { MonstAbil } from '../data/monsterAbility';
import { SpellNote, livingSound } from '../universe/living';
import { Party } from '../universe/party';
import { Universe } from '../universe/universe';

/** has_trapped_monst — whether Simulacrum has anything to draw on. */
export function hasTrappedMonst(party: Party): boolean {
  return party.imprisonedMonst.some((which) => which !== 0);
}

/** One filled slot, for the host's `soul-crystal.xml` picker. */
export interface TrappedMonst {
  slot: number;
  which: number;
  name: string;
  level: number;
}

/**
 * The occupied slots and what they hold — the list `pick_trapped_monst` shows.
 * A number of 10000 or more indexes the party's own summon list, as everywhere
 * else.
 */
export function trappedMonsters(univ: Universe): TrappedMonst[] {
  const out: TrappedMonst[] = [];
  univ.party.imprisonedMonst.forEach((which, slot) => {
    if (which === 0) return;
    const mon = which >= 10000
      ? univ.party.summons[which - 10000]
      : univ.scenario.scenMonsters[which];
    if (!mon) return;
    out.push({ slot, which, name: mon.name, level: mon.level });
  });
  return out;
}

/**
 * record_monst — try to catch a monster's soul. `forced` (a special node
 * asking for it) skips the saving throw entirely.
 *
 * Three ways to fail, and the middle one is the interesting one: the roll is
 * `get_ran(1,1,100) * 7 / 10` against `charm_odds[level / 2]`, the same table
 * charm and sleep use, so anything much above level 14 cannot be caught at all.
 * A monster that splits, or one the scenario marked IMPORTANT, is never caught.
 */
export function recordMonst(univ: Universe, monst: Creature, forced = false): void {
  let r1 = univ.rng.getRan(1, 1, 100);
  r1 = Math.trunc((r1 * 7) / 10);
  if (forced) r1 = 0;

  if (monst.xWidth > 1 || monst.yWidth > 1) {
    univ.addStringToBuf('Capture Soul: Monster is too big.');
    return;
  }
  const odds = CHARM_ODDS[Math.trunc(monst.mon.level / 2)] ?? 0;
  if (r1 > odds || monst.mon.abil[MonstAbil.SPLITS]?.active || monst.mon.race === Race.IMPORTANT) {
    monst.spellNote(SpellNote.RESISTS);
    livingSound(68);
    return;
  }

  monst.spellNote(SpellNote.RECORDED);
  // The slot is rolled, not searched for: a busy crystal rolls once for an
  // empty slot and, failing that, overwrites one of the first four at random.
  // (The list *is* four long, so the second roll is the same range as the
  // first — the C++ writes `get_ran(1,0,3)` there rather than reusing the
  // size.)
  let slot = univ.rng.getRan(1, 0, univ.party.imprisonedMonst.length - 1);
  if (univ.party.imprisonedMonst[slot] !== 0) slot = univ.rng.getRan(1, 0, 3);
  univ.party.imprisonedMonst[slot] = monst.number;
  univ.addStringToBuf('Capture Soul: Success!');
  univ.addStringToBuf(`  Caught in slot ${slot + 1}.`);
  livingSound(53);
}

/** The AFFECT_SOUL_CRYSTAL node's "release" arm: empty every slot holding it. */
export function releaseMonst(party: Party, which: number): void {
  party.imprisonedMonst.forEach((held, i) => {
    if (held === which) party.imprisonedMonst[i] = 0;
  });
}
