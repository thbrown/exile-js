/**
 * `increase_age`'s upkeep, and the shared animation timeline.
 *
 * Both of these exist because of the same class of bug: the game *said*
 * something happened and then nothing came of it. A swamp announced it had
 * poisoned you and the poison never bit; a monster threw a spear and all you
 * saw was the damage number.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  MISSILE_MS, Missile, runAMissile, setMissileSink,
} from '../src/game/missileAnim';
import {
  Boom, boomMs, boomSpace, runBoomAnim, setBoomSink, startBoomAnim,
} from '../src/game/booms';
import {
  FocusEvent, animBook, animClear, animPending, focusOn, setFocusSink,
} from '../src/game/anim';
import { doPoison, handleAcid, handleDisease } from '../src/game/increaseAge';
import { GameSession } from '../src/game/session';
import { PartyPreset } from '../src/universe/player';
import { MainStatus, Status } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

/**
 * Slack for comparisons between two performance.now()-derived timestamps. The
 * animation timeline books slots by adding to a float clock, so a gap that is
 * exactly N milliseconds in real arithmetic can come back a hair under it.
 */
const EPSILON = 0.001;

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

let scen: Scenario;

beforeAll(async () => {
  scen = await loadScenario(
    new FsSource(fileURLToPath(new URL('../public/scenarios/valleydy', import.meta.url))),
    opcodes,
  );
});

function inTown(): GameSession {
  const s = new GameSession(new Universe(scen, new GameRng(), PartyPreset.DEFAULT));
  s.startNewGame();
  return s;
}

describe('the per-turn upkeep', () => {
  it('poison actually damages the PC carrying it', async () => {
    // The bug this pins: a swamp set status[POISON], printed that it had, and
    // nothing ever spent it, so poison was decorative.
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 300;
    pc.curHealth = 300;
    pc.status[Status.POISON] = 5;
    await doPoison(s);
    expect(pc.curHealth).toBeLessThan(300);
    expect(s.univ.transcript).toContain('Poison:');
  });

  it('poison usually fades a notch as it bites', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 900;
    pc.curHealth = 900;
    pc.status[Status.POISON] = 8;
    for (let i = 0; i < 12 && (pc.status[Status.POISON] ?? 0) > 0; i++) await doPoison(s);
    expect(pc.status[Status.POISON]).toBe(0);
  });

  it('leaves an unpoisoned party alone, and says nothing', async () => {
    const s = inTown();
    const before = s.univ.transcript.length;
    await doPoison(s);
    expect(s.univ.transcript.length).toBe(before);
  });

  it('skips the dead, who are past being poisoned', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.status[Status.POISON] = 5;
    pc.mainStatus = MainStatus.DEAD;
    const before = s.univ.transcript.length;
    await doPoison(s);
    expect(s.univ.transcript.length).toBe(before);
  });

  it('acid burns and always fades by one', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 300;
    pc.curHealth = 300;
    pc.status[Status.ACID] = 4;
    await handleAcid(s);
    expect(pc.curHealth).toBeLessThan(300);
    expect(pc.status[Status.ACID]).toBe(3);
  });

  it('disease rolls one misery per sufferer', async () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.status[Status.DISEASE] = 6;
    handleDisease(s);
    expect(s.univ.transcript).toContain('Disease:');
  });

  it('walking it off outdoors reaches a poison tick on its own', async () => {
    // The end-to-end version of the swamp report: get poisoned outdoors, keep
    // walking, and the poison should eventually bite. Outdoors that is every
    // 50th turn, which is a long way — but it has to happen at all.
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 400;
    pc.curHealth = 400;
    pc.status[Status.POISON] = 6;
    // `getLoc` follows the party in or out of town; `townLoc` goes stale the
    // moment they step outside, which is what made an earlier version of this
    // test walk into a wall for thirty turns.
    for (let i = 0; i < 140 && !s.univ.transcript.includes('Poison:'); i++) {
      const at = s.univ.party.getLoc();
      await s.moveTo({ x: at.x, y: at.y + (i % 2 ? 1 : -1) });
    }
    expect(s.univ.transcript).toContain('Poison:');
    expect(pc.curHealth).toBeLessThan(400);
  });
});

