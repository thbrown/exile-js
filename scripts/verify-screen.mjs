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

// `?pace=1` runs at the original's own animation speed rather than the
// play-testing default. Damage waits for its blast now, so a step that swings
// twenty-five times waits for twenty-five of them — at the shipped 3x pace this
// gate would take minutes. The ordering being checked is the same either way.
await page.goto(process.argv[2] ?? 'http://localhost:5199/?pace=1');
await page.waitForFunction(() => window.__session !== undefined, { timeout: 20000 });
await page.waitForTimeout(600);

const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, clip: { x: 12, y: 12, width: 1210, height: 860 } });

/**
 * Wait until the game will accept input again. The monsters' half of a round
 * is asynchronous now — it waits on the animation timeline where the C++
 * blocks — and the input layer drops keystrokes while it runs, exactly as the
 * original does (`flushingInput`). A driver that types straight after an
 * action would have its key thrown away, so every keypress waits for this
 * first.
 */
const idle = async () => {
  await page.evaluate(() => window.__session.settled());
  // …and for the animation queue: a blast books its own time now, and input
  // is dropped while anything is still on screen (`flushingInput`). Both have
  // to be quiet or the keystroke goes nowhere.
  await page.waitForFunction(() => window.__animPending() === 0, { timeout: 30000 });
};
const press = async (key) => { await idle(); await page.keyboard.press(key); };

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

// 1b. The automap: 'a' opens it over the screen, Escape closes it again. The
// map area (240x240 at 52+47, 62+29) has to hold more than one colour, or the
// terrain never drew.
await press('a');
await page.waitForTimeout(150);
const map = await page.evaluate(() => {
  const ctx = document.getElementById('canvas').getContext('2d');
  const d = ctx.getImageData(2 * (52 + 47), 2 * (62 + 29), 480, 480).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return { visible: window.__screen.mapVisible, colours: seen.size };
});
await shot('01a-map-town');
// The map window is draggable: press anywhere on it, move, release. It clamps
// so at least 50px stays on the canvas and the title never leaves the top.
const canvasPoint = async (x, y) => page.evaluate(({ x, y }) => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return { x: r.left + (x + 0.5) * (r.width / c.width), y: r.top + (y + 0.5) * (r.height / c.height) };
}, { x, y });
const grab = await canvasPoint(60, 70);
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
const to = await canvasPoint(160, 150);
await page.mouse.move(to.x, to.y, { steps: 4 });
const dragged = await page.evaluate(() => ({ ...window.__screen.mapScreen.pos }));
await page.mouse.up();
// Now shove it hard off the top-left and check the clamp catches it.
await page.mouse.move(to.x, to.y);
await page.mouse.down();
const far = await canvasPoint(0, 0);
await page.mouse.move(far.x - 600, far.y - 600, { steps: 4 });
const clamped = await page.evaluate(() => ({
  ...window.__screen.mapScreen.pos, dragging: window.__screen.mapScreen.dragging,
}));
await page.mouse.up();
const released = await page.evaluate(() => window.__screen.mapScreen.dragging);
await page.evaluate(() => { window.__screen.mapScreen.pos = { x: 52, y: 62 }; window.__redraw(); });
await press('Escape');
await page.waitForTimeout(150);
const mapClosed = await page.evaluate(() => window.__screen.mapVisible);
console.log('MAP:', JSON.stringify(map), 'closed:', mapClosed,
  'drag:', JSON.stringify({ dragged, clamped, released }));
if (dragged.x !== 152 || dragged.y !== 142) throw new Error(`map did not follow the pointer: ${JSON.stringify(dragged)}`);
if (clamped.y !== 0) throw new Error('the map window went above the top of the canvas');
if (clamped.x !== -296 + 50) throw new Error(`the map window slid too far left: ${clamped.x}`);
if (released) throw new Error('releasing the mouse did not end the drag');

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
await press('j');
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
await press('a');
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

await press('Escape');
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
  window.__screen.itemWindow.setStatWindowForPc(window.__session.univ, 0);
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
await press('1');
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
await press('1'); // raise Strength
await page.waitForTimeout(200);
await press('k'); // Keep
await page.waitForTimeout(250);
const trained = await page.evaluate(() => ({
  str: window.__univ.party.pcs[0].skills[0],
  gold: window.__univ.party.gold,
  dialogGone: !window.__dialogs.active,
}));
console.log('TRAINED:', JSON.stringify({ trainBefore, trained }));

// 2b-4a. The job board. Valleydy has no JOB_BANK node, so the step supplies a
//        quest for board 0 and opens it the way the node would.
await page.evaluate(async () => {
  const s = window.__session;
  const q = {
    deadlineIsRelative: true, autoStart: false, deadline: 30, event: -1,
    xp: 100, gold: 250, bank1: 0, bank2: -1,
    name: 'Find the cow', descr: 'It wandered off.',
  };
  window.__jobQuest = s.univ.scenario.quests.length;
  s.univ.scenario.quests.push(q);
  // generate_job_bank offers each eligible quest on a 50% roll, so a board
  // left to roll itself is empty half the time. The rolling is unit-tested;
  // this step pins the offer so it can check the board and taking a job.
  const bank = s.univ.party.jobBank(0);
  bank.jobs = [window.__jobQuest, -1, -1, -1, -1, -1];
  bank.inited = true;
  s.onJobBank(0, 'THE JOB BOARD:', s.talk ? s.talk.personality : 0);
});
await page.waitForTimeout(250);
const board = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d ? { text: d.spec.text, rows: d.spec.rows.map((r) => r.label) } : null;
});
await shot('01b4a-job-board');
await press('1'); // Take the job
await page.waitForTimeout(250);
const tookJob = await page.evaluate(() => {
  const s = window.__session;
  const job = s.univ.party.activeQuests.get(window.__jobQuest);
  const d = window.__dialogs.active;
  return {
    status: job ? job.status : null,
    start: job ? job.start : null,
    // The board's own feedback line changes to "Job accepted.". The offer
    // itself stays: with no spare to swap in, the C++ leaves the slot alone
    // despite its own "otherwise, clear space" comment.
    prompt: d ? d.spec.text.split('\n').at(-1) : null,
    rows: d ? d.spec.rows.length : null,
  };
});
console.log('JOB BOARD:', JSON.stringify({ board, tookJob }));
await press('d'); // Done
await page.waitForTimeout(250);
await page.evaluate(() => {
  window.__session.univ.scenario.quests.length = window.__jobQuest;
  window.__session.univ.party.activeQuests.delete(window.__jobQuest);
  window.__session.univ.party.jobBanks.length = 0;
});

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
await press('b');
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
  await press('3');
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
  const reachable = s.reachableItems(s.univ.party.townLoc).items;
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

// 2e2. Using an item: put a healing potion in a magically apt PC's pack, check
// the USE button is drawn on its row, and click it. PC 3 (Adrianna) is used
// because PC 0 in the pregen party is magically inept and refuses magic items.
const usedItem = await page.evaluate(async () => {
  const s = window.__session;
  const sc = window.__screen;
  const pc = s.univ.party.pcs[3];
  // A potion of healing: AFFECT_HEALTH, HELP_ONE, two doses.
  pc.items[0] = {
    ...pc.items[0],
    variety: 7, itemLevel: 0, charges: 2, ability: 76, abilStrength: 3,
    magicUseType: 0, graphicNum: 0, name: 'test potion', fullName: 'test potion',
    ident: true, rechargeable: false, weight: 5, desc: '',
  };
  pc.equip[0] = false;
  pc.curHealth = 1;
  sc.itemWindow.setStatWindowForPc(s.univ, 3);
  s.univ.curPc = 3;
  window.__redraw();

  // The Use button's rect, in screen coordinates, and what a click there hits.
  return { before: { hp: pc.curHealth, charges: pc.items[0].charges }, page: sc.itemPage };
});
// Click the Use button on row 0 by walking the panel for the hit rect.
const useClick = await page.evaluate(() => {
  const sc = window.__screen;
  // Scan the inventory panel for the point that reports part 'use' on row 0.
  for (let y = 0; y < 430; y++)
    for (let x = 0; x < 605; x++) {
      const h = sc.inventoryHit(x, y);
      if (h && h.row === 0 && h.part === 'use') return { x, y };
    }
  return null;
});
if (useClick) {
  // Map canvas coordinates to page coordinates through the element's real
  // bounding box, since the canvas is CSS-scaled.
  const at = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    return {
      x: r.left + (x + 0.5) * (r.width / canvas.width),
      y: r.top + (y + 0.5) * (r.height / canvas.height),
    };
  }, useClick);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
}
const useResult = await page.evaluate(() => {
  const pc = window.__session.univ.party.pcs[3];
  return {
    hp: pc.curHealth,
    charges: pc.items[0].charges,
    tail: window.__session.univ.transcript.slice(-2),
  };
});
console.log('USE ITEM:', JSON.stringify({ ...usedItem, at: useClick, after: useResult }));
if (!useClick) throw new Error('the USE button was not drawn on a usable item');
if (useResult.charges !== 1) throw new Error('using the potion did not spend a charge');
if (useResult.hp <= 1) throw new Error('using the potion did not heal');
await shot('01e2-item-use');

