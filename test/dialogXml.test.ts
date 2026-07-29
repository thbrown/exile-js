/**
 * The dialogxml toolkit: parsing the shipped definitions, resolving their
 * positions, and driving one (`pc-info.xml`) the way the game does.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import { parseXmlDoc } from '../src/fileio/xml';
import { readDialogDef } from '../src/dialogs/dialogXml';
import { addDialogDef, getDialogDef, hasDialogDef } from '../src/dialogs/dialogStore';
import { XmlDialog } from '../src/dialogs/xmlDialog';
import { displayPcInfo, pcInfoDialog } from '../src/dialogs/pcInfoDialog';
import { itemInfoDialog, putItemInfo } from '../src/dialogs/itemInfoDialog';
import {
  STR_DIALOG_DEFS, pictTypeOf, strDialog, strDialogDefName,
} from '../src/dialogs/strDialog';
import { Item, ItemAbil, ItemPreset, ItemUse, presetItem } from '../src/data/item';
import { monsterInfoDialog, putMonstInfo } from '../src/dialogs/monsterInfoDialog';
import { storyDialog } from '../src/dialogs/storyDialog';
import { DamageType, Monster, defaultMonster } from '../src/data/monster';
import { FieldType } from '../src/data/fields';
import {
  Ability, MonstAbil, MonstGen, MonstMissile, MonstSummon, defaultAbility,
} from '../src/data/monsterAbility';
import { abilityName } from '../src/data/monsterAbilName';
import { SpecCtxType } from '../src/game/specials/context';
import { Creature } from '../src/universe/creature';
import { Race, Status } from '../src/universe/skills';
import { EncNoteType } from '../src/universe/party';
import { GameSession } from '../src/game/session';
import { SheetStore } from '../src/render/sheets';
import { PartyPreset } from '../src/universe/player';
import { MainStatus } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

const DIALOG_DIR = fileURLToPath(new URL('../public/data/dialogs', import.meta.url));

function readDialog(name: string): string {
  return readFileSync(`${DIALOG_DIR}/${name}.xml`, 'utf8');
}

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

/**
 * A canvas stub. jsdom has no 2D context, and none of what's under test needs
 * real pixels — only measurement, which is stubbed at a fixed width per
 * character so wrapping is deterministic.
 */
