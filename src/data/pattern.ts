/**
 * Spell patterns — `eSpellPat` and `cPattern`'s builtin tables (pattern.hpp /
 * pattern.cpp).
 *
 * A pattern is a 9×9 grid laid over the map with its centre on the target
 * square. What the numbers *mean* depends on how `placeSpellPattern` is called:
 *
 * - Called with a field type, `modifyPattern` first overwrites every non-zero
 *   cell with that type, so the shape decides *where* and the argument decides
 *   *what*.
 * - Called with a damage type and a dice count, the same happens with the
 *   encoded value `50 + type * 40 + dice`.
 * - Called with neither, the cells are read as they stand. `PAT_PROT` is the
 *   one builtin that relies on this: its cells are field-type numbers
 *   (1 = WALL_FORCE, 5 = WALL_ICE, 6 = WALL_BLADES, 3 = FIELD_ANTIMAGIC), so
 *   it raises a layered ring of different walls in one go.
 *
 * `X` is the C++'s 0xffff — "a cell of the shape", meaningless on its own.
 * Placed without modification it lands in no branch of either switch and does
 * nothing, which is exactly what the C++ does with it.
 */

/** eSpellPat (pattern.hpp:14) — the shape an effect covers. */
export enum SpellPat {
  SINGLE = 0,
  SQUARE = 1,
  SMALL_SQUARE = 2,
  OPEN_SQUARE = 3,
  RADIUS_2 = 4,
  RADIUS_3 = 5,
  PLUS = 6,
  WALL = 7,
  /** PAT_WALL + 8 — the eight wall rotations sit in between. */
  PROT = 15,
  CUSTOM = 16,
  CURRENT = -1,
}

/** A 9×9 pattern grid, indexed `[x][y]` as the C++ indexes it. */
export type EffectPattern = number[][];

/** 0xffff — a cell of the shape, with no meaning until `modifyPattern` runs. */
export const X = 0xffff;

/**
 * The tables are copied out of pattern.cpp line for line, so they can be
 * diffed against it directly.
 *
 * **Each written line is a column, not a row.** `place_spell_pattern` reads
 * `pat[i - center.x + 4][j - center.y + 4]`, so the *outer* index is the x
 * offset and the inner one is y — which makes the literal below the transpose
 * of the shape as it appears on the map. Every builtin but `PAT_WALL` is
 * symmetric, so this only actually shows up in which wall rotation is which:
 * rotation 0 lays a horizontal band, rotation 2 a vertical one.
 */
function pat(columns: number[][]): EffectPattern {
  return columns.map((col) => [...col]);
}

