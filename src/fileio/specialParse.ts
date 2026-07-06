/**
 * Parser for the .spec special-node script format.
 * Port of ../exile-wasm/src/fileio/special_parse.cpp (line-oriented grammar):
 *
 *   def SYMBOL = INT          # constant definition (file-global)
 *   @opcode [= NODE_INDEX]    # starts a node block
 *       sdf  a, b             # -> sd1, sd2
 *       msg  a, b, c          # -> m1, m2, m3
 *       pic  a, b             # -> pic, pictype
 *       ex1  a, b, c          # -> ex1a, ex1b, ex1c
 *       ex2  a, b, c          # -> ex2a, ex2b, ex2c
 *       goto a                # -> jumpto
 *
 * Values are integers or def'd symbols. `#` starts a comment. Without
 * `= N`, a block gets the previous index + 1 (starting at 0).
 *
 * Opcode names come from the specials-opcodes strings resource: line N
 * (1-based) is the opcode for SpecType N (get_str in utility.cpp is 1-based).
 */

import { SpecType, SpecialNode, emptySpecialNode } from '../data/special';

export class SpecParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly file: string,
  ) {
    super(`${message} (in ${file}@${line})`);
  }
}

/** Build opcode-name → SpecType from the specials-opcodes.txt contents. */
export function buildOpcodeTable(stringsText: string): Map<string, SpecType> {
  const table = new Map<string, SpecType>();
  // NONE is special-cased in node_properties_t::opcode() (special.cpp:590)
  table.set('nop', SpecType.NONE);
  const lines = stringsText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]!.trim();
    const type = i + 1; // 1-based string indexing
    if (name !== '' && type in SpecType) table.set(name, type as SpecType);
  }
  return table;
}

const SYMBOL_RE = /^[A-Za-z$_-]+$/;
const INT_RE = /^[+-]?[0-9]+$/;

// field keyword -> [slot names in order]
const FIELD_SLOTS: Record<string, (keyof SpecialNode)[]> = {
  sdf: ['sd1', 'sd2'],
  pic: ['pic', 'pictype'],
  msg: ['m1', 'm2', 'm3'],
  ex1: ['ex1a', 'ex1b', 'ex1c'],
  ex2: ['ex2a', 'ex2b', 'ex2c'],
  goto: ['jumpto'],
};

export function parseSpecials(
  code: string,
  opcodes: Map<string, SpecType>,
  context = '',
): Map<number, SpecialNode> {
  const specials = new Map<number, SpecialNode>();
  const defs = new Map<string, number>();
  let curNode = -1;
  let cur: SpecialNode | null = null;

  const commit = (): void => {
    if (cur) specials.set(curNode, cur);
  };

  const resolveValue = (tok: string, lineno: number): number => {
    if (INT_RE.test(tok)) return parseInt(tok, 10);
    if (SYMBOL_RE.test(tok)) {
      const v = defs.get(tok);
      if (v !== undefined) return v;
    }
    throw new SpecParseError(
      `Expected value (integer or known symbol) but found '${tok}'`,
      lineno,
      context,
    );
  };

  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineno = i + 1;
    let line = lines[i]!;
    const hash = line.indexOf('#');
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (line === '') continue;

    if (line.startsWith('@')) {
      commit();
      const m = /^@([A-Za-z$_-]+)\s*(?:=\s*([+-]?[0-9]+))?$/.exec(line);
      if (!m) throw new SpecParseError(`Malformed node header '${line}'`, lineno, context);
      const type = opcodes.get(m[1]!);
      if (type === undefined)
        throw new SpecParseError(`Expected opcode but found '${m[1]}'`, lineno, context);
      curNode = m[2] !== undefined ? parseInt(m[2], 10) : curNode + 1;
      cur = emptySpecialNode();
      cur.type = type;
      continue;
    }

    // Keywords are literal tokens in the C++ grammar (str_p), so match them
    // explicitly — note ex1/ex2 contain digits and are not valid symbols.
    const m = /^(def|sdf|pic|msg|ex1|ex2|goto)\s+(.*)$/.exec(line);
    if (!m)
      throw new SpecParseError(`Unable to parse special node line '${line}'`, lineno, context);
    const keyword = m[1]!;
    const rest = m[2]!;

    if (keyword === 'def') {
      const dm = /^([A-Za-z$_-]+)\s*=\s*([+-]?[0-9]+)$/.exec(rest);
      if (!dm) throw new SpecParseError(`Malformed def line '${line}'`, lineno, context);
      const sym = dm[1]!;
      if (defs.has(sym))
        throw new SpecParseError(`Redefinition of symbol '${sym}'`, lineno, context);
      defs.set(sym, parseInt(dm[2]!, 10));
      continue;
    }

    const slots = FIELD_SLOTS[keyword];
    if (!slots)
      throw new SpecParseError(
        `Expected one of ['sdf', 'msg', 'pic', 'ex1', 'ex2', 'goto'] but found '${keyword}'`,
        lineno,
        context,
      );
    if (!cur)
      throw new SpecParseError(`Field line before any @opcode block`, lineno, context);
    const values = rest.split(',').map((s) => s.trim());
    if (values.length > slots.length)
      throw new SpecParseError(`Expected end of line but found '${values[slots.length]}'`, lineno, context);
    for (let v = 0; v < values.length; v++) {
      (cur[slots[v]!] as number) = resolveValue(values[v]!, lineno);
    }
  }
  commit();
  return specials;
}
