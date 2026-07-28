/**
 * `use_item` and the two helpers under it — the USE button on an inventory row.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import {
  Item, ItemAbil, ItemType, ItemUse, canUse, defaultItem,
  useInCombat, useInTown, useMagic, useOutdoors,
} from '../src/data/item';
import { Scenario } from '../src/data/scenario';
import { Spell } from '../src/data/spell';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { bookText, drainPc, poisonWeapon, useItem } from '../src/game/itemUse';
import { GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, PartyStatus, Status, Trait } from '../src/universe/skills';
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

/**
 * Whose pack the tests use. PC 0 in the pregen party (Jenneke) is *magically
 * inept*, which refuses every magic item — PC 3 (Adrianna) is magically apt.
 */
const WHO = 3;

/** Put `item` in slot 0 of PC `who` and return it. */
function held(s: GameSession, item: Partial<Item>, who = WHO): Item {
  const made: Item = { ...defaultItem(), variety: ItemType.POTION, charges: 3, ...item };
  s.univ.party.pcs[who]!.items[0] = made;
  s.univ.party.pcs[who]!.equip[0] = false;
  return made;
}

/** The pregens carry nothing, so a weapon test has to supply one. */
function equipSword(s: GameSession, who = WHO, slot = 1): Item {
  const sword: Item = {
    ...defaultItem(), variety: ItemType.ONE_HANDED, name: 'drawn sword',
  };
  s.univ.party.pcs[who]!.items[slot] = sword;
  s.univ.party.pcs[who]!.equip[slot] = true;
  return sword;
}

describe('the use-flag helpers', () => {
  it('says a healing potion is usable anywhere and is magic', async () => {
    const item = { ...defaultItem(), ability: ItemAbil.AFFECT_HEALTH };
    expect(canUse(item)).toBe(true);
    expect(useInTown(item)).toBe(true);
    expect(useInCombat(item)).toBe(true);
    expect(useOutdoors(item)).toBe(true);
    expect(useMagic(item)).toBe(true);
  });

  it('refuses a passive ability outright', async () => {
    const item = { ...defaultItem(), ability: ItemAbil.DAMAGING_WEAPON };
    expect(canUse(item)).toBe(false);
    expect(useMagic(item)).toBe(false);
  });

  it('takes a CAST_SPELL item\'s when-bits from the spell it casts', async () => {
    // True Sight is town-only; Light works everywhere.
    const sight = { ...defaultItem(), ability: ItemAbil.CAST_SPELL, abilData: Spell.TRUE_SIGHT };
    expect(useInTown(sight)).toBe(true);
    expect(useOutdoors(sight)).toBe(false);
    expect(useInCombat(sight)).toBe(false);
    const light = { ...defaultItem(), ability: ItemAbil.CAST_SPELL, abilData: Spell.LIGHT };
    expect(useOutdoors(light)).toBe(true);
    expect(useInCombat(light)).toBe(true);
  });

  it('makes Flight the one outdoors-only party status', async () => {
    const fly = {
      ...defaultItem(), ability: ItemAbil.AFFECT_PARTY_STATUS, abilData: PartyStatus.FLIGHT,
    };
    expect(useOutdoors(fly)).toBe(true);
    expect(useInTown(fly)).toBe(false);
    expect(useInCombat(fly)).toBe(false);
    const stealth = {
      ...defaultItem(), ability: ItemAbil.AFFECT_PARTY_STATUS, abilData: PartyStatus.STEALTH,
    };
    expect(useInTown(stealth)).toBe(true);
    expect(useOutdoors(stealth)).toBe(false);
  });

  it('widens AFFECT_STATUS outdoors for the four statuses that need it', async () => {
    const mk = (s: Status) => ({ ...defaultItem(), ability: ItemAbil.AFFECT_STATUS, abilData: s });
    for (const s of [Status.POISON, Status.DISEASE, Status.HASTE_SLOW, Status.BLESS_CURSE])
      expect(useOutdoors(mk(s))).toBe(true);
    expect(useOutdoors(mk(Status.WEBS))).toBe(false);
  });
});

