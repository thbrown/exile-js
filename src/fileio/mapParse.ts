/**
 * Parser for the .map terrain-grid format: comma-separated terrain numbers,
 * one row per line, with inline feature annotations after each number
 * (e.g. `36&9`, `40*1`, `121!0`, `12:3@2`) and `# comments`.
 * Verbatim port of ../exile-wasm/src/fileio/map_parse.cpp.
 */

export enum MapFeature {
  None = 'none', // sentinel, never stored
  SpecialNode = 'special',
  Sign = 'sign',
  Wandering = 'wandering',
  Town = 'town',
  Boat = 'boat',
  Horse = 'horse',
  EntranceNorth = 'entrance-north',
  EntranceWest = 'entrance-west',
  EntranceSouth = 'entrance-south',
  EntranceEast = 'entrance-east',
  Item = 'item',
  Creature = 'creature',
  Field = 'field',
}

export interface Feature {
  feature: MapFeature;
  value: number;
}

export class MapParseError extends Error {
  constructor(
    message: string,
    readonly char: string,
    readonly row: number,
    readonly col: number,
    readonly file: string,
  ) {
    super(`${message}${char} (${file}:${row + 1}, col ${col})`);
  }
}

export class MapData {
  private grid: number[][] = [];
  private features = new Map<string, Feature[]>();

  constructor(readonly file = '') {}

  set(x: number, y: number, val: number): void {
    while (this.grid.length <= y) this.grid.push([]);
    const row = this.grid[y]!;
    while (row.length <= x) row.push(0);
    row[x] = val;
  }

  get(x: number, y: number): number {
    return this.grid[y]?.[x] ?? 0;
  }

  get height(): number {
    return this.grid.length;
  }

  get width(): number {
    return this.grid.reduce((m, row) => Math.max(m, row.length), 0);
  }

  addFeature(x: number, y: number, feature: MapFeature, value = 0): void {
    const key = `${x},${y}`;
    const list = this.features.get(key);
    if (list) list.push({ feature, value });
    else this.features.set(key, [{ feature, value }]);
  }

  getFeatures(x: number, y: number): Feature[] {
    return this.features.get(`${x},${y}`) ?? [];
  }

  /** All features with their locations, for building lookup tables. */
  allFeatures(): { x: number; y: number; feature: MapFeature; value: number }[] {
    const out: { x: number; y: number; feature: MapFeature; value: number }[] = [];
    for (const [key, list] of this.features) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      for (const f of list) out.push({ x, y, feature: f.feature, value: f.value });
    }
    return out;
  }
}

const DIGITS = /[0-9]/;

export function loadMap(text: string, isTown: boolean, name = ''): MapData {
  const data = new MapData(name);
  let row = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') continue;
    let n = 0;
    let col = 0;
    let curFeature = MapFeature.None;
    let vehicleOwned = false;

    const flush = (): void => {
      if (curFeature === MapFeature.None) {
        data.set(col, row, n);
      } else {
        let v = n;
        if ((curFeature === MapFeature.Boat || curFeature === MapFeature.Horse) && !vehicleOwned)
          v = -v;
        data.addFeature(col, row, curFeature, v);
      }
      n = 0;
    };

    let done = false;
    for (const c of line) {
      if (done) break;
      if (c === '#') {
        done = true;
        continue;
      }
      if (/\s/.test(c)) continue;
      if (DIGITS.test(c)) {
        n = n * 10 + (c.charCodeAt(0) - 48);
      } else if (c === '^' || c === '<' || c === 'v' || c === '>') {
        if (!isTown)
          throw new MapParseError(
            'Outdoors map has illegal town entrance direction feature: ',
            c,
            row,
            col,
            name,
          );
        const dir = {
          '^': MapFeature.EntranceNorth,
          '<': MapFeature.EntranceWest,
          v: MapFeature.EntranceSouth,
          '>': MapFeature.EntranceEast,
        }[c]!;
        data.addFeature(col, row, dir);
      } else {
        flush();
        if (c === '*') curFeature = MapFeature.Wandering;
        else if (c === ':') curFeature = MapFeature.SpecialNode;
        else if (c === '!') curFeature = MapFeature.Sign;
        else if (c === '@') curFeature = isTown ? MapFeature.Item : MapFeature.Town;
        else if (c === '&') curFeature = MapFeature.Field;
        else if (c === '$') curFeature = MapFeature.Creature;
        else if (c === 'h') (vehicleOwned = true), (curFeature = MapFeature.Horse);
        else if (c === 'H') (vehicleOwned = false), (curFeature = MapFeature.Horse);
        else if (c === 'b') (vehicleOwned = true), (curFeature = MapFeature.Boat);
        else if (c === 'B') (vehicleOwned = false), (curFeature = MapFeature.Boat);
        else if (c === ',') {
          col++;
          curFeature = MapFeature.None;
        } else {
          throw new MapParseError('Unrecognized map feature character found: ', c, row, col, name);
        }
      }
    }
    flush();
    row++;
  }
  return data;
}
