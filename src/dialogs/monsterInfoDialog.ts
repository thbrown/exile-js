/**
 * The monster sheet — `put_monst_info` (view_dialogs.cpp:120) and
 * `display_monst` (boe.infodlg.cpp:288), running on `monster-info.xml`.
 *
 * Scry Monster opens it on one creature; the roster version pages through
 * every monster the party has scried (`m_noted`), which is what the dialog's
 * own footnote is telling you.
 */

import { DamageType, Monster } from '../data/monster';
import { MonstAbil, MonstSummon, NUM_MONST_ABIL } from '../data/monsterAbility';
import { abilityName } from '../data/monsterAbilName';
import { Scenario } from '../data/scenario';
import { Creature } from '../universe/creature';
import { Universe } from '../universe/universe';
import { SheetStore } from '../render/sheets';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';

/** How many ability lines the dialog has room for. */
const ABIL_SLOTS = 4;

/**
 * put_monst_info. `live` is the creature standing on the map, if there is one:
 * its current health, magic and morale override the type's.
 */
export function putMonstInfo(
  dlg: XmlDialog, mon: Monster, scen: Scenario, live?: Creature,
): void {
  // An invisible monster shows no picture at all (setPict(-1)).
  if (mon.invisible) dlg.setPictType('pic', 'blank', 0);
  else if (mon.pictureNum < 1000) dlg.setPictType('pic', 'monst', mon.pictureNum);
  else {
    // A custom graphic's thousands digit is its size; the sheets those come
    // from aren't loaded yet, so it falls back to the preset frame.
    dlg.setPictType('pic', 'monst', mon.pictureNum % 1000);
  }

  dlg.setText('name', mon.name);

  // The first four *active* abilities, in slot order. The C++ has its own TODO
  // about only having room for four.
  for (let i = 1; i <= ABIL_SLOTS; i++) dlg.setText(`abil${i}`, '');
  let slot = 1;
  for (let key = 0; key < NUM_MONST_ABIL && slot <= ABIL_SLOTS; key++) {
    const abil = mon.abil[key]!;
    if (!abil.active) continue;
    let name = abilityName(key as MonstAbil, abil);
    if (key === MonstAbil.SUMMON && abil.summon.type === MonstSummon.TYPE) {
      name = name.replace('%s', scen.scenMonsters[abil.summon.what]?.name ?? '');
    }
    dlg.setText(`abil${slot}`, name);
    slot++;
  }

  // The three attacks, as dice. A zero-sided attack is skipped, which is how a
  // monster with two attacks leaves the third box empty.
  for (let i = 1; i <= 3; i++) dlg.setText(`attack${i}`, '');
  mon.attacks.forEach((att, i) => {
    if (att.dice > 0 && att.sides !== 0) dlg.setText(`attack${i + 1}`, `${att.dice}d${att.sides}`);
  });

  dlg.setNum('lvl', mon.level);
  dlg.setNum('hp', live ? live.health : mon.health);
  // A caster's pool is twelve per level; anything else shows nothing at all.
  dlg.setNum('sp', live ? live.mp : (mon.mu + mon.cl ? mon.level * 12 : 0));
  dlg.setNum('def', mon.armor);
  dlg.setNum('skill', mon.skill);
  // Morale is ten per level, and doubles again past level 20.
  let morale = 10 * mon.level;
  if (mon.level > 20) morale += 10 * (mon.level - 20);
  dlg.setNum('morale', live ? live.morale : morale);
  dlg.setNum('ap', mon.speed);
  dlg.setNum('mage', mon.mu);
  dlg.setNum('priest', mon.cl);

  // `resist` is a percentage of damage taken, so what's shown is the part
  // resisted: 100 minus it.
  const res = (kind: DamageType): string => `${100 - (mon.resist[kind] ?? 100)}%`;
  dlg.setText('magic-res', res(DamageType.MAGIC));
  dlg.setText('fire-res', res(DamageType.FIRE));
  dlg.setText('cold-res', res(DamageType.COLD));
  dlg.setText('poison-res', res(DamageType.POISON));

  dlg.setLed('mindless', mon.mindless ? 'red' : 'off');
  dlg.setLed('invuln', mon.invuln ? 'red' : 'off');
  dlg.setLed('guard', mon.guard ? 'red' : 'off');
}

/**
 * `display_monst`. With a creature, the sheet is that one and the arrows are
 * hidden; without, it pages through `m_noted` — the monsters Scry Monster has
 * identified, which the dialog's footnote explains.
 */
export function monsterInfoDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore,
  univ: Universe, which?: Creature,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('monster-info'));
  // `adjust_monst_menu` (boe.menus.win.cpp:140) builds `on_monst_menu` from
  // the noted set, in monster-number order.
  const roster = [...univ.party.mNoted].sort((a, b) => a - b);

  if (which) {
    dlg.hide('left');
    dlg.hide('right');
    putMonstInfo(dlg, which.mon, univ.scenario, which);
  } else {
    let position = 0;
    const show = (): void => {
      const num = roster[position];
      if (num === undefined) return;
      const mon = univ.scenario.scenMonsters[num];
      if (mon) putMonstInfo(dlg, mon, univ.scenario);
    };
    const step = (by: number) => (): 'stay' => {
      if (roster.length > 0) {
        position = (position + by + roster.length) % roster.length;
      }
      show();
      return 'stay';
    };
    dlg.attachHandler('left', step(-1));
    dlg.attachHandler('right', step(1));
    show();
  }
  // The three LEDs carry a click handler in the C++ "to suppress normal LED
  // behaviour", so they read rather than toggle.
  for (const led of ['guard', 'mindless', 'invuln']) dlg.attachHandler(led, () => 'stay');
  return dlg;
}
