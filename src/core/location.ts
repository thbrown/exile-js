/**
 * Coordinates, directions, and rectangles.
 * Ported from ../exile-wasm/src/location.{hpp,cpp}.
 */

export enum Direction {
  N = 0,
  NE = 1,
  E = 2,
  SE = 3,
  S = 4,
  SW = 5,
  W = 6,
  NW = 7,
  Here = 8,
}

export interface Location {
  x: number;
  y: number;
}

export function loc(x = 0, y = 0): Location {
  return { x, y };
}

export function locsEqual(a: Location, b: Location): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Euclidean distance truncated to short, as in C++ `short dist = hypot(...)`. */
export function dist(a: Location, b: Location): number {
  return Math.trunc(Math.hypot(a.x - b.x, a.y - b.y));
}

export function fdist(a: Location, b: Location): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Chebyshev ("vision") distance. */
export function vdist(a: Location, b: Location): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// x/y deltas per Direction, N..Here
const DIR_X = [0, 1, 1, 1, 0, -1, -1, -1, 0] as const;
const DIR_Y = [-1, -1, 0, 1, 1, 1, 0, -1, 0] as const;

export function shiftLoc(p: Location, dir: Direction): Location {
  return { x: p.x + DIR_X[dir]!, y: p.y + DIR_Y[dir]! };
}

/** BoE rectangles are {top,left,bottom,right}, edges inclusive for contains(). */
export class Rect {
  constructor(
    public top = 0,
    public left = 0,
    public bottom = 0,
    public right = 0,
  ) {}

  get width(): number {
    return this.right - this.left;
  }

  get height(): number {
    return this.bottom - this.top;
  }

  contains(p: Location): boolean {
    return p.y >= this.top && p.y <= this.bottom && p.x >= this.left && p.x <= this.right;
  }

  empty(): boolean {
    if (this.right < this.left || this.bottom < this.top) return true;
    return this.width === 0 && this.height === 0;
  }

  offset(dx: number, dy: number): Rect {
    return new Rect(this.top + dy, this.left + dx, this.bottom + dy, this.right + dx);
  }

  inset(dx: number, dy: number): Rect {
    return new Rect(this.top + dy, this.left + dx, this.bottom - dy, this.right - dx);
  }
}

export function minmax(min: number, max: number, k: number): number {
  return Math.max(min, Math.min(max, k));
}

/**
 * percent (mathutil.cpp:...) — `value * percentage / 100` with C++'s truncating
 * integer division. Resistances are stored as percentages, so this is on the
 * hot path of every damage calculation and the truncation matters.
 */
export function percent(value: number, percentage: number): number {
  return Math.trunc((value * percentage) / 100);
}
