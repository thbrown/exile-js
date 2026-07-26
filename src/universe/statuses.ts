/**
 * Applying status effects — iLiving::apply_status (living.cpp:18) and the
 * cPlayer wrappers that add a PC's protections and disadvantages on top
 * (pc.cpp:317 onward).
 *
 * TODO(M5): the get_prot_level reductions need the item-ability system, so a
 * PC's gear doesn't yet blunt these.
 */

import { Player } from './player';
import { MainStatus, Status, Trait, statusBounds } from './skills';

/** iLiving::apply_status. */
export function applyStatus(pc: Player, which: Status, howMuch: number): void {
  if (pc.mainStatus !== MainStatus.ALIVE) return;
  let [lo, hi] = statusBounds(which);
  // Sleep and dumbfounding don't wrap through zero.
  if (which === Status.ASLEEP || which === Status.DUMB) {
    if ((pc.status[which] ?? 0) < 0) hi = 0;
    else lo = 0;
  }
  pc.status[which] = Math.max(lo, Math.min(hi, (pc.status[which] ?? 0) + howMuch));
}

/** cPlayer::poison (pc.cpp:317) — the frail disadvantage makes it worse. */
export function poisonPc(pc: Player, howMuch: number, rollOne: () => number): string | null {
  if (pc.mainStatus !== MainStatus.ALIVE) return null;
  let amount = howMuch;
  if (pc.traits[Trait.FRAIL] && amount > 1) amount++;
  if (pc.traits[Trait.FRAIL] && amount === 1 && rollOne() === 0) amount++;
  if (amount <= 0) return null;
  applyStatus(pc, Status.POISON, amount);
  return `  ${pc.name} poisoned.`;
}

/** cPlayer::disease — chronic disease makes it worse. */
export function diseasePc(pc: Player, howMuch: number): string | null {
  if (pc.mainStatus !== MainStatus.ALIVE) return null;
  let amount = howMuch;
  if (pc.traits[Trait.CHRONIC_DISEASE] && amount > 0) amount++;
  if (amount <= 0) return null;
  applyStatus(pc, Status.DISEASE, amount);
  return `  ${pc.name} diseased.`;
}
