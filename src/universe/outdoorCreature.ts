/**
 * `cParty::cOutdoorCreature` (party.hpp) — a wandering encounter roaming the
 * outdoor map. Ten of these hang off the party, and each one carries a whole
 * encounter definition rather than a single monster: when the party bumps into
 * it, the group is unpacked into an arena full of creatures.
 */

import { Location, loc } from '../core/location';
import { OutWandering, emptyOutWandering } from '../data/outdoors';

export class OutdoorCreature {
  /** Whether this slot holds a group at all. */
  exists = false;
  /** eDirection it is facing, which picks the sprite. */
  direction = 0;
  /** The encounter it will turn into. */
  whatMonst: OutWandering = emptyOutWandering();
  /** Which of the window's four sectors it was spawned in (i_w_c). */
  whichSector: Location = loc(0, 0);
  /** Where it stands, in the 96×96 outdoor window's coordinates. */
  mLoc: Location = loc(0, 0);
}
