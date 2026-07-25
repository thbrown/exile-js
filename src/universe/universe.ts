/**
 * cUniverse (universe/universe.hpp:185) — all mutable game state in one
 * object rather than C++ globals, so tests and replays can construct an
 * isolated world and inject a seeded RNG.
 */

import { GameRng } from '../core/rng';
import { Scenario } from '../data/scenario';
import { Town } from '../data/town';
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
