/**
 * The OUTDOOR opcode group — outdoor_spec (boe.specials.cpp:4555). Only four
 * nodes, and all of them no-op unless the party is actually outdoors.
 */

import { SpecType } from '../../data/special';
import { Universe } from '../../universe/universe';
import { SpecialCtx } from './context';
import { reportUnsupported } from './general';
import { createWandMonst, placeOutdWandMonst } from '../wandering';
import { handleMessage } from './vm';

export async function outdoorSpec(univ: Universe, ctx: SpecialCtx): Promise<void> {
  const spec = ctx.curSpec;
  let checkMess = false;
  ctx.nextSpec = spec.jumpto;

  if (univ.isInTown()) return;

  switch (spec.type) {
    case SpecType.OUT_MOVE_PARTY:
      checkMess = true;
      // The coordinates are sector-local; the party position is window-global.
      ctx.host.moveParty(univ.party.localToGlobal({ x: spec.ex1a, y: spec.ex1b }));
      ctx.redraw = true;
      ctx.retA = 1;
      break;

    case SpecType.OUT_FORCE_TOWN: {
      const townNum = spec.ex1a;
      const town = univ.scenario.towns[townNum];
      if (!town) {
        univ.addStringToBuf(
          `The scenario attempted to put the party in a nonexistent town: ${townNum}`);
        break;
      }
      // A valid forced position wins; otherwise ex1b is a compass direction
      // that maps to an entrance the way find_direction_from does.
      const where = { x: spec.ex2a, y: spec.ex2b };
      const inside = where.x >= 0 && where.y >= 0
        && where.x < town.maxDim && where.y < town.maxDim;
      let entry: number;
      if (inside) entry = 9;
      else if (spec.ex1b === 0) entry = 2;
      else if (spec.ex1b === 4) entry = 0;
      else if (spec.ex1b < 4) entry = 3;
      else entry = 1;
      ctx.host.changeLevel(townNum, entry === 9 ? where : { x: -1, y: -1 });
      ctx.nextSpec = -1;
      break;
    }

    case SpecType.OUT_MAKE_WANDER:
      // Roll one of this sector's wandering groups into the world, wherever
      // its wandering points are — the same call the every-tenth-turn roll
      // makes, so the group has to walk to the party before anything happens.
      createWandMonst(ctx.session);
      ctx.redraw = true;
      break;

    case SpecType.OUT_PLACE_ENCOUNTER: {
      // ex1a picks one of the sector's four *special* encounters and drops it
      // on the party's own square, `forced` — which is what makes it start a
      // fight on the next turn wherever the party is standing.
      const which = spec.ex1a;
      if (which < 0 || which > 3) {
        univ.addStringToBuf('Special outdoor enc. is out of range. Must be 0-3.');
        break;
      }
      const group = univ.out.sectorAt(univ.party.outLoc).specialEnc[which];
      if (group) {
        placeOutdWandMonst(ctx.session, univ.party.locInSec, group, 1);
        checkMess = true;
      }
      break;
    }

    default:
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
}
