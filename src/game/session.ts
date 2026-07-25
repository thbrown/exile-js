/**
 * GameSession — the mode state machine and the party's movement/transition
 * logic. Ports outd_move_party and town_move_party (boe.actions.cpp:3942 and
 * :4139) plus start_town_mode / end_town_mode (boe.town.cpp:77 and :536),
 * minus the parts that need systems not yet built (specials execution,
 * combat, boats/horses, fields, lighting).
 *
 * Where a port stops short of the original, the omission is marked TODO with
 * the milestone that will fill it in, so drift stays visible.
 */

import { Direction, Location, dist, loc, shiftLoc } from '../core/location';
import { SIGHT_BLOCKED, canSee } from '../core/sight';
import { Item, ItemAbil, ItemType, defaultItem } from '../data/item';
import { MonstTime } from '../data/monster';
import { SECTOR_SIZE } from '../data/outdoors';
import { StepSound, TerObstruct, TerSpec, blocksMove } from '../data/terrain';
import { TalkNodeType } from '../data/talking';
import { Lighting } from '../data/town';
import { Snd, SoundPlayer } from '../platform/sound';
import { Creature, CreatureStatus, assignCreature } from '../universe/creature';
import { CurTown } from '../universe/curTown';
import {
  GiveStatus,
  equipItem,
  giveItem,
  hasAbilEquip,
  takeItemFrom,
  unequipItem,
} from '../universe/inventory';
import { MainStatus, Skill } from '../universe/skills';
import { ShopItemType } from '../data/shop';
import { ShopState, handleSale } from './shop';
import { ItemShopMode, ItemShopState, handleItemShopAction } from './itemShop';
import { OUT_HALF_DIM, OUT_MAX_DIM } from '../universe/curOut';
import { TOWN_NUM_OUTDOORS } from '../universe/party';
import { Universe } from '../universe/universe';
import { GameMode, PreModes, isOut, isTown } from './modes';
import { bashDoor as bashDoorAt, pickLock as pickLockAt } from './doors';
import { TalkAction, TalkState } from './talk';

/** set_direction (boe.locutils.cpp) — direction from one point toward another. */
function setDirection(from: Location, to: Location): Direction {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx === 0 && dy === -1) return Direction.N;
  if (dx === 1 && dy === -1) return Direction.NE;
  if (dx === 1 && dy === 0) return Direction.E;
  if (dx === 1 && dy === 1) return Direction.SE;
  if (dx === 0 && dy === 1) return Direction.S;
  if (dx === -1 && dy === 1) return Direction.SW;
  if (dx === -1 && dy === 0) return Direction.W;
  if (dx === -1 && dy === -1) return Direction.NW;
  return Direction.Here;
}

const DIR_NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest', ''];

/**
 * entry_dir 9 in start_town_mode means "ignore start_locs, use town_force_loc".
 * Until the specials VM can set a forced location, this resolves to the town's
 * first usable start location.
 */
export const FORCED_ENTRY = 9;

/** One row of a select_pc prompt. */
export interface PcChoice {
  index: number;
  label: string;
  canPick: boolean;
}

export class GameSession {
  mode: GameMode = GameMode.OUTDOORS;
  /** The tile the view is centered on; equals the party position in town. */
  center: Location = loc(0, 0);
  private numOutMoves = 0;
  private numTownMoves = 0;
  /** Optional; when absent the game runs silently (as tests do). */
  sound: SoundPlayer | null = null;
  /** Non-null while a conversation is open. */
  talk: TalkState | null = null;
  /** Non-null while a shop is open. */
  shop: ShopState | null = null;
  /**
   * Non-null while the inventory panel is in a shop service mode (selling,
   * identifying, enchanting, recharging) — stat_screen_mode's shop half.
   */
  itemShop: ItemShopState | null = null;
  private preTalkMode: GameMode = GameMode.TOWN;
  private preShopMode: GameMode = GameMode.TOWN;

  constructor(readonly univ: Universe) {
    this.center = { ...univ.party.outLoc };
    this.updateExplored(univ.party.outLoc);
  }

  /**
   * put_party_in_scen (boe.party.cpp:213): a new game starts *inside* the
   * scenario's start town, with the outdoor start position standing by for
   * when the party walks out.
   */
  startNewGame(): void {
    this.univ.addStringToBuf(`Welcome to ${this.univ.scenario.title}.`);
    this.startTownMode(this.univ.scenario.startTown, FORCED_ENTRY);
  }

  private get preModes(): PreModes {
    return { shop: this.preShopMode, talk: this.preTalkMode };
  }

  get isOutdoors(): boolean {
    return isOut(this.mode, this.preModes);
  }

  get inTown(): boolean {
    return isTown(this.mode, this.preModes);
  }

  /** get_location (boe.text.cpp:1248) — the left half of the status bar. */
  locationName(): string {
    if (this.inTown && this.univ.town) {
      const town = this.univ.town.record;
      let name = town.name;
      const p = this.univ.party.townLoc;
      for (const area of town.areaDesc)
        if (p.x >= area.left && p.x <= area.right && p.y >= area.top && p.y <= area.bottom)
          name = area.descr;
      return name;
    }
    const sector = this.univ.out.sector;
    let name = sector.name;
    const p = this.univ.party.locInSec;
    for (const area of sector.areaDesc)
      if (p.x >= area.left && p.x <= area.right && p.y >= area.top && p.y <= area.bottom)
        name = area.descr;
    return name;
  }

  // ---------------------------------------------------------------- movement

  /** The entry point the input layer calls for a directional keypress. */
  move(dir: Direction): boolean {
    const from = this.inTown ? this.univ.party.townLoc : this.univ.party.outLoc;
    const destination = shiftLoc(from, dir);
    return this.moveTo(destination);
  }