function fakeCtx(): CanvasRenderingContext2D {
  const calls: string[] = [];
  const ctx = {
    calls,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    textBaseline: '',
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText: (s: string, x: number, y: number) => calls.push(`text:${s}@${x},${y}`),
    fillRect: () => calls.push('fillRect'),
    strokeRect: () => calls.push('strokeRect'),
    drawImage: () => calls.push('drawImage'),
    save: () => {}, restore: () => {}, beginPath: () => {}, rect: () => {},
    clip: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    createPattern: () => null, translate: () => {}, scale: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

/** The middle of a named control, for driving a click at it. */
function centreOf(dlg: XmlDialog, name: string): [number, number] {
  const control = dlg.def.controls.find((c) => c.name === name)!;
  const r = dlg.screenRect(control);
  return [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
}

describe('parsing the shipped definitions', () => {
  it('reads every one of the 211 without throwing', async () => {
    const files = readdirSync(DIALOG_DIR).filter((f) => f.endsWith('.xml'));
    expect(files.length).toBeGreaterThan(200);
    for (const file of files) {
      const def = readDialogDef(await parseXmlDoc(readFileSync(`${DIALOG_DIR}/${file}`, 'utf8'), file));
      // Every definition has at least one control, and every named one is
      // reachable by name.
      expect(def.controls.length).toBeGreaterThan(0);
      for (const control of def.controls) {
        if (control.name) expect(def.byName.get(control.name)).toBe(control);
      }
    }
  });

  it('reads a control\'s type, rect, label and shortcut', async () => {
    const def = readDialogDef(await parseXmlDoc(readDialog('job-board')));
    const take = def.byName.get('take1');
    expect(take?.kind).toBe('button');
    if (take?.kind === 'button') {
      expect(take.type).toBe('regular');
      expect(take.label).toBe('Take');
      expect(take.rect).toEqual({ top: 78, left: 426, bottom: 78, right: 426 });
    }
    const job = def.byName.get('job1');
    expect(job?.kind).toBe('text');
    if (job?.kind === 'text') {
      expect(job.rect).toEqual({ top: 38, left: 54, bottom: 98, right: 418 });
    }
    expect(def.defBtn).toBe('done');
    expect(def.escBtn).toBe('done');
  });

  it('turns <br/> into a line break and trims the file\'s indentation', async () => {
    const def = readDialogDef(await parseXmlDoc(
      "<dialog><text name='t'>one<br/>two</text></dialog>"));
    const t = def.byName.get('t');
    expect(t?.kind === 'text' && t.text).toBe('one\ntwo');
  });

  it('reads a pict, its defaults and its size', async () => {
    const def = readDialogDef(await parseXmlDoc(readDialog('pick-potion')));
    const pict = def.controls.find((c) => c.kind === 'pict');
    expect(pict?.kind).toBe('pict');
    if (pict?.kind === 'pict') {
      expect(pict.type).toBe('dlog');
      expect(pict.num).toBe(20);
      // A pict is framed and filled unless it says otherwise.
      expect(pict.framed).toBe(true);
      expect(pict.filled).toBe(true);
    }
  });

  it('reads an LED group and registers its members by name', async () => {
    const files = readdirSync(DIALOG_DIR).filter((f) => f.endsWith('.xml'));
    let found = false;
    for (const file of files) {
      const def = readDialogDef(await parseXmlDoc(readFileSync(`${DIALOG_DIR}/${file}`, 'utf8'), file));
      const group = def.controls.find((c) => c.kind === 'group');
      if (group?.kind !== 'group' || group.leds.length === 0) continue;
      found = true;
      for (const led of group.leds) {
        expect(def.byName.get(led.name)).toBe(led);
        expect(led.kind).toBe('led');
      }
      break;
    }
    expect(found).toBe(true);
  });
});

describe('relative positioning', () => {
  const withRel = async (relative: string) => readDialogDef(await parseXmlDoc(
    `<dialog>`
    + `<text name='a' top='100' left='100' width='50' height='20'/>`
    + `<text name='b' anchor='a' relative='${relative}' top='5' left='5' width='30' height='10'/>`
    + `</dialog>`));

  it('pos measures beyond the anchor\'s far edge', async () => {
    const def = await withRel('pos');
    expect(def.byName.get('b')!.rect).toEqual({ top: 125, left: 155, bottom: 135, right: 185 });
  });

  it('pos-in lines up with the anchor\'s near edge', async () => {
    const def = await withRel('pos-in');
    expect(def.byName.get('b')!.rect).toEqual({ top: 105, left: 105, bottom: 115, right: 135 });
  });

  it('neg-in measures back from the anchor\'s far edge', async () => {
    const def = await withRel('neg-in');
    expect(def.byName.get('b')!.rect).toEqual({ top: 115, left: 145, bottom: 125, right: 175 });
  });

  it('neg places the corner without allowing for the control\'s own size', async () => {
    // The C++ negates the offset and hands it to `relocate`, which sets the
    // top-left — so a `neg` control overlaps its anchor rather than sitting
    // beside it. Kept, and pinned here.
    const def = await withRel('neg');
    expect(def.byName.get('b')!.rect).toEqual({ top: 95, left: 95, bottom: 105, right: 125 });
  });

  it('takes the horizontal mode from the first word and the vertical from the second', async () => {
    const def = await withRel('pos abs');
    expect(def.byName.get('b')!.rect.left).toBe(155);
    expect(def.byName.get('b')!.rect.top).toBe(5);
  });
});

describe('running a dialog', () => {
  it('sizes itself to its furthest control plus six, and centres itself', async () => {
    const def = readDialogDef(await parseXmlDoc(
      "<dialog><text name='a' top='10' left='10' width='100' height='20'/></dialog>"));
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), def);
    expect(dlg.frame.right - dlg.frame.left).toBe(116);
    expect(dlg.frame.bottom - dlg.frame.top).toBe(36);
    // Centred in the 605x430 window.
    expect(dlg.frame.left).toBe(Math.round((605 - 116) / 2));
  });

  it('a button with no size of its own still counts as its artwork', async () => {
    // quest-info.xml's Done carries only a top and a left. Measured as a
    // zero-height control the window closed above it and the button hung out
    // of the bottom of the panel.
    const def = readDialogDef(await parseXmlDoc(
      "<dialog><button name='done' type='done' top='208' left='251'/></dialog>"));
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), def);
    expect(dlg.frame.bottom - dlg.frame.top).toBe(208 + 23 + 6);
    expect(dlg.frame.right - dlg.frame.left).toBe(251 + 63 + 6);
    const rect = dlg.screenRect(def.byName.get('done')!);
    expect(rect.bottom).toBeLessThanOrEqual(dlg.frame.bottom);
  });

  it('closes on a button with no handler, and stays open for one with', async () => {
    const def = readDialogDef(await parseXmlDoc(
      "<dialog escbtn='cancel'>"
      + "<button name='ok' type='regular' top='10' left='10'>OK</button>"
      + "<button name='cancel' type='regular' top='10' left='80'>Cancel</button>"
      + '</dialog>'));
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), def);
    let ran = 0;
    dlg.attachHandler('ok', () => { ran++; return 'stay'; });
    const at = dlg.screenRect(def.byName.get('ok')!);
    expect(dlg.onClick(at.left + 2, at.top + 2)).toBeNull();
    expect(ran).toBe(1);
    const cancel = dlg.screenRect(def.byName.get('cancel')!);
    expect(dlg.onClick(cancel.left + 2, cancel.top + 2)).toBe('cancel');
  });

  it('answers Escape with escbtn, Enter with defbtn, and a def-key by name', async () => {
    const def = readDialogDef(await parseXmlDoc(
      "<dialog defbtn='ok' escbtn='cancel'>"
      + "<button name='ok' type='regular' top='10' left='10'>OK</button>"
      + "<button name='cancel' type='regular' top='10' left='80'>Cancel</button>"
      + "<button name='take' type='small' def-key='t' top='40' left='10'>T</button>"
      + '</dialog>'));
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), def);
    expect(dlg.onKey('Escape')).toBe('cancel');
    expect(dlg.onKey('Enter')).toBe('ok');
    expect(dlg.onKey('t')).toBe('take');
    expect(dlg.onKey('z')).toBeNull();
  });

  it('ignores a click on a hidden control', async () => {
    const def = readDialogDef(await parseXmlDoc(
      "<dialog><button name='ok' type='regular' top='10' left='10'>OK</button></dialog>"));
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), def);
    const at = dlg.screenRect(def.byName.get('ok')!);
    dlg.hide('ok');
    expect(dlg.onClick(at.left + 2, at.top + 2)).toBeNull();
    dlg.show('ok');
    expect(dlg.onClick(at.left + 2, at.top + 2)).toBe('ok');
  });

  it('lights one LED of a group at a time', async () => {
    const def = readDialogDef(await parseXmlDoc(
      "<dialog><group name='g' top='0' left='0'>"
      + "<led name='one' state='red' top='10' left='10'>One</led>"
      + "<led name='two' top='24' left='10'>Two</led>"
      + '</group></dialog>'));
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), def);
    expect(dlg.getLed('one')).toBe('red');
    expect(dlg.getSelected('g')).toBe('one');
    dlg.setLed('two', 'red');
    expect(dlg.getLed('one')).toBe('off');
    expect(dlg.getSelected('g')).toBe('two');
  });

  it('draws every control kind without reaching for a missing sheet', async () => {
    const def = readDialogDef(await parseXmlDoc(readDialog('pc-info')));
    const ctx = fakeCtx();
    const dlg = new XmlDialog(ctx, new SheetStore(), def);
    dlg.draw();
    // With no sheets loaded the art falls back to fills, but the text still
    // lands — which is what the assertion is really checking.
    const calls = (ctx as unknown as { calls: string[] }).calls;
    expect(calls.some((c) => c.startsWith('text:'))).toBe(true);
  });
});

