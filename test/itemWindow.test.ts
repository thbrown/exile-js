/**
 * The item window's three pages — `set_stat_window`'s list building — and the
 * scrollbar widget under them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Quest, QuestStatus, makeJob, makeQuest } from '../src/data/quest';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  ItemWinMode, ItemWindow, LINES_IN_ITEM_WIN, QUEST_COMPLETED_OFFSET, QUEST_FAILED_OFFSET,
  firstActivePc,
} from '../src/game/itemWindow';
import { ScrollPart, Scrollbar } from '../src/render/scrollbar';
import { NUM_INVEN_SLOTS, PartyPreset } from '../src/universe/player';
import { MainStatus } from '../src/universe/skills';
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

/** The bundled scenarios ship no quests, so these tests supply their own. */
let savedQuests: Quest[] = [];
let univ: Universe;
let win: ItemWindow;

beforeEach(() => {
  savedQuests = scen.quests.slice();
  univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  win = new ItemWindow();
});

function named(name: string): Quest {
  const q = makeQuest();
  q.name = name;
  return q;
}

describe('set_stat_window', () => {
  it('a PC page scrolls over the whole pack, not just the visible rows', () => {
    win.setStatWindow(univ, ItemWinMode.PC3);
    expect(win.mode).toBe(ItemWinMode.PC3);
    expect(win.pcPage).toBe(2);
    expect(win.scrollMax).toBe(NUM_INVEN_SLOTS - LINES_IN_ITEM_WIN);
    expect(win.specItemArray).toEqual([]);
  });

  it('asking for a dead PC gives the first living one instead', () => {
    univ.party.pcs[0]!.mainStatus = MainStatus.DEAD;
    univ.party.pcs[1]!.mainStatus = MainStatus.DEAD;
    expect(firstActivePc(univ)).toBe(2);
    win.setStatWindow(univ, ItemWinMode.PC1);
    expect(win.mode).toBe(ItemWinMode.PC3);
  });

  it('the special-items page lists only what the party is carrying', () => {
    univ.party.specItems.add(3);
    univ.party.specItems.add(0);
    win.setStatWindow(univ, ItemWinMode.SPECIAL);
    // The scan is by index, so the list comes out in scenario order.
    expect(win.specItemArray).toEqual([0, 3]);
    expect(win.scrollMax).toBe(0);
  });

  it('more special items than rows leaves the rest to the scrollbar', () => {
    for (let i = 0; i < 11; i++) univ.party.specItems.add(i);
    win.setStatWindow(univ, ItemWinMode.SPECIAL);
    expect(win.specItemArray).toHaveLength(11);
    expect(win.scrollMax).toBe(11 - LINES_IN_ITEM_WIN);
    expect(win.scroll).toBe(0);
  });

  it('the quests page tags each entry with its status', () => {
    scen.quests.push(named('started'), named('done'), named('blown'), named('untouched'));
    univ.party.activeQuests.set(0, makeJob(1));
    univ.party.activeQuests.set(1, { ...makeJob(1), status: QuestStatus.COMPLETED });
    univ.party.activeQuests.set(2, { ...makeJob(1), status: QuestStatus.FAILED });
    win.setStatWindow(univ, ItemWinMode.QUESTS);
    expect(win.specItemArray).toEqual([0, 1 + QUEST_COMPLETED_OFFSET, 2 + QUEST_FAILED_OFFSET]);
    scen.quests.length = 0;
    scen.quests.push(...savedQuests);
  });

  it('a quest the party has never touched is not on the page', () => {
    scen.quests.push(named('unheard of'));
    win.setStatWindow(univ, ItemWinMode.QUESTS);
    expect(win.specItemArray).toEqual([]);
    scen.quests.length = 0;
    scen.quests.push(...savedQuests);
  });

  it('changing page resets the scroll', () => {
    win.setStatWindow(univ, ItemWinMode.PC1);
    win.scroll = 9;
    win.setStatWindow(univ, ItemWinMode.SPECIAL);
    expect(win.scroll).toBe(0);
  });

  it('set_stat_window_for_pc clamps to the party', () => {
    win.setStatWindowForPc(univ, 42);
    expect(win.mode).toBe(ItemWinMode.PC6);
    win.setStatWindowForPc(univ, -3);
    expect(win.mode).toBe(ItemWinMode.PC1);
  });
});

describe('cScrollbar', () => {
  const bar = (): Scrollbar => new Scrollbar({ top: 148, left: 560, bottom: 255, right: 576 });

  it('clamps rather than refusing an out-of-range position', () => {
    const s = bar();
    s.setMaximum(16);
    s.setPosition(100);
    expect(s.getPosition()).toBe(16);
    s.setPosition(-5);
    expect(s.getPosition()).toBe(0);
  });

  it('lowering the maximum pulls the position down with it', () => {
    const s = bar();
    s.setMaximum(16);
    s.setPosition(16);
    s.setMaximum(3);
    expect(s.getPosition()).toBe(3);
  });

  it('the arrows step one line and the track pages', () => {
    const s = bar();
    s.setMaximum(16);
    s.setPageSize(LINES_IN_ITEM_WIN);
    s.pressPart(ScrollPart.DOWN);
    expect(s.getPosition()).toBe(1);
    s.pressPart(ScrollPart.PGDN);
    expect(s.getPosition()).toBe(9);
    s.pressPart(ScrollPart.PGUP);
    expect(s.getPosition()).toBe(1);
    s.pressPart(ScrollPart.UP);
    expect(s.getPosition()).toBe(0);
    // The thumb only moves by dragging, so pressing it changes nothing.
    s.pressPart(ScrollPart.THUMB);
    expect(s.getPosition()).toBe(0);
  });

  it('a click in the top button is PART_UP and in the bottom one PART_DOWN', () => {
    const s = bar();
    s.setMaximum(16);
    expect(s.locationToPart(150)).toBe(ScrollPart.UP);
    expect(s.locationToPart(254)).toBe(ScrollPart.DOWN);
    // At position 0 the thumb sits directly under the up arrow.
    expect(s.locationToPart(170)).toBe(ScrollPart.THUMB);
    expect(s.locationToPart(200)).toBe(ScrollPart.PGDN);
  });

  it('a bar with nothing to scroll declines the click entirely', () => {
    const s = bar();
    expect(s.handleClick(565, 254)).toBe(false);
    s.setMaximum(4);
    expect(s.handleClick(565, 254)).toBe(true);
    expect(s.getPosition()).toBe(1);
    // Outside its own frame it is still not interested.
    expect(s.handleClick(100, 100)).toBe(false);
  });

  it('the wheel scrolls a line per notch, upward for a positive delta', () => {
    const s = bar();
    s.setMaximum(16);
    s.setPosition(5);
    s.handleWheel(2);
    expect(s.getPosition()).toBe(3);
    s.handleWheel(-1);
    expect(s.getPosition()).toBe(4);
  });
});
