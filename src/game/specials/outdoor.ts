/**
 * The OUTDOOR opcode group — outdoor_spec (boe.specials.cpp:4555). Only four
 * nodes, and all of them no-op unless the party is actually outdoors.
 */

import { SpecType } from '../../data/special';
import { Universe } from '../../universe/universe';
import { SpecialCtx } from './context';
import { reportUnsupported } from './general';
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
    case SpecType.OUT_PLACE_ENCOUNTER:
      // TODO(M5): wandering monsters and outdoor encounters need combat.
      reportUnsupported(univ, spec.type);
      break;

    default:
      reportUnsupported(univ, spec.type);
      break;
  }

  if (checkMess) await handleMessage(univ, ctx);
}
