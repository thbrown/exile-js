import { describe, expect, it } from 'vitest';
import {
  Boom, boomSpace, runBoomAnim, setBoomSink, startBoomAnim,
} from '../src/game/booms';
import { GameRng } from '../src/core/rng';
import { setLivingSound } from '../src/universe/living';

/** A fresh generator, so a test that rolls doesn't disturb its neighbours. */
const rng = (): GameRng => new GameRng();

/** Run `fn` with both hooks captured, and hand back what they saw. */
function capture(fn: () => void): { booms: Boom[]; sounds: number[] } {
  const booms: Boom[] = [];
  const sounds: number[] = [];
  setBoomSink((b) => booms.push(b));
  setLivingSound((n) => sounds.push(n));
  try {
    fn();
  } finally {
    setBoomSink(null);
    setLivingSound(null);
  }
  return { booms, sounds };
}

describe('boom_space', () => {
  it('plays the sound *file* the type maps to, not the type itself', async () => {
    // This is the bug that made a rat's bite sound like a cash register: the
    // numbers get_monst_sound and get_sound_type return are indices into
    // sound_lookup = {97,69,70,71,72,73,55,75,42,86,87,88,89,98,...}.
    const cases: [number, number][] = [
      [0, 97], // the plain "ouch"
      [1, 69], // light blade
      [2, 70], // heavy blade
      [3, 71], // pole arm
      [4, 72], // club / thump
      [5, 73], // fire
      [8, 42], // acid
      [10, 87], // a bite
      [12, 89], // a sting
    ];
    for (const [type, file] of cases) {
      const { sounds } = capture(() => boomSpace({ x: 1, y: 1 }, 3, 5, type));
      expect(sounds).toEqual([file]);
    }
  });

  it('a negative sound is a file number, passed straight through', async () => {
    const { sounds } = capture(() => boomSpace({ x: 1, y: 1 }, 3, 5, -21));
    expect(sounds).toEqual([21]);
  });

  it('a type with no sound is silent', async () => {
    const { sounds } = capture(() => boomSpace({ x: 1, y: 1 }, 3, 5, 14));
    expect(sounds).toEqual([]);
  });

  it('queues a boom carrying the square, the graphic and the damage', async () => {
    const { booms } = capture(() => boomSpace({ x: 7, y: 9 }, 6, 12, 0));
    expect(booms.length).toBe(1);
    expect(booms[0]!.where).toEqual({ x: 7, y: 9 });
    expect(booms[0]!.type).toBe(6);
    expect(booms[0]!.damage).toBe(12);
  });

  it('refuses a graphic outside the seven the sheet has', async () => {
    const { booms, sounds } = capture(() => boomSpace({ x: 1, y: 1 }, 7, 5, 0));
    expect(booms).toEqual([]);
    // The sound still plays; only the drawing is skipped.
    expect(sounds).toEqual([97]);
  });

  it('with nothing listening it is a no-op', async () => {
    setBoomSink(null);
    setLivingSound(null);
    expect(() => boomSpace({ x: 1, y: 1 }, 3, 5, 0)).not.toThrow();
  });
});

/**
 * A volley is not a row of hits. `do_explosion_anim` (boe.newgraph.cpp:554)
 * draws every explosion it collected as an **eight-frame animation** out of
 * its own rows of booms.png, and makes **one** noise for the lot, from
 * `boom_type_sound` — a different table from `boom_space`'s `sound_lookup`.
 * Playing a fireball's blast as a row of single-frame hit sprites with
 * per-hit sounds is what made it look and sound wrong.
 */
describe('do_explosion_anim (a volley)', () => {
  it('marks its explosions animated and stays silent until they play', () => {
    const { booms, sounds } = capture(() => {
      startBoomAnim();
      boomSpace({ x: 1, y: 1 }, 0, 7, 5, rng());
      boomSpace({ x: 2, y: 2 }, 0, 9, 5, rng());
    });
    // Nothing drawn and nothing heard: they are queued until the volley plays.
    expect(booms).toEqual([]);
    expect(sounds).toEqual([]);
  });

  it('plays one sound for the whole volley, from boom_type_sound', () => {
    // FIRE's boom type is 0, and boom_type_sound[0] is file 5 — where
    // boom_space's own table would have said 73 for the same hit.
    const { booms, sounds } = capture(() => {
      startBoomAnim();
      boomSpace({ x: 1, y: 1 }, 0, 7, 5, rng());
      boomSpace({ x: 2, y: 2 }, 0, 9, 5, rng());
      runBoomAnim(rng());
    });
    expect(sounds).toEqual([5]);
    expect(booms.length).toBe(2);
    expect(booms.every((b) => b.animated)).toBe(true);
    expect(booms.every((b) => b.sound === 0)).toBe(true);
  });

  it('staggers the frames after the first, so they do not pulse together', () => {
    const shared = rng();
    const { booms } = capture(() => {
      startBoomAnim();
      for (let i = 0; i < 5; i++) boomSpace({ x: i, y: 0 }, 2, 3, 5, shared);
      runBoomAnim(shared);
    });
    // `offset = (i == 0) ? 0 : -get_ran(1,0,2)`.
    expect(booms[0]!.offset).toBe(0);
    for (const b of booms.slice(1)) {
      expect(b.offset).toBeLessThanOrEqual(0);
      expect(b.offset).toBeGreaterThanOrEqual(-2);
    }
  });

  it('a single hit outside a volley is still the one-frame sprite', () => {
    const { booms, sounds } = capture(() => boomSpace({ x: 1, y: 1 }, 0, 4, 5, rng()));
    expect(booms.length).toBe(1);
    expect(booms[0]!.animated).toBe(false);
    expect(sounds).toEqual([73]); // sound_lookup[5], boom_space's own table
  });
});
