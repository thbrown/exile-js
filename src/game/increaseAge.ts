/**
 * `increase_age`'s upkeep (boe.actions.cpp:3358) — everything that happens to
 * the party *because time passed*, rather than because they did something.
 *
 * This is what makes a status effect an effect at all. Without it a swamp
 * poisons you, prints that it poisoned you, and then nothing ever comes of it:
 * `status[POISON]` sits there and no turn ever spends it. Same for disease,
 * acid, the slow gain of health and spell points, and blessings wearing off.
 *
 * **The tick rates are the whole design.** Outdoors a turn is a long way, so
 * poison bites every 50 turns and you heal every 100; in town both are much
 * more frequent. `party.age % n === 0` is the test, so the *phase* matters as
 * well as the rate — don't "simplify" these into counters.
 *
 * Not ported here (each is another milestone): `push_things`, `dump_gold` and
 * the autosave that eating triggers.
 */

import { DamageType } from '../data/monster';
import { ItemAbil } from '../data/item';
import { hasAbilEquip } from '../universe/inventory';
import { Player } from '../universe/player';
import { MainStatus, PartyStatus, Race, Status, Trait } from '../universe/skills';
import { Party } from '../universe/party';
import { damagePc, hitParty } from './damage';
import { drainPc } from './itemUse';
import { GameMode } from './modes';
import type { GameSession } from './session';

/** move_to_zero — step a status one notch toward 0, from either side. */
function moveToZero(pc: Player, which: Status): void {
  const v = pc.status[which] ?? 0;
  if (v > 0) pc.status[which] = v - 1;
  else if (v < 0) pc.status[which] = v + 1;
}

/** The same, for one of the four whole-party effects. */
function partyMoveToZero(party: Party, which: PartyStatus): void {
  const v = party.partyStatus[which];
  if (v > 0) party.partyStatus[which] = v - 1;
  else if (v < 0) party.partyStatus[which] = v + 1;
}

/**
 * take_food (boe.items.cpp:82) — eat `amount` rations and report how many
 * there weren't. The larder is emptied rather than going negative.
 */
export function takeFood(party: Party, amount: number): number {
  const shortfall = amount - party.food;
  if (shortfall > 0) {
    party.food = 0;
    return shortfall;
  }
  party.food -= amount;
  return 0;
}

function livePcs(session: GameSession): Player[] {
  return session.univ.party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE);
}

/**
 * do_poison (boe.combat.cpp:4365) — poison bites everyone carrying it, then
 * usually fades by one.
 */
export async function doPoison(session: GameSession): Promise<void> {
  const { univ } = session;
  const poisoned = livePcs(session).filter((pc) => (pc.status[Status.POISON] ?? 0) > 0);
  if (poisoned.length === 0) return;
  univ.addStringToBuf('Poison:');
  for (const pc of poisoned) {
    const r1 = univ.rng.getRan(pc.status[Status.POISON] ?? 0, 1, 6);
    await damagePc(univ, pc, r1, DamageType.POISON, Race.UNKNOWN);
    if (univ.rng.getRan(1, 0, 8) < 6) moveToZero(pc, Status.POISON);
    // The C++ asks the same question twice and only the second one checks the
    // trait, so a hardy PC shakes poison off about twice as fast. Its own
    // comment wonders whether the two conditions were meant to be swapped;
    // they weren't swapped, so neither are they here.
    if (univ.rng.getRan(1, 0, 8) < 6 && pc.traits[Trait.GOOD_CONST]) {
      moveToZero(pc, Status.POISON);
    }
  }
}

/**
 * handle_disease (boe.combat.cpp:4393) — disease rolls a different misery for
 * each sufferer every time it fires.
 */
export function handleDisease(session: GameSession): void {
  const { univ } = session;
  const sick = livePcs(session).filter((pc) => (pc.status[Status.DISEASE] ?? 0) > 0);
  if (sick.length === 0) return;
  univ.addStringToBuf('Disease:');
  for (const pc of sick) {
    const roll = univ.rng.getRan(1, 1, 10);
    switch (roll) {
      case 1: case 2: pc.poison(2, univ.rng); break;
      case 3: case 4: pc.slow(2); break;
      // Roll 5 is `drain_pc(pc, 5)` — five experience, and nothing else; it
      // takes no level. This arm used to print "unaffected", which is what
      // rolls 9 and 10 do.
      case 5: drainPc(pc, 5); break;
      case 6: case 7: pc.curse(3); break;
      case 8: pc.dumbfound(3, univ.rng); break;
      default: univ.addStringToBuf(`  ${pc.name} unaffected.`); break;
    }
    let r1 = univ.rng.getRan(1, 0, 7);
    if (pc.traits[Trait.GOOD_CONST]) r1 -= 2;
    if (r1 <= 0 || hasAbilEquip(pc, ItemAbil.STATUS_PROTECTION, Status.DISEASE)) {
      moveToZero(pc, Status.DISEASE);
    }
  }
}

