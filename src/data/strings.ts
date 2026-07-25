/**
 * String resources — the get_str(file, n) lookups the C++ makes against the
 * text files in data/strings (ref: get_str in tools/strings.cpp). Each file is
 * one string per line and the index is **1-based**, matching the C++.
 *
 * Tables are registered up front (loadStringTables below, or setStrings in
 * tests) because the code that needs them — shop stock, spell names — is
 * synchronous.
 */

const tables = new Map<string, string[]>();

export function setStrings(name: string, text: string): void {
  // Trailing newline would otherwise add a phantom entry.
  tables.set(name, text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n'));
}

export function hasStrings(name: string): boolean {
  return tables.has(name);
}

/** get_str — 1-based line lookup; missing entries give an empty string. */
export function getStr(name: string, index: number): string {
  return tables.get(name)?.[index - 1] ?? '';
}

/** Every table the game player reads. */
export const STRING_TABLES = [
  'magic-names',
  'skills',
  'mage-spells',
  'priest-spells',
  'alchemy',
  'item-types-display',
  'shop-specials',
];

export async function loadStringTables(
  fetchText: (url: string) => Promise<string>,
  names: string[] = STRING_TABLES,
): Promise<void> {
  await Promise.all(
    names.map(async (name) => setStrings(name, await fetchText(`/data/strings/${name}.txt`))),
  );
}
