/**
 * Outdoor sector XML + map loading — ports of readOutdoorsFromXml
 * (fileio_scen.cpp:1732) and loadOutMapData (fileio_scen.cpp:2130).
 */

import { FieldType } from '../data/fields';
import { AmbientSound, OutWandering, SECTOR_SIZE, Sector } from '../data/outdoors';
import { MapData, MapFeature } from './mapParse';
import { children, intText, locFromXml, rectFromXml, tag, text } from './xml';

export function readOutdoorsFromXml(root: Element, fname: string): Sector {
  if (tag(root) !== 'sector') throw new Error(`${fname}: bad root <${tag(root)}>`);
  const out = new Sector();
  let numRects = 0;
  let numEncs = 0;
  let numWand = 0;
  let foundName = false;
  for (const elem of children(root)) {
    const type = tag(elem);
    switch (type) {
      case 'name':
        out.name = text(elem);
        foundName = true;
        break;
      case 'comment':
        out.comment = text(elem);
        break;
      case 'sound': {
        const val = text(elem);
        if (val === 'birds') out.ambientSound = AmbientSound.BIRD;
        else if (val === 'drip') out.ambientSound = AmbientSound.DRIP;
        else {
          out.ambientSound = AmbientSound.CUSTOM;
          out.outSound = parseInt(val, 10);
        }
        break;
      }
      case 'encounter':
      case 'wandering': {
        const isEnc = type === 'encounter';
        const count = isEnc ? numEncs : numWand;
        if (count >= 4) throw new Error(`${fname}: too many <${type}> elements`);
        const encList = isEnc ? out.specialEnc : out.wandering;
        const enc: OutWandering = encList[count]!;
        if (elem.getAttribute('can-flee') !== null)
          enc.cantFlee = elem.getAttribute('can-flee') !== 'true';
        if (elem.getAttribute('force') !== null) enc.forced = elem.getAttribute('force') === 'true';
        let numHostile = 0;
        let numFriendly = 0;
        for (const e of children(elem)) {
          const et = tag(e);
          if (et === 'monster') {
            const isFriendly = e.getAttribute('friendly') === 'true';
            if ((isFriendly && numFriendly >= 3) || (!isFriendly && numHostile >= 7))
              throw new Error(`${fname}: too many monsters in <${type}>`);
            if (isFriendly) enc.friendly[numFriendly++] = intText(e);
            else enc.monst[numHostile++] = intText(e);
          } else if (et === 'onmeet') enc.specOnMeet = intText(e);
          else if (et === 'onflee') enc.specOnFlee = intText(e);
          else if (et === 'onwin') enc.specOnWin = intText(e);
          else if (et === 'sdf') {
            const sdf = locFromXml(e);
            enc.endSpec1 = sdf.x;
            enc.endSpec2 = sdf.y;
          } else throw new Error(`${fname}: bad node <${et}> in <${type}>`);
        }
        if (numHostile + numFriendly === 0)
          throw new Error(`${fname}: <${type}> missing <monster>`);
        if (isEnc) numEncs++;
        else numWand++;
        break;
      }
      case 'sign': {
        const sign = parseInt(elem.getAttribute('id') ?? '', 10);
        while (out.signLocs.length <= sign) out.signLocs.push({ x: 0, y: 0, text: '' });
        out.signLocs[sign]!.text = text(elem);
        break;
      }
      case 'area': {
        const r = rectFromXml(elem);
        out.areaDesc[numRects] = { ...r, descr: text(elem) };
        numRects++;
        break;
      }
      case 'string': {
        const str = parseInt(elem.getAttribute('id') ?? '', 10);
        while (out.specStrs.length <= str) out.specStrs.push('');
        out.specStrs[str] = text(elem);
        break;
      }
      default:
        throw new Error(`${fname}: bad node <${type}> in sector`);
    }
  }
  if (!foundName) throw new Error(`${fname}: sector missing <name>`);
  return out;
}

/** Apply a parsed .map grid + features to a sector (loadOutMapData). */
export function loadOutMapData(data: MapData, out: Sector, fname = ''): void {
  for (let x = 0; x < SECTOR_SIZE; x++) {
    for (let y = 0; y < SECTOR_SIZE; y++) {
      out.terrain[x]![y] = data.get(x, y);
      for (const feat of data.getFeatures(x, y)) {
        switch (feat.feature) {
          case MapFeature.Town:
            out.cityLocs.push({ x, y, spec: feat.value });
            break;
          case MapFeature.SpecialNode:
            out.specialLocs.push({ x, y, spec: feat.value });
            break;
          case MapFeature.Field:
            if (feat.value === FieldType.SPECIAL_SPOT) out.specialSpot[x]![y] = true;
            else if (feat.value === FieldType.SPECIAL_ROAD) out.roads[x]![y] = true;
            else throw new Error(`${fname}: illegal outdoor field type ${feat.value}`);
            break;
          case MapFeature.Sign:
            if (feat.value < out.signLocs.length) {
              out.signLocs[feat.value]!.x = x;
              out.signLocs[feat.value]!.y = y;
            }
            break;
          case MapFeature.Wandering:
            if (feat.value >= 0 && feat.value < 4) out.wanderingLocs[feat.value] = { x, y };
            break;
          case MapFeature.Boat:
          case MapFeature.Horse:
            // Vehicles land in scenario-level lists — deferred until the
            // party/vehicle model exists (M2).
            break;
          default:
            break;
        }
      }
    }
  }
}
