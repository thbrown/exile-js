/**
 * `run_a_missile` and `get_missile_direction`, plus the monster-side dispatch
 * that feeds them — monst_fire_missile's four branches.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GameRng } from '../src/core/rng';
import { FieldType } from '../src/data/fields';
import { DamageType } from '../src/data/monster';
import { MonstAbil, MonstGen, MonstMissile } from '../src/data/monsterAbility';
import { Scenario } from '../src/data/scenario';
import { loadScenario } from '../src/fileio/loadScenario';
import { FsSource } from '../src/fileio/source';
import { buildOpcodeTable } from '../src/fileio/specialParse';
import {
  Missile, getMissileDirection, runAMissile, setMissileSink,
} from '../src/game/missileAnim';
import { monstFireMissile } from '../src/game/monsterAbilities';
import { GameSession } from '../src/game/session';
import { Creature } from '../src/universe/creature';
import { setLivingSound } from '../src/universe/living';
import { PartyPreset } from '../src/universe/player';
import { Status } from '../src/universe/skills';
import { Universe } from '../src/universe/universe';

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

function aLiveMonster(s: GameSession): Creature {
  const m = s.univ.town!.monsters.find((c) => c.isAlive);
  if (!m) throw new Error('no live monster in the start town');
  return m;
}

/**
 * Run `fn` with both hooks captured, and hand back what they saw. Awaits it:
 * `monstFireMissile` waits on the animation timeline between the flight and
 * the damage now, so its effects land a microtask later even though
 * `animSettle` returns at once with no waiter installed.
 */
async function capture(
  fn: () => void | Promise<void>,
): Promise<{ missiles: Missile[]; sounds: number[] }> {
  const missiles: Missile[] = [];
  const sounds: number[] = [];
  setMissileSink((m) => missiles.push(m));
  setLivingSound((n) => sounds.push(n));
  try {
    await fn();
  } finally {
    setMissileSink(null);
    setLivingSound(null);
  }
  return { missiles, sounds };
}

describe('run_a_missile', () => {
  it('queues the flight and plays its sound', async () => {
    const { missiles, sounds } = await capture(
      () => runAMissile({ x: 3, y: 4 }, { x: 9, y: 4 }, 2, 1, 12, 0, 0, 100));
    expect(sounds).toEqual([12]);
    expect(missiles.length).toBe(1);
    expect(missiles[0]!.from).toEqual({ x: 3, y: 4 });
    expect(missiles[0]!.dest).toEqual({ x: 9, y: 4 });
    expect(missiles[0]!.type).toBe(2);
    expect(missiles[0]!.pathType).toBe(1);
    expect(missiles[0]!.len).toBe(100);
  });

  it('drops a missile that travels no distance, as do_missile_anim does', async () => {
    const { missiles, sounds } = await capture(
      () => runAMissile({ x: 5, y: 5 }, { x: 5, y: 5 }, 2, 0, 12));
    expect(missiles).toEqual([]);
    // The sound is play_sound's, before the animation gets a look in.
    expect(sounds).toEqual([12]);
  });

  it('draws nothing for a negative graphic', async () => {
    const { missiles } = await capture(
      () => runAMissile({ x: 1, y: 1 }, { x: 4, y: 4 }, -1, 0, 12));
    expect(missiles).toEqual([]);
  });

  it('with nothing listening it is a no-op', () => {
    setMissileSink(null);
    setLivingSound(null);
    expect(() => runAMissile({ x: 1, y: 1 }, { x: 4, y: 4 }, 2, 0, 12)).not.toThrow();
  });
});

describe('get_missile_direction', () => {
  // The eight headings, measured well away from the boundaries. The sprite
  // columns run 0=N, 1=NE, 2=E, ... 7=NW, which is what the switch produces.
  const origin = { x: 200, y: 200 };
  const cases: [string, { x: number; y: number }, number][] = [
    ['north', { x: 200, y: 100 }, 0],
    ['north-east', { x: 300, y: 100 }, 1],
    ['east', { x: 300, y: 200 }, 2],
    ['south-east', { x: 300, y: 300 }, 3],
    ['south', { x: 200, y: 300 }, 4],
    ['south-west', { x: 100, y: 300 }, 5],
    ['west', { x: 100, y: 200 }, 6],
    ['north-west', { x: 100, y: 100 }, 7],
  ];
  for (const [name, point, dir] of cases) {
    it(`reads ${name} as column ${dir}`, () => {
      expect(getMissileDirection(origin, point)).toBe(dir);
    });
  }

  it('is translation-invariant, since it renormalises the origin', () => {
    expect(getMissileDirection({ x: 500, y: 700 }, { x: 600, y: 800 }))
      .toBe(getMissileDirection({ x: 0, y: 0 }, { x: 100, y: 100 }));
  });
});

