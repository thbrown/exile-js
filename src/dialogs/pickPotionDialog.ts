/**
 * `alch_choice` (boe.party.cpp:2361) on `pick-potion.xml` — the twenty alchemy
 * recipes as a two-column grid of numbered buttons, with the mixer's name and
 * skill along the top.
 *
 * The rules live in `game/alchemy.ts`; this is only the screen.
 */

import { AlchemyChoice } from '../game/alchemy';
import { Player } from '../universe/player';
import { Skill } from '../universe/skills';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** The dialog has twenty slots, one per `eAlchemy`. */
export const NUM_ALCHEMY_SLOTS = 20;

/**
 * Returns the dialog; the button clicked resolves as `potionN`, and `slotIndex`
 * turns that back into a recipe number. Cancel resolves as `cancel`.
 */
export function pickPotionDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  pc: Player, choices: AlchemyChoice[],
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('pick-potion'));
  dlg.setText('mixer', `${pc.name} (skill ${pc.skill(Skill.ALCHEMY)})`);

  // The C++ hides every button first, then walks the twenty recipes: an
  // *unknown* one is skipped before its label is written, so it stays blank;
  // a **known but too hard** one gets its label and keeps its button hidden.
  // That is the whole feedback the screen gives about what you could make with
  // more training, and it is worth keeping.
  for (let i = 0; i < NUM_ALCHEMY_SLOTS; i++) {
    dlg.hide(`potion${i + 1}`);
    const choice = choices.find((c) => c.which === i);
    if (!choice) continue;
    dlg.setText(`label${i + 1}`, `${choice.name} (${choice.difficulty})`);
    if (choice.canMake) dlg.show(`potion${i + 1}`);
  }
  return dlg;
}

/** `potion7` → 6, the `eAlchemy` behind the button. -1 for anything else. */
export function potionSlot(button: string): number {
  const m = /^potion(\d+)$/.exec(button);
  return m ? Number(m[1]) - 1 : -1;
}
