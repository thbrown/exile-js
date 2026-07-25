/**
 * Town data — cTown from ../exile-wasm/src/scenario/town.hpp plus
 * cTownperson from monster.hpp. Towns have a variable square dimension
 * (min 24); terrain indexed (x, y).
 */

import { FieldType } from './fields';
import { Attitude, MonstTime } from './monster';
import { AreaDesc, SignLoc, SpecLoc } from './outdoors';
import { SpecialNode } from './special';

export enum Lighting {
  LIGHT_NORMAL = 0,
  LIGHT_DARK = 1,
  LIGHT_DRAINS = 2,
  LIGHT_NONE = 3,
}

/** cTownperson — a creature placed in a town. */
export interface Townperson {
  number: number;
  startAttitude: Attitude;
  startLoc: { x: number; y: number };
  mobility: number;
  timeFlag: MonstTime;
  spec1: number;
  spec2: number;
  specEncCode: number;
  timeCode: number;
  monsterTime: number;
  personality: number;
  specialOnKill: number;
  specialOnTalk: number;
  facialPic: number;
}

export function defaultTownperson(): Townperson {
  return {
    number: 0,
    startAttitude: Attitude.DOCILE,
    startLoc: { x: 80, y: 80 },
    mobility: 1,
    timeFlag: MonstTime.ALWAYS,
    spec1: -1,
    spec2: -1,
    specEncCode: 0,
    timeCode: 0,
    monsterTime: 0,
    personality: -1,
    specialOnKill: -1,
    specialOnTalk: -1,
    facialPic: -1,
  };
}

export interface PresetItem {
  loc: { x: number; y: number };
  code: number;
  ability: number; // eEnchant
  charges: number;
  alwaysThere: boolean;
  property: boolean;
  contained: boolean;
}

export function defaultPresetItem(): PresetItem {
  return {
    loc: { x: 0, y: 0 },
    code: -1,
    ability: -1,
    charges: -1,
    alwaysThere: false,
    property: false,
    contained: false,
  };
}

export interface PresetField {
  loc: { x: number; y: number };
  type: FieldType;
}

export interface Timer {
  time: number;
  node: number;
}

export class Town {
  constructor(readonly maxDim: number) {
    this.terrain = Array.from({ length: maxDim }, () => new Array<number>(maxDim).fill(0));
    this.maps = Array.from({ length: maxDim }, () => new Uint8Array(maxDim));
  }

  /** Explored flags, persisted in saves (cTown::maps); maps[x][y]. */
  maps: Uint8Array[];

  name = '';
  comment: string[] = ['', '', ''];
  /** terrain[x][y] like the C++ (x, y) accessor. */
  terrain: number[][];
  townChopTime = -1;
  townChopKey = -1;
  maxNumMonst = 30000;
  wandering: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  /** x = -1 marks unused (LOC_UNUSED). */
  wanderingLocs: { x: number; y: number }[] = [
    { x: -1, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 0 },
  ];
  lightingType = Lighting.LIGHT_NORMAL;
  /** Party placement when entering from direction S/W/N/E (start_locs); x = -1 unused. */
  startLocs: { x: number; y: number }[] = [
    { x: -1, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: 0 },
  ];
  /** Exit destinations per direction N/W/S/E order from dirs "nwse". */
  exits: { x: number; y: number; spec: number }[] = [
    { x: -1, y: -1, spec: -1 },
    { x: -1, y: -1, spec: -1 },
    { x: -1, y: -1, spec: -1 },
    { x: -1, y: -1, spec: -1 },
  ];
  inTownRect = { top: 0, left: 0, bottom: 0, right: 0 };
  presetItems: PresetItem[] = [];
  /** Which preset items the party has already picked up (cTown::item_taken). */
  itemTaken: boolean[] = [];
  presetFields: PresetField[] = [];
  creatures: Townperson[] = [];
  specOnEntry = -1;
  specOnEntryIfDead = -1;
  specOnHostile = -1;
  timers: Timer[] = [];
  strongBarriers = false;
  defyMapping = false;
  defyScrying = false;
  isHidden = false;
  hasTavern = false;
  difficulty = 0;
  specialLocs: SpecLoc[] = [];
  signLocs: SignLoc[] = [];
  areaDesc: AreaDesc[] = [];
  specStrs: string[] = [];
  specials = new Map<number, SpecialNode>();
}