describe('monst_fire_missile dispatch', () => {
  it('throws the web graphic and webs the square it lands on', async () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.MISSILE_WEB]!;
    abil.active = true;
    const pc = s.univ.party.pcs[0]!;
    const where = pc.getLoc();
    const { missiles, sounds } = await capture(
      () => monstFireMissile(s, m, MonstAbil.MISSILE_WEB, abil, pc));
    expect(missiles.length).toBe(1);
    expect(missiles[0]!.type).toBe(8); // the animated web sprite
    // The throw, then each PC's own "caught in a web" noise.
    expect(sounds[0]).toBe(14);
    expect(s.univ.town!.hasField(where.x, where.y, FieldType.FIELD_WEB)).toBe(true);
    // Out of combat the whole party is caught, since they share the square.
    expect(pc.status[Status.WEBS]).toBeGreaterThan(0);
  });

  it('the heat ray flies and burns for its extra3 strength', async () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.RAY_HEAT]!;
    abil.active = true;
    abil.special.extra3 = 8;
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 400;
    pc.curHealth = 400;
    const { missiles, sounds } = await capture(
      () => monstFireMissile(s, m, MonstAbil.RAY_HEAT, abil, pc));
    expect(missiles.length).toBe(1);
    expect(missiles[0]!.type).toBe(13);
    expect(sounds[0]).toBe(51);
    expect(pc.curHealth).toBeLessThan(400);
    // The proxy ability the C++ builds is fire damage, not the ray's own type.
    expect(s.univ.transcript.some((l) => l.includes('heat ray'))).toBe(true);
  });

  it('a general ability announces how it arrives and lobs a spit', async () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.DAMAGE]!;
    abil.active = true;
    abil.gen.type = MonstGen.SPIT;
    abil.gen.strength = 4;
    abil.gen.extra = DamageType.ACID;
    abil.gen.pic = 5;
    const pc = s.univ.party.pcs[0]!;
    pc.maxHealth = 400;
    pc.curHealth = 400;
    const { missiles, sounds } = await capture(
      () => monstFireMissile(s, m, MonstAbil.DAMAGE, abil, pc));
    expect(sounds[0]).toBe(64);
    expect(missiles.length).toBe(1);
    expect(missiles[0]!.type).toBe(5);
    // A spit is lobbed, not fired flat.
    expect(missiles[0]!.pathType).toBe(1);
    expect(s.univ.transcript.some((l) => l.includes('Spits at'))).toBe(true);
  });

  it('an ability with no picture only makes its noise', async () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.DAMAGE]!;
    abil.active = true;
    abil.gen.type = MonstGen.RAY;
    abil.gen.strength = 2;
    abil.gen.extra = DamageType.FIRE;
    abil.gen.pic = -1;
    const pc = s.univ.party.pcs[0]!;
    const { missiles, sounds } = await capture(
      () => monstFireMissile(s, m, MonstAbil.DAMAGE, abil, pc));
    expect(missiles).toEqual([]);
    expect(sounds[0]).toBe(51);
  });

  it('a fired missile draws its projectile', async () => {
    const s = inTown();
    const m = aLiveMonster(s);
    const abil = m.mon.abil[MonstAbil.MISSILE]!;
    abil.active = true;
    abil.missile.type = MonstMissile.ARROW;
    abil.missile.pic = 0;
    abil.missile.dice = 1;
    abil.missile.sides = 2;
    abil.missile.skill = 20;
    const pc = s.univ.party.pcs[0]!;
    const { missiles, sounds } = await capture(
      () => monstFireMissile(s, m, MonstAbil.MISSILE, abil, pc));
    expect(missiles.length).toBe(1);
    expect(missiles[0]!.pathType).toBe(1);
    expect(sounds[0]).toBe(12); // an arrow's twang, not a thrown thing's
  });
});