// 2e3. Alchemy (A): give the party a recipe and PC 1 the plant it needs, then
//      mix it through the two dialogs. Skill 13 against difficulty 1 is nine
//      clear of the fail table, so the roll can't fail.
await page.evaluate(() => {
  const s = window.__session;
  s.univ.party.alchemy[1] = true; // HEAL_WEAK, one ingredient: comfrey (151)
  const pc = s.univ.party.pcs[0];
  pc.skills[12] = 13; // Skill.ALCHEMY
  pc.items[0] = {
    ...pc.items[0],
    variety: 21, itemLevel: 0, charges: 1, maxCharges: 1, ability: 151,
    abilStrength: 0, graphicNum: 0, name: 'comfrey', fullName: 'comfrey root',
    ident: true, rechargeable: false, weight: 1, desc: '',
  };
  pc.equip[0] = false;
  window.__screen.itemWindow.setStatWindowForPc(window.__session.univ, 0);
  s.univ.curPc = 0;
  window.__redraw();
});
await press('A');
await page.waitForTimeout(250);
const alchWho = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d ? { text: d.spec.text, rows: d.spec.rows.length } : null;
});
await press('1'); // PC 1 mixes
await page.waitForTimeout(250);
const alchList = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d ? { rows: d.spec.rows.map((r) => r.label), text: d.spec.text } : null;
});
await shot('01e3-alchemy');
await press('1'); // the only recipe on the list
await page.waitForTimeout(300);
const mixed = await page.evaluate(() => {
  const pc = window.__session.univ.party.pcs[0];
  const potion = pc.items.find((i) => i.variety === 7);
  return {
    potion: potion ? { name: potion.fullName, charges: potion.charges, abil: potion.ability } : null,
    plantGone: !pc.items.some((i) => i.ability === 151),
    tail: window.__session.univ.transcript.slice(-1),
    dialogGone: !window.__dialogs.active,
  };
});
console.log('ALCHEMY:', JSON.stringify({ alchWho, alchList, mixed }));

// 2e4. The PC info sheet (pc-info.xml) — the first dialog running on the real
//      dialogxml definitions. Clicking the "?" beside a PC opens it; the
//      arrows step through the party without closing it.
const infoAt = await page.evaluate(() => {
  const sc = window.__screen;
  for (let y = 0; y < 430; y++)
    for (let x = 0; x < 605; x++) {
      const h = sc.pcRowHit(x, y);
      if (h && h.index === 0 && h.part === 'info') return { x, y };
    }
  return null;
});
if (infoAt) {
  const at = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    return {
      x: r.left + (x + 0.5) * (r.width / canvas.width),
      y: r.top + (y + 0.5) * (r.height / canvas.height),
    };
  }, infoAt);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
}
const pcInfo = await page.evaluate(() => {
  const d = window.__dialogs.active;
  if (!d || !d.def) return null;
  return {
    name: d.getText('name'),
    lvl: d.getText('lvl'),
    hp: d.getText('hp'),
    lbl1: d.getText('lbl1'),
    str: d.getText('str'),
    weapon: d.getText('weap1a'),
    controls: d.def.controls.length,
    size: { w: d.frame.right - d.frame.left, h: d.frame.bottom - d.frame.top },
  };
});
await shot('01e4-pc-info');
await press('ArrowRight');
await page.waitForTimeout(200);
const pcInfoNext = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d ? { name: d.getText('name'), stillOpen: true } : { stillOpen: false };
});
await press('Escape');
await page.waitForTimeout(200);
const pcInfoClosed = await page.evaluate(() => !window.__dialogs.active);
console.log('PC INFO:', JSON.stringify({ at: infoAt, pcInfo, pcInfoNext, pcInfoClosed }));

// 2e5. The item window's other two pages. Give the party a couple of the
//      scenario's special items and a quest of our own, then open each page
//      with its key, read a row's Info and check the row hit-testing follows
//      the scrollbar.
const specPage = await page.evaluate(() => {
  const s = window.__session;
  const sc = window.__screen;
  // Eleven special items in valleydy, so the list overflows the eight rows.
  for (let i = 0; i < s.univ.scenario.specialItems.length; i++) s.univ.party.specItems.add(i);
  // One useable item, so the Use button appears where Drop normally goes.
  s.univ.scenario.specialItems[0].flags = 1;
  window.__redraw();
  return { carried: s.univ.party.specItems.size, page: sc.itemWindow.mode };
});
await press('9');
await page.waitForTimeout(200);
const specOpen = await page.evaluate(() => {
  const sc = window.__screen;
  const names = sc.itemWindow.specItemArray.map(
    (i) => window.__session.univ.scenario.specialItems[i].name,
  );
  return {
    mode: sc.itemWindow.mode,
    listed: sc.itemWindow.specItemArray.length,
    scrollMax: sc.itemWindow.scrollMax,
    first: names[0],
    second: names[1],
  };
});
await shot('01e5-special-items');
// Scroll down one line with the scrollbar's bottom arrow, then check row 0 now
// reports the second entry.
const scrolled = await page.evaluate(() => {
  const sc = window.__screen;
  const bar = sc.itemSbar;
  const at = { x: bar.frame.left + 8, y: bar.frame.bottom - 8 };
  const canvas = document.querySelector('canvas');
  const r = canvas.getBoundingClientRect();
  return {
    at,
    page: {
      x: r.left + (at.x + 0.5) * (r.width / canvas.width),
      y: r.top + (at.y + 0.5) * (r.height / canvas.height),
    },
  };
});
await page.mouse.click(scrolled.page.x, scrolled.page.y);
await page.waitForTimeout(200);
const afterScroll = await page.evaluate(() => {
  const sc = window.__screen;
  // The top row's rect now answers with the second entry in the list.
  let topRow = null;
  for (let y = 0; y < 430 && topRow === null; y++)
    for (let x = 0; x < 605; x++) {
      const h = sc.inventoryHit(x, y);
      if (h && h.part === 'name') { topRow = h.row; break; }
    }
  return { scroll: sc.itemWindow.scroll, topRow };
});
// Info on the top row opens put_spec_item_info's description.
const infoRowAt = await page.evaluate(() => {
  const sc = window.__screen;
  for (let y = 0; y < 430; y++)
    for (let x = 0; x < 605; x++) {
      const h = sc.inventoryHit(x, y);
      if (h && h.part === 'info') {
        const canvas = document.querySelector('canvas');
        const r = canvas.getBoundingClientRect();
        return {
          row: h.row,
          x: r.left + (x + 0.5) * (r.width / canvas.width),
          y: r.top + (y + 0.5) * (r.height / canvas.height),
        };
      }
    }
  return null;
});
await page.mouse.click(infoRowAt.x, infoRowAt.y);
await page.waitForTimeout(250);
const specInfo = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d ? { title: d.spec.title, text: d.spec.text.slice(0, 40) } : null;
});
await press('Escape');
await page.waitForTimeout(200);

