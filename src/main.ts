/**
 * M1 demo: outdoor walkabout. Loads Valley of Dying Things, renders a
 * viewport of the outdoor world, and moves the party with arrow keys
 * (blockage-aware, crossing sector boundaries).
 */

import { Direction, shiftLoc } from './core/location';
import { SECTOR_SIZE } from './data/outdoors';
import { Scenario } from './data/scenario';
import { blocksMove } from './data/terrain';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { FetchSource } from './fileio/source';
import { SheetStore, TILE_H, TILE_W } from './render/sheets';
import { terrainGraphic } from './render/terrainPics';

const VIEW_TILES_X = 21;
const VIEW_TILES_Y = 15;

interface WorldPos {
  // global outdoor coordinates: gx = sector.x*48 + local x
  gx: number;
  gy: number;
}

class Walkabout {
  private animFrame = 0;

  constructor(
    private scen: Scenario,
    private store: SheetStore,
    private ctx: CanvasRenderingContext2D,
    private party: WorldPos,
  ) {}

  terrainAt(gx: number, gy: number): number | null {
    const sx = Math.floor(gx / SECTOR_SIZE);
    const sy = Math.floor(gy / SECTOR_SIZE);
    if (sx < 0 || sy < 0 || sx >= this.scen.outWidth || sy >= this.scen.outHeight) return null;
    return this.scen.outdoors[sx]![sy]!.terrain[gx - sx * SECTOR_SIZE]![gy - sy * SECTOR_SIZE]!;
  }

  tryMove(dir: Direction): void {
    const next = shiftLoc({ x: this.party.gx, y: this.party.gy }, dir);
    const ter = this.terrainAt(next.x, next.y);
    if (ter === null) return;
    if (blocksMove(this.scen.terTypes[ter]!)) return;
    this.party.gx = next.x;
    this.party.gy = next.y;
    this.draw();
  }

  draw(): void {
    const dbg = { drawn: 0, nullTer: 0, noGraphic: 0, noSheet: 0 };
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const left = this.party.gx - Math.floor(VIEW_TILES_X / 2);
    const top = this.party.gy - Math.floor(VIEW_TILES_Y / 2);
    for (let vy = 0; vy < VIEW_TILES_Y; vy++) {
      for (let vx = 0; vx < VIEW_TILES_X; vx++) {
        const ter = this.terrainAt(left + vx, top + vy);
        if (ter === null) {
          dbg.nullTer++;
          continue;
        }
        const pic = this.scen.terTypes[ter]!.picture;
        const g = terrainGraphic(pic, this.animFrame);
        if (!g) {
          dbg.noGraphic++;
          continue;
        }
        const img = this.store.get(g.sheetName);
        if (!img) {
          dbg.noSheet++;
          continue;
        }
        dbg.drawn++;
        ctx.drawImage(
          img,
          g.rect.left,
          g.rect.top,
          g.rect.width,
          g.rect.height,
          vx * TILE_W,
          vy * TILE_H,
          TILE_W,
          TILE_H,
        );
      }
    }
    // Party token: first PC graphic from the pcs sheet
    const px = Math.floor(VIEW_TILES_X / 2) * TILE_W;
    const py = Math.floor(VIEW_TILES_Y / 2) * TILE_H;
    const pcs = this.store.get('pcs');
    if (pcs) ctx.drawImage(pcs, 0, 0, TILE_W, TILE_H, px, py, TILE_W, TILE_H);

    (window as unknown as Record<string, unknown>)['__drawDebug'] = dbg;
    const sx = Math.floor(this.party.gx / SECTOR_SIZE);
    const sy = Math.floor(this.party.gy / SECTOR_SIZE);
    const sector = this.scen.outdoors[sx]![sy]!;
    document.getElementById('status')!.textContent =
      `${this.scen.title} — ${sector.name} (sector ${sx},${sy}) at ` +
      `(${this.party.gx % SECTOR_SIZE},${this.party.gy % SECTOR_SIZE})`;
  }

  tick(): void {
    this.animFrame++;
    this.draw();
  }
}

const KEY_DIRS: Record<string, Direction> = {
  ArrowUp: Direction.N,
  ArrowDown: Direction.S,
  ArrowLeft: Direction.W,
  ArrowRight: Direction.E,
  Home: Direction.NW,
  PageUp: Direction.NE,
  End: Direction.SW,
  PageDown: Direction.SE,
};

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const status = document.getElementById('status')!;
  canvas.width = VIEW_TILES_X * TILE_W;
  canvas.height = VIEW_TILES_Y * TILE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  status.textContent = 'Loading scenario…';
  const opcodes = await loadOpcodes(async (url) => (await fetch(url)).text());
  const scen = await loadScenario(new FetchSource('/scenarios/valleydy/'), opcodes);

  const store = new SheetStore();
  await Promise.all(
    ['ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim', 'pcs'].map((s) => store.load(s)),
  );

  const start: WorldPos = {
    gx: scen.outdoorStart.x * SECTOR_SIZE + scen.sectorStart.x,
    gy: scen.outdoorStart.y * SECTOR_SIZE + scen.sectorStart.y,
  };
  const game = new Walkabout(scen, store, ctx, start);
  game.draw();

  window.addEventListener('keydown', (ev) => {
    const dir = KEY_DIRS[ev.key];
    if (dir !== undefined) {
      ev.preventDefault();
      game.tryMove(dir);
    }
  });
  setInterval(() => game.tick(), 250); // terrain animation

  document.querySelector('h1')!.textContent = 'exile-js — M1 outdoor walkabout';
}

main().catch((err) => {
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
