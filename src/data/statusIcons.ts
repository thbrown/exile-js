/**
 * `status_info` (damage.cpp:13) — which icon in staticons.png stands for each
 * status effect, and at what strength.
 *
 * A status can show one of three icons: `icon` when it's positive, `negIcon`
 * when it's negative (a blessing and a curse are the same status with opposite
 * signs), and `special` when the value falls in a named band — poison is the
 * only one that uses it, switching to a nastier icon from level 4 up.
 *
 * `-1` means "nothing to draw", which is how a status with no negative side
 * says it has none.
 */

import { Status } from '../universe/skills';

export interface StatusIcon {
  /** Shown while the status is positive. */
  icon: number;
  /** Shown while it is negative; -1 for statuses that are never negative. */
  negIcon: number;
  /** Overrides both inside `[lo, hi]`. */
  special?: { icon: number; lo: number; hi: number };
}

const MAX = Number.MAX_SAFE_INTEGER;

/** Indexed by `Status`, in the enum's order — the C++ array is too. */
export const STATUS_ICONS: Partial<Record<Status, StatusIcon>> = {
  [Status.POISONED_WEAPON]: { icon: 4, negIcon: -1 },
  [Status.BLESS_CURSE]: { icon: 2, negIcon: 3 },
  [Status.POISON]: { icon: 0, negIcon: -1, special: { icon: 1, lo: 4, hi: MAX } },
  // The C++ has a third "normal speed" icon (7) here, commented out. Left out.
  [Status.HASTE_SLOW]: { icon: 6, negIcon: 8 },
  [Status.INVULNERABLE]: { icon: 5, negIcon: -1 },
  [Status.MAGIC_RESISTANCE]: { icon: 9, negIcon: 19 },
  [Status.WEBS]: { icon: 10, negIcon: -1 },
  [Status.DISEASE]: { icon: 11, negIcon: -1 },
  [Status.INVISIBLE]: { icon: 12, negIcon: -1 },
  [Status.DUMB]: { icon: 13, negIcon: 18 },
  [Status.MARTYRS_SHIELD]: { icon: 14, negIcon: -1 },
  [Status.ASLEEP]: { icon: 15, negIcon: 21 },
  [Status.PARALYZED]: { icon: 16, negIcon: -1 },
  [Status.ACID]: { icon: 17, negIcon: -1 },
  [Status.FORCECAGE]: { icon: 20, negIcon: -1 },
  [Status.CHARM]: { icon: 22, negIcon: -1 },
};

/** Which icon a status shows at `value`, or -1 for none. */
export function statusIconFor(which: Status, value: number): number {
  const info = STATUS_ICONS[which];
  if (!info) return -1;
  if (info.special && value >= info.special.lo && value <= info.special.hi) {
    return info.special.icon;
  }
  if (value > 0) return info.icon;
  if (value < 0) return info.negIcon;
  return -1;
}

/**
 * What each status is called, taken from the character editor's status list
 * (pc.graphics.cpp:492), which is the only place the C++ spells them out.
 *
 * The signed statuses read as two different conditions depending on which way
 * they point — a blessing and a curse, haste and slow, dumbfounding and
 * enlightenment — so each carries both names.
 */
export const STATUS_NAMES: Partial<Record<Status, { pos: string; neg?: string }>> = {
  [Status.POISONED_WEAPON]: { pos: 'Poisoned Weap.' },
  [Status.BLESS_CURSE]: { pos: 'Blessed', neg: 'Cursed' },
  [Status.POISON]: { pos: 'Poisoned' },
  [Status.HASTE_SLOW]: { pos: 'Hasted', neg: 'Slowed' },
  [Status.INVULNERABLE]: { pos: 'Invulnerable' },
  [Status.MAGIC_RESISTANCE]: { pos: 'Magic Resistant', neg: 'Magic Vulnerable' },
  [Status.WEBS]: { pos: 'Webbed' },
  [Status.DISEASE]: { pos: 'Diseased' },
  [Status.INVISIBLE]: { pos: 'Sanctuary' },
  [Status.DUMB]: { pos: 'Dumbfounded', neg: 'Enlightened' },
  [Status.MARTYRS_SHIELD]: { pos: "Martyr's Shield" },
  [Status.ASLEEP]: { pos: 'Asleep', neg: 'Hyperactive' },
  [Status.PARALYZED]: { pos: 'Paralyzed' },
  [Status.ACID]: { pos: 'Acid' },
  [Status.FORCECAGE]: { pos: 'Forcecage' },
  [Status.CHARM]: { pos: 'Charmed' },
};

/** How a status reads at `value`, or null when it isn't in effect. */
export function statusName(which: Status, value: number): string | null {
  const names = STATUS_NAMES[which];
  if (!names || value === 0) return null;
  if (value > 0) return names.pos;
  return names.neg ?? null;
}

/**
 * get_stat_effect_rect (boe.text.cpp:637) — where icon `code` sits in
 * staticons.png. Three 12×12 icons to a row.
 */
export function statIconRect(code: number): { left: number; top: number } {
  return { left: 12 * (code % 3), top: 12 * Math.trunc(code / 3) };
}
