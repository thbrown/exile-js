import { describe, expect, it } from 'vitest';
import { Boom, boomSpace, setBoomSink } from '../src/game/booms';
import { setLivingSound } from '../src/universe/living';

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
