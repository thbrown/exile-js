/**
 * `cStrDlog` (strdlog.cpp:32) — the message box the whole game speaks through:
 * a scenario's story text, a sign, a room description, a quest handed over.
 *
 * It is not one definition but eight. `getDefn` picks
 * `{1|2}str[-title][-lg]` from how many strings there are, whether a title was
 * given, and whether the picture is one of the large kinds. Every variant has
 * the same four controls: a `pict`, `str1`, an optional `title`/`str2`, a Done
 * button and a **Record** button — which is hidden unless a record handler is
 * attached, and which is what puts the text in the party's encounter notes.
 */

import { PictType } from './dialogXml';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/**
 * `ePicType` (pictypes.hpp:16) — the numbers scenario nodes carry. Only the
 * kinds a message can actually show are mapped; anything else falls back to
 * the dialog sheet, as an unknown type would draw from it anyway.
 */
export function pictTypeOf(num: number): PictType {
  switch (num) {
    case 0: return 'blank';
    case 1: return 'ter';
    case 2: return 'teranim';
    case 3: return 'monst';
    case 5: return 'talk';
    case 6: case 14: return 'scen';
    case 7: case 17: return 'item';
    case 8: return 'pc';
    case 9: return 'field';
    case 10: return 'boom';
    case 11: return 'full';
    case 12: return 'missile';
    case 15: return 'map';
    case 16: return 'status';
    case 18: return 'btn';
    default: return 'dlog';
  }
}

/** The large picture kinds, which choose the `-lg` layout. */
function isLargePic(picType: number): boolean {
  // PIC_DLOG_LG (13), PIC_CUSTOM_DLOG_LG (113), PIC_SCEN_LG (14).
  return picType === 13 || picType === 113 || picType === 14;
}

export interface StrDialogSpec {
  str1: string;
  str2?: string;
  title?: string;
  pic: number;
  picType: number;
  /**
   * What the Record button does. The button is drawn **only** when this is
   * given — that is the C++'s rule, and it is why an error box has one and a
   * plain notice doesn't.
   */
  onRecord?: () => void;
}

/** Which of the eight definitions this message needs. */
export function strDialogDefName(spec: StrDialogSpec): string {
  const count = (spec.str1 !== '' ? 1 : 0) + (spec.str2 ? 1 : 0);
  let name = `${Math.max(1, Math.min(2, count))}str`;
  if (spec.title) name += '-title';
  if (isLargePic(spec.picType)) name += '-lg';
  return name;
}

/** Every layout `strDialogDefName` can ask for, so they can all be preloaded. */
export const STR_DIALOG_DEFS = [
  '1str', '1str-title', '1str-lg', '1str-title-lg',
  '2str', '2str-title', '2str-lg', '2str-title-lg',
];

export function strDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, spec: StrDialogSpec,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef(strDialogDefName(spec)));
  dlg.setPictType('pict', pictTypeOf(spec.picType), spec.pic);
  // "If str1 is empty but str2 isn't, str2 becomes the only string" — the
  // layout has one text control either way, so the surviving string moves up.
  if (spec.str1 !== '') {
    dlg.setText('str1', spec.str1);
    if (spec.str2) dlg.setText('str2', spec.str2);
  } else if (spec.str2) {
    dlg.setText('str1', spec.str2);
  }
  if (spec.title) dlg.setText('title', spec.title);

  if (spec.onRecord) {
    // The C++ keeps the button but makes it a no-op that hides itself when
    // there is no handler; here it simply isn't drawn. Recording twice is
    // harmless — `cParty::record` refuses a duplicate — but the button
    // disappearing after one press is the clearer signal, and matches what
    // happens in the original once `onRecord` returns false.
    dlg.attachHandler('record', () => {
      spec.onRecord!();
      dlg.hide('record');
      return 'stay';
    });
  } else {
    dlg.hide('record');
  }
  return dlg;
}
