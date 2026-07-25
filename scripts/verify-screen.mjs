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

// 2b. Talk to a townsperson: the talk screen replaces the left column, the
//     reply's keywords are clickable, and Done returns to town mode.
const talk = await page.evaluate(() => {
  const s = window.__session;
  const sc = window.__screen;
  const who = s.univ.town.monsters.find((m) => m.isAlive && m.personality >= 0 && m.isFriendly);
  if (!who) return { skipped: 'no talkable NPC' };
  s.univ.party.townLoc = { x: who.curLoc.x, y: who.curLoc.y + 1 };
  s.center = { ...s.univ.party.townLoc };
  s.talkTo(who.curLoc);
  window.__redraw();
  const opening = s.talk?.str1;
  // Click the first keyword through the renderer's own hit rects.
  const kw = s.talk?.words.find((w) => !w.preset && w.rect);
  let followed = null;
  if (kw) {
    const cx = (kw.rect.left + kw.rect.right) / 2;
    const cy = (kw.rect.top + kw.rect.bottom) / 2;
    const hit = sc.talkScreen.wordAt(s.talk, cx, cy);
    if (hit) s.chooseTalkNode(hit.node);
    window.__redraw();
    followed = { word: kw.word, changed: s.talk?.str1 !== opening };
  }
  return {
    title: s.talk?.title,
    keywords: s.talk?.words.filter((w) => !w.preset).length,
    presets: s.talk?.words.filter((w) => w.preset).map((w) => w.word),
    followed,
  };
});
console.log('TALK:', JSON.stringify(talk));
// Letter shortcuts (talk_chars): 'j' asks about the speaker's job.
await page.keyboard.press('j');
await page.waitForTimeout(150);
const talkKeys = await page.evaluate(() => {
  const s = window.__session;
  return { job: s.talk?.str1 === s.talk?.person.job, str1: s.talk?.str1.slice(0, 40) };
});
console.log('TALK KEY j:', JSON.stringify(talkKeys));
await shot('01b-talking');
const talkClosed = await page.evaluate(() => {
  const s = window.__session;
  s.chooseTalkNode(-14); // Done
  window.__redraw();
  return { talking: !!s.talk, inTown: s.inTown };
});
console.log('TALK CLOSED:', JSON.stringify(talkClosed));

// 2c. Doors: an unlocked one opens on contact; a locked one raises the prompt,
//     and its Bash shortcut goes through the dialog host.
const doors = await page.evaluate(() => {
  const s = window.__session;
  const scen = window.__scen;
  const t = s.univ.town.record;
  const find = (special) => {
    for (let x = 1; x < t.maxDim - 1; x++)
      for (let y = 1; y < t.maxDim - 1; y++)
        if (scen.terTypes[t.terrain[x][y]].special === special) return { x, y };
    return null;
  };
  const out = {};
  const unlocked = find(1);
  if (unlocked) {
    s.univ.party.townLoc = { x: unlocked.x, y: unlocked.y + 1 };
    s.center = { ...s.univ.party.townLoc };
    const before = scen.terTypes[t.terrain[unlocked.x][unlocked.y]].name;
    s.move(0);
    out.unlocked = { before, after: scen.terTypes[t.terrain[unlocked.x][unlocked.y]].name };
  }
  const locked = find(9);
  if (locked) {
    s.univ.party.townLoc = { x: locked.x, y: locked.y + 1 };
    s.center = { ...s.univ.party.townLoc };
    for (const row of s.univ.town.explored) row.fill(1);
    s.move(0);
    out.lockedAt = `${locked.x},${locked.y}`;
  }
  window.__redraw();
  return out;
});
console.log('DOORS:', JSON.stringify(doors));
await page.waitForTimeout(200);
const promptUp = await page.evaluate(() => !!window.__dialogs.active);
await shot('01c-locked-door');
await page.keyboard.press('b');
await page.waitForTimeout(200);
const bashed = await page.evaluate(() => ({
  // 'b' picks Bash, which then asks who does it, so a dialog is still up.
  stillAsking: !!window.__dialogs.active,
}));
console.log('DOOR PROMPT:', JSON.stringify({ promptUp, ...bashed }));

