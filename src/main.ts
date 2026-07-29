/**
 * Entry point: load a scenario, build the universe, and run the game loop on
 * the classic 605x430 screen.
 */

import { animAt, animSchedule, combatPace, setCombatPace } from './game/anim';
import { useItem } from './game/itemUse';
import type { SpecialHost } from './game/specials/context';
import { SpecCtx, SpecCtxType } from './game/specials/context';
import { Location, dist, locsEqual, shiftLoc } from './core/location';
import { SpellPat } from './data/pattern';
import { SPELLS, Spell, spellName } from './data/spell';
import { CastStatus, castableSpells, pcCanCastType } from './game/spellCast';
import { castSpell } from './game/spellTown';
import { combatCastSpell } from './game/spellCombat';
import {
  cancelSpellTargeting, castCollected, doCombatCast, placeTarget,
} from './game/spellCombatTarget';
import { takeAp } from './game/combat';
import { dispatcherMood, jobBoardOffers, openJobBank, takeJob } from './game/jobBank';
import { alchemyChoices, makePotion } from './game/alchemy';
import { loadDialogDefs } from './dialogs/dialogStore';
import { pcInfoDialog } from './dialogs/pcInfoDialog';
import { itemInfoDialog } from './dialogs/itemInfoDialog';
import { STR_DIALOG_DEFS, pictTypeOf, strDialog } from './dialogs/strDialog';
import { questInfoDialog } from './dialogs/questInfoDialog';
import { ItemWinMode, QUEST_COMPLETED_OFFSET } from './game/itemWindow';
import { BASIC_BUTTON_KEYS } from './game/specials/oneshot';
import { specItemUseable } from './data/quest';
import { trappedMonsters } from './game/soulCrystal';
import { castTownSpell, startTownTargeting } from './game/spellTarget';
import { CastDialog } from './dialogs/castDialog';
import { GetItemsDialog } from './dialogs/getItemsDialog';
import { placeSpellPattern } from './game/spellPatterns';
import { GameMode, isCombat, isOut, isScrollable } from './game/modes';
import { Boom, setBoomSink } from './game/booms';
import { FocusEvent, animPending, setAnimWaiter, setFocusSink } from './game/anim';
import { Missile, setMissileSink } from './game/missileAnim';
import { pickNextPc } from './game/combat';
import { GameRng } from './core/rng';
import { DialogHost } from './dialogs/dialog';
import { getStr, loadStringTables } from './data/strings';
import { TerSpec } from './data/terrain';
import { GameSession } from './game/session';
import { TalkAction } from './game/talk';
import { loadOpcodes, loadScenario } from './fileio/loadScenario';
import { FetchSource } from './fileio/source';
import { InputRouter } from './platform/input';
import { Snd, SoundPlayer } from './platform/sound';
import { setLivingSound } from './universe/living';
import { BOE_HEIGHT, BOE_WIDTH, ToolbarButton } from './render/layout';

import { CHROME_SHEETS, Screen } from './render/screen';
import { ShopHit, shopItemInfo } from './render/shopScreen';
import { SheetStore } from './render/sheets';
import { PartyPreset, Player } from './universe/player';
import { HP_PER_LEVEL, TrainingState, trainCost } from './game/training';
import { doRest } from './game/rest';
import { MainStatus, NUM_SKILLS, Skill, Status } from './universe/skills';
import { Universe } from './universe/universe';

/** Terrain animation ticks at 4 Hz, matching the C++ animation timer. */
const ANIM_INTERVAL_MS = 250;

const DEFAULT_SCENARIO = 'valleydy';

function scenarioFromQuery(): string {
  const q = new URLSearchParams(window.location.search).get('scenario');
  return q && /^[a-z0-9_-]+$/i.test(q) ? q : DEFAULT_SCENARIO;
}

/**
 * `?pace=` overrides the combat animation speed: 1 is normal, larger is slow
 * motion, smaller is brisk. See `combatPace` — the default is set there, and
 * `-`/`=` change it while the game is running.
 */
