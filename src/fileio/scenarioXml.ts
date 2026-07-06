/**
 * scenario.xml reader — partial port of readScenarioFromXml
 * (fileio_scen.cpp:781). Parses the header text and the <game> geometry
 * block. Deferred sections (special items, quests, shops, timers, strings,
 * journals) are skipped by name and picked up in later milestones.
 */

import { Scenario } from '../data/scenario';
import { children, intText, locFromXml, tag, text } from './xml';

const DEFERRED_TOP = new Set([
  'icon', 'id', 'version', 'language', 'author', 'ratings', 'flags', 'feature-flags', 'creator',
  'editor',
]);
const DEFERRED_GAME = new Set([
  'store-items', 'special-item', 'quest', 'shop', 'timer', 'string', 'journal', 'town-flag',
]);

export interface ScenarioHeader {
  title: string;
  teasers: string[];
  introMsgs: string[];
  numTowns: number;
  outWidth: number;
  outHeight: number;
  startTown: number;
  townStart: { x: number; y: number };
  outdoorStart: { x: number; y: number };
  sectorStart: { x: number; y: number };
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
    townStart: { x: 0, y: 0 },
    outdoorStart: { x: 0, y: 0 },
    sectorStart: { x: 0, y: 0 },
  };
  for (const elem of children(root)) {
    const type = tag(elem);
    if (type === 'title') hdr.title = text(elem);
    else if (type === 'text') {
      for (const t of children(elem)) {
        if (tag(t) === 'teaser') hdr.teasers.push(text(t));
        else if (tag(t) === 'intro-msg') hdr.introMsgs.push(text(t));
      }
    } else if (type === 'game') {
      for (const g of children(elem)) {
        const gt = tag(g);
        if (gt === 'num-towns') hdr.numTowns = intText(g);
        else if (gt === 'out-width') hdr.outWidth = intText(g);
        else if (gt === 'out-height') hdr.outHeight = intText(g);
        else if (gt === 'start-town') hdr.startTown = intText(g);
        else if (gt === 'town-start') hdr.townStart = locFromXml(g);
        else if (gt === 'outdoor-start') hdr.outdoorStart = locFromXml(g);
        else if (gt === 'sector-start') hdr.sectorStart = locFromXml(g);
        else if (!DEFERRED_GAME.has(gt))
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
    outdoors: [],
    scenSpecials: new Map(),
  };
}
