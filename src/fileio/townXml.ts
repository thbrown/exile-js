/**
 * Town XML + map + dialogue loading — ports of readTownFromXml
 * (fileio_scen.cpp:1839), loadTownMapData (fileio_scen.cpp:2190), and
 * readDialogueFromXml (fileio_scen.cpp:2049).
 */

import {
  attitudeStrs,
  lightTypes,
  monstTimes,
  readEnumTag,
  talkNodes,
} from '../data/enumTags';
import { Speech, emptySpeech, emptyTalkNode } from '../data/talking';
import { Town, defaultPresetItem, defaultTownperson } from '../data/town';
import { MapData, MapFeature } from './mapParse';
import { children, intAttr, intText, locFromXml, rectFromXml, tag, text } from './xml';

const DIRS = 'nwse';

export function readTownFromXml(root: Element, fname: string): Town {
  if (tag(root) !== 'town') throw new Error(`${fname}: bad root <${tag(root)}>`);
  let town: Town | null = null;
  let numCmt = 0;
  let numWand = 0;
  const reqs = new Set(['size', 'name', 'bounds', 'difficulty', 'lighting', 'flags']);
  let foundOnDead = false;
  let foundOnAlive = false;
  for (const elem of children(root)) {
    const type = tag(elem);
    reqs.delete(type);
    if (type === 'size') {
      const dim = intText(elem);
      if (dim < 24) throw new Error(`${fname}: town size ${dim} < 24`);
      town = new Town(dim);
      continue;
    }
    if (!town) throw new Error(`${fname}: <${type}> before <size>`);
    switch (type) {
      case 'name':
        town.name = text(elem);
        break;
      case 'comment':
        if (numCmt >= 3) throw new Error(`${fname}: too many <comment>`);
        town.comment[numCmt++] = text(elem);
        break;
      case 'bounds':
        town.inTownRect = rectFromXml(elem);
        break;
      case 'difficulty':
        town.difficulty = intText(elem);
        break;
      case 'lighting':
        town.lightingType = readEnumTag(lightTypes, text(elem), 'lighting');
        break;
      case 'onenter': {
        const cond = elem.getAttribute('condition');
        if (!foundOnAlive && cond === 'alive') {
          town.specOnEntry = intText(elem);
          foundOnAlive = true;
        } else if (!foundOnDead && cond === 'dead') {
          town.specOnEntryIfDead = intText(elem);
          foundOnDead = true;
        } else throw new Error(`${fname}: bad onenter condition '${cond}'`);
        break;
      }
      case 'exit': {
        const dir = DIRS.indexOf(elem.getAttribute('dir') ?? '');
        if (dir < 0) throw new Error(`${fname}: bad exit dir`);
        const loc = locFromXml(elem);
        town.exits[dir]!.x = loc.x;
        town.exits[dir]!.y = loc.y;
        break;
      }
      case 'onexit': {
        const dir = DIRS.indexOf(elem.getAttribute('dir') ?? '');
        if (dir < 0) throw new Error(`${fname}: bad onexit dir`);
        town.exits[dir]!.spec = intText(elem);
        break;
      }
      case 'onoffend':
        town.specOnHostile = intText(elem);
        break;
      case 'timer': {
        if (town.timers.length >= 8) throw new Error(`${fname}: too many <timer>`);
        const freq = elem.getAttribute('freq');
        town.timers.push({ time: freq === null ? -1000 : parseInt(freq, 10), node: intText(elem) });
        break;
      }
      case 'flags':
        for (const flag of children(elem)) {
          const ft = tag(flag);
          if (ft === 'chop') {
            const day = flag.getAttribute('day');
            if (day !== null) town.townChopTime = parseInt(day, 10);
            const event = flag.getAttribute('event');
            if (event !== null) town.townChopKey = parseInt(event, 10);
            const kills = flag.getAttribute('kills');
            if (kills !== null) town.maxNumMonst = parseInt(kills, 10);
          } else if (ft === 'hidden') town.isHidden = text(flag) === 'true';
          else if (ft === 'strong-barriers') town.strongBarriers = text(flag) === 'true';
          else if (ft === 'defy-mapping') town.defyMapping = text(flag) === 'true';
          else if (ft === 'defy-scrying') town.defyScrying = text(flag) === 'true';
          else if (ft === 'tavern') town.hasTavern = text(flag) === 'true';
          else throw new Error(`${fname}: bad node <${ft}> in town flags`);
        }
        break;
      case 'wandering': {
        let numMonst = 0;
        for (const monst of children(elem)) {
          if (numMonst >= 4 || tag(monst) !== 'monster')
            throw new Error(`${fname}: bad town wandering`);
          town.wandering[numWand]![numMonst++] = intText(monst);
        }
        if (numMonst === 0) throw new Error(`${fname}: wandering missing <monster>`);
        numWand++;
        break;
      }
      case 'sign': {
        const sign = intAttr(elem, 'id');
        while (town.signLocs.length <= sign) town.signLocs.push({ x: 0, y: 0, text: '' });
        town.signLocs[sign]!.text = text(elem);
        break;
      }
      case 'string': {
        const str = intAttr(elem, 'id');
        while (town.specStrs.length <= str) town.specStrs.push('');
        town.specStrs[str] = text(elem);
        break;
      }
      case 'item': {
        const which = intAttr(elem, 'id');
        while (town.presetItems.length <= which) town.presetItems.push(defaultPresetItem());
        const item = town.presetItems[which]!;
        let foundType = false;
        for (const preset of children(elem)) {
          const pt = tag(preset);
          if (pt === 'type') {
            item.code = intText(preset);
            foundType = true;
          } else if (pt === 'mod') item.ability = intText(preset);
          else if (pt === 'charges') item.charges = intText(preset);
          else if (pt === 'always') item.alwaysThere = text(preset) === 'true';
          else if (pt === 'property') item.property = text(preset) === 'true';
          else if (pt === 'contained') item.contained = text(preset) === 'true';
          else throw new Error(`${fname}: bad node <${pt}> in town item`);
        }
        if (!foundType) throw new Error(`${fname}: town item ${which} missing <type>`);
        break;
      }
      case 'creature': {
        const who = intAttr(elem, 'id');
        while (town.creatures.length <= who) town.creatures.push(defaultTownperson());
        const npc = town.creatures[who]!;
        const reqsNpc = new Set(['type', 'attitude', 'mobility']);
        for (const monst of children(elem)) {
          const mt = tag(monst);
          reqsNpc.delete(mt);
          if (mt === 'type') npc.number = intText(monst);
          else if (mt === 'attitude')
            npc.startAttitude = readEnumTag(attitudeStrs, text(monst), 'attitude');
          else if (mt === 'mobility') npc.mobility = intText(monst);
          else if (mt === 'sdf') {
            const sdf = locFromXml(monst);
            npc.spec1 = sdf.x;
            npc.spec2 = sdf.y;
          } else if (mt === 'encounter') npc.specEncCode = intText(monst);
          else if (mt === 'time') {
            npc.timeFlag = readEnumTag(monstTimes, monst.getAttribute('type') ?? '', 'time type');
            for (const param of children(monst)) {
              if (tag(param) === 'day') npc.monsterTime = intText(param);
              else if (tag(param) === 'event') npc.timeCode = intText(param);
            }
          } else if (mt === 'face') npc.facialPic = intText(monst);
          else if (mt === 'personality') npc.personality = intText(monst);
          else if (mt === 'onkill') npc.specialOnKill = intText(monst);
          else if (mt === 'ontalk') npc.specialOnTalk = intText(monst);
          else throw new Error(`${fname}: bad node <${mt}> in town creature`);
        }
        if (reqsNpc.size > 0)
          throw new Error(`${fname}: creature ${who} missing <${reqsNpc.values().next().value}>`);
        break;
      }
      case 'area': {
        const r = rectFromXml(elem);
        town.areaDesc.push({ ...r, descr: text(elem) });
        break;
      }
      default:
        throw new Error(`${fname}: bad node <${type}> in town`);
    }
  }
  if (!town) throw new Error(`${fname}: town missing <size>`);
  if (reqs.size > 0)
    throw new Error(`${fname}: town missing <${reqs.values().next().value}>`);
  return town;
}

