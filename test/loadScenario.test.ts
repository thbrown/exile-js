import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECTOR_SIZE } from '../src/data/outdoors';
import { TerObstruct } from '../src/data/terrain';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

function source(scen: string): FsSource {
  return new FsSource(fileURLToPath(new URL(`../public/scenarios/${scen}`, import.meta.url)));
}

describe('loadScenario (valleydy)', () => {
  it('loads header, terrain, sectors, and specials', async () => {
    const scen = await loadScenario(source('valleydy'), opcodes);
    expect(scen.title).toBe('Valley of Dying Things');
    expect(scen.numTowns).toBe(21);
    expect(scen.outWidth).toBe(3);
    expect(scen.outHeight).toBe(3);
    expect(scen.startTown).toBe(0);
    expect(scen.outdoorStart).toEqual({ x: 2, y: 2 });
    expect(scen.sectorStart).toEqual({ x: 23, y: 39 });

    // Terrain: 0/1 are cave floor (clear), and there must be walls that block
    expect(scen.terTypes.length).toBeGreaterThan(100);
    expect(scen.terTypes[0]!.name).toBe('Cave Floor');
    expect(scen.terTypes[0]!.blockage).toBe(TerObstruct.CLEAR);
    expect(scen.terTypes.some((t) => t.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT)).toBe(true);

    // Sectors: 3×3 grid of 48×48 terrain, all terrain ids valid
    expect(scen.outdoors.length).toBe(3);
    const start = scen.outdoors[2]![2]!;
    expect(start.name.length).toBeGreaterThan(0);
    for (let x = 0; x < SECTOR_SIZE; x++)
      for (let y = 0; y < SECTOR_SIZE; y++) {
        const t = start.terrain[x]![y]!;
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThan(scen.terTypes.length);
      }

    // Sector 0,0 from the XML we inspected: forced encounter with monster 38
    const nw = scen.outdoors[0]![0]!;
    expect(nw.name).toBe('Northwestern Vale');
    expect(nw.specialEnc[0]!.forced).toBe(true);
    expect(nw.specialEnc[0]!.monst).toContain(38);
    expect(nw.specStrs.some((s) => s.includes('goblins'))).toBe(true);

    // Scenario-level specials parsed
    expect(scen.scenSpecials.size).toBeGreaterThan(10);
  });

  it('start sector has at least one town entrance and specials wired', async () => {
    const scen = await loadScenario(source('valleydy'), opcodes);
    const allCities = scen.outdoors.flat().flatMap((s) => s.cityLocs);
    expect(allCities.length).toBeGreaterThan(0);
    const allSpecials = scen.outdoors.flat().flatMap((s) => s.specialLocs);
    expect(allSpecials.length).toBeGreaterThan(0);
  });
});

describe('loadScenario (all bundled scenarios)', () => {
  for (const name of ['valleydy', 'stealth', 'zakhazi', 'busywork']) {
    it(`loads ${name} without errors`, async () => {
      const scen = await loadScenario(source(name), opcodes);
      expect(scen.title.length).toBeGreaterThan(0);
      expect(scen.outdoors.length).toBe(scen.outWidth);
      expect(scen.outdoors[0]!.length).toBe(scen.outHeight);
      expect(scen.terTypes.length).toBeGreaterThan(0);
    });
  }
});
