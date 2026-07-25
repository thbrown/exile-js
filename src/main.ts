/**
 * Entry point: load a scenario, build the universe, and run the game loop on
 * the classic 605x430 screen.
 */

import { shiftLoc } from './core/location';
import { GameRng } from './core/rng';
import { DialogHost } from './dialogs/dialog';
import { loadStringTables } from './data/strings';
import { TerSpec } from './data/terrain';
import { GameSession } from './game/session';
import { TalkAction } from './game/talk';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { FetchSource } from './fileio/source';
import { InputRouter } from './platform/input';
import { Snd, SoundPlayer } from './platform/sound';
import { BOE_HEIGHT, BOE_WIDTH, ToolbarButton } from './render/layout';
import { CHROME_SHEETS, Screen } from './render/screen';
import { ShopHit, shopItemInfo } from './render/shopScreen';
import { SheetStore } from './render/sheets';
import { itemWeight } from './universe/inventory';
import { PartyPreset } from './universe/player';
import { Skill } from './universe/skills';
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
  const fetchText = async (url: string): Promise<string> => (await fetch(url)).text();
  const opcodes = await loadOpcodes(fetchText);
  // Shops name their stock out of the string resources while parsing, so these
  // have to be in place before the scenario loads.
  await loadStringTables(fetchText);
  const scen = await loadScenario(new FetchSource(`/scenarios/${name}/`), opcodes);

  const store = new SheetStore();
  const sheets = [
    ...CHROME_SHEETS,
    'ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim',
    'dlogbtnlg', 'dlogbtnmed', 'dlogbtnsm',
  ];
  for (let i = 1; i <= 11; i++) sheets.push(`monst${i}`);
  await Promise.all(sheets.map((s) => store.load(s)));
  // Fonts load lazily on first use, so `fonts.ready` alone isn't enough — ask
  // for each face explicitly or the first paint lays out with fallback metrics.
  if (document.fonts) {
    await Promise.all([
      document.fonts.load('12px BoEPlain'),
      document.fonts.load('bold 10px BoEBold'),
      document.fonts.load('18px BoEDungeon'),
      document.fonts.load('12px BoEMaidenword'),
    ]);
    await document.fonts.ready;
  }

  const univ = new Universe(scen, new GameRng(), PartyPreset.DEFAULT);
  const session = new GameSession(univ);
  const sound = new SoundPlayer();
  session.sound = sound;
  session.startNewGame();
  const screen = new Screen(ctx, store);

  const redraw = (): void => {
    screen.draw(session);
    dialogs.draw();
  };
  const dialogs = new DialogHost(ctx, store, () => redraw());

  /**
   * get_text_response: a one-line typed answer. The dialogxml text field lands
   * with the rest of that toolkit; until then this borrows the browser prompt.
   */
  const askForText = async (prompt: string): Promise<string> =>
    // TODO(M3): replace with a canvas text field once dialogxml has one.
    Promise.resolve(window.prompt(prompt) ?? '');

  /**
   * select_pc (boe.items.cpp:878): ask which party member acts. Returns the PC
   * index, or -1 if cancelled. PCs who can't act are listed with the reason and
   * aren't selectable.
   */
  const selectPc = async (
    mode: 'living' | 'lockpick',
    prompt: string,
    highlight?: Skill,
  ): Promise<number> => {
    const options = session.selectPcOptions(mode, highlight);
    // select-pc.xml marks the best value in the highlighted skill in green.
    const best = Math.max(
      ...options.map((o, i) =>
        o.canPick && highlight !== undefined ? (univ.party.pcs[i]?.skills[highlight] ?? 0) : -1,
      ),
    );
    const rows = options.map((option) => ({
      name: String(option.index),
      key: String(option.index + 1),
      label: option.label,
      disabled: !option.canPick,
      highlight:
        highlight !== undefined &&
        option.canPick &&
        best > 0 &&
        (univ.party.pcs[option.index]?.skills[highlight] ?? 0) === best,
    }));
    const hint =
      highlight !== undefined
        ? `${prompt}\nSkill is shown in (). Highest in green. Type '1'-'6'.`
        : `${prompt}\nType '1'-'6'.`;
    const picked = await dialogs.run({
      text: hint,
      rows,
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel' }],
    });
    const index = Number(picked);
    return Number.isInteger(index) && options[index]?.canPick ? index : -1;
  };

  /**
   * A locked door: ask what to do and who does it, then act. This is the async
   * replacement for the C++ blocking cChoiceDlog + select_pc pair.
   */
  session.onLockedDoor = (where, terrain) => {
    // Bumping the door again while the prompt is up shouldn't stack prompts.
    if (dialogs.active) return;
    void (async () => {
      const choice = await dialogs.run({
        text: 'This door is locked.\nWhat do you do?',
        terPic: scen.terTypes[terrain]?.picture,
        escapeButton: 'leave',
        buttons: [
          { name: 'leave', label: 'Leave', key: 'l' },
          { name: 'bash', label: 'Bash Door', key: 'b' },
          { name: 'pick', label: 'Pick Lock', key: 'p' },
        ],
      });
      if (choice === 'bash') {
        const who = await selectPc('living', 'Who will bash?', Skill.STRENGTH);
        if (who >= 0) session.bashDoor(where, who);
      } else if (choice === 'pick') {
        const who = await selectPc('lockpick', 'Who will pick the lock?', Skill.LOCKPICKING);
        if (who >= 0) session.pickLock(where, who);
      }
      redraw();
    })();
  };

  /**
   * The Get action (get_item, boe.items.cpp:258): list what's in reach and let
   * the player take one at a time.
   */
  const getItems = async (): Promise<void> => {
    if (dialogs.active) return;
    const reachable = session.reachableItems(univ.party.townLoc);
    if (reachable.length === 0) {
      univ.addStringToBuf('Get: nothing here');
      redraw();
      return;
    }
    const picked = await dialogs.run({
      text: 'Take which item?',
      rows: reachable.slice(0, 9).map((item, i) => ({
        name: String(i),
        key: String(i + 1),
        label: `${item.ident ? item.fullName : item.name}${item.property ? ' (not yours)' : ''}`,
        itemPic: item.graphicNum,
      })),
      escapeButton: 'done',
      buttons: [{ name: 'done', label: 'Done' }],
    });
    const index = Number(picked);
    const item = reachable[index];
    if (item) {
      const who = await selectPc('living', 'Give the item to whom?');
      if (who >= 0) session.takeItem(item, who);
    }
    redraw();
  };

  /** A click on an inventory row: equip/unequip, give, drop, describe, or sell. */
  const handleInventoryClick = async (
    row: number,
    part: 'name' | 'give' | 'drop' | 'info' | 'spec',
  ): Promise<void> => {
    const pc = univ.party.pcs[screen.itemPage];
    const item = pc?.items[row];
    if (!pc || !item || item.variety === 0) return;
    if (part === 'spec') {
      session.useItemShop(screen.itemPage, row);
    } else if (part === 'name' && session.itemShop) {
      // While a shopkeeper is waiting, the name isn't an equip toggle.
      univ.addStringToBuf('  Click the button beside the item.');
    } else if (part === 'name') {
      session.toggleEquip(screen.itemPage, row);
    } else if (part === 'drop') {
      if (session.inTown) session.dropItem(screen.itemPage, row);
      else univ.addStringToBuf('  Not while outdoors.');
    } else if (part === 'give') {
      const who = await selectPc('living', 'Give the item to whom?');
      if (who >= 0 && who !== screen.itemPage) session.giveItemTo(screen.itemPage, row, who);
    } else {
      const lines = [item.ident ? item.fullName : item.name];
      if (item.desc) lines.push('', item.desc);
      lines.push('', `Weight: ${itemWeight(item)}   Value: ${item.value}`);
      await dialogs.run({
        text: lines.join('\n'),
        escapeButton: 'okay',
        buttons: [{ name: 'okay', label: 'OK' }],
      });
    }
    redraw();
  };

  // Browsers only allow audio after a user gesture, so the first keypress or
  // click is what actually starts it.
  const wakeSound = (): void => {
    void sound.resume().then(async () => {
      await sound.preloadCommon();
      // Terrain that changes when stepped on or used keeps its sound in flag2
      // (a door swinging, for instance). Other specials use flag2 for other
      // things, so only these two kinds contribute.
      const terrainSounds = new Set<number>();
      for (const ter of scen.terTypes)
        if (
          ter.flag2 > 0 &&
          (ter.special === TerSpec.CHANGE_WHEN_STEP_ON || ter.special === TerSpec.CHANGE_WHEN_USED)
        )
          terrainSounds.add(ter.flag2);
      await sound.preloadAll(terrainSounds);
    });
  };
  window.addEventListener('keydown', wakeSound, { once: true });
  canvas.addEventListener('mousedown', wakeSound, { once: true });

  /** What the next direction or view click should do instead of moving. */
  let pending: 'talk' | 'look' | null = null;

  const setStatus = (): void => {
    if (session.shop)
      status.textContent = "Click an item name (or type 'a'-'h') to buy; Esc to leave.";
    else if (session.talk) status.textContent = 'Click a highlighted word, or Done to stop talking.';
    else if (pending === 'talk') status.textContent = 'Talk to whom? (pick a direction)';
    else if (pending === 'look') status.textContent = 'Look where? (pick a direction)';
    else
      status.textContent =
        `${scen.title} — arrows to move, L look` +
        (session.inTown ? ', T talk, G get items, 1-6 whose pack to show.' : ', 1-6 whose pack to show.');
  };

  /** Follow a conversation choice, prompting for a topic when it's "Ask About". */
  const activateTalkWord = async (node: number): Promise<void> => {
    const talk = session.talk;
    if (!talk) return;
    if (node === TalkAction.ASK) {
      const asked = await askForText('Ask about what?');
      if (asked.trim().length > 0 && talk.askAbout(asked) === 'done') session.endTalkMode();
    } else {
      session.chooseTalkNode(node);
    }
    setStatus();
    redraw();
  };

  /** Buy, inspect, scroll or leave — the shop screen's four actions. */
  const handleShopHit = (hit: ShopHit): void => {
    const shop = session.shop;
    if (!shop) return;
    if (hit.part === 'done') {
      sound.play(Snd.BUTTON);
      session.endShopMode();
    } else if (hit.part === 'scroll') {
      shop.scrollBy(hit.delta);
    } else if (hit.part === 'buy') {
      session.buyShopRow(hit.row);
    } else {
      const info = shopItemInfo(shop, hit.row);
      if (info && !dialogs.active)
        void dialogs.run({
          text: info.text,
          escapeButton: 'okay',
          buttons: [{ name: 'okay', label: 'OK' }],
        }).then(() => redraw());
    }
    setStatus();
    redraw();
  };

  /** Look at a space: describe it, and read an adjacent sign if there is one. */
  const lookAt = (target: { x: number; y: number }): void => {
    const ter = session.lookAt(target);
    if (ter < 0) return;
    const sign = session.signAt(target);
    if (sign === null || dialogs.active) return;
    void dialogs.run({
      text: sign,
      terPic: scen.terTypes[ter]?.picture,
      escapeButton: 'okay',
      buttons: [{ name: 'okay', label: 'OK' }],
    });
  };

  /** Act on a target space according to what the player asked for. */
  const actOn = (target: { x: number; y: number }): void => {
    const what = pending;
    pending = null;
    if (what === 'talk') session.talkTo(target);
    else if (what === 'look') lookAt(target);
    else session.moveTo(target);
  };

  const router = new InputRouter(canvas, {
    onMove: (dir) => {
      if (dialogs.active || session.talk || session.shop) return;
      const from = session.inTown ? univ.party.townLoc : univ.party.outLoc;
      actOn(shiftLoc(from, dir));
      setStatus();
      redraw();
    },
    onClick: (x, y) => {
      if (dialogs.handleClick(x, y)) return;
      if (session.shop) {
        const hit = screen.shopScreen.hit(session.shop, x, y);
        if (hit) handleShopHit(hit);
        return;
      }
      // The inventory panel stays live during a conversation — that's how the
      // sell and identify services work, so it gets first refusal.
      const invenHit = screen.inventoryHit(x, y, session.itemShop !== null);
      if (invenHit) {
        sound.play(Snd.BUTTON);
        void handleInventoryClick(invenHit.row, invenHit.part);
        return;
      }
      if (session.talk) {
        const word = screen.talkScreen.wordAt(session.talk, x, y);
        if (word) void activateTalkWord(word.node);
        return;
      }
      const btn = screen.buttonAt(x, y);
      if (btn) {
        sound.play(Snd.BUTTON); // the UI click
        if (btn.btn === ToolbarButton.TALK) {
          pending = 'talk';
        } else if (btn.btn === ToolbarButton.LOOK) {
          pending = 'look';
        } else if (btn.btn === ToolbarButton.HAND) {
          void getItems();
        } else {
          // TODO(M3+): wire the remaining toolbar buttons to real actions.
          univ.addStringToBuf(`(${ToolbarButton[btn.btn]} is not implemented yet)`);
        }
        setStatus();
        redraw();
        return;
      }
      const cell = screen.terrainCellAt(x, y);
      if (cell) {
        const dx = Math.sign(cell.q - 4);
        const dy = Math.sign(cell.r - 4);
        if (dx === 0 && dy === 0) return;
        const from = session.inTown ? univ.party.townLoc : univ.party.outLoc;
        // Looking can reach anywhere in view; moving is one step at a time.
        const target =
          pending === 'look'
            ? { x: from.x + cell.q - 4, y: from.y + cell.r - 4 }
            : { x: from.x + dx, y: from.y + dy };
        actOn(target);
        setStatus();
        redraw();
      }
    },
    onKey: (key) => {
      if (dialogs.handleKey(key)) return;
      if (session.shop) {
        // shop_chars: 'a'-'h' buy the eight visible rows, Escape leaves.
        if (key === 'Escape') {
          handleShopHit({ part: 'done' });
          return;
        }
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          handleShopHit({ part: 'scroll', delta: key === 'ArrowUp' ? -1 : 1 });
          return;
        }
        const row = screen.shopScreen.rowForKey(session.shop, key);
        if (row >= 0) handleShopHit({ part: 'buy', row });
        return;
      }
      if (session.talk) {
        // Talking has its own letter shortcuts (talk_chars): l/n/j/b/s/r/d/g/a,
        // with Escape acting as Done and Space as Go Back.
        const preset = session.talk.presetForKey(key);
        if (preset) void activateTalkWord(preset.node);
        return;
      }
      if (key === 't' || key === 'T') {
        if (session.inTown) pending = 'talk';
        else univ.addStringToBuf('There is nobody to talk to out here.');
        setStatus();
        redraw();
      } else if (key === 'l' || key === 'L') {
        pending = 'look';
        setStatus();
      } else if (key === 'g' || key === 'G') {
        if (session.inTown) void getItems();
        else univ.addStringToBuf('Get: nothing here');
        redraw();
      } else if (key >= '1' && key <= '6') {
        // Switch which PC's inventory page is showing.
        screen.itemPage = Number(key) - 1;
        univ.curPc = screen.itemPage;
        redraw();
      } else if (key === 'Escape' && pending) {
        pending = null;
        setStatus();
      }
    },
  });
  router.attach();

  setStatus();
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
    __dialogs: dialogs,
  });
}

main().catch((err) => {
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
