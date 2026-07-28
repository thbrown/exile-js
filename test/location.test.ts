import { describe, expect, it } from 'vitest';
import {
  Direction, Rect, SCREEN_RADIUS, betweenAnchorPoints, dist, isOnScreen, loc, shiftLoc, vdist,
} from '../src/core/location';

describe('distances', () => {
  it('dist truncates like C++ short assignment from hypot', async () => {
    expect(dist(loc(0, 0), loc(3, 4))).toBe(5);
    expect(dist(loc(0, 0), loc(1, 1))).toBe(1); // hypot=1.414 -> 1
  });

  it('vdist is Chebyshev', async () => {
    expect(vdist(loc(0, 0), loc(3, 4))).toBe(4);
    expect(vdist(loc(2, 2), loc(-1, 2))).toBe(3);
  });
});

describe('directions', () => {
  it('N decreases y, SE increases both (screen coords)', async () => {
    expect(shiftLoc(loc(5, 5), Direction.N)).toEqual({ x: 5, y: 4 });
    expect(shiftLoc(loc(5, 5), Direction.SE)).toEqual({ x: 6, y: 6 });
    expect(shiftLoc(loc(5, 5), Direction.W)).toEqual({ x: 4, y: 5 });
    expect(shiftLoc(loc(5, 5), Direction.Here)).toEqual({ x: 5, y: 5 });
  });
});

describe('Rect', () => {
  it('contains is edge-inclusive like the C++ rectangle', async () => {
    const r = new Rect(1, 2, 10, 20); // top,left,bottom,right
    expect(r.contains(loc(2, 1))).toBe(true);
    expect(r.contains(loc(20, 10))).toBe(true);
    expect(r.contains(loc(21, 5))).toBe(false);
    expect(r.width).toBe(18);
    expect(r.height).toBe(9);
  });
});

describe('between_anchor_points', () => {
  it('takes the midpoint, rounded toward the first anchor', async () => {
    // 4..11 → 7.5, rounded down because anchor1 is the smaller.
    expect(betweenAnchorPoints(loc(4, 4), loc(11, 4))).toEqual(loc(7, 4));
    // Same pair the other way round rounds up, toward anchor1 again.
    expect(betweenAnchorPoints(loc(11, 4), loc(4, 4))).toEqual(loc(8, 4));
  });

  it('walks back toward the first anchor until it is on screen', async () => {
    // 30 squares apart: the midpoint frames neither, so the result sits
    // exactly four squares — the view's radius — from anchor1.
    const c = betweenAnchorPoints(loc(0, 0), loc(30, 0));
    expect(c).toEqual(loc(4, 0));
    expect(isOnScreen(loc(0, 0), c, SCREEN_RADIUS)).toBe(true);
  });
});
