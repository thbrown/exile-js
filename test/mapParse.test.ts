/**
 * Mirrors the "Loading map data from file" sections of
 * ../exile-wasm/test/map_read.cpp against the same fixtures.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MapFeature, MapParseError, loadMap } from '../src/fileio/mapParse';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/maps/${name}`, import.meta.url), 'utf8');
}

describe('loadMap', () => {
  it('parses a basic grid', () => {
    const map = loadMap(fixture('basic.map'), true, 'basic.map');
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++) expect(map.get(x, y)).toBe(1 + y * 5 + x);
  });

  it('parses vehicles with ownership sign', () => {
    const map = loadMap(fixture('vehicles.map'), true, 'vehicles.map');
    expect(map.getFeatures(0, 0)).toEqual([{ feature: MapFeature.Horse, value: 2 }]);
    expect(map.getFeatures(1, 0)).toEqual([{ feature: MapFeature.Horse, value: -3 }]);
    expect(map.getFeatures(2, 0)).toEqual([{ feature: MapFeature.Boat, value: 4 }]);
    expect(map.getFeatures(3, 0)).toEqual([{ feature: MapFeature.Boat, value: -5 }]);
  });

  it('parses fields (values are the eFieldType numbers 1..25)', () => {
    const map = loadMap(fixture('fields.map'), true, 'fields.map');
    // fields.map lays out field types 1..25 in reading order, 4 per row
    for (let i = 0; i < 25; i++) {
      const x = i % 4;
      const y = Math.floor(i / 4);
      expect(map.getFeatures(x, y)).toEqual([{ feature: MapFeature.Field, value: i + 1 }]);
    }
  });

  it('parses town entrance on outdoor maps as TOWN feature', () => {
    const map = loadMap(fixture('towns_out.map'), false, 'towns_out.map');
    expect(map.getFeatures(1, 1)).toEqual([{ feature: MapFeature.Town, value: 5 }]);
    expect(map.get(1, 1)).toBe(12);
  });

  it('parses town start-loc entrance arrows', () => {
    const map = loadMap(fixture('towns_entry.map'), true, 'towns_entry.map');
    expect(map.getFeatures(4, 0)).toEqual([{ feature: MapFeature.EntranceNorth, value: 0 }]);
    expect(map.getFeatures(0, 1)).toEqual([{ feature: MapFeature.EntranceWest, value: 0 }]);
    expect(map.getFeatures(8, 1)).toEqual([{ feature: MapFeature.EntranceEast, value: 0 }]);
    expect(map.getFeatures(4, 2)).toEqual([{ feature: MapFeature.EntranceSouth, value: 0 }]);
  });

  it('parses misc features (@ means item in towns)', () => {
    const map = loadMap(fixture('misc.map'), true, 'misc.map');
    expect(map.getFeatures(0, 0)).toEqual([{ feature: MapFeature.Wandering, value: 1 }]);
    expect(map.getFeatures(1, 0)).toEqual([{ feature: MapFeature.SpecialNode, value: 2 }]);
    expect(map.getFeatures(2, 0)).toEqual([{ feature: MapFeature.Sign, value: 3 }]);
    expect(map.getFeatures(3, 0)).toEqual([{ feature: MapFeature.Item, value: 4 }]);
    expect(map.getFeatures(4, 0)).toEqual([{ feature: MapFeature.Creature, value: 5 }]);
  });

  it('rejects entrance arrows on outdoor maps', () => {
    expect(() => loadMap(fixture('towns_entry.map'), false, 'towns_entry.map')).toThrow(
      MapParseError,
    );
  });

  it('rejects unknown feature characters', () => {
    expect(() => loadMap(fixture('bad_feature.map'), true, 'bad_feature.map')).toThrow(
      MapParseError,
    );
  });

  it('ignores comments and blank lines', () => {
    const map = loadMap('1,2 # trailing comment\n\n3,4\n', true, 'inline');
    expect(map.get(0, 0)).toBe(1);
    expect(map.get(1, 0)).toBe(2);
    expect(map.get(0, 1)).toBe(3);
    expect(map.get(1, 1)).toBe(4);
  });
});
