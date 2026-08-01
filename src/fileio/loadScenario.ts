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
  // Fired once the header is parsed and the remaining file count is known,
  // so a caller can size a progress bar before the town/sector fetches start.
  onExtraFilesKnown?: (count: number) => void,
): Promise<Scenario> {
  const hdr = readScenarioFromXml(
    await parseXmlDoc(await src.getText('scenario.xml'), 'scenario.xml'),
  );
  const scen = emptyScenario(hdr);
  onExtraFilesKnown?.(4 + scen.numTowns * 4 + scen.outWidth * scen.outHeight * 3);

  scen.terTypes = readTerrainFromXml(
    await parseXmlDoc(await src.getText('terrain.xml'), 'terrain.xml'),
  );
  scen.scenItems = readItemsFromXml(
    await parseXmlDoc(await src.getText('items.xml'), 'items.xml'),
  );
  scen.scenMonsters = readMonstersFromXml(
    await parseXmlDoc(await src.getText('monsters.xml'), 'monsters.xml'),
  );
  // fileio_scen.cpp:1395 — shops name items by index, so they can only be
  // filled in once the item list exists.
  for (const shop of scen.shops) shop.refreshItems(scen.scenItems);
  scen.scenSpecials = parseSpecials(await src.getText('scenario.spec'), opcodes, 'scenario.spec');

  // Each town/sector's own files are fetched up front (promises started
  // immediately, not awaited yet) so the network runs them concurrently;
  // they're still awaited and parsed in original order below, so
  // scen.boats/horses and the push order stay exactly as sequential as
  // before — only the I/O overlaps, not the parsing.
  const townFetches = Array.from({ length: scen.numTowns }, (_, t) => {
    const base = `towns/town${t}`;
    return {
      xml: src.getText(`${base}.xml`),
      map: src.getText(`${base}.map`),
      spec: src.getText(`${base}.spec`),
      talk: src.getText(`towns/talk${t}.xml`),
    };
  });
  for (let t = 0; t < scen.numTowns; t++) {
    const base = `towns/town${t}`;
    const f = townFetches[t]!;
    const town = readTownFromXml(await parseXmlDoc(await f.xml, `${base}.xml`), `${base}.xml`);
    loadTownMapData(
      loadMap(await f.map, true, `${base}.map`),
      town, t, scen.boats, scen.horses, base,
    );
    town.specials = parseSpecials(await f.spec, opcodes, `${base}.spec`);
    scen.towns.push(town);
    scen.townTalk.push(readDialogueFromXml(await parseXmlDoc(await f.talk, `talk${t}.xml`), t, `talk${t}.xml`));
  }

  const sectorFetches = Array.from({ length: scen.outWidth }, (_, x) => Array.from({ length: scen.outHeight }, (_, y) => {
    const base = `out/out${x}~${y}`;
    return { xml: src.getText(`${base}.xml`), map: src.getText(`${base}.map`), spec: src.getText(`${base}.spec`) };
  }));
  for (let x = 0; x < scen.outWidth; x++) {
    scen.outdoors.push([]);
    for (let y = 0; y < scen.outHeight; y++) {
      const base = `out/out${x}~${y}`;
      const f = sectorFetches[x]![y]!;
      const sector = readOutdoorsFromXml(await parseXmlDoc(await f.xml, `${base}.xml`), `${base}.xml`);
      loadOutMapData(
        loadMap(await f.map, false, `${base}.map`),
        sector, { x, y }, scen.boats, scen.horses, base,
      );
      sector.specials = parseSpecials(await f.spec, opcodes, `${base}.spec`);
      scen.outdoors[x]!.push(sector);
    }
  }
  return scen;
}

/** Load the opcode table from the strings resource. */
export async function loadOpcodes(fetchText: (url: string) => Promise<string>) {
  return buildOpcodeTable(await fetchText('/data/strings/specials-opcodes.txt'));
}