// The Quests page: valleydy ships none, so the test supplies one and takes it.
await page.evaluate(() => {
  const s = window.__session;
  s.univ.scenario.quests.push({
    deadlineIsRelative: true, autoStart: false, deadline: 30, event: -1,
    xp: 0, gold: 250, bank1: -1, bank2: -1,
    name: 'Verify quest', descr: 'Prove the quests page works.',
  });
  s.univ.party.activeQuests.set(s.univ.scenario.quests.length - 1,
    { status: 1, start: 1, source: -1 });
  window.__redraw();
});
await press('0');
await page.waitForTimeout(200);
const questPage = await page.evaluate(() => ({
  mode: window.__screen.itemWindow.mode,
  listed: window.__screen.itemWindow.specItemArray.slice(),
}));
await shot('01e6-quests');
const questInfoAt = await page.evaluate(() => {
  const sc = window.__screen;
  for (let y = 0; y < 430; y++)
    for (let x = 0; x < 605; x++) {
      const h = sc.inventoryHit(x, y);
      if (h && h.part === 'info' && h.row === 0) {
        const canvas = document.querySelector('canvas');
        const r = canvas.getBoundingClientRect();
        return {
          x: r.left + (x + 0.5) * (r.width / canvas.width),
          y: r.top + (y + 0.5) * (r.height / canvas.height),
        };
      }
    }
  return null;
});
await page.mouse.click(questInfoAt.x, questInfoAt.y);
await page.waitForTimeout(250);
const questInfo = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d && d.def
    ? { name: d.getText('name'), chop: d.getText('chop'), pay: d.getText('pay') }
    : null;
});
await shot('01e7-quest-info');
await press('Escape');
await page.waitForTimeout(200);
// Back to a PC's own page, and check the pack scrolls past the eighth slot.
await press('1');
await page.waitForTimeout(150);
const backToPack = await page.evaluate(() => ({
  mode: window.__screen.itemWindow.mode,
  scrollMax: window.__screen.itemWindow.scrollMax,
}));
console.log('ITEM PAGES:', JSON.stringify({
  specPage, specOpen, afterScroll, specInfo, questPage, questInfo, backToPack,
}));
if (specOpen.mode !== 6) throw new Error('9 did not open the special items page');
if (specOpen.listed !== specPage.carried) throw new Error('the special items page listed the wrong number');
if (specOpen.scrollMax !== specPage.carried - 8) throw new Error('the special items scrollbar has the wrong range');
if (afterScroll.scroll !== 1) throw new Error('the scrollbar arrow did not scroll the page');
if (afterScroll.topRow !== 1) throw new Error('a scrolled page still reports the first row');
// The page is scrolled by one, so the top row's Info is the *second* item.
if (!specInfo || specInfo.title !== specOpen.second) throw new Error('Info showed the wrong special item');
if (questPage.mode !== 7) throw new Error('0 did not open the quests page');
if (!questInfo || questInfo.name !== 'Verify quest') throw new Error('quest-info.xml did not fill');
if (questInfo.chop !== 'Day 31') throw new Error(`relative deadline read as ${questInfo.chop}`);
if (backToPack.mode !== 0 || backToPack.scrollMax !== 16) throw new Error('1 did not go back to the pack page');

// 2f. Searching a container. Fort Talrus's bookshelves and chests hold items
//     marked "contained", which do_look never lists; adj_town_look is what
//     opens them. Stand next to one and look at it.
// These steps walk the party around the fort; put them back afterwards, since
// the later steps place monsters relative to wherever the party is standing.
const partyWas = await page.evaluate(() => ({ ...window.__session.univ.party.townLoc }));
const container = await page.evaluate(() => {
  const s = window.__session;
  const town = s.univ.town;
  // A square that is a container and has something inside it.
  for (const item of town.items) {
    if (item.variety === 0 || !item.contained) continue;
    const at = item.itemLoc;
    if (!s.isContainer(at)) continue;
    // Stand directly below it, and make sure the square is explored and lit.
    s.univ.party.townLoc = { x: at.x, y: at.y + 1 };
    s.center = { ...s.univ.party.townLoc };
    s.updateExplored(s.univ.party.townLoc);
    window.__redraw();
    // Put an unidentified weapon in with it, so the detail line has something
    // to say: put_item_graphics shows interesting_string() under each name.
    town.items.push({
      ...item, name: 'test blade', fullName: 'Test Blade', ident: false,
      variety: 14, itemLevel: 6, bonus: 0, charges: 0, weight: 10,
      itemLoc: { x: at.x, y: at.y }, contained: true, held: true, property: false,
    });
    const inside = town.items.filter((i) => i.variety !== 0 && i.contained
      && i.itemLoc.x === at.x && i.itemLoc.y === at.y).map((i) => i.name);
    return { at: { ...at }, ter: town.record.terrain[at.x][at.y], inside };
  }
  return null;
});
if (!container) throw new Error('no container with contents found in Fort Talrus');
await press('l');
await press('ArrowUp');
await page.waitForTimeout(300);
const searched = await page.evaluate(() => {
  const d = window.__dialogs.active;
  if (!d) return { rows: null };
  return {
    title: d.dlg.getText('title'),
    rows: d.items.map((i) => i.name),
    // The three columns put_item_graphics fills for each row.
    name1: d.dlg.getText('item1-name'),
    detail1: d.dlg.getText('item1-detail'),
    weight1: d.dlg.getText('item1-weight'),
    detail2: d.dlg.getText('item2-detail'),
    prompt: d.dlg.getText('prompt'),
    tail: window.__session.univ.transcript.slice(-3),
  };
});
await shot('01d0-container');
console.log('CONTAINER:', JSON.stringify({ container, searched }));
if (!searched.rows) throw new Error('looking at a container did not open it');
if (searched.rows.length !== container.inside.length)
  throw new Error(`container held ${container.inside.length} but showed ${searched.rows.length}`);
if (searched.title !== 'Looking in container:') throw new Error('container title wrong');
if (!/^Weight: \d+$/.test(searched.weight1)) throw new Error(`weight not labelled: ${searched.weight1}`);
if (searched.detail2 !== 'Not identified.')
  throw new Error(`unidentified item's detail line read "${searched.detail2}"`);
if (!/carrying \d+ out of \d+\.$/.test(searched.prompt))
  throw new Error(`prompt line wrong: ${searched.prompt}`);
await press('Escape');
await page.waitForTimeout(200);

// Searching a plain square says so instead.
await page.evaluate(() => {
  const s = window.__session;
  s.univ.party.townLoc = { x: 21, y: 4 };
  s.center = { ...s.univ.party.townLoc };
  window.__redraw();
});
await press('l');
await press('ArrowUp');
await page.waitForTimeout(250);
const emptySearch = await page.evaluate(() => window.__session.univ.transcript.slice(-1)[0]);
console.log('SEARCH NOTHING:', JSON.stringify(emptySearch));

// 2f2. A ONCE_TRAP node asks Yes/No, and walking away leaves it armed. Fort
//      Talrus node 6 is the trap on Commander Terrance's belongings.
const trapSetup = await page.evaluate(async () => {
  const s = window.__session;
  const town = s.univ.town;
  const spot = town.record.specialLocs.find((l) => l.spec === 6);
  if (!spot) return null;
  const node = town.record.specials.get(6);
  s.univ.party.townLoc = { x: spot.x, y: spot.y + 1 };
  s.center = { ...s.univ.party.townLoc };
  s.updateExplored(s.univ.party.townLoc);
  window.__redraw();
  return {
    at: { x: spot.x, y: spot.y },
    sd: [node.sd1, node.sd2],
    sdBefore: s.univ.party.getSdf(node.sd1, node.sd2),
  };
});
if (!trapSetup) throw new Error('Fort Talrus has no ONCE_TRAP node 6');
await press('l');
await press('ArrowUp');
await page.waitForTimeout(300);
const trapAsked = await page.evaluate(() => {
  const d = window.__dialogs.active;
  // `fullText` is checked below: ONCE_TRAP takes only m1 and m2, and reading a
  // six-string run instead dragged the front gate's "leave the scenario"
  // question in behind the commander's belongings.
  return d ? {
    buttons: d.spec.buttons.map((b) => b.label),
    text: d.spec.text.slice(0, 45),
    bled: d.spec.text.includes('leave the scenario'),
  } : null;
});
// Say No: the one-shot flag stays unset so the trap is still there.
await press('n');
await page.waitForTimeout(250);
const trapRefused = await page.evaluate(() => {
  const s = window.__session;
  const node = s.univ.town.record.specials.get(6);
  return {
    dialogGone: !window.__dialogs.active,
    sd: s.univ.party.getSdf(node.sd1, node.sd2),
  };
});
// Look again: it comes back.
await press('l');
await press('ArrowUp');
await page.waitForTimeout(300);
const trapAgain = await page.evaluate(() => !!window.__dialogs.active);
// This time try to disarm it.
await press('y');
await page.waitForTimeout(300);
const trapWho = await page.evaluate(() => {
  const d = window.__dialogs.active;
  return d ? { text: d.spec.text, rows: d.spec.rows.length } : null;
});
await press('1');
await page.waitForTimeout(1500);
const trapRan = await page.evaluate(() => {
  const s = window.__session;
  const node = s.univ.town.record.specials.get(6);
  const d = window.__dialogs.active;
  return {
    // The trap guards a container, so surviving it opens what it was guarding.
    opened: d && d.dlg ? d.dlg.getText('title') : null,
    sd: s.univ.party.getSdf(node.sd1, node.sd2),
    tail: s.univ.transcript.slice(-8),
  };
});
await press('Escape');
await page.waitForTimeout(200);
console.log('TRAP:', JSON.stringify({ trapSetup, trapAsked, trapRefused, trapAgain, trapWho, trapRan }));
if (!trapAsked) throw new Error('the trap node put up no dialog');
if (trapAsked.bled)
  throw new Error('the trap dialog ran past m1 into the strings after it');
