/**
 * `put_quest_info` (boe.infodlg.cpp:686) — the Info button on the Quests page,
 * running on the real `quest-info.xml`.
 *
 * Its companion `put_spec_item_info` (:703) is a `cStrDlog` rather than an XML
 * definition, so it goes through the plain message dialog in main.ts.
 */

import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** Fill quest-info.xml from one quest and the party's record of it. */
export function questInfoDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe, which: number,
): XmlDialog {
  const quest = univ.scenario.quests[which]!;
  const dlg = new XmlDialog(ctx, store, getDialogDef('quest-info'));
  dlg.setText('name', quest.name);
  dlg.setText('descr', quest.descr);
  const start = univ.party.activeQuests.get(which)?.start ?? 0;
  dlg.setText('start', `Day ${start}`);
  // A relative deadline counts from the day the quest was taken; an absolute
  // one is a day of the scenario.
  dlg.setText('chop', quest.deadline > 0
    ? `Day ${quest.deadline + (quest.deadlineIsRelative ? start : 0)}`
    : 'None');
  dlg.setText('pay', quest.gold > 0 ? `${quest.gold} gold` : 'Unknown');
  return dlg;
}
