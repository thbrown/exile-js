/**
 * scenario.xml reader — partial port of readScenarioFromXml
 * (fileio_scen.cpp:781). Parses the header text, the <game> geometry block,
 * the shop list, the special items, the quests and the scenario timers.
 * Deferred sections (journals, town flags) are skipped by name and picked up
 * in later milestones.
 */

import { Scenario } from '../data/scenario';
import {
  Quest, SpecItem, makeQuest, makeSpecItem,
} from '../data/quest';
import { Timer } from '../data/town';
import {
  Shop, ShopItemType, ShopPrompt, ShopType, SHOP_PROMPT_TAGS, SHOP_TYPE_TAGS, shopBaseItem,
} from '../data/shop';
import { ItemType } from '../data/item';
import { attr, children, intAttr, intText, locFromXml, rectFromXml, tag, text } from './xml';

const DEFERRED_TOP = new Set([
  'icon', 'id', 'version', 'language', 'author', 'feature-flags', 'creator',
  'editor',
]);
const DEFERRED_GAME = new Set([
  'journal', 'town-flag',
]);

/** The entry tags that carry a single number and map straight to a type. */
const SIMPLE_ENTRIES: Record<string, ShopItemType> = {
  'mage-spell': ShopItemType.MAGE_SPELL,
  'priest-spell': ShopItemType.PRIEST_SPELL,
  recipe: ShopItemType.ALCHEMY,
  skill: ShopItemType.SKILL,
  treasure: ShopItemType.TREASURE,
  class: ShopItemType.CLASS,
};

/** "infinite" or a number (the shop-amount type in scenario.xsd). */
function shopAmount(raw: string): number {
  if (raw === 'infinite') return 0;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`bad shop quantity '${raw}'`);
  return n;
}

/** readShopFromXml (fileio_scen.cpp:625). */
export function readShopFromXml(data: Element, fname = 'scenario.xml'): Shop {
  const shop = new Shop();
  const reqs = new Set(['name', 'type', 'prompt', 'face', 'entries']);
  for (const elem of children(data)) {
    const type = tag(elem);
    reqs.delete(type);
    if (type === 'name') shop.name = text(elem);
    else if (type === 'type') {
      const i = SHOP_TYPE_TAGS.indexOf(text(elem));
      shop.type = i < 0 ? ShopType.NORMAL : (i as ShopType);
    } else if (type === 'prompt') {
      const i = SHOP_PROMPT_TAGS.indexOf(text(elem));
      shop.prompt = i < 0 ? ShopPrompt.SHOPPING : (i as ShopPrompt);
    } else if (type === 'face') shop.face = intText(elem);
    else if (type === 'entries') readShopEntries(elem, shop, fname);
    else throw new Error(`${fname}: bad node <${type}> in <shop>`);
  }
  if (reqs.size > 0) throw new Error(`${fname}: <shop> missing <${[...reqs][0]}>`);
  return shop;
}

function readShopEntries(elem: Element, shop: Shop, fname: string): void {
  // The real item data isn't available yet; refreshItems fills it in later.
  const dummy = shopBaseItem();
  dummy.variety = ItemType.GOLD;
  for (const entry of children(elem)) {
    const type = tag(entry);
    if (type === 'item') {
      let amount = -1;
      let chance = 100;
      const rawQuantity = attr(entry, 'quantity');
      if (rawQuantity !== undefined) amount = shopAmount(rawQuantity);
      if (attr(entry, 'chance') !== undefined) {
        chance = intAttr(entry, 'chance');
        // A chance without an explicit quantity means one of them.
        if (amount === -1) amount = 1;
      }
      if (amount === -1) amount = 0;
      shop.addItem(intText(entry), { ...dummy }, amount, chance);
    } else if (type === 'special') {
      let amount = 0;
      let node = 0;
      let cost = 0;
      let icon = 0;
      let title = '';
      let descr = '';
      const reqs = new Set(['quantity', 'node', 'icon', 'name', 'description']);
      for (const field of children(entry)) {
        const name = tag(field);
        reqs.delete(name);
        if (name === 'quantity') amount = shopAmount(text(field));
        else if (name === 'cost') cost = intText(field);
        else if (name === 'node') node = intText(field);
        else if (name === 'icon') icon = intText(field);
        else if (name === 'name') title = text(field);
        else if (name === 'description') descr = text(field);
        else throw new Error(`${fname}: bad node <${name}> in <special>`);
      }
      if (reqs.size > 0) throw new Error(`${fname}: <special> missing <${[...reqs][0]}>`);
      shop.addCallSpecial(title, descr, icon, node, cost, amount);
    } else if (type === 'heal') {
      shop.addSpecial(ShopItemType.HEAL_WOUNDS + intText(entry));
    } else {
      const itype = SIMPLE_ENTRIES[type];
      if (itype === undefined) throw new Error(`${fname}: bad node <${type}> in <entries>`);
      shop.addSpecial(itype, intText(entry));
    }
  }
}

