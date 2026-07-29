/**
 * The pick-up-items screen — `show_get_items` and `put_item_graphics`
 * (boe.items.cpp:559 and :363), running on the real `get-items.xml`.
 *
 * Unlike a plain pick-list this one **stays open**: the six PC buttons choose
 * who is doing the picking up, each item click hands that item over and drops
 * it out of the list, and Done closes. Eight rows show at a time, with up/down
 * arrows for a longer pile.
 *
 * The dialog was a hand-drawn approximation until the dialogxml toolkit landed;
 * the layout, the fonts and the colours are the definition's now, which is what
 * brings back the detail line under each name ("Not identified.",
 * "Damage: 1-6.") and the "Weight: n" label beside it.
 */

import { Item, ItemType, interestingString } from '../data/item';
import type { GameSession } from '../game/session';
import { SheetStore } from '../render/sheets';
import { curWeight, itemWeight, maxWeight } from '../universe/inventory';
import { hasSpace } from '../game/alchemy';
import { isCombat } from '../game/modes';
import { MainStatus } from '../universe/skills';
import type { ModalScreen } from './dialog';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** ITEMS_IN_WINDOW. */
const ROWS = 8;

/** The eight row shortcuts, as the dialog's own help text promises. */
const ROW_KEYS = 'abcdefgh';

export class GetItemsDialog implements ModalScreen {
  private dlg: XmlDialog;
  private first = 0;
  /** `current_getting_pc` — who picks things up. 6 means "nobody can". */
  who: number;

  constructor(
    ctx: CanvasRenderingContext2D,
    store: SheetStore,
    private session: GameSession,
    private items: Item[],
    title: string,
  ) {
    this.who = session.univ.curPc;
    this.dlg = new XmlDialog(ctx, store, getDialogDef('get-items'));
    this.dlg.setText('title', title);

    this.dlg.attachHandler('up', () => {
      if (this.first > 0) this.first -= ROWS;
      this.refresh();
      return 'stay';
    });
    this.dlg.attachHandler('down', () => {
      if (this.first + ROWS < this.items.length) this.first += ROWS;
      this.refresh();
      return 'stay';
    });
    for (let i = 0; i < 6; i++) {
      this.dlg.attachHandler(`pc${i + 1}`, () => {
        this.who = i;
        this.refresh();
        return 'stay';
      });
    }
    for (let i = 0; i < ROWS; i++) {
      const name = `item${i + 1}-key`;
      this.dlg.attachKey(name, ROW_KEYS[i]!);
      this.dlg.attachHandler(name, () => {
        this.take(this.first + i);
        return 'stay';
      });
    }
    this.refresh();
  }

  /** `put_item_graphics` — refill every control from the current state. */
  private refresh(): void {
    const { univ } = this.session;
    const dlg = this.dlg;

    // A PC who has died or filled their pack stops being the one picking up.
    const pcs = univ.party.pcs;
    if (this.who < 6 && (pcs[this.who]?.mainStatus !== MainStatus.ALIVE
      || !this.hasSpace(this.who))) this.who = 6;

    for (let i = 0; i < 6; i++) {
      const pc = pcs[i];
      const id = `pc${i + 1}`;
      // In combat only the acting PC can take things.
      const usable = pc?.mainStatus === MainStatus.ALIVE && this.hasSpace(i)
        && (!isCombat(this.session.mode) || univ.curPc === i);
      if (usable) {
        if (this.who === 6) this.who = i;
        dlg.show(id);
        dlg.show(`${id}-g`);
        if (pc) dlg.setPictType(`${id}-g`, 'pc', pc.whichGraphic);
      } else {
        dlg.hide(id);
        dlg.hide(`${id}-g`);
      }
      // The current PC is marked with an asterisk beside their button.
      dlg.setLabel(id, this.who === i ? '*   ' : '    ', 'left', 7, true);
    }

    // The arrows only show when there is somewhere to go.
    if (this.first === 0) dlg.hide('up'); else dlg.show('up');
    if (this.items.length <= ROWS || this.first > this.items.length - (ROWS - 1))
      dlg.hide('down');
    else dlg.show('down');

    for (let i = 0; i < ROWS; i++) {
      const id = `item${i + 1}`;
      const item = this.items[i + this.first];
      if (item && item.variety !== ItemType.NO_ITEM) {
        dlg.show(`${id}-g`);
        dlg.setPictType(`${id}-g`, 'item', item.graphicNum);
        dlg.setText(`${id}-name`, item.ident ? item.fullName : item.name);
        dlg.setText(`${id}-detail`, interestingString(item));
        dlg.setText(`${id}-weight`, `Weight: ${itemWeight(item)}`);
        dlg.setText(`${id}-key`, ROW_KEYS[i]!);
      } else {
        dlg.hide(`${id}-g`);
        dlg.setText(`${id}-name`, '');
        dlg.setText(`${id}-detail`, '');
        dlg.setText(`${id}-weight`, '');
        dlg.setText(`${id}-key`, '');
      }
    }

    if (this.who < 6) {
      const who = pcs[this.who]!;
      dlg.setText('prompt',
        `${who.name} is carrying ${curWeight(who)} out of ${maxWeight(who)}.`);
    }
  }

  /** `cPlayer::has_space` — a free inventory slot to put something in. */
  private hasSpace(index: number): boolean {
    const pc = this.session.univ.party.pcs[index];
    return pc !== undefined && hasSpace(pc) >= 0;
  }

  /** Hand item `index` to the current PC and drop it out of the list. */
  private take(index: number): void {
    if (this.who >= 6) return;
    const item = this.items[index];
    if (!item) return;
    // `takeItem` reports what happened either way, so success is judged by
    // whether the item actually left the floor — it splices it out of the town
    // on success and leaves it there on a refusal.
    const message = this.session.takeItem(item, this.who);
    const town = this.session.univ.town;
    if (town && town.items.includes(item)) {
      // Too heavy, or no room. The original shows this in its `prompt` field.
      this.dlg.setText('prompt', message || "It's too heavy to carry.");
      return;
    }
    this.items.splice(index, 1);
    if (this.first > 0 && this.first >= this.items.length) {
      this.first = Math.max(0, this.first - ROWS);
    }
    this.refresh();
  }

  // The dialog underneath does the drawing and the dispatching.

  draw(): void {
    this.dlg.draw();
  }

  onClick(x: number, y: number): string | null {
    return this.dlg.onClick(x, y);
  }

  onKey(key: string): string | null {
    return this.dlg.onKey(key);
  }
}