describe('the refusals', () => {
  it('refuses an item that can\'t be used at all, and keeps the charge', async () => {
    const s = inTown();
    const item = held(s, { ability: ItemAbil.DAMAGING_WEAPON });
    await useItem(s, WHO, 0);
    expect(item.charges).toBe(3);
    expect(s.univ.transcript.at(-1)).toContain("Can't use this item");
  });

  it('refuses a rechargeable item with nothing left', async () => {
    const s = inTown();
    const item = held(s, { ability: ItemAbil.AFFECT_HEALTH, charges: 0, rechargeable: true });
    await useItem(s, WHO, 0);
    expect(item.charges).toBe(0);
    expect(s.univ.transcript.some((l) => l.includes('No charges left'))).toBe(true);
  });

  it('refuses a magic item to a magically inept PC but allows a mundane one', async () => {
    const s = inTown();
    // Jenneke is inept in the pregen party — no need to set the trait.
    expect(s.univ.party.pcs[0]!.traits[Trait.MAGICALLY_INEPT]).toBe(true);
    held(s, { ability: ItemAbil.AFFECT_HEALTH }, 0);
    await useItem(s, 0, 0);
    expect(s.univ.transcript.some((l) => l.includes('magically inept'))).toBe(true);

    // POISON_WEAPON is the one usable ability that isn't magic, so it goes
    // through — `use_magic` is false for it in abil_chart.
    equipSword(s, 0);
    const blade = held(s, { ability: ItemAbil.POISON_WEAPON, abilStrength: 3 }, 0);
    await useItem(s, 0, 0);
    expect(s.univ.transcript.some((l) => l.includes('You poison your weapon'))).toBe(true);
    expect(blade.charges).toBe(2);
  });

  it('refuses a town-only item while outdoors', async () => {
    const s = inTown();
    s.endTownMode(s.univ.party.townLoc);
    const item = held(s, { ability: ItemAbil.LIGHT, abilStrength: 2 });
    await useItem(s, WHO, 0);
    expect(item.charges).toBe(3);
    expect(s.univ.transcript.some((l) => l.includes('Not while outdoors'))).toBe(true);
  });
});

