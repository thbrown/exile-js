/**
 * Line of sight — can_see (utility.cpp:19). Walks the tiles strictly between
 * two points and sums their obscurity; a total of 5 or more means "can't see".
 * The stepping is the original's integer DDA, kept verbatim because which
 * tiles a diagonal line touches is observable in play.
 */

import { Location } from './location';

/** Sight is blocked once accumulated obscurity reaches this. */
export const SIGHT_BLOCKED = 5;

export type ObscurityFn = (x: number, y: number) => number;

export function canSee(p1: Location, p2: Location, obscurity: ObscurityFn): number {
  let storage = 0;

  if (p1.y === p2.y) {
    if (p1.x > p2.x) for (let c = p2.x + 1; c < p1.x; c++) storage += obscurity(c, p1.y);
    else for (let c = p1.x + 1; c < p2.x; c++) storage += obscurity(c, p1.y);
    return storage;
  }
  if (p1.x === p2.x) {
    if (p1.y > p2.y) for (let c = p1.y - 1; c > p2.y; c--) storage += obscurity(p1.x, c);
    else for (let c = p1.y + 1; c < p2.y; c++) storage += obscurity(p1.x, c);
    return storage;
  }

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  // Integer division truncates toward zero in C++, which Math.trunc matches.
  const div = (a: number, b: number): number => Math.trunc(a / b);

  if (Math.abs(dy) > Math.abs(dx)) {
    if (p2.y > p1.y)
      for (let c = 1; c < dy; c++) storage += obscurity(p1.x + div(c * dx, dy), p1.y + c);
    else for (let c = -1; c > dy; c--) storage += obscurity(p1.x + div(c * dx, dy), p1.y + c);
  }
  if (Math.abs(dy) <= Math.abs(dx)) {
    if (p2.x > p1.x)
      for (let c = 1; c < dx; c++) storage += obscurity(p1.x + c, p1.y + div(c * dy, dx));
    else for (let c = -1; c > dx; c--) storage += obscurity(p1.x + c, p1.y + div(c * dy, dx));
  }
  return storage;
}
