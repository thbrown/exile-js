import { describe, expect, it } from 'vitest';
import { Direction, Rect, dist, loc, shiftLoc, vdist } from '../src/core/location';

describe('distances', () => {
  it('dist truncates like C++ short assignment from hypot', () => {
    expect(dist(loc(0, 0), loc(3, 4))).toBe(5);
    expect(dist(loc(0, 0), loc(1, 1))).toBe(1); // hypot=1.414 -> 1
  });

  it('vdist is Chebyshev', () => {
    expect(vdist(loc(0, 0), loc(3, 4))).toBe(4);
    expect(vdist(loc(2, 2), loc(-1, 2))).toBe(3);
  });
});

describe('directions', () => {
  it('N decreases y, SE increases both (screen coords)', () => {
    expect(shiftLoc(loc(5, 5), Direction.N)).toEqual({ x: 5, y: 4 });
    expect(shiftLoc(loc(5, 5), Direction.SE)).toEqual({ x: 6, y: 6 });
    expect(shiftLoc(loc(5, 5), Direction.W)).toEqual({ x: 4, y: 5 });
    expect(shiftLoc(loc(5, 5), Direction.Here)).toEqual({ x: 5, y: 5 });
  });
});

describe('Rect', () => {
  it('contains is edge-inclusive like the C++ rectangle', () => {
    const r = new Rect(1, 2, 10, 20); // top,left,bottom,right
    expect(r.contains(loc(2, 1))).toBe(true);
    expect(r.contains(loc(20, 10))).toBe(true);
    expect(r.contains(loc(21, 5))).toBe(false);
    expect(r.width).toBe(18);
    expect(r.height).toBe(9);
  });
});