  /** handle_action's movement branch (boe.actions.cpp:740-815). */
  moveTo(destination: Location): boolean {
    let moved = false;
    if (this.inTown) {
      moved = this.townMoveParty(destination);
      if (this.inTown && moved) this.center = { ...this.univ.party.townLoc };
    }
    // A town move that leaves the map switches us to outdoors mid-action, and
    // the outdoor move then runs in the same keypress — same as the original.
    if (this.mode === GameMode.OUTDOORS) {
      if (this.outdMoveParty(destination)) {
        moved = true;
        this.center = { ...this.univ.party.outLoc };
        this.updateExplored(this.univ.party.outLoc);
      }
      this.checkTownEntrance();
    }
    return moved;
  }

  private outdIsBlocked(where: Location): boolean {
    const ter = this.univ.terrainType(this.univ.out.at(where.x, where.y));
    return (
      ter.blockage === TerObstruct.BLOCK_MOVE ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT
    );
  }

  /** outd_move_party (boe.actions.cpp:3942). */
  private outdMoveParty(destination: Location): boolean {
    const { party, out, scenario } = this.univ;
    if (!out.isOnMap(destination.x, destination.y)) return false;

    // TODO(M4): check_special_terrain for OUT_MOVE runs here and can block
    // the move or teleport the party into a town.

    const offset = { x: destination.x - party.outLoc.x, y: destination.y - party.outLoc.y };
    const storeCorner = { ...party.outdoorCorner };
    const storeIwc = { ...party.iwc };

    // Sliding the 96x96 window when the party nears its edge.
    if (destination.x < 6 && party.outdoorCorner.x > 0) out.shift(-1, 0);
    if (destination.x > 90 && party.outdoorCorner.x < scenario.outWidth - 1) out.shift(1, 0);
    if (destination.y < 6 && party.outdoorCorner.y > 0) out.shift(0, -1);
    else if (destination.y > 90 && party.outdoorCorner.y < scenario.outHeight - 1) out.shift(0, 1);

    const realDest = loc(party.outLoc.x + offset.x, party.outLoc.y + offset.y);

    const atWorldEdge =
      (realDest.x < 1 && party.outdoorCorner.x <= 0) ||
      (realDest.x > 94 && party.outdoorCorner.x >= scenario.outWidth - 2) ||
      (realDest.x > 46 && party.outdoorCorner.x >= scenario.outWidth - 1) ||
      (realDest.y < 1 && party.outdoorCorner.y <= 0) ||
      (realDest.y > 94 && party.outdoorCorner.y >= scenario.outHeight - 2) ||
      (realDest.y > 46 && party.outdoorCorner.y >= scenario.outHeight - 1);
    if (atWorldEdge) {
      this.univ.addStringToBuf("You've reached the world's edge.");
      return false;
    }

    party.direction = setDirection(party.outLoc, destination);
    const dirStr = DIR_NAMES[party.direction] ?? '';

    // TODO(M6): boarding boats and horses happens here.
    if (this.outdIsBlocked(realDest)) {
      this.univ.addStringToBuf(`Blocked: ${dirStr}`);
      // Undo any window shift the blocked move caused.
      if (storeCorner.x !== party.outdoorCorner.x || storeCorner.y !== party.outdoorCorner.y) {
        out.shift(
          (storeCorner.x - party.outdoorCorner.x) as -1 | 0 | 1,
          (storeCorner.y - party.outdoorCorner.y) as -1 | 0 | 1,
        );
        party.iwc = storeIwc;
      }
      return false;
    }

    party.outLoc = realDest;
    party.iwc = { x: realDest.x > 47 ? 1 : 0, y: realDest.y > 47 ? 1 : 0 };
    party.locInSec = party.globalToLocal(realDest);
    party.age++;
    this.univ.addStringToBuf(`Moved: ${dirStr}`);
    this.moveSound(this.univ.out.at(realDest.x, realDest.y), this.numOutMoves);
    this.numOutMoves++;
    return true;
  }

  /** move_sound (boe.main.cpp:1995), minus the boat/horse/swamp special cases. */
  private moveSound(ter: number, step: number): void {
    if (!this.sound) return;
    switch (this.univ.terrainType(ter).stepSound) {
      case StepSound.SQUISH:
        this.sound.play(Snd.SQUISH);
        break;
      case StepSound.CRUNCH:
        this.sound.play(Snd.CRUNCH);
        break;
      case StepSound.SPLASH:
        this.sound.play(Snd.SPLASH);
        break;
      case StepSound.NONE:
        break;
      case StepSound.STEP:
        this.sound.play(step % 2 === 0 ? Snd.STEP_A : Snd.STEP_B);
        break;
    }
  }

  /**
   * The town-entrance check that follows an outdoor move
   * (boe.actions.cpp:789). Entering is driven by the terrain's special, not
   * by the city_locs list alone — the list only names which town.
   */
  private checkTownEntrance(): void {
    const { party, out } = this.univ;
    const ter = this.univ.terrainType(out.at(party.outLoc.x, party.outLoc.y));
    if (ter.special !== TerSpec.TOWN_ENTRANCE) return;

    // find_direction_from: which of the town's four entrances we arrive at.
    let entryDir: number;
    if (party.direction === Direction.N) entryDir = 2;
    else if (party.direction === Direction.S) entryDir = 0;
    else if (party.direction < Direction.S) entryDir = 3;
    else entryDir = 1;

    for (const city of out.sector.cityLocs) {
      if (city.x !== party.locInSec.x || city.y !== party.locInSec.y) continue;
      if (city.spec >= 0) this.startTownMode(city.spec, entryDir);
      if (this.inTown) return;
    }
  }

  private townIsBlocked(where: Location): boolean {
    const town = this.univ.town!;
    const ter = this.univ.terrainType(town.record.terrain[where.x]![where.y]!);
    return (
      ter.blockage === TerObstruct.BLOCK_MOVE ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT
    );
  }

