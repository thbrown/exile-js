/**
 * Scenario assembly — the load_scenario_v2 flow (fileio_scen.cpp:2340+)
 * for unpacked v2 scenario trees: scenario.xml, terrain.xml,
 * scenario.spec, then out/out{x}~{y}.{xml,map,spec} sector by sector.
 * (items.xml/monsters.xml/towns arrive with later milestones.)
 */

import { Scenario } from '../data/scenario';
import { SpecType } from '../data/special';
import { readItemsFromXml } from './itemsXml';
import { loadMap } from './mapParse';
import { readMonstersFromXml } from './monstersXml';
import { loadOutMapData, readOutdoorsFromXml } from './outdoorsXml';
import { buildOpcodeTable, parseSpecials } from './specialParse';
import { emptyScenario, readScenarioFromXml } from './scenarioXml';
import { ScenarioSource } from './source';
import { readTerrainFromXml } from './terrainXml';
import { loadTownMapData, readDialogueFromXml, readTownFromXml } from './townXml';
import { parseXmlDoc } from './xml';

export async function loadScenario(
  src: ScenarioSource,
  opcodes: Map<string, SpecType>,
): Promise<Scenario> {
  const hdr = readScenarioFromXml(
    await parseXmlDoc(await src.getText('scenario.xml'), 'scenario.xml'),
  );
  const scen = emptyScenario(hdr);

  scen.terTypes = readTerrainFromXml(
    await parseXmlDoc(await src.getText('terrain.xml'), 'terrain.xml'),
  );
  scen.scenItems = readItemsFromXml(
    await parseXmlDoc(await src.getText('items.xml'), 'items.xml'),
  );
  scen.scenMonsters = readMonstersFromXml(
    await parseXmlDoc(await src.getText('monsters.xml'), 'monsters.xml'),
  );
  scen.scenSpecials = parseSpecials(await src.getText('scenario.spec'), opcodes, 'scenario.spec');

  for (let t = 0; t < scen.numTowns; t++) {
    const base = `towns/town${t}`;
    const town = readTownFromXml(
      await parseXmlDoc(await src.getText(`${base}.xml`), `${base}.xml`),
      `${base}.xml`,
    );
    loadTownMapData(loadMap(await src.getText(`${base}.map`), true, `${base}.map`), town, base);
    town.specials = parseSpecials(await src.getText(`${base}.spec`), opcodes, `${base}.spec`);
    scen.towns.push(town);
    scen.townTalk.push(
      readDialogueFromXml(
        await parseXmlDoc(await src.getText(`towns/talk${t}.xml`), `talk${t}.xml`),
        t,
        `talk${t}.xml`,
      ),
    );
  }

  for (let x = 0; x < scen.outWidth; x++) {
    scen.outdoors.push([]);
    for (let y = 0; y < scen.outHeight; y++) {
      const base = `out/out${x}~${y}`;
      const sector = readOutdoorsFromXml(
        await parseXmlDoc(await src.getText(`${base}.xml`), `${base}.xml`),
        `${base}.xml`,
      );
      loadOutMapData(loadMap(await src.getText(`${base}.map`), false, `${base}.map`), sector, base);
      sector.specials = parseSpecials(await src.getText(`${base}.spec`), opcodes, `${base}.spec`);
      scen.outdoors[x]!.push(sector);
    }
  }
  return scen;
}

/** Load the opcode table from the strings resource. */
export async function loadOpcodes(fetchText: (url: string) => Promise<string>) {
  return buildOpcodeTable(await fetchText('/data/strings/specials-opcodes.txt'));
}