// 2c-2. Bashing must ask who does it, and play its sound.
const bashPrompt = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d ? { text: d.spec.text, rows: (d.spec.rows ?? []).length } : null;
});
console.log('BASH ASKS WHO:', JSON.stringify(bashPrompt));
if (bashPrompt) {
  // Pick the first selectable PC through the dialog's own hit test.
  const hit = await page.evaluate(() => {
    const d = window.__dialogs.active;
    for (let y = 0; y < 430; y++)
      for (let x = 0; x < 605; x += 4) {
        const h = d.buttonAt(x, y);
        if (h && h.name === '0') return { x, y };
      }
    return null;
  });
  // Number keys pick a PC, the way select-pc.xml's def-keys do.
  await page.keyboard.press('3');
  await page.waitForTimeout(200);
}
const bashDone = await page.evaluate(() => ({
  dialogGone: !window.__dialogs.active,
  tail: window.__session.univ.transcript.slice(-1),
}));
console.log('BASH RESULT:', JSON.stringify(bashDone));

// 2e. Items: stand on a floor item, take it, and see it in the pack.
const gotItem = await page.evaluate(() => {
  const s = window.__session;
  const target = s.univ.town.items.find((i) => !i.contained);
  if (!target) return { skipped: true };
  s.univ.party.townLoc = { ...target.itemLoc };
  s.center = { ...s.univ.party.townLoc };
  const reachable = s.reachableItems(s.univ.party.townLoc);
  s.takeItem(target, 0);
  window.__redraw();
  return {
    name: target.name,
    reachable: reachable.length,
    carried: s.univ.party.pcs[0].items.filter((i) => i.variety !== 0).map((i) => i.name),
  };
});
console.log('GOT ITEM:', JSON.stringify(gotItem));
await shot('01e-inventory');

// 2d. Signs: looking at an adjacent sign opens a dialog with its text.
const sign = await page.evaluate(() => {
  const s = window.__session;
  const signs = s.univ.town.record.signLocs;
  if (signs.length === 0) return { skipped: true };
  const at = signs[0];
  s.univ.party.townLoc = { x: at.x, y: at.y + 1 };
  s.center = { ...s.univ.party.townLoc };
  window.__redraw();
  return { text: at.text.slice(0, 40), readable: s.signAt(at) !== null };
});
if (!sign.skipped) {
  await page.keyboard.press('l');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
}
const signShown = await page.evaluate(() => ({
  dialogOpen: !!window.__dialogs.active,
  tail: window.__session.univ.transcript.slice(-2),
}));
console.log('SIGN:', JSON.stringify({ ...sign, ...signShown }));
await shot('01d-sign');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);

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

// 3. Walking to the town edge should drop the party onto the world map. The
//    probes above wandered the party deep into the fort, so start over from a
//    fresh entry first.
await page.evaluate(() => {
  const s = window.__session;
  s.startTownMode(s.univ.scenario.startTown, 9);
  window.__redraw();
});
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
  (talk.skipped !== undefined || (talk.followed?.changed === true && talkClosed.talking === false)) &&
  doors.unlocked?.after !== doors.unlocked?.before &&
  promptUp === true &&
  bashed.stillAsking === true &&
  bashPrompt?.text.startsWith('Who will bash?') &&
  talkKeys.job === true &&
  bashPrompt?.rows === 6 &&
  bashDone.dialogGone === true &&
  (gotItem.skipped === true || gotItem.carried.includes(gotItem.name)) &&
  (sign.skipped === true || (sign.readable === true && signShown.dialogOpen === true)) &&
  outdoors.inTown === false &&
  roam.moves > 0 &&
  reenter?.inTown === true &&
  errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