describe('pc-info, the first converted call site', () => {
  function inTown(): GameSession {
    const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    s.startNewGame();
    return s;
  }

  beforeAll(async () => {
    if (!hasDialogDef('pc-info')) await addDialogDef('pc-info', readDialog('pc-info'));
  });

  it('fills the sheet from the PC', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), getDialogDef('pc-info'));
    displayPcInfo(dlg, s.univ, 0);
    expect(dlg.getText('name')).toBe(pc.name);
    expect(dlg.getText('lvl')).toBe(String(pc.level));
    expect(dlg.getText('hp')).toBe(`${pc.curHealth} out of ${pc.maxHealth}.`);
    expect(dlg.getText('str')).toBe(String(pc.skills[0]));
    expect(dlg.getText('weight')).toContain('is carrying');
    // `finish_create` gives a human PC a Bronze Knife (bonus 1) and equips it,
    // so the first weapon block is filled in. The stray percent sign in front
    // of the number is the C++'s (boe.infodlg.cpp:428).
    expect(dlg.getText('weap1a')).toBe('Bonus to hit: +%5');
    expect(dlg.getText('weap1b')).toBe('Damage: (1-4) + 2');
    // The buckler in slot 1 is armour, so the second weapon block stays empty.
    expect(dlg.getText('weap2a')).toBe('No weapon.');
  });

  it('steps through the living party members without closing', () => {
    const s = inTown();
    s.univ.party.pcs[1]!.mainStatus = MainStatus.DEAD;
    const dlg = pcInfoDialog(fakeCtx(), new SheetStore(), s.univ, 0);
    expect(dlg.getText('name')).toBe(s.univ.party.pcs[0]!.name);
    // Right skips the dead PC and holds the dialog open.
    expect(dlg.onKey('ArrowRight')).toBeNull();
    expect(dlg.getText('name')).toBe(s.univ.party.pcs[2]!.name);
    expect(dlg.onKey('ArrowLeft')).toBeNull();
    expect(dlg.getText('name')).toBe(s.univ.party.pcs[0]!.name);
  });

  it('labels the nineteen skill rows from the strings table', () => {
    const s = inTown();
    const dlg = pcInfoDialog(fakeCtx(), new SheetStore(), s.univ, 0);
    expect(dlg.getText('lbl1')).toBe('Strength');
    expect(dlg.getText('lbl19')).toBe('Luck');
  });

  it('closes on Done', () => {
    const s = inTown();
    const dlg = pcInfoDialog(fakeCtx(), new SheetStore(), s.univ, 0);
    expect(dlg.onKey('Escape')).toBe('done');
  });
});

