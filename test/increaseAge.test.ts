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
import { Boom, boomSpace, setBoomSink } from '../src/game/booms';
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
  it('poison actually damages the PC carrying it', () => {
    // The bug this pins: a swamp set status[POISON], printed that it had, and
    // nothing ever spent it, so poison was decorative.
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 300;
    pc.curHealth = 300;
    pc.status[Status.POISON] = 5;
    doPoison(s);
    expect(pc.curHealth).toBeLessThan(300);
    expect(s.univ.transcript).toContain('Poison:');
  });

  it('poison usually fades a notch as it bites', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 900;
    pc.curHealth = 900;
    pc.status[Status.POISON] = 8;
    for (let i = 0; i < 12 && (pc.status[Status.POISON] ?? 0) > 0; i++) doPoison(s);
    expect(pc.status[Status.POISON]).toBe(0);
  });

  it('leaves an unpoisoned party alone, and says nothing', () => {
    const s = inTown();
    const before = s.univ.transcript.length;
    doPoison(s);
    expect(s.univ.transcript.length).toBe(before);
  });

  it('skips the dead, who are past being poisoned', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.status[Status.POISON] = 5;
    pc.mainStatus = MainStatus.DEAD;
    const before = s.univ.transcript.length;
    doPoison(s);
    expect(s.univ.transcript.length).toBe(before);
  });

  it('acid burns and always fades by one', () => {
    const s = inTown();
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 300;
    pc.curHealth = 300;
    pc.status[Status.ACID] = 4;
    handleAcid(s);
    expect(pc.curHealth).toBeLessThan(300);
    expect(pc.status[Status.ACID]).toBe(3);
  });

  it('disease rolls one misery per sufferer', () => {
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

  it('queues missiles one after another rather than all at once', () => {
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

  it('holds a hit back until its missile has arrived', () => {
    const { missiles, booms } = capture(() => {
      runAMissile({ x: 1, y: 1 }, { x: 5, y: 5 }, 3, 0, 14);
      boomSpace({ x: 5, y: 5 }, 3, 7, 0);
    });
    // Same float caveat as above.
    expect(booms[0]!.starts).toBeGreaterThan(missiles[0]!.started + MISSILE_MS - EPSILON);
  });

  it('shows several blows in one turn together, since none books a slot', () => {
    const { booms } = capture(() => {
      boomSpace({ x: 1, y: 1 }, 3, 4, 0);
      boomSpace({ x: 2, y: 2 }, 3, 5, 0);
    });
    // Both take the front of the queue; they differ only by the microseconds
    // between the two `performance.now()` reads.
    expect(booms[1]!.starts - booms[0]!.starts).toBeLessThan(5);
  });

  it('a camera move takes its own slot in the queue', () => {
    const { focus, missiles } = capture(() => {
      focusOn({ x: 9, y: 9 });
      runAMissile({ x: 9, y: 9 }, { x: 5, y: 5 }, 3, 0, 14);
    });
    expect(focus.length).toBe(1);
    expect(focus[0]!.center).toEqual({ x: 9, y: 9 });
    expect(missiles[0]!.started).toBeGreaterThanOrEqual(focus[0]!.at);
  });

  it('stops queueing once the backlog is long, so a mob does not stall', () => {
    animClear();
    // Book well past the cap; the next booking should start immediately.
    for (let i = 0; i < 40; i++) animBook(MISSILE_MS);
    const pendingBefore = animPending();
    expect(pendingBefore).toBeGreaterThan(1500);
    const at = animBook(MISSILE_MS);
    expect(at).toBeLessThan(performance.now() + 1);
    animClear();
  });

  it('drains back to real time once nothing is queued', () => {
    animClear();
    expect(animPending()).toBe(0);
  });
});
