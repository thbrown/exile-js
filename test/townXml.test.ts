import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TalkNodeType } from '../src/data/talking';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

function source(scen: string): FsSource {
  return new FsSource(fileURLToPath(new URL(`../public/scenarios/${scen}`, import.meta.url)));
}

describe('towns in loadScenario', () => {
  it('loads all 21 valleydy towns with terrain, creatures, and dialogue', async () => {
    const scen = await loadScenario(source('valleydy'), opcodes);
    expect(scen.towns.length).toBe(21);
    expect(scen.townTalk.length).toBe(21);

    const fort = scen.towns[0]!; // start town: Fort Talrus
    expect(fort.name.length).toBeGreaterThan(0);
    expect(fort.maxDim).toBeGreaterThanOrEqual(24);
    // Terrain ids all valid
    for (let x = 0; x < fort.maxDim; x++)
      for (let y = 0; y < fort.maxDim; y++)
        expect(fort.terrain[x]![y]!).toBeLessThan(scen.terTypes.length);
    // The start town has NPCs placed by the map ($ features)
    expect(fort.creatures.length).toBeGreaterThan(0);
    expect(fort.creatures.some((c) => c.startLoc.x !== 80)).toBe(true);
    // Specials parsed and wired to locations
    expect(fort.specials.size).toBeGreaterThan(0);
    expect(fort.specialLocs.length).toBeGreaterThan(0);

    // Dialogue: Commander Terrance from talk0.xml
    const talk = scen.townTalk[0]!;
    expect(talk.people[0]!.title).toBe('Cmd. Terrance');
    expect(talk.talkNodes.length).toBeGreaterThan(0);
    expect(talk.talkNodes.every((n) => n.link1.length === 4)).toBe(true);
    expect(talk.talkNodes.some((n) => n.type === TalkNodeType.REGULAR)).toBe(true);
  });

  it('loads towns in all bundled scenarios', async () => {
    for (const name of ['stealth', 'zakhazi', 'busywork']) {
      const scen = await loadScenario(source(name), opcodes);
      expect(scen.towns.length).toBe(scen.numTowns);
      for (const town of scen.towns) expect(town.maxDim).toBeGreaterThanOrEqual(24);
    }
  });
});
