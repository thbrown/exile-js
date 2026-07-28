/**
 * Alchemy — the recipe table, the skill maths under it, and `do_alchemy`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import {
  ALCHEMY_RECIPES, Alchemy, NUM_ALCHEMY, alchemyCharges, alchemyFailChance,
  alchemyName, alchemyPotion, alchemyRecipe, canMakeAlchemy,
} from '../src/data/alchemy';
import { Item, ItemAbil, ItemType, ItemUse, defaultItem } from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { alchemyChoices, hasAbil, hasSpace, makePotion } from '../src/game/alchemy';
import { GameSession } from '../src/game/session';
import { NUM_INVEN_SLOTS, PartyPreset, Player } from '../src/universe/player';
import { Skill, Status } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  return s;
}

/** A plant: an item whose ability *is* the ingredient. */
function ingredient(abil: ItemAbil, charges = 1): Item {
  const item = defaultItem();
  item.variety = ItemType.NON_USE_OBJECT;
  item.ability = abil;
  item.charges = charges;
  item.maxCharges = charges;
  item.fullName = `plant ${abil}`;
  item.name = 'plant';
  return item;
}

/** Empty the PC's pack so slot numbers in the tests mean what they say. */
function clearPack(pc: Player): void {
  for (let i = 0; i < NUM_INVEN_SLOTS; i++) {
    pc.items[i] = defaultItem();
    pc.equip[i] = false;
  }
}

describe('the recipe table', () => {
  it('has all twenty recipes, in eAlchemy order', () => {
    expect(ALCHEMY_RECIPES.length).toBe(NUM_ALCHEMY);
    ALCHEMY_RECIPES.forEach((recipe, i) => expect(recipe.id).toBe(i));
  });

  it('reads the recipes alchemy.cpp defines', () => {
    const cureWeak = alchemyRecipe(Alchemy.CURE_WEAK)!;
    expect(cureWeak.difficulty).toBe(1);
    expect(cureWeak.value).toBe(40);
    expect(cureWeak.ingred1).toBe(ItemAbil.HOLLY);
    expect(cureWeak.ingred2).toBe(ItemAbil.NONE);
    expect(cureWeak.ability).toBe(ItemAbil.AFFECT_STATUS);
    expect(cureWeak.abilStrength).toBe(2);
    expect(cureWeak.abilData).toBe(Status.POISON);

    // The two-ingredient case, and the only recipe that treats everyone.
    const speed = alchemyRecipe(Alchemy.SPEED_WEAK)!;
    expect(speed.ingred1).toBe(ItemAbil.COMFREY);
    expect(speed.ingred2).toBe(ItemAbil.WORMGRASS);
    expect(speed.abilData).toBe(Status.HASTE_SLOW);
    expect(alchemyRecipe(Alchemy.GRAYMOLD)!.magicUseType).toBe(ItemUse.HELP_ALL);
    // Every other recipe treats one PC.
    for (const recipe of ALCHEMY_RECIPES)
      if (recipe.id !== Alchemy.GRAYMOLD) expect(recipe.magicUseType).toBe(ItemUse.HELP_ONE);
  });

  it('names the potions out of magic-names, from entry 200', () => {
    expect(alchemyName(Alchemy.CURE_WEAK)).toBe('Weak Curing Potion');
    expect(alchemyName(Alchemy.POWER_STRONG)).toBe('Strong Power Potion');
  });

  it('builds the potion the recipe describes', () => {
    const potion = alchemyPotion(Alchemy.HEAL_WEAK);
    expect(potion.variety).toBe(ItemType.POTION);
    expect(potion.magic).toBe(true);
    expect(potion.graphicNum).toBe(60);
    expect(potion.weight).toBe(8);
    expect(potion.value).toBe(60);
    expect(potion.ability).toBe(ItemAbil.AFFECT_HEALTH);
    expect(potion.abilStrength).toBe(2);
    expect(potion.fullName).toBe('Weak Healing Potion');
  });
});

describe('skill against difficulty', () => {
  it('refuses outright below the difficulty, then walks the fail table down', () => {
    const heal = alchemyRecipe(Alchemy.HEAL_MED)!; // difficulty 4
    expect(alchemyFailChance(heal, 3)).toBe(100);
    expect(canMakeAlchemy(heal, 3)).toBe(false);
    expect(alchemyFailChance(heal, 4)).toBe(50);
    expect(canMakeAlchemy(heal, 4)).toBe(true);
    expect(alchemyFailChance(heal, 5)).toBe(40);
    expect(alchemyFailChance(heal, 8)).toBe(10);
    expect(alchemyFailChance(heal, 12)).toBe(2);
    // The guard is `> size()`, so one step past the table reads off the end —
    // undefined in the C++, 0 here — and everything beyond is a certainty.
    expect(alchemyFailChance(heal, 13)).toBe(0);
    expect(alchemyFailChance(heal, 30)).toBe(0);
  });

  it('makes more doses the further above the difficulty the PC is', () => {
    const heal = alchemyRecipe(Alchemy.HEAL_MED)!; // difficulty 4
    expect(alchemyCharges(heal, 3)).toBe(0);
    expect(alchemyCharges(heal, 4)).toBe(1);
    expect(alchemyCharges(heal, 8)).toBe(1);
    expect(alchemyCharges(heal, 9)).toBe(2);
    expect(alchemyCharges(heal, 14)).toBe(2);
    expect(alchemyCharges(heal, 15)).toBe(3);
  });
});

