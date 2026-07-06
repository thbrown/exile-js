// Verifies town entry/exit in the demo: teleports next to Fort Talrus's
// entrance, walks in, checks NPCs render, walks back out.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(process.argv[2] ?? 'http://localhost:5199/');
await page.waitForFunction(() => window.__demo !== undefined, { timeout: 15000 });
await page.waitForTimeout(400);

// Find a city loc in the start sector's world and teleport one tile south of it
const setup = await page.evaluate(() => {
  const demo = window.__demo;
  const scen = window.__scen;
  for (let sx = 0; sx < scen.outWidth; sx++)
    for (let sy = 0; sy < scen.outHeight; sy++)
      for (const c of scen.outdoors[sx][sy].cityLocs) {
        demo.outPos = { gx: sx * 48 + c.x, gy: sy * 48 + c.y + 1 };
        demo.draw();
        return { town: c.spec, at: `${sx},${sy} local ${c.x},${c.y}` };
      }
  return null;
});
console.log('SETUP:', JSON.stringify(setup));

await page.keyboard.press('ArrowUp'); // step onto the entrance (moving N)
await page.waitForTimeout(300);
const inTown = await page.evaluate(() => ({
  mode: window.__demo.mode,
  townNum: window.__demo.townNum,
  pos: window.__demo.townPos,
  status: document.getElementById('status').textContent,
}));
console.log('IN TOWN:', JSON.stringify(inTown));
await page.screenshot({ path: '/tmp/town-1.png' });

const px = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let nb = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 16 || d[i + 1] > 16 || d[i + 2] > 16) nb++;
  return nb;
});
console.log('NONBLACK:', px);

// Probe: walk around inside the town a bit, then exit via bounds
for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const after = await page.evaluate(() => ({
  mode: window.__demo.mode,
  status: document.getElementById('status').textContent,
}));
console.log('AFTER 60x DOWN:', JSON.stringify(after));
console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
