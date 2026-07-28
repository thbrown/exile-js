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
    // Nothing equipped, so both weapon blocks say so.
    expect(dlg.getText('weap1a')).toBe('No weapon.');
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