if (trapAsked.buttons.join(',') !== 'No,Yes')
  throw new Error(`trap buttons were ${trapAsked.buttons.join(',')}`);
if (trapRefused.sd === 250) throw new Error('refusing the trap still marked it done');
if (!trapAgain) throw new Error('the trap did not come back after refusing it');
if (!trapWho || !trapWho.text.startsWith('Trap! Who will disarm?'))
  throw new Error('disarming did not ask who');
if (trapRan.opened !== 'Looking in container:')
  throw new Error(`surviving the trap did not open what it guarded (${trapRan.opened})`);
if (!trapRan.tail.some((l) => /disarm/i.test(l)))
  throw new Error(`no disarm result in ${JSON.stringify(trapRan.tail)}`);
if (trapRan.sd !== 250) throw new Error(`a sprung trap did not mark itself done (sd ${trapRan.sd})`);

// 2g. Bash / Pick Lock / Use insist on plain town mode. Arming Bash twice
//     cancels; arming it during a conversation is refused.
await press('b');
await page.waitForTimeout(120);
const bashArmed = await page.evaluate(() => window.__session.univ.transcript.slice(-1)[0]);
await press('b');
await page.waitForTimeout(120);
const bashCancelled = await page.evaluate(() => window.__session.univ.transcript.slice(-1)[0]);
// And with something else in progress it refuses. Look mode is the cheapest
// non-town mode to get into.
await press('l');
await page.waitForTimeout(120);
await press('b');
await page.waitForTimeout(120);
const bashBusy = await page.evaluate(() => window.__session.univ.transcript.slice(-1)[0]);
await press('Escape');
await page.waitForTimeout(120);
const bashGate = { armed: bashArmed, cancelled: bashCancelled, busy: bashBusy };
console.log('BASH GATE:', JSON.stringify(bashGate));
if (!bashGate.armed.startsWith('Bash Door: Select')) throw new Error('b did not arm Bash Door');
if (!bashGate.cancelled.includes('Cancelled')) throw new Error('b again did not cancel Bash Door');
if (!bashGate.busy.includes('Finish what')) throw new Error('b was accepted mid-look');
await page.evaluate((was) => {
  const s = window.__session;
  s.univ.party.townLoc = { ...was };
  s.center = { ...was };
  window.__redraw();
}, partyWas);

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
  await press('l');
  await press('ArrowUp');
  await page.waitForTimeout(250);
}
const signShown = await page.evaluate(() => ({
  dialogOpen: !!window.__dialogs.active,
  tail: window.__session.univ.transcript.slice(-2),
}));
console.log('SIGN:', JSON.stringify({ ...sign, ...signShown }));
await shot('01d-sign');
await press('Enter');
await page.waitForTimeout(150);

// Look is a *mode* (MODE_LOOK_TOWN), which is what puts the twelve pointing
// arrows on the terrain view and makes the border scroll it. Press 'l', check
// the mode and the arrows, scroll one square, look at something, and check the
// mode and the camera both come back.
await press('l');
await page.waitForTimeout(150);
const looking = await page.evaluate(async () => {
  const modes = await import('/src/game/modes.ts');
  const s = window.__session;
  return {
    mode: s.mode,
    scrollable: modes.isScrollable(s.mode),
    centre: { ...s.center },
  };
});
await shot('01e-look-mode');
// A click on the terrain panel's border scrolls the view (the arrows are only
// a hint about where to click — the whole border is live).
const borderPt = await page.evaluate(() => {
  const sc = window.__screen;
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  for (let y = 19; y < 317; y++)
    for (let x = 7; x < 365; x++)
      if (sc.scrollBorderAt(x, y)?.dx === -1)
        return {
          x: r.left + (x + 0.5) * (r.width / c.width),
          y: r.top + (y + 0.5) * (r.height / c.height),
        };
  return null;
});
if (borderPt) {
  await page.mouse.click(borderPt.x, borderPt.y);
  await page.waitForTimeout(150);
}
const lookScrolled = await page.evaluate(() => ({ scrolled: { ...window.__session.center } }));
await press('Escape');
await page.waitForTimeout(150);
const lookEnded = await page.evaluate(() => ({
  mode: window.__session.mode,
  centre: { ...window.__session.center },
  party: { ...window.__session.univ.party.townLoc },
}));
console.log('LOOK MODE:', JSON.stringify({ ...looking, ...lookScrolled, ended: lookEnded }));

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
      // Direction enum: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7. Aim at the
      // town boundary rather than just "downhill", because Fort Talrus fills up
      // with wandering monsters and a greedy walker gets stuck against them.
      const dirOf = (dx, dy) => {
        const table = { '0,-1': 0, '1,-1': 1, '1,0': 2, '1,1': 3, '0,1': 4, '-1,1': 5, '-1,0': 6, '-1,-1': 7 };
        return table[`${Math.sign(dx)},${Math.sign(dy)}`] ?? 4;
      };
      let steps = 0;
      while (!done() && steps < limit) {
        if (window.__dialogs.active) return { steps, done: done(), waiting: true };
        const rect = s.univ.town?.record.inTownRect;
        const at = s.univ.party.townLoc;
        const target = goal === 'outdoors'
          ? { x: at.x, y: rect ? rect.bottom : at.y + 1 }
          : { x: at.x, y: rect ? rect.top : at.y - 1 };
        const want = dirOf(target.x - at.x, target.y - at.y);
        // The wanted direction, then its neighbours, then everything else.
        const order = [want, (want + 1) % 8, (want + 7) % 8, (want + 2) % 8, (want + 6) % 8,
          (want + 3) % 8, (want + 5) % 8, (want + 4) % 8];
        // Rotate the tail so a dead end doesn't trap the walker in a loop.
        const tail = order.slice(3);
        const spun = tail.slice(steps % tail.length).concat(tail.slice(0, steps % tail.length));
        let moved = false;
        for (const d of order.slice(0, 3).concat(spun)) {
          const result = await step(d);
          if (result === STALLED) return { steps, done: done(), waiting: true };
          if (result) { moved = true; break; }
          if (done()) break;
        }
        steps++;
        if (!moved && !done()) break;
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
    await press('Enter');
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

// 4a. Looking around outdoors must not blank the world. Ending a look calls
// the "put the view back" helper, which used to recentre on `town_loc` — a
// coordinate from the last town, or from a combat arena — and the whole 9x9
// window went black until the party moved.
await press('l');
await page.waitForTimeout(80);
await press('ArrowRight');
await page.waitForTimeout(120);
const lookOut = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  const scr = await import('/src/render/screen.ts');
  const dim = Math.min(96, 48 * univ.scenario.outWidth);
  let drawn = 0;
  for (let q = 0; q < 9; q++)
    for (let r = 0; r < 9; r++) {
      const x = s.center.x + q - 4;
      const y = s.center.y + r - 4;
      if (scr.canDrawTerrainSpot(s, x, y, dim, dim)) drawn++;
    }
  window.__redraw();
  return {
    drawn, mode: s.mode, centre: { ...s.center }, party: { ...univ.party.outLoc },
    tail: univ.transcript.slice(-2),
  };
});
console.log('LOOK OUTDOORS:', JSON.stringify(lookOut));

// 4b. The map again, outdoors — a different branch of draw_map (the sector
// window, offset by the party's quadrant of the 96x96 outdoor block).
await press('a');
await page.waitForTimeout(150);
const mapOut = await page.evaluate(() => {
  const ctx = document.getElementById('canvas').getContext('2d');
  const d = ctx.getImageData(2 * (52 + 47), 2 * (62 + 29), 480, 480).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return { visible: window.__screen.mapVisible, colours: seen.size };
});
await shot('02b-map-outdoors');
await press('a');
await page.waitForTimeout(150);
const mapOutClosed = await page.evaluate(() => window.__screen.mapVisible);
console.log('MAP OUTDOORS:', JSON.stringify(mapOut), 'closed:', mapOutClosed);

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

