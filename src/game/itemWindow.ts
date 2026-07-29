/**
 * The item window's three kinds of page — `set_stat_window` (boe.text.cpp:564)
 * and the list it builds.
 *
 * The panel on the middle right normally shows one PC's pack, but it has two
 * other pages: the special (quest) items the party is carrying, and the quests
 * themselves. Both are driven by `spec_item_array`, a list of *which* entries
 * are worth showing, built fresh each time the page is opened — the C++ keeps
 * it as a global beside `stat_window`, and it is what the row buttons index.
 */

import { QuestStatus } from '../data/quest';
import { NUM_INVEN_SLOTS } from '../universe/player';
import { MainStatus } from '../universe/skills';
import { Universe } from '../universe/universe';

/** eItemWinMode (boe.consts.hpp:143). Values 0-5 are the six PCs. */
export enum ItemWinMode {
  PC1 = 0,
  PC2 = 1,
  PC3 = 2,
  PC4 = 3,
  PC5 = 4,
  PC6 = 5,
  SPECIAL = 6,
  QUESTS = 7,
}

/** The item pane shows eight rows at a time (LINES_IN_ITEM_WIN). */
export const LINES_IN_ITEM_WIN = 8;

/**
 * A quest's entry in `spec_item_array` carries its status in the ten-thousands
 * digit: the quest number alone for a started one, +10000 completed, +20000
 * failed. The drawing code reads it back out with `/ 10000` and `% 10000`.
 */
export const QUEST_COMPLETED_OFFSET = 10000;
export const QUEST_FAILED_OFFSET = 20000;

/** `first_active_pc` (boe.text.cpp:614) — the first PC still standing, or 0. */
export function firstActivePc(univ: Universe): number {
  for (let i = 0; i < 6; i++)
    if (univ.party.pcs[i]?.mainStatus === MainStatus.ALIVE) return i;
  return 0;
}

/**
 * The state `set_stat_window` owns: which page is up, the list behind it, and
 * where the scrollbar sits. The C++ has these as three globals (`stat_window`,
 * `spec_item_array`, `item_sbar`); one object keeps them in step.
 */
export class ItemWindow {
  mode: ItemWinMode = ItemWinMode.PC1;

  /** Which entries the current page is showing; empty on a PC's own page. */
  specItemArray: number[] = [];

  /** The scrollbar's position and maximum, mirrored from the widget. */
  scroll = 0;
  scrollMax = 0;

  /** Which PC's pack is showing, whatever page is up. */
  get pcPage(): number {
    return this.mode < ItemWinMode.SPECIAL ? this.mode : ItemWinMode.PC1;
  }

  /**
   * `set_stat_window` (boe.text.cpp:564). Asking for a dead PC's page quietly
   * gives you the first living one instead.
   */
  setStatWindow(univ: Universe, newStat: ItemWinMode): void {
    this.mode = newStat;
    if (this.mode < ItemWinMode.SPECIAL
      && univ.party.pcs[this.mode]?.mainStatus !== MainStatus.ALIVE)
      this.mode = firstActivePc(univ) as ItemWinMode;

    this.specItemArray = [];
    let arrayPos = 0;
    switch (this.mode) {
      case ItemWinMode.SPECIAL:
        for (let i = 0; i < univ.scenario.specialItems.length; i++)
          if (univ.party.specItems.has(i)) {
            this.specItemArray.push(i);
            arrayPos++;
          }
        this.scrollMax = Math.max(0, arrayPos - LINES_IN_ITEM_WIN);
        break;
      case ItemWinMode.QUESTS:
        for (let i = 0; i < univ.scenario.quests.length; i++) {
          // An absent record reads as AVAILABLE, which shows nothing — see the
          // note on `active_quests` in specialIncreaseAge.ts.
          const status = univ.party.activeQuests.get(i)?.status ?? QuestStatus.AVAILABLE;
          if (status === QuestStatus.STARTED) this.specItemArray.push(i);
          else if (status === QuestStatus.COMPLETED)
            this.specItemArray.push(i + QUEST_COMPLETED_OFFSET);
          else if (status === QuestStatus.FAILED)
            this.specItemArray.push(i + QUEST_FAILED_OFFSET);
          else continue;
          arrayPos++;
        }
        this.scrollMax = Math.max(0, arrayPos - LINES_IN_ITEM_WIN);
        break;
      default:
        this.scrollMax = NUM_INVEN_SLOTS - LINES_IN_ITEM_WIN;
        break;
    }
    this.scroll = 0;
  }

  /** `set_stat_window_for_pc` (:558) — the PC number, clamped to the party. */
  setStatWindowForPc(univ: Universe, pc: number): void {
    const which = Math.max(0, Math.min(5, pc));
    this.setStatWindow(univ, which as ItemWinMode);
  }
}