  /** town_move_party (boe.actions.cpp:4139). */
  private townMoveParty(destination: Location): boolean {
    const { party } = this.univ;
    const town = this.univ.town!;
    const rect = town.record.inTownRect;

    // Stepping onto or past the in-town boundary leaves the town.
    if (
      destination.x <= rect.left ||
      destination.x >= rect.right ||
      destination.y <= rect.top ||
      destination.y >= rect.bottom
    ) {
      this.endTownMode(destination);
      return false;
    }

    if (!town.isOnMap(destination.x, destination.y)) return false;

    // TODO(M5): bumping a hostile monster starts combat instead of moving.
    const blocker = town.monsterAt(destination);
    if (blocker) {
      this.univ.addStringToBuf('Blocked: a creature is in the way.');
      return false;
    }

    party.direction = setDirection(party.townLoc, destination);

    // check_special_terrain for TOWN_MOVE (boe.specials.cpp:152). Only the
    // parts that don't need the specials VM are here; the rest is M4.
    if (!this.checkSpecialTerrain(destination)) return false;

    if (this.townIsBlocked(destination)) {
      this.univ.addStringToBuf(`Blocked: ${DIR_NAMES[party.direction] ?? ''}`);
      return false;
    }

    party.townLoc = destination;
    party.age++;
    this.moveSound(town.record.terrain[destination.x]![destination.y]!, this.numTownMoves++);
    town.makeExplored(destination.x, destination.y);
    this.updateExplored(this.univ.party.townLoc);
    return true;
  }

  // ------------------------------------------------------------------- look

  /**
   * do_look (boe.text.cpp:695) — describe a space into the transcript and
   * return its terrain, or -1 when the party can't see it.
   *
   * TODO(M4/M5): fields, blood/ash/bones decals, boats and horses also get
   * listed here once those exist.
   */
  lookAt(where: Location): number {
    const { univ } = this;
    const town = univ.town;
    const from = this.inTown ? univ.party.townLoc : univ.party.outLoc;
    const isLit = !town || this.ptInLight(from, where);
    const onMap = town ? town.isOnMap(where.x, where.y) : univ.out.isOnMap(where.x, where.y);
    if (!onMap) {
      univ.addStringToBuf('  Can\'t see space.');
      return -1;
    }
    if (this.canSeeLight(from, where) >= SIGHT_BLOCKED) {
      univ.addStringToBuf('  Can\'t see space.');
      return -1;
    }

    univ.addStringToBuf('You see...');
    if (where.x === from.x && where.y === from.y) univ.addStringToBuf('    Your party');

    if (town) {
      for (const monst of town.monsters) {
        if (!monst.isAlive || !isLit || monst.pictureNum === 0) continue;
        if (
          where.x < monst.curLoc.x || where.x >= monst.curLoc.x + monst.xWidth ||
          where.y < monst.curLoc.y || where.y >= monst.curLoc.y + monst.yWidth
        )
          continue;
        const name = univ.scenario.scenMonsters[monst.number]?.name ?? 'creature';
        const wounded = monst.health < monst.maxHealth ? 'Wounded ' : '';
        univ.addStringToBuf(`    ${wounded}${name}${monst.isFriendly ? ' (F)' : ' (H)'}`);
      }
      if (town.isRoad(where.x, where.y)) univ.addStringToBuf('    Track');

      // Items: gold and food are lumped together, and a big pile is summarised.
      let gold = false;
      let food = false;
      let count = 0;
      for (const item of town.items) {
        if (item.variety === ItemType.NO_ITEM) continue;
        if (item.itemLoc.x !== where.x || item.itemLoc.y !== where.y || !isLit) continue;
        if (item.variety === ItemType.GOLD) gold = true;
        else if (item.variety === ItemType.FOOD) food = true;
        else count++;
      }
      if (gold) univ.addStringToBuf('    Gold');
      if (food) univ.addStringToBuf('    Food');
      if (count > 8) univ.addStringToBuf('    Many items');
      else
        for (const item of town.items) {
          if (item.variety === ItemType.NO_ITEM) continue;
          if (item.variety === ItemType.GOLD || item.variety === ItemType.FOOD) continue;
          if (item.itemLoc.x !== where.x || item.itemLoc.y !== where.y || item.contained) continue;
          univ.addStringToBuf(`    ${item.ident ? item.fullName : item.name}`);
        }
      if (town.specialSpots[where.x]?.[where.y]) univ.addStringToBuf('    Special Encounter');
    } else {
      if (univ.out.isRoad(where.x, where.y)) univ.addStringToBuf('    Road');
      if (univ.out.isSpot(where.x, where.y)) univ.addStringToBuf('    Special Encounter');
    }

    if (!isLit) {
      univ.addStringToBuf('    Dark');
      return 0;
    }
    const ter = town ? town.record.terrain[where.x]![where.y]! : univ.out.at(where.x, where.y);
    univ.addStringToBuf(`    ${univ.terrainType(ter).name}`);
    return ter;
  }

  /**
   * The sign text at a space, or null when there is no readable sign there.
   * Signs must be adjacent to read (boe.actions.cpp:706).
   */
  signAt(where: Location): string | null {
    const ter = this.inTown
      ? this.univ.town?.record.terrain[where.x]?.[where.y]
      : this.univ.out.at(where.x, where.y);
    if (ter === undefined) return null;
    if (this.univ.terrainType(ter).special !== TerSpec.IS_A_SIGN) return null;

    const from = this.inTown ? this.univ.party.townLoc : this.univ.party.locInSec;
    const local = this.inTown ? where : this.univ.party.globalToLocal(where);
    const signs = this.inTown
      ? (this.univ.town?.record.signLocs ?? [])
      : this.univ.out.sectorAt(where).signLocs;
    for (const sign of signs) {
      if (sign.x !== local.x || sign.y !== local.y) continue;
      if (Math.max(Math.abs(sign.x - from.x), Math.abs(sign.y - from.y)) > 1) {
        this.univ.addStringToBuf('  Too far away to read sign.');
        return null;
      }
      return sign.text;
    }
    return null;
  }

