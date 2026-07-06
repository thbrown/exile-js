// Drives the M1 walkabout demo in headless Chromium and captures evidence.
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5199/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});

await page.goto(url);
await page.waitForFunction(
  () => document.getElementById('status')?.textContent?.includes('Valley') ?? false,
  { timeout: 15000 },
);

await page.waitForTimeout(400); // let a tick() draw settle
const status1 = await page.textContent('#status');
console.log('STATUS1:', status1);
console.log('DRAWDEBUG:', JSON.stringify(await page.evaluate(() => window.__drawDebug)));

// Non-black pixel ratio on the canvas
const pixelStats = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let nonBlack = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 16 || data[i + 1] > 16 || data[i + 2] > 16) nonBlack++;
  }
  return { total, nonBlack, ratio: nonBlack / total };
});
console.log('PIXELS:', JSON.stringify(pixelStats));

await page.screenshot({ path: '/tmp/walkabout-1.png' });

// Move around: 5 steps east, 3 south
for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
await page.waitForTimeout(300);
const status2 = await page.textContent('#status');
console.log('STATUS2:', status2);
await page.screenshot({ path: '/tmp/walkabout-2.png' });

// Probe: hammer movement into a blocked direction / map edge (should clamp, no errors)
for (let i = 0; i < 120; i++) await page.keyboard.press('ArrowUp');
await page.waitForTimeout(300);
const status3 = await page.textContent('#status');
console.log('STATUS3 (after 120x Up):', status3);

console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
