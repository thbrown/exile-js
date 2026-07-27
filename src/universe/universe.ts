/**
 * cUniverse (universe/universe.hpp:185) — all mutable game state in one
 * object rather than C++ globals, so tests and replays can construct an
 * isolated world and inject a seeded RNG.
 */

import { GameRng } from '../core/rng';
import { Item, ItemType, defaultItem } from '../data/item';
import { JobBank, QuestStatus, makeJob, specItemStartWith } from '../data/quest';
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
import { setLivingRng, setPrintResult } from './living';
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
    // Same reason: cCreature::magic_adjust and its callers reach for the
    // global get_ran from methods this port hands no rng.
    setLivingRng(rng);
    // The scenario decides where the party starts; the cParty defaults are
    // Exile III relics that get overwritten immediately (party.cpp:28).
    this.party.outdoorCorner = { ...scenario.outdoorStart };
    this.party.iwc = { x: 0, y: 0 };
    this.party.locInSec = { ...scenario.sectorStart };
    this.party.outLoc = { ...scenario.sectorStart };
    // enter_scenario (universe.cpp:1396): the party gets its own copy of
    // every vehicle the scenario placed.
    this.party.boats = scenario.boats.filter((v) => v.exists).map((v) => ({ ...v }));
    this.party.horses = scenario.horses.filter((v) => v.exists).map((v) => ({ ...v }));
    this.out = new CurOut(scenario, this.party);
    this.out.addMaps();
    // The tail of cUniverse::set_scenario (universe.cpp:1438): the party begins
    // holding every special item flagged start-with, and every quest flagged
    // auto-start is already under way — on day 1, not on the current day.
    for (let i = 0; i < scenario.specialItems.length; i++) {
      if (specItemStartWith(scenario.specialItems[i]!)) this.party.specItems.add(i);
    }
    for (let i = 0; i < scenario.quests.length; i++) {
      if (scenario.quests[i]!.autoStart) this.party.activeQuests.set(i, makeJob(1));
    }
    this.refreshStoreItems();
  }

  /**
   * cUniverse::generate_job_bank (universe.cpp:1463) — roll a job board's
   * offers. Called lazily the first time the board is opened, so an angry board
   * (anger raised by a missed deadline) only bites on its next refresh.
   *
   * Two things worth knowing: it fills at most **four** of the six slots, and
   * it stops scanning the quest list once those four are full — so a quest late
   * in the list can never be offered while earlier ones keep winning their
   * rolls. Both are the C++'s.
   *
   * Divergence, invisible: the C++ reads `party.active_quests[i]`, which on a
   * std::map *inserts* a default (AVAILABLE) record for every quest it looks
   * at. Here an absent entry simply reads as AVAILABLE and nothing is written.
   */
  generateJobBank(which: number): JobBank {
    const bank = this.party.jobBank(which);
    bank.jobs.fill(-1);
    bank.inited = true;
    let slot = 0;
    for (let i = 0; slot < 4 && i < this.scenario.quests.length; i++) {
      const quest = this.scenario.quests[i]!;
      if (quest.bank1 !== which && quest.bank2 !== which) continue;
      const held = this.party.activeQuests.get(i);
      if (held !== undefined && held.status !== QuestStatus.AVAILABLE) continue;
      if (this.rng.getRan(1, 1, 100) <= 50 - bank.anger) bank.jobs[slot++] = i;
    }
    return bank;
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
    // Job banks are *not* refreshed here: generate_job_bank runs lazily when a
    // JOB_BANK talk node opens the board (boe.dlgutil.cpp:813).
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

  /**
   * When each transcript line becomes *visible*, on the shared animation
   * timeline — `transcriptAt[i]` goes with `transcript[i]`.
   *
   * The C++ needs nothing like this: `add_string_to_buf` fills a buffer and the
   * pane is only repainted later, and because `do_missile_anim` blocks, a line
   * added after it cannot appear until the missile has landed. This port runs
   * the game logic straight through and repaints every frame, so "Guard takes
   * 3" would otherwise be on screen while the flame is still in the air.
   */
  transcriptAt: number[] = [];

  /**
   * Supplies the moment a new line should become visible. The host sets this to
   * the animation timeline; left alone it stamps 0, which is always in the
   * past, so tests and headless runs see every line immediately.
   */
  transcriptClock: () => number = () => 0;

  /** add_string_to_buf (boe.text.cpp) — one line into the transcript pane. */
  addStringToBuf(text: string): void {
    this.transcript.push(text);
    this.transcriptAt.push(this.transcriptClock());
    if (this.transcript.length > TRANSCRIPT_MAX) {
      const drop = this.transcript.length - TRANSCRIPT_MAX;
      this.transcript.splice(0, drop);
      this.transcriptAt.splice(0, drop);
    }
  }

  /**
   * The lines the pane may show right now. Everything the game has said is in
   * `transcript`; this is the prefix whose moment has come.
   */
  visibleTranscript(now: number): string[] {
    let end = this.transcript.length;
    while (end > 0 && (this.transcriptAt[end - 1] ?? 0) > now) end--;
    return this.transcript.slice(0, end);
  }
}
