/**
 * Talking mode — the conversation state machine from boe.dlgutil.cpp
 * (start_talk_mode :709, handle_talk_node :829, reset_talk_words :665) and
 * scan_for_response (boe.newgraph.cpp:1085).
 *
 * Conversation in BoE is keyword-driven: the NPC's reply is prose, and any
 * word in it whose first four letters match a talk node's keyword becomes
 * clickable. That matching is deliberately four characters, case-insensitive,
 * exactly as the original does it.
 */

import { Speech, TalkNode, TalkNodeType } from '../data/talking';
import { Attitude } from '../data/monster';
import { Universe } from '../universe/universe';
import { Creature, CreatureStatus } from '../universe/creature';
import { ItemShopMode } from './itemShop';

/** Pseudo-node ids for the fixed buttons (boe.newgraph.hpp:31). */
export enum TalkAction {
  DUNNO = -1,
  BUY = -2,
  SELL = -3,
  BUSINESS = -4,
  LOOK = -10,
  NAME = -11,
  JOB = -12,
  RECORD = -13,
  DONE = -14,
  BACK = -15,
  ASK = -16,
}

/**
 * The preset buttons, their positions inside the talk area (x, y), and their
 * keyboard shortcuts — talk_chars (boe.actions.cpp:2790) pairs one letter with
 * each preset in this order.
 */
export const PRESET_WORDS: { word: string; node: TalkAction; x: number; y: number; key: string }[] = [
  { word: 'Look', node: TalkAction.LOOK, x: 4, y: 366, key: 'l' },
  { word: 'Name', node: TalkAction.NAME, x: 70, y: 366, key: 'n' },
  { word: 'Job', node: TalkAction.JOB, x: 136, y: 366, key: 'j' },
  { word: 'Buy', node: TalkAction.BUY, x: 4, y: 389, key: 'b' },
  { word: 'Sell', node: TalkAction.SELL, x: 70, y: 389, key: 's' },
  { word: 'Record', node: TalkAction.RECORD, x: 121, y: 389, key: 'r' },
  { word: 'Done', node: TalkAction.DONE, x: 210, y: 389, key: 'd' },
  { word: 'Go Back', node: TalkAction.BACK, x: 190, y: 366, key: 'g' },
  { word: 'Ask About...', node: TalkAction.ASK, x: 4, y: 343, key: 'a' },
];

/** A clickable word: either a preset button or a keyword inside the reply. */
export interface TalkWord {
  word: string;
  node: number;
  preset: boolean;
  /** Filled in by the renderer once it knows where the word landed. */
  rect: { top: number; left: number; bottom: number; right: number } | null;
}

interface HistoryEntry {
  canRecord: boolean;
  specialNode: boolean;
  node: number;
  text: [string, string];
}

export class TalkState {
  /** Absolute personality id of whoever we're talking to. */
  readonly personality: number;
  /** Index into the town's creature list, or -1 when a special started this. */
  readonly monsterIndex: number;
  readonly monsterType: number;
  readonly facePic: number;
  /** "Name:" as shown above the reply. */
  title = '';
  str1 = '';
  str2 = '';
  /** True once a node has forced the conversation to end. */
  endForced = false;
  canRecord = true;
  /** Set when a node needs a system this port hasn't built yet. */
  lastUnsupported: TalkNodeType | null = null;
  /**
   * How a SHOP node opens a shop. The session owns mode changes, so it supplies
   * this; it returns false when the shop has nothing to sell.
   */
  onShop: ((shopNum: number, costAdj: number, name: string) => boolean) | null = null;
  /**
   * How the SELL/IDENTIFY/ENCHANT/RECHARGE nodes put the inventory panel into a
   * service mode. Same reason as onShop: the session owns the panel.
   */
  onItemShop: ((mode: ItemShopMode, a: number, b: number, c: number) => void) | null = null;
  /**
   * How the two call-special nodes run a chain. The VM is async, so the reply
   * is patched in when the chain finishes rather than before this node returns;
   * the host redraws either way, so the difference isn't visible.
   */
  onCallSpecial: ((node: number, scenario: boolean) => void) | null = null;
  /** How a TRAINING node opens the spend-skill-points dialog. */
  onTrain: (() => void) | null = null;
  /** How an INN node rests the party and moves it to the bed it paid for. */
  onRest:
    | ((length: number, hp: number, sp: number, wakeAt: { x: number; y: number }) => void)
    | null = null;
  private history: HistoryEntry[] = [];
  /** Clickable words, rebuilt after every reply. */
  words: TalkWord[] = [];