  // ------------------------------------------------------------------ items

  /**
   * The items a "get" at `place` can reach — get_item (boe.items.cpp:258).
   * Adjacent items are always in reach; anything further (up to 4 spaces, in
   * sight) only if no hostile creature is watching.
   */
  reachableItems(place: Location): Item[] {
    const town = this.univ.town;
    if (!town) return [];
    let massGet = true;
    for (const monst of town.monsters)
      if (
        monst.isAlive &&
        !monst.isFriendly &&
        this.canSeeLight(place, monst.curLoc) < SIGHT_BLOCKED
      )
        massGet = false;

    const found: Item[] = [];
    for (const item of town.items) {
      if (item.variety === ItemType.NO_ITEM || item.contained) continue;
      const adjacent =
        Math.max(Math.abs(place.x - item.itemLoc.x), Math.abs(place.y - item.itemLoc.y)) <= 1;
      const nearby =
        massGet &&
        dist(place, item.itemLoc) <= 4 &&
        this.canSeeLight(place, item.itemLoc) < SIGHT_BLOCKED;
      if (!adjacent && !nearby) continue;
      // Worthless items identify themselves when you pick them up.
      if (item.value < 2) item.ident = true;
      found.push(item);
    }
    return found;
  }

  /**
   * Give a floor item to a PC and remove it from the town. Returns what should
   * be printed; an empty string means nothing happened.
   */
  takeItem(item: Item, pcNum: number): string {
    const town = this.univ.town;
    if (!town) return '';
    const pc = this.univ.party.pcs[pcNum];
    if (!pc) return '';
    const result = giveItem(pc, this.univ.party, item);
    if (result.status !== GiveStatus.OK) {
      this.univ.addStringToBuf(`  ${result.message}`);
      return result.message;
    }
    const index = town.items.indexOf(item);
    if (index >= 0) town.items.splice(index, 1);
    // Remember that a preset item has been taken, so it doesn't come back.
    if (item.isSpecial > 0) town.record.itemTaken[item.isSpecial - 1] = true;
    this.univ.addStringToBuf(result.message);
    return result.message;
  }

  /** Drop a carried item onto the party's space. */
  dropItem(pcNum: number, slot: number): boolean {
    const town = this.univ.town;
    const pc = this.univ.party.pcs[pcNum];
    if (!town || !pc) return false;
    const item = takeItemFrom(pc, slot);
    if (!item) {
      this.univ.addStringToBuf('  Item is cursed.');
      return false;
    }
    town.items.push({ ...item, itemLoc: { ...this.univ.party.townLoc }, isSpecial: 0 });
    this.univ.addStringToBuf(`  ${pc.name} drops ${item.ident ? item.fullName : item.name}.`);
    return true;
  }

  /** Hand a carried item to another party member. */
  giveItemTo(fromPc: number, slot: number, toPc: number): boolean {
    const from = this.univ.party.pcs[fromPc];
    const to = this.univ.party.pcs[toPc];
    if (!from || !to) return false;
    const item = from.items[slot];
    if (!item || item.variety === ItemType.NO_ITEM) return false;
    // Check it will fit before taking it away, so a refusal loses nothing.
    const check = giveItem(to, this.univ.party, item);
    if (check.status !== GiveStatus.OK) {
      this.univ.addStringToBuf(`  ${check.message}`);
      return false;
    }
    if (!takeItemFrom(from, slot)) {
      // The receiver already has a copy, so undo it.
      if (check.slot >= 0) to.items[check.slot] = defaultItem();
      this.univ.addStringToBuf('  Item is cursed.');
      return false;
    }
    this.univ.addStringToBuf(check.message);
    return true;
  }

  /** Toggle whether a carried item is equipped. */
  toggleEquip(pcNum: number, slot: number): void {
    const pc = this.univ.party.pcs[pcNum];
    if (!pc) return;
    const item = pc.items[slot];
    if (!item || item.variety === ItemType.NO_ITEM) return;
    const result = pc.equip[slot] ? unequipItem(pc, slot) : equipItem(pc, slot);
    this.univ.addStringToBuf(result.message);
  }

  // ------------------------------------------------------- special terrain

  /**
   * The subset of check_special_terrain (boe.specials.cpp:152) that town
   * movement needs and that doesn't require the specials VM. Returns false
   * when the move is cancelled.
   *
   * TODO(M4): step-on specials, conveyors, force barriers, webs, pushable
   * crates/barrels/blocks, and the CALL_SPECIAL terrain type.
   */
  private checkSpecialTerrain(where: Location): boolean {
    const town = this.univ.town;
    if (!town) return true;
    const ter = town.record.terrain[where.x]![where.y]!;
    const spec = this.univ.terrainType(ter);

    switch (spec.special) {
      case TerSpec.CHANGE_WHEN_STEP_ON: {
        // An unlocked door: walking into it swaps the terrain for flag1, and
        // if the old terrain blocked movement the party doesn't enter yet.
        town.record.terrain[where.x]![where.y] = spec.flag1;
        if (spec.flag2 >= 0) this.sound?.play(spec.flag2);
        return !blocksMove(spec);
      }
      case TerSpec.UNLOCKABLE:
        // A locked door: the caller has to ask the player what to do, which
        // needs a dialog, so it defers to the host via onLockedDoor.
        this.onLockedDoor?.(where, ter);
        return false;
      case TerSpec.DAMAGING:
      case TerSpec.DANGEROUS:
        // TODO(M5): terrain damage needs damage_pc and the status system.
        this.univ.addStringToBuf('  It looks dangerous.');
        return true;
      default:
        return true;
    }
  }

