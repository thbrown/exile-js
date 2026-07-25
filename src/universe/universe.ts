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
import { Terrain } from '../data/terrain';
import { CurOut } from './curOut';
import { CurTown } from './curTown';
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
    for (let i = 0; i < NUM_PC_SLOTS; i++) this.party.pcs.push(makePresetPlayer(preset, i));
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

  /** add_string_to_buf (boe.text.cpp) — one line into the transcript pane. */
  addStringToBuf(text: string): void {
    this.transcript.push(text);
    if (this.transcript.length > TRANSCRIPT_MAX)
      this.transcript.splice(0, this.transcript.length - TRANSCRIPT_MAX);
  }
}
