/**
 * monsters.xml reader — port of readMonstersFromXml (fileio_scen.cpp:1589)
 * with parseDice (fileio_scen.cpp:1401). Detailed ability records are
 * captured losslessly (RawAbility) until the M5 combat port.
 */

import {
  attitudeStrs,
  dmgNames,
  fieldNames,
  monstAbilTypes,
  monstAbils,
  monstMelee,
  monstMissiles,
  monstSummons,
  pcStatus,
  raceNames,
  readEnumTag,
  spellPats,
} from '../data/enumTags';
import { Monster, defaultMonster } from '../data/monster';
import { MonstAbil, MonstAbilCat, MonstGen, MonstSummon, abilityCategory } from '../data/monsterAbility';
import { boolText, children, intAttr, intText, tag, text } from './xml';

export function parseDice(str: string, where: string): { count: number; sides: number } {
  const m = /^([0-9]*)d([0-9]+)$/.exec(str);
  if (!m) throw new Error(`${where}: bad dice expression '${str}'`);
  return { count: m[1] === '' ? 1 : parseInt(m[1]!, 10), sides: parseInt(m[2]!, 10) };
}

/**
 * readMonstAbilFromXml (fileio_scen.cpp:1425). The element name picks the arm
 * of the union, the `type` attribute picks the slot, and the required-element
 * set is checked the same way the C++ does — including the two that only
 * become required once a general ability turns out not to be a touch.
 *
 * Note the odds/chance conversion: the XML holds a percentage and the game
 * stores **tenths of a percent**, so it is multiplied by 10 everywhere except
 * `radiate`, which the C++ reads as a plain integer.
 */
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
  const typeAttr = el.getAttribute('type') ?? '';
  if (typeAttr === '') throw new Error(`${fname}: <${element}> ability missing type attribute`);
  const key = readEnumTag(monstAbils, typeAttr, 'monster ability') as MonstAbil;
  if (key === MonstAbil.NO_ABIL || monst.abil[key]!.active)
    throw new Error(`${fname}: bad or repeated monster ability '${typeAttr}'`);
  const cat = abilityCategory(key);
  const abil = monst.abil[key]!;
  abil.active = true;

  const bad = (want: MonstAbilCat): void => {
    if (cat !== want) throw new Error(`${fname}: <${element}> can't hold ability '${typeAttr}'`);
  };
  const done = (reqs: Set<string>, what: string): void => {
    const missing = reqs.values().next();
    if (!missing.done) throw new Error(`${fname}: <${what}> is missing <${missing.value}>`);
  };
  /** A percentage in the file, tenths of a percent in the game. */
  const tenths = (child: Element): number => Math.trunc(parseFloat(text(child)) * 10);

  switch (element) {
    case 'general': {
      bad(MonstAbilCat.GENERAL);
      const reqs = new Set(['type', 'strength', 'chance']);
      if (key === MonstAbil.DAMAGE || key === MonstAbil.DAMAGE2 || key === MonstAbil.FIELD
        || key === MonstAbil.STATUS || key === MonstAbil.STATUS2 || key === MonstAbil.STUN) {
        reqs.add('extra');
      }
      for (const child of children(el)) {
        const t = tag(child);
        reqs.delete(t);
        switch (t) {
          case 'type':
            abil.gen.type = readEnumTag(monstAbilTypes, text(child), 'ability delivery');
            // Anything that isn't a touch needs a graphic and a range.
            if (abil.gen.type !== MonstGen.TOUCH) {
              reqs.add('missile');
              reqs.add('range');
            }
            break;
          case 'missile': abil.gen.pic = intText(child); break;
          case 'strength': abil.gen.strength = intText(child); break;
          case 'range': abil.gen.range = intText(child); break;
          case 'extra':
            if (key === MonstAbil.DAMAGE || key === MonstAbil.DAMAGE2) {
              abil.gen.extra = readEnumTag(dmgNames, text(child), 'damage type');
            } else if (key === MonstAbil.FIELD) {
              abil.gen.extra = readEnumTag(fieldNames, text(child), 'field type');
            } else if (key === MonstAbil.STATUS || key === MonstAbil.STATUS2
              || key === MonstAbil.STUN) {
              abil.gen.extra = readEnumTag(pcStatus, text(child), 'status');
            } else throw new Error(`${fname}: <extra> makes no sense for '${typeAttr}'`);
            break;
          case 'chance': abil.gen.odds = tenths(child); break;
          default: throw new Error(`${fname}: bad node <${t}> in <general>`);
        }
      }
      done(reqs, 'general');
      break;
    }
    case 'missile': {
      bad(MonstAbilCat.MISSILE);
      const reqs = new Set(['type', 'missile', 'strength', 'skill', 'range', 'chance']);
      for (const child of children(el)) {
        const t = tag(child);
        reqs.delete(t);
        switch (t) {
          case 'type':
            abil.missile.type = readEnumTag(monstMissiles, text(child), 'missile type');
            break;
          case 'missile': abil.missile.pic = intText(child); break;
          case 'strength': {
            const d = parseDice(text(child), `${fname} missile strength`);
            abil.missile.dice = d.count;
            abil.missile.sides = d.sides;
            break;
          }
          case 'skill': abil.missile.skill = intText(child); break;
          case 'range': abil.missile.range = intText(child); break;
          case 'chance': abil.missile.odds = tenths(child); break;
          default: throw new Error(`${fname}: bad node <${t}> in <missile>`);
        }
      }
      done(reqs, 'missile');
      break;
    }
    case 'summon': {
      bad(MonstAbilCat.SUMMON);
      // "type+what" stands for whichever of <type>, <lvl> and <race> appears:
      // one of them is required, and it sets both `type` and `what`.
      const reqs = new Set(['type+what', 'min', 'max', 'duration', 'chance']);
      for (const child of children(el)) {
        const t = tag(child);
        reqs.delete(t);
        switch (t) {
          case 'min': abil.summon.min = intText(child); break;
          case 'max': abil.summon.max = intText(child); break;
          case 'duration': abil.summon.len = intText(child); break;
          case 'chance': abil.summon.chance = tenths(child); break;
          case 'type': case 'lvl':
            abil.summon.what = intText(child);
            reqs.delete('type+what');
            abil.summon.type = readEnumTag(monstSummons, t, 'summon kind');
            break;
          case 'race':
            abil.summon.what = readEnumTag(raceNames, text(child), 'race');
            reqs.delete('type+what');
            abil.summon.type = MonstSummon.SPECIES;
            break;
          default: throw new Error(`${fname}: bad node <${t}> in <summon>`);
        }
      }
      done(reqs, 'summon');
      break;
    }
    case 'radiate': {
      bad(MonstAbilCat.RADIATE);
      const reqs = new Set(['type', 'chance']);
      for (const child of children(el)) {
        const t = tag(child);
        reqs.delete(t);
        switch (t) {
          case 'type': abil.radiate.type = readEnumTag(fieldNames, text(child), 'field type'); break;
          case 'pattern': abil.radiate.pat = readEnumTag(spellPats, text(child), 'spell pattern'); break;
          // Unlike everywhere else, this one is not scaled into tenths.
          case 'chance': abil.radiate.chance = intText(child); break;
          default: throw new Error(`${fname}: bad node <${t}> in <radiate>`);
        }
      }
      done(reqs, 'radiate');
      break;
    }
    case 'special': {
      bad(MonstAbilCat.SPECIAL);
      let n = 0;
      for (const child of children(el)) {
        const t = tag(child);
        if (n >= 3 || t !== 'param') throw new Error(`${fname}: bad node <${t}> in <special>`);
        if (n === 0) abil.special.extra1 = intText(child);
        else if (n === 1) abil.special.extra2 = intText(child);
        else abil.special.extra3 = intText(child);
        n++;
      }
      break;
    }
    default:
      throw new Error(`${fname}: bad ability node <${element}>`);
  }
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