function applyPaceFromQuery(): void {
  const q = new URLSearchParams(window.location.search).get('pace');
  const n = q === null ? NaN : Number(q);
  if (Number.isFinite(n) && n > 0) setCombatPace(n);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const status = document.getElementById('status')!;
  canvas.width = BOE_WIDTH;
  canvas.height = BOE_HEIGHT;
  const ctx = canvas.getContext('2d')!;

  applyPaceFromQuery();
  const name = scenarioFromQuery();
  status.textContent = `Loading ${name}…`;
  const fetchText = async (url: string): Promise<string> => (await fetch(url)).text();
  const opcodes = await loadOpcodes(fetchText);
  // Shops name their stock out of the string resources while parsing, so these
  // have to be in place before the scenario loads.
  await loadStringTables(fetchText);
  // The dialog definitions the player opens. The other ~150 belong to the
  // scenario and character editors, which this port doesn't run.
  await loadDialogDefs(fetchText,
    ['pc-info', 'quest-info', 'get-items', 'item-info', ...STR_DIALOG_DEFS]);
  const scen = await loadScenario(new FetchSource(`/scenarios/${name}/`), opcodes);

  const store = new SheetStore();
  const sheets = [
    ...CHROME_SHEETS,
    'ter1', 'ter2', 'ter3', 'ter4', 'ter5', 'teranim',
    'dlogbtnlg', 'dlogbtnmed', 'dlogbtnsm', 'dlogbtnled', 'dlogbtnhelp',
    'dlogbtntall', 'dlgbtnred', 'dlogpics',
    // `scenpics` is PIC_SCEN, which is what a message node with no picture of
    // its own falls back to (the scenario's own icon); `bigscenpics` is the
    // -lg variant, and `staticons` is PIC_STATUS.
    'scenpics', 'bigscenpics',
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
  // iLiving's effects call one_sound/play_sound from deep inside the damage
  // pipeline, where there's no session to hand; the C++ uses globals for the
  // same reason (universe/living.ts).
  /**
   * Sounds ride the animation timeline. The C++ animates by blocking, so a
   * noise raised after `do_missile_anim` is simply heard after the missile has
   * landed; here the game logic runs straight through, so the *host* holds each
   * sound until the queue reaches it. `animAt()` is the wall clock whenever
   * nothing is animating, so out of combat this changes nothing.
   */
  const playSound = (which: number): void => {
    animSchedule(() => sound.play(which), animAt());
  };
  setLivingSound(playSound);
  // Transcript lines wait for their slot too, for the same reason: the C++
  // repaints the pane after the animation, not during it.
  univ.transcriptClock = animAt;
  session.startNewGame();
  const screen = new Screen(ctx, store);
  // `set_stat_window(ITEM_WIN_PC1)` from create_pc_graphics (boe.party.cpp:226)
  // — the panel's list and scroll limit are set before it is first drawn.
  screen.itemWindow.setStatWindowForPc(univ, 0);

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
    mode: 'living' | 'lockpick' | 'train',
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

  /** attack-friendly.xml — swinging at someone who hasn't done anything yet. */
  session.onConfirmAttackFriendly = async () => {
    const choice = await dialogs.run({
      text: "This creature isn't hostile.\nAttack anyway?",
      escapeButton: 'cancel',
      buttons: [
        { name: 'cancel', label: 'Cancel', key: 'c' },
        { name: 'attack', label: 'Attack', key: 'a' },
      ],
    });
    return choice === 'attack';
  };

  /** boat-bridge.xml — a boat reaching a bridge: go under it, or come ashore. */
  session.onConfirmBoatBridge = async () => {
    const choice = await dialogs.run({
      text: 'Sail under the bridge, or come ashore?',
      escapeButton: 'land',
      buttons: [
        { name: 'land', label: 'Land', key: 'l' },
        { name: 'under', label: 'Under', key: 'u' },
      ],
    });
    return choice === 'under';
  };

  /**
   * party-death.xml — the whole party has died. `handle_death` offers
   * Load/New/Quit; there's no save system yet (M7), so this only offers a
   * fresh start. The dialog has no Escape button, which is what freezes
   * input — `InputRouter.dialogStack` gates every game key and click while
   * one is open, and nothing ever closes this one.
   */
  session.onPartyDeath = () => {
    void dialogs.run({
      text: 'Your entire party has died.',
      buttons: [{ name: 'new', label: 'New Game' }],
    }).then(() => window.location.reload());
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
   * The specials VM's window on the outside world. Everything the C++ does by
   * blocking on a dialog is a promise here.
   */
  session.onRedraw = () => redraw();
  const specialHost: SpecialHost = {
    message: async (str1, str2, title, pic, picType, record) => {
      // `cStrDlog` — the real message box: the node's picture at the top left,
      // one of the eight {1|2}str[-title][-lg] layouts, and a Record button
      // that puts the text in the party's encounter notes.
      // `display_strings.setSound(57)` — every message a special node puts up
      // announces itself. Only those carry a recorder, which is what tells the
      // two apart here.
      if (record) sound.play(57);
      await dialogs.runScreenQueued(strDialog(ctx, store, {
        str1,
        str2,
        title,
        pic,
        picType,
        onRecord: record && (() => {
          sound.play(0);
          let added = false;
          for (const str of record.strs) {
            if (univ.party.record(record.type, str, record.where)) added = true;
          }
          // Only the first string's success is reported, as in the C++.
          if (added) univ.addStringToBuf('Added to encounter notes.');
          redraw();
        }),
      }));
    },
    choice: async (strs, buttons, title, pic, picType) => {
      const text = strs.filter((s) => s.length > 0).join('\n\n');
      const picked = await dialogs.runQueued({
        text: title ? `${title}\n\n${text}` : text,
        // `cThreeChoice::init_pict` (3choice.cpp:159) — a choice dialog raised
        // by a special node carries the node's picture too.
        pic: pic >= 0 ? { type: pictTypeOf(picType), num: pic } : undefined,
        escapeButton: buttons[0] ?? 'okay',
        // basic_buttons attaches a letter to several of these — 'y'/'n' most
        // of all — and the choice dialogs are meant to answer to them.
        buttons: buttons.map((label) => ({
          name: label, label, key: BASIC_BUTTON_KEYS[label],
        })),
      });
      return Math.max(0, buttons.indexOf(picked));
    },
    askText: (prompt) => askForText(prompt),
    selectPc: (prompt, highlight) => selectPc('living', prompt, highlight),
    startShop: (which, costAdj, shopName) =>
      session.startShopMode(which, costAdj, shopName)
      || session.startShopModeAnyPc(which, costAdj, shopName),
    startTalk: (monsterIndex, personality, monsterType, pic) =>
      session.startTalkMode(monsterIndex, personality, monsterType, pic),
    sound: (which) => sound.play(which),
    rest: (length, hp, sp) => doRest(univ, length, hp, sp, session.isOutdoors, session),
    moveParty: (where) => {
      if (session.inTown) univ.party.townLoc = { ...where };
      else univ.party.outLoc = { ...where };
      session.center = { ...where };
      session.updateExplored(where);
    },
    changeLevel: (town, where) => {
      // change_level (boe.specials.cpp:1395): leave, then re-enter elsewhere.
      if (where.x >= 0 && where.y >= 0) session.forceTownEntry(town, where);
      session.startTownMode(town, 9);
      session.center = { ...univ.party.townLoc };
    },
    endScenario: () => {
      univ.addStringToBuf('*** The scenario is over. ***');
    },
  };
  session.attachSpecials(specialHost);

  /**
   * Training (spend_xp in mode 1, pc.editors.cpp:644): pick who trains, then
   * buy skill levels one at a time until they run out of points, gold, or
   * interest.
   *
   * TODO(M3): the original is one dense dialog with a +/- stepper per skill.
   * This is the same rules with a list, pending stepper widgets.
   */
  session.onTrain = () => {
    if (dialogs.active) return;
    void (async () => {
      const who = await selectPc('train', 'Train who?');
      if (who < 0) {
        redraw();
        return;
      }
      const pc = univ.party.pcs[who]!;
      const state = new TrainingState(pc, univ.party.gold);
      // Buy one level per pass; the list reflects what's still affordable.
      for (;;) {
        const rows: { name: string; key?: string; label: string; disabled?: boolean }[] = [];
        const choices: (Skill | 'hp' | 'sp')[] = [];
        const add = (which: Skill | 'hp' | 'sp', name: string) => {
          const cost = trainCost(which);
          const at = state.level(which);
          rows.push({
            name: String(choices.length),
            key: choices.length < 9 ? String(choices.length + 1) : undefined,
            label: `${name} ${at} → ${which === 'hp' ? at + HP_PER_LEVEL : at + 1}`
              + `  (${cost.points} sp, ${cost.gold} gold)`,
            disabled: !state.canChange(which, true),
          });
          choices.push(which);
        };
        for (let i = 0; i < NUM_SKILLS; i++) add(i as Skill, getStr('skills', i * 2 + 1));
        add('hp', 'Health');
        add('sp', 'Spell Points');

        const picked = await dialogs.run({
          text: `Training ${pc.name}.\n`
            + `Skill points: ${state.points}    Gold: ${state.gold}\n`
            + 'Pick a skill to raise, then Keep to pay for it.',
          rows,
          escapeButton: 'cancel',
          buttons: [
            { name: 'keep', label: 'Keep', key: 'k' },
            { name: 'cancel', label: 'Cancel', key: 'c' },
          ],
        });
        if (picked === 'keep') {
          if (state.breaksAnamaOath)
            await dialogs.run({
              text: 'The oaths of an Anama member include eschewing research into '
                + 'arcane magics. By increasing your mage spells skill, you will be in '
                + 'violation of this oath. If you keep this change, you will be '
                + 'afflicted with a terrible permanent curse.',
              escapeButton: 'okay',
              buttons: [{ name: 'okay', label: 'OK' }],
            });
          univ.party.gold = state.keep();
          if (state.changed) univ.addStringToBuf(`  ${pc.name} trains.`);
          break;
        }
        if (picked === 'cancel') break;
        const which = choices[Number(picked)];
        if (which === undefined) break;
        if (!state.change(which, true)) sound.play(Snd.BUTTON);
      }
      redraw();
    })();
  };

  /**
   * The job board (`show_job_bank`, boe.dlgutil.cpp:794). Four offers, a Take
   * beside each, and the dispatcher's mood along the bottom; taking one starts
   * the quest and refills the slot from the board's spares.
   *
   * TODO(M3): job-board.xml is a picture, a title and four framed blocks with
   * their own buttons. This is the same rules as a list, pending the dialogxml
   * toolkit.
   */
  session.onJobBank = (which, title, personality) => {
    if (dialogs.active) return;
    void (async () => {
      const bank = openJobBank(univ, which);
      let prompt = dispatcherMood(bank.anger);
      for (;;) {
        const offers = jobBoardOffers(univ, bank);
        const picked = await dialogs.run({
          text: `${title || 'THE JOB BOARD:'}\n`
            + `Current day: ${univ.party.calcDay()}\n`
            + (offers.length > 0 ? 'Pick a job to take it.' : 'Nothing is on offer.')
            + `\n${prompt}`,
          rows: offers.map((offer, i) => ({
            name: String(offer.slot),
            key: String(i + 1),
            label: offer.text,
          })),
          escapeButton: 'done',
          buttons: [{ name: 'done', label: 'Done', key: 'd' }],
        });
        if (picked === 'done') break;
        const slot = Number(picked);
        if (!Number.isInteger(slot)) break;
        const quest = univ.scenario.quests[bank.jobs[slot]!];
        takeJob(univ, bank, slot, personality);
        prompt = 'Job accepted.';
        if (quest) univ.addStringToBuf(`  You take the job: ${quest.name}`);
      }
      redraw();
    })();
  };

  /**
   * `pick_trapped_monst` (boe.party.cpp:2450) — soul-crystal.xml, the four
   * slots Capture Soul fills and Simulacrum draws on. Cancelling returns 0,
   * which is what an empty crystal reports too.
   */
  session.onPickTrappedMonst = async () => {
    if (dialogs.active) return 0;
    const held = trappedMonsters(univ);
    if (held.length === 0) return 0;
    const picked = await dialogs.run({
      text: 'The soul crystal holds:\nWhich will you summon?',
      rows: held.map((slot, i) => ({
        name: String(slot.which),
        key: String(i + 1),
        label: `${slot.name} (level ${slot.level})`,
      })),
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel', key: 'c' }],
    });
    const which = Number(picked);
    return Number.isInteger(which) && held.some((h) => h.which === which) ? which : 0;
  };

  /**
   * Alchemy — `handle_alchemy` (boe.actions.cpp:1224) and the two dialogs
   * `do_alchemy` (boe.party.cpp:2284) runs: who mixes, then what. Mixing is a
   * town-only activity, and the mode gates below are the C++'s own wording.
   *
   * TODO(M3): pick-potion.xml is a grid of twenty labelled buttons with the
   * mixer's name and skill along the top. This is the same rules as a list,
   * pending the dialogxml toolkit.
   */
  const doAlchemyFlow = async (): Promise<void> => {
    if (dialogs.active) return;
    if (session.mode !== GameMode.TOWN) {
      if (isCombat(session.mode)) univ.addStringToBuf('Alchemy: Not in combat.');
      else if (!session.inTown) univ.addStringToBuf('Alchemy: Only in town.');
      else univ.addStringToBuf("Alchemy: Finish what you're doing first.");
      redraw();
      return;
    }
    if (!univ.party.alchemy.some((known) => known)) {
      univ.addStringToBuf('Alchemy: No recipes known.');
      redraw();
      return;
    }
    const who = await selectPc('living', 'Who will make a potion?', Skill.ALCHEMY);
    if (who < 0) {
      redraw();
      return;
    }
    const pc = univ.party.pcs[who]!;
    const choices = alchemyChoices(univ, who);
    const picked = await dialogs.run({
      text: `${pc.name} (skill ${pc.skill(Skill.ALCHEMY)})\nWhich potion?`,
      rows: choices.map((choice, i) => ({
        name: String(choice.which),
        key: i < 9 ? String(i + 1) : undefined,
        label: `${choice.name} (${choice.difficulty})`,
        // A recipe above this PC's skill still shows, greyed — the C++ hides
        // its button and leaves the label for the same reason.
        disabled: !choice.canMake,
      })),
      escapeButton: 'cancel',
      buttons: [{ name: 'cancel', label: 'Cancel', key: 'c' }],
    });
    const which = Number(picked);
    if (Number.isInteger(which) && choices.some((c) => c.which === which && c.canMake))
      makePotion(session, who, which, (n) => sound.play(n));
    setStatus();
    redraw();
  };

  /**
   * The Get action (get_item, boe.items.cpp:258): list what's in reach and let
   * the player take one at a time.
   */
  const getItems = async (): Promise<void> => {
    if (dialogs.active) return;
    // `handle_get_items` (boe.actions.cpp:1389) reaches from the party's
    // square in town and from the **acting PC's** in combat, where it also
    // costs four action points. Gating this on town alone is why "g" after an
    // arena fight said there was nothing here while the loot was in plain
    // sight on the floor.
    const inFight = isCombat(session.mode);
    const from = inFight ? univ.currentPc.combatPos : univ.party.townLoc;
    const { items: reachable, massGet } = session.reachableItems(from);
    if (reachable.length === 0) {
      univ.addStringToBuf('Get: nothing here');
      redraw();
      return;
    }
    // show_get_items: one screen that stays up — pick who is carrying with the
    // PC buttons, take as many things as you like, then Done. The title says
    // which sweep it was: a hostile creature in sight narrows it to adjacent.
    await dialogs.runScreen(new GetItemsDialog(ctx, store, session, reachable,
      massGet ? 'Getting all nearby items:' : 'Getting all adjacent items:'));
    if (inFight) {
      takeAp(univ, 4);
      session.afterCombatAction();
    }
    setStatus();
    redraw();
  };

  /**
   * The Info button beside a PC — `give_pc_info` (boe.infodlg.cpp:476), the
   * real `pc-info.xml` character sheet, running on the dialogxml toolkit.
   * The arrows step through the living party members without closing it.
   */
  const showPcInfo = (which: number): void => {
    if (dialogs.active) return;
    void dialogs.runScreen(pcInfoDialog(ctx, store, univ, which)).then(() => redraw());
  };

  /** `print_cast_status` (boe.party.cpp) — why a PC can't cast, in words. */
  const castStatusLine = (status: CastStatus, kind: string, who: string): string => {
    switch (status) {
      case CastStatus.NO_SKILL: return `Cast: ${who} has no ${kind} training.`;
      case CastStatus.NO_ANAMA: return "Cast: You're an Anama!";
      case CastStatus.NO_ANTIMAGIC: return 'Cast: Not in antimagic field.';
      case CastStatus.NO_SP: return `Cast: ${who} has no spell points.`;
      case CastStatus.NO_ENCUMBERED: return `Cast: ${who} is too encumbered.`;
      case CastStatus.NO_DUMBFOUNDED: return `Cast: ${who} is dumbfounded.`;
      case CastStatus.NO_PARALYZED: return `Cast: ${who} is paralyzed.`;
      case CastStatus.NO_ASLEEP: return `Cast: ${who} is asleep.`;
      default: return `Cast: ${who} can't cast that.`;
    }
  };

  /**
   * `cast_spell` / `combat_cast_*_spell`'s front end — the one dialog from
   * cast-spell.xml, with the caster column, the target column and the spell
   * grid all on screen at once.
   *
   * In combat the caster column is inert and the active PC casts
   * (`can_choose_caster` false); out of combat any PC who can cast may be
   * picked. A spell that needs a square puts the game into targeting mode and
   * the next click finishes it.
   */
  const castSpellFlow = async (type: Skill): Promise<void> => {
    const kind = type === Skill.MAGE_SPELLS ? 'mage' : 'priest';
    if (!session.primeTime) {
      univ.addStringToBuf('Cast: Finish what you are doing first.');
      setStatus();
      redraw();
      return;
    }
    const inFight = isCombat(session.mode);
    if (inFight) {
      // combat_cast_*_spell checks the active PC up front, and an encumbered
      // mage loses the AP for trying.
      const status = pcCanCastType(session, univ.currentPc, type);
      if (status !== CastStatus.OK) {
        univ.addStringToBuf(castStatusLine(status, kind, univ.currentPc.name));
        if (status === CastStatus.NO_ENCUMBERED) {
          takeAp(univ, 6);
          session.afterCombatAction();
        }
        setStatus();
        redraw();
        return;
      }
    } else if (!univ.party.pcs.some(
      (pc) => pcCanCastType(session, pc, type) === CastStatus.OK)) {
      univ.addStringToBuf('Cast: Nobody can.');
      setStatus();
      redraw();
      return;
    }

    const dialog = new CastDialog(ctx, store, session, type, !inFight);
    const picked = await dialogs.runScreen(dialog);
    if (picked !== 'cast') { redraw(); return; }
    const { spell, caster, target } = dialog.choice;
    if (spell === Spell.NONE) { redraw(); return; }
    session.spellTarget = target;
    if (inFight) await combatCastSpell(session, spell);
    else castSpell(session, caster, spell);
    setStatus();
    redraw();
  };

  /**
   * A row on the Special Items or Quests page — `show_item_info` (boe.actions
   * .cpp:1528) and the `use_spec_item` the Drop slot carries.
   */
  const handleSpecialPageClick = async (
    row: number, part: 'name' | 'use' | 'info',
  ): Promise<void> => {
    const win = screen.itemWindow;
    const entry = win.specItemArray[row];
    if (entry === undefined) return;
    if (win.mode === ItemWinMode.QUESTS) {
      // Whatever its status, the quest's own number is the low four digits.
      const which = entry % QUEST_COMPLETED_OFFSET;
      if (univ.scenario.quests[which])
        await dialogs.runScreen(questInfoDialog(ctx, store, univ, which));
      redraw();
      return;
    }
    const spec = univ.scenario.specialItems[entry];
    if (!spec) return;
    if (part === 'use') {
      // use_spec_item (boe.specials.cpp:576) — the item is a hook, not a thing
      // in a pack, so all it does is run its node.
      if (specItemUseable(spec) && !isCombat(session.mode))
        await session.runSpecial(
          SpecCtx.USE_SPEC_ITEM, SpecCtxType.SCEN, spec.special, univ.party.getLoc());
    } else {
      // put_spec_item_info's cStrDlog. TODO(M6): it draws the scenario's intro
      // picture beside the text, which needs custom scenario graphics.
      sound.play(57);
      await dialogs.run({
        title: spec.name,
        text: spec.descr,
        escapeButton: 'okay',
        buttons: [{ name: 'okay', label: 'OK' }],
      });
    }
    redraw();
  };

  /** A click on an inventory row: equip/unequip, give, drop, describe, or sell. */
  const handleInventoryClick = async (
    row: number,
    part: 'name' | 'use' | 'give' | 'drop' | 'info' | 'spec',
  ): Promise<void> => {
    if (!session.itemShop && screen.itemWindow.mode >= ItemWinMode.SPECIAL) {
      if (part === 'name' || part === 'use' || part === 'info')
        await handleSpecialPageClick(row, part);
      return;
    }
    const pc = univ.party.pcs[screen.itemPage];
    const item = pc?.items[row];
    if (!pc || !item || item.variety === 0) return;
    if (part === 'use') {
      // handle_use_item (boe.actions.cpp:1099) — only the acting PC's own pack,
      // and it costs the turn (use_item itself decides whether it worked).
      await useItem(session, screen.itemPage, row, specialHost);
    } else if (part === 'spec') {
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
      // `display_pc_item` — the real item-info.xml sheet, with the arrows
      // stepping through the rest of this PC's pack.
      await dialogs.runScreen(itemInfoDialog(ctx, store, univ, screen.itemPage, row));
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
  let pending: 'talk' | 'look' | 'use' | 'bash' | 'pick' | null = null;

  /**
   * `handle_use_space_select` / `handle_bash_pick_select` (boe.actions.cpp:930
   * and :959) — arm Use, Bash Door or Pick Lock, or cancel it if it is already
   * armed.
   *
   * All three insist on **MODE_TOWN exactly**, not merely "in a town": with a
   * conversation, a shop, a look or a spell in progress the answer is "Finish
   * what you're doing first." This port's `pending` flag stands in for the
   * MODE_USE_TOWN / MODE_BASH_TOWN / MODE_PICK_TOWN modes, so an armed action
   * of the same kind counts as being in that mode.
   */
  const beginTalk = (): void => {
    // `handle_begin_talk` (boe.actions.cpp:504) says nothing at all outside
    // MODE_TOWN — unlike Use and Bash, which explain themselves.
    if (session.mode !== GameMode.TOWN && pending !== 'talk') return;
    if (pending === 'talk') {
      pending = null;
      univ.addStringToBuf('  Cancelled.');
      return;
    }
    pending = 'talk';
    univ.addStringToBuf('Talk: Select someone.');
  };

  const selectSpace = (what: 'use' | 'bash' | 'pick'): void => {
    const label = what === 'use' ? 'Use' : what === 'bash' ? 'Bash Door' : 'Pick Lock';
    if (session.mode !== GameMode.TOWN && pending !== what) {
      if (isCombat(session.mode)) univ.addStringToBuf(`${label}: not in combat.`);
      else if (isOut(session.mode)) univ.addStringToBuf(`${label}: not outdoors`);
      else univ.addStringToBuf(`${label}: Finish what you're doing first.`);
      return;
    }
    if (pending === what) {
      pending = null;
      univ.addStringToBuf('  Cancelled.');
      return;
    }
    pending = what;
    if (what === 'use') {
      univ.addStringToBuf('Use: Select a space or item.');
      univ.addStringToBuf('  (Hit button again to cancel.)');
    } else {
      univ.addStringToBuf(`${label}: Select a space.`);
    }
  };

  const setStatus = (): void => {
    if (session.shop)
      status.textContent = "Click an item name (or type 'a'-'h') to buy; Esc to leave.";
    else if (session.talk) status.textContent = 'Click a highlighted word, or Done to stop talking.';
    else if (pending === 'talk') status.textContent = 'Talk to whom? (pick a direction)';
    else if (pending === 'look')
      status.textContent =
        'Look: click a space (the border arrows scroll the view). L or Esc cancels.';
    else if (pending === 'use') status.textContent = 'Use what? (pick a direction)';
    else if (pending === 'bash') status.textContent = 'Bash which door? (pick a direction)';
    else if (pending === 'pick')
      status.textContent = 'Pick which lock? (pick a direction)';
    else if (session.missile !== null)
      status.textContent =
        'Aim: click a square (or pick a direction). S or Esc cancels.';
    else if (session.mode === GameMode.COMBAT)
      status.textContent =
        'Combat — arrows move/attack, S shoot, W stand ready, D parry, X hold turn, E end fight.';
    else
      status.textContent =
        `${scen.title} — arrows to move, L look` +
        (session.inTown
          ? ', T talk, U use, B bash, G get, F fight, 1-6 whose pack.'
          : ', U use, R rest, 1-6 whose pack.');
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

  /**
   * handle_begin_look (boe.actions.cpp:470) — Look is a *mode*, not a one-shot
   * prompt. That matters for more than bookkeeping: MODE_LOOK_TOWN and
   * MODE_LOOK_COMBAT are in `scrollableModes`, so while you're looking the
   * twelve pointing arrows appear and the border scrolls the view — which is
   * the only way to look at something the 9x9 window doesn't reach. Pressing
   * the key again cancels, as the original's Escape branch does.
   */
  const beginLook = (): void => {
    if (isLooking()) {
      univ.addStringToBuf('  Cancelled.');
      endLook();
      return;
    }
    if (session.mode === GameMode.OUTDOORS) session.mode = GameMode.LOOK_OUTDOORS;
    else if (session.mode === GameMode.TOWN) session.mode = GameMode.LOOK_TOWN;
    else if (session.mode === GameMode.COMBAT) session.mode = GameMode.LOOK_COMBAT;
    else return;
    pending = 'look';
    univ.addStringToBuf('Look: Select a space.');
  };

  const isLooking = (): boolean => session.mode === GameMode.LOOK_TOWN
    || session.mode === GameMode.LOOK_COMBAT
    || session.mode === GameMode.LOOK_OUTDOORS;

  /** end_look (boe.actions.cpp:448) — back to the mode we came from, and the
   * view back onto the party (the scroll arrows may have moved it). */
  const endLook = (): void => {
    if (session.mode === GameMode.LOOK_TOWN) session.mode = GameMode.TOWN;
    else if (session.mode === GameMode.LOOK_COMBAT) session.mode = GameMode.COMBAT;
    else if (session.mode === GameMode.LOOK_OUTDOORS) session.mode = GameMode.OUTDOORS;
    else return;
    pending = null;
    recentre();
  };

  /**
   * Look at a space: describe it (`do_look`), then search it
   * (`adj_town_look`), then read an adjacent sign if there is one — the three
   * steps `handle_look` runs in that order (boe.actions.cpp:697).
   */
  const lookAt = async (target: { x: number; y: number }): Promise<void> => {
    const ter = session.lookAt(target);
    if (ter < 0) return;
    // Searching an adjacent square in town: runs its special, and opens it if
    // it turns out to be a container with something inside.
    if (session.inTown || isCombat(session.mode)) {
      if (dist(univ.party.townLoc, target) <= 1) {
        const contents = await session.adjTownLook(target);
        redraw();
        if (contents && contents.length > 0 && !dialogs.active) {
          await dialogs.runScreen(
            new GetItemsDialog(ctx, store, session, contents, 'Looking in container:'));
          setStatus();
          redraw();
          return;
        }
      }
    }
    const sign = session.signAt(target);
    if (sign === null || dialogs.active) return;
    await dialogs.run({
      text: sign,
      terPic: scen.terTypes[ter]?.picture,
      escapeButton: 'okay',
      buttons: [{ name: 'okay', label: 'OK' }],
    });
  };

  /**
   * True while a move or Use is still resolving. Both can await a dialog now
   * (a special on the destination square), and the original is strictly serial
   * — it blocks inside check_special_terrain — so a second action mustn't start
   * on top of the first. Without this, holding an arrow key interleaves moves.
   */
  let acting = false;

  /**
   * Whether the game is mid-action and input should be ignored: the party's own
   * half (`acting`), the monsters' (`session.busy`, a queued monster round
   * still playing out), or **an animation still on screen** (`animPending`).
   *
   * The C++ needs none of these — it blocks, and it goes further and throws
   * away anything typed while it does (`flushingInput = true`, set in
   * `damage_pc` right after `boom_space` returns, boe.party.cpp:2669, and
   * again in `do_monster_turn`). Dropping the input rather than buffering it
   * is the behaviour being matched.
   *
   * The animation term is what makes "wait for the blast, then carry on" true
   * for the *player's* own blows as well as the monsters': a swing that sets
   * off an explosion holds the keyboard until the explosion is over, exactly
   * as `boom_space`'s sleep does. It is also what keeps the queue shallow now
   * that `animBook` has no depth cap — the model cannot run away from the
   * screen if the player cannot act.
   */
  const midAction = (): boolean => acting || session.busy || animPending() > 0;

  /**
   * Whether a click on the terrain is a *shot* rather than a step: a loaded
   * missile or a spell waiting for its square. These are the modes that get
   * the targeting crosshair, and the modes whose clicks must be taken as given
   * instead of reduced to one step toward the target.
   */
  const isAiming = (): boolean => session.missile !== null
    || session.spellTargeting !== null || session.townTarget !== null;

  /**
   * Put the view back where the game keeps it — on the acting PC in combat, on
   * the party in town. Scrolling with the border arrows moves it away, and
   * every targeting mode restores it when it resolves.
   */
  const recentre = (): void => {
    // `party.getLoc()` for the non-combat case, not `townLoc`: outdoors that
    // field still holds wherever the party last stood *in a town* (or in a
    // combat arena), and centring the outdoor view on it drew a 9x9 window of
    // unexplored nothing — the "looking at a sign turns everything black" bug,
    // since ending a look is one of the things that calls this.
    session.center = isCombat(session.mode)
      ? { ...univ.currentPc.combatPos }
      : { ...univ.party.getLoc() };
  };

  /** Act on a target space according to what the player asked for. */
  const actOn = async (target: { x: number; y: number }): Promise<void> => {
    const what = pending;
    pending = null;
    if (what === 'talk') {
      void session.talkTo(target).then(() => { setStatus(); redraw(); });
      return;
    }
    if (what === 'look') {
      void lookAt(target);
      // Looking is done unless the modifier keys held it open; this port has
      // no quick-look modifier, so every look ends the mode.
      endLook();
      return;
    }
    if (what === 'bash' || what === 'pick') {
      // handle_bash_pick (boe.actions.cpp:976) — the square has to be next to
      // you and has to be something with a lock on it; then who does it.
      const isBash = what === 'bash';
      if (dist(univ.party.townLoc, target) > 1) {
        univ.addStringToBuf('  Must be adjacent.');
        setStatus();
        redraw();
        return;
      }
      if (!session.isUnlockable(target)) {
        univ.addStringToBuf('  Wrong terrain type.');
        setStatus();
        redraw();
        return;
      }
      void (async () => {
        const who = isBash
          ? await selectPc('living', 'Who will bash?', Skill.STRENGTH)
          : await selectPc('lockpick', 'Who will pick the lock?', Skill.LOCKPICKING);
        if (who >= 0) {
          if (isBash) session.bashDoor(target, who);
          else session.pickLock(target, who);
        }
        setStatus();
        redraw();
      })();
      return;
    }
    // Targeting a combat spell: the click is where it lands. A multi-target
    // spell collects squares instead, and fires itself once the last is picked.
    if (session.spellTargeting !== null) {
      const fancy = session.mode === GameMode.FANCY_TARGET;
      if (fancy) await placeTarget(session, target);
      else await doCombatCast(session, target);
      // The view snaps back to the caster once the spell goes off
      // (boe.actions.cpp:888) — but not while a multi-target spell is still
      // collecting squares, or scrolling would be undone between each pick.
      if (!fancy) recentre();
      setStatus();
      redraw();
      return;
    }
    // Targeting a town spell: the click is the square the spell lands on.
    // Checked before the missile, since the two modes never overlap and this
    // is the one the party is in outside combat.
    if (session.townTarget !== null) {
      await castTownSpell(session, target);
      recentre();
      setStatus();
      redraw();
      return;
    }
    // Targeting a missile: the click (or arrow key) is the shot, not a move.
    if (session.missile !== null) {
      session.fireMissileAt(target);
      recentre();
      setStatus();
      redraw();
      return;
    }
    // handle_terrain_screen_actions's offset==0 case (boe.actions.cpp:323):
    // clicking the square you (or the acting PC) are already standing on is
    // Pause/Wait, not a degenerate zero-length move — in combat that's
    // `char_stand_ready`, i.e. clicking your own figure on the battlefield
    // parries. This port's move dispatch below had no such check, so a
    // self-click fell through to the ordinary move code and just wasted the
    // turn without the stand-ready bonus.
    if (what !== 'use') {
      const self = isCombat(session.mode) ? univ.currentPc.combatPos
        : session.inTown ? univ.party.townLoc : univ.party.outLoc;
      if (locsEqual(target, self)) {
        await session.pause();
        setStatus();
        redraw();
        return;
      }
    }
    if (midAction()) return;
    acting = true;
    const done = (): void => {
      acting = false;
      setStatus();
      redraw();
    };
    // In combat the arrow keys and clicks drive the current PC, not the party.
    // The move is async because attacking a friendly raises a prompt first.
    if (session.mode === GameMode.COMBAT) {
      if (what === 'use') void session.useSpace(target).then(done, done);
      else void session.combatMove(target).then(done, done);
      return;
    }
    if (what === 'use') void session.useSpace(target).then(done, done);
    else void session.moveTo(target).then(done, done);
  };

  /**
   * display_map / close_map (boe.town.cpp:1594) — the automap is a toggle, and
   * it refuses to open mid-action ("prime_time"; here that's the `acting` flag
   * a pending async move sets).
   */
  const toggleMap = (): void => {
    if (!screen.mapVisible && midAction()) {
      univ.addStringToBuf('Map: Finish what you are doing first.');
      return;
    }
    screen.mapVisible = !screen.mapVisible;
  };

  const router = new InputRouter(canvas, {
    onMove: (dir, key) => {
      // A dialog gets first refusal on the arrows: pc-info.xml's left/right
      // buttons carry `def-key='left'`/`'right'`, and the router turns those
      // into movement before `onKey` ever sees them.
      if (key !== undefined && dialogs.active && dialogs.handleKey(key)) return;
      if (dialogs.active || session.talk || session.shop || midAction()) return;
      const from = session.mode === GameMode.COMBAT || session.missile !== null
        ? univ.currentPc.combatPos
        : session.inTown ? univ.party.townLoc : univ.party.outLoc;
      void actOn(shiftLoc(from, dir));
      setStatus();
      redraw();
    },
    onDrag: (x, y) => {
      if (!screen.mapScreen.dragging) return;
      screen.mapScreen.dragTo(x, y, BOE_WIDTH, BOE_HEIGHT);
      redraw();
    },
    onRelease: () => {
      screen.mapScreen.endDrag();
    },
    onClick: (x, y) => {
      if (dialogs.handleClick(x, y)) return;
      // The map is a separate window in the original, so a click that lands on
      // it never reaches the game screen underneath.
      if (screen.mapVisible && screen.mapScreen.contains(x, y)) {
        // A click anywhere on the map window picks it up, as the WASM build
        // allows ("Allow dragging from anywhere on the map window").
        screen.mapScreen.startDrag(x, y);
        return;
      }
      // The party stats list: clicking a name makes that PC active, the HP and
      // SP columns read themselves out, and the two icons are Info and Trade
      // Places (handle_action's PC-area branch, boe.actions.cpp:1739).
      //
      // This comes *before* the shop, because the C++ dispatches on which
      // window the click landed in and the PC panel is its own window — which
      // is how you switch who's shopping without leaving the shop.
      const pcHit = screen.pcRowHit(x, y);
      if (pcHit) {
        const pc = univ.party.pcs[pcHit.index];
        if (pc && pc.mainStatus !== MainStatus.ABSENT) {
          sound.play(Snd.BUTTON);
          // The HP and SP read-outs are blank for a PC who isn't alive, so a
          // click there does nothing rather than reporting on a corpse.
          const aliveOnly = pcHit.part === 'hp' || pcHit.part === 'sp';
          if (!aliveOnly || pc.mainStatus === MainStatus.ALIVE) {
            if (pcHit.part === 'name') {
              session.switchPc(pcHit.index);
              screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
            } else if (pcHit.part === 'hp') {
              session.printPcHp(pcHit.index);
            } else if (pcHit.part === 'sp') {
              session.printPcSp(pcHit.index);
            } else if (pcHit.part === 'trade') {
              session.tradePlaces(pcHit.index);
              screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
            } else {
              showPcInfo(pcHit.index);
            }
          }
          setStatus();
          redraw();
        }
        return;
      }
      if (session.shop) {
        const hit = screen.shopScreen.hit(session.shop, x, y);
        if (hit) handleShopHit(hit);
        return;
      }
      // The item scrollbar is its own control on the main window, so it is
      // asked before the panel underneath it.
      if (!session.itemShop && screen.itemSbar.handleClick(x, y)) {
        sound.play(Snd.BUTTON);
        screen.itemWindow.scroll = screen.itemSbar.getPosition();
        redraw();
        return;
      }
      // The page buttons along the bottom of the item panel: six PCs, Special
      // Items, Quests and Help (handle_action, boe.actions.cpp:1784).
      if (!session.itemShop) {
        const bottom = screen.itemBottomHit(x, y);
        if (bottom !== null) {
          sound.play(Snd.BUTTON);
          if (bottom === 6) screen.itemWindow.setStatWindow(univ, ItemWinMode.SPECIAL);
          else if (bottom === 7) screen.itemWindow.setStatWindow(univ, ItemWinMode.QUESTS);
          else if (bottom === 8) {
            // TODO(M6): show_dialog_action("help-inventory"), one of the help
            // dialogs the toolkit can now draw but nothing opens yet.
            univ.addStringToBuf('(The inventory help dialog is still to come)');
          } else {
            univ.curPc = bottom;
            screen.itemWindow.setStatWindowForPc(univ, bottom);
          }
          setStatus();
          redraw();
          return;
        }
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
          beginTalk();
        } else if (btn.btn === ToolbarButton.LOOK) {
          beginLook();
        } else if (btn.btn === ToolbarButton.CAMP) {
          session.rest();
        } else if (btn.btn === ToolbarButton.USE) {
          selectSpace('use');
        } else if (btn.btn === ToolbarButton.MAP) {
          toggleMap();
        } else if (btn.btn === ToolbarButton.HAND) {
          void getItems();
        } else if (btn.btn === ToolbarButton.SWORD) {
          // The sword is Fight: drop into combat where the party stands.
          if (session.inTown) session.startCombat(univ.party.direction);
          else univ.addStringToBuf("Can't fight out here yet.");
        } else if (btn.btn === ToolbarButton.END) {
          // End combat and regroup.
          session.endCombat();
        } else if (btn.btn === ToolbarButton.WAIT) {
          // handle_stand_ready — give up the turn *on guard*, not just idle.
          if (session.mode === GameMode.COMBAT) void session.pause();
        } else if (btn.btn === ToolbarButton.SHIELD) {
          // handle_parry — spend what's left of the turn on defence.
          if (session.mode === GameMode.COMBAT) session.parry();
        } else if (btn.btn === ToolbarButton.MAGE || btn.btn === ToolbarButton.PRIEST) {
          // The two spellbook buttons are the same flow as the 'm' and 'p'
          // keys — handle_spell_button dispatches on which book.
          void castSpellFlow(btn.btn === ToolbarButton.MAGE
            ? Skill.MAGE_SPELLS : Skill.PRIEST_SPELLS);
        } else if (btn.btn === ToolbarButton.ACT) {
          // handle_toggle_active — pin the turn to this PC, or release it.
          if (session.mode === GameMode.COMBAT) session.toggleActivePc();
        } else {
          // TODO(M3+): wire the remaining toolbar buttons to real actions.
          univ.addStringToBuf(`(${ToolbarButton[btn.btn]} is not implemented yet)`);
        }
        setStatus();
        redraw();
        return;
      }
      // The border around the terrain grid scrolls the view while aiming —
      // that's what the little arrows around the edge are pointing at
      // (boe.actions.cpp:1711). Checked before the grid, since it's outside it.
      if (isScrollable(session.mode)) {
        const shift = screen.scrollBorderAt(x, y);
        if (shift) {
          session.screenShift(shift.dx, shift.dy);
          redraw();
          return;
        }
      }
      const cell = screen.terrainCellAt(x, y);
      if (cell) {
        // handle_terrain_screen_actions (boe.actions.cpp:301) measures the
        // click from `center` in town and combat, and from the party's square
        // outdoors — not from the acting PC. That matters once the view has
        // been scrolled with the border arrows: the square under the cursor is
        // relative to what's drawn, which is `center`.
        const from = session.isOutdoors ? univ.party.outLoc : session.center;
        const clicked = { x: from.x + cell.q - 4, y: from.y + cell.r - 4 };
        // Look, Talk and Use all act on the square you clicked — handle_talk
        // (boe.actions.cpp:818) takes the destination as given and only needs
        // line of sight. Moving is the one that steps once toward it. A missile
        // or a spell is aimed at the square clicked, at whatever range it will
        // reach — reducing those to one step toward the target made every spell
        // in the game hit the square next to you and nothing else.
        if (pending === null && !isAiming()) {
          const dx = Math.sign(cell.q - 4);
          const dy = Math.sign(cell.r - 4);
          // `if(offset.x == 0 && offset.y == 0) handle_pause()`
          // (boe.actions.cpp:325) — clicking the middle of the view is Wait,
          // and in combat that is Stand Ready: the acting PC guards, and any
          // monster that steps up to them takes a free swing for it. This
          // port dropped the click on the floor instead, so clicking your own
          // figure did nothing at all.
          if (dx === 0 && dy === 0) {
            void actOn(clicked);
            setStatus();
            redraw();
            return;
          }
          void actOn({ x: from.x + dx, y: from.y + dy });
        } else {
          void actOn(clicked);
        }
        setStatus();
        redraw();
      }
    },
    // The targeting overlay follows the cursor, so a move has to repaint — but
    // only while something is actually being aimed, or every mouse twitch
    // redraws the whole 605x430 screen for nothing.
    onHover: (x, y) => {
      if (!isAiming()) {
        if (screen.hover !== null) {
          screen.hover = null;
          redraw();
        }
        return;
      }
      screen.hover = { x, y };
      redraw();
    },
    onHoverEnd: () => {
      if (screen.hover === null) return;
      screen.hover = null;
      redraw();
    },
    onKey: async (key) => {
      if (dialogs.handleKey(key)) return;
      // The map window's own key handler: Escape closes it, and it says so.
      if (screen.mapVisible && key === 'Escape') {
        screen.mapVisible = false;
        redraw();
        return;
      }
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
      // The play-testing speed knob, and deliberately *above* the mid-action
      // gate: a fight that turns out to be too slow should be speedable
      // without waiting for the round to end. Not a key the original has —
      // its equivalent is the GameSpeed preference — so it is kept to two
      // keys the original leaves unused.
      if (key === '-' || key === '_' || key === '=' || key === '+') {
        const slower = key === '-' || key === '_';
        setCombatPace(combatPace() * (slower ? 1.5 : 1 / 1.5));
        univ.addStringToBuf(`(Combat pace: ${combatPace().toFixed(2)}x, 1 = normal)`);
        redraw();
        return;
      }
      // Nothing below here may run while the party or the monsters are still
      // mid-turn — see `midAction`. Dialogs, shops and conversations are
      // handled above and keep their keys; this only drops the ones that would
      // start a *new* action. It matters more than it used to: a monster round
      // now takes real time, where before it was over within the keystroke.
      if (midAction()) return;
      // handle_keystroke's letters (boe.actions.cpp:2772), which are what a
      // BoE player's fingers already know. Uppercase variants that mean
      // something different in the original (M/P force a recast, L picks a
      // lock, A is alchemy) are noted where they aren't built yet.
      const inCombat = session.mode === GameMode.COMBAT;
      switch (key) {
        case 'f': case 'F':
          // Toggle combat, both ways — the same key in the original.
          if (inCombat) session.endCombat();
          else if (session.inTown) session.startCombat(univ.party.direction);
          else univ.addStringToBuf("Combat: can't fight out here yet.");
          break;
        case 'e': case 'E':
          if (inCombat) session.endCombat();
          break;
        case 'w': case 'W':
        case ' ':
          // Wait: stand ready in combat, pause otherwise.
          await session.pause();
          break;
        case 'd': case 'D':
          if (inCombat) session.parry();
          break;
        case 'x': case 'X':
          session.toggleActivePc();
          break;
        case 't':
          beginTalk();
          break;
        case 'l':
          beginLook();
          break;
        case 'u': case 'U':
          selectSpace('use');
          break;
        case 'b': case 'B':
          selectSpace('bash');
          break;
        case 'L':
          selectSpace('pick');
          break;
        case 'r':
          session.rest();
          break;
        case 'g': case 'G':
          // MODE_TOWN *or* MODE_COMBAT (boe.actions.cpp:3105).
          if (session.inTown || inCombat) void getItems();
          else univ.addStringToBuf('Get: nothing here');
          break;
        case 'a':
          toggleMap();
          break;
        case 's': case 'S':
          // 's' arms a missile and 's' again cancels, as in the original.
          if (session.missile !== null) {
            session.cancelMissile();
            recentre();
          } else session.startMissile();
          break;
        case ' ':
          // start_fancy_spell_targeting's "(Hit space to cast.)".
          if (session.mode === GameMode.FANCY_TARGET) await castCollected(session);
          break;
        case 'm': case 'M': case 'p': case 'P':
          // While a spell is in the air the same key cancels it, which is what
          // start_spell_targeting's "(Hit 'm' to cancel.)" refers to.
          if (session.spellTargeting !== null) {
            cancelSpellTargeting(session);
            recentre();
          } else {
            void castSpellFlow(key === 'm' || key === 'M'
              ? Skill.MAGE_SPELLS : Skill.PRIEST_SPELLS);
          }
          break;
        case 'i': case 'z': case 'Z':
          univ.addStringToBuf("(The inventory panel is always on screen; 1-6 switches whose)");
          break;
        case 'A':
          void doAlchemyFlow();
          break;
        case '9': // Special items
          screen.itemWindow.setStatWindow(univ, ItemWinMode.SPECIAL);
          break;
        case '0': // Jobs/quests
          screen.itemWindow.setStatWindow(univ, ItemWinMode.QUESTS);
          break;
        default:
          if (key >= '1' && key <= '6') {
            // Switch which PC's inventory page is showing.
            univ.curPc = Number(key) - 1;
            screen.itemWindow.setStatWindowForPc(univ, univ.curPc);
          }
          break;
      }
      setStatus();
      redraw();
      if (key === 'Escape' && pending) {
        // Escape out of Look leaves the mode as well as the prompt, which is
        // what puts the view back on the party.
        if (isLooking()) {
          univ.addStringToBuf('  Cancelled.');
          endLook();
          redraw();
        }
        pending = null;
        setStatus();
      }
      if (key === 'Escape' && session.spellTargeting !== null) {
        cancelSpellTargeting(session);
        recentre();
        setStatus();
        redraw();
      }
      if (key === 'Escape' && session.missile !== null) {
        session.cancelMissile();
        recentre();
        setStatus();
        redraw();
      }
    },
  });
  router.attach();

  // The combat animations. The C++ blocks its way through these one at a time —
  // centre on the monster, fly the missile, show the hit — so the whole lot is
  // spread across a shared timeline here (`game/anim.ts`) and played back by
  // one rAF loop. Booking a slot is what keeps a spear visible in flight
  // instead of resolving in the same frame as the damage number.
  const pendingFocus: FocusEvent[] = [];
  let animLoopRunning = false;

  const startAnimLoop = (): void => {
    if (animLoopRunning) return;
    animLoopRunning = true;
    const step = (): void => {
      const now = performance.now();
      // A camera move applies the moment its slot arrives.
      while (pendingFocus.length > 0 && pendingFocus[0]!.at <= now) {
        session.center = { ...pendingFocus.shift()!.center };
      }
      screen.booms = screen.booms.filter((b) => b.expires > now);
      screen.missiles = screen.missiles.filter((m) => m.started + m.dur > now);
      redraw();
      if (pendingFocus.length > 0 || screen.booms.length > 0
        || screen.missiles.length > 0 || animPending() > 0) {
        requestAnimationFrame(step);
        return;
      }
      animLoopRunning = false;
      // The queue has drained: hand the view back to whoever owns it.
      recentreOnParty();
    };
    requestAnimationFrame(step);
  };

  /** Put the camera back where the game logic wants it after an animation. */
  const recentreOnParty = (): void => {
    // Not while the monsters are going: the queue drains between one monster's
    // action and the next, and snapping to the party in that gap would flick
    // the view back and forth all round. The C++ holds the camera on the
    // monsters for the whole turn and restores it afterwards, which here is
    // `finishCombatStep` (combat) or nothing at all (town, where it never
    // moved). Visible only once the turn is paced slowly enough to see.
    if (session.monstersGoing) {
      redraw();
      return;
    }
    const univ2 = session.univ;
    session.center = isCombat(session.mode)
      ? { ...univ2.currentPc.combatPos }
      : { ...univ2.party.getLoc() };
    redraw();
  };

  setBoomSink((boom) => {
    boomWatcher?.(boom);
    screen.booms.push(boom);
    startAnimLoop();
  });
  /**
   * Taps for a headless driver: a script can no longer read what flew or what
   * exploded off `screen.missiles`/`screen.booms` after the fact, because the
   * action it started now waits for those animations and the renderer has
   * swept them up by the time it returns. `__watchAnim` lets it record them as
   * they are raised instead. Null for both clears the tap.
   */
  let missileWatcher: ((m: Missile) => void) | null = null;
  let boomWatcher: ((b: Boom) => void) | null = null;
  setMissileSink((missile) => {
    missileWatcher?.(missile);
    screen.missiles.push(missile);
    startAnimLoop();
  });
  setFocusSink((event) => {
    pendingFocus.push(event);
    startAnimLoop();
  });

  /**
   * How the monsters' turn blocks. `animSettle` asks for this whenever the C++
   * would have called `pause()`, and without a waiter installed — tests,
   * headless runs — it returns at once instead.
   *
   * `startAnimLoop` is kicked here as well as from the sinks: a slot can be
   * booked (the post-action beat books time without drawing anything new) with
   * no boom, missile or camera move to start the loop, and nothing would then
   * repaint while the turn waits on it.
   */
  setAnimWaiter((ms) => {
    startAnimLoop();
    return new Promise<void>((resolve) => { setTimeout(resolve, ms); });
  });

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
    // How long the animation queue still has to run. A driver has to wait for
    // this as well as `settled()` — input is dropped while it is non-zero.
    __animPending: animPending,
    // The protective circle, for the verifier's place_spell_pattern check.
    __placePattern: (at: Location) =>
      placeSpellPattern(session, SpellPat.PROT, at, { whoHit: univ.curPc }),
    // Casts a spell without the picker, for spells the verifier wants to reach
    // directly (Word of Recall, whose whole effect is where the party ends up).
    __castSpell: (pcNum: number, spell: Spell) => castSpell(session, pcNum, spell),
    // Arms a town-targeting spell, so the verifier can drive the click path.
    __startTownTargeting: (spell: Spell) => startTownTargeting(session, spell, univ.curPc),
    // Lets the headless verifier watch which sound files actually get played.
    __setLivingSound: (fn: ((which: number) => void) | null) =>
      setLivingSound(fn ?? playSound),
    __dialogs: dialogs,
    __watchAnim: (onMissile: ((m: Missile) => void) | null, onBoom: ((b: Boom) => void) | null) => {
      missileWatcher = onMissile;
      boomWatcher = onBoom;
    },
  });
}

main().catch((err) => {
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
