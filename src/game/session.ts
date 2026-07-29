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

import { QuestStatus } from '../data/quest';
import { Direction, Location, dist, loc, locsEqual, shiftLoc } from '../core/location';
import { SIGHT_BLOCKED, canSee } from '../core/sight';
import { Item, ItemAbil, ItemType, defaultItem } from '../data/item';
import { MonstTime } from '../data/monster';
import { FieldType } from '../data/fields';
import { SECTOR_SIZE } from '../data/outdoors';
import { StepSound, Terrain, TerObstruct, TerSpec, TrimType, blocksMove } from '../data/terrain';
import { TalkNodeType } from '../data/talking';
import { Lighting, Town } from '../data/town';
import { OutWandering } from '../data/outdoors';
import { Vehicle } from '../data/vehicle';
import { Snd, SoundPlayer } from '../platform/sound';
import { Creature, CreatureStatus, assignCreature } from '../universe/creature';
import { DamageType } from '../data/monster';
import { animSettle } from './anim';
import { damagePc, hitParty } from './damage';
import {
  NO_ONE, endTownCombat, pcAttack, pickNextPc, setPcMoves, startTownCombat, takeAp,
} from './combat';
import { combatRunMonst, doMonsterTurn, doMonsters } from './monsterTurn';
import {
  adjacentEncounter, countWalls, createWandMonst, doOutdoorMonsters, outEncLevTot,
} from './wandering';
import { startOutdoorCombat } from './outCombat';
import { increaseAgeEffects } from './increaseAge';
import { processFields, syncForceCages } from './processFields';
import type { TownTarget } from './spellTarget';
import type { SpellTarget } from './spellCombatTarget';
import { LoadedMissile, fireMissile, isLoaded, loadMissile } from './missiles';
import { CurTown } from '../universe/curTown';
import {
  GiveStatus,
  equipItem,
  giveItem,
  hasAbilEquip,
  takeItemFrom,
  unequipItem,
} from '../universe/inventory';
import { MainStatus, PartyStatus, Race, Skill, Status } from '../universe/skills';
import { boomSpace } from './booms';
import { ShopItemType } from '../data/shop';
import { ShopState, handleSale } from './shop';
import { ItemShopMode, ItemShopState, handleItemShopAction } from './itemShop';
import { doRest, handleRest } from './rest';
import { makeTownHostile } from './townAttitude';
import { OUT_HALF_DIM, OUT_MAX_DIM } from '../universe/curOut';
import { TOWN_NUM_OUTDOORS } from '../universe/party';
import { Universe } from '../universe/universe';
import { GameMode, PreModes, isCombat, isOut, isTown } from './modes';
import { bashDoor as bashDoorAt, pickLock as pickLockAt } from './doors';
import { TalkAction, TalkState } from './talk';
import { SpecType } from '../data/special';
import { SpecCtx, SpecCtxType, SpecialHost } from './specials/context';
import { SpecialsEngine } from './specials/vm';
import { specialIncreaseAge } from './specialIncreaseAge';
import { alterSpace } from './specials/general';

/** d_string (boe.combat.cpp:70) — the direction names the transcript prints. */
const DIRECTION_NAMES = [
  'North', 'NorthEast', 'East', 'SouthEast', 'South', 'SouthWest', 'West', 'NorthWest',
];

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
 * The four conveyor-belt refusal sets (boe.specials.cpp:145): a belt running
 * north can't be walked into from the north, and the two diagonals that
 * include north count as north too.
 */
const NO_MOVE_FROM_NORTH = new Set([Direction.N, Direction.NW, Direction.NE]);
const NO_MOVE_FROM_WEST = new Set([Direction.W, Direction.NW, Direction.SW]);
const NO_MOVE_FROM_SOUTH = new Set([Direction.S, Direction.SW, Direction.SE]);
const NO_MOVE_FROM_EAST = new Set([Direction.E, Direction.NE, Direction.SE]);

/**
 * entry_dir 9 in start_town_mode means "ignore start_locs, use town_force_loc".
 * Until the specials VM can set a forced location, this resolves to the town's
 * first usable start location.
 */
export const FORCED_ENTRY = 9;

/**
 * point_onscreen (boe.locutils.cpp:88) — the terrain view is 9x9, so anything
 * within four squares of its centre is on screen. This is game logic in the
 * original too, which is why the constant lives here and not in `render/`.
 */
