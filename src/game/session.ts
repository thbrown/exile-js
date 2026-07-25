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
import { MonstTime } from '../data/monster';
import { SECTOR_SIZE } from '../data/outdoors';
import { TerObstruct, TerSpec } from '../data/terrain';
import { Creature, CreatureStatus, assignCreature } from '../universe/creature';
import { CurTown } from '../universe/curTown';
import { OUT_HALF_DIM, OUT_MAX_DIM } from '../universe/curOut';
import { TOWN_NUM_OUTDOORS } from '../universe/party';
import { Universe } from '../universe/universe';
import { GameMode, isOut, isTown } from './modes';

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

export class GameSession {
  mode: GameMode = GameMode.OUTDOORS;
  /** The tile the view is centered on; equals the party position in town. */
  center: Location = loc(0, 0);
  private numOutMoves = 0;

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

  get isOutdoors(): boolean {
    return isOut(this.mode);
  }

  get inTown(): boolean {
    return isTown(this.mode);
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
    this.numOutMoves++;
    return true;
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

    // TODO(M4): check_special_terrain for TOWN_MOVE.
    // TODO(M5): bumping a hostile monster starts combat instead of moving.
    const blocker = town.monsterAt(destination);
    if (blocker) {
      this.univ.addStringToBuf('Blocked: a creature is in the way.');
      return false;
    }

    party.direction = setDirection(party.townLoc, destination);
    if (this.townIsBlocked(destination)) {
      this.univ.addStringToBuf(`Blocked: ${DIR_NAMES[party.direction] ?? ''}`);
      return false;
    }

    party.townLoc = destination;
    party.age++;
    town.makeExplored(destination.x, destination.y);
    this.markTownSeen();
    return true;
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
    const town = new CurTown(record);
    this.univ.town = town;

    // Restore whatever the party has already mapped of this town.
    for (let x = 0; x < record.maxDim; x++)
      for (let y = 0; y < record.maxDim; y++)
        if (record.maps[x]![y]!) town.makeExplored(x, y);

    this.populateTown(town);

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
    this.markTownSeen();
    this.univ.addStringToBuf(`You enter ${record.name}.`);
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

  /** update_explored: reveal the outdoor tiles around the party. */
  private updateExplored(where: Location): void {
    const { out } = this.univ;
    for (let i = -4; i <= 4; i++)
      for (let j = -4; j <= 4; j++) {
        const x = where.x + i;
        const y = where.y + j;
        if (out.isOnMap(x, y)) out.explored[x]![y] = 1;
      }
  }

  /** Reveal the town tiles the party can see from where it stands. */
  private markTownSeen(): void {
    const town = this.univ.town;
    if (!town) return;
    const p = this.univ.party.townLoc;
    // TODO(M4): real line-of-sight and lighting; for now reveal a radius.
    for (let i = -5; i <= 5; i++)
      for (let j = -5; j <= 5; j++) {
        const x = p.x + i;
        const y = p.y + j;
        if (town.isOnMap(x, y) && dist(p, loc(x, y)) <= 5) town.makeExplored(x, y);
      }
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