describe('item-info, `display_pc_item` on the toolkit', () => {
  function inTown(): GameSession {
    const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
    s.startNewGame();
    return s;
  }

  beforeAll(async () => {
    if (!hasDialogDef('item-info')) await addDialogDef('item-info', readDialog('item-info'));
  });

  function sheetFor(item: Item): XmlDialog {
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), getDialogDef('item-info'));
    putItemInfo(dlg, item, scen);
    return dlg;
  }

  it('fills a weapon: damage, bonus, weight, value and the key skill', () => {
    const dlg = sheetFor(presetItem(ItemPreset.KNIFE));
    expect(dlg.getText('name')).toBe('Bronze Knife');
    expect(dlg.getText('type')).toBe('1-Handed weapon');
    expect(dlg.getText('dmg')).toBe('4');
    expect(dlg.getText('bonus')).toBe('1');
    expect(dlg.getText('weight')).toBe('7');
    expect(dlg.getText('val')).toBe('2');
    // A weapon with no ability of its own advertises its skill instead.
    expect(dlg.getText('abil')).toBe('Key skill: Edged Weapons');
    expect(dlg.getLed('id')).toBe('red');
    expect(dlg.getLed('magic')).toBe('off');
  });

  it('folds bonus and protection together for armour, as the C++ does', () => {
    const buckler = presetItem(ItemPreset.BUCKLER);
    buckler.protection = 2;
    buckler.bonus = 1;
    const dlg = sheetFor(buckler);
    // "Bonus" is bonus + protection and "Defend" is the item level — the other
    // way round from a weapon, and the C++ has its own TODO about it.
    expect(dlg.getText('bonus')).toBe('3');
    expect(dlg.getText('def')).toBe('1');
    expect(dlg.getText('enc')).toBe('1');
    expect(dlg.getText('dmg')).toBe('');
  });

  it('prices a stack of charges at value times count', () => {
    const arrows = presetItem(ItemPreset.ARROW);
    const dlg = sheetFor(arrows);
    expect(dlg.getText('use')).toBe('12');
    expect(dlg.getText('val')).toBe('12'); // value 1 x 12 charges
  });

  it('gives an unidentified item only its short name and no numbers', () => {
    const knife = presetItem(ItemPreset.KNIFE);
    knife.ident = false;
    knife.magic = true;
    const dlg = sheetFor(knife);
    expect(dlg.getText('name')).toBe('Knife');
    expect(dlg.getText('dmg')).toBe('');
    expect(dlg.getText('val')).toBe('');
    expect(dlg.getLed('id')).toBe('off');
    // Magic is only ever shown once identified, so nothing is given away.
    expect(dlg.getLed('magic')).toBe('off');
  });

  it('names the ability in words, and hides a concealed one', () => {
    const potion = presetItem(ItemPreset.POTION);
    potion.ident = true;
    potion.ability = ItemAbil.AFFECT_HEALTH;
    potion.magicUseType = ItemUse.HELP_ONE;
    expect(sheetFor(potion).getText('abil')).toBe('Heal');
    potion.magicUseType = ItemUse.HARM_ONE;
    expect(sheetFor(potion).getText('abil')).toBe('Drain Health');
    potion.concealed = true;
    expect(sheetFor(potion).getText('abil')).toBe('???');
  });

  it('steps through the pack with the arrows, skipping empty slots', () => {
    const s = inTown();
    const dlg = itemInfoDialog(fakeCtx(), new SheetStore(), s.univ, 0, 0);
    expect(dlg.getText('name')).toBe('Bronze Knife');
    dlg.onClick(...centreOf(dlg, 'right'));
    expect(dlg.getText('name')).toBe('Crude Buckler');
    // Slots 2..23 are empty, so the next step wraps back to slot 0.
    dlg.onClick(...centreOf(dlg, 'right'));
    expect(dlg.getText('name')).toBe('Bronze Knife');
    dlg.onClick(...centreOf(dlg, 'left'));
    expect(dlg.getText('name')).toBe('Crude Buckler');
  });

  it('hides the arrows for an item nobody owns', () => {
    const s = inTown();
    const loose = presetItem(ItemPreset.ROBE);
    const dlg = itemInfoDialog(fakeCtx(), new SheetStore(), s.univ, 6, 0, loose);
    expect(dlg.getText('name')).toBe('Vahnatai Robes');
    expect(dlg.isVisible('left')).toBe(false);
    expect(dlg.isVisible('right')).toBe(false);
  });
});

