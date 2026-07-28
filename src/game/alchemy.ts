/**
 * Making a potion — `do_alchemy` (boe.party.cpp:2284) and the eligibility half
 * of `alch_choice` (:2345).
 *
 * The dialogs the C++ runs (select_pc, then pick-potion.xml) belong to the
 * host; what's here is the rules — who can attempt what, what it consumes, and
 * what comes out.
 */

import { Alchemy, AlchemyRecipe, alchemyCharges, alchemyFailChance, alchemyName, alchemyPotion, canMakeAlchemy, alchemyRecipe } from '../data/alchemy';
import { Item, ItemAbil, ItemType } from '../data/item';
import { GiveStatus, giveItem, removeCharge } from '../universe/inventory';
import { NUM_INVEN_SLOTS, Player } from '../universe/player';
import { Skill } from '../universe/skills';
import { Universe } from '../universe/universe';
import { placeItem } from './loot';
import type { GameSession } from './session';

/**
 * cPlayer::has_abil (pc.cpp:807) — the first item in the pack with an ability
 * and a charge left. Unlike `hasAbilEquip` it doesn't care whether the item is
 * worn, which is what makes a plant in the bottom of the pack an ingredient.
 */
export function hasAbil(pc: Player, abil: ItemAbil, dat = -1): { slot: number; item: Item } | null {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    const item = pc.items[i]!;
    if (item.variety === ItemType.NO_ITEM) continue;
    if (item.ability !== abil) continue;
    if (item.charges === 0) continue;
    if (dat >= 0 && dat !== item.abilData) continue;
    return { slot: i, item };
  }
  return null;
}

/** cPlayer::has_space (pc.cpp:732) — the first empty slot, or -1. */
export function hasSpace(pc: Player): number {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    if (pc.items[i]!.variety === ItemType.NO_ITEM) return i;
  }
  return -1;
}

/** One line of `alch_choice`'s potion list. */
export interface AlchemyChoice {
  which: Alchemy;
  recipe: AlchemyRecipe;
  name: string;
  /** The difficulty, which the dialog shows in brackets after the name. */
  difficulty: number;
  /**
   * `can_make` — false means the recipe is known but this PC's skill is below
   * its difficulty. The C++ hides the Take button and leaves the label, so the
   * player can see what they're working towards.
   */
  canMake: boolean;
}

/**
 * The recipes to offer `pcNum`: every one the *party* knows, whether or not
 * this PC can manage it (`alch_choice`, boe.party.cpp:2358).
 */
export function alchemyChoices(univ: Universe, pcNum: number): AlchemyChoice[] {
  const pc = univ.party.pcs[pcNum];
  const skill = pc ? pc.skill(Skill.ALCHEMY) : 0;
  const out: AlchemyChoice[] = [];
  for (let i = 0; i < univ.party.alchemy.length; i++) {
    if (!univ.party.alchemy[i]) continue;
    const info = alchemyRecipe(i);
    if (!info) continue;
    out.push({
      which: i,
      recipe: info,
      name: alchemyName(i),
      difficulty: info.difficulty,
      canMake: canMakeAlchemy(info, skill),
    });
  }
  return out;
}

/**
 * The body of `do_alchemy` once the PC and the potion have been chosen. Every
 * refusal is a transcript line and no ingredients are spent; past that point
 * the ingredients go whether the mixing works or not.
 */
export function makePotion(
  session: GameSession, pcNum: number, which: Alchemy, sound?: (n: number) => void,
): void {
  const univ = session.univ;
  const pc = univ.party.pcs[pcNum];
  const info = alchemyRecipe(which);
  if (!pc || !info) return;
  const say = (line: string): void => univ.addStringToBuf(line);

  if (hasSpace(pc) < 0) {
    say("Alchemy: Can't carry another item.");
    return;
  }
  const first = hasAbil(pc, info.ingred1);
  if (!first) {
    say('Alchemy: Don\'t have ingredients.');
    return;
  }
  if (info.ingred2 !== ItemAbil.NONE) {
    const second = hasAbil(pc, info.ingred2);
    if (!second) {
      say('Alchemy: Don\'t have ingredients.');
      return;
    }
    // Highest slot first: `remove_charge` can take the item out of the pack
    // entirely, and everything below it shifts up (the C++'s own comment).
    if (first.slot < second.slot) {
      removeCharge(pc, second.slot);
      removeCharge(pc, first.slot);
    } else {
      removeCharge(pc, first.slot);
      removeCharge(pc, second.slot);
    }
  } else removeCharge(pc, first.slot);

  sound?.(8);

  const roll = univ.rng.getRan(1, 1, 100);
  const skill = pc.skill(Skill.ALCHEMY);
  if (roll < alchemyFailChance(info, skill)) {
    say('Alchemy: Failed.');
    sound?.(41);
    return;
  }
  const potion = alchemyPotion(which);
  // Only `charges`: `cItem(ITEM_POTION)` left `max_charges` at 1 and
  // `do_alchemy` doesn't touch it, so a two- or three-dose potion reads as
  // over-full. Kept.
  potion.charges = alchemyCharges(info, skill);
  // Three shades of the same bottle, so a shelf of potions isn't uniform.
  potion.graphicNum += univ.rng.getRan(1, 0, 2);
  const given = giveItem(pc, univ.party, potion);
  if (given.status !== GiveStatus.OK) {
    say('No room in inventory. Potion placed on floor.');
    placeItem(univ, potion, univ.party.townLoc);
  } else say('Alchemy: Successful.');
}