export interface ScenarioHeader {
  title: string;
  teasers: string[];
  introMsgs: string[];
  numTowns: number;
  outWidth: number;
  outHeight: number;
  startTown: number;
  difficulty: number;
  adjustDiff: boolean;
  townStart: { x: number; y: number };
  outdoorStart: { x: number; y: number };
  sectorStart: { x: number; y: number };
  shops: Shop[];
  /** The scenario's quest (special) items — at most 50. */
  specialItems: SpecItem[];
  quests: Quest[];
  /** scenario_timers — at most 20; fire every `time` days. */
  scenarioTimers: Timer[];
  /** The special node run once when a new game starts (scenario.init_spec). */
  initSpec: number;
  /** spec_strs — the scenario-level message strings specials print. */
  specStrs: string[];
  /** store_item_rects — where each town's shops keep sold-back goods. */
  storeItemRects: Map<number, { top: number; left: number; bottom: number; right: number }>;
}

/** readSpecItemFromXml (fileio_scen.cpp:529). */
export function readSpecItemFromXml(data: Element, fname = 'scenario.xml'): SpecItem {
  const item = makeSpecItem();
  const special = attr(data, 'special');
  if (special !== undefined) item.special = parseInt(special, 10);
  // Two independent bits packed into one number by addition, as the C++ does.
  if (attr(data, 'start-with') === 'true') item.flags += 10;
  if (attr(data, 'useable') === 'true') item.flags += 1;
  const reqs = new Set(['name', 'description']);
  for (const elem of children(data)) {
    const type = tag(elem);
    reqs.delete(type);
    if (type === 'name') item.name = text(elem);
    else if (type === 'description') item.descr = text(elem);
    else throw new Error(`${fname}: bad node <${type}> in <special-item>`);
  }
  if (reqs.size > 0) throw new Error(`${fname}: <special-item> missing <${[...reqs][0]}>`);
  return item;
}

/** readQuestFromXml (fileio_scen.cpp:566). */
export function readQuestFromXml(data: Element, fname = 'scenario.xml'): Quest {
  const quest = makeQuest();
  if (attr(data, 'start-with') === 'true') quest.autoStart = true;
  const reqs = new Set(['name', 'description']);
  let banksFound = 0;
  for (const elem of children(data)) {
    const type = tag(elem);
    reqs.delete(type);
    if (type === 'deadline') {
      if (attr(elem, 'relative') === 'true') quest.deadlineIsRelative = true;
      const waive = attr(elem, 'waive-if');
      if (waive !== undefined) quest.event = parseInt(waive, 10);
      quest.deadline = intText(elem);
    } else if (type === 'reward') {
      const xp = attr(elem, 'xp');
      if (xp !== undefined) quest.xp = parseInt(xp, 10);
      const gold = attr(elem, 'gold');
      if (gold !== undefined) quest.gold = parseInt(gold, 10);
    } else if (type === 'bank') {
      if (banksFound === 0) quest.bank1 = intText(elem);
      else if (banksFound === 1) quest.bank2 = intText(elem);
      else throw new Error(`${fname}: too many <bank> in <quest>`);
      banksFound++;
    } else if (type === 'name') quest.name = text(elem);
    else if (type === 'description') quest.descr = text(elem);
    else throw new Error(`${fname}: bad node <${type}> in <quest>`);
  }
  if (reqs.size > 0) throw new Error(`${fname}: <quest> missing <${[...reqs][0]}>`);
  return quest;
}

