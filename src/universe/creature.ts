/**
 * A live monster in the current town — the M2 slice of cCreature
 * (universe/creature.cpp). Combat fields (ap, morale, targeting, status
 * effects) land with M5; what's here is what placement and drawing need.
 */

import { Direction, Location } from '../core/location';
import { Attitude, Monster, MonstTime } from '../data/monster';
import { Townperson } from '../data/town';

export enum CreatureStatus {
  DEAD = 0,
  IDLE = 1,
  ALERTED = 2,
  FLEEING = 3,
}

export class Creature {
  /** Index into scenario.scenMonsters. */
  number = 0;
  active: CreatureStatus = CreatureStatus.IDLE;
  attitude: Attitude = Attitude.DOCILE;
  startLoc: Location = { x: 0, y: 0 };
  curLoc: Location = { x: 0, y: 0 };
  direction: Direction = Direction.N;
  health = 0;
  maxHealth = 0;
  mobile = true;
  timeFlag: MonstTime = MonstTime.ALWAYS;
  timeCode = 0;
  monsterTime = 0;
  /** SDF pair that suppresses this creature when set (spec1/spec2). */
  spec1 = -1;
  spec2 = -1;
  specEncCode = 0;
  pictureNum = 0;
  xWidth = 1;
  yWidth = 1;
  /** Index in the town's creature list, for preset lookups. */
  slot = -1;

  get isAlive(): boolean {
    return this.active !== CreatureStatus.DEAD;
  }
}

/** cPopulation::assign — build a live creature from a preset + template. */
export function assignCreature(
  slot: number,
  preset: Townperson,
  template: Monster,
): Creature {
  const c = new Creature();
  c.slot = slot;
  c.number = preset.number;
  c.attitude = preset.startAttitude;
  c.startLoc = { ...preset.startLoc };
  c.curLoc = { ...preset.startLoc };
  c.mobile = preset.mobility !== 0;
  c.timeFlag = preset.timeFlag;
  c.timeCode = preset.timeCode;
  c.monsterTime = preset.monsterTime;
  c.spec1 = preset.spec1;
  c.spec2 = preset.spec2;
  c.specEncCode = preset.specEncCode;
  c.health = c.maxHealth = template.level * 3;
  c.pictureNum = template.pictureNum;
  c.xWidth = template.xWidth;
  c.yWidth = template.yWidth;
  c.active = CreatureStatus.IDLE;
  return c;
}
