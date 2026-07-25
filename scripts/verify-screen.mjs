// Drives the full 605x430 game screen headlessly: checks every panel paints,
// that a new game starts inside the scenario's start town, that the party can
// walk out to the world map, and that walking back onto a town entrance
// re-enters a town. Needs `npx vite --port 5199` running.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = process.env.SHOTS_DIR ?? '/tmp/exile-shots';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(process.argv[2] ?? 'http://localhost:5199/');
await page.waitForFunction(() => window.__session !== undefined, { timeout: 20000 });
await page.waitForTimeout(600);

const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, clip: { x: 12, y: 12, width: 1210, height: 860 } });

// 1. Every panel should be painted, not left as bare background.
const panels = await page.evaluate(() => {
  const ctx = document.getElementById('canvas').getContext('2d');
  const rects = {
    terView: [19, 7, 279, 351],
    status: [19, 360, 279, 21],
    pcStats: [305, 7, 271, 116],
    inven: [305, 132, 271, 144],
    transcript: [305, 285, 256, 138],
    actBtns: [19, 385, 266, 38],
  };
  const out = {};
  for (const [name, [x, y, w, h]] of Object.entries(rects)) {
    const d = ctx.getImageData(x, y, w, h).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    out[name] = seen.size;
  }
  return out;
});
console.log('PANEL COLOUR COUNTS:', JSON.stringify(panels));
await shot('01-start-town');

// 2. A new game starts inside the start town with the pregen party.
const start = await page.evaluate(() => {
  const s = window.__session;
  return {
    mode: s.mode,
    inTown: s.inTown,
    townNum: s.univ.party.townNum,
    town: s.univ.town?.record.name,
    startTown: s.univ.scenario.startTown,
    loc: s.univ.party.townLoc,
    place: s.locationName(),
    monsters: s.univ.town?.monsters.filter((m) => m.isAlive).length,
    party: s.univ.party.pcs.map((p) => `${p.name}:${p.curHealth}/${p.maxHealth}`),
  };
});
console.log('START:', JSON.stringify(start));

/**
 * Walk toward a target, sidestepping when creatures or walls block, until the
 * predicate holds or we run out of steps. Runs in-page so a step is one call.
 */
const walkUntil = (goal, limit = 400) =>
  page.evaluate(
    ({ goal, limit }) => {
      const s = window.__session;
      const done = () => (goal === 'outdoors' ? !s.inTown : s.inTown);
      // Direction enum: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7
      const order = { south: [4, 3, 5, 2, 6], north: [0, 1, 7, 2, 6] };
      const dirs = order[goal === 'outdoors' ? 'south' : 'north'];
      let steps = 0;
      while (!done() && steps < limit) {
        let moved = false;
        for (const d of dirs) {
          if (s.move(d)) {
            moved = true;
            break;
          }
          if (done()) break;
        }
        steps++;
        if (!moved && !done()) {
          // Fully boxed in: nudge sideways and keep trying.
          if (!s.move(2) && !s.move(6)) break;
        }
      }
      window.__redraw();
      return { steps, done: done() };
    },
    { goal, limit },
  );

// 3. Walking to the town edge should drop the party onto the world map.
const exit = await walkUntil('outdoors');
const outdoors = await page.evaluate(() => {
  const s = window.__session;
  return {
    mode: s.mode,
    inTown: s.inTown,
    townNum: s.univ.party.townNum,
    outLoc: s.univ.party.outLoc,
    sector: s.univ.party.sector,
    place: s.locationName(),
    tail: s.univ.transcript.slice(-2),
  };
});
console.log('LEFT TOWN:', JSON.stringify(exit), JSON.stringify(outdoors));
await shot('02-outdoors');

// 4. The party can actually get somewhere on the world map. (Window sliding
//    and world-edge clamping are covered by test/session.test.ts.)
const roam = await page.evaluate(() => {
  const s = window.__session;
  const before = { ...s.univ.party.outLoc };
  let moves = 0;
  for (let i = 0; i < 40 && !s.inTown; i++) {
    // Try each direction in turn so terrain can't wedge the probe.
    for (const d of [4, 2, 3, 5, 0, 6]) if (s.move(d)) { moves++; break; }
  }
  window.__redraw();
  return { before, after: { ...s.univ.party.outLoc }, moves, place: s.locationName() };
});
console.log('ROAMED:', JSON.stringify(roam));

// 5. Walking back onto a town entrance re-enters a town.
const reenter = await page.evaluate(() => {
  const s = window.__session;
  const scen = window.__scen;
  const TOWN_ENTRANCE = 21;
  for (let sx = 0; sx < scen.outWidth; sx++)
    for (let sy = 0; sy < scen.outHeight; sy++)
      for (const city of scen.outdoors[sx][sy].cityLocs) {
        const ter = scen.outdoors[sx][sy].terrain[city.x][city.y];
        if (scen.terTypes[ter].special !== TOWN_ENTRANCE) continue;
        s.univ.party.outdoorCorner = { x: sx, y: sy };
        s.univ.party.iwc = { x: 0, y: 0 };
        s.univ.out.build();
        s.univ.party.outLoc = { x: city.x, y: city.y + 1 };
        s.univ.party.locInSec = { x: city.x, y: city.y + 1 };
        s.center = { ...s.univ.party.outLoc };
        s.move(0); // north, onto the entrance
        window.__redraw();
        return {
          target: city.spec,
          inTown: s.inTown,
          town: s.univ.town?.record.name,
          loc: s.univ.party.townLoc,
          monsters: s.univ.town?.monsters.filter((m) => m.isAlive).length,
        };
      }
  return null;
});
console.log('RE-ENTERED:', JSON.stringify(reenter));
await page.waitForTimeout(300);
await shot('03-town-again');

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();

const ok =
  Object.values(panels).every((n) => n > 8) &&
  start.inTown === true &&
  start.townNum === start.startTown &&
  outdoors.inTown === false &&
  roam.moves > 0 &&
  reenter?.inTown === true &&
  errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