  /**
   * Set by the host: called when the party walks into a locked door, so the UI
   * can raise the pick/bash prompt. Without a handler the door simply blocks.
   */
  onLockedDoor: ((where: Location, terrain: number) => void) | null = null;

  /**
   * select_pc's candidate list (boe.items.cpp:878). `mode` mirrors the eSelectPC
   * values this port needs so far; `highlight` names a skill to show beside each
   * PC, the way the original does for "who will bash?".
   */
  selectPcOptions(mode: 'living' | 'lockpick', highlight?: Skill): PcChoice[] {
    return this.univ.party.pcs.map((pc, index) => {
      let canPick = pc.isAlive;
      let extra = '';
      if (mode === 'lockpick' && canPick) {
        const equipped = hasAbilEquip(pc, ItemAbil.LOCKPICKS);
        const carried = pc.items.some(
          (item) => item.variety !== ItemType.NO_ITEM && item.ability === ItemAbil.LOCKPICKS,
        );
        if (!carried) {
          canPick = false;
          extra = 'no picks';
        } else if (!equipped) {
          canPick = false;
          extra = 'picks not equipped';
        } else {
          const picks = equipped.item;
          extra = `${picks.ident ? picks.fullName : picks.name} x${picks.charges}`;
        }
      }
      let label = pc.name;
      if (highlight !== undefined) label += ` (${pc.skills[highlight] ?? 0})`;
      if (extra) label += `: ${extra}`;
      return { index, label, canPick };
    });
  }

  /** Try to pick a locked door's lock with a given PC. */
  pickLock(where: Location, pcNum: number): void {
    pickLockAt(this.univ, where, pcNum, this.sound);
  }

  /** Try to bash a locked door open with a given PC. */
  bashDoor(where: Location, pcNum: number): void {
    bashDoorAt(this.univ, where, pcNum, this.sound);
  }

  // ------------------------------------------------------------------- talk

  /**
   * The TALK action (boe.actions.cpp:826): pick an adjacent creature and open
   * a conversation with it. Returns false when there's nobody to talk to.
   */
  talkTo(destination: Location): boolean {
    const town = this.univ.town;
    if (!town) return false;
    const monst = town.monsterAt(destination);
    if (!monst) {
      this.univ.addStringToBuf('  Nobody there');
      return false;
    }
    // TODO(M4): specialOnTalk fires a HAIL special before the conversation.
    if (!monst.isFriendly) {
      this.univ.addStringToBuf('  Creature is hostile.');
      return false;
    }
    if (monst.personality < 0 || !monst.isAlive) {
      this.univ.addStringToBuf('Talk: No response.');
      return false;
    }
    // A creature's own face overrides its monster template's default one.
    const template = this.univ.scenario.scenMonsters[monst.number];
    const face = monst.facialPic >= 0 ? monst.facialPic : (template?.defaultFacialPic ?? -1);
    this.startTalkMode(town.monsters.indexOf(monst), monst.personality, monst.number, face);
    return true;
  }

  /** start_talk_mode (boe.dlgutil.cpp:709). */
  startTalkMode(
    monsterIndex: number,
    personality: number,
    monsterType: number,
    facePic: number,
  ): void {
    this.preTalkMode = this.mode;
    this.mode = GameMode.TALKING;
    this.talk = new TalkState(this.univ, monsterIndex, personality, monsterType, facePic);
    this.talk.onShop = (shopNum, costAdj, name) =>
      this.startShopMode(shopNum, costAdj, name) || this.startShopModeAnyPc(shopNum, costAdj, name);
    this.talk.onItemShop = (mode, a, b, c) => this.startItemShop(mode, a, b, c);
  }

  /** end_talk_mode (boe.dlgutil.cpp:752). */
  endTalkMode(): void {
    this.mode = this.preTalkMode === GameMode.TALK_TOWN ? GameMode.TOWN : this.preTalkMode;
    this.talk = null;
    // The panel drops back to plain inventory when the shopkeeper is done.
    this.itemShop = null;
    if (this.mode === GameMode.TOWN) {
      this.center = { ...this.univ.party.townLoc };
      this.updateExplored(this.center);
    }
  }

  // ------------------------------------------------------------------ shops

  /**
   * start_shop_mode (boe.dlgutil.cpp:160). Returns false when the shop has
   * nothing the current PC can use, which is how the caller knows to try
   * another PC or print "There is nothing available to buy."
   */
  startShopMode(which: number, costAdj: number, storeName: string): boolean {
    const scenShop = this.univ.scenario.shops[which];
    if (!scenShop) {
      this.univ.addStringToBuf('The scenario tried to place you in a nonexistent shop!');
      return false;
    }
    const shop = scenShop.clone();
    shop.costAdj = costAdj;
    shop.name = storeName;

    // Apply whatever the party has already bought out of this shop's stock.
    const sold = this.univ.party.storeLimitedStock.get(which);
    if (sold) {
      for (const [slot, left] of sold) {
        if (slot < 0 || slot >= shop.size) continue;
        const entry = shop.getItem(slot);
        if (entry.quantity === 0) continue; // infinite stock; nothing to track
        if (left === 0) entry.type = ShopItemType.EMPTY;
        else if (entry.type === ShopItemType.OPT_ITEM)
          entry.quantity = left + Math.trunc(entry.quantity / 1000) * 1000;
        else entry.quantity = left;
        shop.replaceItem(slot, entry);
      }
    }

    const state = new ShopState(this.univ, which, shop);
    if (state.visible.length === 0) return false;

    this.preShopMode = this.mode;
    this.mode = GameMode.SHOPPING;
    this.shop = state;
    return true;
  }