/** loadTownMapData — apply the .map grid + features to the town. */
export function loadTownMapData(data: MapData, town: Town, fname = ''): void {
  for (let x = 0; x < town.maxDim; x++) {
    for (let y = 0; y < town.maxDim; y++) {
      town.terrain[x]![y] = data.get(x, y);
      for (const feat of data.getFeatures(x, y)) {
        switch (feat.feature) {
          case MapFeature.SpecialNode:
            town.specialLocs.push({ x, y, spec: feat.value });
            break;
          case MapFeature.Sign:
            if (feat.value < town.signLocs.length) {
              town.signLocs[feat.value]!.x = x;
              town.signLocs[feat.value]!.y = y;
            }
            break;
          case MapFeature.Wandering:
            if (feat.value >= 0 && feat.value < 4) town.wanderingLocs[feat.value] = { x, y };
            break;
          case MapFeature.EntranceSouth:
            town.startLocs[0] = { x, y };
            break;
          case MapFeature.EntranceWest:
            town.startLocs[1] = { x, y };
            break;
          case MapFeature.EntranceNorth:
            town.startLocs[2] = { x, y };
            break;
          case MapFeature.EntranceEast:
            town.startLocs[3] = { x, y };
            break;
          case MapFeature.Field:
            town.presetFields.push({ loc: { x, y }, type: feat.value });
            break;
          case MapFeature.Item:
            if (feat.value < town.presetItems.length)
              town.presetItems[feat.value]!.loc = { x, y };
            break;
          case MapFeature.Creature:
            if (feat.value < town.creatures.length)
              town.creatures[feat.value]!.startLoc = { x, y };
            break;
          case MapFeature.Boat:
          case MapFeature.Horse:
            // Scenario-level vehicle lists — deferred with the party model.
            break;
          default:
            break;
        }
      }
    }
  }
  void fname;
}

