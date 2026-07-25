/**
 * Entry point: load a scenario, build the universe, and run the game loop on
 * the classic 605x430 screen.
 */

import { shiftLoc } from './core/location';
import { GameRng } from './core/rng';
import { DialogHost } from './dialogs/dialog';
import { GameSession } from './game/session';
import { TalkAction } from './game/talk';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { FetchSource } from './fileio/source';
import { InputRouter } from './platform/input';
import { SoundPlayer } from './platform/sound';
import { BOE_HEIGHT, BOE_WIDTH, ToolbarButton } from './render/layout';
import { CHROME_SHEETS, Screen } from './render/screen';
import { SheetStore } from './render/sheets';
import { PartyPreset } from './universe/player';
import { Skill } from './universe/skills';
import { Universe } from './universe/universe';

/** Terrain animation ticks at 4 Hz, matching the C++ animation timer. */
const ANIM_INTERVAL_MS = 250;

const DEFAULT_SCENARIO = 'valleydy';

/** The living PC with the highest value in a skill — a stand-in for select_pc. */
function bestPcFor(univ: Universe, skill: Skill): number {
  let best = 0;
  let bestValue = -1;
  univ.party.pcs.forEach((pc, i) => {
    if (!pc.isAlive) return;
    const value = pc.skills[skill] ?? 0;
    if (value > bestValue) {
      bestValue = value;
      best = i;
    }
  });
  return best;
}

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
  const opcodes = await loadOpcodes(async (url) => (await fetch(url)).text());
  const scen = await loadScenario(new FetchSource(`/scenarios/${name}/`), opcodes);

  const store = new SheetStore();
  const sheets = [...CHROME_SHEETS, 'ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim', 'dlogbtnlg', 'dlogbtnmed'];
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
   * A locked door: ask what to do, then act. This is the async replacement for
   * the C++ blocking cChoiceDlog — the promise resolves when the player picks.
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
      // TODO(M3): select_pc should let the player choose who tries; for now the
      // strongest (bash) or most dexterous (pick) living PC has a go.
      if (choice === 'bash') session.bashDoor(where, bestPcFor(univ, Skill.STRENGTH));
      else if (choice === 'pick') session.pickLock(where, bestPcFor(univ, Skill.DEXTERITY));
      redraw();
    })();
  };

  // Browsers only allow audio after a user gesture, so the first keypress or
  // click is what actually starts it.
  const wakeSound = (): void => {
    void sound.resume().then(() => sound.preloadCommon());
  };
  window.addEventListener('keydown', wakeSound, { once: true });
  canvas.addEventListener('mousedown', wakeSound, { once: true });

  /** What the next direction or view click should do instead of moving. */
  let pending: 'talk' | 'look' | null = null;

  const setStatus = (): void => {
    if (session.talk) status.textContent = 'Click a highlighted word, or Done to stop talking.';
    else if (pending === 'talk') status.textContent = 'Talk to whom? (pick a direction)';
    else if (pending === 'look') status.textContent = 'Look where? (pick a direction)';
    else
      status.textContent =
        `${scen.title} — arrows/keypad to move, L to look` +
        (session.inTown ? ', T to talk to someone next to you.' : '.');
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
      if (dialogs.active || session.talk) return;
      const from = session.inTown ? univ.party.townLoc : univ.party.outLoc;
      actOn(shiftLoc(from, dir));
      setStatus();
      redraw();
    },
    onClick: (x, y) => {
      if (dialogs.handleClick(x, y)) return;
      if (session.talk) {
        const word = screen.talkScreen.wordAt(session.talk, x, y);
        if (word) {
          if (word.node === TalkAction.ASK) {
            const asked = window.prompt('Ask about what?') ?? '';
            if (asked.trim().length > 0 && session.talk.askAbout(asked) === 'done')
              session.endTalkMode();
          } else {
            session.chooseTalkNode(word.node);
          }
          setStatus();
          redraw();
        }
        return;
      }
      const btn = screen.buttonAt(x, y);
      if (btn) {
        sound.play(37); // the UI click
        if (btn.btn === ToolbarButton.TALK) {
          pending = 'talk';
        } else if (btn.btn === ToolbarButton.LOOK) {
          pending = 'look';
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
      if (session.talk) {
        if (key === 'Escape') {
          session.endTalkMode();
          setStatus();
          redraw();
        }
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
