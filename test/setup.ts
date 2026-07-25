/**
 * Vitest global setup: register the string resources. The game reads these
 * synchronously (shop stock names, spell names), so they have to be in place
 * before any scenario is parsed — main.ts does the same with loadStringTables.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STRING_TABLES, setStrings } from '../src/data/strings';

for (const name of STRING_TABLES) {
  setStrings(
    name,
    readFileSync(fileURLToPath(new URL(`../public/data/strings/${name}.txt`, import.meta.url)), 'utf8'),
  );
}