/**
 * readTimerFromXml (fileio_scen.cpp:738). `freq` is required — the C++ uses
 * -1000 as its "not seen yet" sentinel and throws when it survives.
 */
export function readTimerFromXml(data: Element, fname = 'scenario.xml'): Timer {
  const freq = attr(data, 'freq');
  if (freq === undefined) throw new Error(`${fname}: <timer> missing freq`);
  return { time: parseInt(freq, 10), node: intText(data) };
}

export function readScenarioFromXml(root: Element, fname = 'scenario.xml'): ScenarioHeader {
  if (tag(root) !== 'scenario') throw new Error(`${fname}: bad root <${tag(root)}>`);
  const hdr: ScenarioHeader = {
    title: '',
    teasers: [],
    introMsgs: [],
    numTowns: 0,
    outWidth: 0,
    outHeight: 0,
    startTown: 0,
    difficulty: 0,
    adjustDiff: false,
    townStart: { x: 0, y: 0 },
    outdoorStart: { x: 0, y: 0 },
    sectorStart: { x: 0, y: 0 },
    shops: [],
    specialItems: [],
    quests: [],
    scenarioTimers: [],
    initSpec: -1,
    specStrs: [],
    storeItemRects: new Map(),
  };
  for (const elem of children(root)) {
    const type = tag(elem);
    if (type === 'title') hdr.title = text(elem);
    else if (type === 'text') {
      for (const t of children(elem)) {
        if (tag(t) === 'teaser') hdr.teasers.push(text(t));
        else if (tag(t) === 'intro-msg') hdr.introMsgs.push(text(t));
      }
    } else if (type === 'ratings') {
      // Stored one lower than it reads in the file: 1-4 in XML, 0-3 in memory.
      for (const r of children(elem)) {
        if (tag(r) === 'difficulty') hdr.difficulty = intText(r) - 1;
      }
    } else if (type === 'flags') {
      for (const f of children(elem)) {
        if (tag(f) === 'adjust-difficulty') hdr.adjustDiff = text(f) === 'true';
      }
    } else if (type === 'game') {
      for (const g of children(elem)) {
        const gt = tag(g);
        if (gt === 'num-towns') hdr.numTowns = intText(g);
        else if (gt === 'out-width') hdr.outWidth = intText(g);
        else if (gt === 'out-height') hdr.outHeight = intText(g);
        else if (gt === 'start-town') hdr.startTown = intText(g);
        else if (gt === 'on-init') hdr.initSpec = intText(g);
        else if (gt === 'town-start') hdr.townStart = locFromXml(g);
        else if (gt === 'outdoor-start') hdr.outdoorStart = locFromXml(g);
        else if (gt === 'sector-start') hdr.sectorStart = locFromXml(g);
        else if (gt === 'shop') hdr.shops.push(readShopFromXml(g, fname));
        else if (gt === 'special-item') hdr.specialItems.push(readSpecItemFromXml(g, fname));
        else if (gt === 'quest') hdr.quests.push(readQuestFromXml(g, fname));
        else if (gt === 'timer') {
          if (hdr.scenarioTimers.length >= 20) throw new Error(`${fname}: too many <timer>`);
          hdr.scenarioTimers.push(readTimerFromXml(g, fname));
        }
        else if (gt === 'string') {
          const id = intAttr(g, 'id');
          while (hdr.specStrs.length <= id) hdr.specStrs.push('');
          hdr.specStrs[id] = text(g);
        }
        else if (gt === 'store-items') {
          const town = intAttr(g, 'town');
          if (hdr.storeItemRects.has(town))
            throw new Error(`${fname}: two <store-items> rects for town ${town}`);
          hdr.storeItemRects.set(town, rectFromXml(g));
        } else if (!DEFERRED_GAME.has(gt))
          throw new Error(`${fname}: bad node <${gt}> in <game>`);
      }
    } else if (!DEFERRED_TOP.has(type)) {
      throw new Error(`${fname}: bad node <${type}> in scenario`);
    }
  }
  return hdr;
}

export function emptyScenario(hdr: ScenarioHeader): Scenario {
  return {
    ...hdr,
    terTypes: [],
    scenItems: [],
    scenMonsters: [],
    towns: [],
    townTalk: [],
    outdoors: [],
    scenSpecials: new Map(),
  };
}
