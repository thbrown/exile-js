/**
 * The RECT opcode group — rect_spec (boe.specials.cpp:4415). Every node here
 * sweeps a rectangle (ex1a,ex1b)-(ex2a,ex2b) and does the same thing to each
 * square. A non-zero `pic` means "the border only", which is how scenarios
 * wall off an area without filling it in.
 */

import { FieldType } from '../../data/fields';
import { ItemType } from '../../data/item';
import { SpecType } from '../../data/special';
import { TerSpec } from '../../data/terrain';
import { Universe } from '../../universe/universe';
import { SpecialCtx } from './context';
import { alterSpace, reportUnsupported } from './general';
import { handleMessage } from './vm';

export async function rectSpec(univ: Universe, ctx: SpecialCtx): Promise<void> {
  const spec = ctx.curSpec;
  const town = univ.town;
  ctx.nextSpec = spec.jumpto;
  ctx.redraw = true;

  const terrainAt = (x: number, y: number): number | undefined =>
    (town ? town.record.terrain[x]?.[y] : univ.out.at(x, y));

  // Note the loop order: i runs the y range, j the x range, as in the C++.
  for (let i = spec.ex1b; i <= spec.ex2b; i++) {
    for (let j = spec.ex1a; j <= spec.ex2a; j++) {
      // Border only: skip anything strictly inside.
      if (spec.pic > 0 && i > spec.ex1b && i < spec.ex2b && j > spec.ex1a && j < spec.ex2a)
        continue;
      const x = i;
      const y = j;

      switch (spec.type) {
        case SpecType.RECT_CHANGE_TER:
          // sd2 is a percentage chance per square.
          if (univ.rng.getRan(1, 1, 100) <= spec.sd2) alterSpace(univ, x, y, spec.sd1);
          break;

        case SpecType.RECT_SWAP_TER: {
          const at = terrainAt(x, y);
          if (at === spec.sd1) alterSpace(univ, x, y, spec.sd2);
          else if (at === spec.sd2) alterSpace(univ, x, y, spec.sd1);
          break;
        }

        case SpecType.RECT_TRANS_TER: {
          const at = terrainAt(x, y);
          if (at === undefined) break;
          const to = univ.scenario.terTypes[at]?.transToWhat ?? -1;
          if (to >= 0) alterSpace(univ, x, y, to);
          break;
        }

        case SpecType.RECT_LOCK:
        case SpecType.RECT_UNLOCK: {
          const at = terrainAt(x, y);
          if (at === undefined) break;
          const info = univ.scenario.terTypes[at];
          const wanted = spec.type === SpecType.RECT_LOCK
            ? TerSpec.LOCKABLE : TerSpec.UNLOCKABLE;
          if (info?.special === wanted) alterSpace(univ, x, y, info.flag1);
          break;
        }

        case SpecType.RECT_SET_EXPLORED:
          if (town) {
            if (spec.sd1) town.makeExplored(x, y);
            else town.takeExplored(x, y);
          } else if (univ.out.explored[x]?.[y] !== undefined) {
            univ.out.explored[x]![y] = spec.sd1 ? 1 : 0;
          }
          break;

        case SpecType.RECT_DESTROY_ITEMS:
          if (!town) return;
          for (const item of town.items)
            if (item.variety !== ItemType.NO_ITEM
              && item.itemLoc.x === x && item.itemLoc.y === y)
              item.variety = ItemType.NO_ITEM;
          break;

        case SpecType.RECT_MOVE_ITEMS:
          if (!town) return;
          for (const item of town.items) {
            if (item.variety === ItemType.NO_ITEM) continue;
            if (item.itemLoc.x !== x || item.itemLoc.y !== y) continue;
            // Items inside a container only come along if pictype says so.
            if (item.contained && spec.pictype <= 0) continue;
            item.itemLoc = { x: spec.sd1, y: spec.sd2 };
          }
          break;

        case SpecType.RECT_PLACE_FIELD: {
          if (!town) return;
          const field = spec.sd2 as FieldType;
          // sd1 is a percentage chance per square; a dispel always applies.
          if (field !== FieldType.FIELD_DISPEL && univ.rng.getRan(1, 1, 100) > spec.sd1) break;
          if (field === FieldType.FIELD_DISPEL) {
            // sd1 0 clears the ordinary fields, anything else the barriers too.
            town.dispelFields(x, y, spec.sd1 !== 0);
          } else if (field === FieldType.SPECIAL_EXPLORED
            || field === FieldType.SPECIAL_SPOT || field === FieldType.SPECIAL_ROAD) {
            // Not placeable.
          } else if (field === FieldType.FIELD_SMASH) {
            // TODO(M5): crumble_wall turns a wall square into its rubble.
            reportUnsupported(univ, spec.type);
          } else {
            town.setField(x, y, field, true);
          }
          break;
        }

        default:
          reportUnsupported(univ, spec.type);
          return;
      }
    }
  }

  await handleMessage(univ, ctx);
}