  /**
   * start_shop_mode_other_pc (boe.dlgutil.cpp:132) — a healer with nothing for
   * the active PC may still have something for someone else, so try each in
   * turn and leave the first who can buy as the active PC.
   */
  startShopModeAnyPc(which: number, costAdj: number, storeName: string): boolean {
    const wasPc = this.univ.curPc;
    for (let i = 0; i < this.univ.party.pcs.length; i++) {
      if (this.univ.party.pcs[i]!.mainStatus === MainStatus.ABSENT) continue;
      this.univ.curPc = i;
      if (this.startShopMode(which, costAdj, storeName)) return true;
    }
    this.univ.curPc = wasPc;
    return false;
  }

  /** end_shop_mode (boe.dlgutil.cpp:227). */
  endShopMode(): void {
    this.shop = null;
    this.mode = this.preShopMode === GameMode.TALK_TOWN ? GameMode.TOWN : this.preShopMode;
    if (this.mode === GameMode.TALKING && this.talk) {
      // Back to the conversation, which reports the visit is over.
      this.talk.concludeBusiness();
    } else if (this.mode === GameMode.TOWN) {
      this.center = { ...this.univ.party.townLoc };
      this.updateExplored(this.center);
    }
  }

  /** Buy the entry on a given screen row. */
  buyShopRow(row: number): void {
    const state = this.shop;
    const target = state?.rowEntry(row);
    if (!state || !target) return;
    handleSale(this.univ, state, target.index, this.sound);
    this.recordShopStock(state);
    // A healer whose list just emptied moves on to the next PC who needs help.
    if (state.visible.length === 0) {
      const { shopNum, costAdj, name } = state;
      this.endShopMode();
      if (shopNum >= 0) this.startShopModeAnyPc(shopNum, costAdj, name);
    }
  }

  /**
   * end_shop_mode's bookkeeping (boe.dlgutil.cpp:270) — remember how much of
   * each limited-stock entry is left so the shop stays picked-over.
   */
  private recordShopStock(state: ShopState): void {
    if (state.shopNum < 0) return;
    const scenShop = this.univ.scenario.shops[state.shopNum];
    if (!scenShop) return;
    let left = this.univ.party.storeLimitedStock.get(state.shopNum);
    for (let i = 0; i < state.shop.size; i++) {
      const original = scenShop.getItem(i);
      if (original.quantity === 0) continue; // infinite stock
      const entry = state.shop.getItem(i);
      const remaining = entry.type === ShopItemType.EMPTY ? 0 : entry.quantity % 1000;
      if (!left) {
        left = new Map();
        this.univ.party.storeLimitedStock.set(state.shopNum, left);
      }
      left.set(i, remaining);
    }
  }

  // ------------------------------------------------- shop services on our own
  //                                                    goods

  /**
   * Put the inventory panel into one of the four service modes. The panel stays
   * in that mode until the conversation ends, which is how the C++ leaves the
   * sell buttons up while you work through a pack.
   */
  startItemShop(
    mode: ItemShopMode, cost = 0, rechargeLimit = 0, rechargeAmount = 0,
  ): void {
    this.itemShop = { mode, cost, rechargeLimit, rechargeAmount };
  }

  endItemShop(): void {
    this.itemShop = null;
  }

  /** Act on one item's spec button. */
  useItemShop(pcNum: number, slot: number): void {
    if (!this.itemShop) return;
    handleItemShopAction(this.univ, this.itemShop, pcNum, slot, this.sound);
  }

  /** Route a conversation choice; closes the conversation when it's done. */
  chooseTalkNode(node: number): void {
    if (!this.talk) return;
    const before = this.talk.str1;
    if (this.talk.handleNode(node) === 'done') {
      this.endTalkMode();
      return;
    }
    this.sound?.play(Snd.BUTTON);
    if (this.talk.lastUnsupported !== null)
      this.univ.addStringToBuf(
        `(${TalkNodeType[this.talk.lastUnsupported]} conversation nodes are not implemented yet)`,
      );
    if (this.talk.str1 === before && node === TalkAction.RECORD) return;
  }

  // ------------------------------------------------------------ transitions

  /**
   * start_town_mode (boe.town.cpp:77). Populates the town from its presets;
   * saved populations, field placement, and entry specials come later.
   *
   * `entryDir` indexes start_locs; 9 means "use the forced location", which
   * for now resolves to the first usable start location.
   */
  startTownMode(townNum: number, entryDir: number): void {
    const record = this.univ.scenario.towns[townNum];
    if (!record) {
      this.univ.addStringToBuf('The scenario tried to put you into a town that does not exist.');
      return;
    }

    // TODO(M4): town_mods can redirect townNum via an SDF before we load.
    this.mode = GameMode.TOWN;
    this.univ.party.townNum = townNum;
    this.sound?.play(
      record.lightingType === Lighting.LIGHT_NORMAL ? Snd.ENTER_TOWN : Snd.ENTER_DUNGEON,
    );
    const town = new CurTown(record);
    this.univ.town = town;

    // Doors the party unlocked on a previous visit stay unlocked.
    for (const where of record.doorUnlocked) {
      const ter = record.terrain[where.x]?.[where.y];
      if (ter === undefined) continue;
      const spec = this.univ.terrainType(ter);
      if (spec.special === TerSpec.UNLOCKABLE) record.terrain[where.x]![where.y] = spec.flag1;
    }

    // Restore whatever the party has already mapped of this town.
    for (let x = 0; x < record.maxDim; x++)
      for (let y = 0; y < record.maxDim; y++)
        if (record.maps[x]![y]!) town.makeExplored(x, y);

    this.setUpLights(town);
    this.populateTown(town);
    this.placePresetItems(town);

    // TODO(M4): handle_town_specials queues the on-entry special here.
    const start =
      entryDir < 4 ? record.startLocs[entryDir]! : { x: -1, y: -1 };
    let where = start;
    if (where.x < 0)
      where =
        record.startLocs.find((l) => l.x >= 0) ??
        loc(Math.floor(record.maxDim / 2), Math.floor(record.maxDim / 2));
    this.univ.party.townLoc = { ...where };
    this.center = { ...where };
    town.makeExplored(where.x, where.y);
    this.updateExplored(this.univ.party.townLoc);
    this.univ.addStringToBuf(`You enter ${record.name}.`);
  }