export function pointOnScreen(center: Location, check: Location): boolean {
  return Math.abs(center.x - check.x) <= 4 && Math.abs(center.y - check.y) <= 4;
}

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
  /**
   * Whose turn it was before combat started, so leaving combat hands control
   * back to the same PC (store_current_pc in boe.combat.cpp).
   */
  storeCurrentPc = 0;
  /** which_combat_type: 1 for a fight in a town, 0 for an outdoor arena. */
  whichCombatType = 0;
  /**
   * combat_active_pc — the PC in the middle of a multi-step action (firing,
   * casting). 6 means nobody, and then everyone acts in turn as normal.
   */
  combatActivePc = NO_ONE;
  /**
   * `store_spell_target` — the party member the casting dialog aimed the spell
   * at, for the spells whose `select` says they need one. 6 is "nobody
   * chosen", which is what the C++ leaves it at and what makes those arms do
   * nothing at all.
   */
  spellTarget = 6;

  /**
   * The spell waiting for a square while the game is in SPELL_TARGET mode
   * (`start_spell_targeting`); null the rest of the time.
   */
  spellTargeting: SpellTarget | null = null;

  /**
   * The spell waiting for a square while the game is in TOWN_TARGET mode
   * (`start_town_targeting`); null the rest of the time.
   */
  townTarget: TownTarget | null = null;

  /** The armed missile while the game is in FIRING or THROWING mode. */
  missile: LoadedMissile | null = null;
  /**
   * `store_sum_monst` / `store_sum_monst_cost` — the soul-crystal slot
   * Simulacrum is about to summon and what it costs (the monster's own level,
   * not the spell's, which is -1 in the table). Chosen before targeting starts
   * and read when the spell resolves, exactly as the C++'s globals are.
   */
  sumMonst = 0;
  sumMonstCost = 0;
  /**
   * Set by the host: `soul-crystal.xml`, the picker Simulacrum opens. Returns
   * the monster number chosen, or 0 for cancel (which is also what no handler
   * means, so the spell simply doesn't go off).
   */
  onPickTrappedMonst: (() => Promise<number>) | null = null;
  /**
   * The throwaway 48×48 town an outdoor fight happens in (`cCurTown::arena`).
   * The party's `townNum` stays 200 the whole time — it is not *in* a town —
   * but `univ.town` points at this so terrain, sight and blocking all work.
   */
  arena: Town | null = null;
  /** The encounter being fought, for its on-win and on-flee specials. */
  storeWanderingSpecial: OutWandering | null = null;
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
    // put_party_in_scen runs the scenario's on-init node last (boe.party.cpp:238).
    void this.runSpecial(
      SpecCtx.STARTUP, SpecCtxType.SCEN, this.univ.scenario.initSpec, loc(0, 0));
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

  /**
   * Whether the world *around* the party is a town, rather than whether the
   * game mode is a town mode: `inTown` is false during combat, because
   * `MODE_COMBAT` sits outside `is_town`'s range, but the walls and the
   * darkness are still there. Anything to do with seeing and lighting has to
   * ask this, which is what the C++'s `univ.party.town_num != 200` does.
   */
  private get worldIsTown(): boolean {
    return this.univ.isInTown();
  }

  /** get_location (boe.text.cpp:1248) — the left half of the status bar. */
  locationName(): string {
    if (isCombat(this.mode)) {
      // The original puts the acting PC and their remaining moves in the text
      // bar during combat (draw_text_bar's combat half).
      const pc = this.univ.currentPc;
      return `${pc.name}: ${pc.ap} move${pc.ap === 1 ? '' : 's'} left`;
    }
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

  /**
   * The entry point the input layer calls for a directional keypress.
   *
   * Movement is async because a square can carry a special that puts a dialog
   * on screen before deciding whether the step goes through — the C++ blocks
   * inside check_special_terrain, and we await instead.
   */
  async move(dir: Direction): Promise<boolean> {
    const from = this.inTown ? this.univ.party.townLoc : this.univ.party.outLoc;
    const destination = shiftLoc(from, dir);
    return this.moveTo(destination);
  }

  /**
   * Where an outdoor move should head after leaving a town — end_town_mode's
   * return value, which handle_action assigns straight over `destination`
   * (boe.actions.cpp:770).
   */
  private pendingOutDest: Location | null = null;

  /** handle_action's movement branch (boe.actions.cpp:740-815). */
  async moveTo(destination: Location): Promise<boolean> {
    let moved = false;
    this.pendingOutDest = null;
    if (this.inTown) {
      moved = await this.townMoveParty(destination);
      if (this.inTown && moved) this.center = { ...this.univ.party.townLoc };
    }
    // A town move that leaves the map switches us to outdoors mid-action, and
    // the outdoor move then runs in the same keypress — same as the original.
    if (this.mode === GameMode.OUTDOORS) {
      const outDest = this.pendingOutDest ?? destination;
      this.pendingOutDest = null;
      if (await this.outdMoveParty(outDest)) {
        moved = true;
        this.center = { ...this.univ.party.outLoc };
        this.updateExplored(this.univ.party.outLoc);
      }
      this.checkTownEntrance();
    }
    if (moved) await this.afterPartyTurn();
    return moved;
  }

  /**
   * The tail of handle_action (boe.actions.cpp:1959): after the party acts, the
   * clock moves on and the monsters get their go. In town that's `do_monsters`
   * (they notice you and walk over) followed by `do_monster_turn` (they hit
   * you), which is why you can be attacked without ever entering combat mode.
   *
   * The clock is not touched here: this port folds `increase_age`'s tick into
   * the move functions themselves, which already advanced it.
   *
   * TODO(M7): increase_age's autosave, which eating triggers.
   */
  private async afterPartyTurn(): Promise<void> {
    try {
      await this.afterPartyTurnInner();
    } finally {
      // handle_monster_actions ends with this check (boe.actions.cpp:1932) —
      // upkeep (poison, disease, a field) or a monster's turn can be what
      // finishes the party off outside of combat.
      this.checkPartyDeath();
    }
  }

  private async afterPartyTurnInner(): Promise<void> {
    // increase_age's upkeep — poison biting, wounds closing, blessings running
    // out. Without this a status effect is only ever a line in the transcript.
    await increaseAgeEffects(this);
    // increase_age's tail (boe.actions.cpp:3578): quest deadlines and the town,
    // scenario and party timers, between the status upkeep and the fields.
    // The length is **1** even outdoors, where the clock has just jumped by 5
    // or 10 — that's what the C++ passes (the default argument), so an outdoor
    // turn ticks a party timer down by one, not by the time that passed.
    specialIncreaseAge(this, 1);
    // The fields do their work here, before the monsters move — increase_age
    // runs ahead of do_monsters in town (boe.actions.cpp:1266). Outdoors there
    // are no fields, which is why the C++ gates this on is_town().
    if (this.mode === GameMode.TOWN) await processFields(this);
    // increase_age (boe.actions.cpp:3586) cancels a half-finished trade-places
    // every turn, so a stray first click doesn't swap someone a minute later.
    this.currentSwitch = NO_ONE;
    // The queue check at the tail of handle_action (boe.actions.cpp:1910),
    // which is what actually runs anything the timers queued. It goes on the
    // turn chain rather than being launched loose: a special can damage, and
    // damage waits for its blast now, so a fire-and-forget special would have
    // its explosions interleaving with the monsters' — two chains taking turns
    // on one timeline, in an order nothing decides. The chain is serial, so
    // this still runs before the monsters below it. Dialogs a special raises
    // are unaffected: their input is routed ahead of the `busy` gate.
    this.queueTurn(async () => { await this.specials?.drainQueue(); });
    if (this.mode === GameMode.TOWN) {
      doMonsters(this);
      // The monsters' turn waits on the animation timeline now, so the rest of
      // the tail has to be queued behind it rather than run underneath it —
      // the wandering-group roll happens *after* they act, and `get_ran`'s
      // call order is part of the spec.
      this.queueTurn(async () => {
        await doMonsterTurn(this);
        // A town rolls for a new wandering group every turn, and a hard town
        // rolls more often — the difficulty is subtracted from the divisor.
        const difficulty = this.univ.townRecord?.difficulty ?? 0;
        if (this.univ.rng.getRan(1, 1, Math.max(2, 160 - difficulty)) === 2) {
          createWandMonst(this);
        }
        this.checkPartyDeath();
      });
      return;
    }
    if (this.mode === GameMode.OUTDOORS) {
      // Outdoors the groups only move every tenth turn — the C++ comment says
      // "no monst move if party outdoors and on horse", which is what makes
      // outrunning an encounter possible at all.
      if (this.univ.party.age % 10 !== 0) return;
      if (!this.univ.party.pcs.some((pc) => pc.isAlive)) return;
      doOutdoorMonsters(this);
      if (this.univ.rng.getRan(1, 1, 70) === 10) createWandMonst(this);
      void this.checkOutdoorEncounter();
    }
  }

  /**
   * The trigger at the end of `handle_action`: a group standing next to the
   * party (or a `forced` one anywhere) starts a fight, unless its `spec_on_meet`
   * chain calls it off. A group in a boat or in the air is never met.
   *
   * `initiate_outdoor_combat` then gives the party one more out: an encounter
   * far below its level simply runs away.
   */
  async checkOutdoorEncounter(): Promise<boolean> {
    const univ = this.univ;
    if (univ.party.inBoat >= 0) return false;
    const which = adjacentEncounter(univ);
    if (which < 0) return false;
    const group = univ.party.outC[which]!;
    const encounter = group.whatMonst;
    group.exists = false;
    this.storeWanderingSpecial = encounter;

    if (encounter.specOnMeet >= 0) {
      const { blocked } = await this.runSpecial(
        SpecCtx.OUTDOOR_ENC, SpecCtxType.OUTDOOR, encounter.specOnMeet, univ.party.locInSec);
      if (blocked) return false;
    }

    if (univ.party.getLevel() > Math.trunc((outEncLevTot(univ, encounter) * 5) / 3)
      && outEncLevTot(univ, encounter) < 200 && !encounter.cantFlee) {
      univ.addStringToBuf('Combat: Monsters fled!');
      return false;
    }

    startOutdoorCombat(this, encounter, univ.party.outLoc, countWalls(univ, univ.party.outLoc));
    this.onRedraw?.();
    return true;
  }

  /**
   * The outdoor half of ending a fight: the party can't leave while anything
   * hostile is still standing, and when it does it goes back outdoors with the
   * encounter's on-win chain fired.
   */
  private endOutdoorCombat(): boolean {
    const univ = this.univ;
    const stillAlive = (univ.town?.monsters ?? []).some((m) => m.isAlive && !m.isFriendly);
    if (stillAlive) {
      univ.addStringToBuf('Enemies are still alive!');
      return false;
    }
    this.exitArenaCombat();
    return true;
  }

  /**
   * The guts of leaving an outdoor arena, shared by `endOutdoorCombat`'s
   * voluntary exit (monster-alive check already passed) and the automatic
   * exit when everyone has fled — the C++'s `end_town_mode` call from
   * `handle_party_death` (boe.actions.cpp:1436) has no such check at all,
   * because there's nobody left standing to still be fighting.
   */
  private exitArenaCombat(): void {
    const univ = this.univ;
    for (const pc of univ.party.pcs) {
      if (pc.mainStatus === MainStatus.FLED) pc.mainStatus = MainStatus.ALIVE;
      pc.status[Status.POISONED_WEAPON] = 0;
      pc.status[Status.BLESS_CURSE] = 0;
      pc.status[Status.HASTE_SLOW] = 0;
      pc.parry = 0;
      pc.combatPos = loc(-1, -1);
      // Bonus health and spell points wear off with the fight.
      if (pc.curSp > pc.maxSp) pc.curSp = pc.maxSp;
      if (pc.curHealth > pc.maxHealth) pc.curHealth = pc.maxHealth;
    }
    this.combatActivePc = NO_ONE;
    univ.curPc = this.storeCurrentPc;
    if (!univ.currentPc.isAlive) univ.curPc = univ.firstActivePc();
    univ.town = null;
    this.arena = null;
    this.mode = GameMode.OUTDOORS;
    this.center = { ...univ.party.outLoc };
    univ.addStringToBuf('End combat.');
    this.sound?.play(93);
    const won = this.storeWanderingSpecial;
    this.storeWanderingSpecial = null;
    if (won && won.specOnWin >= 0) {
      void this.runSpecial(
        SpecCtx.WIN_ENCOUNTER, SpecCtxType.OUTDOOR, won.specOnWin, univ.party.locInSec);
    }
  }

  private outdIsBlocked(where: Location): boolean {
    const ter = this.univ.terrainType(this.univ.out.at(where.x, where.y));
    return (
      ter.blockage === TerObstruct.BLOCK_MOVE ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT
    );
  }

  /** town_boat_there / town_horse_there (boe.text.cpp:852/869). */
  private townVehicleAt(list: Vehicle[], where: Location): Vehicle | null {
    const townNum = this.univ.party.townNum;
    for (const v of list) {
      if (v.exists && v.whichTown === townNum && v.loc.x === where.x && v.loc.y === where.y) return v;
    }
    return null;
  }

  /**
   * out_boat_there / out_horse_there (boe.text.cpp:859/876). `where` is a
   * point in the 96x96 window, converted to sector-local coordinates the
   * same way the vehicle's own `loc` is stored.
   */
  private outVehicleAt(list: Vehicle[], where: Location): Vehicle | null {
    const { party } = this.univ;
    const local = party.globalToLocal(where);
    const sector = { x: party.outdoorCorner.x + party.iwc.x, y: party.outdoorCorner.y + party.iwc.y };
    for (const v of list) {
      if (!v.exists || v.whichTown !== TOWN_NUM_OUTDOORS) continue;
      if (v.loc.x !== local.x || v.loc.y !== local.y) continue;
      if (v.sector.x !== sector.x || v.sector.y !== sector.y) continue;
      return v;
    }
    return null;
  }

  private get flying(): boolean {
    return this.univ.party.partyStatus[PartyStatus.FLIGHT] > 0;
  }

  /** outd_move_party (boe.actions.cpp:3942). */
  private async outdMoveParty(destination: Location): Promise<boolean> {
    const { party, out, scenario } = this.univ;
    if (!out.isOnMap(destination.x, destination.y)) return false;

    // check_special_terrain for OUT_MOVE runs first (boe.actions.cpp:3950) —
    // this is what poisons you in a swamp and burns you in lava out here.
    if (!this.checkSpecialTerrain(destination)) return false;

    // A special on the destination square can block the step outright, or
    // force it through otherwise-blocking terrain (its `b` return) — that's
    // how a scenario walks you across water at a ford, the same trick
    // town_move_party's CANT_ENTER handling uses for a wall. This port used
    // to read only `blocked` here and silently drop `forced`, so a ford's
    // special ran (and could print its message) but the water still refused
    // the step right after.
    const special = this.specialAt(destination);
    let specialForced = false;
    if (special >= 0) {
      const { blocked, forced: nodeForced } = await this.runSpecial(
        SpecCtx.OUT_MOVE, SpecCtxType.OUTDOOR, special,
        // The chain sees sector coordinates, as check_special_terrain passes.
        this.univ.party.globalToLocal(destination));
      if (blocked) return false;
      specialForced = nodeForced;
    }

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

    // The boat/horse block runs before `party.direction` is set in the C++
    // too — a leave/board decision doesn't need it. `forced` starts from the
    // special node's own `forced` return and the boat-bridge prompt can also
    // set it — either one bypasses the blockage test below, same as the C++'s
    // single combined `forced` local.
    let forced = specialForced;
    const ter = out.at(realDest.x, realDest.y);
    const terType = this.univ.terrainType(ter);
    const diagonal = realDest.x !== party.outLoc.x && realDest.y !== party.outLoc.y;
    const undoWindowShift = (): void => {
      if (storeCorner.x !== party.outdoorCorner.x || storeCorner.y !== party.outdoorCorner.y) {
        out.shift(
          (storeCorner.x - party.outdoorCorner.x) as -1 | 0 | 1,
          (storeCorner.y - party.outdoorCorner.y) as -1 | 0 | 1,
        );
        party.iwc = storeIwc;
      }
    };
    if (party.inBoat >= 0) {
      if (
        !this.outdIsBlocked(realDest)
        && (!terType.boatOver || diagonal)
        && terType.special !== TerSpec.TOWN_ENTRANCE
      ) {
        this.univ.addStringToBuf('You leave the boat.');
        party.inBoat = -1;
      } else if (diagonal || (!forced && this.outVehicleAt(party.boats, destination))) {
        this.univ.addStringToBuf("Move: Boat can't move diagonally.");
        undoWindowShift();
        return false;
      } else if (
        !this.outdIsBlocked(realDest)
        && terType.boatOver
        && terType.special !== TerSpec.TOWN_ENTRANCE
      ) {
        if ((await this.onConfirmBoatBridge?.()) ?? false) {
          forced = true;
        } else {
          this.univ.addStringToBuf('You leave the boat.');
          party.inBoat = -1;
        }
      } else if (terType.boatOver) {
        forced = true;
      }
    }

    party.direction = setDirection(party.outLoc, destination);
    const dirStr = DIR_NAMES[party.direction] ?? '';

    const boardBoat = party.inBoat < 0 && party.inHorse < 0
      ? this.outVehicleAt(party.boats, realDest) : null;
    const boardHorse = party.inBoat < 0 && party.inHorse < 0
      ? this.outVehicleAt(party.horses, realDest) : null;
    if (boardBoat) {
      if (this.flying) {
        this.univ.addStringToBuf('You land first.');
        party.partyStatus[PartyStatus.FLIGHT] = 0;
      }
      this.univ.addStringToBuf('Move: You board the boat.');
      party.inBoat = party.boats.indexOf(boardBoat);
      party.outLoc = realDest;
      party.iwc = { x: realDest.x > 48 ? 1 : 0, y: realDest.y > 48 ? 1 : 0 };
      party.locInSec = party.globalToLocal(realDest);
      return true;
    } else if (boardHorse) {
      if (this.flying) {
        this.univ.addStringToBuf('Land before mounting horses.');
        undoWindowShift();
        return false;
      }
      this.univ.addStringToBuf('Move: You mount the horses.');
      this.sound?.play(84);
      party.inHorse = party.horses.indexOf(boardHorse);
      party.outLoc = realDest;
      party.iwc = { x: realDest.x > 48 ? 1 : 0, y: realDest.y > 48 ? 1 : 0 };
      party.locInSec = party.globalToLocal(realDest);
      return true;
    } else if (this.outdIsBlocked(realDest) && !forced && !(this.flying && terType.flyOver)) {
      this.univ.addStringToBuf(`Blocked: ${dirStr}`);
      undoWindowShift();
      return false;
    }

    if (party.inHorse >= 0) {
      if (terType.special === TerSpec.DAMAGING || terType.special === TerSpec.DANGEROUS) {
        this.univ.addStringToBuf('Your horses quite sensibly refuse.');
        undoWindowShift();
        return false;
      }
      if (terType.blockHorse) {
        this.univ.addStringToBuf("You can't take horses there!");
        undoWindowShift();
        return false;
      }
    }
    if (this.flying && terType.special === TerSpec.TOWN_ENTRANCE) {
      this.univ.addStringToBuf('Moved: You have to land first.');
      undoWindowShift();
      return false;
    }

    party.outLoc = realDest;
    party.iwc = { x: realDest.x > 47 ? 1 : 0, y: realDest.y > 47 ? 1 : 0 };
    party.locInSec = party.globalToLocal(realDest);
    // increase_age's outdoor clock (boe.actions.cpp:3362): a step outdoors is
    // *ten* ticks on foot (five on a horse), and the count is first rounded
    // down to a multiple of that. It is not `age++` — a great deal keys off
    // `age % 10 == 0`, including whether the wandering groups move and whether
    // the game rolls for a new encounter at all, so ticking by one made
    // outdoor encounters ten times rarer than they should be and ran the
    // whole outdoor clock (poison, healing, quest deadlines) ten times slow.
    const step = party.inHorse < 0 ? 10 : 5;
    party.age -= party.age % step;
    party.age += step;
    this.univ.addStringToBuf(`Moved: ${dirStr}`);
    this.moveSound(this.univ.out.at(realDest.x, realDest.y), this.numOutMoves);
    this.numOutMoves++;
    // Waterfalls (run_waterfalls) aren't ported; TODO(M6) if a scenario needs them.
    if (party.inHorse >= 0) {
      party.horses[party.inHorse]!.whichTown = TOWN_NUM_OUTDOORS;
      party.horses[party.inHorse]!.loc = party.locInSec;
      party.horses[party.inHorse]!.sector = {
        x: party.outdoorCorner.x + party.iwc.x,
        y: party.outdoorCorner.y + party.iwc.y,
      };
    }
    return true;
  }

  /** move_sound (boe.main.cpp:1995), minus the boat/horse/swamp special cases. */
  /**
   * Public because `combat_move_monster` (boe.monster.cpp:721) plays this
   * too, from `monsterTurn.ts`'s free-function combat movement, not just the
   * party's own moves.
   */
  moveSound(ter: number, step: number): void {
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

  /**
   * is_blocked (boe.locutils.cpp) — can nothing stand here? Much broader than
   * terrain: it also counts creatures, the party, force barriers and cages, and
   * *during combat* the marked special spots and city-trim terrain (which is
   * how the original keeps combatants off portals). This is what combat
   * placement and monster movement have to ask; `townIsBlocked` alone let PCs
   * materialise on top of monsters and inside walls.
   */
  isBlocked(where: Location): boolean {
    const town = this.univ.town;
    if (!town) {
      if (!this.univ.out.isOnMap(where.x, where.y)) return true;
      if (this.outdIsBlocked(where)) return true;
      return locsEqual(where, this.univ.party.outLoc);
    }
    if (!town.isOnMap(where.x, where.y)) return true;
    if (this.townIsBlocked(where)) return true;

    const inCombat = isCombat(this.mode);
    if (inCombat) {
      // Keep combatants off marked specials and off portals.
      if (town.isSpecialSpot(where.x, where.y)) return true;
      if (this.univ.terrainType(town.record.terrain[where.x]![where.y]!).trimType
        === TrimType.CITY) return true;
    }

    // The party's square, or a PC's, depending on the mode.
    if (!inCombat && locsEqual(where, this.univ.party.townLoc)) return true;
    if (inCombat && this.univ.party.pcs.some(
      (pc) => pc.isAlive && locsEqual(pc.combatPos, where))) return true;

    if (town.monsterAt(where)) return true;
    if (town.hasField(where.x, where.y, FieldType.BARRIER_FORCE)) return true;
    if (town.hasField(where.x, where.y, FieldType.BARRIER_CAGE)) return true;
    return false;
  }

  townIsBlocked(where: Location): boolean {
    const town = this.univ.town!;
    // Off the map counts as blocked: combat placement walks a table of offsets
    // that can run past the edge, and `sightObscurity` is asked the same way.
    if (!town.isOnMap(where.x, where.y)) return true;
    const ter = this.univ.terrainType(town.record.terrain[where.x]![where.y]!);
    return (
      ter.blockage === TerObstruct.BLOCK_MOVE ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SHOOT ||
      ter.blockage === TerObstruct.BLOCK_MOVE_AND_SIGHT
    );
  }

  /** town_move_party (boe.actions.cpp:4139). */
  private async townMoveParty(destination: Location): Promise<boolean> {
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
      // The outdoor square to walk out onto; moveTo picks this up, because
      // the town coordinate that triggered the exit is meaningless out there.
      this.pendingOutDest = this.endTownMode(destination);
      return false;
    }

    if (!town.isOnMap(destination.x, destination.y)) return false;

    // Walking into something hostile starts a fight rather than bouncing off.
    const blocker = town.monsterAt(destination);
    if (blocker) {
      if (!blocker.isFriendly) {
        party.direction = setDirection(party.townLoc, destination);
        this.startCombat(party.direction);
        return false;
      }
      this.univ.addStringToBuf('Blocked: a creature is in the way.');
      return false;
    }

    party.direction = setDirection(party.townLoc, destination);

    // check_special_terrain for TOWN_MOVE (boe.specials.cpp:152).
    if (!this.checkSpecialTerrain(destination)) return false;

    // town_move_party's boat/horse handling (boe.actions.cpp:4159): a leave,
    // a diagonal refusal, a bridge prompt, or boarding a vehicle waiting on
    // the destination square. Boarding returns straight away, same as the
    // outdoor half; a bridge crossing sets `vehicleForced` to bypass the
    // blocked-terrain test below, the same way a scenario's `forced` return
    // does.
    const vehicleStep = await this.townVehicleStep(destination);
    if (vehicleStep === 'boarded') return true;
    if (vehicleStep === 'blocked') return false;
    const vehicleForced = vehicleStep === 'forced';

    const blockedTerrain = this.townIsBlocked(destination);

    // A special attached to the square runs before the step is committed, and
    // can block it (its `a` return) or force it through (`b`). A blocked
    // square still runs its special when the terrain is a door or a
    // call-special type (boe.specials.cpp:243).
    const special = this.specialAt(destination);
    if (special >= 0) {
      const terSpec = this.univ.terrainType(
        town.record.terrain[destination.x]![destination.y]!).special;
      // A CANT_ENTER node with ex2a set says "run me even on a blocked
      // square" — that's how a scenario explains a wall you can't pass.
      const node = town.record.specials.get(special);
      const forceAllowed = node?.type === SpecType.CANT_ENTER && node.ex2a > 0;
      const runIt = !blockedTerrain
        || terSpec === TerSpec.CHANGE_WHEN_STEP_ON
        || terSpec === TerSpec.CALL_SPECIAL
        || forceAllowed;
      if (runIt) {
        const { blocked, forced } = await this.runSpecial(
          SpecCtx.TOWN_MOVE, SpecCtxType.TOWN, special, destination);
        if (blocked) return false;
        // The town may have changed under us, or the party teleported.
        if (!this.inTown || this.univ.town !== town) return true;
        if (forced) {
          party.townLoc = destination;
          party.age++;
          town.makeExplored(destination.x, destination.y);
          this.updateExplored(party.townLoc);
          return true;
        }
      }
    }

    if (blockedTerrain && !vehicleForced) {
      this.univ.addStringToBuf(`Blocked: ${DIR_NAMES[party.direction] ?? ''}`);
      return false;
    }

    if (party.inHorse >= 0) {
      const terSpec = this.univ.terrainType(
        town.record.terrain[destination.x]![destination.y]!);
      if (terSpec.special === TerSpec.DAMAGING || terSpec.special === TerSpec.DANGEROUS) {
        this.univ.addStringToBuf('Your horses quite sensibly refuse.');
        return false;
      }
      if (terSpec.blockHorse) {
        this.univ.addStringToBuf("You can't take horses there!");
        return false;
      }
      if (town.record.lightingType !== Lighting.LIGHT_NORMAL && this.univ.rng.getRan(1, 0, 1) === 0) {
        this.univ.addStringToBuf('The darkness spooks your horses.');
        return false;
      }
    }

    party.townLoc = destination;
    party.age++;
    this.moveSound(town.record.terrain[destination.x]![destination.y]!, this.numTownMoves++);
    town.makeExplored(destination.x, destination.y);
    this.updateExplored(this.univ.party.townLoc);
    // Waterfalls (run_waterfalls) aren't ported; TODO(M6) if a scenario needs them.
    if (party.inHorse >= 0) {
      party.horses[party.inHorse]!.loc = { ...party.townLoc };
      party.horses[party.inHorse]!.whichTown = party.townNum;
    }
    return true;
  }

  /**
   * The boat/horse block of town_move_party (boe.actions.cpp:4159-4232):
   * leaving the boat on dry land, refusing a diagonal move, the "go under or
   * land" bridge prompt, and boarding a boat or horse waiting on the
   * destination square. Runs after check_special_terrain, same as the C++.
   */
  private async townVehicleStep(destination: Location): Promise<'continue' | 'forced' | 'boarded' | 'blocked'> {
    const { party } = this.univ;
    const town = this.univ.town!;
    let forced = false;
    if (party.inBoat >= 0) {
      const ter = town.record.terrain[destination.x]![destination.y]!;
      const terType = this.univ.terrainType(ter);
      const diagonal = destination.x !== party.townLoc.x && destination.y !== party.townLoc.y;
      if (
        !this.townIsBlocked(destination) && this.specialAt(destination) < 0
        && (!terType.boatOver || diagonal)
      ) {
        this.univ.addStringToBuf('You leave the boat.');
        party.inBoat = -1;
      } else if (diagonal) {
        this.univ.addStringToBuf("Move: Boat can't move diagonally.");
        return 'blocked';
      } else if (!this.townIsBlocked(destination) && terType.boatOver && terType.special === TerSpec.BRIDGE) {
        if ((await this.onConfirmBoatBridge?.()) ?? false) {
          forced = true;
        } else if (!this.townIsBlocked(destination)) {
          this.univ.addStringToBuf('You leave the boat.');
          party.inBoat = -1;
        }
      } else if (this.townVehicleAt(party.boats, destination)) {
        this.univ.addStringToBuf('  Boat there already.');
        return 'blocked';
      } else if (terType.boatOver) {
        forced = true;
      }
    }

    party.direction = setDirection(party.townLoc, destination);

    const boardBoat = party.inBoat < 0 && party.inHorse < 0
      ? this.townVehicleAt(party.boats, destination) : null;
    if (boardBoat) {
      if (boardBoat.property) {
        this.univ.addStringToBuf('  Not your boat.');
        return 'blocked';
      }
      this.univ.addStringToBuf('Move: You board the boat.');
      party.inBoat = party.boats.indexOf(boardBoat);
      party.townLoc = destination;
      this.center = { ...party.townLoc };
      return 'boarded';
    }
    const boardHorse = party.inBoat < 0 && party.inHorse < 0
      ? this.townVehicleAt(party.horses, destination) : null;
    if (boardHorse) {
      if (boardHorse.property) {
        this.univ.addStringToBuf('  Not your horses.');
        return 'blocked';
      }
      this.univ.addStringToBuf('Move: You mount the horses.');
      this.sound?.play(84);
      party.inHorse = party.horses.indexOf(boardHorse);
      party.townLoc = destination;
      this.center = { ...party.townLoc };
      return 'boarded';
    }
    return forced ? 'forced' : 'continue';
  }

  /**
   * The Rest command (handle_rest). Returns false with a reason in the
   * transcript when the party can't.
   */
  rest(): boolean {
    const where = this.inTown ? this.univ.party.townLoc : this.univ.party.outLoc;
    const ter = this.inTown
      ? this.univ.town?.record.terrain[where.x]?.[where.y]
      : this.univ.out.at(where.x, where.y);
    const special = ter === undefined ? TerSpec.NONE : this.univ.terrainType(ter).special;
    const dangerous = special === TerSpec.DAMAGING || special === TerSpec.DANGEROUS;
    return handleRest(this.univ, this.isOutdoors, dangerous, this.sound);
  }

  // -------------------------------------------------------------------- use

  /**
   * use_space (boe.specials.cpp:1211) — the Use action on an adjacent square.
   * A "change when used" terrain flips to its counterpart; a "call special when
   * used" one runs a chain. Returns false when there's nothing to use.
   */
  async useSpace(where: Location): Promise<boolean> {
    const from = this.inTown ? this.univ.party.townLoc : this.univ.party.outLoc;
    if (dist(from, where) > 1) {
      this.univ.addStringToBuf('  That is too far away.');
      return false;
    }
    const ter = this.inTown
      ? this.univ.town?.record.terrain[where.x]?.[where.y]
      : this.univ.out.at(where.x, where.y);
    if (ter === undefined) return false;
    const info = this.univ.terrainType(ter);
    const town = this.univ.town;
    this.univ.addStringToBuf('Use...');

    // Webs and pushable objects come before the terrain checks: they're what's
    // *in* the space rather than the space itself (boe.specials.cpp:1220).
    if (town) {
      if (town.hasField(where.x, where.y, FieldType.FIELD_WEB)) {
        this.univ.addStringToBuf('  You clear the webs.');
        town.setField(where.x, where.y, FieldType.FIELD_WEB, false);
        return true;
      }
      const pushables: [FieldType, string][] = [
        [FieldType.OBJECT_CRATE, 'crate'],
        [FieldType.OBJECT_BARREL, 'barrel'],
        [FieldType.OBJECT_BLOCK, 'block'],
      ];
      for (const [field, name] of pushables) {
        if (!town.hasField(where.x, where.y, field)) continue;
        const to = this.pushLoc(from, where);
        if (to.x === from.x && to.y === from.y) {
          this.univ.addStringToBuf(`  Can't push ${name}.`);
          return false;
        }
        this.univ.addStringToBuf(`  You push the ${name}.`);
        town.setField(where.x, where.y, field, false);
        // x 0 is push_loc's "it fell in the water" sentinel: the thing is gone.
        if (to.x !== 0) town.setField(to.x, to.y, field, true);
        // Whatever was inside a crate or barrel travels with it.
        if (field !== FieldType.OBJECT_BLOCK)
          for (const item of town.items)
            if (item.variety !== ItemType.NO_ITEM && item.contained && item.held
              && item.itemLoc.x === where.x && item.itemLoc.y === where.y)
              item.itemLoc = { ...to };
        return true;
      }
    }

    if (info.special === TerSpec.CHANGE_WHEN_USED) {
      if (where.x === from.x && where.y === from.y) {
        this.univ.addStringToBuf('  Not while on space.');
        return false;
      }
      this.univ.addStringToBuf('  OK.');
      alterSpace(this.univ, where.x, where.y, info.flag1);
      if (info.flag2 >= 0) this.sound?.play(info.flag2);
      return true;
    }
    if (info.special === TerSpec.CALL_SPECIAL_WHEN_USED) {
      // flag2 picks which node list flag1 indexes: 1 means the local one.
      const type = info.flag2 === 1
        ? (this.inTown ? SpecCtxType.TOWN : SpecCtxType.OUTDOOR)
        : SpecCtxType.SCEN;
      await this.runSpecial(SpecCtx.USE_SPACE, type, info.flag1, where);
      return true;
    }
    this.univ.addStringToBuf('  Nothing to use.');
    return false;
  }

  /**
   * push_loc (boe.locutils.cpp:547) — where a pushed object ends up: one more
   * step along the push, unless something's in the way, in which case it swaps
   * places with the pusher. An object pushed into water or a pit is destroyed,
   * which the original signals by returning x = 0.
   */
  private pushLoc(from: Location, to: Location): Location {
    const target = loc(to.x + (to.x - from.x), to.y + (to.y - from.y));
    const town = this.univ.town;
    if (!town || !town.isOnMap(target.x, target.y)) return { ...from };
    const ter = town.record.terrain[target.x]![target.y]!;
    const info = this.univ.terrainType(ter);
    // Terrain 90 is the pit; boat_over means water.
    if (ter === 90 || info.boatOver) return loc(0, target.y);
    if (this.sightObscurity(target.x, target.y) > 0) return { ...from };
    if (info.blockage !== TerObstruct.CLEAR) return { ...from };
    if (this.locOffActiveArea(target)) return { ...from };
    if (town.monsterAt(target)) return { ...from };
    return target;
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
    // handle_look draws its line from the acting PC in MODE_LOOK_COMBAT and
    // from the party's own square otherwise (boe.actions.cpp:693).
    const from = isCombat(this.mode) ? univ.currentPc.combatPos
      : this.inTown ? univ.party.townLoc : univ.party.outLoc;
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

    // `adj_town_look` is the *caller's* job in the C++ (boe.actions.cpp:700),
    // and only in town or combat. Outdoors it has a standing TODO saying an
    // OUT_LOOK special ought to fire here; this port fires one, which is the
    // one thing here the original doesn't do.
    if (!town && dist(from, where) <= 1) {
      const special = this.specialAt(where);
      if (special >= 0)
        void this.runSpecial(SpecCtx.OUT_LOOK, SpecCtxType.OUTDOOR, special, where);
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
   * `is_container` (boe.locutils.cpp:220) — a crate or barrel sitting on the
   * square, or terrain that is a container in its own right (a bookshelf, a
   * chest of drawers).
   */
  isContainer(where: Location): boolean {
    const town = this.univ.town;
    if (!town || where.x < 0 || where.y < 0) return false;
    if (town.hasField(where.x, where.y, FieldType.OBJECT_CRATE)) return true;
    if (town.hasField(where.x, where.y, FieldType.OBJECT_BARREL)) return true;
    if (!town.isOnMap(where.x, where.y)) return false;
    const ter = town.record.terrain[where.x]![where.y]!;
    return this.univ.terrainType(ter).special === TerSpec.IS_A_CONTAINER;
  }

  /**
   * `adj_town_look` (boe.specials.cpp:1292) — the *search* half of looking at
   * an adjacent square, which the caller runs after `do_look` has described it.
   * Searching a square with a special on it runs the special; searching a
   * container opens it.
   *
   * Returns the container's contents for the host to put in a get-items
   * dialog, or null when there is nothing to open. That split is the same one
   * training and the job board use: the rules here, the dialog in `main.ts`.
   *
   * Note the C++'s own return value is **always false** — the `need_redraw` it
   * feeds is never set by this function.
   */
  async adjTownLook(where: Location): Promise<Item[] | null> {
    const { univ } = this;
    const town = univ.town;
    if (!town) return null;

    // What is *inside* the square, as opposed to lying on it. `do_look` has
    // already listed everything that isn't contained.
    const itemThere = town.items.some((item) => item.variety !== ItemType.NO_ITEM
      && item.contained && item.itemLoc.x === where.x && item.itemLoc.y === where.y);

    let canOpen = true;
    let gotSpecial = false;
    const ter = town.isOnMap(where.x, where.y) ? town.record.terrain[where.x]![where.y]! : 0;

    if (this.specialAt(where) >= 0) {
      // Adjacency is measured from the party's square even in combat, which is
      // what the C++ passes. This branch is dead in play — `handle_look` only
      // calls adj_town_look for an adjacent square — and note that it skips
      // the *special* without touching `canOpen`, so a distant container would
      // still open. Kept as written.
      if (dist(univ.party.townLoc, where) > 1) {
        univ.addStringToBuf('  Not close enough to search.');
      } else {
        for (const spot of town.record.specialLocs) {
          if (spot.x !== where.x || spot.y !== where.y) continue;
          // A square you can't step into announces the find, since there is no
          // walking onto it to discover the same thing.
          if (this.getBlockage(ter) > 0)
            univ.addStringToBuf('  Search: You find something!');
          const { blocked } = await this.runSpecial(
            SpecCtx.TOWN_LOOK, SpecCtxType.TOWN, spot.spec, where);
          if (blocked) canOpen = false;
          gotSpecial = true;
        }
      }
    }

    if (this.isContainer(where) && itemThere && canOpen) {
      // get_item(where, 6, true): everything contained *on that square*.
      return town.items.filter((item) => item.variety !== ItemType.NO_ITEM
        && item.contained && item.itemLoc.x === where.x && item.itemLoc.y === where.y);
    }
    const spec = univ.terrainType(ter).special;
    if (spec === TerSpec.CHANGE_WHEN_USED || spec === TerSpec.CALL_SPECIAL_WHEN_USED)
      univ.addStringToBuf('  (Use this space to do something with it.)');
    else if (!gotSpecial)
      univ.addStringToBuf("  Search: You don't find anything.");
    return null;
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
      // get_item (boe.items.cpp:501): an overweight pickup gets its own cue,
      // the same one a failed lockpick uses.
      if (result.status === GiveStatus.TOO_HEAVY) this.sound?.play(Snd.TOO_HEAVY);
      return result.message;
    }
    const index = town.items.indexOf(item);
    if (index >= 0) town.items.splice(index, 1);
    // Remember that a preset item has been taken, so it doesn't come back.
    if (item.isSpecial > 0) town.record.itemTaken[item.isSpecial - 1] = true;
    this.univ.addStringToBuf(result.message);
    // get_item (boe.items.cpp:486-508): gold and food each get their own
    // sound, everything else the generic pickup cue.
    if (item.variety === ItemType.GOLD) this.sound?.play(Snd.GOT_GOLD);
    else if (item.variety === ItemType.FOOD) this.sound?.play(Snd.GOT_FOOD);
    else this.sound?.play(Snd.GOT_ITEM);
    // get_item (boe.items.cpp:286) — taking something that isn't yours in
    // sight of anyone friendly turns the whole town on the party.
    if (item.property) {
      for (const monst of town.monsters) {
        if (!monst.isAlive || !monst.isFriendly) continue;
        if (this.canSeeLight(item.itemLoc, monst.curLoc) >= SIGHT_BLOCKED) continue;
        makeTownHostile(this);
        this.univ.addStringToBuf('Your crime was seen!');
        break;
      }
    }
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
   * The specials interpreter. The host installs it (with its dialog hooks) via
   * `attachSpecials`; without one the game runs with scripting inert, which is
   * what the headless tests that don't care about specials do.
   */
  specials: SpecialsEngine | null = null;

  attachSpecials(host: SpecialHost): void {
    this.specials = new SpecialsEngine(this.univ, host, this);
  }

  /**
   * Run a special chain and apply what it decided. Returns `blocked` so
   * movement can cancel the step, matching run_special's `a` return.
   */
  async runSpecial(
    mode: SpecCtx, type: SpecCtxType, node: number, where: Location,
  ): Promise<{ blocked: boolean; forced: boolean }> {
    if (!this.specials || node < 0) return { blocked: false, forced: false };
    const result = await this.specials.run(mode, type, node, where);
    if (result.redraw) this.onRedraw?.();
    return { blocked: result.a > 0, forced: result.b > 0 };
  }

  /** The same, but handing back the raw return slots (TALK uses them for strings). */
  async runSpecialRaw(
    mode: SpecCtx, type: SpecCtxType, node: number, where: Location,
  ): Promise<{ a: number; b: number }> {
    if (!this.specials || node < 0) return { a: -1, b: -1 };
    const result = await this.specials.run(mode, type, node, where);
    if (result.redraw) this.onRedraw?.();
    return { a: result.a, b: result.b };
  }

  /**
   * screen_shift (boe.actions.cpp:1465) — slide the view one square without
   * moving the party, so a spell or a shot can reach past the edge of what's
   * on screen. Bounded by the town's own rect *and* by the 9x9 view's half
   * width, so the grid never runs off the map. Town and combat only, since the
   * C++ dereferences `univ.town` here.
   */
  screenShift(dx: number, dy: number): boolean {
    const town = this.univ.town;
    if (!town || (dx === 0 && dy === 0)) return false;
    const rect = town.record.inTownRect;
    const maxDim = town.record.maxDim;
    let moved = false;
    if (dy < 0 && this.center.y > rect.top && this.center.y > 4) {
      this.center.y--;
      moved = true;
    }
    if (dy > 0 && this.center.y < rect.bottom && this.center.y < maxDim - 5) {
      this.center.y++;
      moved = true;
    }
    if (dx < 0 && this.center.x > rect.left && this.center.x > 4) {
      this.center.x--;
      moved = true;
    }
    if (dx > 0 && this.center.x < rect.right && this.center.x < maxDim - 5) {
      this.center.x++;
      moved = true;
    }
    return moved;
  }

  /** Set by the host so a special that changes the world can repaint. */
  onRedraw: (() => void) | null = null;

  /**
   * The monsters' half of a turn is `async` now — it waits on the animation
   * timeline where the C++ blocks, so the model advances at the same rate the
   * screen does (see `animSettle`). That would otherwise colour every caller
   * of `afterCombatAction` async, and several of them are free functions
   * (`combatCastSpell`, `doCombatCast`) whose own callers would follow.
   *
   * So the async part is *queued* rather than awaited: these methods stay
   * synchronous and chain the monster round here, one at a time and in order.
   * `busy` is the "the monsters are going" flag the input layer gates on —
   * the C++ gets that for free by blocking, and even flushes queued keys
   * (`flushingInput`, boe.combat.cpp:2432). `settled()` is how a test or the
   * host waits for the fight to catch up.
   */
  private turnChain: Promise<void> = Promise.resolve();
  private turnsQueued = 0;

  /** True while a monster round is still playing out. `prime_time` is not. */
  get busy(): boolean {
    return this.turnsQueued > 0;
  }

  /**
   * `monsters_going` (boe.main.cpp:190) — set for exactly the span of
   * `do_monster_turn` and read by the *drawing* code, which is why it is here
   * rather than local to that function. It is not the same thing as `busy`:
   * `busy` covers the whole queued round, including the bookkeeping either
   * side, whereas this is only the part where the view is following monsters
   * around instead of sitting on the party.
   *
   * Three things depend on it (boe.graphics.cpp:940, :692/:732, :1635, and
   * boe.graphutil.cpp:264):
   * - Terrain drawn while the camera is off on a monster **ignores the
   *   explored map**, so the monster isn't a sprite floating in blackness.
   * - The status bar names the monster that is going, rather than the PC whose
   *   turn it isn't.
   * - The active-PC ring and the pointing arrows are suppressed; both point at
   *   a PC who cannot act right now.
   */
  monstersGoing = false;

  /** Resolves once every queued monster round has finished. */
  settled(): Promise<void> {
    return this.turnChain;
  }

  private queueTurn(work: () => Promise<void>): void {
    this.turnsQueued++;
    this.turnChain = this.turnChain
      .then(work)
      // A throw must not poison the chain — every later turn would be skipped
      // silently and the fight would simply stop. Reported instead, which also
      // fails `verify-screen`'s console-error gate rather than hiding.
      .catch((err: unknown) => { console.error('monster turn failed', err); })
      .then(() => {
        this.turnsQueued--;
        if (this.turnsQueued === 0) this.onRedraw?.();
      });
  }

  /**
   * The special node attached to a town square, if any (cTown::special_locs).
   */
  specialAt(where: Location): number {
    const town = this.univ.town;
    if (town) {
      if (!town.isSpecialSpot(where.x, where.y)) return -1;
      for (const loc of town.record.specialLocs)
        if (loc.x === where.x && loc.y === where.y) return loc.spec;
      return -1;
    }
    // Outdoors the list is in sector coordinates, and there's no flag gate.
    const local = this.univ.party.globalToLocal(where);
    for (const loc of this.univ.out.sectorAt(where).specialLocs)
      if (loc.x === local.x && loc.y === local.y) return loc.spec;
    return -1;
  }

  /**
   * The subset of check_special_terrain (boe.specials.cpp:152) that movement
   * needs and that doesn't require the specials VM. Returns false when the
   * move is cancelled.
   *
   * It runs **outdoors as well as in town** — the C++ calls it first thing in
   * `outd_move_party` (boe.actions.cpp:3950) with `eSpecCtx::OUT_MOVE`, which
   * is what makes a swamp poison you and a lava field burn you on the world
   * map. Only the terrain source and the special's context differ.
   */
  private checkSpecialTerrain(where: Location): boolean {
    const town = this.univ.town;
    const inCombatMove = isCombat(this.mode);
    // from_loc: the square being left, which the conveyor and the pushables
    // both need — a crate is shoved on along the line the pusher was walking.
    const fromLoc = inCombatMove ? this.univ.currentPc.combatPos : this.univ.party.townLoc;

    const ter = town
      ? (town.isOnMap(where.x, where.y) ? town.record.terrain[where.x]![where.y]! : 0)
      : (this.univ.out.isOnMap(where.x, where.y) ? this.univ.out.at(where.x, where.y) : 0);
    const spec = this.univ.terrainType(ter);

    // A moving floor refuses to be walked against. `flag1` is the direction it
    // runs; the three headings that include it are the ones it blocks.
    // (The C++'s own TODO wonders why conveyors don't work outdoors; kept.)
    if (town && spec.special === TerSpec.CONVEYOR) {
      const dir = spec.flag1;
      if ((NO_MOVE_FROM_NORTH.has(dir) && where.y > fromLoc.y)
        || (NO_MOVE_FROM_EAST.has(dir) && where.x < fromLoc.x)
        || (NO_MOVE_FROM_SOUTH.has(dir) && where.y < fromLoc.y)
        || (NO_MOVE_FROM_WEST.has(dir) && where.x > fromLoc.x)) {
        this.univ.addStringToBuf('The moving floor prevents you.');
        return false;
      }
    }

    // Barriers stop the party before terrain is even consulted. They live on
    // the town's field grid, so there are none outdoors.
    if (town) {
      if (town.hasField(where.x, where.y, FieldType.BARRIER_FORCE)) {
        this.univ.addStringToBuf('  Magic barrier!');
        return false;
      }
      if (town.hasField(where.x, where.y, FieldType.BARRIER_CAGE)) {
        this.univ.addStringToBuf('  Force cage!');
        return false;
      }
      if (!town.isOnMap(where.x, where.y)) return true;
    } else if (!this.univ.out.isOnMap(where.x, where.y)) return true;

    // Everything between the barrier tests and the terrain switch: the fields
    // you walk into, the webs that catch you, and the things you shove.
    if (town) {
      this.checkFields(where, inCombatMove);
      this.walkIntoWebs(where, inCombatMove);
      this.pushThings(fromLoc, where);
    }

    switch (spec.special) {
      case TerSpec.CHANGE_WHEN_STEP_ON: {
        // An unlocked door: walking into it swaps the terrain for flag1, and
        // if the old terrain blocked movement the party doesn't enter yet.
        if (town) town.record.terrain[where.x]![where.y] = spec.flag1;
        else this.univ.out.set(where.x, where.y, spec.flag1);
        if (spec.flag2 >= 0) this.sound?.play(spec.flag2);
        return !blocksMove(spec);
      }
      case TerSpec.UNLOCKABLE:
        // A locked door: the caller has to ask the player what to do, which
        // needs a dialog, so it defers to the host via onLockedDoor.
        this.onLockedDoor?.(where, ter);
        return false;
      case TerSpec.CALL_SPECIAL:
        // The terrain itself names a node; flag1 is which one. Outdoors the
        // chain is passed *sector-local* coordinates, as everywhere else.
        void this.runSpecial(
          town ? SpecCtx.TOWN_MOVE : SpecCtx.OUT_MOVE,
          town ? SpecCtxType.TOWN : SpecCtxType.OUTDOOR,
          spec.flag1,
          town ? where : this.univ.party.globalToLocal(where));
        return true;
      case TerSpec.DANGEROUS:
        this.dangerousTerrain(spec);
        return true;
      case TerSpec.DAMAGING:
        this.damagingTerrain(spec);
        return true;
      default:
        return true;
    }
  }

  /**
   * check_fields (boe.specials.cpp:381) — walking *into* a field, as opposed
   * to standing in one (which is `process_fields`'s job). Out of combat the
   * walls only announce themselves: the C++ only damages on a COMBAT_MOVE,
   * because in town the party is about to be hit by `process_fields` anyway.
   */
  private async checkFields(where: Location, inCombatMove: boolean): Promise<void> {
    const town = this.univ.town;
    if (!town) return;
    const pc = this.univ.currentPc;
    const rng = this.univ.rng;
    const say = (line: string): void => this.univ.addStringToBuf(line);
    const hit = async (dam: number, type: DamageType): Promise<void> => {
      if (inCombatMove) await damagePc(this.univ, pc, dam, type, Race.UNKNOWN);
    };

    if (town.hasField(where.x, where.y, FieldType.WALL_FIRE)) {
      say('  Fire wall!');
      await hit(rng.getRan(1, 1, 6) + 1, DamageType.FIRE);
    }
    if (town.hasField(where.x, where.y, FieldType.WALL_FORCE)) {
      say('  Force wall!');
      await hit(rng.getRan(2, 1, 6), DamageType.MAGIC);
    }
    if (town.hasField(where.x, where.y, FieldType.WALL_ICE)) {
      say('  Ice wall!');
      const r1 = rng.getRan(2, 1, 6);
      await hit(r1, DamageType.COLD);
      // The C++ booms on the *party's* square, not the one stepped into, and
      // only outside combat. Kept.
      if (!isCombat(this.mode)) boomSpace(this.univ.party.townLoc, 4, r1, 7, this.univ.rng);
    }
    if (town.hasField(where.x, where.y, FieldType.WALL_BLADES)) {
      say('  Blade wall!');
      await hit(rng.getRan(4, 1, 8), DamageType.WEAPON);
    }
    if (town.hasField(where.x, where.y, FieldType.FIELD_QUICKFIRE)) {
      say('  Quickfire!');
      await hit(rng.getRan(2, 1, 8), DamageType.FIRE);
    }
    if (town.hasField(where.x, where.y, FieldType.CLOUD_STINK)) {
      say('  Stinking cloud!');
      pc.curse(rng.getRan(1, 2, 3));
    }
    if (town.hasField(where.x, where.y, FieldType.CLOUD_SLEEP)) {
      say('  Sleep cloud!');
      pc.sleep(Status.ASLEEP, 3, 0, rng);
    }
    if (town.hasField(where.x, where.y, FieldType.BARRIER_FIRE)) {
      say('  Magic barrier!');
      const r1 = rng.getRan(2, 1, 10);
      if (inCombatMove) await damagePc(this.univ, pc, r1, DamageType.MAGIC, Race.UNKNOWN);
      else await hitParty(this.univ, r1, DamageType.MAGIC);
    }
  }

  /**
   * The webs half of check_special_terrain (boe.specials.cpp:283). Walking
   * into a web catches you and *uses the web up*. Out of combat it webs the
   * whole party; in combat only the PC who walked in. Bugs walk through.
   */
  private walkIntoWebs(where: Location, inCombatMove: boolean): void {
    const town = this.univ.town;
    if (!town || !town.hasField(where.x, where.y, FieldType.FIELD_WEB)) return;
    // The race test reads the *current* PC even when the whole party is caught,
    // so out of combat it's PC 1's race that decides for everyone. Kept.
    if (this.univ.currentPc.race === Race.BUG) return;
    this.univ.addStringToBuf('  Webs!');
    if (!inCombatMove) {
      for (const pc of this.univ.party.pcs) pc.web(this.univ.rng.getRan(1, 2, 3));
    } else {
      this.univ.currentPc.web(this.univ.rng.getRan(1, 2, 3));
    }
    town.setField(where.x, where.y, FieldType.FIELD_WEB, false);
  }

  /**
   * The pushables half of check_special_terrain (boe.specials.cpp:290) plus
   * `push_thing` / `move_thing` (boe.town.cpp:1627) — walking into a crate,
   * barrel or stone block shoves it one square further along the same line.
   */
  private pushThings(from: Location, where: Location): void {
    const town = this.univ.town;
    if (!town) return;
    const kinds: Array<[FieldType, string]> = [
      [FieldType.OBJECT_CRATE, '  You push the crate.'],
      [FieldType.OBJECT_BARREL, '  You push the barrel.'],
      [FieldType.OBJECT_BLOCK, '  You push the stone block.'],
    ];
    for (const [kind, message] of kinds) {
      if (!town.hasField(where.x, where.y, kind)) continue;
      this.univ.addStringToBuf(message);
      this.moveThing(kind, where, this.pushLoc(from, where));
    }
  }

  /** move_thing (boe.town.cpp:1630) — and the items inside a pushed container. */
  private moveThing(kind: FieldType, from: Location, to: Location): void {
    const town = this.univ.town!;
    town.setField(from.x, from.y, kind, false);
    if (to.x > 0) town.setField(to.x, to.y, kind, true);
    if (kind !== FieldType.OBJECT_CRATE && kind !== FieldType.OBJECT_BARREL) return;
    for (const item of town.items) {
      if (item.variety === ItemType.NO_ITEM || !item.contained || !item.held) continue;
      if (locsEqual(item.itemLoc, from)) item.itemLoc = { ...to };
    }
  }

  /**
   * The DAMAGING terrain branch of check_special_terrain
   * (boe.specials.cpp:323) — lava, fire, spikes. flag3 names the damage type
   * (0 or out of range means a plain wound), and the damage is
   * `get_ran(flag2, 1, flag1)`. Outside combat it hits the whole party.
   *
   * TODO(M5): flying and boats make the party immune, and combat hurts only
   * the PC who stepped in it.
   */
  private async damagingTerrain(spec: Terrain): Promise<void> {
    let damType: DamageType = spec.flag3 > 0 && spec.flag3 < DamageType.SPECIAL
      ? spec.flag3 as DamageType
      : DamageType.WEAPON;
    let amount = this.univ.rng.getRan(spec.flag2, 1, spec.flag1);
    const say = (line: string): void => this.univ.addStringToBuf(line);
    switch (damType) {
      case DamageType.FIRE:
        say("  It's hot!");
        // TODO(M6): the firewalk party status makes fire terrain harmless.
        break;
      case DamageType.COLD: say('  You feel cold!'); break;
      case DamageType.ACID: say('  It burns!'); break;
      case DamageType.SPECIAL:
        // Terrain can't deal true assassination damage; it becomes unblockable.
        damType = DamageType.UNBLOCKABLE;
        say('  Something shocks you!');
        break;
      case DamageType.MAGIC:
      case DamageType.UNBLOCKABLE:
        say('  Something shocks you!');
        break;
      case DamageType.WEAPON: say('  You feel pain!'); break;
      case DamageType.POISON: say('  You suddenly feel very ill for a moment...'); break;
      case DamageType.UNDEAD:
      case DamageType.DEMON:
        say('  A dark wind blows through you!');
        break;
      default: break;
    }
    if (amount < 0) return;
    await hitParty(this.univ, amount, damType);
  }

  /**
   * The DANGEROUS terrain branch of check_special_terrain
   * (boe.specials.cpp:390) — swamps, briar patches and the like. flag2 is a
   * per-PC percentage chance, flag3 names the status, flag1 its strength.
   *
   * Now that the PC status methods exist, each case hands off to the one the
   * C++ names, and they print their own transcript lines.
   *
   * TODO(M5): the party can't be harmed while flying or in a boat, which
   * needs those systems.
   */
  private dangerousTerrain(spec: Terrain): void {
    const strength = spec.flag1;
    for (const pc of this.univ.party.pcs) {
      if (pc.mainStatus !== MainStatus.ALIVE) continue;
      if (this.univ.rng.getRan(1, 1, 100) > spec.flag2) continue;
      switch (spec.flag3 as Status) {
        case Status.POISONED_WEAPON:
          // Nothing but atmosphere here in the original either.
          if (this.univ.rng.getRan(1, 1, 100) > 60)
            this.univ.addStringToBuf("It's eerie here...");
          break;
        case Status.BLESS_CURSE: pc.curse(strength); break;
        case Status.POISON:
          pc.poison(strength, this.univ.rng);
          this.sound?.play(17);
          break;
        case Status.HASTE_SLOW: pc.slow(strength); break;
        case Status.WEBS: pc.web(strength); break;
        case Status.DISEASE: pc.disease(strength, this.univ.rng); break;
        case Status.INVISIBLE:
          this.univ.addStringToBuf(strength < 0 ? 'You feel obscure.' : 'You feel exposed.');
          pc.applyStatus(Status.INVISIBLE, strength);
          break;
        case Status.DUMB: pc.dumbfound(strength, this.univ.rng); break;
        case Status.ASLEEP:
          pc.sleep(Status.ASLEEP, strength, Math.trunc(strength / 2), this.univ.rng);
          break;
        case Status.PARALYZED:
          pc.sleep(Status.PARALYZED, strength, Math.trunc(strength / 2), this.univ.rng);
          break;
        case Status.ACID: pc.acid(strength); break;
        case Status.FORCECAGE:
          // A cage can't hold you in the open.
          if (this.univ.isInTown())
            pc.sleep(Status.FORCECAGE, strength, Math.trunc(strength / 2), this.univ.rng);
          break;
        case Status.INVULNERABLE:
        case Status.MAGIC_RESISTANCE:
        case Status.MARTYRS_SHIELD:
          pc.applyStatus(spec.flag3 as Status, strength);
          break;
        default:
          // MAIN and CHARM are illegal here; the C++ ignores them too.
          break;
      }
    }
  }

  /**
   * Set by the host: called when the party walks into a locked door, so the UI
   * can raise the pick/bash prompt. Without a handler the door simply blocks.
   */
  onLockedDoor: ((where: Location, terrain: number) => void) | null = null;

  /** Set by the host: called when a TRAINING node needs its dialog. */
  onTrain: (() => void) | null = null;

  /**
   * Set by the host: called when a JOB_BANK node needs the job board
   * (`job-board.xml`). The personality is passed because a job taken from the
   * board records it as the job's source — see `takeJob`.
   */
  onJobBank: ((which: number, title: string, personality: number) => void) | null = null;

  /**
   * Set by the host: the "This creature isn't hostile. Attack anyway?" prompt
   * (`attack-friendly.xml`). Without a handler the swing is simply refused,
   * which is what Cancel does.
   */
  onConfirmAttackFriendly: (() => Promise<boolean>) | null = null;

  /**
   * Set by the host: `boat-bridge.xml`'s "go under, or land?" prompt when a
   * boat reaches a bridge. `true` means "go under" (the move is forced
   * through); `false` (including no handler) means "leave the boat".
   */
  onConfirmBoatBridge: (() => Promise<boolean>) | null = null;

  /**
   * Set by the host: `party-death.xml`'s "the whole party has died" prompt
   * (`handle_death`, boe.actions.cpp:3713). Fires once, the first time
   * `party.isAlive()` goes false *and stays false after fled PCs are given a
   * chance to come back* — see `checkPartyDeath`; `partyDead` latches so
   * upkeep ticking on a dead party doesn't fire it again. There's no
   * load/new-game flow to offer yet (that needs M7's save system), so the
   * host's only real option today is to freeze input and say what happened.
   */
  onPartyDeath: (() => void) | null = null;
  private partyDead = false;

  /**
   * `handle_party_death` (boe.actions.cpp:1431). `isAlive()` is `main_status
   * === ALIVE`, in this port and the original both — so a party that's
   * FLED, not dead, also reads as "not alive". The C++ handles that by
   * resetting every FLED PC back to ALIVE *first* and rechecking: if that
   * brings the party back, it's not death, it's a rout, and combat ends
   * instead (`end_town_mode`) — only if nobody comes back this way is it
   * really game over. Skipping this check is exactly the bug that made
   * fleeing an entire outdoor fight read as a party wipe.
   */
  private checkPartyDeath(): void {
    if (this.partyDead || this.univ.party.isAlive()) return;

    const fledPcs = this.univ.party.pcs.filter((pc) => pc.mainStatus === MainStatus.FLED);
    if (fledPcs.length > 0) {
      for (const pc of fledPcs) pc.mainStatus = MainStatus.ALIVE;
      if (this.univ.party.isAlive()) {
        if (this.mode === GameMode.COMBAT) {
          if (this.whichCombatType === 0) this.exitArenaCombat();
          else {
            const direction = endTownCombat(this);
            if (direction !== Direction.Here) {
              this.univ.party.direction = direction;
              this.mode = GameMode.TOWN;
              this.center = { ...this.univ.party.townLoc };
              this.updateExplored(this.univ.party.townLoc);
              this.univ.addStringToBuf('End combat.');
            }
          }
        }
        return;
      }
    }

    this.partyDead = true;
    // The latch is set now, but the *announcement* waits for the screen to
    // catch up. The C++ reaches `handle_party_death` from the main loop, by
    // which time every blocking blast and sleep in the blow that killed you
    // has already played; here the blast is still in the queue when the
    // damage resolves, so telling the player they are dead over the top of it
    // is the wrong order. Fire-and-forget, like the other chains launched
    // from a synchronous path — nothing here depends on the dialog.
    void animSettle().then(() => { this.onPartyDeath?.(); });
  }

  /**
   * force_town_enter — pin where the party lands before start_town_mode runs,
   * which is how a staircase drops you at a specific square.
   */
  forcedTownLoc: Location | null = null;

  forceTownEntry(townNum: number, where: Location): void {
    this.forcedTownLoc = { ...where };
  }

  /**
   * select_pc's candidate list (boe.items.cpp:878). `mode` mirrors the eSelectPC
   * values this port needs so far; `highlight` names a skill to show beside each
   * PC, the way the original does for "who will bash?".
   */
  selectPcOptions(mode: 'living' | 'lockpick' | 'train', highlight?: Skill): PcChoice[] {
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
      if (mode === 'train' && canPick) {
        // ONLY_CAN_TRAIN (boe.items.cpp:941): no skill points, no training.
        if (pc.skillPts > 0) {
          extra = `${pc.skillPts} skill point${pc.skillPts > 1 ? 's' : ''}`;
        } else {
          canPick = false;
          extra = 'no skill points';
        }
      }
      let label = pc.name;
      if (highlight !== undefined) label += ` (${pc.skills[highlight] ?? 0})`;
      if (extra) label += `: ${extra}`;
      return { index, label, canPick };
    });
  }

  /** Try to pick a locked door's lock with a given PC. */
  /** `is_unlockable` (boe.town.cpp:1147) — a lock is something to pick or bash. */
  isUnlockable(where: Location): boolean {
    const town = this.univ.town;
    if (!town || !town.isOnMap(where.x, where.y)) return false;
    const ter = town.record.terrain[where.x]![where.y]!;
    return this.univ.terrainType(ter).special === TerSpec.UNLOCKABLE;
  }

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
  async talkTo(destination: Location): Promise<boolean> {
    const town = this.univ.town;
    if (!town) return false;
    // handle_talk's own visibility gate, which is stricter than sight alone:
    // note it compares against 4, not SIGHT_BLOCKED.
    if (!town.isOnMap(destination.x, destination.y)
      || this.canSeeLight(this.center, destination) >= 4) {
      this.univ.addStringToBuf("  Can't see space.");
      return false;
    }
    const monst = town.monsterAt(destination);
    if (!monst) {
      this.univ.addStringToBuf('  Nobody there');
      return false;
    }
    // A creature can carry a HAIL special that runs first and, if it blocks,
    // stands in for the conversation entirely (boe.actions.cpp:830).
    if (monst.specialOnTalk >= 0) {
      const { blocked } = await this.runSpecial(
        SpecCtx.HAIL, SpecCtxType.TOWN, monst.specialOnTalk, monst.curLoc);
      if (blocked) return false;
    }
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
    this.talk.onTrain = () => this.onTrain?.();
    this.talk.onJobBank = (which, title) => this.onJobBank?.(which, title, personality);
    this.talk.onMakeTownHostile = () => makeTownHostile(this);
    this.talk.onCallSpecial = (node, scenario) => {
      const type = scenario ? SpecCtxType.SCEN : SpecCtxType.TOWN;
      void this.runSpecialRaw(SpecCtx.TALK, type, node, this.univ.party.townLoc).then((r) => {
        // In TALK mode a message node hands back string numbers instead of
        // showing a dialog (handle_message, boe.specials.cpp:4645).
        const strs = scenario
          ? this.univ.scenario.specStrs
          : this.univ.town?.record.specStrs ?? [];
        this.talk?.setReply(r.a, r.b, strs);
        this.onRedraw?.();
      });
    };
    this.talk.onRest = (length, hp, sp, wakeAt) => {
      doRest(this.univ, length, hp, sp, this.isOutdoors, this);
      this.univ.party.townLoc = { ...wakeAt };
      this.center = { ...wakeAt };
      this.updateExplored(this.center);
    };
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
  /**
   * Enter town combat, facing `direction` — the C++'s `start_town_combat` plus
   * the mode change `handle_action` does around it. `whichCombatType` is 1 for a
   * fight inside a town, which is all this port supports so far.
   */
  startCombat(direction: Direction): void {
    if (!this.univ.town) return;
    startTownCombat(this, direction);
    this.whichCombatType = 1;
    this.mode = GameMode.COMBAT;
    this.combatActivePc = NO_ONE;
    this.center = { ...this.univ.currentPc.combatPos };
  }

  /**
   * Leave combat and regroup. Returns false when the party can't — someone
   * caged apart from the rest — with the refusal already in the transcript.
   */
  endCombat(): boolean {
    if (this.mode !== GameMode.COMBAT) return false;
    if (this.whichCombatType === 0) return this.endOutdoorCombat();
    const direction = endTownCombat(this);
    if (direction === Direction.Here) return false;
    this.univ.party.direction = direction;
    this.mode = GameMode.TOWN;
    this.center = { ...this.univ.party.townLoc };
    this.updateExplored(this.univ.party.townLoc);
    return true;
  }

  /**
   * The turn between rounds: the monsters act, the clock ticks and statuses
   * decay, then the party gets a fresh set of moves.
   *
   * One round only — `afterCombatAction` owns the loop that decides whether
   * another is needed.
   */
  async startCombatRound(): Promise<void> {
    await combatRunMonst(this);
    setPcMoves(this.univ);
    // "The active character is unable to act!" — a PC pinned with X who is
    // asleep, paralysed or slowed to a standstill would otherwise burn the
    // whole party's moves every round, forever, with no way to notice or
    // undo it. The C++ releases the pin itself (boe.combat.cpp:1791).
    if (this.combatActivePc < NO_ONE
      && (this.univ.party.pcs[this.combatActivePc]?.ap ?? 0) === 0) {
      this.combatActivePc = NO_ONE;
      this.univ.addStringToBuf(
        'The active character is unable to act! The whole party is now active.');
    }
  }

  /**
   * char_parry (boe.combat.cpp) — spend the rest of the turn on defence. The
   * bonus scales with the action points given up, so parrying early is worth
   * more; `damagePc` and the to-hit rolls both read it.
   */
  parry(): boolean {
    if (this.mode !== GameMode.COMBAT) return false;
    const pc = this.univ.currentPc;
    if (pc.ap <= 0) return false;
    pc.parry = Math.trunc(pc.ap / 4)
      * (2 + pc.statAdj(Skill.DEXTERITY) + pc.skill(Skill.DEFENSE));
    pc.ap = 0;
    this.univ.addStringToBuf('Parry.');
    this.afterCombatAction();
    return true;
  }

  /**
   * handle_pause — "stand ready" in combat (parry 100, which also means the
   * to-hit bonus caps out), or a plain pause otherwise. Either way it's a turn
   * spent, and webs get torn at.
   */
  async pause(): Promise<void> {
    if (this.mode === GameMode.COMBAT) {
      const pc = this.univ.currentPc;
      pc.parry = 100;
      pc.ap = 0;
      this.univ.addStringToBuf('Stand ready.');
      if ((pc.status[Status.WEBS] ?? 0) > 0) {
        this.univ.addStringToBuf('You clean webs.');
        pc.status[Status.WEBS] = Math.max(0, (pc.status[Status.WEBS] ?? 0) - 2);
      }
      this.afterCombatAction();
      return;
    }
    this.univ.addStringToBuf('Pause.');
    for (const pc of this.univ.party.pcs) {
      if (!pc.isAlive || (pc.status[Status.WEBS] ?? 0) <= 0) continue;
      this.univ.addStringToBuf(`${pc.name} cleans webs.`);
      pc.status[Status.WEBS] = Math.max(0, (pc.status[Status.WEBS] ?? 0) - 2);
    }
    this.pauseVehicles();
    await this.afterPartyTurn();
  }

  /**
   * The vehicle half of handle_pause (boe.actions.cpp:630-676): a horse
   * always dismounts; a boat only dismounts onto passable ground, and
   * re-boards on a second pause if you're still standing on it (which is how
   * you get stranded and un-stranded on a single-tile passable patch of
   * water).
   */
  private pauseVehicles(): void {
    const { party } = this.univ;
    if (party.inHorse >= 0) {
      const horse = party.horses[party.inHorse]!;
      if (this.isOutdoors) {
        horse.whichTown = TOWN_NUM_OUTDOORS;
        horse.loc = party.globalToLocal(party.outLoc);
        horse.sector = { x: party.outdoorCorner.x + party.iwc.x, y: party.outdoorCorner.y + party.iwc.y };
      } else if (this.inTown) {
        horse.loc = { ...party.townLoc };
        horse.whichTown = party.townNum;
      }
      party.inHorse = -1;
    }
    if (party.inBoat >= 0) {
      const boat = party.boats[party.inBoat]!;
      if (this.isOutdoors && !blocksMove(this.univ.terrainType(this.univ.out.at(party.outLoc.x, party.outLoc.y)))) {
        boat.whichTown = TOWN_NUM_OUTDOORS;
        boat.loc = party.globalToLocal(party.outLoc);
        boat.sector = { x: party.outdoorCorner.x + party.iwc.x, y: party.outdoorCorner.y + party.iwc.y };
        party.inBoat = -1;
      } else if (
        this.inTown && this.univ.town
        && !blocksMove(this.univ.terrainType(this.univ.town.record.terrain[party.townLoc.x]![party.townLoc.y]!))
      ) {
        boat.loc = { ...party.townLoc };
        boat.whichTown = party.townNum;
        party.inBoat = -1;
      }
    } else {
      // The above could leave you stranded in a single-tile passable area, so
      // pausing again should re-enter the boat.
      let boat: Vehicle | null = null;
      if (this.isOutdoors) boat = this.outVehicleAt(party.boats, party.outLoc);
      else if (this.inTown) boat = this.townVehicleAt(party.boats, party.townLoc);
      if (boat) {
        party.inBoat = party.boats.indexOf(boat);
        this.univ.addStringToBuf('You board the boat.');
      }
    }
  }

  /**
   * handle_toggle_active — pin the turn to one PC so they can act repeatedly,
   * or release it back to the whole party.
   */
  toggleActivePc(): void {
    if (this.mode !== GameMode.COMBAT) return;
    if (this.combatActivePc === NO_ONE) {
      this.univ.addStringToBuf('This PC now active.');
      this.combatActivePc = this.univ.curPc;
    } else {
      this.univ.addStringToBuf("All PC's now active.");
      this.univ.curPc = this.combatActivePc;
      this.combatActivePc = NO_ONE;
    }
  }

  /**
   * `prime_time` (boe.actions.cpp:295) — the game is in one of the three modes
   * where the party is free to act, rather than mid-conversation or mid-shop.
   */
  get primeTime(): boolean {
    return this.mode === GameMode.OUTDOORS || this.mode === GameMode.TOWN
      || this.mode === GameMode.COMBAT;
  }

  /**
   * handle_switch_pc (boe.actions.cpp:1012) — clicking a name in the party
   * stats list makes that PC the active one.
   *
   * In combat this costs nothing but needs the PC to have action points left;
   * out of combat they only have to be alive and present.
   */
  switchPc(which: number): void {
    const pc = this.univ.party.pcs[which];
    if (!pc) return;
    if (!this.primeTime && this.mode !== GameMode.SHOPPING
      && this.mode !== GameMode.TALKING) {
      this.univ.addStringToBuf('Set active: Finish what you are doing first.');
      return;
    }
    if (isCombat(this.mode)) {
      if (pc.ap > 0) {
        this.univ.curPc = which;
        this.center = { ...pc.combatPos };
      } else this.univ.addStringToBuf('Set active: PC has no APs.');
      return;
    }
    if (pc.mainStatus !== MainStatus.ALIVE) {
      this.univ.addStringToBuf('Set active: PC must be here & active.');
      return;
    }
    this.univ.curPc = which;
    this.univ.addStringToBuf(
      `${this.mode === GameMode.SHOPPING ? 'Now shopping' : 'Now active'}: ${pc.name}`);
  }

  /**
   * `current_switch` — who the player picked first for a trade-places. 6 is the
   * C++'s "nobody yet", and `increase_age` resets it every turn.
   */
  currentSwitch = NO_ONE;

  /**
   * switch_pc (boe.actions.cpp:3619) — trade two PCs' places in the marching
   * order. The first click names one, the second names the other.
   */
  tradePlaces(which: number): void {
    if (!this.primeTime) {
      this.univ.addStringToBuf('Trade places: Finish what you are doing first.');
      return;
    }
    if (isCombat(this.mode)) {
      this.univ.addStringToBuf("Trade places: Can't do this in combat.");
      return;
    }
    if (this.currentSwitch < NO_ONE) {
      if (this.currentSwitch !== which) {
        this.univ.addStringToBuf('Switch: OK.');
        this.univ.party.swapPcs(which, this.currentSwitch);
        if (this.univ.curPc === this.currentSwitch) this.univ.curPc = which;
        else if (this.univ.curPc === which) this.univ.curPc = this.currentSwitch;
      } else this.univ.addStringToBuf('Switch: Not with self.');
      this.currentSwitch = NO_ONE;
      return;
    }
    this.univ.addStringToBuf('Switch: Switch with who?');
    this.currentSwitch = which;
  }

  /** handle_print_pc_hp / handle_print_pc_sp — the two read-outs. */
  printPcHp(which: number): void {
    const pc = this.univ.party.pcs[which];
    if (!pc) return;
    this.univ.addStringToBuf(`${pc.name} has ${pc.curHealth} health out of ${pc.maxHealth}.`);
  }

  printPcSp(which: number): void {
    const pc = this.univ.party.pcs[which];
    if (!pc) return;
    this.univ.addStringToBuf(`${pc.name} has ${pc.curSp} spell points out of ${pc.maxSp}.`);
  }

  /**
   * handle_missile / load_missile — arm the current PC's missile and switch to
   * FIRING or THROWING, which is a targeting mode: the next click on the
   * terrain is the shot. Returns false (with the refusal in the transcript)
   * when there's nothing to shoot with.
   */
  startMissile(): boolean {
    if (this.mode !== GameMode.COMBAT) {
      this.univ.addStringToBuf('Shoot: Only in combat.');
      return false;
    }
    const loaded = loadMissile(this.univ);
    if (!isLoaded(loaded)) {
      this.univ.addStringToBuf(loaded.message);
      return false;
    }
    this.missile = loaded;
    this.mode = loaded.mode;
    this.univ.addStringToBuf(
      loaded.mode === GameMode.THROWING ? 'Throw: Select a target.' : 'Fire: Select a target.');
    this.univ.addStringToBuf("  (Hit 's' to cancel.)");
    return true;
  }

  /** Back out of targeting without spending the turn. */
  cancelMissile(): void {
    if (this.missile === null) return;
    this.missile = null;
    this.mode = GameMode.COMBAT;
  }

  /**
   * Loose the armed missile at `where`. The mode goes back to COMBAT either
   * way — a shot that was out of range or out of sight has still been aimed,
   * which is what the C++ does when `fire_missile` returns.
   */
  async fireMissileAt(where: Location): Promise<boolean> {
    const loaded = this.missile;
    if (loaded === null) return false;
    this.missile = null;
    this.mode = GameMode.COMBAT;
    await fireMissile(this, loaded, where);
    this.afterCombatAction();
    return true;
  }

  /**
   * The current PC swings at whatever is on `where`. Returns false when there's
   * nothing there to hit.
   */
  async attackAt(where: Location): Promise<boolean> {
    const target = this.univ.town?.monsterAt(where) ?? null;
    if (!target) return false;
    await pcAttack(this.univ, this.univ.curPc, target, this);
    this.afterCombatAction();
    return true;
  }

  /**
   * After anything that spends action points: hand over to the next PC, and
   * when nobody has moves left start a new round.
   *
   * `combat_run_monst` is what happens between rounds — the monsters act, then
   * everyone gets fresh moves. Public because it's the equivalent of the
   * C++'s `advance_time`-driven `combat_next_step` call, which runs after
   * *every* action including ones this class doesn't itself perform — casting
   * a spell is a free function (`combatCastSpell`/`doCombatCast` in
   * spellCombat.ts/spellCombatTarget.ts) that takes AP and has to be able to
   * trigger the same turn advance, or the caster never runs out of AP.
   */
  afterCombatAction(): void {
    // combat_next_step opens by reconciling the cage barriers with the
    // FORCECAGE statuses — on *every* step, not only when the round rolls
    // over, so someone who just walked into one is caught straight away.
    syncForceCages(this);

    const storePc = this.univ.curPc;
    // `pick_next_pc` is always called at least once, even when the current PC
    // still has moves: it is also what burns everyone else's AP while one PC
    // is pinned active, which the old `ap > 0` early-out skipped.
    if (!pickNextPc(this.univ, this.combatActivePc)) {
      this.finishCombatStep(storePc);
      return;
    }

    this.queueTurn(async () => {
      // `while(pick_next_pc()) { combat_run_monst(); set_pc_moves(); ... }`
      // (boe.combat.cpp:1789). The **loop** matters: if nobody can act after
      // the monsters have gone, the monsters go again. Running it once — as
      // this port did — deadlocks a party that has no moves to come back to,
      // and `setPcMoves` hands out zero AP to a slowed PC on every odd
      // `party.age`, so a fully-slowed party simply froze on odd rounds.
      do {
        await this.startCombatRound();
        // The C++'s own safety valve, and with a real loop it is load-bearing:
        // a dead party never regains AP, so this is what ends the round.
        if (!this.univ.party.isAlive()) break;
      } while (pickNextPc(this.univ, this.combatActivePc));
      pickNextPc(this.univ, this.combatActivePc);
      this.finishCombatStep(storePc);
    });
  }

  /**
   * combat_next_step's tail: recentre on whoever is up, and say so. The
   * `Active:` line is the only thing that tells the player the turn moved on
   * and how much the new PC can do with it — printed only when the party is
   * *not* pinned to one PC, and only when the turn actually changed hands.
   */
  private finishCombatStep(storePc: number): void {
    this.center = { ...this.univ.currentPc.combatPos };
    if (this.combatActivePc === NO_ONE && this.univ.curPc !== storePc) {
      const pc = this.univ.currentPc;
      this.univ.addStringToBuf(
        `Active: ${pc.name} (#${this.univ.curPc + 1}, ${pc.ap} ap.)`);
    }
    this.onRedraw?.();
    this.checkPartyDeath();
  }

  /**
   * pc_combat_move (boe.combat.cpp:216) — one square for the current PC, which
   * may instead be an attack, a swap with another PC, or a refusal. One action
   * point for a move, four for a swing.
   *
   * TODO(M5b): monsters adjacent to the square you're leaving get a free
   * back-shot, which needs monster_attack.
   */
  async combatMove(destination: Location): Promise<boolean> {
    const town = this.univ.town;
    const pc = this.univ.currentPc;
    if (this.mode !== GameMode.COMBAT || !town) return false;
    if (pc.ap <= 0) return false;

    const monstHit = town.monsterAt(destination);
    if (!monstHit && (pc.status[Status.FORCECAGE] ?? 0) > 0) {
      this.univ.addStringToBuf("Move: Can't escape.");
      this.univ.addStringToBuf('  (Try doing something else.)');
      return false;
    }
    if (!monstHit && !this.checkSpecialTerrain(destination)) return false;

    const dir = setDirection(pc.combatPos, destination);
    if (this.locOffActiveArea(destination) && this.whichCombatType === 1
      && !this.townIsBlocked(destination)) {
      this.univ.addStringToBuf("Move: Can't leave town during combat.");
      return true;
    }
    // pc_combat_move (boe.combat.cpp:242): terrain 90 marks the edge of an
    // outdoor arena. Stepping onto it is a 30% roll to flee — the acting PC
    // leaves the fight and loses their remaining AP; a failed roll still
    // costs 1 AP as if they'd tried to bolt and been dragged back. Only
    // arena combat (whichCombatType === 0) has this border; town fights use
    // the "can't leave town" refusal above instead.
    if (town.record.terrain[destination.x]?.[destination.y] === 90 && this.whichCombatType === 0) {
      if (this.univ.rng.getRan(1, 1, 10) < 3) {
        pc.mainStatus = MainStatus.FLED;
        if (this.combatActivePc === this.univ.curPc) this.combatActivePc = NO_ONE;
        pc.ap = 0;
        this.univ.addStringToBuf('Moved: Fled.');
      } else {
        takeAp(this.univ, 1);
        this.univ.addStringToBuf("Moved: Couldn't flee.");
      }
      this.afterCombatAction();
      return true;
    }

    if (monstHit) {
      // Swinging at someone who isn't hostile asks first (the "attack-friendly"
      // dialog), and going through with it turns the whole town on you.
      let doAttack = !monstHit.isFriendly;
      if (!doAttack) doAttack = (await this.onConfirmAttackFriendly?.()) ?? false;
      if (doAttack) {
        if (monstHit.isFriendly) makeTownHostile(this);
        pc.lastAttacked = monstHit;
        await pcAttack(this.univ, this.univ.curPc, monstHit, this);
        this.afterCombatAction();
        return true;
      }
      return false;
    }

    // Another PC on the square: swap places, at a cost to both.
    const other = this.univ.party.pcs.find(
      (p) => p !== pc && p.isAlive && locsEqual(p.combatPos, destination));
    if (other) {
      if (other.ap === 0) {
        this.univ.addStringToBuf("Move: Can't switch places.");
        this.univ.addStringToBuf('  (other PC has no APs)');
        return false;
      }
      other.ap--;
      this.univ.addStringToBuf('Move: Switch places.');
      const storeLoc = { ...pc.combatPos };
      pc.combatPos = { ...destination };
      other.combatPos = storeLoc;
      pc.direction = dir;
      takeAp(this.univ, 1);
      this.moveSound(town.record.terrain[destination.x]![destination.y]!, pc.ap);
      this.afterCombatAction();
      return true;
    }

    if (this.townIsBlocked(destination)) {
      this.univ.addStringToBuf(`Blocked: ${DIRECTION_NAMES[dir] ?? ''}`);
      return false;
    }

    pc.combatPos = { ...destination };
    pc.direction = dir;
    takeAp(this.univ, 1);
    this.univ.addStringToBuf(`Moved: ${DIRECTION_NAMES[dir] ?? ''}`);
    this.moveSound(town.record.terrain[destination.x]![destination.y]!, pc.ap);
    this.updateExplored(destination);
    this.center = { ...destination };
    this.afterCombatAction();
    return true;
  }

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

    // "check horses"/"check boats" (boe.town.cpp:503): a vehicle the party's
    // own list has lost track of (an older save missing a vehicle the
    // scenario since gained) is restored from the scenario's template.
    const { party, scenario } = this.univ;
    for (let i = 0; i < party.boats.length; i++) {
      const template = scenario.boats[i];
      if (template && template.whichTown >= 0 && template.loc.x >= 0 && !party.boats[i]!.exists) {
        party.boats[i] = { ...template, exists: true };
      }
    }
    for (let i = 0; i < party.horses.length; i++) {
      const template = scenario.horses[i];
      if (template && template.whichTown >= 0 && template.loc.x >= 0 && !party.horses[i]!.exists) {
        party.horses[i] = { ...template, exists: true };
      }
    }

    // handle_town_specials: the town's entry node fires once we're inside.
    if (record.specOnEntry >= 0)
      void this.runSpecial(
        SpecCtx.ENTER_TOWN, SpecCtxType.TOWN, record.specOnEntry, this.univ.party.townLoc);

    // A staircase or an OUT_FORCE_TOWN node can pin the arrival square.
    const forced = this.forcedTownLoc;
    this.forcedTownLoc = null;
    const start =
      entryDir < 4 ? record.startLocs[entryDir]! : { x: -1, y: -1 };
    let where = forced ?? start;
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

  /** sight_obscurity (boe.locutils.cpp:179). */
  sightObscurity = (x: number, y: number): number => {
    let store = this.getBlockage(this.coordToTer(x, y));
    const town = this.univ.town;
    if (!town) return store;
    if (town.isSpecialSpot(x, y)) store++;
    // A web is half-transparent; a barrier blocks sight outright; a crate,
    // barrel or block is one step of cover.
    if (town.hasField(x, y, FieldType.FIELD_WEB)) store += 2;
    if (town.hasField(x, y, FieldType.BARRIER_FIRE)
      || town.hasField(x, y, FieldType.BARRIER_FORCE)) return SIGHT_BLOCKED;
    if (town.hasField(x, y, FieldType.OBJECT_CRATE)
      || town.hasField(x, y, FieldType.OBJECT_BARREL)
      || town.hasField(x, y, FieldType.OBJECT_BLOCK)) store++;
    return store;
  };

  /**
   * combat_obscurity (boe.locutils.cpp:204) — the stricter obscurity the
   * *placement* code uses: anything that blocks movement, and lava, count as
   * fully blocking whether or not you can see over them. `place_party` and
   * `find_clear_spot` draw their lines with this, which is what stops a PC
   * being dropped on the far side of a wall.
   */
  combatObscurity = (x: number, y: number): number => {
    const ter = this.coordToTer(x, y);
    if (blocksMove(this.univ.terrainType(ter))) return SIGHT_BLOCKED;
    // is_lava (boe.locutils.cpp:164) is hardcoded against the picture number
    // in the C++ too, with its own "TODO: Don't hardcode this!".
    if (this.univ.terrainType(ter).picture === 964) return SIGHT_BLOCKED;
    return this.sightObscurity(x, y);
  };

  /**
   * combat_pt_in_light (boe.locutils.cpp:486) — the combat twin of
   * `pt_in_light`: a square is lit if *any* living PC is within the light
   * radius of it, rather than the party as a whole. An outdoor arena
   * (`whichCombatType === 0`) is always lit.
   */
  combatPtInLight(to: Location): boolean {
    const town = this.univ.town;
    if (!town) return true;
    if (town.record.lightingType === Lighting.LIGHT_NORMAL || this.whichCombatType === 0)
      return true;
    if (!town.isOnMap(to.x, to.y)) return true;
    if (town.isLit(to.x, to.y)) return true;
    const rad = this.lightRadius();
    return this.univ.party.pcs.some((pc) => pc.isAlive && dist(pc.combatPos, to) <= rad);
  }

  /**
   * party_can_see (boe.locutils.cpp:519) — whether a space is visible at all.
   * Returns the C++'s 1-or-6, where 6 means "no"; in combat it returns *which*
   * PC can see it, which is why the caller only ever compares against 6.
   *
   * Three genuinely different branches, and the differences matter:
   * - Outdoors and in town the line is drawn from the party's own square.
   * - **In town the on-screen test is waived once the view has been scrolled
   *   away from the party** (`center != univ.party.town_loc`), which is what
   *   lets the pointing arrows show you something the party can see but that
   *   isn't in the 9x9 window.
   * - In combat there is no on-screen test at all, and the line is drawn from
   *   each PC in turn — so a scout standing forward reveals ground for
   *   everyone.
   */
  partyCanSee(where: Location): number {
    if (this.isOutdoors) {
      const from = this.univ.party.outLoc;
      return pointOnScreen(from, where) && this.canSeeLight(from, where) < SIGHT_BLOCKED
        ? 1 : 6;
    }
    if (!isCombat(this.mode)) {
      const from = this.univ.party.townLoc;
      const onScreen = pointOnScreen(from, where) || !locsEqual(this.center, from);
      return onScreen && this.ptInLight(from, where)
        && this.canSeeLight(from, where) < SIGHT_BLOCKED ? 1 : 6;
    }
    // Combat: light first, since a dark square is invisible to everyone.
    if (this.whichCombatType !== 0 && !this.combatPtInLight(where)) return 6;
    for (let i = 0; i < this.univ.party.pcs.length; i++) {
      const pc = this.univ.party.pcs[i]!;
      if (!pc.isAlive) continue;
      if (canSee(pc.combatPos, where, this.sightObscurity) < SIGHT_BLOCKED) return i;
    }
    return 6;
  }

  /**
   * party_can_see_monst (boe.locutils.cpp:366) — a big creature is visible if
   * any one of the squares it stands on is.
   */
  partyCanSeeMonst(monst: Creature): boolean {
    for (let i = 0; i < monst.xWidth; i++)
      for (let j = 0; j < monst.yWidth; j++)
        if (this.partyCanSee({ x: monst.curLoc.x + i, y: monst.curLoc.y + j }) < 6) return true;
    return false;
  }

  /**
   * can_see_light (boe.locutils.cpp:173). The obscurity function is an
   * argument in the C++ too: most callers pass `sight_obscurity`, but the
   * placement code passes the stricter `combat_obscurity`.
   */
  canSeeLight(
    from: Location, to: Location,
    getObscurity: (x: number, y: number) => number = this.sightObscurity,
  ): number {
    // The C++ asks combat_pt_in_light in combat (any PC's own light reaches
    // the square) and pt_in_light in town (the party's does).
    if (isCombat(this.mode)) {
      if (!this.combatPtInLight(to)) return SIGHT_BLOCKED + 1;
    } else if (this.worldIsTown && !this.ptInLight(from, to)) return SIGHT_BLOCKED + 1;
    return canSee(from, to, getObscurity);
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
      const monst = assignCreature(
        i, preset, template, this.univ.party.easyMode, this.univ.difficultyAdjust());

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
   * TODO(M6): store_item_rects restores player-dropped stock.
   */
  private placePresetItems(town: CurTown): void {
    town.items = [];
    const presets = town.record.presetItems;
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i]!;
      if (preset.code < 0) continue;
      const template = this.univ.scenario.scenItems[preset.code];
      if (!template) continue;
      // Don't put back a special item the party is already carrying, or a quest
      // it has already taken — the three tests in the C++'s source order.
      if (template.variety === ItemType.SPECIAL
        && this.univ.party.specItems.has(template.itemLevel)) continue;
      if (template.variety === ItemType.QUEST) {
        const job = this.univ.party.activeQuests.get(template.itemLevel);
        if (job && job.status !== QuestStatus.AVAILABLE) continue;
      }
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
    return this.monstCanBeAt(m, m.curLoc);
  }

  /**
   * monst_can_be_there (boe.locutils.cpp) — could this creature stand with its
   * top-left corner on `where`? Every square it covers has to be on the map and
   * clear, and nothing else may already be standing there.
   */
  monstCanBeAt(m: Creature, where: Location): boolean {
    const town = this.univ.town;
    if (!town) return false;
    for (let i = 0; i < m.xWidth; i++)
      for (let j = 0; j < m.yWidth; j++) {
        const x = where.x + i;
        const y = where.y + j;
        const at = loc(x, y);
        if (this.locOffActiveArea(at)) return false;
        // is_blocked already covers terrain, the party, PCs, barriers and
        // cages; the only thing it gets wrong here is this creature itself.
        const other = town.monsterAt(at);
        if (other && other !== m) return false;
        if (!other && this.isBlocked(at)) return false;
        if (other === m && this.townIsBlocked(at)) return false;
      }
    return true;
  }

  /**
   * end_town_mode (boe.town.cpp:536). Which boundary the party crossed picks
   * the outdoor exit; a town with no explicit exit for that side just steps
   * the party one tile further out.
   */
  endTownMode(destination: Location): Location {
    const { party } = this.univ;
    const town = this.univ.town!;
    const rect = town.record.inTownRect;
    let toReturn = { ...party.outLoc };

    // exits[] is indexed N, W, S, E (from the "nwse" dirs string).
    const applyExit = (idx: number, fallback: Location, nudge: Location): void => {
      const exit = town.record.exits[idx]!;
      toReturn = exit.x > 0 ? party.localToGlobal(exit) : fallback;
      party.outLoc = { x: toReturn.x + nudge.x, y: toReturn.y + nudge.y };
      // handle_leave_town_specials: the exit this side of the town uses.
      if (exit.spec >= 0)
        void this.runSpecial(SpecCtx.LEAVE_TOWN, SpecCtxType.TOWN, exit.spec, destination);
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

    // A party timer started by a TOWN_TIMER_START node dies with the town
    // (boe.town.cpp:590) — its node number indexes a list that's about to go
    // away. Scenario-level ones survive.
    party.partyEventTimers = party.partyEventTimers.filter(
      (t) => t.nodeType !== SpecCtxType.TOWN);

    this.mode = GameMode.OUTDOORS;
    this.univ.addStringToBuf(`You leave ${town.record.name}.`);
    this.univ.town = null;
    party.townNum = TOWN_NUM_OUTDOORS;
    // applyExit has already put the party one step *inside* the exit square;
    // the caller then walks it out onto `toReturn`, which is what makes the
    // party appear at the town's gate rather than wherever it happened to be
    // standing on the world map (boe.town.cpp:608).
    party.outLoc = clampToWindow(party.outLoc);
    party.iwc = { x: party.outLoc.x > 47 ? 1 : 0, y: party.outLoc.y > 47 ? 1 : 0 };
    party.locInSec = party.globalToLocal(party.outLoc);
    this.center = { ...party.outLoc };
    this.updateExplored(party.outLoc);
    return clampToWindow(toReturn);
  }

  // ------------------------------------------------------------------ maps

  /**
   * update_explored (boe.locutils.cpp:230) — reveal what the party can see
   * from `where`: the 9x9 block around it, minus anything sight-blocked.
   */
  /**
   * loc_off_act_area — outside the town's playable rectangle. Note the
   * comparisons are strict, so the border row and column count as off it.
   */
  locOffActiveArea(where: Location): boolean {
    const rect = this.univ.town?.record.inTownRect;
    if (!rect) return false;
    return !(where.x > rect.left && where.x < rect.right
      && where.y > rect.top && where.y < rect.bottom);
  }

  updateExplored(where: Location): void {
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
