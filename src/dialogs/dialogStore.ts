/**
 * `ResMgr::dialogs` — the 211 dialog definitions in `data/dialogs`, parsed once
 * and looked up by name.
 *
 * They're registered up front like the string tables, because the code that
 * opens a dialog is written the way the C++ writes it (`cDialog(*ResMgr::
 * dialogs.get("pc-info"))`) — a synchronous lookup, not an await.
 */

import { parseXmlDoc } from '../fileio/xml';
import { DialogDef, readDialogDef } from './dialogXml';

const defs = new Map<string, DialogDef>();

export function setDialogDef(name: string, def: DialogDef): void {
  defs.set(name, def);
}

/** Parse one definition and register it under `name` (the file's basename). */
export async function addDialogDef(name: string, xml: string): Promise<DialogDef> {
  const def = readDialogDef(await parseXmlDoc(xml, `${name}.xml`));
  defs.set(name, def);
  return def;
}

/** `ResMgr::dialogs.get` — throws when a name isn't registered, as it does. */
export function getDialogDef(name: string): DialogDef {
  const def = defs.get(name);
  if (!def) throw new Error(`no dialog definition named "${name}"`);
  return def;
}

export function hasDialogDef(name: string): boolean {
  return defs.has(name);
}

/**
 * Load a list of definitions. The player needs perhaps sixty of the 211, so
 * the caller names the ones it wants rather than paying for all of them at
 * startup.
 */
export async function loadDialogDefs(
  fetchText: (url: string) => Promise<string>,
  names: string[],
): Promise<void> {
  await Promise.all(names.map(async (name) => {
    await addDialogDef(name, await fetchText(`/data/dialogs/${name}.xml`));
  }));
}
