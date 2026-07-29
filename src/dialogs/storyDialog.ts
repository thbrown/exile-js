/**
 * `story_dialog` (boe.items.cpp:611) — the STORY_DIALOG node's paginated text,
 * running on `many-str.xml`.
 *
 * The node names a *range* of strings (`m2`..`m3`) and a title (`m1`); the
 * dialog shows one at a time with Back and Next. The port used to show the
 * first two as if they were two paragraphs of one message, so a scenario's
 * opening story stopped after a page.
 */

import { SpecCtxType } from '../game/specials/context';
import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { pictTypeOf } from './strDialog';
import { XmlDialog } from './xmlDialog';

export function storyDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe,
  title: string, first: number, last: number,
  strType: SpecCtxType, pic: number, picType: number,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('many-str'));
  dlg.setPictType('pict', pictTypeOf(picType), pic);
  dlg.setText('title', title);

  let cur = first;
  const show = (): void => {
    dlg.setText('str', univ.getStr(strType, cur) ?? '');
  };

  // The C++ writes one handler for all three buttons and its `else if` chain
  // is what gives the dialog its behaviour:
  //   - Back never closes; it just stops at the first page.
  //   - **Next on the last page closes the dialog**, because the "done or
  //     cur == last" arm is reached by anything that isn't Back.
  dlg.attachHandler('left', () => {
    if (cur > first) cur--;
    show();
    return 'stay';
  });
  dlg.attachHandler('right', () => {
    if (cur === last) return 'close';
    cur++;
    show();
    return 'stay';
  });
  // The C++ opens by triggering the Back handler, which loads the first page
  // without moving; doing it here directly is the same thing.
  show();
  return dlg;
}
