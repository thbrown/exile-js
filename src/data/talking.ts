/**
 * Town dialogue data — cSpeech/cPersonality/eTalkNode from
 * ../exile-wasm/src/scenario/talking.hpp.
 */

export enum TalkNodeType {
  REGULAR = 0,
  DEP_ON_SDF = 1,
  SET_SDF = 2,
  INN = 3,
  DEP_ON_TIME = 4,
  DEP_ON_TIME_AND_EVENT = 5,
  DEP_ON_TOWN = 6,
  SHOP = 7,
  TRAINING = 8,
  JOB_BANK = 9,
  RECHARGE = 12,
  SELL_WEAPONS = 13,
  SELL_ARMOR = 14,
  SELL_ITEMS = 15,
  IDENTIFY = 16,
  ENCHANT = 17,
  BUY_INFO = 18,
  BUY_SDF = 19,
  BUY_SHIP = 20,
  BUY_HORSE = 21,
  BUY_SPEC_ITEM = 22,
  RECEIVE_QUEST = 23,
  BUY_TOWN_LOC = 24,
  END_FORCE = 25,
  END_FIGHT = 26,
  END_ALARM = 27,
  END_DIE = 28,
  CALL_TOWN_SPEC = 29,
  CALL_SCEN_SPEC = 30,
}

export interface Personality {
  title: string;
  look: string;
  name: string;
  job: string;
  dunno: string;
}

export function emptyPersonality(): Personality {
  return { title: '', look: '', name: '', job: '', dunno: '' };
}

/** cSpeech::cNode — keywords padded to 4 chars with 'x' on read. */
export interface TalkNode {
  personality: number;
  type: TalkNodeType;
  link1: string; // 4 chars
  link2: string; // 4 chars
  extras: number[]; // 4
  str1: string;
  str2: string;
}

export function emptyTalkNode(): TalkNode {
  return {
    personality: -1,
    type: TalkNodeType.REGULAR,
    link1: '    ',
    link2: '    ',
    extras: [-1, -1, -1, -1],
    str1: '',
    str2: '',
  };
}

export interface Speech {
  people: Personality[]; // 10 per town
  talkNodes: TalkNode[];
}

export function emptySpeech(): Speech {
  return {
    people: Array.from({ length: 10 }, emptyPersonality),
    talkNodes: [],
  };
}