describe('the effects', () => {
  it('heals one PC and spends a charge', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[WHO]!;
    pc.curHealth = 1;
    const item = held(s, {
      ability: ItemAbil.AFFECT_HEALTH, abilStrength: 2, magicUseType: ItemUse.HELP_ONE,
    });
    await useItem(s, WHO, 0);
    expect(pc.curHealth).toBeGreaterThan(1);
    expect(item.charges).toBe(2);
    expect(s.univ.transcript.some((l) => l.includes('You feel better'))).toBe(true);
  });

  it('heals the whole party on a HELP_ALL item', async () => {
    const s = inTown();
    for (const pc of s.univ.party.pcs) pc.curHealth = 1;
    held(s, {
      ability: ItemAbil.AFFECT_HEALTH, abilStrength: 2, magicUseType: ItemUse.HELP_ALL,
    });
    await useItem(s, WHO, 0);
    for (const pc of s.univ.party.pcs) {
      if (pc.isAlive) expect(pc.curHealth).toBeGreaterThan(1);
    }
    expect(s.univ.transcript.some((l) => l.includes('You all feel better'))).toBe(true);
  });

  it('blesses on a HELP use and curses on a HARM one, from the same ability', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[WHO]!;
    held(s, {
      ability: ItemAbil.AFFECT_STATUS,
      abilData: Status.BLESS_CURSE,
      abilStrength: 3,
      magicUseType: ItemUse.HELP_ONE,
    });
    await useItem(s, WHO, 0);
    expect(pc.status[Status.BLESS_CURSE]).toBeGreaterThan(0);

    pc.status[Status.BLESS_CURSE] = 0;
    held(s, {
      ability: ItemAbil.AFFECT_STATUS,
      abilData: Status.BLESS_CURSE,
      abilStrength: 3,
      magicUseType: ItemUse.HARM_ONE,
    });
    await useItem(s, WHO, 0);
    expect(pc.status[Status.BLESS_CURSE]).toBeLessThan(0);
  });

  it('cures poison rather than applying a negative dose', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[WHO]!;
    pc.status[Status.POISON] = 5;
    held(s, {
      ability: ItemAbil.AFFECT_STATUS,
      abilData: Status.POISON,
      abilStrength: 3,
      magicUseType: ItemUse.HELP_ONE,
    });
    await useItem(s, WHO, 0);
    expect(pc.status[Status.POISON]).toBe(2);
  });

  it('adds light, and takes it away on a harmful use', async () => {
    const s = inTown();
    held(s, { ability: ItemAbil.LIGHT, abilStrength: 2, magicUseType: ItemUse.HELP_ONE });
    await useItem(s, WHO, 0);
    const lit = s.univ.party.lightLevel;
    expect(lit).toBeGreaterThan(0);
    held(s, { ability: ItemAbil.LIGHT, abilStrength: 2, magicUseType: ItemUse.HARM_ONE });
    await useItem(s, WHO, 0);
    expect(s.univ.party.lightLevel).toBeLessThan(lit);
  });

  it('sets a party status, scaling stealth by five', async () => {
    const s = inTown();
    held(s, {
      ability: ItemAbil.AFFECT_PARTY_STATUS,
      abilData: PartyStatus.STEALTH,
      abilStrength: 4,
      magicUseType: ItemUse.HELP_ONE,
    });
    await useItem(s, WHO, 0);
    expect(s.univ.party.partyStatus[PartyStatus.STEALTH]).toBe(20);
  });

  it('never takes more party status off than is there', async () => {
    const s = inTown();
    s.univ.party.partyStatus[PartyStatus.DETECT_LIFE] = 3;
    held(s, {
      ability: ItemAbil.AFFECT_PARTY_STATUS,
      abilData: PartyStatus.DETECT_LIFE,
      abilStrength: 10,
      magicUseType: ItemUse.HARM_ONE,
    });
    await useItem(s, WHO, 0);
    expect(s.univ.party.partyStatus[PartyStatus.DETECT_LIFE]).toBe(0);
  });

  it('drains experience without going below zero', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[WHO]!;
    pc.experience = 30;
    drainPc(pc, 100);
    expect(pc.experience).toBe(0);
    // A dead PC is left alone.
    pc.mainStatus = MainStatus.DEAD;
    pc.experience = 50;
    drainPc(pc, 10);
    expect(pc.experience).toBe(50);
  });

  it('leaves a book\'s charges alone, since reading is free', async () => {
    const s = inTown();
    const item = held(s, {
      ability: ItemAbil.MESSAGE, variety: ItemType.NON_USE_OBJECT,
      desc: 'A dusty tome.|||The first page.|||The second page.',
    });
    await useItem(s, WHO, 0);
    expect(item.charges).toBe(3);
  });
});

describe('bookText', () => {
  it('splits a description on its two ||| markers', async () => {
    expect(bookText({ ...defaultItem(), desc: 'cover|||one|||two' }))
      .toEqual(['one', 'two']);
  });

  it('gives one paragraph when there is only one marker', async () => {
    expect(bookText({ ...defaultItem(), desc: 'cover|||just this' }))
      .toEqual(['just this', '']);
  });
});

describe('poison_weapon', () => {
  it('poisons the equipped weapon and records which one', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[WHO]!;
    const sword = equipSword(s);
    expect(poisonWeapon(s.univ, WHO, 4, true)).toBe(true);
    expect(pc.weapPoisoned).toBe(sword);
    expect(pc.status[Status.POISONED_WEAPON]).toBe(4);
  });

  it('reports no weapon when nothing poisonable is equipped', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[WHO]!;
    equipSword(s);
    pc.equip.fill(false);
    expect(poisonWeapon(s.univ, WHO, 4, true)).toBe(false);
    expect(s.univ.transcript.at(-1)).toContain('No weapon equipped');
  });

  it('skips an unequipped poisonable weapon to reach an equipped one', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[WHO]!;
    pc.items[0] = { ...defaultItem(), variety: ItemType.ONE_HANDED, name: 'spare dagger' };
    equipSword(s);
    expect(poisonWeapon(s.univ, WHO, 4, true)).toBe(true);
    expect(pc.weapPoisoned?.name).toBe('drawn sword');
  });

  it('never botches a safe application, so no charge is wasted', async () => {
    const s = inTown();
    equipSword(s);
    poisonWeapon(s.univ, WHO, 4, true);
    expect(s.univ.transcript.some((l) => l.includes('Poison put on badly'))).toBe(false);
  });
});
