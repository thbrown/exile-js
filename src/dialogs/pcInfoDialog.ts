/**
 * The character sheet — `give_pc_info` and `display_pc_info`
 * (boe.infodlg.cpp:476 and :360), running on the real `pc-info.xml`.
 *
 * This is the first call site converted to the dialogxml toolkit, and it reads
 * the way the C++ does: fill the named controls, attach handlers to the few
 * buttons that don't close the dialog, and run it.
 */

import { ItemAbil, Item } from '../data/item';
import { getStr } from '../data/strings';
import { getWeapons } from '../game/combat';
import { curWeight, hasAbilEquip, maxWeight } from '../universe/inventory';
import { NUM_INVEN_SLOTS, Player } from '../universe/player';
import { MainStatus, NUM_SKILLS, Skill, Status, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';
import { skillNames } from '../data/enumTags';
import { getDialogDef } from './dialogStore';
import { XmlDialog } from './xmlDialog';
import { SheetStore } from '../render/sheets';

/** `cPlayer::armor_encumbrance` (pc.cpp:704) — the awkwardness of what's worn. */
export function armorEncumbrance(pc: Player): number {
  let total = 0;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (pc.equip[i]) total += pc.items[i]!.awkward;
  }
  return total;
}

function clamp8(n: number): number {
  return Math.max(-8, Math.min(8, n));
}

/** display_pc_info — fill every control from the PC. */
export function displayPcInfo(dlg: XmlDialog, univ: Universe, pcNum: number): void {
  const pc = univ.party.pcs[pcNum];
  if (!pc) return;

  dlg.setText('weight',
    `${pc.name} is carrying ${curWeight(pc)} stones out of ${maxWeight(pc)}.`);
  dlg.setText('hp', `${pc.curHealth} out of ${pc.maxHealth}.`);
  dlg.setText('sp', `${pc.curSp} out of ${pc.maxSp}.`);

  // The nineteen skills, named by their enum tag — which is exactly what the
  // controls in pc-info.xml are called.
  for (let i = 0; i < 19; i++) {
    // An item that raises the stat is shown as "12+2", not folded in.
    const boost = boostFor(pc, i);
    dlg.setText(skillNames[i]!, `${pc.skills[i]}${boost > 0 ? `+${boost}` : ''}`);
  }
  dlg.setNum('encumb', armorEncumbrance(pc));
  dlg.setText('name', pc.name);
  dlg.setNum('lvl', pc.level);
  dlg.setNum('xp', pc.experience);
  dlg.setNum('skp', pc.skillPts);
  dlg.setNum('progress', pc.level * pc.getTnl());
  // A PC using a monster graphic shows the monster instead.
  const pic = pc.whichGraphic;
  if (pic >= 100 && pic < 1000) dlg.setPictType('pic', 'monst', pic - 100);
  else dlg.setPictType('pic', 'pc', pic);

  // The two weapon blocks, with the same to-hit and damage adjustments the
  // fight itself uses.
  const [weap1, weap2] = getWeapons(pc);
  let hitAdj = pc.statAdj(Skill.DEXTERITY) * 5 - armorEncumbrance(pc) * 5
    + 5 * clamp8(pc.status[Status.BLESS_CURSE] ?? 0);
  if (!pc.traits[Trait.AMBIDEXTROUS] && weap2) hitAdj -= 25;
  let damAdj = pc.statAdj(Skill.STRENGTH) + clamp8(pc.status[Status.BLESS_CURSE] ?? 0);
  const skillItem = hasAbilEquip(pc, ItemAbil.SKILL);
  if (skillItem) {
    hitAdj += 5 * (Math.trunc(skillItem.item.abilStrength / 2) + 1);
    damAdj += Math.trunc(skillItem.item.abilStrength / 2);
  }
  const giant = hasAbilEquip(pc, ItemAbil.GIANT_STRENGTH);
  if (giant) {
    damAdj += giant.item.abilStrength;
    hitAdj += giant.item.abilStrength * 2;
  }

  const describe = (weap: Item | null, a: string, b: string): void => {
    dlg.setText(a, 'No weapon.');
    dlg.setText(b, '');
    if (!weap) return;
    if (!weap.ident) {
      dlg.setText(a, 'Not identified.');
      return;
    }
    const hit = hitAdj + 5 * weap.bonus;
    // The C++ prints the percent sign in front of the number either way, with
    // its own TODO wondering why. Kept.
    dlg.setText(a, hit < 0 ? `Penalty to hit: %${hit}` : `Bonus to hit: +%${hit}`);
    dlg.setText(b, `Damage: (1-${weap.itemLevel}) + ${damAdj + weap.bonus}`);
  };
  describe(weap1, 'weap1a', 'weap1b');
  describe(weap2, 'weap2a', 'weap2b');
}

/** get_prot_level(BOOST_STAT, skill) — items that raise a stat while worn. */
function boostFor(pc: Player, skill: number): number {
  let sum = 0;
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (!pc.equip[i]) continue;
    if (item.ability !== ItemAbil.BOOST_STAT) continue;
    if (item.abilData !== skill) continue;
    sum += item.abilStrength;
  }
  return sum;
}

/**
 * Build the dialog. `pc-info.xml`'s Done closes it; the arrows step to the
 * next *living* PC and refill it in place, which is why they hold the dialog
 * open. The three "see" buttons open dialogs this port hasn't converted yet
 * and say so.
 */
export function pcInfoDialog(
  ctx: CanvasRenderingContext2D, store: SheetStore, univ: Universe, pcNum: number,
): XmlDialog {
  const dlg = new XmlDialog(ctx, store, getDialogDef('pc-info'));
  let which = pcNum;
  for (let i = 0; i < NUM_SKILLS && i < 19; i++) {
    dlg.setText(`lbl${i + 1}`, getStr('skills', 1 + i * 2));
  }
  displayPcInfo(dlg, univ, which);

  const step = (by: number) => (): 'stay' => {
    // The C++ loops until it lands on someone alive; a party with one survivor
    // simply comes back to them.
    for (let i = 0; i < 6; i++) {
      which = (which + by + 6) % 6;
      if (univ.party.pcs[which]?.mainStatus === MainStatus.ALIVE) break;
    }
    displayPcInfo(dlg, univ, which);
    return 'stay';
  };
  dlg.attachHandler('left', step(-1));
  dlg.attachHandler('right', step(1));
  // TODO(M7): display_pc's spell lists, pick_race_abil's traits page and
  // display_alchemy's help text are three more dialogs to convert.
  for (const name of ['seemage', 'seepriest', 'trait', 'seealch']) {
    dlg.attachHandler(name, () => {
      univ.addStringToBuf(`(${name} needs its own dialog yet)`);
      return 'stay';
    });
  }
  return dlg;
}