describe('cStrDlog, the message box', () => {
  it('picks its layout from the strings, the title and the picture size', () => {
    const base = { str1: 'a', pic: 0, picType: 4 };
    expect(strDialogDefName(base)).toBe('1str');
    expect(strDialogDefName({ ...base, str2: 'b' })).toBe('2str');
    expect(strDialogDefName({ ...base, title: 'T' })).toBe('1str-title');
    expect(strDialogDefName({ ...base, str2: 'b', title: 'T' })).toBe('2str-title');
    // PIC_DLOG_LG / PIC_SCEN_LG / PIC_CUSTOM_DLOG_LG take the wide layout.
    expect(strDialogDefName({ ...base, picType: 13 })).toBe('1str-lg');
    expect(strDialogDefName({ ...base, picType: 14 })).toBe('1str-lg');
    expect(strDialogDefName({ ...base, picType: 113 })).toBe('1str-lg');
    // An empty first string still needs one text control.
    expect(strDialogDefName({ ...base, str1: '', str2: 'b' })).toBe('1str');
  });

  it('maps the ePicType numbers to their sheets', () => {
    expect(pictTypeOf(4)).toBe('dlog');
    expect(pictTypeOf(6)).toBe('scen');
    expect(pictTypeOf(7)).toBe('item');
    expect(pictTypeOf(1)).toBe('ter');
    expect(pictTypeOf(3)).toBe('monst');
    // Anything unmapped falls back to the dialog sheet.
    expect(pictTypeOf(99)).toBe('dlog');
  });

  describe('running it', () => {
    beforeAll(async () => {
      for (const name of STR_DIALOG_DEFS) {
        if (!hasDialogDef(name)) await addDialogDef(name, readDialog(name));
      }
    });

    it('draws the Record button only when there is something to record', () => {
      const plain = strDialog(fakeCtx(), new SheetStore(),
        { str1: 'hello', pic: 5, picType: 6 });
      expect(plain.isVisible('record')).toBe(false);

      let recorded = 0;
      const withRecord = strDialog(fakeCtx(), new SheetStore(),
        { str1: 'hello', pic: 5, picType: 6, onRecord: () => { recorded++; } });
      expect(withRecord.isVisible('record')).toBe(true);
      withRecord.onClick(...centreOf(withRecord, 'record'));
      expect(recorded).toBe(1);
      // Once pressed it goes away, so it can't be pressed twice.
      expect(withRecord.isVisible('record')).toBe(false);
    });

    it('moves a lone second string up into the first slot', () => {
      const dlg = strDialog(fakeCtx(), new SheetStore(),
        { str1: '', str2: 'only this', pic: 0, picType: 4 });
      expect(dlg.getText('str1')).toBe('only this');
    });
  });
});

