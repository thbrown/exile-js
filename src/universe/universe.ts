/**
 * cUniverse (universe/universe.hpp:185) — all mutable game state in one
 * object rather than C++ globals, so tests and replays can construct an
 * isolated world and inject a seeded RNG.
 */

import { GameRng } from '../core/rng';
import { Item, ItemType, defaultItem } from '../data/item';
import { Scenario } from '../data/scenario';
import { ShopItemType, ShopType } from '../data/shop';
import { Town } from '../data/town';
import { returnTreasure } from '../data/treasure';
import { SpecCtxType } from '../game/specials/context';

/** BUFFER_STR (universe.hpp:247) — "the string buffer" as a message number. */
export const BUFFER_STR = -8;
import { Terrain } from '../data/terrain';
import { CurOut } from './curOut';
import { CurTown } from './curTown';
import { setPrintResult } from './living';
import { Party, TOWN_NUM_OUTDOORS } from './party';
import { PartyPreset, NUM_PC_SLOTS, Player, makePresetPlayer } from './player';

/** Lines kept in the scrolling transcript pane. */
const TRANSCRIPT_MAX = 400;

export class Universe {
  party = new Party();
  out: CurOut;
  town: CurTown | null = null;
  /** Index of the PC whose turn/selection is active. */
  curPc = 0;
  /** Scrolling text pane contents, oldest first. */
  transcript: string[] = [];

  constructor(
    readonly scenario: Scenario,
    readonly rng: GameRng,
    preset: PartyPreset = PartyPreset.DEFAULT,
  ) {
    for (let i = 0; i < NUM_PC_SLOTS; i++) {
      const pc = makePresetPlayer(preset, i);
      pc.party = this.party;
      this.party.pcs.push(pc);
    }
    // iLiving's status effects print through a static hook in the C++; point it
    // at this Universe's transcript. Constructing a second Universe steals it,
    // which is fine — tests build one at a time and the game only ever has one.
    setPrintResult((line) => { this.addStringToBuf(line); });
    // The scenario decides where the party starts; the cParty defaults are
    // Exile III relics that get overwritten immediately (party.cpp:28).
    this.party.outdoorCorner = { ...scenario.outdoorStart };
    this.party.iwc = { x: 0, y: 0 };
    this.party.locInSec = { ...scenario.sectorStart };
    this.party.outLoc = { ...scenario.sectorStart };
    this.out = new CurOut(scenario, this.party);
    this.out.addMaps();
    this.refreshStoreItems();
  }

  /**
   * cUniverse::refresh_store_items (universe.cpp:1486) — roll the stock of
   * every random shop. Called when a scenario starts and whenever a special
   * asks for a refresh.
   */
  refreshStoreItems(): void {
    for (let i = 0; i < this.scenario.shops.length; i++) {
      const shop = this.scenario.shops[i]!;
      if (shop.type !== ShopType.RANDOM) continue;
      for (let j = 0; j < shop.size; j++) {
        const entry = shop.getItem(j);
        if (entry.type === ShopItemType.TREASURE) {
          this.setStoreItem(i, j, this.randomStoreItem(entry.item.itemLevel, entry.item.itemLevel === 0));
        } else if (entry.type === ShopItemType.CLASS) {
          const choices: number[] = [];
          for (let k = 0; k < this.scenario.scenItems.length; k++) {
            if (this.scenario.scenItems[k]!.specialClass === entry.item.specialClass) choices.push(k);
          }
          const choice = this.rng.getRan(1, 0, choices.length);
          if (choice < choices.length)
            this.setStoreItem(i, j, { ...this.scenario.scenItems[choices[choice]!]! });
        } else if (entry.type === ShopItemType.OPT_ITEM) {
          const roll = this.rng.getRan(1, 1, 100);
          if (roll <= Math.trunc(entry.quantity / 1000)) this.setStoreItem(i, j, { ...entry.item });
        }
      }
    }
    // TODO(M6): generate_job_bank for each of the party's job banks.
  }