  constructor(
    private univ: Universe,
    monsterIndex: number,
    personality: number,
    monsterType: number,
    facePic: number,
  ) {
    this.monsterIndex = monsterIndex;
    this.personality = personality;
    this.monsterType = monsterType;
    this.facePic = facePic;

    const person = this.person;
    this.title = `${person?.title ?? ''}:`;
    this.str1 = person?.look ?? '';
    this.str2 = '';
    this.history.push({ canRecord: true, specialNode: false, node: -1, text: [this.str1, ''] });
    this.rebuildWords();
  }

  /** cur_talk() — the Speech record for this personality's town. */
  get speech(): Speech | null {
    return this.univ.scenario.townTalk[Math.floor(this.personality / 10)] ?? null;
  }

  get person() {
    return this.speech?.people[this.personality % 10] ?? null;
  }

  private get creature(): Creature | null {
    return this.univ.town?.monsters[this.monsterIndex] ?? null;
  }

  /** Whether "Go Back" is offered (needs somewhere to go back to). */
  get canGoBack(): boolean {
    return this.history.length >= 2;
  }

  /**
   * scan_for_response: the first talk node whose keyword matches the first
   * four characters of `str`, restricted to nodes for this personality
   * (-2 means "anyone in this town").
   */
  scanForResponse(str: string): number {
    const key = str.slice(0, 4).toLowerCase();
    if (key.trim().length === 0) return -1;
    const nodes = this.speech?.talkNodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node.personality === -1) continue;
      if (node.personality !== this.personality && node.personality !== -2) continue;
      if (node.link1.slice(0, 4).toLowerCase() === key) return i;
      if (node.link2.slice(0, 4).toLowerCase() === key) return i;
    }
    return -1;
  }

  /**
   * Rebuild the clickable-word list: the preset buttons plus every word in the
   * current reply that resolves to a talk node. reset_talk_words drops most
   * presets once the conversation is forced to end.
   */
  private rebuildWords(): void {
    this.words = [];
    for (const preset of PRESET_WORDS) {
      if (this.endForced && preset.node !== TalkAction.DONE && preset.node !== TalkAction.RECORD)
        continue;
      if (!this.canRecord && preset.node === TalkAction.RECORD) continue;
      if (preset.node === TalkAction.BACK && !this.canGoBack) continue;
      this.words.push({ word: preset.word, node: preset.node, preset: true, rect: null });
    }
    if (this.endForced) return;
    for (const hit of this.keywordHits()) {
      this.words.push({ word: hit.word, node: hit.node, preset: false, rect: null });
    }
  }

  /**
   * The keyword matches inside the current reply, in the order they appear.
   * The original scans a single string of "str1 |str2 " and treats runs of
   * letters, hyphens and apostrophes as words.
   */
  keywordHits(): { word: string; node: number; start: number; end: number }[] {
    const str = this.fullText();
    const hits: { word: string; node: number; start: number; end: number }[] = [];
    const wordRe = /[A-Za-z'-]+/g;
    let m: RegExpExecArray | null;
    while ((m = wordRe.exec(str)) !== null) {
      const node = this.scanForResponse(str.slice(m.index));
      if (node >= 0)
        hits.push({ word: m[0], node, start: m.index, end: m.index + m[0].length });
    }
    return hits;
  }

  /** The reply as one string; '|' separates the two halves, as in the C++. */
  fullText(): string {
    return `${this.str1} |${this.str2} `;
  }

  /**
   * The preset a keystroke activates, or null. Escape acts as Done and Space as
   * Go Back (boe.actions.cpp:2876). Only presets currently on screen respond,
   * so a forced-end conversation only answers Done and Record.
   */
  presetForKey(key: string): TalkWord | null {
    let letter = key.toLowerCase();
    if (key === 'Escape') letter = 'd';
    else if (key === ' ') letter = 'g';
    const preset = PRESET_WORDS.find((p) => p.key === letter);
    if (!preset) return null;
    return this.words.find((w) => w.preset && w.word === preset.word) ?? null;
  }

  // ------------------------------------------------------------------ nodes

  /**
   * handle_talk_node. Returns 'done' when the conversation should close.
   *
   * Node types that need systems this port hasn't built (shops, training,
   * inns, quests, the specials VM) reply with the node's own text and record
   * themselves in `lastUnsupported` rather than silently doing nothing.
   */
  handleNode(which: number, isRedo = false): 'ok' | 'done' {
    if (which === TalkAction.DUNNO) return 'ok';
    this.lastUnsupported = null;

    let target = which;
    switch (which) {
      case TalkAction.BUSINESS:
        this.canRecord = false;
        return this.finish('You conclude your business.', '');
      case TalkAction.LOOK:
        return this.finish(this.person?.look ?? '', '');
      case TalkAction.NAME:
        return this.finish(this.person?.name ?? '', '');
      case TalkAction.JOB:
        return this.finish(this.person?.job ?? '', '');
      case TalkAction.BUY: {
        // "Buy" tries each of the shopkeeping keywords in turn.
        const keys = ['purc', 'sale', 'heal', 'iden', 'trai', 'ench'];
        target = -1;
        for (const key of keys) {
          target = this.scanForResponse(key);
          if (target >= 0) break;
        }
        if (target < 0) return this.dunno();
        break;
      }
      case TalkAction.SELL:
        target = this.scanForResponse('sell');
        if (target < 0) return this.dunno();
        break;
      case TalkAction.RECORD:
        // TODO(M6): conversation notes need the party's talk_save journal.
        this.univ.addStringToBuf('Conversation notes are not implemented yet.');
        return 'ok';
      case TalkAction.DONE:
        return 'done';
      case TalkAction.BACK:
        return this.goBack();
      case TalkAction.ASK:
        // The caller supplies the typed word through askAbout() instead.
        return 'ok';
      default:
        break;
    }

    const node = this.speech?.talkNodes[target];
    if (!node) return this.dunno();
    return this.runNode(target, node, isRedo);
  }

  /** The "Ask About..." prompt, once the player has typed something. */
  askAbout(text: string): 'ok' | 'done' {
    const asked = text.trim().toLowerCase();
    if (asked.startsWith('name')) return this.handleNode(TalkAction.NAME);
    if (asked.startsWith('look')) return this.handleNode(TalkAction.LOOK);
    if (asked.startsWith('job') || asked.startsWith('work'))
      return this.handleNode(TalkAction.JOB);
    if (asked.startsWith('bye')) return 'done';
    if (asked.startsWith('buy')) return this.handleNode(TalkAction.BUY);
    if (asked.startsWith('sell')) return this.handleNode(TalkAction.SELL);
    const node = this.scanForResponse(asked);
    if (node < 0) return this.dunno();
    const record = this.speech?.talkNodes[node];
    return record ? this.runNode(node, record, false) : this.dunno();
  }

  private runNode(index: number, node: TalkNode, isRedo: boolean): 'ok' | 'done' {
    const { party } = this.univ;
    const [a, b, c, d] = [node.extras[0]!, node.extras[1]!, node.extras[2]!, node.extras[3]!];
    let str1 = node.str1;
    let str2 = node.str2;
    this.canRecord = true;

    /** Several node types mean "show str2 instead when the test fails". */
    const useSecond = (): void => {
      str1 = str2;
      str2 = '';
    };

    switch (node.type) {
      case TalkNodeType.REGULAR:
        break;
      case TalkNodeType.DEP_ON_SDF:
        if (party.getSdf(a, b) > c) useSecond();
        else str2 = '';
        break;
      case TalkNodeType.SET_SDF:
        party.setSdf(a, b, c);
        break;
      case TalkNodeType.DEP_ON_TIME:
        if (party.dayReached(a)) useSecond();
        else str2 = '';
        break;
      case TalkNodeType.DEP_ON_TIME_AND_EVENT:
        if (party.dayReached(a, b)) useSecond();
        else str2 = '';
        break;
      case TalkNodeType.DEP_ON_TOWN:
        if (party.townNum !== a) useSecond();
        else str2 = '';
        break;
      case TalkNodeType.BUY_INFO:
        if (party.gold < a) useSecond();
        else {
          party.gold -= a;
          str2 = '';
        }
        break;
      case TalkNodeType.BUY_SDF:
        if (party.sdLegit(b, c) && party.getSdf(b, c) === d) {
          str1 = "You've already learned that.";
          str2 = '';
          this.canRecord = false;
        } else if (party.gold < a) useSecond();
        else {
          party.gold -= a;
          party.setSdf(b, c, d);
          str2 = '';
        }
        break;
      case TalkNodeType.BUY_SPEC_ITEM:
        if (party.specItems.has(a)) {
          str1 = 'You already have it.';
          str2 = '';
          this.canRecord = false;
        } else if (party.gold < b) useSecond();
        else {
          party.gold -= b;
          party.specItems.add(a);
          str2 = '';
        }
        break;
      case TalkNodeType.BUY_TOWN_LOC: {
        const town = this.univ.scenario.towns[b];
        if (town?.canFind) {
          str1 = "You've already learned that.";
          str2 = '';
        } else if (party.gold < a) useSecond();
        else {
          party.gold -= a;
          if (town) town.canFind = true;
          str2 = '';
        }
        break;
      }
      case TalkNodeType.SHOP:
        // b names the shop, a is its cost adjustment, and this node's own text
        // becomes the shop's title (boe.dlgutil.cpp:999).
        this.canRecord = false;
        if (this.onShop?.(b, a, str1)) {
          // The shop is on screen now; this reply is behind it.
          str2 = '';
        } else {
          // A shop with nothing to sell falls back to str2, or a default line.
          str1 = str2.length > 0 ? str2 : 'There is nothing available to buy.';
          str2 = '';
        }
        break;
      case TalkNodeType.TRAINING:
        // The trainer's own text is replaced; the training itself happens in a
        // dialog the host runs (boe.dlgutil.cpp:991).
        this.canRecord = false;
        str1 = 'You conclude your training.';
        str2 = '';
        this.onTrain?.();
        break;
      case TalkNodeType.INN:
        // a is the price, b scales the rest, and (c,d) is the bed you wake in.
        if (party.gold < a) useSecond();
        else {
          this.endForced = true;
          party.gold -= a;
          this.onRest?.(700, 30 * b, 25 * b, { x: c, y: d });
          str2 = '';
        }
        break;
      // The four services that work on the party's own goods just switch the
      // inventory panel into a mode; the reply stays on screen beside it
      // (boe.dlgutil.cpp:1025-1059).
      case TalkNodeType.SELL_WEAPONS:
        this.canRecord = false;
        this.onItemShop?.(ItemShopMode.SELL_WEAPONS, a, b, c);
        break;
      case TalkNodeType.SELL_ARMOR:
        this.canRecord = false;
        this.onItemShop?.(ItemShopMode.SELL_ARMOR, a, b, c);
        break;
      case TalkNodeType.SELL_ITEMS:
        this.canRecord = false;
        this.onItemShop?.(ItemShopMode.SELL_ANY, a, b, c);
        break;
      case TalkNodeType.IDENTIFY:
        this.canRecord = false;
        this.onItemShop?.(ItemShopMode.IDENTIFY, a, b, c);
        break;
      case TalkNodeType.ENCHANT:
        this.canRecord = false;
        this.onItemShop?.(ItemShopMode.ENCHANT, a, b, c);
        break;
      case TalkNodeType.RECHARGE:
        this.canRecord = false;
        this.onItemShop?.(ItemShopMode.RECHARGE, a, b, c);
        break;
      case TalkNodeType.CALL_TOWN_SPEC:
        this.onCallSpecial?.(a, false);
        break;
      case TalkNodeType.CALL_SCEN_SPEC:
        this.onCallSpecial?.(a, true);
        break;
      case TalkNodeType.END_FORCE:
        this.endForced = true;
        break;
      case TalkNodeType.END_FIGHT: {
        const monst = this.creature;
        if (monst) {
          monst.attitude = Attitude.HOSTILE_A;
          monst.mobile = true;
        }
        this.endForced = true;
        break;
      }
      case TalkNodeType.END_ALARM:
        // make_town_hostile: everything friendly in town turns on the party.
        for (const monst of this.univ.town?.monsters ?? [])
          if (monst.isFriendly) monst.attitude = Attitude.HOSTILE_A;
        this.endForced = true;
        break;
      case TalkNodeType.END_DIE: {
        const monst = this.creature;
        if (monst) {
          monst.active = CreatureStatus.DEAD;
          if (party.sdLegit(monst.spec1, monst.spec2)) party.setSdf(monst.spec1, monst.spec2, 1);
        }
        this.endForced = true;
        break;
      }
      default:
        // Shops, inns, training, job banks, quests, vehicles and the two
        // call-special nodes all need systems that arrive in later milestones.
        this.lastUnsupported = node.type;
        break;
    }

    if (!isRedo)
      this.history.push({
        canRecord: this.canRecord,
        specialNode: false,
        node: index,
        text: [str1, str2],
      });
    this.str1 = str1;
    this.str2 = str2;
    this.rebuildWords();
    return 'ok';
  }

  private dunno(): 'ok' | 'done' {
    let text = this.person?.dunno ?? '';
    if (text.length < 2) text = 'You get no response.';
    return this.finish(text, '');
  }

  private goBack(): 'ok' | 'done' {
    if (this.history.length === 0) return 'ok';
    let last: HistoryEntry | undefined;
    do {
      last = this.history.pop();
      // Repeated identical text doesn't count as a step back.
    } while (
      this.history.length > 0 &&
      last !== undefined &&
      this.str1 === last.text[0] &&
      this.str2 === last.text[1]
    );
    if (!last) return 'ok';
    this.canRecord = last.canRecord;
    this.str1 = last.text[0];
    this.str2 = last.text[1];
    this.rebuildWords();
    return 'ok';
  }

  /**
   * end_shop_mode's return path (boe.dlgutil.cpp:243): coming back from a shop
   * into a conversation, the shopkeeper acknowledges the visit is over.
   */
  concludeBusiness(): void {
    this.canRecord = false;
    this.finish('You conclude your business.', '');
  }

  /**
   * A special that ran during a conversation answers with two string numbers
   * rather than a dialog; this swaps them in as the reply
   * (handle_message's TALK branch, boe.specials.cpp:4645).
   */
  setReply(str1: number, str2: number, strs: string[]): void {
    if (str1 < 0 && str2 < 0) return;
    this.str1 = str1 >= 0 ? strs[str1] ?? '' : '';
    this.str2 = str2 >= 0 ? strs[str2] ?? '' : '';
    this.rebuildWords();
  }

  private finish(str1: string, str2: string): 'ok' | 'done' {
    this.str1 = str1;
    this.str2 = str2;
    this.history.push({
      canRecord: this.canRecord,
      specialNode: false,
      node: -1,
      text: [str1, str2],
    });
    this.rebuildWords();
    return 'ok';
  }
}
