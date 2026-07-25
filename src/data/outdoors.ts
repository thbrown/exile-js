/**
 * Outdoor sector data — cOutdoors from ../exile-wasm/src/scenario/outdoors.hpp.
 * One sector is a 48×48 terrain grid plus encounter/special metadata.
 */

import { SpecialNode } from './special';

export const SECTOR_SIZE = 48;

export enum AmbientSound {
  NONE = 0,
  BIRD = 1,
  DRIP = 2,
  CUSTOM = 3,
}

/** out_wandering_type / cOutdoors::cWandering. */
export interface OutWandering {
  monst: number[]; // 7 hostile monster slots
  friendly: number[]; // 3 friendly slots
  specOnMeet: number;
  specOnWin: number;
  specOnFlee: number;
  cantFlee: boolean;
  forced: boolean;
  endSpec1: number;
  endSpec2: number;
}

export function emptyOutWandering(): OutWandering {
  return {
    monst: [0, 0, 0, 0, 0, 0, 0],
    friendly: [0, 0, 0],
    specOnMeet: -1,
    specOnWin: -1,
    specOnFlee: -1,
    cantFlee: false,
    forced: false,
    endSpec1: -1,
    endSpec2: -1,
  };
}

export interface SpecLoc {
  x: number;
  y: number;
  spec: number;
}

export interface SignLoc {
  x: number;
  y: number;
  text: string;
}

export interface AreaDesc {
  top: number;
  left: number;
  bottom: number;
  right: number;
  descr: string;
}

export class Sector {
  name = '';
  comment = '';
  ambientSound = AmbientSound.NONE;
  outSound = -1;
  /** terrain[x][y], 48×48 — matches the C++ array2d indexing. */
  terrain: number[][] = Array.from({ length: SECTOR_SIZE }, () =>
    new Array<number>(SECTOR_SIZE).fill(0),
  );
  specialSpot: boolean[][] = Array.from({ length: SECTOR_SIZE }, () =>
    new Array<boolean>(SECTOR_SIZE).fill(false),
  );
  roads: boolean[][] = Array.from({ length: SECTOR_SIZE }, () =>
    new Array<boolean>(SECTOR_SIZE).fill(false),
  );
  cityLocs: SpecLoc[] = [];
  specialLocs: SpecLoc[] = [];
  signLocs: SignLoc[] = [];
  areaDesc: AreaDesc[] = [];
  specStrs: string[] = [];
  wandering: OutWandering[] = [
    emptyOutWandering(),
    emptyOutWandering(),
    emptyOutWandering(),
    emptyOutWandering(),
  ];
  specialEnc: OutWandering[] = [
    emptyOutWandering(),
    emptyOutWandering(),
    emptyOutWandering(),
    emptyOutWandering(),
  ];
  wanderingLocs: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  specials = new Map<number, SpecialNode>();
  /** Explored flags, persisted per sector in saves (cOutdoors::maps). */
  maps: Uint8Array[] = Array.from({ length: SECTOR_SIZE }, () => new Uint8Array(SECTOR_SIZE));
}
