/**
 * terrain.xml reader — port of readTerrainFromXml in
 * ../exile-wasm/src/fileio/fileio_scen.cpp:1170.
 */

import { readEnumTag, stepSounds, terBlocks, terTrims, terTypes } from '../data/enumTags';
import { Terrain, defaultTerrain } from '../data/terrain';
import { boolText, children, intAttr, intText, locFromXml, tag, text } from './xml';

export function readTerrainFromXml(root: Element, fname = 'terrain.xml'): Terrain[] {
  if (tag(root) !== 'terrains') throw new Error(`${fname}: bad root <${tag(root)}>`);
  const terTypesOut: Terrain[] = [];
  for (const elem of children(root)) {
    if (tag(elem) !== 'terrain') throw new Error(`${fname}: bad node <${tag(elem)}>`);
    const which = intAttr(elem, 'id');
    while (terTypesOut.length <= which) terTypesOut.push(defaultTerrain());
    const ter = defaultTerrain();
    terTypesOut[which] = ter;
    const reqs = new Set(['name', 'pic', 'map', 'blockage', 'special', 'trim', 'arena']);
    for (const child of children(elem)) {
      const type = tag(child);
      reqs.delete(type);
      switch (type) {
        case 'name':
          ter.name = text(child);
          break;
        case 'pic':
          ter.picture = intText(child);
          break;
        case 'map':
          ter.mapPic = intText(child);
          break;
        case 'blockage':
          ter.blockage = readEnumTag(terBlocks, text(child), 'blockage');
          break;
        case 'special': {
          let numFlags = 0;
          let foundType = false;
          for (const spec of children(child)) {
            const st = tag(spec);
            if (st === 'type') {
              ter.special = readEnumTag(terTypes, text(spec), 'terrain special');
              foundType = true;
            } else if (st === 'flag') {
              if (numFlags === 0) ter.flag1 = intText(spec);
              else if (numFlags === 1) ter.flag2 = intText(spec);
              else if (numFlags === 2) ter.flag3 = intText(spec);
              else throw new Error(`${fname}: too many <flag> in terrain ${which}`);
              numFlags++;
            } else throw new Error(`${fname}: bad node <${st}> in terrain special`);
          }
          if (!foundType) throw new Error(`${fname}: terrain ${which} special missing <type>`);
          break;
        }
        case 'transform':
          ter.transToWhat = intText(child);
          break;
        case 'fly':
          ter.flyOver = boolText(child);
          break;
        case 'boat':
          ter.boatOver = boolText(child);
          break;
        case 'ride':
          ter.blockHorse = !boolText(child);
          break;
        case 'archetype':
          ter.isArchetype = boolText(child);
          break;
        case 'light':
          ter.lightRadius = intText(child);
          break;
        case 'step-sound':
          ter.stepSound = readEnumTag(stepSounds, text(child), 'step-sound');
          break;
        case 'trim':
          ter.trimType = readEnumTag(terTrims, text(child), 'trim');
          break;
        case 'trim-for':
          ter.trimTer = intText(child);
          break;
        case 'ground':
          ter.groundType = intText(child);
          break;
        case 'arena':
          ter.combatArena = intText(child);
          break;
        case 'editor':
          for (const edit of children(child)) {
            const et = tag(edit);
            if (et === 'shortcut') {
              ter.shortcutKey = text(edit).slice(0, 1);
            } else if (et === 'frill') {
              ter.frillFor = intText(edit);
              const chance = edit.getAttribute('chance');
              ter.frillChance = chance === null ? 10 : parseInt(chance, 10);
            } else if (et === 'object') {
              for (const obj of children(edit)) {
                const ot = tag(obj);
                if (ot === 'num') ter.objNum = intText(obj);
                else if (ot === 'pos') ter.objPos = locFromXml(obj);
                else if (ot === 'size') ter.objSize = locFromXml(obj);
                else throw new Error(`${fname}: bad node <${ot}> in terrain object`);
              }
            } else throw new Error(`${fname}: bad node <${et}> in terrain editor`);
          }
          break;
        default:
          throw new Error(`${fname}: bad node <${type}> in terrain ${which}`);
      }
    }
    if (reqs.size > 0)
      throw new Error(`${fname}: terrain ${which} missing <${reqs.values().next().value}>`);
  }
  return terTypesOut;
}
