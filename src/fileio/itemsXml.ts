/**
 * items.xml reader — port of readItemsFromXml (fileio_scen.cpp:1292).
 */

import { itemAbils, itemTypes, itemUses, readEnumTag, skillNames } from '../data/enumTags';
import { Item, defaultItem } from '../data/item';
import { boolText, children, intAttr, intText, tag, text } from './xml';

export function readItemsFromXml(root: Element, fname = 'items.xml'): Item[] {
  if (tag(root) !== 'items') throw new Error(`${fname}: bad root <${tag(root)}>`);
  const items: Item[] = [];
  for (const elem of children(root)) {
    if (tag(elem) !== 'item') throw new Error(`${fname}: bad node <${tag(elem)}>`);
    const which = intAttr(elem, 'id');
    while (items.length <= which) items.push(defaultItem());
    const item = defaultItem();
    items[which] = item;
    const reqs = new Set(['variety', 'level', 'pic', 'value', 'weight', 'name', 'full-name']);
    for (const child of children(elem)) {
      const type = tag(child);
      reqs.delete(type);
      switch (type) {
        case 'variety':
          item.variety = readEnumTag(itemTypes, text(child), 'item variety');
          break;
        case 'level':
          item.itemLevel = intText(child);
          break;
        case 'awkward':
          item.awkward = intText(child);
          break;
        case 'bonus':
          item.bonus = intText(child);
          break;
        case 'protection':
          item.protection = intText(child);
          break;
        case 'charges':
          item.charges = intText(child);
          item.maxCharges = item.charges;
          break;
        case 'weapon-type':
          item.weapType = readEnumTag(skillNames, text(child), 'weapon-type');
          break;
        case 'missile-type':
          item.missile = intText(child);
          break;
        case 'pic':
          item.graphicNum = intText(child);
          break;
        case 'flag':
          item.typeFlag = intText(child);
          break;
        case 'value':
          item.value = intText(child);
          break;
        case 'weight':
          item.weight = intText(child);
          break;
        case 'class':
          item.specialClass = intText(child);
          break;
        case 'name':
          item.name = text(child);
          break;
        case 'full-name':
          item.fullName = text(child);
          break;
        case 'treasure':
          item.treasClass = intText(child);
          break;
        case 'ability': {
          const reqsAbil = new Set(['type', 'strength', 'data']);
          for (const abil of children(child)) {
            const at = tag(abil);
            reqsAbil.delete(at);
            if (at === 'type') item.ability = readEnumTag(itemAbils, text(abil), 'item ability');
            else if (at === 'strength') item.abilStrength = intText(abil);
            else if (at === 'data') item.abilData = intText(abil);
            else if (at === 'use-flag')
              item.magicUseType = readEnumTag(itemUses, text(abil), 'use-flag');
            else throw new Error(`${fname}: bad node <${at}> in item ability`);
          }
          if (reqsAbil.size > 0)
            throw new Error(`${fname}: item ${which} ability missing <${reqsAbil.values().next().value}>`);
          break;
        }
        case 'properties':
          for (const prop of children(child)) {
            const pt = tag(prop);
            const state = boolText(prop);
            if (pt === 'identified') item.ident = state;
            else if (pt === 'magic') item.magic = state;
            else if (pt === 'cursed') item.cursed = state;
            else if (pt === 'concealed') item.concealed = state;
            else if (pt === 'enchanted') item.enchanted = state;
            else if (pt === 'rechargeable') item.rechargeable = state;
            else if (pt === 'unsellable') item.unsellable = state;
            else throw new Error(`${fname}: bad node <${pt}> in item properties`);
          }
          break;
        case 'description':
          item.desc = text(child);
          break;
        default:
          throw new Error(`${fname}: bad node <${type}> in item ${which}`);
      }
    }
    if (reqs.size > 0)
      throw new Error(`${fname}: item ${which} missing <${reqs.values().next().value}>`);
  }
  return items;
}