describe('cParty::record', () => {
  it('adds a note and refuses an exact duplicate', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    expect(univ.party.record(EncNoteType.TOWN, 'a secret', 'Fort Talrus')).toBe(true);
    expect(univ.party.record(EncNoteType.TOWN, 'a secret', 'Fort Talrus')).toBe(false);
    // The same text found somewhere else is a different note.
    expect(univ.party.record(EncNoteType.TOWN, 'a secret', 'Marralis')).toBe(true);
    expect(univ.party.specialNotes).toHaveLength(2);
  });
});

describe('monster-info, `display_monst` on the toolkit', () => {
  beforeAll(async () => {
    if (!hasDialogDef('monster-info')) await addDialogDef('monster-info', readDialog('monster-info'));
  });

  function sheetFor(mon: Monster, live?: Creature): XmlDialog {
    const dlg = new XmlDialog(fakeCtx(), new SheetStore(), getDialogDef('monster-info'));
    putMonstInfo(dlg, mon, scen, live);
    return dlg;
  }

  it('fills the sheet from a monster type', () => {
    const guard = scen.scenMonsters.find((m) => m.name === 'Guard')!;
    const dlg = sheetFor(guard);
    expect(dlg.getText('name')).toBe('Guard');
    expect(dlg.getText('lvl')).toBe(String(guard.level));
    expect(dlg.getText('hp')).toBe(String(guard.health));
    expect(dlg.getText('attack1')).toBe(`${guard.attacks[0]!.dice}d${guard.attacks[0]!.sides}`);
    // Morale is ten per level, and doubles again past 20.
    expect(dlg.getText('morale')).toBe(String(10 * guard.level + 10 * (guard.level - 20)));
    // `resist` is the damage *taken*; the sheet shows the part resisted.
    expect(dlg.getText('fire-res')).toBe(`${100 - guard.resist[DamageType.FIRE]!}%`);
    expect(dlg.getLed('guard')).toBe(guard.guard ? 'red' : 'off');
  });

  it('shows a non-caster no magic points, and a caster twelve per level', () => {
    const mon = { ...defaultMonster(), level: 5, mu: 0, cl: 0 };
    expect(sheetFor(mon).getText('sp')).toBe('0');
    expect(sheetFor({ ...mon, mu: 3 }).getText('sp')).toBe('60');
  });

  it('takes health, magic and morale from the creature when there is one', () => {
    const guard = scen.scenMonsters.find((m) => m.name === 'Guard')!;
    const live = new Creature();
    live.mon = { ...guard };
    live.health = 7;
    live.mp = 3;
    live.morale = 11;
    const dlg = sheetFor(guard, live);
    expect(dlg.getText('hp')).toBe('7');
    expect(dlg.getText('sp')).toBe('3');
    expect(dlg.getText('morale')).toBe('11');
  });

  it('lists the first four active abilities and leaves the rest blank', () => {
    const mon = defaultMonster();
    mon.abil[MonstAbil.MISSILE] = {
      ...mon.abil[MonstAbil.MISSILE]!, active: true,
    };
    mon.abil[MonstAbil.MISSILE]!.missile = {
      ...mon.abil[MonstAbil.MISSILE]!.missile, type: MonstMissile.SPEAR, dice: 3, sides: 7,
    };
    const dlg = sheetFor(mon);
    expect(dlg.getText('abil1')).toBe('Throws spears (3d7)');
    expect(dlg.getText('abil2')).toBe('');
  });

  it('pages through the scried roster, and hides the arrows for one creature', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    univ.party.mNoted.add(2);
    univ.party.mNoted.add(5);
    const roster = monsterInfoDialog(fakeCtx(), new SheetStore(), univ);
    expect(roster.isVisible('left')).toBe(true);
    expect(roster.getText('name')).toBe(scen.scenMonsters[2]!.name);
    roster.onClick(...centreOf(roster, 'right'));
    expect(roster.getText('name')).toBe(scen.scenMonsters[5]!.name);
    // Two entries, so Next wraps straight back round.
    roster.onClick(...centreOf(roster, 'right'));
    expect(roster.getText('name')).toBe(scen.scenMonsters[2]!.name);

    const live = new Creature();
    live.mon = { ...scen.scenMonsters[2]! };
    const one = monsterInfoDialog(fakeCtx(), new SheetStore(), univ, live);
    expect(one.isVisible('left')).toBe(false);
    expect(one.isVisible('right')).toBe(false);
  });
});

