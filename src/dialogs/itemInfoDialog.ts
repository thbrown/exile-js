/**
 * The item sheet — `display_pc_item` (boe.infodlg.cpp:236) and `put_item_info`
 * (view_dialogs.cpp:21), running on the real `item-info.xml`.
 *
 * This is the "I" button on an inventory row. The port used to answer it with a
 * hand-written notice carrying the name, the description and two numbers; the
 * real dialog has the item's picture, its type, value, damage, bonus, defence,
 * encumbrance, uses, level and weight, two LEDs for identified and magic, the
 * ability spelled out in words, and arrows that step through the rest of the
 * pack without closing.
 */

import { Item, ItemType, SKILL_INVALID } from '../data/item';
import { getAbilName, weaponSkillName } from '../data/itemAbilName';
import { ItemAbil } from '../data/item';
import { Scenario } from '../data/scenario';
import { getStr } from '../data/strings';
import { itemWeight } from '../universe/inventory';
import { NUM_INVEN_SLOTS } from '../universe/player';
import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** put_item_info — fill every control from one item. */
export function putItemInfo(dlg: XmlDialog, item: Item, scen: Scenario): void {
  dlg.setPictType('pic', 'item', item.graphicNum);
  dlg.setLed('id', item.ident ? 'red' : 'off');
  // Magic only shows once the item has been identified — an unidentified magic
  // item gives nothing away.
  dlg.setLed('magic', item.magic && item.ident ? 'red' : 'off');
  dlg.setText('type', getStr('item-types-display', item.variety + 1));

  // Clear every field first: the arrows reuse the same dialog, so a field the
  // next item doesn't fill would otherwise keep the last one's value.
  for (const name of ['val', 'dmg', 'bonus', 'def', 'enc', 'use', 'lvl', 'abil'])
    dlg.setText(name, '');

  if (!item.ident) {
    // An unidentified item shows only what it looks like. Note this returns
    // *before* the weight and description are set, so those keep whatever the
    // previous item left — which is the C++'s own behaviour.
    dlg.setText('name', item.name);
    return;
  }

  dlg.setText('name', item.fullName);
  dlg.setNum('weight', itemWeight(item));
  // `|||` ends the part of the description the player is allowed to read; the
  // rest is the designer's note.
  dlg.setText('desc', item.desc.split('|||')[0] ?? '');
  // A stack of charges is worth its value times the count.
  dlg.setNum('val', item.charges > 0 ? item.value * item.charges : item.value);

  if (item.ability !== ItemAbil.NONE) {
    if (item.concealed) {
      dlg.setText('abil', '???');
    } else {
      let abil = getAbilName(item);
      if (item.ability === ItemAbil.SUMMONING || item.ability === ItemAbil.MASS_SUMMONING) {
        abil = abil.replace('%s', scen.scenMonsters[item.abilData]?.name ?? '');
      }
      dlg.setText('abil', abil);
    }
  }
  if (item.charges > 0) dlg.setNum('use', item.charges);
  if (item.protection > 0) dlg.setNum('def', item.protection);

  switch (item.variety) {
    case ItemType.ONE_HANDED:
    case ItemType.TWO_HANDED:
    case ItemType.BOW:
    case ItemType.CROSSBOW:
    case ItemType.THROWN_MISSILE:
    case ItemType.MISSILE_NO_AMMO:
      // A weapon with no ability of its own advertises the skill it rolls
      // against instead — the ability field does double duty. The C++ then
      // falls through into the ammunition case, which shares the two lines
      // below; TypeScript won't allow a non-empty fallthrough, so they are
      // written out in both arms.
      if (item.ability === ItemAbil.NONE && item.weapType !== SKILL_INVALID)
        dlg.setText('abil', `Key skill: ${weaponSkillName(item.weapType)}`);
      dlg.setNum('dmg', item.itemLevel);
      dlg.setNum('bonus', item.bonus);
      break;
    case ItemType.ARROW:
    case ItemType.BOLTS:
      dlg.setNum('dmg', item.itemLevel);
      dlg.setNum('bonus', item.bonus);
      break;
    case ItemType.POTION:
    case ItemType.RING:
    case ItemType.SCROLL:
    case ItemType.TOOL:
    case ItemType.WAND:
    case ItemType.NECKLACE:
      dlg.setNum('lvl', item.itemLevel);
      break;
    case ItemType.SHIELD:
    case ItemType.ARMOR:
    case ItemType.HELM:
    case ItemType.GLOVES:
    case ItemType.SHIELD_2:
    case ItemType.BOOTS:
      // The C++ has its own TODO about this: armour folds bonus and protection
      // together into "Bonus" and puts the item level under "Defend", which is
      // the other way round from a weapon. Kept.
      dlg.setNum('bonus', item.bonus + item.protection);
      dlg.setNum('def', item.itemLevel);
      dlg.setNum('enc', item.awkward);
      break;
    case ItemType.WEAPON_POISON:
      dlg.setNum('lvl', item.itemLevel);
      break;
    default:
      // no item, gold, food, non-use and the two unused kinds: nothing to add.
      break;
  }
}

/**
 * `display_pc_item` — the sheet for one item in a PC's pack, with the arrows
 * stepping to the next item that PC is carrying.
 *
 * `pcNum >= 6` means the item doesn't belong to anyone (a shop's stock, a thing
 * on the floor), and the C++ hides the arrows for it.
 */
export function itemInfoDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  univ: Universe, pcNum: number, slot: number, loose?: Item,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('item-info'));
  const pc = univ.party.pcs[pcNum];
  let which = slot;
  const shown = (): Item =>
    (pcNum >= 6 || !pc ? loose ?? univ.party.pcs[0]!.items[0]! : pc.items[which]!);

  if (pcNum >= 6 || !pc) {
    dlg.hide('left');
    dlg.hide('right');
  } else {
    const step = (by: number) => (): 'stay' => {
      // The C++'s do/while walks past empty slots. A pack with one item in it
      // comes back round to the same one.
      for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
        which = (which + by + NUM_INVEN_SLOTS) % NUM_INVEN_SLOTS;
        if (pc.items[which]!.variety !== ItemType.NO_ITEM) break;
      }
      putItemInfo(dlg, shown(), univ.scenario);
      return 'stay';
    };
    dlg.attachHandler('left', step(-1));
    dlg.attachHandler('right', step(1));
  }
  // The two LEDs are read-only here: the C++ attaches the click handler to
  // them precisely "to suppress normal LED behaviour", so clicking one does
  // nothing rather than toggling it.
  dlg.attachHandler('id', () => 'stay');
  dlg.attachHandler('magic', () => 'stay');

  putItemInfo(dlg, shown(), univ.scenario);
  return dlg;
}