// 5b. A *real* scripted square, walked onto rather than driven synthetically:
//     the chain has to raise its message dialog, and Enter has to dismiss it.
//     The synthetic run above swaps the town's nodes out, so it never exercises
//     the walk-onto-a-special path the player actually takes.
const realSpecial = await page.evaluate(async () => {
  const s = window.__session;
  const t = s.univ.town?.record;
  const spot = t?.specialLocs?.find((l) => l.spec >= 0);
  if (!spot) return { skipped: true };
  s.univ.party.townLoc = { x: spot.x - 1, y: spot.y };
  void s.moveTo({ x: spot.x, y: spot.y });
  await new Promise((r) => setTimeout(r, 300));
  return { spot, dialogUp: !!window.__dialogs.active };
});
if (!realSpecial.skipped) {
  await press('Enter');
  await page.waitForTimeout(250);
}
const realSpecialDone = await page.evaluate(() => ({
  dialogGone: !window.__dialogs.active,
  loc: { ...window.__session.univ.party.townLoc },
}));
console.log('REAL SPECIAL:', JSON.stringify(realSpecial), JSON.stringify(realSpecialDone));

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
    // Awaited: a swing waits for its own blast now (`damage_pc` only takes the
    // health off after `boom_space` returns), so firing these off without
    // waiting would run twenty-five attacks on top of each other.
    await s.attackAt(monst.curLoc);
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

  // What the screen looks like *while* the monsters go, sampled from inside
  // the draw path rather than by polling — an extra `await` around the turn
  // changes how it interleaves with the game's own promise chain, and this
  // script is sensitive to that (it diverges on one microtask).
  const scr = await import('/src/render/screen.ts');
  const dim = univ.town.record.maxDim;
  const screen = window.__screen;
  const origDraw = screen.draw.bind(screen);
  const frames = [];
  screen.draw = (sess) => {
    if (sess.monstersGoing) {
      // `monsters_going` bypasses the explored map, so ground the party has
      // never walked but a PC can see draws instead of going black under the
      // monster standing on it.
      let unexploredDrawn = 0;
      for (let q = 0; q < 9; q++)
        for (let r = 0; r < 9; r++) {
          const x = sess.center.x + q - 4;
          const y = sess.center.y + r - 4;
          if (x < 0 || y < 0 || x >= dim || y >= dim) continue;
          if (univ.town.isExplored(x, y)) continue;
          if (scr.canDrawTerrainSpot(sess, x, y, dim, dim)) unexploredDrawn++;
        }
      frames.push({ bar: scr.statusBarText(sess), unexploredDrawn });
    }
    origDraw(sess);
  };

  let hurt = 0;
  for (let round = 0; round < 12 && hurt === 0; round++) {
    monst.active = 2; // ALERTED
    monst.curLoc = { x: univ.currentPc.combatPos.x + 1, y: univ.currentPc.combatPos.y };
    univ.party.pcs.forEach((pc) => { pc.ap = 0; });
    // The monsters' round waits on the animation timeline now — it is where
    // the C++ blocks — so it has to be awaited rather than read straight after.
    await s.startCombatRound();
    hurt = univ.party.pcs.reduce((n, pc) => n + (200 - pc.curHealth), 0);
  }
  screen.draw = origDraw;
  window.__redraw();
  return {
    hurt,
    taken: univ.party.totalDamTaken,
    tail: univ.transcript.slice(-4),
    // Frames drawn mid-turn, what the bar said on them, and the most
    // unexplored-but-visible squares any one of them drew.
    frames: frames.length,
    monstBar: frames.map((f) => f.bar).find((b) => / \(ap: \d+\)$/.test(b)) ?? null,
    unexploredDrawn: frames.reduce((n, f) => Math.max(n, f.unexploredDrawn), 0),
    // The bar outside the turn is the acting PC, not the location.
    pcBar: scr.statusBarText(s),
  };
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
    // The notice roll is one d100 per turn, and only while the creature is
    // still IDLE — the town is already hostile by this point, so it will come
    // over and attack either way and stop being IDLE the moment it does. Keep
    // re-arming it until it has actually noticed, or the assertion below is
    // riding on a single roll landing under 50.
    if (!noticed) monst.active = 1;
    await s.moveTo({ x: univ.party.townLoc.x, y: univ.party.townLoc.y - 1 });
    await s.moveTo({ x: univ.party.townLoc.x, y: univ.party.townLoc.y + 1 });
    // The monsters' reply to those steps is queued, not immediate — it waits
    // on the animation timeline. Let it land before reading the damage, which
    // is what the input gate makes the player do anyway.
    await s.settled();
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
    await s.attackAt(monst.curLoc);
  }
  const boomCount = window.__screen.booms.length;
  const boom = boomCount > 0 ? { ...window.__screen.booms[0], where: { ...window.__screen.booms[0].where } } : null;
  window.__redraw();
  window.__setLivingSound(null);
  return { boomCount, boom, played, hurt: before - monst.health };
});
console.log('BOOMS:', JSON.stringify(booms));
await shot('02c4-boom');

// A corpse leaves loot: place_treasure runs from kill_monst, so finishing a
// well-stocked monster off has to leave items on its square.
const loot = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  const monst = univ.town.monsters.find((m) => m.isAlive);
  if (!monst) return { skipped: true };
  monst.attitude = 1;
  monst.mon.armor = 0;
  monst.mon.treasure = 4; // the richest class, so something is near certain
  monst.mon.level = 20;
  monst.curLoc = { x: univ.currentPc.combatPos.x, y: univ.currentPc.combatPos.y - 1 };
  monst.health = 1;
  const where = { ...monst.curLoc };
  const before = univ.town.items.length;
  const pc = univ.currentPc;
  pc.skills[3] = 20; pc.skills[1] = 20;
  pc.items[0] = { ...pc.items[0], variety: 1, name: 'sword', fullName: 'sword',
    itemLevel: 10, weapType: 3, ability: 0 };
  pc.equip[0] = true;
  for (let i = 0; i < 30 && monst.isAlive; i++) {
    pc.ap = 4;
    await s.attackAt(where);
  }
  const dropped = univ.town.items.filter((it) => it.itemLoc.x === where.x && it.itemLoc.y === where.y);
  window.__redraw();
  return {
    dead: !monst.isAlive, before, after: univ.town.items.length,
    dropped: dropped.map((it) => it.fullName || it.name),
  };
});
console.log('LOOT:', JSON.stringify(loot));
await shot('02c5-loot');

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
await press('a'); // the Attack button's def-key
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
const parryButtons = await page.evaluate(async () => {
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
  await s.pause();
  out.standReady = { value: next.parry, ap: next.ap };
  s.endCombat();
  window.__redraw();
  return out;
});
// Missiles: 's' arms the current PC's bow and the next square clicked is the
// shot. Drive it through the real key handler so the mode change is exercised.
const missile = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  if (s.mode !== 9) s.startCombat(univ.party.direction);
  univ.curPc = 0;
  const pc = univ.party.pcs[0];
  pc.ap = 10;
  // A bow and thirty arrows, both equipped in the first two slots.
  const blank = () => JSON.parse(JSON.stringify(pc.items[0]));
  const bow = blank(); bow.variety = 4; bow.name = 'Bow'; bow.bonus = 20; bow.charges = 1;
  const arrows = blank();
  arrows.variety = 5; arrows.name = 'Arrows'; arrows.itemLevel = 8;
  arrows.bonus = 30; arrows.charges = 30; arrows.ability = 0;
  arrows.missile = 0; // the arrow sprite — -1 would fly invisibly
  pc.items[0] = bow; pc.items[1] = arrows;
  pc.equip[0] = true; pc.equip[1] = true;
  pc.skills[7] = 20; // ARCHERY
  const monst = univ.town.monsters.find((m) => m.isAlive);
  monst.attitude = 1;
  monst.curLoc = { x: pc.combatPos.x + 2, y: pc.combatPos.y };
  monst.maxHealth = 400; monst.health = 400;
  window.__missileTarget = { ...monst.curLoc };
  window.__missileMonst = monst;
  return { armedBefore: s.missile !== null };
});
await press('s');
await page.waitForTimeout(100);
const missileAimed = await page.evaluate(() => {
  const s = window.__session;
  window.__redraw();
  return {
    mode: s.mode, armed: s.missile !== null,
    tail: s.univ.transcript.slice(-2),
  };
});
await shot('02g-aiming');
const missileFired = await page.evaluate(async () => {
  const s = window.__session;
  const monst = window.__missileMonst;
  // Re-assert the shot's setup. Arming the bow went through a real keypress,
  // and waiting for the game to accept it let any queued monster round finish
  // — which hands the turn to whoever is up next and lets the target move. The
  // archer with the bow is PC 0, so put them back in charge and the target
  // back in front of them.
  s.univ.curPc = 0;
  monst.curLoc = { x: s.univ.party.pcs[0].combatPos.x + 2, y: s.univ.party.pcs[0].combatPos.y };
  window.__missileTarget = { ...monst.curLoc };
  const before = monst.health;
  const arrows = s.univ.party.pcs[0].items[1].charges;
  // Empty the air first. The step before this one makes the town hostile, and a
  // townsperson's thrown spear can still be in flight here — since monster
  // missiles became visible, `missiles` is not the party's shot alone.
  window.__screen.missiles = [];
  // Started, then sampled, then awaited. `fireMissileAt` runs as far as
  // `run_a_missile` synchronously — the arrow is in the air the moment the
  // call is made — but it no longer *returns* there: the damage behind it
  // waits for the flight and the blast. Awaiting first would read the sink
  // after the arrow had already landed and been swept up.
  const shot = s.fireMissileAt(window.__missileTarget);
  const launched = window.__screen.missiles.map((m) => ({
    type: m.type, path: m.pathType, from: m.from, dest: m.dest,
  }));
  await shot;
  window.__redraw();
  return {
    mode: s.mode, armed: s.missile !== null,
    hurt: before - monst.health,
    spent: arrows - s.univ.party.pcs[0].items[1].charges,
    launched,
    tail: s.univ.transcript.slice(-3),
  };
});
console.log('MISSILE:', JSON.stringify({ ...missile, ...missileAimed, fired: missileFired }));
// The projectile itself, held still halfway along its path so the screenshot
// is deterministic: pushing straight onto the screen skips the rAF loop that
// would otherwise expire it mid-capture.
const missileFlight = await page.evaluate(() => {
  const s = window.__session;
  const pc = s.univ.party.pcs[0];
  const from = { ...pc.combatPos };
  window.__screen.booms = []; // the last shot's explosion would sit on top
  const shots = [
    // Rows 0-6 of missiles.png are directional; 7 and up are animated, so
    // these three cover both halves of the sprite lookup and both path types.
    { type: 3, pathType: 1, dx: 4, dy: 0 }, // an arrow, lobbed, due east
    { type: 1, pathType: 0, dx: 0, dy: -3 }, // a dart, flat, due north
    { type: 8, pathType: 0, dx: -3, dy: 3 }, // an animated spinner, south-west
  ];
  window.__screen.missiles = shots.map((sh) => ({
    from,
    dest: { x: from.x + sh.dx, y: from.y + sh.dy },
    type: sh.type,
    pathType: sh.pathType,
    xAdj: 0,
    yAdj: 0,
    len: 100,
    started: performance.now() - 100, // halfway through a 200ms flight
  }));
  window.__redraw();
  return { drawn: window.__screen.missiles.length };
});
await shot('02h-missile-flight');
await page.evaluate(() => {
  window.__screen.missiles = [];
  window.__redraw();
});
console.log('MISSILE FLIGHT:', JSON.stringify(missileFlight));