describe('uAbility::to_string', () => {
  function gen(key: MonstAbil, over: Partial<Ability['gen']>): string {
    const abil = defaultAbility();
    abil.gen = { ...abil.gen, ...over };
    return abilityName(key, abil);
  }

  it('builds a general ability from adjective, delivery and strength', () => {
    expect(gen(MonstAbil.DAMAGE, { type: MonstGen.BREATH, extra: DamageType.FIRE, strength: 4 }))
      .toBe('Fiery breath (4)');
    // A status ability's die depends on how it is delivered.
    expect(gen(MonstAbil.STATUS, { type: MonstGen.TOUCH, extra: Status.POISON, strength: 3 }))
      .toBe('Poison touch (3d10)');
    expect(gen(MonstAbil.STATUS, { type: MonstGen.RAY, extra: Status.ASLEEP, strength: 2 }))
      .toBe('Sleep ray (2d6)');
    // KILL multiplies its strength by twenty; the thieves show a range.
    expect(gen(MonstAbil.KILL, { type: MonstGen.GAZE, strength: 2 })).toBe('Death gaze (40d10)');
    expect(gen(MonstAbil.STEAL_GOLD, { type: MonstGen.TOUCH, strength: 50 }))
      .toBe('Steals gold touch (50-100)');
  });

  it('names the special, summon and radiate arms', () => {
    const splits = defaultAbility();
    splits.special.extra1 = 255;
    expect(abilityName(MonstAbil.SPLITS, splits)).toBe('Splits when hit (25.5% chance)');

    const summon = defaultAbility();
    summon.summon = {
      ...summon.summon, type: MonstSummon.SPECIES, what: Race.UNDEAD, min: 1, max: 3, chance: 100,
    };
    expect(abilityName(MonstAbil.SUMMON, summon)).toBe('Summons 1-3 undead (10.0% chance)');

    const radiate = defaultAbility();
    radiate.radiate = { ...radiate.radiate, type: FieldType.WALL_FIRE };
    expect(abilityName(MonstAbil.RADIATE, radiate)).toBe('Radiates fire fields');
    // Two field kinds replace the whole string rather than adding to it.
    radiate.radiate.type = FieldType.FIELD_DISPEL;
    expect(abilityName(MonstAbil.RADIATE, radiate)).toBe('Dispels surrounding fields');
  });
});

describe('story_dialog, the paginated node', () => {
  beforeAll(async () => {
    if (!hasDialogDef('many-str')) await addDialogDef('many-str', readDialog('many-str'));
  });

  it('walks the string range, stopping at the first page', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const strs = univ.scenario.specStrs;
    const dlg = storyDialog(fakeCtx(), new SheetStore(), univ, 'A Story', 1, 3,
      SpecCtxType.SCEN, 0, 4);
    expect(dlg.getText('title')).toBe('A Story');
    expect(dlg.getText('str')).toBe(strs[1]);
    dlg.onClick(...centreOf(dlg, 'right'));
    expect(dlg.getText('str')).toBe(strs[2]);
    dlg.onClick(...centreOf(dlg, 'left'));
    expect(dlg.getText('str')).toBe(strs[1]);
    // Back on the first page goes nowhere rather than closing.
    dlg.onClick(...centreOf(dlg, 'left'));
    expect(dlg.getText('str')).toBe(strs[1]);
  });

  it('closes when Next is pressed on the last page', () => {
    const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
    const dlg = storyDialog(fakeCtx(), new SheetStore(), univ, 'A Story', 1, 2,
      SpecCtxType.SCEN, 0, 4);
    // The C++'s `else if(clicked == "done" || cur == last)` is reached by
    // anything that isn't Back, so Next on the last page dismisses it.
    expect(dlg.onClick(...centreOf(dlg, 'right'))).toBe(null);
    expect(dlg.onClick(...centreOf(dlg, 'right'))).toBe('right');
  });
});
