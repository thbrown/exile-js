import { describe, expect, it } from 'vitest';
import { GameRng, MT19937 } from '../src/core/rng';

// Reference vectors for std::mt19937 (C++11 standard requires the 10000th
// consecutive invocation of a default-constructed engine to be 4123659995).
describe('MT19937', () => {
  it('matches std::mt19937 with default seed 5489', () => {
    const rng = new MT19937();
    expect(rng.next()).toBe(3499211612);
    expect(rng.next()).toBe(581869302);
    expect(rng.next()).toBe(3890346734);
    expect(rng.next()).toBe(3586334585);
    expect(rng.next()).toBe(545404204);
  });

  it('produces the standard-mandated 10000th output', () => {
    const rng = new MT19937();
    let v = 0;
    for (let i = 0; i < 10000; i++) v = rng.next();
    expect(v).toBe(4123659995);
  });

  it('matches std::mt19937 seeded with 1', () => {
    const rng = new MT19937(1);
    expect(rng.next()).toBe(1791095845);
  });
});

describe('GameRng.getRan', () => {
  it('returns times*min when max <= min', () => {
    const rng = new GameRng();
    expect(rng.getRan(3, 5, 5)).toBe(15);
    expect(rng.getRan(2, 7, 4)).toBe(14); // max<min clamps to min
  });

  it('consumes one game-stream value per die and stays in [min,max]', () => {
    const rng = new GameRng();
    const reference = new MT19937();
    const v = rng.getRan(1, 1, 6);
    expect(v).toBe(1 + (reference.next() % 6));
    for (let i = 0; i < 1000; i++) {
      const roll = rng.getRan(2, 1, 6);
      expect(roll).toBeGreaterThanOrEqual(2);
      expect(roll).toBeLessThanOrEqual(12);
    }
  });

  it('unique stream does not advance the game stream', () => {
    const a = new GameRng();
    const b = new GameRng();
    a.getRan(5, 1, 100, true); // unique only
    expect(a.getRan(1, 1, 1000000)).toBe(b.getRan(1, 1, 1000000));
  });
});
