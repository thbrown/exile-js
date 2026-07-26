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
const panels = await page.evaluate(async () => {
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
const start = await page.evaluate(async () => {
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
const talk = await page.evaluate(async () => {
  const s = window.__session;
  const sc = window.__screen;
  const who = s.univ.town.monsters.find((m) => m.isAlive && m.personality >= 0 && m.isFriendly);
  if (!who) return { skipped: 'no talkable NPC' };
  s.univ.party.townLoc = { x: who.curLoc.x, y: who.curLoc.y + 1 };
  s.center = { ...s.univ.party.townLoc };
  await s.talkTo(who.curLoc);
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
const talkKeys = await page.evaluate(async () => {
  const s = window.__session;
  return { job: s.talk?.str1 === s.talk?.person.job, str1: s.talk?.str1.slice(0, 40) };
});
console.log('TALK KEY j:', JSON.stringify(talkKeys));
await shot('01b-talking');
const talkClosed = await page.evaluate(async () => {
  const s = window.__session;
  s.chooseTalkNode(-14); // Done
  window.__redraw();
  return { talking: !!s.talk, inTown: s.inTown };
});
console.log('TALK CLOSED:', JSON.stringify(talkClosed));

// 2b-2. Shopping: open the first shop with stock, buy with its letter key, and
//       leave with Escape.
const shopOpened = await page.evaluate(async () => {
  const s = window.__session;
  const which = window.__scen.shops.findIndex((sh) => sh.numItems() > 0);
  const ok = s.startShopMode(which, 2, 'Verify Shop');
  s.univ.party.gold = 30000;
  s.shop.setUpArray();
  window.__redraw();
  return ok && {
    which,
    mode: s.mode,
    inTown: s.inTown,
    name: s.shop.name,
    title: s.shop.title,
    rows: s.shop.visible.length,
    first: s.shop.rowEntry(0)?.entry.item.fullName,
    firstCost: s.shop.rowEntry(0) && s.shop.cost(s.shop.rowEntry(0).entry),
  };
});
console.log('SHOP:', JSON.stringify(shopOpened));
await shot('01b2-shopping');

// The shop panel must actually paint over the terrain view.
const shopPainted = await page.evaluate(async () => {
  const ctx = document.getElementById('canvas').getContext('2d');
  const d = ctx.getImageData(19, 7, 279, 351).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return seen.size;
});
console.log('SHOP PANEL COLOURS:', shopPainted);

// 'a' buys the first row (shop_chars).
const goldBefore = await page.evaluate(() => window.__univ.party.gold);
await page.keyboard.press('a');
await page.waitForTimeout(200);
const bought = await page.evaluate(async () => {
  const s = window.__session;
  return {
    gold: s.univ.party.gold,
    lastLine: s.univ.transcript.at(-1),
    stillShopping: !!s.shop,
  };
});
console.log('SHOP BUY a:', JSON.stringify({ goldBefore, ...bought }));

await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const shopClosed = await page.evaluate(async () => {
  const s = window.__session;
  return { shopping: !!s.shop, mode: s.mode, inTown: s.inTown };
});
console.log('SHOP CLOSED:', JSON.stringify(shopClosed));

// 2b-3. Selling: the inventory panel turns into a sell prompt, and clicking an
//       item's sell button pays out.
const sellReady = await page.evaluate(async () => {
  const s = window.__session;
  s.startTalkMode(-1, 0, 0, -1);
  s.startItemShop('sell-any', 0, 0, 0);
  // The first PC has the axe bought above; make sure it isn't equipped.
  s.univ.party.pcs[0].equip.fill(false);
  window.__screen.itemPage = 0;
  window.__redraw();
  return {
    mode: s.itemShop?.mode,
    item: s.univ.party.pcs[0].items[0].fullName,
    gold: s.univ.party.gold,
  };
});
console.log('SELL READY:', JSON.stringify(sellReady));
await shot('01b3-selling');

const sold = await page.evaluate(async () => {
  const s = window.__session;
  const gold = s.univ.party.gold;
  s.useItemShop(0, 0);
  window.__redraw();
  return {
    gained: s.univ.party.gold - gold,
    lastLine: s.univ.transcript.at(-1),
    slot0: s.univ.party.pcs[0].items[0].fullName,
  };
});
console.log('SOLD:', JSON.stringify(sold));
// 2b-4. Training: pick who trains, raise a skill, keep it.
await page.evaluate(async () => {
  const s = window.__session;
  s.univ.party.gold = 5000;
  s.univ.party.pcs.forEach((p) => { p.skillPts = 40; });
  s.onTrain();
});
await page.waitForTimeout(250);
const trainWho = await page.evaluate(async () => {
  const d = window.__dialogs.active;
  return d ? { text: d.spec.text, rows: d.spec.rows.length } : null;
});
await page.keyboard.press('1');
await page.waitForTimeout(250);
const trainList = await page.evaluate(async () => {
  const d = window.__dialogs.active;
  return d ? { rows: d.spec.rows.length, first: d.spec.rows[0].label } : null;
});
console.log('TRAIN:', JSON.stringify({ trainWho, trainList }));
await shot('01b4-training');
const trainBefore = await page.evaluate(() => ({
  str: window.__univ.party.pcs[0].skills[0],
  pts: window.__univ.party.pcs[0].skillPts,
  gold: window.__univ.party.gold,
}));
await page.keyboard.press('1'); // raise Strength
await page.waitForTimeout(200);
await page.keyboard.press('k'); // Keep
await page.waitForTimeout(250);
const trained = await page.evaluate(() => ({
  str: window.__univ.party.pcs[0].skills[0],
  gold: window.__univ.party.gold,
  dialogGone: !window.__dialogs.active,
}));
console.log('TRAINED:', JSON.stringify({ trainBefore, trained }));

await page.evaluate(async () => {
  window.__session.chooseTalkNode(-14);
  window.__redraw();
});

// 2b-5. Specials: drive the VM through a synthetic chain. Running the town's
//       real nodes here would block on the first message dialog, since a
//       page.evaluate can't answer its own prompt.
const specials = await page.evaluate(async () => {
  const s = window.__session;
  const saved = s.univ.town.record.specials;
  const node = (over) => ({
    type: 0, sd1: -1, sd2: -1, m1: -1, m2: -1, m3: -1, pic: -1, pictype: 4,
    ex1a: -1, ex1b: -1, ex1c: -1, ex2a: -1, ex2b: -1, ex2c: -1, jumpto: -1, ...over,
  });
  // 1 = SET_SDF, 130 = IF_SDF, 2 = INC_SDF.
  s.univ.town.record.specials = new Map([
    [0, node({ type: 1, sd1: 40, sd2: 0, ex1a: 3, jumpto: 1 })],
    [1, node({ type: 130, sd1: 40, sd2: 0, ex1a: 3, ex1b: 2, jumpto: -1 })],
    [2, node({ type: 2, sd1: 40, sd2: 1, ex1a: 7, ex1b: 0 })],
  ]);
  await s.runSpecialRaw(1, 2, 0, { x: 5, y: 5 });
  const out = {
    flag: s.univ.party.getSdf(40, 0),
    branched: s.univ.party.getSdf(40, 1),
    ptrX: s.univ.party.getPtr(10),
    realNodes: saved.size,
  };
  s.univ.town.record.specials = saved;
  return out;
});
console.log('SPECIALS:', JSON.stringify(specials));

// 2c. Doors: an unlocked one opens on contact; a locked one raises the prompt,
//     and its Bash shortcut goes through the dialog host.
const doors = await page.evaluate(async () => {
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
    await s.move(0);
    out.unlocked = { before, after: scen.terTypes[t.terrain[unlocked.x][unlocked.y]].name };
  }
  const locked = find(9);
  if (locked) {
    s.univ.party.townLoc = { x: locked.x, y: locked.y + 1 };
    s.center = { ...s.univ.party.townLoc };
    for (const row of s.univ.town.explored) row.fill(1);
    await s.move(0);
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
const bashPrompt = await page.evaluate(async () => {
  const d = window.__dialogs.active;
  return d ? { text: d.spec.text, rows: (d.spec.rows ?? []).length } : null;
});
console.log('BASH ASKS WHO:', JSON.stringify(bashPrompt));
if (bashPrompt) {
  // Pick the first selectable PC through the dialog's own hit test.
  const hit = await page.evaluate(async () => {
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
const gotItem = await page.evaluate(async () => {
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
const sign = await page.evaluate(async () => {
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
 * predicate holds or we run out of steps.
 *
 * A step can now trigger a special, which opens a dialog and leaves the move
 * awaiting an answer — and nothing inside a page.evaluate can answer it. So each
 * step races a short timer: if it stalls, the loop hands control back, the
 * driver presses Enter out here, and the pending move finishes on its own.
 */
const walkChunk = (goal, limit) =>
  page.evaluate(
    async ({ goal, limit }) => {
      const s = window.__session;
      const done = () => (goal === 'outdoors' ? !s.inTown : s.inTown);
      const STALLED = Symbol('stalled');
      // A move that opens a dialog never settles until someone answers it.
      const step = (d) => Promise.race([
        s.move(d),
        new Promise((r) => setTimeout(() => r(STALLED), 400)),
      ]);
      // Direction enum: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7
      const order = { south: [4, 3, 5, 2, 6], north: [0, 1, 7, 2, 6] };
      const dirs = order[goal === 'outdoors' ? 'south' : 'north'];
      let steps = 0;
      while (!done() && steps < limit) {
        if (window.__dialogs.active) return { steps, done: done(), waiting: true };
        let moved = false;
        for (const d of dirs) {
          const result = await step(d);
          if (result === STALLED) return { steps, done: done(), waiting: true };
          if (result) {
            moved = true;
            break;
          }
          if (done()) break;
        }
        steps++;
        if (!moved && !done()) {
          // Fully boxed in: nudge sideways and keep trying.
          const a = await step(2);
          if (a === STALLED) return { steps, done: done(), waiting: true };
          if (!a) {
            const b = await step(6);
            if (b === STALLED) return { steps, done: done(), waiting: true };
            if (!b) break;
          }
        }
      }
      window.__redraw();
      return { steps, done: done(), waiting: !!window.__dialogs.active };
    },
    { goal, limit },
  );

const walkUntil = async (goal, limit = 400) => {
  let steps = 0;
  let done = false;
  let dismissed = 0;
  for (let round = 0; round < 40 && steps < limit; round++) {
    const chunk = await walkChunk(goal, limit - steps);
    steps += chunk.steps;
    done = chunk.done;
    if (done) break;
    if (!chunk.waiting) break;
    // Answer whatever the step raised, then carry on.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    dismissed++;
  }
  return { steps, done, dismissed };
};

// 3. Walking to the town edge should drop the party onto the world map. The
//    probes above wandered the party deep into the fort, so start over from a
//    fresh entry first.
//
//    Scripting is detached for this phase: this section tests the town/outdoor
//    transition, and a blind 400-step walk through Fort Talrus otherwise spends
//    its time answering the fort's own specials (the bedroom's "Rest?", the
//    trapdoor, and so on) rather than walking. The VM has its own coverage
//    above and in test/specials.test.ts.
await page.evaluate(async () => {
  const s = window.__session;
  s.__specialsOff = s.specials;
  s.specials = null;
  s.startTownMode(s.univ.scenario.startTown, 9);
  window.__redraw();
});
const exit = await walkUntil('outdoors');
const outdoors = await page.evaluate(async () => {
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
const roam = await page.evaluate(async () => {
  const s = window.__session;
  const before = { ...s.univ.party.outLoc };
  let moves = 0;
  for (let i = 0; i < 40 && !s.inTown; i++) {
    // Try each direction in turn so terrain can't wedge the probe.
    for (const d of [4, 2, 3, 5, 0, 6]) if (await s.move(d)) { moves++; break; }
  }
  window.__redraw();
  return { before, after: { ...s.univ.party.outLoc }, moves, place: s.locationName() };
});
console.log('ROAMED:', JSON.stringify(roam));

// 5. Walking back onto a town entrance re-enters a town.
const reenter = await page.evaluate(async () => {
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
        await s.move(0); // north, onto the entrance
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
await page.evaluate(() => {
  const s = window.__session;
  if (s.__specialsOff) s.specials = s.__specialsOff;
});
await page.waitForTimeout(300);
await shot('03-town-again');

// 2c2. Combat: walking into a hostile creature starts a fight, the party is
//      placed as six figures, a swing lands, and leaving regroups the party.
const combat = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  const monst = univ.town.monsters.find((m) => m.isAlive);
  if (!monst) return { skipped: true };
  monst.attitude = 1; // HOSTILE_A
  monst.mon.armor = 0;
  monst.health = monst.maxHealth = 400;
  monst.curLoc = { x: univ.party.townLoc.x, y: univ.party.townLoc.y - 1 };
  const modeBefore = s.mode;
  await s.moveTo(monst.curLoc);
  const placed = univ.party.pcs.filter((pc) => pc.isAlive && pc.combatPos.x >= 0).length;
  // Give the acting PC a real weapon and swing until something lands.
  const pc = univ.currentPc;
  pc.skills[3] = 20; // edged weapons
  pc.skills[1] = 20; // dexterity
  pc.items[0] = { ...pc.items[0], variety: 1, name: 'sword', fullName: 'sword',
    itemLevel: 10, weapType: 3, ability: 0 };
  pc.equip[0] = true;
  const hpBefore = monst.health;
  for (let i = 0; i < 25 && monst.health === hpBefore; i++) {
    pc.ap = 4;
    univ.curPc = univ.party.pcs.indexOf(pc);
    s.attackAt(monst.curLoc);
  }
  window.__redraw();
  return {
    modeBefore, mode: s.mode, placed, hurt: hpBefore - monst.health,
    bar: s.locationName(), tail: univ.transcript.slice(-3),
  };
});
console.log('COMBAT:', JSON.stringify(combat));
await shot('02c-combat');

// The monsters' half of the round: pass until something hits back.
const monstTurn = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  univ.party.pcs.forEach((pc) => { pc.maxHealth = 200; pc.curHealth = 200; });
  const monst = univ.town.monsters.find((m) => m.isAlive && !m.isFriendly);
  if (!monst) return { skipped: true };
  monst.mon.attacks = [{ dice: 4, sides: 6, type: 0 }];
  monst.mon.skill = 20;
  monst.mon.speed = 12;
  let hurt = 0;
  for (let round = 0; round < 12 && hurt === 0; round++) {
    monst.active = 2; // ALERTED
    monst.curLoc = { x: univ.currentPc.combatPos.x + 1, y: univ.currentPc.combatPos.y };
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    s.startCombatRound();
    hurt = univ.party.pcs.reduce((n, pc) => n + (200 - pc.curHealth), 0);
  }
  window.__redraw();
  return { hurt, taken: univ.party.totalDamTaken, tail: univ.transcript.slice(-4) };
});
console.log('MONSTER TURN:', JSON.stringify(monstTurn));
await shot('02c2-monster-turn');

const combatEnd = await page.evaluate(() => {
  const s = window.__session;
  const ended = s.endCombat();
  window.__redraw();
  return {
    ended, mode: s.mode, loc: { ...s.univ.party.townLoc },
    placed: s.univ.party.pcs.filter((pc) => pc.combatPos.x >= 0).length,
  };
});
console.log('COMBAT END:', JSON.stringify(combatEnd));

// The Fight button on the toolbar is what a player actually reaches for, so
// find it by scanning the toolbar the way a click does and press it.
const fightButton = await page.evaluate(() => {
  const s = window.__session;
  const screen = window.__screen;
  window.__redraw();
  let found = null;
  for (let y = 360; y < 430 && !found; y += 2)
    for (let x = 0; x < 300; x += 2) {
      const hit = screen.buttonAt(x, y);
      if (hit && hit.btn === 10) { found = { x, y }; break; } // SWORD
    }
  if (!found) return { found: false, mode: s.mode };
  // Press it the way the click handler does.
  s.startCombat(s.univ.party.direction);
  window.__redraw();
  const inFight = s.mode;
  // And in a fight the toolbar swaps to the fight set, which has no sword.
  let swordStillThere = false;
  for (let y = 360; y < 430 && !swordStillThere; y += 2)
    for (let x = 0; x < 300; x += 2) {
      const hit = screen.buttonAt(x, y);
      if (hit && hit.btn === 10) { swordStillThere = true; break; }
    }
  s.endCombat();
  window.__redraw();
  return { found: true, at: found, inFight, swordStillThere, backTo: s.mode };
});
console.log('FIGHT BUTTON:', JSON.stringify(fightButton));

// An encounter: a hostile monster notices the party in *town* mode, walks over
// and attacks, without the player entering combat mode at all.
const encounter = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  if (s.mode !== 1) return { skipped: 'not in town' };
  const monst = univ.town.monsters.find((m) => m.isAlive && !m.isFriendly)
    ?? univ.town.monsters.find((m) => m.isAlive);
  if (!monst) return { skipped: 'no monsters' };
  monst.attitude = 1; // HOSTILE_A
  monst.active = 1; // IDLE, so it has to notice us
  monst.mobile = true;
  monst.mon.attacks = [{ dice: 4, sides: 6, type: 0 }];
  monst.mon.skill = 20;
  monst.mon.speed = 12;
  monst.curLoc = { x: univ.party.townLoc.x + 3, y: univ.party.townLoc.y };
  univ.party.pcs.forEach((pc) => { pc.maxHealth = 300; pc.curHealth = 300; });
  const startedAt = { ...monst.curLoc };

  // Stand still: each attempted step is a party action, so the monsters move.
  let noticed = false;
  let hurt = 0;
  for (let i = 0; i < 40 && hurt === 0; i++) {
    await s.moveTo({ x: univ.party.townLoc.x, y: univ.party.townLoc.y - 1 });
    await s.moveTo({ x: univ.party.townLoc.x, y: univ.party.townLoc.y + 1 });
    noticed = noticed || univ.transcript.includes('Monster saw you!');
    hurt = univ.party.pcs.reduce((n, pc) => n + (300 - pc.curHealth), 0);
  }
  window.__redraw();
  return {
    noticed, hurt, startedAt, endedAt: { ...monst.curLoc },
    closed: Math.abs(startedAt.x - univ.party.townLoc.x)
      - Math.abs(monst.curLoc.x - univ.party.townLoc.x),
    tail: univ.transcript.slice(-4),
  };
});
console.log('ENCOUNTER:', JSON.stringify(encounter));

// Combat placement must not drop a PC inside a wall or on top of a monster.
const placement = await page.evaluate(() => {
  const s = window.__session;
  const univ = s.univ;
  let worst = null;
  for (let attempt = 0; attempt < 8 && !worst; attempt++) {
    if (s.mode === 9) s.endCombat();
    s.startCombat(univ.party.direction);
    for (const pc of univ.party.pcs) {
      if (!pc.isAlive) continue;
      const p = pc.combatPos;
      const onMonster = !!univ.town.monsterAt(p);
      const inWall = s.townIsBlocked(p);
      // The leader's own square is exempt: the C++ forces index 0 through.
      const isLeader = pc === univ.party.pcs.find((q) => q.isAlive);
      if ((onMonster || inWall) && !isLeader) {
        worst = { name: pc.name, at: { ...p }, onMonster, inWall };
        break;
      }
    }
  }
  const stacked = new Set(univ.party.pcs.filter((pc) => pc.isAlive)
    .map((pc) => `${pc.combatPos.x},${pc.combatPos.y}`)).size;
  s.endCombat();
  window.__redraw();
  return { worst, distinctSquares: stacked };
});
console.log('PLACEMENT:', JSON.stringify(placement));


// Hit animation + the right sound type for a bite.
const booms = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  const played = [];
  window.__setLivingSound((n) => played.push(n));
  const monst = univ.town.monsters.find((m) => m.isAlive);
  if (!monst) return { skipped: true };
  monst.attitude = 1;
  monst.mon.armor = 0;
  monst.health = monst.maxHealth = 400;
  monst.curLoc = { x: univ.party.townLoc.x + 1, y: univ.party.townLoc.y };
  await s.moveTo(monst.curLoc); // starts combat
  const pc = univ.currentPc;
  pc.skills[3] = 20; pc.skills[1] = 20;
  pc.items[0] = { ...pc.items[0], variety: 1, name: 'sword', fullName: 'sword',
    itemLevel: 10, weapType: 3, ability: 0 };
  pc.equip[0] = true;
  const before = monst.health;
  for (let i = 0; i < 25 && monst.health === before; i++) {
    pc.ap = 4;
    s.attackAt(monst.curLoc);
  }
  const boomCount = window.__screen.booms.length;
  const boom = boomCount > 0 ? { ...window.__screen.booms[0], where: { ...window.__screen.booms[0].where } } : null;
  window.__redraw();
  window.__setLivingSound(null);
  return { boomCount, boom, played, hurt: before - monst.health };
});
console.log('BOOMS:', JSON.stringify(booms));
await shot('02c4-boom');

// Attacking someone peaceful: the prompt has to come up, and going through
// with it has to turn the whole town on the party.
const attackFriendly = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  if (s.mode === 9) s.endCombat();
  const monst = univ.town.monsters.find((m) => m.isAlive);
  if (!monst) return { skipped: 'no monsters' };
  monst.attitude = 0; // DOCILE — peaceful
  univ.town.monstHostile = false;
  monst.curLoc = { x: univ.party.townLoc.x + 1, y: univ.party.townLoc.y };
  s.startCombat(univ.party.direction);
  const pc = univ.currentPc;
  pc.combatPos = { x: monst.curLoc.x, y: monst.curLoc.y + 1 };
  pc.ap = 4;
  // Don't await: the move parks on the dialog until it's answered.
  const pending = s.combatMove({ ...monst.curLoc });
  await new Promise((r) => setTimeout(r, 150));
  return {
    promptUp: !!window.__dialogs.active,
    stillFriendly: monst.isFriendly,
    finish: (window.__pendingAttack = pending) && true,
  };
});
await shot('02f-attack-friendly');
await page.keyboard.press('a'); // the Attack button's def-key
await page.waitForTimeout(200);
const attackFriendlyDone = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  const swung = await window.__pendingAttack;
  const monst = univ.town.monsters.find((m) => !m.isFriendly);
  window.__redraw();
  return {
    swung, townHostile: univ.town.monstHostile, someoneTurned: !!monst,
    dialogGone: !window.__dialogs.active, tail: univ.transcript.slice(-2),
  };
});
console.log('ATTACK FRIENDLY:', JSON.stringify({ ...attackFriendly, ...attackFriendlyDone }));

// The Parry and Stand Ready buttons on the fight toolbar.
const parryButtons = await page.evaluate(() => {
  const s = window.__session;
  const screen = window.__screen;
  if (s.mode !== 9) s.startCombat(s.univ.party.direction);
  window.__redraw();
  const find = (which) => {
    for (let y = 360; y < 430; y += 2)
      for (let x = 0; x < 300; x += 2) {
        const hit = screen.buttonAt(x, y);
        if (hit && hit.btn === which) return { x, y };
      }
    return null;
  };
  const out = { shieldAt: find(6), waitAt: find(12) }; // SHIELD, WAIT
  const pc = s.univ.currentPc;
  pc.skills[2] = 8; // DEFENSE
  pc.ap = 8;
  s.parry();
  out.parry = { value: pc.parry, ap: pc.ap };
  // Spending the turn hands over to the next PC, so re-read who's acting.
  const next = s.univ.currentPc;
  next.ap = 4;
  s.pause();
  out.standReady = { value: next.parry, ap: next.ap };
  s.endCombat();
  window.__redraw();
  return out;
});
console.log('PARRY:', JSON.stringify(parryButtons));
await shot('02c3-encounter');

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
  shopOpened?.rows > 0 &&
  shopOpened.inTown === true &&
  shopPainted > 8 &&
  bought.gold < goldBefore &&
  bought.stillShopping === true &&
  shopClosed.shopping === false &&
  shopClosed.inTown === true &&
  sellReady.mode === 'sell-any' &&
  sold.gained > 0 &&
  sold.lastLine === 'You sell your item.' &&
  trainWho?.rows === 6 &&
  trainList?.rows === 21 &&
  trained.str === trainBefore.str + 1 &&
  trained.gold < trainBefore.gold &&
  trained.dialogGone === true &&
  specials.flag === 3 &&
  specials.branched === 7 &&
  specials.ptrX === 5 &&
  specials.realNodes > 0 &&
  bashDone.dialogGone === true &&
  (gotItem.skipped === true || gotItem.carried.includes(gotItem.name)) &&
  (sign.skipped === true || (sign.readable === true && signShown.dialogOpen === true)) &&
  outdoors.inTown === false &&
  roam.moves > 0 &&
  (combat.skipped === true || (combat.mode === 9 && combat.placed > 1
    && combat.hurt > 0 && combatEnd.ended === true && combatEnd.mode === 1
    && combatEnd.placed === 0)) &&
  (monstTurn.skipped === true || monstTurn.hurt > 0) &&
  fightButton.found === true &&
  fightButton.inFight === 9 &&
  fightButton.swordStillThere === false &&
  fightButton.backTo === 1 &&
  (encounter.skipped !== undefined || (encounter.noticed === true && encounter.hurt > 0)) &&
  placement.worst === null &&
  // sound_lookup[2] = 70 is the heavy-blade hit. Before the fix this played the
  // *sound type* (2) as a file number, which is the cash-register noise.
  (booms.skipped === true || (booms.boomCount > 0 && booms.boom.damage > 0
    && booms.played.includes(70))) &&
  reenter?.inTown === true &&
  errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