const P_SINGLE = pat([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, X, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

const P_SQ = pat([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

const P_SMSQ = pat([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, X, X, 0, 0, 0],
  [0, 0, 0, 0, X, X, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

const P_OPENSQ = pat([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, X, 0, X, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

const P_RAD2 = pat([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, X, X, X, X, X, 0, 0],
  [0, 0, X, X, X, X, X, 0, 0],
  [0, 0, X, X, X, X, X, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

const P_RAD3 = pat([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, X, X, X, X, X, 0, 0],
  [0, X, X, X, X, X, X, X, 0],
  [0, X, X, X, X, X, X, X, 0],
  [0, X, X, X, X, X, X, X, 0],
  [0, 0, X, X, X, X, X, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

const P_CROSS = pat([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, X, 0, 0, 0, 0],
  [0, 0, 0, X, X, X, 0, 0, 0],
  [0, 0, 0, 0, X, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

/** The eight rotations of the 2×8 wall, in the C++'s order. */
const P_WALL: EffectPattern[] = [
  pat([
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
  ]),
  pat([
    [0, 0, 0, 0, 0, 0, 0, 0, X],
    [0, 0, 0, 0, 0, 0, 0, X, X],
    [0, 0, 0, 0, 0, 0, X, X, 0],
    [0, 0, 0, 0, 0, X, X, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, X, X, 0, 0, 0, 0, 0],
    [0, X, X, 0, 0, 0, 0, 0, 0],
    [X, X, 0, 0, 0, 0, 0, 0, 0],
  ]),
  pat([
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [X, X, X, X, X, X, X, X, X],
    [X, X, X, X, X, X, X, X, X],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ]),
  pat([
    [X, 0, 0, 0, 0, 0, 0, 0, 0],
    [X, X, 0, 0, 0, 0, 0, 0, 0],
    [0, X, X, 0, 0, 0, 0, 0, 0],
    [0, 0, X, X, 0, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, 0, X, X, 0, 0],
    [0, 0, 0, 0, 0, 0, X, X, 0],
    [0, 0, 0, 0, 0, 0, 0, X, X],
  ]),
  pat([
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
  ]),
  pat([
    [0, 0, 0, 0, 0, 0, 0, X, X],
    [0, 0, 0, 0, 0, 0, X, X, 0],
    [0, 0, 0, 0, 0, X, X, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, X, X, 0, 0, 0, 0, 0],
    [0, X, X, 0, 0, 0, 0, 0, 0],
    [X, X, 0, 0, 0, 0, 0, 0, 0],
    [X, 0, 0, 0, 0, 0, 0, 0, 0],
  ]),
  pat([
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [X, X, X, X, X, X, X, X, X],
    [X, X, X, X, X, X, X, X, X],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ]),
  pat([
    [X, X, 0, 0, 0, 0, 0, 0, 0],
    [0, X, X, 0, 0, 0, 0, 0, 0],
    [0, 0, X, X, 0, 0, 0, 0, 0],
    [0, 0, 0, X, X, 0, 0, 0, 0],
    [0, 0, 0, 0, X, X, 0, 0, 0],
    [0, 0, 0, 0, 0, X, X, 0, 0],
    [0, 0, 0, 0, 0, 0, X, X, 0],
    [0, 0, 0, 0, 0, 0, 0, X, X],
    [0, 0, 0, 0, 0, 0, 0, 0, X],
  ]),
];

/**
 * The protective circle. Unlike every other builtin its cells are field-type
 * numbers rather than X, so it is always placed unmodified: an outer ring of
 * force walls (1), then ice (5), then blades (6), around an antimagic core (3).
 */
const P_PROT = pat([
  [0, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 5, 5, 5, 5, 5, 5, 5, 1],
  [1, 5, 6, 6, 6, 6, 6, 5, 1],
  [1, 5, 6, 3, 3, 3, 6, 5, 1],
  [1, 5, 6, 3, 3, 3, 6, 5, 1],
  [1, 5, 6, 3, 3, 3, 6, 5, 1],
  [1, 5, 6, 6, 6, 6, 6, 5, 1],
  [1, 5, 5, 5, 5, 5, 5, 5, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 0],
]);

const BUILTIN: Partial<Record<SpellPat, EffectPattern>> = {
  [SpellPat.SINGLE]: P_SINGLE,
  [SpellPat.SQUARE]: P_SQ,
  [SpellPat.SMALL_SQUARE]: P_SMSQ,
  [SpellPat.OPEN_SQUARE]: P_OPENSQ,
  [SpellPat.RADIUS_2]: P_RAD2,
  [SpellPat.RADIUS_3]: P_RAD3,
  [SpellPat.PLUS]: P_CROSS,
  [SpellPat.PROT]: P_PROT,
};

/** An all-zero pattern — cPattern::get_builtin's "Null pattern" fallback. */
export function emptyPattern(): EffectPattern {
  return Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
}

/**
 * cPattern::get_builtin. Only PAT_WALL is rotatable, and its rotation wraps
 * (`rot % patterns.size()`) rather than clamping.
 */
export function getBuiltinPattern(pat: SpellPat, rot = 0): EffectPattern {
  if (pat === SpellPat.WALL) {
    const n = P_WALL.length;
    return P_WALL[((rot % n) + n) % n]!;
  }
  return BUILTIN[pat] ?? emptyPattern();
}

/** A private copy, since `placeSpellPattern` rewrites the grid it is given. */
export function copyPattern(pat: EffectPattern): EffectPattern {
  return pat.map((col) => [...col]);
}