/** readDialogueFromXml — talkN.xml for town N. */
export function readDialogueFromXml(root: Element, townNum: number, fname: string): Speech {
  if (tag(root) !== 'dialogue') throw new Error(`${fname}: bad root <${tag(root)}>`);
  const talk = emptySpeech();
  for (const elem of children(root)) {
    const type = tag(elem);
    if (type === 'personality') {
      let id = intAttr(elem, 'id');
      if (id < townNum * 10 || id >= (townNum + 1) * 10)
        throw new Error(`${fname}: personality id ${id} out of range for town ${townNum}`);
      id %= 10;
      const who = talk.people[id]!;
      const reqsP = new Set(['title', 'look', 'name', 'job']);
      for (const w of children(elem)) {
        const wt = tag(w);
        reqsP.delete(wt);
        if (wt === 'title') who.title = text(w);
        else if (wt === 'look') who.look = text(w);
        else if (wt === 'name') who.name = text(w);
        else if (wt === 'job') who.job = text(w);
        else if (wt === 'unknown') who.dunno = text(w);
        else throw new Error(`${fname}: bad node <${wt}> in personality`);
      }
      if (reqsP.size > 0)
        throw new Error(`${fname}: personality missing <${reqsP.values().next().value}>`);
    } else if (type === 'node') {
      const node = emptyTalkNode();
      node.personality = intAttr(elem, 'for');
      let numKeys = 0;
      let numParams = 0;
      let numStrs = 0;
      let gotType = false;
      for (const n of children(elem)) {
        const nt = tag(n);
        if (nt === 'keyword') {
          let val = text(n);
          while (val.length < 4) val += 'x';
          if (numKeys === 0) node.link1 = val.slice(0, 4);
          else if (numKeys === 1) node.link2 = val.slice(0, 4);
          else throw new Error(`${fname}: too many keywords in talk node`);
          numKeys++;
        } else if (nt === 'type') {
          node.type = readEnumTag(talkNodes, text(n), 'talk node type');
          gotType = true;
        } else if (nt === 'param') {
          if (numParams >= 4) throw new Error(`${fname}: too many params in talk node`);
          node.extras[numParams++] = intText(n);
        } else if (nt === 'text') {
          if (numStrs === 0) node.str1 = text(n);
          else if (numStrs === 1) node.str2 = text(n);
          else throw new Error(`${fname}: too many <text> in talk node`);
          numStrs++;
        } else throw new Error(`${fname}: bad node <${nt}> in talk node`);
      }
      if (numKeys === 0) throw new Error(`${fname}: talk node missing <keyword>`);
      if (!gotType) throw new Error(`${fname}: talk node missing <type>`);
      if (numStrs === 0) throw new Error(`${fname}: talk node missing <text>`);
      talk.talkNodes.push(node);
    } else throw new Error(`${fname}: bad node <${type}> in dialogue`);
  }
  return talk;
}
