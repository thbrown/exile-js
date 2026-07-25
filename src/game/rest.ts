/**
 * Resting — do_rest (boe.actions.cpp:3288). Inns call it, and so will the Rest
 * command and the sleep terrain specials. Time passes, statuses clear, and the
 * party heals; the parts that need systems this port hasn't built are marked.
 */

import { ItemAbil } from '../data/item';
import { hasAbilEquip } from '../universe/inventory';
import { Player } from '../universe/player';
import { MainStatus, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';

/** cPlayer::heal (pc.cpp:128) — never past max, never below zero. */
export function healPc(pc: Player, amount: number): void {
  if (pc.mainStatus !== MainStatus.ALIVE) return;
  if (pc.curHealth >= pc.maxHealth) return;
  pc.curHealth = Math.max(0, Math.min(pc.maxHealth, pc.curHealth + amount));
}

/** cPlayer::restore_sp (pc.cpp:306). */
export function restorePcSp(pc: Player, amount: number): void {
  if (pc.mainStatus !== MainStatus.ALIVE) return;
  if (amount <= 0) return;
  if (pc.curSp >= pc.maxSp) return;
  pc.curSp = Math.max(0, Math.min(pc.maxSp, pc.curSp + amount));
}

/**
 * do_rest — advance the clock by `length` ticks and restore the party.
 *
 * TODO(M5): handle_disease runs three times first, and apply_status feeds the
 * OCCASIONAL_STATUS item effects.
 * TODO(M6): special_increase_age ticks the scenario's timers.
 */
export function doRest(
  univ: Universe, length: number, hpRestore: number, spRestore: number, isOutdoors = false,
): void {
  const ageBefore = univ.party.age;
  univ.party.age += length;

  // Resting clears every timed status, on the party and on each PC.
  for (const pc of univ.party.pcs) pc.status.fill(0);

  // Plants regrow and magic shops restock every 4000 ticks.
  if (length > 4000 || Math.floor(ageBefore / 4000) < Math.floor(univ.party.age / 4000))
    univ.refreshStoreItems();

  for (const pc of univ.party.pcs) {
    healPc(pc, hpRestore);
    restorePcSp(pc, spRestore);
  }

  for (const pc of univ.party.pcs) {
    if (pc.mainStatus !== MainStatus.ALIVE) continue;
    if (pc.traits[Trait.RECUPERATION] && pc.curHealth < pc.maxHealth)
      healPc(pc, Math.trunc(hpRestore / 5));
    // TODO(M5): CHRONIC_DISEASE has a 1-in-111 chance of a bout here.
    if (pc.traits[Trait.CHRONIC_DISEASE]) univ.rng.getRan(1, 0, 110);

    // Regeneration gear tops the PC up — outdoors it only fires sometimes, but
    // when it does it counts for four times as much.
    const regen = hasAbilEquip(pc, ItemAbil.REGENERATE);
    if (regen && pc.curHealth < pc.maxHealth
      && (!isOutdoors || univ.rng.getRan(1, 0, 10) === 5)) {
      const strength = Math.trunc(regen.item.abilStrength / 3);
      let j = univ.rng.getRan(1, 0, strength);
      if (strength === 0) j = univ.rng.getRan(1, 0, 1);
      if (isOutdoors) j *= 4;
      healPc(pc, j);
    }
    // Bonus SP and HP wear off with the rest.
    if (pc.curSp > pc.maxSp) pc.curSp = pc.maxSp;
    if (pc.curHealth > pc.maxHealth) pc.curHealth = pc.maxHealth;
  }
}
