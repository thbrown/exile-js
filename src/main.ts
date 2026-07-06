/**
 * M1/M2 demo: outdoor walkabout + town entry. Loads Valley of Dying
 * Things; arrow keys move the party. Walking onto a town entrance enters
 * the town (NPCs drawn); walking past the town bounds leaves it.
 */

import { Direction, shiftLoc } from './core/location';
import { SECTOR_SIZE } from './data/outdoors';
import { Scenario } from './data/scenario';
import { blocksMove } from './data/terrain';
import { MonstTime } from './data/monster';
import { Town } from './data/town';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { FetchSource } from './fileio/source';
import { monsterGraphic, monsterDims } from './render/monsterPics';
import { SheetStore, TILE_H, TILE_W } from './render/sheets';
import { terrainGraphic } from './render/terrainPics';

const VIEW_TILES_X = 21;
const VIEW_TILES_Y = 15;

type Mode = 'outdoors' | 'town';

class Demo {
  private animFrame = 0;
  mode: Mode = 'outdoors';
  townNum = -1;
  townPos = { x: 0, y: 0 };
  outPos: { gx: number; gy: number };

  constructor(
    private scen: Scenario,
    private store: SheetStore,
    private ctx: CanvasRenderingContext2D,
    start: { gx: number; gy: number },
  ) {
    this.outPos = start;
  }

  private get town(): Town | null {
    return this.mode === 'town' ? (this.scen.towns[this.townNum] ?? null) : null;
  }

  terrainAtOut(gx: number, gy: number): number | null {
    const sx = Math.floor(gx / SECTOR_SIZE);
    const sy = Math.floor(gy / SECTOR_SIZE);
    if (sx < 0 || sy < 0 || sx >= this.scen.outWidth || sy >= this.scen.outHeight) return null;
    return this.scen.outdoors[sx]![sy]!.terrain[gx - sx * SECTOR_SIZE]![gy - sy * SECTOR_SIZE]!;
  }

  tryMove(dir: Direction): void {
    if (this.mode === 'outdoors') this.moveOutdoors(dir);
    else this.moveInTown(dir);
    this.draw();
  }

  private moveOutdoors(dir: Direction): void {
    const next = shiftLoc({ x: this.outPos.gx, y: this.outPos.gy }, dir);
    const ter = this.terrainAtOut(next.x, next.y);
    if (ter === null || blocksMove(this.scen.terTypes[ter]!)) return;
    this.outPos = { gx: next.x, gy: next.y };
    // Town entrance? (city_locs carry the town number in .spec)
    const sx = Math.floor(next.x / SECTOR_SIZE);
    const sy = Math.floor(next.y / SECTOR_SIZE);
    const lx = next.x - sx * SECTOR_SIZE;
    const ly = next.y - sy * SECTOR_SIZE;
    const city = this.scen.outdoors[sx]![sy]!.cityLocs.find((c) => c.x === lx && c.y === ly);
    if (city && this.scen.towns[city.spec]) this.enterTown(city.spec, dir);
  }

  private enterTown(num: number, dir: Direction): void {
    const town = this.scen.towns[num]!;
    // start_locs are S/W/N/E of the town; entering while moving N means
    // arriving at the south entrance, etc. (start_town_mode, boe.town.cpp)
    const entrance = { [Direction.N]: 0, [Direction.W]: 3, [Direction.S]: 2, [Direction.E]: 1 }[
      dir as number
    ];
    let start = entrance !== undefined ? town.startLocs[entrance]! : { x: -1, y: -1 };
    if (start.x < 0) start = town.startLocs.find((l) => l.x >= 0) ?? {
      x: Math.floor(town.maxDim / 2),
      y: Math.floor(town.maxDim / 2),
    };
    this.mode = 'town';
    this.townNum = num;
    this.townPos = { ...start };
  }

  private moveInTown(dir: Direction): void {
    const town = this.town!;
    const next = shiftLoc(this.townPos, dir);
    const r = town.inTownRect;
    if (next.x < r.left || next.x > r.right || next.y < r.top || next.y > r.bottom) {
      this.mode = 'outdoors'; // stepped out of bounds -> back to the world map
      this.townNum = -1;
      return;
    }
    const ter = town.terrain[next.x]?.[next.y];
    if (ter === undefined || blocksMove(this.scen.terTypes[ter]!)) return;
    this.townPos = next;
  }

  private drawTile(pic: number, vx: number, vy: number): void {
    const g = terrainGraphic(pic, this.animFrame);
    if (!g) return;
    const img = this.store.get(g.sheetName);
    if (!img) return;
    this.ctx.drawImage(
      img,
      g.rect.left, g.rect.top, g.rect.width, g.rect.height,
      vx * TILE_W, vy * TILE_H, TILE_W, TILE_H,
    );
  }

