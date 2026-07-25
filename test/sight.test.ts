import { describe, expect, it } from 'vitest';
import { loc } from '../src/core/location';
import { SIGHT_BLOCKED, canSee } from '../src/core/sight';

/** A grid where '#' fully blocks sight and '/' costs 1. */
function gridObscurity(rows: string[]): (x: number, y: number) => number {
  return (x, y) => {
    const ch = rows[y]?.[x];
    if (ch === '#') return SIGHT_BLOCKED;
    if (ch === '/') return 1;
    return 0;
  };
}

describe('canSee', () => {
  const open = (): number => 0;

  it('sees along a clear row, column, and diagonal', () => {
    expect(canSee(loc(0, 0), loc(5, 0), open)).toBe(0);
    expect(canSee(loc(0, 0), loc(0, 5), open)).toBe(0);
    expect(canSee(loc(0, 0), loc(5, 5), open)).toBe(0);
  });

  it('ignores the endpoints themselves', () => {
    // Only the tiles strictly between the two points are summed.
    const obs = gridObscurity(['#...#']);
    expect(canSee(loc(0, 0), loc(4, 0), obs)).toBe(0);
  });

  it('blocks sight through a wall in any direction', () => {
    const obs = gridObscurity(['.....', '..#..', '.....']);
    // Straight down through the wall.
    expect(canSee(loc(2, 0), loc(2, 2), obs)).toBeGreaterThanOrEqual(SIGHT_BLOCKED);
    // Straight across through the wall.
    expect(canSee(loc(0, 1), loc(4, 1), obs)).toBeGreaterThanOrEqual(SIGHT_BLOCKED);
    // And a clear line beside it is unobstructed.
    expect(canSee(loc(0, 0), loc(4, 0), obs)).toBe(0);
  });

  it('accumulates partial obscurity until sight is blocked', () => {
    const obs = gridObscurity(['.////.']);
    // Four half-blockers between the endpoints sum to 4 — still visible.
    expect(canSee(loc(0, 0), loc(5, 0), obs)).toBe(4);
    expect(canSee(loc(0, 0), loc(5, 0), obs)).toBeLessThan(SIGHT_BLOCKED);
  });

  it('is symmetric for straight lines', () => {
    const obs = gridObscurity(['./#/.']);
    expect(canSee(loc(0, 0), loc(4, 0), obs)).toBe(canSee(loc(4, 0), loc(0, 0), obs));
  });

  it('steps a shallow diagonal through the tiles the C++ picks', () => {
    // dx = 4, dy = 2: the line passes through (1,0), (2,1), (3,1).
    const visited: string[] = [];
    canSee(loc(0, 0), loc(4, 2), (x, y) => {
      visited.push(`${x},${y}`);
      return 0;
    });
    expect(visited).toEqual(['1,0', '2,1', '3,1']);
  });
});