  /**
   * cTown::set_up_lights (town.cpp:195): terrain with a light radius lights
   * the tiles around it permanently.
   *
   * TODO(M4): the original also requires line of sight (`can_see`), so light
   * does not currently stop at walls.
   */
  private setUpLights(town: CurTown): void {
    const dim = town.record.maxDim;
    for (const row of town.lighting) row.fill(0);
    for (let i = 0; i < dim; i++)
      for (let j = 0; j < dim; j++) {
        const rad = this.univ.terrainType(town.record.terrain[i]![j]!).lightRadius;
        if (rad <= 0) continue;
        for (let x = Math.max(0, i - rad); x < Math.min(dim, i + rad + 1); x++)
          for (let y = Math.max(0, j - rad); y < Math.min(dim, j + rad + 1); y++)
            if (dist(loc(i, j), loc(x, y)) <= rad) town.lighting[x]![y] = 1;
      }
  }

  /** light_radius (boe.locutils.cpp:458). */
  lightRadius(): number {
    const town = this.univ.town;
    if (!town || town.record.lightingType === Lighting.LIGHT_NORMAL) return 200;
    const extraLevels = [10, 20, 50, 75, 110, 140];
    let store = 1;
    for (const level of extraLevels) if (this.univ.party.lightLevel > level) store++;
    return store;
  }

  /** coord_to_ter (boe.locutils.cpp:209) — terrain at a point in either mode. */
  private coordToTer(x: number, y: number): number {
    const town = this.univ.town;
    if (town) return town.isOnMap(x, y) ? town.record.terrain[x]![y]! : 0;
    return this.univ.out.isOnMap(x, y) ? this.univ.out.at(x, y) : 0;
  }

  /** get_blockage (boe.locutils.cpp:441) — how much a tile obstructs sight. */
  private getBlockage(ter: number): number {
    const blockage = this.univ.terrainType(ter).blockage;
    if (
      blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT ||
      blockage === TerObstruct.BLOCK_SIGHT
    )
      return SIGHT_BLOCKED;
    if (blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT) return 1;
    return 0;
  }

  /**
   * sight_obscurity (boe.locutils.cpp:179).
   * TODO(M4): webs, barriers and crates add obscurity once fields exist.
   */
  private sightObscurity = (x: number, y: number): number => {
    let store = this.getBlockage(this.coordToTer(x, y));
    const town = this.univ.town;
    if (town && town.specialSpots[x]?.[y]) store++;
    return store;
  };

  /** can_see_light (boe.locutils.cpp:173). */
  canSeeLight(from: Location, to: Location): number {
    if (this.inTown && !this.ptInLight(from, to)) return SIGHT_BLOCKED + 1;
    return canSee(from, to, this.sightObscurity);
  }

  /** pt_in_light (boe.locutils.cpp:471). */
  ptInLight(from: Location, to: Location): boolean {
    const town = this.univ.town;
    if (!town || town.record.lightingType === Lighting.LIGHT_NORMAL) return true;
    if (!town.isOnMap(to.x, to.y)) return true;
    if (town.isLit(to.x, to.y)) return true;
    return dist(from, to) <= this.lightRadius();
  }

  /** The creature-loading half of start_town_mode (boe.town.cpp:250-310). */
  private populateTown(town: CurTown): void {
    const { party, scenario } = this.univ;
    const day = party.calcDay();
    town.monsters = [];
    for (let i = 0; i < town.record.creatures.length; i++) {
      const preset = town.record.creatures[i]!;
      if (preset.number <= 0) continue;
      const template = scenario.scenMonsters[preset.number];
      if (!template) continue;
      const monst = assignCreature(i, preset, template);

      // A creature gated behind an unset special encounter starts inactive.
      if (monst.specEncCode > 0) monst.active = CreatureStatus.DEAD;

      switch (monst.timeFlag) {
        case MonstTime.ALWAYS:
          break;
        case MonstTime.APPEAR_ON_DAY:
          if (!dayReached(day, monst.monsterTime)) monst.active = CreatureStatus.DEAD;
          break;
        case MonstTime.DISAPPEAR_ON_DAY:
          if (dayReached(day, monst.monsterTime)) monst.active = CreatureStatus.DEAD;
          break;
        case MonstTime.SOMETIMES_A:
        case MonstTime.SOMETIMES_B:
        case MonstTime.SOMETIMES_C:
          monst.active =
            (day % 3) + 3 !== Number(monst.timeFlag) ? CreatureStatus.DEAD : CreatureStatus.IDLE;
          break;
        default:
          // TODO(M4): event-driven and post-chop arrivals need key_times and
          // the town's cleaned-out state, which arrive with the specials VM.
          monst.active = CreatureStatus.DEAD;
          break;
      }

      // A set SDF suppresses the creature entirely.
      if (party.sdLegit(monst.spec1, monst.spec2) && party.getSdf(monst.spec1, monst.spec2) > 0)
        monst.active = CreatureStatus.DEAD;

      town.monsters.push(monst);
    }

    // Large monsters placed somewhere they can't fit get dropped.
    for (const m of town.monsters)
      if (m.isAlive && (m.xWidth > 1 || m.yWidth > 1) && !this.monstCanBeThere(m))
        m.active = CreatureStatus.DEAD;
  }