// place_spell_pattern: lay a protective circle down next to the party. It is
// the one builtin whose cells are field types rather than a single shape, so
// one call raises four different kinds of wall in concentric rings — which
// makes it the best single check that the tables and the field overlay agree.
const pattern = await page.evaluate(async () => {
  const s = window.__session;
  const town = s.univ.town;
  if (!town) return { skipped: 'not in a town' };
  const pc = s.univ.party.pcs[s.univ.firstActivePc()];
  const at = { ...(s.mode === 9 ? pc.combatPos : s.univ.party.townLoc) };
  s.center = { ...at };
  await window.__placePattern(at);
  // Count what actually landed, by ring: 1 = force wall, 5 = ice, 6 = blades,
  // 3 = antimagic.
  const counts = { forceWall: 0, ice: 0, blades: 0, antimagic: 0 };
  for (let x = at.x - 4; x <= at.x + 4; x++)
    for (let y = at.y - 4; y <= at.y + 4; y++) {
      if (town.hasField(x, y, 1)) counts.forceWall++;
      if (town.hasField(x, y, 5)) counts.ice++;
      if (town.hasField(x, y, 6)) counts.blades++;
      if (town.hasField(x, y, 3)) counts.antimagic++;
    }
  window.__redraw();
  return { at, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
});
await shot('02i-spell-pattern');
console.log('SPELL PATTERN:', JSON.stringify(pattern));

// Spell targeting: the crosshair follows the cursor, and the click lands where
// it points. Both were broken once — every targeting click was reduced to one
// step toward the target, so no spell could reach past an adjacent square.
const targeting = await page.evaluate(async () => {
  const s = window.__session;
  if (s.mode === 9) s.endCombat();
  const targetMod = await import('/src/game/spellTarget.ts');
  const patMod = await import('/src/data/pattern.ts');
  const spellMod = await import('/src/data/spell.ts');
  s.univ.party.townLoc = { x: 20, y: 20 };
  s.center = { x: 20, y: 20 };
  s.univ.curPc = 3;
  // Make the destination the same terrain the party stands on, so Wall of
  // Force has somewhere legal to land.
  s.univ.town.record.terrain[23][20] = s.univ.town.record.terrain[20][20];
  targetMod.startTownTargeting(
    s, spellMod.Spell.BARRIER_FORCE, 3, false, patMod.SpellPat.RADIUS_2, 1);
  window.__redraw();
  return { mode: s.mode, range: s.townTarget?.range };
});
// Hover three squares east of centre — cell (7, 4) of the 9x9 view.
const targetCell = await page.evaluate(() => {
  const sc = window.__screen;
  for (let y = 0; y < 430; y++)
    for (let x = 0; x < 605; x++) {
      const c = sc.terrainCellAt(x, y);
      if (c && c.q === 7 && c.r === 4) return { x, y };
    }
  return null;
});
const targetPt = await page.evaluate(({ x, y }) => {
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  return {
    x: r.left + (x + 0.5) * (r.width / c.width),
    y: r.top + (y + 0.5) * (r.height / c.height),
  };
}, targetCell);
await page.mouse.move(targetPt.x, targetPt.y);
await page.waitForTimeout(250);
const hovering = await page.evaluate(() => window.__screen.hover !== null);
await shot('02c4-spell-targeting');
await page.mouse.click(targetPt.x, targetPt.y);
await page.waitForTimeout(300);
const landed = await page.evaluate(() => {
  const t = window.__session.univ.town;
  // WALL_FORCE is 14; find where the barrier actually went.
  const at = [];
  for (let x = 15; x < 30; x++)
    for (let y = 15; y < 26; y++)
      if (t.fields[x] && t.fields[x][y] && t.fields[x][y].has(14)) at.push({ x, y });
  return { mode: window.__session.mode, at };
});
console.log('SPELL TARGETING:', JSON.stringify({ ...targeting, hovering, landed }));

// The viewport arrows, and the projectile a combat spell throws. Both were
// missing: draw_pointing_arrows had never been ported, and do_combat_cast
// dropped every add_missile, so Flame did damage with nothing visible.
const combatSpell = await page.evaluate(async () => {
  const s = window.__session;
  const sc = window.__screen;
  const tgt = await import('/src/game/spellCombatTarget.ts');
  const sp = await import('/src/data/spell.ts');
  if (s.mode !== 9) s.startCombat(s.univ.party.direction);
  const pc = s.univ.party.pcs[3];
  s.univ.curPc = 3;
  pc.curSp = 50;
  pc.ap = 10;
  s.center = { ...pc.combatPos };
  tgt.startSpellTargeting(s, sp.Spell.FLAME, false, 1);
  window.__redraw();
  // The arrows only exist in scrollableModes, and the border scrolls the view.
  const shift = sc.scrollBorderAt(22, 190);
  const before = { ...s.center };
  const moved = shift ? s.screenShift(shift.dx, shift.dy) : false;
  const scrolled = { ...s.center };
  s.center = { ...pc.combatPos };

  // Scrolling while aiming must reveal ground the party can see but hasn't
  // walked near: in combat the draw gate bypasses the explored map whenever
  // the mode isn't plain MODE_COMBAT (boe.graphics.cpp:939).
  const countVisible = () => {
    let n = 0;
    let unexplored = 0;
    for (let q = 0; q < 9; q++)
      for (let r = 0; r < 9; r++) {
        const p = { x: s.center.x + q - 4, y: s.center.y + r - 4 };
        if (s.partyCanSee(p) < 6) n++;
        if (!s.univ.town.isExplored(p.x, p.y)) unexplored++;
      }
    return { visible: n, unexplored };
  };
  for (let i = 0; i < 4; i++) s.screenShift(1, 0);
  const scrolledView = countVisible();
  s.center = { ...pc.combatPos };

  // Now the spell itself, at a monster three squares east.
  sc.missiles.length = 0;
  // Recorded as they launch: a cast waits for its own explosion now, so by
  // the time it returns the renderer has swept the sky clean.
  const flew = [];
  window.__watchAnim((m) => flew.push({ type: m.type, from: m.from, dest: m.dest }), null);
  const at = { x: pc.combatPos.x + 3, y: pc.combatPos.y };
  const monst = s.univ.town.monsters.find((m) => m.isAlive);
  if (monst) { monst.curLoc = { ...at }; monst.attitude = 2; }
  const hpBefore = monst ? monst.health : null;
  tgt.startSpellTargeting(s, sp.Spell.FLAME, false, 1);
  await tgt.doCombatCast(s, at);
  window.__watchAnim(null, null);
  window.__redraw();
  return {
    scroll: { shift, moved, before, scrolled },
    scrolledView,
    hpBefore,
    hpAfter: monst ? monst.health : null,
    missiles: flew,
  };
});
console.log('COMBAT SPELL:', JSON.stringify(combatSpell));

// The explosion must not beat the projectile onto the screen. Fireball is the
// case that broke: it damages inside its own arm, so its boom used to be
// created before the shared volley booked the missile's slot.
// Quiet first: a monster round left over from the step before would be laying
// down its own "takes N" lines while this one measures, and this step is about
// what *the fireball* says and when.
await idle();
const boomOrder = await page.evaluate(async () => {
  const s = window.__session;
  const sc = window.__screen;
  const tgt = await import('/src/game/spellCombatTarget.ts');
  const sp = await import('/src/data/spell.ts');
  if (s.mode !== 9) s.startCombat(s.univ.party.direction);
  const pc = s.univ.party.pcs[3];
  s.univ.curPc = 3;
  pc.curSp = 50;
  pc.ap = 10;
  s.center = { ...pc.combatPos };
  sc.missiles.length = 0;
  sc.booms.length = 0;
  const at = { x: pc.combatPos.x + 3, y: pc.combatPos.y };
  const monst = s.univ.town.monsters.find((m) => m.isAlive);
  if (monst) { monst.curLoc = { ...at }; monst.attitude = 2; monst.health = 500; }
  const linesBefore = s.univ.visibleTranscript(performance.now()).length;
  tgt.startSpellTargeting(s, sp.Spell.FIREBALL, false, 1);
  const missiles = [];
  const booms = [];
  // Both sinks feed the screen, and the screen sweeps expired ones up — with
  // the cast awaited, reading `sc.missiles` afterwards would find an empty
  // sky. Record them as they are raised instead.
  const missileSink = (m) => missiles.push(m.started);
  const boomSink = (b) => booms.push(b.starts);
  window.__watchAnim(missileSink, boomSink);
  await tgt.doCombatCast(s, at);
  window.__watchAnim(null, null);
  // The question is one of *scheduling*, not of when this script happened to
  // look: nothing the spell says about damage may be due before its
  // projectiles have landed. `visibleTranscript(t)` is the pane as it stood at
  // time `t`, so asking it at the launch moment is the sample-independent
  // version of "the damage text must not beat the projectile".
  const launch = missiles.length > 0 ? Math.max(...missiles) : 0;
  // Every line the cast added, with the moment it is due on screen.
  const added = s.univ.transcript.slice(linesBefore).map((text, i) => ({
    text, at: s.univ.transcriptAt[linesBefore + i],
  }));
  const damageLines = added.filter((l) => / takes \d+|is dead|undamaged/.test(l.text));
  return {
    missiles,
    booms,
    // The spell's own announcements ("… casts Fireball.") are due before the
    // projectiles, as they should be; what must not be is anything that says
    // what the spell *did*.
    damageBeforeLanding: damageLines.filter((l) => l.at <= launch).length,
    damageLines: damageLines.length,
    linesEventually: s.univ.visibleTranscript(Infinity).length - linesBefore,
  };
});
console.log('BOOM ORDER:', JSON.stringify(boomOrder));
if (boomOrder.missiles.length === 0 || boomOrder.booms.length === 0)
  throw new Error(`Fireball produced ${JSON.stringify(boomOrder)}`);
if (!boomOrder.booms.every((b) => b >= Math.max(...boomOrder.missiles) + 200))
  throw new Error(`the explosion beat the projectile: ${JSON.stringify(boomOrder)}`);
if (boomOrder.linesEventually <= 0)
  throw new Error('Fireball said nothing at all, so the text test proves nothing');
if (boomOrder.damageLines === 0)
  throw new Error('Fireball damaged nothing, so the text test proves nothing');
if (boomOrder.damageBeforeLanding !== 0)
  throw new Error(`the damage text beat the projectile: ${JSON.stringify(boomOrder)}`);
await page.evaluate(async () => { if (window.__session.mode === 9) window.__session.endCombat(); });
if (!combatSpell.scroll.moved || combatSpell.scroll.scrolled.x !== combatSpell.scroll.before.x - 1)
  throw new Error('clicking the terrain border did not scroll the view');
// Squares genuinely behind a wall stay dark, so the test isn't "all 81 draw" —
// it's that more of them are visible than the explored map alone would allow.
if (combatSpell.scrolledView.unexplored === 0)
  throw new Error('the scrolled view was entirely explored, so it proves nothing');
if (combatSpell.scrolledView.visible <= 81 - combatSpell.scrolledView.unexplored)
  throw new Error(
    `scrolling while aiming revealed nothing new: ${JSON.stringify(combatSpell.scrolledView)}`);
if (combatSpell.missiles.length !== 1 || combatSpell.missiles[0].type !== 2)
  throw new Error(`Flame threw no projectile: ${JSON.stringify(combatSpell.missiles)}`);
if (!(combatSpell.hpAfter < combatSpell.hpBefore))
  throw new Error('Flame did no damage');
await shot('02c5-combat-spell');

if (!hovering) throw new Error('the targeting crosshair did not follow the cursor');
if (!landed.at.some((p) => p.x === 23 && p.y === 20))
  throw new Error(`the spell missed the square clicked: ${JSON.stringify(landed.at)}`);

console.log('PARRY:', JSON.stringify(parryButtons));
await shot('02c3-encounter');

// Random encounters outdoors: a wandering group walks up to the party on the
// world map, and the fight happens in a generated arena.
// Back out to the world map first: end any fight, drop scripting (the towns'
// own chains aren't what this step is testing), then walk out.
// Earlier steps left the party deep inside a hostile Marralis, which has no
// short way out. Re-enter the start town — whose exit the LEFT TOWN phase
// already walks — and leave from there, the same way a player would.
await page.evaluate(() => {
  const s = window.__session;
  s.specials = null;
  if (s.mode === 9) s.endCombat();
  s.startTownMode(s.univ.scenario.startTown, 9);
  for (const m of s.univ.town.monsters) m.active = 0;
  window.__redraw();
});
await walkUntil('outdoors');
const encounterOut = await page.evaluate(async () => {
  const s = window.__session;
  const univ = s.univ;
  if (s.mode !== 0) return { skipped: 'still not outdoors', mode: s.mode };
  // Step clear of the town's entrance square, or walking on the spot walks
  // straight back inside.
  for (let i = 0; i < 4 && s.mode === 0; i++) {
    await s.moveTo({ x: univ.party.outLoc.x, y: univ.party.outLoc.y + 1 });
  }
  if (s.mode !== 0) return { skipped: 'walked back into a town', mode: s.mode };

  const slot = univ.party.outC[0];
  slot.exists = true;
  slot.whatMonst = {
    monst: [1, 0, 0, 0, 0, 0, 0], friendly: [0, 0, 0],
    specOnMeet: -1, specOnWin: -1, specOnFlee: -1,
    cantFlee: true, forced: false, endSpec1: -1, endSpec2: -1,
  };
  slot.mLoc = { x: univ.party.outLoc.x + 3, y: univ.party.outLoc.y };
  window.__redraw();
  const drawn = { ...slot.mLoc };

  // Walk on the spot; the groups move every tenth turn and close in.
  let started = false;
  for (let i = 0; i < 120 && !started && s.mode === 0; i++) {
    await s.moveTo({ x: univ.party.outLoc.x + 1, y: univ.party.outLoc.y });
    await s.moveTo({ x: univ.party.outLoc.x - 1, y: univ.party.outLoc.y });
    started = s.mode === 9;
  }
  window.__redraw();
  return {
    drawn, started, mode: s.mode, combatType: s.whichCombatType,
    monsters: univ.town ? univ.town.monsters.filter((m) => m.isAlive).length : 0,
    arena: s.arena ? s.arena.name : null,
    pcPlaced: { ...univ.party.pcs[0].combatPos },
    // `hor_vert_place` — the wedge the party forms up in, as offsets from the
    // first PC: one in front, two behind, three across the back. This used to
    // be a 2x3 block invented in outCombat.ts.
    wedge: univ.party.pcs.map((p) => ({
      dx: p.combatPos.x - univ.party.pcs[0].combatPos.x,
      dy: p.combatPos.y - univ.party.pcs[0].combatPos.y,
    })),
    monstY: univ.town ? [...new Set(univ.town.monsters.filter((m) => m.isAlive)
      .map((m) => m.curLoc.y))].sort((a, b) => a - b) : [],
    tail: univ.transcript.slice(-3),
  };
});
console.log('OUTDOOR ENCOUNTER:', JSON.stringify(encounterOut));
await shot('02h-outdoor-arena');
const encounterEnd = await page.evaluate(() => {
  const s = window.__session;
  if (s.mode !== 9) return { skipped: true };
  const refused = s.endCombat();
  for (const m of s.univ.town.monsters) m.active = 0;
  const ended = s.endCombat();
  window.__redraw();
  return { refused, ended, mode: s.mode, townCleared: s.univ.town === null, arena: s.arena };
});
console.log('OUTDOOR ENCOUNTER END:', JSON.stringify(encounterEnd));

// Word of Recall — `position_party` and `force_town_enter` together. Cast it
// from wherever the outdoor wandering ended up, and the party should be
// standing in the scenario's start town with a fresh outdoor position under
// them for when they walk back out.
const recall = await page.evaluate(() => {
  const s = window.__session;
  const univ = window.__univ;
  if (s.mode !== 0) return { skipped: 'not outdoors', mode: s.mode };
  const from = { corner: { ...univ.party.outdoorCorner }, loc: { ...univ.party.outLoc } };
  // A wandering group in flight, to check the teleport forgets it.
  univ.party.outC[0].exists = true;
  univ.party.pcs[1].curSp = 40;
  window.__castSpell(1, 160 /* eSpell::WORD_RECALL */);
  window.__redraw();
  return {
    from,
    inTown: univ.party.townNum !== 200,
    town: univ.town ? univ.town.record.name : null,
    townNum: univ.party.townNum,
    startTown: univ.scenario.startTown,
    townLoc: { ...univ.party.townLoc },
    wantTownLoc: { ...univ.scenario.townStart },
    corner: { ...univ.party.outdoorCorner },
    wantCorner: { ...univ.scenario.outdoorStart },
    outLoc: { ...univ.party.outLoc },
    wantOutLoc: { ...univ.scenario.sectorStart },
    groupsLeft: univ.party.outC.filter((g) => g.exists).length,
    sp: univ.party.pcs[1].curSp,
    tail: univ.transcript.slice(-2),
  };
});
console.log('WORD OF RECALL:', JSON.stringify(recall));
await shot('02i-word-of-recall');

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
  (encounterOut.skipped !== undefined || (
    encounterOut.started === true &&
    encounterOut.combatType === 0 &&
    encounterOut.monsters >= 15 &&
    JSON.stringify(encounterOut.wedge) === JSON.stringify(
      [[0, 0], [-1, 1], [1, 1], [-2, 2], [0, 2], [2, 2]].map(([dx, dy]) => ({ dx, dy }))) &&
    encounterEnd.refused === false &&
    encounterEnd.ended === true &&
    encounterEnd.mode === 0)) &&
  (recall.skipped !== undefined || (
    recall.inTown === true &&
    recall.townNum === recall.startTown &&
    JSON.stringify(recall.townLoc) === JSON.stringify(recall.wantTownLoc) &&
    JSON.stringify(recall.corner) === JSON.stringify(recall.wantCorner) &&
    JSON.stringify(recall.outLoc) === JSON.stringify(recall.wantOutLoc) &&
    recall.groupsLeft === 0 &&
    recall.sp === 10)) &&
  missileAimed.armed === true &&
  missileAimed.mode === 11 &&
  missileFired.armed === false &&
  missileFired.mode === 9 &&
  missileFired.spent === 1 &&
  shopOpened?.rows > 0 &&
  shopOpened.inTown === true &&
  map.visible === true &&
  map.colours > 4 &&
  mapClosed === false &&
  mapOut.visible === true &&
  mapOut.colours > 4 &&
  mapOutClosed === false &&
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
  (realSpecial.skipped === true || realSpecial.dialogUp === true) &&
  realSpecialDone.dialogGone === true &&
  specials.branched === 7 &&
  specials.ptrX === 5 &&
  specials.realNodes > 0 &&
  bashDone.dialogGone === true &&
  (gotItem.skipped === true || gotItem.carried.includes(gotItem.name)) &&
  (sign.skipped === true || (sign.readable === true && signShown.dialogOpen === true)) &&
  outdoors.inTown === false &&
  roam.moves > 0 &&
  // The world is still there after a look, and the view is back on the party.
  lookOut.drawn > 0 &&
  lookOut.centre.x === lookOut.party.x && lookOut.centre.y === lookOut.party.y &&
  (combat.skipped === true || (combat.mode === 9 && combat.placed > 1
    && combat.hurt > 0 && combatEnd.ended === true && combatEnd.mode === 1
    && combatEnd.placed === 0)) &&
  (monstTurn.skipped === true || (monstTurn.hurt > 0
    // The monsters' turn is paced, so it must actually draw frames while it
    // runs, and those frames must name the monster that is going.
    && monstTurn.frames > 0 && monstTurn.monstBar !== null
    && / \(ap: \d+\)$/.test(monstTurn.pcBar))) &&
  fightButton.found === true &&
  fightButton.inFight === 9 &&
  fightButton.swordStillThere === false &&
  fightButton.backTo === 1 &&
  (encounter.skipped !== undefined || (encounter.noticed === true && encounter.hurt > 0)) &&
  (loot.skipped === true || (loot.dead === true && loot.dropped.length > 0)) &&
  placement.worst === null &&
  // sound_lookup[2] = 70 is the heavy-blade hit. Before the fix this played the
  // *sound type* (2) as a file number, which is the cash-register noise.
  (booms.skipped === true || (booms.boomCount > 0 && booms.boom.damage > 0
    && booms.played.includes(70))) &&
  // Look is a mode: the arrows show, the border scrolls, Escape puts it back.
  looking.mode === 18 && looking.scrollable === true &&
  lookScrolled.scrolled.x === looking.centre.x - 1 &&
  lookEnded.mode === 1 &&
  lookEnded.centre.x === lookEnded.party.x && lookEnded.centre.y === lookEnded.party.y &&
  reenter?.inTown === true &&
  // run_a_missile: the shot puts exactly one projectile in the air, and the
  // three held-still sprites all draw.
  missileFired.launched.length === 1 &&
  missileFlight.drawn === 3 &&
  // pc-info.xml: the real definition renders, fills from the PC, steps to the
  // next party member without closing, and closes on Escape.
  pcInfo !== null && pcInfo.controls > 50 && pcInfo.name.length > 0 &&
  pcInfo.lbl1 === 'Strength' && pcInfo.weapon.length > 0 &&
  pcInfoNext.stillOpen === true && pcInfoNext.name !== pcInfo.name &&
  pcInfoClosed === true &&
  // Alchemy: the two dialogs come up, the recipe shows its difficulty, and
  // mixing spends the plant and leaves a three-dose potion in the pack.
  alchWho !== null && alchList !== null && alchList.rows.length === 1 &&
  alchList.rows[0].includes('(1)') &&
  mixed.potion !== null && mixed.potion.charges === 3 && mixed.potion.abil === 76 &&
  mixed.plantGone === true && mixed.dialogGone === true &&
  // The job board offers the quest with its pay, and taking it starts the
  // quest (status 1 = STARTED) and clears the slot, there being no spare.
  board !== null && board.rows.length === 1 && board.rows[0].includes('250 gold') &&
  tookJob.status === 1 && tookJob.rows === 1 && tookJob.prompt === 'Job accepted.' &&
  // place_spell_pattern: the protective circle raises all four of its rings.
  (pattern.skipped !== undefined || (pattern.counts.forceWall > 0
    && pattern.counts.ice > 0 && pattern.counts.blades > 0
    && pattern.counts.antimagic > 0)) &&
  errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
