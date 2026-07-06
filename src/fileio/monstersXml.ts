/**
 * monsters.xml reader — port of readMonstersFromXml (fileio_scen.cpp:1589)
 * with parseDice (fileio_scen.cpp:1401). Detailed ability records are
 * captured losslessly (RawAbility) until the M5 combat port.
 */

import {
  attitudeStrs,
  dmgNames,
  monstMelee,
  raceNames,
  readEnumTag,
} from '../data/enumTags';
import { Monster, RawAbility, defaultMonster } from '../data/monster';
import { boolText, children, intAttr, intText, tag, text } from './xml';

export function parseDice(str: string, where: string): { count: number; sides: number } {
  const m = /^([0-9]*)d([0-9]+)$/.exec(str);
  if (!m) throw new Error(`${where}: bad dice expression '${str}'`);
  return { count: m[1] === '' ? 1 : parseInt(m[1]!, 10), sides: parseInt(m[2]!, 10) };
}

function readAbility(el: Element, monst: Monster, fname: string): void {
  const element = tag(el);
  if (element === 'invisible') {
    monst.invisible = true;
    return;
  }
  if (element === 'guard') {
    monst.guard = true;
    return;
  }
  const abilType = el.getAttribute('type') ?? '';
  if (abilType === '') throw new Error(`${fname}: <${element}> ability missing type attribute`);
  const raw: RawAbility = { element, abilType, fields: {} };
  for (const child of children(el)) {
    raw.fields[tag(child)] = text(child);
  }
  monst.abilities.push(raw);
}

export function readMonstersFromXml(root: Element, fname = 'monsters.xml'): Monster[] {
  if (tag(root) !== 'monsters') throw new Error(`${fname}: bad root <${tag(root)}>`);
  const monsters: Monster[] = [defaultMonster()]; // id 0 is reserved/invalid
  for (const elem of children(root)) {
    if (tag(elem) !== 'monster') throw new Error(`${fname}: bad node <${tag(elem)}>`);
    const which = intAttr(elem, 'id');
    if (which === 0) throw new Error(`${fname}: monster id 0 is not allowed`);
    while (monsters.length <= which) monsters.push(defaultMonster());
    const mon = defaultMonster();
    monsters[which] = mon;
    const reqs = new Set([
      'name', 'level', 'armor', 'skill', 'hp', 'speed', 'race', 'attacks', 'pic', 'attitude',
      'immunity',
    ]);
    for (const child of children(elem)) {
      const type = tag(child);
      reqs.delete(type);
      switch (type) {
        case 'name':
          mon.name = text(child);
          break;
        case 'level':
          mon.level = intText(child);
          break;
        case 'armor':
          mon.armor = intText(child);
          break;
        case 'skill':
          mon.skill = intText(child);
          break;
        case 'hp':
          mon.health = intText(child);
          break;
        case 'speed':
          mon.speed = intText(child);
          break;
        case 'treasure':
          mon.treasure = intText(child);
          break;
        case 'mage':
          mon.mu = intText(child);
          break;
        case 'priest':
          mon.cl = intText(child);
          break;
        case 'race':
          mon.race = readEnumTag(raceNames, text(child), 'race');
          break;
        case 'abilities':
          for (const abil of children(child)) readAbility(abil, mon, fname);
          break;
        case 'attacks': {
          for (const atk of children(child)) {
            if (mon.attacks.length >= 3 || tag(atk) !== 'attack')
              throw new Error(`${fname}: bad attack node in monster ${which}`);
            const atkType = atk.getAttribute('type');
            if (atkType === null)
              throw new Error(`${fname}: attack missing type in monster ${which}`);
            const dice = parseDice(text(atk), `${fname} monster ${which}`);
            mon.attacks.push({
              dice: dice.count,
              sides: dice.sides,
              type: readEnumTag(monstMelee, atkType, 'attack type'),
            });
          }
          break;
        }
        case 'pic':
          mon.pictureNum = intText(child);
          mon.xWidth = intAttr(child, 'w');
          mon.yWidth = intAttr(child, 'h');
          break;
        case 'default-face':
          mon.defaultFacialPic = intText(child);
          break;
        case 'onsight':
          mon.seeSpec = intText(child);
          break;
        case 'voice':
          mon.ambientSound = intText(child);
          break;
        case 'summon':
          mon.summonType = intText(child);
          break;
        case 'attitude':
          mon.defaultAttitude = readEnumTag(attitudeStrs, text(child), 'attitude');
          break;
        case 'immunity':
          for (const resist of children(child)) {
            const rt = tag(resist);
            if (rt === 'all') mon.invuln = boolText(resist);
            else if (rt === 'fear') mon.mindless = boolText(resist);
            else if (rt === 'assassinate') mon.amorphous = boolText(resist);
            else mon.resist[readEnumTag(dmgNames, rt, 'damage type')] = intText(resist);
          }
          break;
        case 'loot': {
          const reqsLoot = new Set(['type', 'chance']);
          for (const loot of children(child)) {
            const lt = tag(loot);
            reqsLoot.delete(lt);
            if (lt === 'type') mon.corpseItem = intText(loot);
            else if (lt === 'chance') mon.corpseItemChance = intText(loot);
            else throw new Error(`${fname}: bad node <${lt}> in monster loot`);
          }
          if (reqsLoot.size > 0)
            throw new Error(`${fname}: monster ${which} loot missing <${reqsLoot.values().next().value}>`);
          break;
        }
        default:
          throw new Error(`${fname}: bad node <${type}> in monster ${which}`);
      }
    }
    if (reqs.size > 0)
      throw new Error(`${fname}: monster ${which} missing <${reqs.values().next().value}>`);
  }
  return monsters;
}