  /**
   * The preset-item half of start_town_mode (boe.town.cpp:370). Items the
   * party has already taken stay gone unless the preset says "always there".
   *
   * TODO(M6): special and quest items also check the party's spec_items and
   * active_quests, and store_item_rects restores player-dropped stock.
   */
  private placePresetItems(town: CurTown): void {
    town.items = [];
    const presets = town.record.presetItems;
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i]!;
      if (preset.code < 0) continue;
      const template = this.univ.scenario.scenItems[preset.code];
      if (!template) continue;
      if (town.record.itemTaken[i] && !preset.alwaysThere) continue;

      const item: Item = { ...template, itemLoc: { ...preset.loc } };
      if (preset.ability >= 0) item.ability = preset.ability;
      if (preset.charges > 0) {
        if (item.charges > 0) item.charges = preset.charges;
        else if (item.variety === ItemType.GOLD || item.variety === ItemType.FOOD)
          item.itemLevel = preset.charges;
      }
      item.property = preset.property;
      item.contained = preset.contained;
      // An item marked "contained" is hidden inside a crate or barrel; without
      // fields we can't tell, so it just stays undrawn.
      item.held = item.contained;
      item.isSpecial = i + 1;
      town.items.push(item);
    }
  }

  private monstCanBeThere(m: Creature): boolean {
    const town = this.univ.town!;
    for (let i = 0; i < m.xWidth; i++)
      for (let j = 0; j < m.yWidth; j++) {
        const x = m.curLoc.x + i;
        const y = m.curLoc.y + j;
        if (!town.isOnMap(x, y)) return false;
        if (this.townIsBlocked(loc(x, y))) return false;
      }
    return true;
  }

  /**
   * end_town_mode (boe.town.cpp:536). Which boundary the party crossed picks
   * the outdoor exit; a town with no explicit exit for that side just steps
   * the party one tile further out.
   */
  endTownMode(destination: Location): void {
    const { party } = this.univ;
    const town = this.univ.town!;
    const rect = town.record.inTownRect;
    let toReturn = { ...party.outLoc };

    // exits[] is indexed N, W, S, E (from the "nwse" dirs string).
    const applyExit = (idx: number, fallback: Location, nudge: Location): void => {
      const exit = town.record.exits[idx]!;
      toReturn = exit.x > 0 ? party.localToGlobal(exit) : fallback;
      party.outLoc = { x: toReturn.x + nudge.x, y: toReturn.y + nudge.y };
      // TODO(M4): handle_leave_town_specials fires exit.spec here.
    };

    if (destination.x <= rect.left)
      applyExit(1, loc(toReturn.x - 1, toReturn.y), loc(1, 0));
    else if (destination.x >= rect.right)
      applyExit(3, loc(toReturn.x + 1, toReturn.y), loc(-1, 0));
    else if (destination.y <= rect.top)
      applyExit(0, loc(toReturn.x, toReturn.y - 1), loc(0, 1));
    else if (destination.y >= rect.bottom)
      applyExit(2, loc(toReturn.x, toReturn.y + 1), loc(0, -1));

    // Persist what the party mapped, so re-entering keeps it.
    for (let x = 0; x < town.record.maxDim; x++)
      for (let y = 0; y < town.record.maxDim; y++)
        if (town.isExplored(x, y)) town.record.maps[x]![y] = 1;

    this.mode = GameMode.OUTDOORS;
    this.univ.addStringToBuf(`You leave ${town.record.name}.`);
    this.univ.town = null;
    party.townNum = TOWN_NUM_OUTDOORS;
    party.outLoc = clampToWindow(toReturn);
    party.iwc = { x: party.outLoc.x > 47 ? 1 : 0, y: party.outLoc.y > 47 ? 1 : 0 };
    party.locInSec = party.globalToLocal(party.outLoc);
    this.center = { ...party.outLoc };
    this.updateExplored(party.outLoc);
  }

  // ------------------------------------------------------------------ maps

  /**
   * update_explored (boe.locutils.cpp:230) — reveal what the party can see
   * from `where`: the 9x9 block around it, minus anything sight-blocked.
   */
  private updateExplored(where: Location): void {
    const { out } = this.univ;
    const town = this.univ.town;
    if (town) {
      town.makeExplored(where.x, where.y);
      for (let x = Math.max(0, where.x - 4); x < Math.min(town.record.maxDim, where.x + 5); x++)
        for (let y = Math.max(0, where.y - 4); y < Math.min(town.record.maxDim, where.y + 5); y++)
          if (
            !town.isExplored(x, y) &&
            this.canSeeLight(where, loc(x, y)) < SIGHT_BLOCKED &&
            this.ptInLight(where, loc(x, y))
          )
            town.makeExplored(x, y);
      return;
    }
    // Outdoors, 2 marks "stood on" and 1 "seen from a distance".
    out.explored[where.x]![where.y] = 2;
    for (let x = where.x - 4; x < where.x + 5; x++)
      for (let y = where.y - 4; y < where.y + 5; y++)
        if (out.isOnMap(x, y) && out.explored[x]![y] === 0)
          if (this.canSeeLight(where, loc(x, y)) < SIGHT_BLOCKED) out.explored[x]![y] = 1;
  }
}

/** day_reached (boe.specials.cpp) without the event-key half. */
function dayReached(currentDay: number, day: number): boolean {
  return day >= 0 && currentDay >= day;
}

function clampToWindow(where: Location): Location {
  return loc(
    Math.max(0, Math.min(OUT_MAX_DIM - 1, where.x)),
    Math.max(0, Math.min(OUT_MAX_DIM - 1, where.y)),
  );
}

export { OUT_HALF_DIM, SECTOR_SIZE };
