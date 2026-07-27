/**
 * cVehicle (scenario/vehicle.hpp) — a boat or a horse. Both kinds use the
 * same shape; the scenario keeps one template list per kind (`Scenario.boats`
 * / `Scenario.horses`), and the party's own copies (`Party.boats` /
 * `Party.horses`) are what actually move and get boarded.
 */

import { Location, loc } from '../core/location';

export interface Vehicle {
  loc: Location;
  /** Sector coordinates, only meaningful while `whichTown === TOWN_NUM_OUTDOORS`. */
  sector: Location;
  /** -1 = doesn't exist yet, 200 = outdoors, else a town index. */
  whichTown: number;
  exists: boolean;
  /** True means "not the party's" — boarding it is refused. */
  property: boolean;
  pic: number;
  name: string;
}

export function makeVehicle(): Vehicle {
  return {
    loc: loc(0, 0),
    sector: loc(0, 0),
    whichTown: -1,
    exists: false,
    property: false,
    pic: 0,
    name: '',
  };
}

/**
 * `std::vector::resize(n)` as `loadOutMapData`/`loadTownMapData` use it:
 * grows with fresh vehicles, but also *truncates* if `n` is smaller than the
 * current length. A scenario whose vehicle numbers aren't in map-scan order
 * would lose the tail entries this way in the original too — kept faithful
 * rather than "fixed" into a resize-to-at-least.
 */
export function resizeVehicles(list: Vehicle[], n: number): void {
  if (list.length > n) {
    list.length = n;
    return;
  }
  while (list.length < n) list.push(makeVehicle());
}
