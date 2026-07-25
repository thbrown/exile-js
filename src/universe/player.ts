/**
 * A single party member. Port of the parts of cPlayer (universe/pc.cpp) that
 * M2 needs: identity, stats, and the two hardcoded presets used to start a
 * game without a character-creation flow.
 */

import { Direction } from '../core/location';
import { Item, defaultItem } from '../data/item';
import { MainStatus, NUM_SKILLS, NUM_TRAITS, Race, Skill } from './skills';

export const NUM_PC_SLOTS = 6;
export const NUM_INVEN_SLOTS = 24;

export enum PartyPreset {
  /** The six pregens a new game starts with (cPlayer ctor, pc.cpp:1084). */
  DEFAULT = 0,
  /** Maxed-out test party (pc.cpp:1036). */
  DEBUG = 1,
}

export class Player {
  name = '';
  mainStatus: MainStatus = MainStatus.ABSENT;
  skills: number[] = new Array<number>(NUM_SKILLS).fill(0);
  traits: boolean[] = new Array<boolean>(NUM_TRAITS).fill(false);
  curHealth = 6;
  maxHealth = 6;
  curSp = 0;
  maxSp = 0;
  experience = 0;
  skillPts = 65;
  level = 1;
  expAdj = 100;
  race: Race = Race.HUMAN;
  direction: Direction = Direction.N;
  whichGraphic = 0;
  uniqueId = 0;
  items: Item[] = Array.from({ length: NUM_INVEN_SLOTS }, () => defaultItem());

  get isAlive(): boolean {
    return this.mainStatus === MainStatus.ALIVE;
  }

  constructor() {
    // cPlayer(no_party_t): the three basic stats start at 1, everything else 0
    this.skills[Skill.STRENGTH] = 1;
    this.skills[Skill.DEXTERITY] = 1;
    this.skills[Skill.INTELLIGENCE] = 1;
  }
}

// PARTY_DEFAULT tables, verbatim from pc.cpp:1084.
const DEFAULT_NAMES = ['Jenneke', 'Thissa', 'Frrrrrr', 'Adrianna', 'Feodoric', 'Michael'];
const DEFAULT_HEALTH = [22, 24, 24, 16, 16, 18];
const DEFAULT_SP = [0, 0, 0, 20, 20, 21];
const DEFAULT_GRAPHICS = [3, 32, 29, 16, 23, 14];
const DEFAULT_RACE = [Race.HUMAN, Race.SLITH, Race.NEPHIL, Race.HUMAN, Race.HUMAN, Race.HUMAN];

const DEFAULT_SKILLS: Partial<Record<Skill, number>>[] = [
  {
    [Skill.STRENGTH]: 8, [Skill.DEXTERITY]: 6, [Skill.INTELLIGENCE]: 2,
    [Skill.EDGED_WEAPONS]: 6, [Skill.ITEM_LORE]: 1, [Skill.ASSASSINATION]: 2,
  },
  {
    [Skill.STRENGTH]: 8, [Skill.DEXTERITY]: 7, [Skill.INTELLIGENCE]: 2,
    [Skill.POLE_WEAPONS]: 6, [Skill.THROWN_MISSILES]: 3, [Skill.DEFENSE]: 3,
    [Skill.POISON]: 2,
  },
  {
    [Skill.STRENGTH]: 8, [Skill.DEXTERITY]: 6, [Skill.INTELLIGENCE]: 2,
    [Skill.EDGED_WEAPONS]: 2, [Skill.BASHING_WEAPONS]: 2, [Skill.ARCHERY]: 4,
    [Skill.DISARM_TRAPS]: 4, [Skill.LOCKPICKING]: 4, [Skill.POISON]: 2, [Skill.LUCK]: 1,
  },
  {
    [Skill.STRENGTH]: 3, [Skill.DEXTERITY]: 2, [Skill.INTELLIGENCE]: 6,
    [Skill.EDGED_WEAPONS]: 2, [Skill.THROWN_MISSILES]: 2,
    [Skill.MAGE_SPELLS]: 3, [Skill.MAGE_LORE]: 3, [Skill.ITEM_LORE]: 1,
  },
  {
    [Skill.STRENGTH]: 2, [Skill.DEXTERITY]: 2, [Skill.INTELLIGENCE]: 6,
    [Skill.EDGED_WEAPONS]: 3, [Skill.THROWN_MISSILES]: 2,
    [Skill.MAGE_SPELLS]: 2, [Skill.PRIEST_SPELLS]: 1, [Skill.MAGE_LORE]: 4,
    [Skill.LUCK]: 1,
  },
  {
    [Skill.STRENGTH]: 2, [Skill.DEXTERITY]: 2, [Skill.INTELLIGENCE]: 6,
    [Skill.BASHING_WEAPONS]: 2, [Skill.THROWN_MISSILES]: 2, [Skill.DEFENSE]: 1,
    [Skill.PRIEST_SPELLS]: 3, [Skill.MAGE_LORE]: 3, [Skill.ALCHEMY]: 2,
  },
];

const DEFAULT_TRAITS: number[][] = [
  [2, 6, 11], // ambidextrous, good constitution, magically inept
  [0, 5, 10], // toughness, woodsman, sluggish
  [3, 12], // nimble, frail
  [1], // magically apt
  [4, 6, 7, 14], // cave lore, good constitution, highly alert, bad back
  [1], // magically apt
];

const DEBUG_NAMES = ['Gunther', 'Yanni', 'Mandolin', 'Pete', 'Vraiment', 'Goo'];

export function makePresetPlayer(preset: PartyPreset, slot: number): Player {
  const pc = new Player();
  pc.mainStatus = MainStatus.ALIVE;
  pc.uniqueId = slot + 1000;
  pc.direction = Direction.N;

  if (preset === PartyPreset.DEBUG) {
    pc.name = DEBUG_NAMES[slot] ?? '';
    pc.skills[Skill.STRENGTH] = 20;
    pc.skills[Skill.DEXTERITY] = 20;
    pc.skills[Skill.INTELLIGENCE] = 20;
    for (let i = 3; i < NUM_SKILLS; i++) pc.skills[i] = 8;
    pc.curHealth = pc.maxHealth = 60;
    pc.curSp = pc.maxSp = 90;
    pc.skillPts = 60;
    pc.expAdj = 50;
    for (let i = 0; i < 10; i++) pc.traits[i] = true;
    // 1, 4, 7, 10, 13, 16 — with slot 2 bumped by one
    pc.whichGraphic = slot * 3 + 1 + (slot === 2 ? 1 : 0);
    return pc;
  }

  pc.name = DEFAULT_NAMES[slot] ?? '';
  const skills = DEFAULT_SKILLS[slot] ?? {};
  for (let i = 0; i < NUM_SKILLS; i++) pc.skills[i] = skills[i as Skill] ?? 0;
  pc.curHealth = pc.maxHealth = DEFAULT_HEALTH[slot] ?? 6;
  pc.curSp = pc.maxSp = DEFAULT_SP[slot] ?? 0;
  pc.skillPts = 0;
  for (const t of DEFAULT_TRAITS[slot] ?? []) pc.traits[t] = true;
  pc.race = DEFAULT_RACE[slot] ?? Race.HUMAN;
  pc.whichGraphic = DEFAULT_GRAPHICS[slot] ?? 0;
  return pc;
}