describe('the potion list', () => {
  it('offers what the party knows, marking what this PC cannot manage', () => {
    const s = inTown();
    const party = s.univ.party;
    party.alchemy[Alchemy.HEAL_WEAK] = true; // difficulty 1
    party.alchemy[Alchemy.POWER_STRONG] = true; // difficulty 20
    party.pcs[0]!.skills[Skill.ALCHEMY] = 5;
    const choices = alchemyChoices(s.univ, 0);
    expect(choices.map((c) => c.which)).toEqual([Alchemy.HEAL_WEAK, Alchemy.POWER_STRONG]);
    expect(choices[0]!.canMake).toBe(true);
    // Known but out of reach — the C++ shows the label and hides the button.
    expect(choices[1]!.canMake).toBe(false);
    expect(choices[1]!.difficulty).toBe(20);
  });
});

describe('do_alchemy', () => {
  /** A session whose PC 0 knows the recipe, has the skill and the plants. */
  function mixer(which: Alchemy, skill: number, plants: ItemAbil[]): GameSession {
    const s = inTown();
    s.univ.party.alchemy[which] = true;
    const pc = s.univ.party.pcs[0]!;
    clearPack(pc);
    pc.skills[Skill.ALCHEMY] = skill;
    plants.forEach((abil, i) => { pc.items[i] = ingredient(abil); });
    return s;
  }

  it('spends the ingredient and hands over the potion', () => {
    // Skill 13 against difficulty 1 is nine clear of the fail table, so no
    // roll can fail it.
    const s = mixer(Alchemy.HEAL_WEAK, 13, [ItemAbil.COMFREY]);
    const pc = s.univ.party.pcs[0]!;
    makePotion(s, 0, Alchemy.HEAL_WEAK);
    expect(s.univ.transcript.at(-1)).toBe('Alchemy: Successful.');
    // The plant had one charge, so it left the pack and the potion took its
    // place — `take_item` closes the hole behind it.
    const potion = pc.items.find((i) => i.variety === ItemType.POTION)!;
    expect(potion).toBeDefined();
    expect(potion.ability).toBe(ItemAbil.AFFECT_HEALTH);
    expect(potion.charges).toBe(3);
    // max_charges is left at 1 by cItem(ITEM_POTION); do_alchemy never
    // updates it, so a three-dose potion reads as over-full. Kept.
    expect(potion.maxCharges).toBe(1);
    expect(pc.items.some((i) => i.ability === ItemAbil.COMFREY)).toBe(false);
  });

  it('spends both ingredients highest slot first', () => {
    const s = mixer(Alchemy.SPEED_WEAK, 12, [ItemAbil.COMFREY, ItemAbil.WORMGRASS]);
    const pc = s.univ.party.pcs[0]!;
    // Two charges each, so both stay in the pack and only the counts move —
    // which is the case where the removal order would be invisible anyway.
    pc.items[0] = ingredient(ItemAbil.COMFREY, 2);
    pc.items[1] = ingredient(ItemAbil.WORMGRASS, 2);
    makePotion(s, 0, Alchemy.SPEED_WEAK);
    expect(s.univ.transcript.at(-1)).toBe('Alchemy: Successful.');
    expect(pc.items[0]!.charges).toBe(1);
    expect(pc.items[1]!.charges).toBe(1);
  });

  it('refuses without the second ingredient, and spends nothing', () => {
    const s = mixer(Alchemy.SPEED_WEAK, 12, [ItemAbil.COMFREY]);
    const pc = s.univ.party.pcs[0]!;
    makePotion(s, 0, Alchemy.SPEED_WEAK);
    expect(s.univ.transcript.at(-1)).toContain("Don't have ingredients");
    expect(pc.items[0]!.charges).toBe(1);
    expect(pc.items.some((i) => i.variety === ItemType.POTION)).toBe(false);
  });

  it('refuses with a full pack before it touches anything', () => {
    const s = mixer(Alchemy.HEAL_WEAK, 13, [ItemAbil.COMFREY]);
    const pc = s.univ.party.pcs[0]!;
    for (let i = 1; i < NUM_INVEN_SLOTS; i++) pc.items[i] = ingredient(ItemAbil.HOLLY);
    expect(hasSpace(pc)).toBe(-1);
    makePotion(s, 0, Alchemy.HEAL_WEAK);
    expect(s.univ.transcript.at(-1)).toContain("Can't carry another item");
    expect(pc.items[0]!.charges).toBe(1);
  });

  it('eats the ingredients even when the mixing fails', () => {
    // Skill 1 against difficulty 1 fails on any roll under 50; the seeded
    // stream's first get_ran(1,1,100) here is well below that.
    const s = mixer(Alchemy.HEAL_WEAK, 1, [ItemAbil.COMFREY]);
    const pc = s.univ.party.pcs[0]!;
    // Pin the roll: 1 is under every fail chance in the table.
    s.univ.rng.getRan = () => 1;
    makePotion(s, 0, Alchemy.HEAL_WEAK);
    expect(s.univ.transcript.at(-1)).toBe('Alchemy: Failed.');
    expect(pc.items.some((i) => i.ability === ItemAbil.COMFREY)).toBe(false);
    expect(pc.items.some((i) => i.variety === ItemType.POTION)).toBe(false);
  });

  it('only counts an ingredient that still has a charge', () => {
    const s = mixer(Alchemy.HEAL_WEAK, 13, []);
    const pc = s.univ.party.pcs[0]!;
    // A rechargeable plant sitting at zero stays in the pack but is spent.
    const empty = ingredient(ItemAbil.COMFREY, 0);
    empty.rechargeable = true;
    pc.items[0] = empty;
    expect(hasAbil(pc, ItemAbil.COMFREY)).toBeNull();
    makePotion(s, 0, Alchemy.HEAL_WEAK);
    expect(s.univ.transcript.at(-1)).toContain("Don't have ingredients");
  });
});