/**
 * handle_acid (boe.combat.cpp:4435) — acid burns every turn, not on a clock,
 * and always fades by one afterwards.
 */
export async function handleAcid(session: GameSession): Promise<void> {
  const { univ } = session;
  const burning = livePcs(session).filter((pc) => (pc.status[Status.ACID] ?? 0) > 0);
  if (burning.length === 0) return;
  univ.addStringToBuf('Acid:');
  for (const pc of burning) {
    const r1 = univ.rng.getRan(pc.status[Status.ACID] ?? 0, 1, 6);
    await damagePc(univ, pc, r1, DamageType.ACID, Race.UNKNOWN);
    moveToZero(pc, Status.ACID);
  }
}

/**
 * The status/healing half of increase_age, run once per party turn. `mode` is
 * asked rather than `worldIsTown` because the rates key off MODE_OUTDOORS and
 * MODE_TOWN specifically — during combat none of this happens, which is why a
 * long fight doesn't heal anyone.
 */
export async function increaseAgeEffects(session: GameSession): Promise<void> {
  const { univ } = session;
  const { party } = univ;
  const outdoors = session.mode === GameMode.OUTDOORS;
  const town = session.mode === GameMode.TOWN;
  if (!outdoors && !town) return;
  const age = party.age;

  // --- Food ------------------------------------------------------------------
  // "Food" (boe.actions.cpp:3467): every thousandth turn the party eats, one
  // ration per living PC. `take_food` empties the larder and reports the
  // shortfall; anyone it couldn't feed starves the *whole party* for
  // `get_ran(3,1,6)`, which is the C++'s own broad brush — the damage isn't
  // per hungry PC.
  //
  // The C++ runs this **before** poison, disease and acid, and this port keeps
  // that order because all four consume the RNG. (The blocks that don't —
  // the party's spell effects and the protections — sit at the end of this
  // function rather than the start, which is a reordering that predates this
  // and can't move the sequence.)
  if (age % 1000 === 0) {
    const mouths = party.pcs.filter((pc) => pc.mainStatus === MainStatus.ALIVE).length;
    const shortfall = takeFood(party, mouths);
    if (shortfall > 0) {
      univ.addStringToBuf('Starving!');
      session.sound?.play(66);
      await hitParty(univ, univ.rng.getRan(3, 1, 6), DamageType.SPECIAL);
    } else {
      session.sound?.play(6);
      univ.addStringToBuf('You eat.');
      // TODO(M7): `try_auto_save("Eat")` — eating is the C++'s autosave point.
    }
  }

  // --- Poison, disease, acid ------------------------------------------------
  if (party.pcs.some((pc) => (pc.status[Status.POISON] ?? 0) > 0)) {
    if ((outdoors && age % 50 === 0) || (town && age % 20 === 0)) await doPoison(session);
  }
  if (party.pcs.some((pc) => (pc.status[Status.DISEASE] ?? 0) > 0)) {
    if ((outdoors && age % 100 === 0) || (town && age % 25 === 0)) handleDisease(session);
  }
  // Acid has no clock: it burns every single turn.
  if (party.pcs.some((pc) => (pc.status[Status.ACID] ?? 0) > 0)) await handleAcid(session);

  // --- Health ---------------------------------------------------------------
  if (outdoors) {
    if (age % 100 === 0) for (const pc of party.pcs) pc.heal(2);
  } else if (age % 50 === 0) {
    // Bonus health above the maximum wears off one point at a time.
    for (const pc of party.pcs) {
      if (pc.mainStatus === MainStatus.ALIVE && pc.curHealth > pc.maxHealth) pc.curHealth--;
    }
    for (const pc of party.pcs) pc.heal(1);
  }

  // --- Spell points, and enlightenment wearing off --------------------------
  if (outdoors) {
    if (age % 80 === 0) {
      for (const pc of party.pcs) pc.restoreSp(2);
      for (const pc of party.pcs) {
        if ((pc.status[Status.DUMB] ?? 0) < 0) pc.status[Status.DUMB]!++;
      }
    }
  } else if (age % 40 === 0) {
    for (const pc of party.pcs) {
      if (pc.mainStatus === MainStatus.ALIVE && pc.curSp > pc.maxSp) pc.curSp--;
      if ((pc.status[Status.DUMB] ?? 0) < 0) pc.status[Status.DUMB]!++;
    }
    for (const pc of party.pcs) pc.restoreSp(1);
  }

  // --- The two constitution traits ------------------------------------------
  for (const pc of livePcs(session)) {
    if (pc.traits[Trait.RECUPERATION] && univ.rng.getRan(1, 0, 10) === 1
      && pc.curHealth < pc.maxHealth) pc.heal(2);
    if (pc.traits[Trait.CHRONIC_DISEASE] && univ.rng.getRan(1, 0, 110) === 1) {
      pc.disease(4, univ.rng);
    }
  }

  // --- The party's own spell effects wearing off ----------------------------
  // increase_age's first block (boe.actions.cpp:3374): each is a countdown,
  // and each says so on the turn it runs out. FLIGHT's "you plummet to your
  // deaths" is not ported — flight over impassable ground needs the terrain
  // check the C++ does against the *outdoor* map. TODO(M6).
  if (party.partyStatus[PartyStatus.STEALTH] === 1) {
    univ.addStringToBuf('Your footsteps grow louder.');
  }
  partyMoveToZero(party, PartyStatus.STEALTH);
  if (party.partyStatus[PartyStatus.DETECT_LIFE] === 1) {
    univ.addStringToBuf('You stop detecting monsters.');
  }
  partyMoveToZero(party, PartyStatus.DETECT_LIFE);
  if (party.partyStatus[PartyStatus.FIREWALK] === 1) {
    univ.addStringToBuf('Your feet stop glowing.');
  }
  partyMoveToZero(party, PartyStatus.FIREWALK);
  if (party.partyStatus[PartyStatus.FLIGHT] === 2) {
    univ.addStringToBuf('You are starting to descend.');
  }
  if (party.partyStatus[PartyStatus.FLIGHT] === 1) {
    univ.addStringToBuf('  You land safely.');
  }
  partyMoveToZero(party, PartyStatus.FLIGHT);

  // --- The protections wearing off ------------------------------------------
  // "Protection, etc." (boe.actions.cpp:3451). Every one of these is decayed
  // **every turn**, in town and outdoors alike; this port decayed them only
  // during a combat round (`combat_run_monst`), which is why Resist Magic cast
  // in a fight was still up long after it, out on the road.
  //
  // The `if` is the C++'s, brace-for-brace: it guards only the *first*
  // `move_to_zero`, so on the turn any one of these six is about to expire,
  // INVULNERABLE is decayed twice. Kept, quirk and all.
  for (const pc of party.pcs) {
    const s = (which: Status): number => pc.status[which] ?? 0;
    if (s(Status.INVULNERABLE) === 1 || Math.abs(s(Status.MAGIC_RESISTANCE)) === 1
      || s(Status.INVISIBLE) === 1 || s(Status.MARTYRS_SHIELD) === 1
      || Math.abs(s(Status.ASLEEP)) === 1 || s(Status.PARALYZED) === 1) {
      moveToZero(pc, Status.INVULNERABLE);
    }
    moveToZero(pc, Status.INVULNERABLE);
    moveToZero(pc, Status.MAGIC_RESISTANCE);
    moveToZero(pc, Status.INVISIBLE);
    moveToZero(pc, Status.MARTYRS_SHIELD);
    moveToZero(pc, Status.ASLEEP);
    moveToZero(pc, Status.PARALYZED);
    if (age % 40 === 0 && s(Status.POISONED_WEAPON) > 0) {
      moveToZero(pc, Status.POISONED_WEAPON);
    }
  }

  // --- Blessing, haste and slow burning down; regeneration -------------------
  if (age % 4 === 0) {
    for (const pc of party.pcs) {
      moveToZero(pc, Status.BLESS_CURSE);
      moveToZero(pc, Status.HASTE_SLOW);
      const item = hasAbilEquip(pc, ItemAbil.REGENERATE);
      if (!item) continue;
      if (pc.curHealth >= pc.maxHealth) continue;
      // Outdoors regeneration fires rarely but heals four times as much, so it
      // works out about the same over a journey.
      if (outdoors && univ.rng.getRan(1, 0, 10) !== 5) continue;
      const step = Math.trunc(item.item.abilStrength / 3);
      let j = step === 0 ? univ.rng.getRan(1, 0, 1) : univ.rng.getRan(1, 0, step);
      if (outdoors) j *= 4;
      pc.heal(j);
    }
  }
}
