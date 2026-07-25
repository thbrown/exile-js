/**
 * Entry point: load a scenario, build the universe, and run the game loop on
 * the classic 605x430 screen.
 */

import { GameRng } from './core/rng';
import { GameSession } from './game/session';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { FetchSource } from './fileio/source';
import { InputRouter } from './platform/input';
import { BOE_HEIGHT, BOE_WIDTH, ToolbarButton } from './render/layout';
import { CHROME_SHEETS, Screen } from './render/screen';
import { SheetStore } from './render/sheets';
import { PartyPreset } from './universe/player';
import { Universe } from './universe/universe';

/** Terrain animation ticks at 4 Hz, matching the C++ animation timer. */
const ANIM_INTERVAL_MS = 250;

const DEFAULT_SCENARIO = 'valleydy';

function scenarioFromQuery(): string {
  const q = new URLSearchParams(window.location.search).get('scenario');
  return q && /^[a-z0-9_-]+$/i.test(q) ? q : DEFAULT_SCENARIO;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const status = document.getElementById('status')!;
  canvas.width = BOE_WIDTH;
  canvas.height = BOE_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const name = scenarioFromQuery();
  status.textContent = `Loading ${name}…`;
  const opcodes = await loadOpcodes(async (url) => (await fetch(url)).text());
  const scen = await loadScenario(new FetchSource(`/scenarios/${name}/`), opcodes);

  const store = new SheetStore();
  const sheets = [...CHROME_SHEETS, 'ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim'];
  for (let i = 1; i <= 11; i++) sheets.push(`monst${i}`);
  await Promise.all(sheets.map((s) => store.load(s)));
  // The bundled fonts must be ready before the first paint, or the panels
  // measure and lay out text with fallback metrics.
  if (document.fonts) await document.fonts.ready;

  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  session.startNewGame();
  const screen = new Screen(ctx, store);

  const redraw = (): void => screen.draw(session);

  const router = new InputRouter(canvas, {
    onMove: (dir) => {
      session.move(dir);
      redraw();
    },
    onClick: (x, y) => {
      const btn = screen.buttonAt(x, y);
      if (btn) {
        // TODO(M3+): wire the toolbar to real actions.
        univ.addStringToBuf(`(${ToolbarButton[btn.btn]} is not implemented yet)`);
        redraw();
        return;
      }
      const cell = screen.terrainCellAt(x, y);
      if (cell) {
        // Clicking the view moves one step toward the clicked tile.
        const dx = Math.sign(cell.q - 4);
        const dy = Math.sign(cell.r - 4);
        if (dx !== 0 || dy !== 0) {
          const from = session.inTown ? univ.party.townLoc : univ.party.outLoc;
          session.moveTo({ x: from.x + dx, y: from.y + dy });
          redraw();
        }
      }
    },
    onKey: () => {
      /* TODO(M3): keyboard shortcuts for the toolbar actions */
    },
  });
  router.attach();

  status.textContent = `${scen.title} — arrow keys or Home/End/PgUp/PgDn to move.`;
  redraw();
  setInterval(() => {
    screen.animFrame++;
    redraw();
  }, ANIM_INTERVAL_MS);

  // Handles for headless verification and manual debugging.
  Object.assign(window as unknown as Record<string, unknown>, {
    __session: session,
    __univ: univ,
    __screen: screen,
    __scen: scen,
    __redraw: redraw,
  });
}

main().catch((err) => {
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