  /**
   * cUniverse::difficulty_adjust (universe.cpp:1352) — the multiplier on every
   * monster's health, so a strong party meets tougher versions of the same
   * monsters. A scenario can opt out, and its own difficulty rating decides how
   * early the steps kick in.
   */
  difficultyAdjust(): number {
    if (!this.scenario.adjustDiff) return 1;
    let partyLevel = 0;
    for (const pc of this.party.pcs) if (pc.isAlive) partyLevel += pc.level;
    let adj = 1;
    if (this.scenario.difficulty <= 0 && partyLevel >= 60) adj++;
    if (this.scenario.difficulty <= 1 && partyLevel >= 130) adj++;
    if (this.scenario.difficulty <= 2 && partyLevel >= 210) adj++;
    return adj;
  }

  /** cUniverse::get_random_store_item (universe.cpp:1478). */
  private randomStoreItem(lootType: number, allowJunk: boolean): Item {
    let item = returnTreasure(this.scenario, this.rng, lootType, allowJunk);
    if (item.variety === ItemType.GOLD || item.variety === ItemType.SPECIAL
      || item.variety === ItemType.FOOD || item.variety === ItemType.QUEST) item = defaultItem();
    item.ident = true;
    return item;
  }

  private setStoreItem(shop: number, slot: number, item: Item): void {
    let byShop = this.party.magicStoreItems.get(shop);
    if (!byShop) {
      byShop = new Map();
      this.party.magicStoreItems.set(shop, byShop);
    }
    byShop.set(slot, item);
  }

  storeItem(shop: number, slot: number): Item {
    return this.party.magicStoreItems.get(shop)?.get(slot) ?? defaultItem();
  }

  get currentPc(): Player {
    return this.party.pcs[this.curPc] ?? this.party.pcs[0]!;
  }

  firstActivePc(): number {
    const i = this.party.pcs.findIndex((pc) => pc.isAlive);
    return i < 0 ? 0 : i;
  }

  /** The town record the party is in, or null when outdoors. */
  get townRecord(): Town | null {
    return this.town?.record ?? null;
  }

  terrainType(index: number): Terrain {
    return this.scenario.terTypes[index]!;
  }

  isInTown(): boolean {
    return this.party.townNum < TOWN_NUM_OUTDOORS;
  }

  /**
   * The specials VM's text buffer (cUniverse::strbuf) plus its ten spares.
   * Scripts build a string in it with the APPEND_* nodes and then print it by
   * naming string number BUFFER_STR.
   */
  strBuf = '';
  extraBufs: string[] = new Array<string>(10).fill('');

  swapBuf(which: number): void {
    if (which < 0 || which >= this.extraBufs.length) return;
    const tmp = this.strBuf;
    this.strBuf = this.extraBufs[which]!;
    this.extraBufs[which] = tmp;
  }

  /**
   * cUniverse::get_str (universe.cpp:1529) — resolve a message number against
   * the list its node lives in. -1 means "no string"; BUFFER_STR is the text
   * buffer. Returns null when the number is out of range.
   */
  getStr(type: SpecCtxType, which: number): string | null {
    if (which === BUFFER_STR) return this.strBuf;
    if (which === -1) return null;
    const list = type === SpecCtxType.OUTDOOR
      ? this.out.sector.specStrs
      : type === SpecCtxType.TOWN
        ? this.town?.record.specStrs ?? []
        : this.scenario.specStrs;
    if (which < 0 || which >= list.length) return null;
    return list[which] ?? '';
  }

  /** cUniverse::get_strs — the common "a message and its continuation" pair. */
  getStrs(type: SpecCtxType, which1: number, which2: number): [string, string] {
    return [this.getStr(type, which1) ?? '', this.getStr(type, which2) ?? ''];
  }

  /** add_string_to_buf (boe.text.cpp) — one line into the transcript pane. */
  addStringToBuf(text: string): void {
    this.transcript.push(text);
    if (this.transcript.length > TRANSCRIPT_MAX)
      this.transcript.splice(0, this.transcript.length - TRANSCRIPT_MAX);
  }
}