describe('the animation timeline', () => {
  function capture(fn: () => void): {
    missiles: Missile[]; booms: Boom[]; focus: FocusEvent[];
  } {
    const missiles: Missile[] = [];
    const booms: Boom[] = [];
    const focus: FocusEvent[] = [];
    animClear();
    setMissileSink((m) => missiles.push(m));
    setBoomSink((b) => booms.push(b));
    setFocusSink((f) => focus.push(f));
    try {
      fn();
    } finally {
      setMissileSink(null);
      setBoomSink(null);
      setFocusSink(null);
      animClear();
    }
    return { missiles, booms, focus };
  }

  it('queues missiles one after another rather than all at once', async () => {
    // The bug this pins: three monsters firing in one turn all started their
    // flight in the same frame, so the volley was over before it was visible.
    const { missiles } = capture(() => {
      for (let i = 0; i < 3; i++) {
        runAMissile({ x: 1, y: 1 }, { x: 5, y: 5 }, 3, 0, 14);
      }
    });
    expect(missiles.length).toBe(3);
    // EPSILON, because these are differences of two performance.now()-derived
    // floats: the spacing is exactly MISSILE_MS in real arithmetic but can come
    // back as 199.9999999999999 once the timestamps are large enough. A
    // sub-millisecond slack still catches the bug this pins, which is a spacing
    // of *zero*.
    expect(missiles[1]!.started - missiles[0]!.started).toBeGreaterThan(MISSILE_MS - EPSILON);
    expect(missiles[2]!.started - missiles[1]!.started).toBeGreaterThan(MISSILE_MS - EPSILON);
  });

  it('holds a hit back until its missile has arrived', async () => {
    const { missiles, booms } = capture(() => {
      runAMissile({ x: 1, y: 1 }, { x: 5, y: 5 }, 3, 0, 14);
      boomSpace({ x: 5, y: 5 }, 3, 7, 0);
    });
    // Same float caveat as above.
    expect(booms[0]!.starts).toBeGreaterThan(missiles[0]!.started + MISSILE_MS - EPSILON);
  });

  /**
   * `boom_space` **sleeps** for the blast (300ms in the WASM build,
   * boe.graphics.cpp:1594), so two blows in one turn are two blasts one after
   * the other — not one frame with both damage numbers on it, which is what
   * this port used to draw.
   */
  it('plays two blows in one turn one after the other', async () => {
    const { booms } = capture(() => {
      boomSpace({ x: 1, y: 1 }, 3, 4, 0);
      boomSpace({ x: 2, y: 2 }, 3, 5, 0);
    });
    expect(booms[1]!.starts - booms[0]!.starts).toBeGreaterThan(boomMs() - EPSILON);
    // And the first is off the screen by the time the second arrives.
    expect(booms[0]!.expires).toBeLessThanOrEqual(booms[1]!.starts + EPSILON);
  });

  it('a volley books one slot for everything it collected', async () => {
    // do_explosion_anim draws every explosion in the same frames and sleeps
    // once, so a fireball's hits land together however many there are.
    const { booms } = capture(() => {
      startBoomAnim();
      boomSpace({ x: 1, y: 1 }, 3, 4, 0);
      boomSpace({ x: 2, y: 2 }, 3, 5, 0);
      runBoomAnim();
    });
    expect(booms.length).toBe(2);
    expect(booms[1]!.starts).toBe(booms[0]!.starts);
  });

  it('a camera move takes its own slot in the queue', async () => {
    const { focus, missiles } = capture(() => {
      focusOn({ x: 9, y: 9 });
      runAMissile({ x: 9, y: 9 }, { x: 5, y: 5 }, 3, 0, 14);
    });
    // The dwell on the monster, then the missile's own two: the frame it
    // launches in and the swing onto the target half way over.
    expect(focus.length).toBe(3);
    expect(focus[0]!.center).toEqual({ x: 9, y: 9 });
    expect(missiles[0]!.started).toBeGreaterThanOrEqual(focus[0]!.at);
  });

  /**
   * `do_missile_anim`'s `camera_dest`/`recentered` pair: the view frames the
   * shooter and the target together, then swings onto the target's own frame
   * at `t == num_steps / 2`. Neither move books any time — the flight is
   * already paying for it.
   */
  it('the camera follows a projectile without lengthening its flight', async () => {
    const from = { x: 4, y: 4 };
    const dest = { x: 16, y: 4 };
    const { focus, missiles } = capture(() => {
      runAMissile(from, dest, 3, 0, 14);
    });
    const m = missiles[0]!;
    expect(focus.length).toBe(2);
    // Opening frame: between the two, and near enough the shooter to show it.
    expect(focus[0]!.at).toBe(m.started);
    expect(Math.abs(focus[0]!.center.x - from.x)).toBeLessThanOrEqual(4);
    // Halfway: the target's frame, and the target is in it.
    expect(focus[1]!.at).toBeCloseTo(m.started + m.dur / 2);
    expect(Math.abs(focus[1]!.center.x - dest.x)).toBeLessThanOrEqual(4);
    // Both moves land inside the flight; nothing was booked for them.
    expect(focus[1]!.at).toBeLessThan(m.started + m.dur);
  });

  /**
   * The depth cap this used to pin is **gone**. It made a booking past 1500ms
   * of backlog start at once, which is an ordering violation dressed up as a
   * safety valve: once a blast books time of its own, a busy queue handed a
   * hit and the missile it belongs to the same start, and the explosion beat
   * its projectile. Nothing needs the valve now — the turn waits on the queue
   * and so does the player's input — so what is pinned instead is that the
   * queue stays strictly in order however deep it gets.
   */
  it('keeps strict order however deep the backlog gets', async () => {
    animClear();
    let last = -Infinity;
    for (let i = 0; i < 40; i++) {
      const at = animBook(MISSILE_MS);
      expect(at).toBeGreaterThanOrEqual(last);
      last = at;
    }
    expect(animPending()).toBeGreaterThan(40 * MISSILE_MS - 100);
    // And the next thing booked still lands after all of it.
    expect(animBook(MISSILE_MS)).toBeGreaterThan(last);
    animClear();
  });

  it('drains back to real time once nothing is queued', async () => {
    animClear();
    expect(animPending()).toBe(0);
  });
});
