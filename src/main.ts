/**
 * M0 demo: draw every tile of the terrain sheets in a grid, proving the
 * asset pipeline and gfxsheets tile math work end to end.
 */

import { SheetStore, TILES_PER_ROW, TILE_H, TILE_W } from './render/sheets';

const SHEETS = ['ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim'];

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const status = document.getElementById('status')!;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const store = new SheetStore();
  const images = await Promise.all(SHEETS.map((s) => store.load(s)));

  const pad = 8;
  const sheetRows = images.map((img) => Math.ceil(img.height / TILE_H));
  canvas.width = TILES_PER_ROW * TILE_W;
  canvas.height = sheetRows.reduce((a, r) => a + r * TILE_H + pad, 0);

  let y = 0;
  images.forEach((img, s) => {
    const name = SHEETS[s]!;
    const cells = Math.floor(img.width / TILE_W) * Math.floor(img.height / TILE_H);
    // Sheets are 10 tiles wide already, so re-drawing cell by cell exercises
    // the same source-rect math the game will use.
    for (let cell = 0; cell < cells; cell++) {
      const dx = (cell % TILES_PER_ROW) * TILE_W;
      const dy = y + Math.floor(cell / TILES_PER_ROW) * TILE_H;
      store.drawTile(ctx, name, cell, dx, dy);
    }
    y += sheetRows[s]! * TILE_H + pad;
  });

  status.textContent = `Loaded ${SHEETS.length} sheets (${SHEETS.join(', ')}).`;
}

main().catch((err) => {
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
