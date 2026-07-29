/**
 * The job board — `show_job_bank` and `fill_job_bank` (boe.dlgutil.cpp:794/770)
 * running on `job-board.xml`.
 *
 * The rules live in `game/jobBank.ts`; this is only the screen. Four offers
 * down the page, a Take beside each, the day along the top and the dispatcher's
 * mood along the bottom. Taking one refills the slot from the board's spares
 * and rewrites the page in place.
 *
 * *The two mismatches in the C++, ported to the file that actually exists*:
 * `show_job_bank` asks for a dialog named `job-bank` (the shipped file is
 * `job-board.xml`) and writes its mood into a control named `prompt` (that
 * file's field is `feedback`). This uses the real file and the real names.
 */

import { JobBank } from '../data/quest';
import { dispatcherMood, jobBoardOffers, takeJob } from '../game/jobBank';
import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** How many of the board's six slots the dialog has room for. */
const SHOWN_SLOTS = 4;

/** fill_job_bank — the day, the four offers, and which Take buttons exist. */
export function fillJobBank(dlg: XmlDialog, univ: Universe, bank: JobBank): void {
  dlg.setNum('day', univ.party.calcDay());
  const offers = jobBoardOffers(univ, bank);
  for (let i = 0; i < SHOWN_SLOTS; i++) {
    const offer = offers.find((o) => o.slot === i);
    if (offer) {
      dlg.show(`take${i + 1}`);
      dlg.setText(`job${i + 1}`, offer.text);
    } else {
      dlg.hide(`take${i + 1}`);
      dlg.setText(`job${i + 1}`, '');
    }
  }
}

export function jobBoardDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  univ: Universe, bank: JobBank, personality: number,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('job-board'));
  fillJobBank(dlg, univ, bank);
  dlg.setText('feedback', dispatcherMood(bank.anger));

  for (let i = 0; i < SHOWN_SLOTS; i++) {
    dlg.attachHandler(`take${i + 1}`, () => {
      const quest = univ.scenario.quests[bank.jobs[i]!];
      takeJob(univ, bank, i, personality);
      if (quest) univ.addStringToBuf(`  You take the job: ${quest.name}`);
      // The mood line becomes the acknowledgement and stays that way, which is
      // why a board you have taken two jobs from no longer tells you its mood.
      dlg.setText('feedback', 'Job accepted.');
      fillJobBank(dlg, univ, bank);
      return 'stay';
    });
  }
  return dlg;
}
