/**
 * Entry point: load a scenario, build the universe, and run the game loop on
 * the classic 605x430 screen.
 */

import { useItem } from './game/itemUse';
import type { SpecialHost } from './game/specials/context';
import { Location, shiftLoc } from './core/location';
import { SpellPat } from './data/pattern';
import { statusName } from './data/statusIcons';
import { SPELLS, Spell, spellName } from './data/spell';
import { CastStatus, castableSpells, pcCanCastType } from './game/spellCast';
import { castSpell } from './game/spellTown';
import { combatCastSpell } from './game/spellCombat';
import {
  cancelSpellTargeting, castCollected, doCombatCast, placeTarget,
} from './game/spellCombatTarget';
import { takeAp } from './game/combat';
import { castTownSpell, startTownTargeting } from './game/spellTarget';
import { CastDialog } from './dialogs/castDialog';
import { GetItemsDialog } from './dialogs/getItemsDialog';
import { placeSpellPattern } from './game/spellPatterns';
import { GameMode, isCombat, isScrollable } from './game/modes';
import { setBoomSink } from './game/booms';
import { FocusEvent, animPending, setFocusSink } from './game/anim';
import { MISSILE_MS, setMissileSink } from './game/missileAnim';
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
import { MAP_WINDOW } from './render/mapScreen';
import { CHROME_SHEETS, Screen } from './render/screen';
import { ShopHit, shopItemInfo } from './render/shopScreen';
import { SheetStore } from './render/sheets';
import { itemWeight } from './universe/inventory';
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
    'dlogbtnlg', 'dlogbtnmed', 'dlogbtnsm', 'dlogbtnled',
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
  setLivingSound((which) => { sound.play(which); });
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
    message: async (str1, str2, title, pic, picType) => {
      const text = [str1, str2].filter((s) => s.length > 0).join('\n\n');
      await dialogs.runQueued({
        text: title ? `${title}\n\n${text}` : text,
        escapeButton: 'okay',
        buttons: [{ name: 'okay', label: 'OK' }],
      });
    },
    choice: async (strs, buttons, title, pic, picType) => {
      const text = strs.filter((s) => s.length > 0).join('\n\n');
      const picked = await dialogs.runQueued({
        text: title ? `${title}\n\n${text}` : text,
        escapeButton: buttons[0] ?? 'okay',
        buttons: buttons.map((label) => ({ name: label, label })),
      });
      return Math.max(0, buttons.indexOf(picked));
    },
    askText: (prompt) => askForText(prompt),
    selectPc: (prompt) => selectPc('living', prompt),
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
    // show_get_items: one screen that stays up — pick who is carrying with the
    // PC buttons, take as many things as you like, then Done.
    await dialogs.runScreen(
      new GetItemsDialog(ctx, store, session, reachable, 'Getting all adjacent items:'));
    setStatus();
    redraw();
  };

  /**
   * The Info button beside a PC. `give_pc_info` (boe.infodlg.cpp:476) opens
   * pc-info.xml — a full character sheet with all nineteen skills, the spell
   * lists and the traits — which needs the dialogxml toolkit. Until that lands
   * this prints the same information into the transcript, statuses included,
   * which is what you actually want to know mid-fight.
   */
  const printPcInfo = (which: number): void => {
    const pc = univ.party.pcs[which];
    if (!pc) return;
    univ.addStringToBuf(`${pc.name}:`);
    univ.addStringToBuf(`  Level ${pc.level}, ${pc.experience} experience.`);
    univ.addStringToBuf(`  Health ${pc.curHealth}/${pc.maxHealth}, spell points ${pc.curSp}/${pc.maxSp}.`);
    const skills: string[] = [];
    for (let i = 0; i < NUM_SKILLS; i++) {
      const value = pc.skills[i] ?? 0;
      if (value > 0) skills.push(`${getStr('skills', 1 + i * 2)} ${value}`);
    }
    if (skills.length > 0) univ.addStringToBuf(`  ${skills.join(', ')}.`);
    const effects: string[] = [];
    for (let s = Status.POISONED_WEAPON; s <= Status.CHARM; s++) {
      const name = statusName(s, pc.status[s] ?? 0);
      if (name) effects.push(`${name} (${Math.abs(pc.status[s] ?? 0)})`);
    }
    univ.addStringToBuf(effects.length > 0
      ? `  Affected by: ${effects.join(', ')}.`
      : '  No effects on this PC.');
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
        if (status === CastStatus.NO_ENCUMBERED) takeAp(univ, 6);
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
    if (inFight) combatCastSpell(session, spell);
    else castSpell(session, caster, spell);
    setStatus();
    redraw();
  };

  /** A click on an inventory row: equip/unequip, give, drop, describe, or sell. */
  const handleInventoryClick = async (
    row: number,
    part: 'name' | 'use' | 'give' | 'drop' | 'info' | 'spec',
  ): Promise<void> => {
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
  let pending: 'talk' | 'look' | 'use' | 'bash' | null = null;

  const setStatus = (): void => {
    if (session.shop)
      status.textContent = "Click an item name (or type 'a'-'h') to buy; Esc to leave.";
    else if (session.talk) status.textContent = 'Click a highlighted word, or Done to stop talking.';
    else if (pending === 'talk') status.textContent = 'Talk to whom? (pick a direction)';
    else if (pending === 'look') status.textContent = 'Look where? (pick a direction)';
    else if (pending === 'use') status.textContent = 'Use what? (pick a direction)';
    else if (pending === 'bash') status.textContent = 'Bash which door? (pick a direction)';
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

  /**
   * True while a move or Use is still resolving. Both can await a dialog now
   * (a special on the destination square), and the original is strictly serial
   * — it blocks inside check_special_terrain — so a second action mustn't start
   * on top of the first. Without this, holding an arrow key interleaves moves.
   */
  let acting = false;

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
    session.center = isCombat(session.mode)
      ? { ...univ.currentPc.combatPos }
      : { ...univ.party.townLoc };
  };

  /** Act on a target space according to what the player asked for. */
  const actOn = (target: { x: number; y: number }): void => {
    const what = pending;
    pending = null;
    if (what === 'talk') {
      void session.talkTo(target).then(() => { setStatus(); redraw(); });
      return;
    }
    if (what === 'look') {
      lookAt(target);
      return;
    }
    if (what === 'bash') {
      // handle_bash_pick_select: pick a square, then who does the bashing.
      void (async () => {
        const who = await selectPc('living', 'Who will bash?', Skill.STRENGTH);
        if (who >= 0) session.bashDoor(target, who);
        setStatus();
        redraw();
      })();
      return;
    }
    // Targeting a combat spell: the click is where it lands. A multi-target
    // spell collects squares instead, and fires itself once the last is picked.
    if (session.spellTargeting !== null) {
      const fancy = session.mode === GameMode.FANCY_TARGET;
      if (fancy) placeTarget(session, target);
      else doCombatCast(session, target);
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
      castTownSpell(session, target);
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
    if (acting) return;
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
    if (!screen.mapVisible && acting) {
      univ.addStringToBuf('Map: Finish what you are doing first.');
      return;
    }
    screen.mapVisible = !screen.mapVisible;
  };

  const router = new InputRouter(canvas, {
    onMove: (dir) => {
      if (dialogs.active || session.talk || session.shop || acting) return;
      const from = session.mode === GameMode.COMBAT || session.missile !== null
        ? univ.currentPc.combatPos
        : session.inTown ? univ.party.townLoc : univ.party.outLoc;
      actOn(shiftLoc(from, dir));
      setStatus();
      redraw();
    },
    onClick: (x, y) => {
      if (dialogs.handleClick(x, y)) return;
      // The map is a separate window in the original, so a click that lands on
      // it never reaches the game screen underneath.
      if (screen.mapVisible
        && x >= MAP_WINDOW.left && x < MAP_WINDOW.right
        && y >= MAP_WINDOW.top && y < MAP_WINDOW.bottom) return;
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
              screen.itemPage = univ.curPc;
            } else if (pcHit.part === 'hp') {
              session.printPcHp(pcHit.index);
            } else if (pcHit.part === 'sp') {
              session.printPcSp(pcHit.index);
            } else if (pcHit.part === 'trade') {
              session.tradePlaces(pcHit.index);
              screen.itemPage = univ.curPc;
            } else {
              // TODO(M6): give_pc_info's full character sheet is a dialogxml
              // screen (pc-info.xml); this is the transcript version of it.
              printPcInfo(pcHit.index);
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
        } else if (btn.btn === ToolbarButton.CAMP) {
          session.rest();
        } else if (btn.btn === ToolbarButton.USE) {
          pending = 'use';
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
          if (session.mode === GameMode.COMBAT) session.pause();
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
        // Any combat mode aims from the active PC, not just COMBAT itself —
        // SPELL_TARGET and FIRING are combat modes too, and using the party's
        // town square there sends the click to the wrong place entirely.
        const from = isCombat(session.mode) || session.missile !== null
          ? univ.currentPc.combatPos
          : session.inTown ? univ.party.townLoc : univ.party.outLoc;
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
          if (dx === 0 && dy === 0) return;
          actOn({ x: from.x + dx, y: from.y + dy });
        } else {
          actOn(clicked);
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
    onKey: (key) => {
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
          session.pause();
          break;
        case 'd': case 'D':
          if (inCombat) session.parry();
          break;
        case 'x': case 'X':
          session.toggleActivePc();
          break;
        case 't':
          if (session.inTown) pending = 'talk';
          else univ.addStringToBuf('There is nobody to talk to out here.');
          break;
        case 'l':
          pending = 'look';
          break;
        case 'u': case 'U':
          if (inCombat) univ.addStringToBuf('Use: not in combat.');
          else if (!session.inTown) univ.addStringToBuf('Use: not outdoors');
          else pending = 'use';
          break;
        case 'b': case 'B':
          if (inCombat) univ.addStringToBuf('Bash Door: not in combat.');
          else if (!session.inTown) univ.addStringToBuf('Bash Door: not outdoors');
          else pending = 'bash';
          break;
        case 'r':
          session.rest();
          break;
        case 'g': case 'G':
          if (session.inTown) void getItems();
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
          if (session.mode === GameMode.FANCY_TARGET) castCollected(session);
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
        case 'L':
          univ.addStringToBuf('(Pick Lock has no standalone key yet — walk into a locked door)');
          break;
        case 'A':
          univ.addStringToBuf('(Alchemy needs M6)');
          break;
        default:
          if (key >= '1' && key <= '6') {
            // Switch which PC's inventory page is showing.
            screen.itemPage = Number(key) - 1;
            univ.curPc = screen.itemPage;
          }
          break;
      }
      setStatus();
      redraw();
      if (key === 'Escape' && pending) {
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
      screen.missiles = screen.missiles.filter((m) => m.started + MISSILE_MS > now);
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
    const univ2 = session.univ;
    session.center = isCombat(session.mode)
      ? { ...univ2.currentPc.combatPos }
      : { ...univ2.party.getLoc() };
    redraw();
  };

  setBoomSink((boom) => {
    screen.booms.push(boom);
    startAnimLoop();
  });
  setMissileSink((missile) => {
    screen.missiles.push(missile);
    startAnimLoop();
  });
  setFocusSink((event) => {
    pendingFocus.push(event);
    startAnimLoop();
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
    // The protective circle, for the verifier's place_spell_pattern check.
    __placePattern: (at: Location) =>
      placeSpellPattern(session, SpellPat.PROT, at, { whoHit: univ.curPc }),
    // Arms a town-targeting spell, so the verifier can drive the click path.
    __startTownTargeting: (spell: Spell) => startTownTargeting(session, spell, univ.curPc),
    // Lets the headless verifier watch which sound files actually get played.
    __setLivingSound: (fn: ((which: number) => void) | null) =>
      setLivingSound(fn ?? ((which: number) => { sound.play(which); })),
    __dialogs: dialogs,
  });
}

main().catch((err) => {
  document.getElementById('status')!.textContent = `Error: ${err}`;
  console.error(err);
});