  private drawMonster(pic: number, vx: number, vy: number): void {
    const { w, h } = monsterDims(pic);
    for (let part = 0; part < w * h; part++) {
      const g = monsterGraphic(pic, 0, part);
      if (!g) continue;
      const img = this.store.get(g.sheetName);
      if (!img) continue;
      const px = part % w;
      const py = Math.floor(part / w);
      this.ctx.drawImage(
        img,
        g.rect.left, g.rect.top, g.rect.width, g.rect.height,
        (vx + px) * TILE_W, (vy + py) * TILE_H, TILE_W, TILE_H,
      );
    }
  }

  draw(): void {
    const { ctx } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (this.mode === 'outdoors') this.drawOutdoors();
    else this.drawTown();
  }

  private drawOutdoors(): void {
    const left = this.outPos.gx - Math.floor(VIEW_TILES_X / 2);
    const top = this.outPos.gy - Math.floor(VIEW_TILES_Y / 2);
    for (let vy = 0; vy < VIEW_TILES_Y; vy++)
      for (let vx = 0; vx < VIEW_TILES_X; vx++) {
        const ter = this.terrainAtOut(left + vx, top + vy);
        if (ter !== null) this.drawTile(this.scen.terTypes[ter]!.picture, vx, vy);
      }
    this.drawParty();
    const sx = Math.floor(this.outPos.gx / SECTOR_SIZE);
    const sy = Math.floor(this.outPos.gy / SECTOR_SIZE);
    this.setStatus(
      `${this.scen.outdoors[sx]![sy]!.name} (sector ${sx},${sy}) at ` +
        `(${this.outPos.gx % SECTOR_SIZE},${this.outPos.gy % SECTOR_SIZE}) — walk onto a town to enter it`,
    );
  }

  private drawTown(): void {
    const town = this.town!;
    const left = this.townPos.x - Math.floor(VIEW_TILES_X / 2);
    const top = this.townPos.y - Math.floor(VIEW_TILES_Y / 2);
    for (let vy = 0; vy < VIEW_TILES_Y; vy++)
      for (let vx = 0; vx < VIEW_TILES_X; vx++) {
        const x = left + vx;
        const y = top + vy;
        if (x < 0 || y < 0 || x >= town.maxDim || y >= town.maxDim) continue;
        this.drawTile(this.scen.terTypes[town.terrain[x]![y]!]!.picture, vx, vy);
      }
    // NPCs (always-present ones only, until the population model lands)
    for (const npc of town.creatures) {
      if (npc.timeFlag !== MonstTime.ALWAYS) continue;
      const monst = this.scen.scenMonsters[npc.number];
      if (!monst) continue;
      const vx = npc.startLoc.x - left;
      const vy = npc.startLoc.y - top;
      if (vx < -2 || vy < -2 || vx > VIEW_TILES_X + 1 || vy > VIEW_TILES_Y + 1) continue;
      this.drawMonster(monst.pictureNum, vx, vy);
    }
    this.drawParty();
    this.setStatus(
      `${town.name} at (${this.townPos.x},${this.townPos.y}) — walk out of bounds to leave`,
    );
  }

  private drawParty(): void {
    const pcs = this.store.get('pcs');
    if (!pcs) return;
    this.ctx.drawImage(
      pcs,
      0, 0, TILE_W, TILE_H,
      Math.floor(VIEW_TILES_X / 2) * TILE_W, Math.floor(VIEW_TILES_Y / 2) * TILE_H,
      TILE_W, TILE_H,
    );
  }

  private setStatus(msg: string): void {
    document.getElementById('status')!.textContent = `${this.scen.title} — ${msg}`;
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
  const sheets = ['ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim', 'pcs'];
  for (let i = 1; i <= 11; i++) sheets.push(`monst${i}`);
  await Promise.all(sheets.map((s) => store.load(s)));

  const demo = new Demo(scen, store, ctx, {
    gx: scen.outdoorStart.x * SECTOR_SIZE + scen.sectorStart.x,
    gy: scen.outdoorStart.y * SECTOR_SIZE + scen.sectorStart.y,
  });
  demo.draw();
  // For headless verification and manual debugging
  (window as unknown as Record<string, unknown>)['__demo'] = demo;
  (window as unknown as Record<string, unknown>)['__scen'] = scen;

  window.addEventListener('keydown', (ev) => {
    const dir = KEY_DIRS[ev.key];
    if (dir !== undefined) {
      ev.preventDefault();
      demo.tryMove(dir);
    }
  });
  setInterval(() => demo.tick(), 250);

  document.querySelector('h1')!.textContent = 'exile-js — outdoor + town walkabout';
}

main().catch((err) => {
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
