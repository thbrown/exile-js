/**
 * The spell-casting screen — a port of `cast-spell.xml` and the `pick_spell`
 * machinery around it (boe.party.cpp:2133, :1905).
 *
 * This is deliberately *one* dialog, as the original is. Down the left are the
 * six party members, each with a caster button, a target button, their health,
 * spell points and status icons; below them the spell grid, four columns of
 * one level each, flipped between levels 1-4 and 5-7 by "Other Spells".
 *
 * Layout numbers come straight from the dialog definition: headers on one row
 * at lefts 22/88/200/255/279/303, PC rows 24px apart from y=79, the spell
 * columns at x=10/162/326/486 with their LEDs 14px apart from y=247, and the
 * three buttons along the bottom at y=394.
 */

import { STATUS_ICONS, statIconRect, statusIconFor } from '../data/statusIcons';
import { NUM_NORMAL_SPELLS, SPELLS, Spell, SpellSelect, spellFromNum, spellName } from '../data/spell';
import { pcCanCastSpell, pcCanCastType, CastStatus } from '../game/spellCast';
import type { GameSession } from '../game/session';
import { Colours } from '../render/colours';
import { UiRect } from '../render/layout';
import { SheetStore } from '../render/sheets';
import {
  drawString, drawStringCentre, drawStringEllipsis, drawStringRight,
} from '../render/text';
import { tilePattern } from '../render/tiling';
import { MainStatus, Skill, Status } from '../universe/skills';
import type { ModalScreen } from './dialog';

/** The dialog fills nearly the whole 605x430 screen, as the original's does. */
const FRAME: UiRect = { top: 2, left: 2, bottom: 428, right: 603 };
const BG = 5;
const TEXT = Colours.WHITE;

// --- the six PC rows -------------------------------------------------------
const HEAD_Y = 60;
const ROW_Y = 79;
const ROW_PITCH = 24;
const X_CASTER_HEAD = 22;
const X_CASTER_BTN = 34;
const X_NAME = 88;
const X_TARGET_HEAD = 200;
const X_TARGET_BTN = 206;
const X_ARROW = 231;
const X_HP = 255;
const X_SP = 285;
const X_STATUS = 315;

// --- the spell grid --------------------------------------------------------
/**
 * The original's four columns sit at 10/162/326/486 in a dialog window 612px
 * wide — wider than this port's 605px canvas, because the C++ opens it as its
 * own OS window. Pulled in to a 146px pitch so the fourth column and the
 * buttons both fit; everything else keeps the original's numbers.
 */
const COL_X = [10, 156, 302, 448];
const GRID_HEAD_Y = 227;
const LED_Y = 247;
const LED_PITCH = 14;
const LED_W = 14;
const LED_H = 10;
const ROWS_PER_COL = 10;

// --- the buttons -----------------------------------------------------------
const BTN_Y = 394;
const BTN_H = 23;
// Likewise shifted left from the original's 371/479/549 to fit the canvas.
const X_OTHER = 355;
const X_CANCEL = 464;
const X_CAST = 534;
const W_LARGE = 102;
const W_REGULAR = 63;
const SMALL = 23;

/**
 * `spell_index` (boe.party.cpp:103) — which spell each of the 38 grid slots
 * shows on the *second* page. 90 means the slot is empty there, which is how
 * levels 5-7 (eight spells each) fit a grid built for ten.
 */
const SPELL_INDEX = [
  38, 39, 40, 41, 42, 43, 44, 45, 90, 90,
  46, 47, 48, 49, 50, 51, 52, 53, 90, 90,
  54, 55, 56, 57, 58, 59, 60, 61, 90, 90,
  90, 90, 90, 90, 90, 90, 90, 90,
];

/** What the player settled on, read by the caller once the dialog closes. */
export interface CastChoice {
  spell: Spell;
  caster: number;
  /** The PC a `needsSelect` spell was aimed at; 6 for "nobody chosen". */
  target: number;
}

export const NO_TARGET = 6;

export class CastDialog implements ModalScreen {
  private page = 0;
  private spell: Spell = Spell.NONE;
  caster: number;
  target: number = NO_TARGET;

  /**
   * @param canChooseCaster false in combat, where the active PC casts and the
   *   caster buttons are inert (`pick_spell`'s `can_choose_caster`).
   */
  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    private session: GameSession,
    private type: Skill,
    readonly canChooseCaster: boolean,
  ) {
    this.caster = session.univ.curPc;
    // pick_spell keeps the current caster if they can cast, and otherwise
    // walks the party for the first who can.
    if (canChooseCaster
      && pcCanCastType(session, session.univ.party.pcs[this.caster]!, type) !== CastStatus.OK) {
      const found = session.univ.party.pcs.findIndex(
        (pc) => pcCanCastType(session, pc, type) === CastStatus.OK);
      if (found >= 0) this.caster = found;
    }
  }

  get choice(): CastChoice {
    return { spell: this.spell, caster: this.caster, target: this.target };
  }

  /** The spell in grid slot `i` on the current page, or NONE for an empty slot. */
  private spellAt(i: number): Spell {
    const num = this.page === 0 ? i : (SPELL_INDEX[i] ?? 90);
    if (num >= 90 || num >= NUM_NORMAL_SPELLS) return Spell.NONE;
    return spellFromNum(this.type, num);
  }

  private ledRect(i: number): UiRect {
    const col = Math.floor(i / ROWS_PER_COL);
    const row = i % ROWS_PER_COL;
    const left = FRAME.left + (COL_X[col] ?? 0) + 6;
    const top = FRAME.top + LED_Y + row * LED_PITCH;
    // The hit area covers the label as well as the lamp, as the original's does.
    return { left, top, right: left + 140, bottom: top + LED_PITCH };
  }

  private rowRects(i: number): { caster: UiRect; target: UiRect } {
    const top = FRAME.top + ROW_Y + i * ROW_PITCH;
    return {
      caster: {
        left: FRAME.left + X_CASTER_BTN, top,
        right: FRAME.left + X_CASTER_BTN + SMALL, bottom: top + SMALL,
      },
      target: {
        left: FRAME.left + X_TARGET_BTN, top,
        right: FRAME.left + X_TARGET_BTN + SMALL, bottom: top + SMALL,
      },
    };
  }

  private buttonRects(): { other: UiRect; cancel: UiRect; cast: UiRect } {
    const top = FRAME.top + BTN_Y;
    const mk = (x: number, w: number): UiRect =>
      ({ left: FRAME.left + x, top, right: FRAME.left + x + w, bottom: top + BTN_H });
    return {
      other: mk(X_OTHER, W_LARGE),
      cancel: mk(X_CANCEL, W_REGULAR),
      cast: mk(X_CAST, W_REGULAR),
    };
  }

  /** Whether this spell needs a party member picked before it can be cast. */
  private needsTarget(spell: Spell): boolean {
    const select = SPELLS[spell]?.select ?? SpellSelect.NO;
    return select !== SpellSelect.NO;
  }

  // ------------------------------------------------------------------ input

  onClick(x: number, y: number): string | null {
    const btns = this.buttonRects();
    const inside = (r: UiRect): boolean =>
      x >= r.left && x < r.right && y >= r.top && y < r.bottom;

    if (inside(btns.cancel)) return 'cancel';
    if (inside(btns.cast)) return this.spell === Spell.NONE ? null : 'cast';
    if (inside(btns.other)) {
      this.page = this.page === 0 ? 1 : 0;
      return null;
    }
    for (let i = 0; i < 6; i++) {
      const { caster, target } = this.rowRects(i);
      if (inside(caster) && this.canChooseCaster) {
        const pc = this.session.univ.party.pcs[i];
        if (pc && pcCanCastType(this.session, pc, this.type) === CastStatus.OK) {
          this.caster = i;
          // Changing caster can invalidate the pick, as pick_spell_caster does.
          if (this.spell !== Spell.NONE && !this.castable(this.spell)) {
            this.spell = Spell.NONE;
            this.target = NO_TARGET;
          }
        }
        return null;
      }
      if (inside(target)) {
        this.target = i;
        return null;
      }
    }
    for (let i = 0; i < 38; i++) {
      if (!inside(this.ledRect(i))) continue;
      const spell = this.spellAt(i);
      if (spell !== Spell.NONE && this.castable(spell)) this.spell = spell;
      return null;
    }
    return null;
  }

  onKey(key: string): string | null {
    if (key === 'Escape') return 'cancel';
    if (key === 'Enter') return this.spell === Spell.NONE ? null : 'cast';
    if (key === ' ') {
      this.page = this.page === 0 ? 1 : 0;
      return null;
    }
    // 1-6 pick the caster; shift+1-6 pick the target, as the def-keys say.
    const digit = '123456'.indexOf(key);
    if (digit >= 0) {
      if (this.canChooseCaster) {
        const pc = this.session.univ.party.pcs[digit];
        if (pc && pcCanCastType(this.session, pc, this.type) === CastStatus.OK) this.caster = digit;
      }
      return null;
    }
    const shifted = '!@#$%^'.indexOf(key);
    if (shifted >= 0) {
      this.target = shifted;
      return null;
    }
    return null;
  }

  private castable(spell: Spell): boolean {
    const pc = this.session.univ.party.pcs[this.caster];
    return pc ? pcCanCastSpell(this.session, pc, spell) : false;
  }

  // ------------------------------------------------------------------- draw

  draw(): void {
    const { ctx } = this;
    const pats = this.store.get('pixpats');
    if (pats) tilePattern(ctx, pats, BG, FRAME);
    else {
      ctx.fillStyle = Colours.BLACK;
      ctx.fillRect(FRAME.left, FRAME.top, FRAME.right - FRAME.left, FRAME.bottom - FRAME.top);
    }
    ctx.strokeStyle = Colours.WHITE;
    ctx.lineWidth = 1;
    ctx.strokeRect(FRAME.left + 0.5, FRAME.top + 0.5,
      FRAME.right - FRAME.left - 1, FRAME.bottom - FRAME.top - 1);

    const at = (x: number, y: number, w = 120, h = 16): UiRect =>
      ({ left: FRAME.left + x, top: FRAME.top + y, right: FRAME.left + x + w, bottom: FRAME.top + y + h });

    drawString(ctx, at(54, 6, 200, 18), 'Select a Spell:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(X_CASTER_HEAD, HEAD_Y, 70), 'Caster:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(X_TARGET_HEAD, HEAD_Y, 70), 'Target:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(X_HP, HEAD_Y, 30), 'HP:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(X_SP, HEAD_Y, 30), 'SP:', { size: 12, font: 'bold', colour: TEXT });
    drawString(ctx, at(X_STATUS, HEAD_Y, 80), 'Status:', { size: 12, font: 'bold', colour: TEXT });

    this.drawParty(at);
    this.drawGrid(at);
    this.drawButtons();
  }

  private drawParty(at: (x: number, y: number, w?: number, h?: number) => UiRect): void {
    const { ctx } = this;
    const icons = this.store.get('staticons');
    for (let i = 0; i < 6; i++) {
      const pc = this.session.univ.party.pcs[i];
      if (!pc || pc.mainStatus === MainStatus.ABSENT) continue;
      const y = ROW_Y + i * ROW_PITCH;
      const rects = this.rowRects(i);
      const canCast = pcCanCastType(this.session, pc, this.type) === CastStatus.OK;

      // Caster button: lit for the chosen caster, greyed where they can't cast.
      this.drawSmallButton(rects.caster, String(i + 1),
        this.caster === i, !canCast || !this.canChooseCaster);
      drawStringEllipsis(ctx, at(X_NAME, y + 4, 112), pc.name,
        { size: 12, colour: canCast ? TEXT : Colours.GREY });

      // Target button and the green arrow that marks the pick.
      this.drawSmallButton(rects.target, String(i + 1), this.target === i, false);
      if (this.target === i) {
        drawString(ctx, at(X_ARROW, y + 4, 24), '->', { size: 12, colour: Colours.GREEN });
      }

      if (pc.mainStatus === MainStatus.ALIVE) {
        drawStringRight(ctx, at(X_HP, y + 4, 26), String(pc.curHealth),
          { size: 12, colour: Colours.RED });
        drawStringRight(ctx, at(X_SP, y + 4, 26), String(pc.curSp),
          { size: 12, colour: Colours.BLUE });
        // The same status strip the party panel draws, at the same 13px pitch.
        if (icons) {
          let left = FRAME.left + X_STATUS;
          for (const key of Object.keys(STATUS_ICONS)) {
            const which = Number(key) as Status;
            const code = statusIconFor(which, pc.status[which] ?? 0);
            if (code < 0) continue;
            const from = statIconRect(code);
            ctx.drawImage(icons, from.left, from.top, 12, 12,
              left, FRAME.top + y + 3, 12, 12);
            left += 13;
          }
        }
      } else {
        // The dialog says so in place of the status icons (`dead1`..`dead6`).
        drawString(ctx, at(X_HP, y + 4, 90), 'Dead', { size: 12, colour: Colours.GREY });
      }
    }
  }

  private drawGrid(at: (x: number, y: number, w?: number, h?: number) => UiRect): void {
    const { ctx } = this;
    const leds = this.store.get('dlogbtnled');
    const headers = this.page === 0
      ? ['Level 1:', 'Level 2:', 'Level 3:', 'Level 4:']
      : ['Level 5:', 'Level 6:', 'Level 7:', ''];
    headers.forEach((label, col) => {
      if (!label) return;
      drawString(ctx, at((COL_X[col] ?? 0), GRID_HEAD_Y, 100), label,
        { size: 12, font: 'bold', colour: TEXT });
    });

    for (let i = 0; i < 38; i++) {
      const spell = this.spellAt(i);
      if (spell === Spell.NONE) continue;
      const rect = this.ledRect(i);
      const usable = this.castable(spell);
      // eLedState is `{led_green = 0, led_red, led_off}`, and led.hpp:18 spells
      // out what they mean *in this dialog*: red is "you can cast it", green is
      // "this is the one you picked", off is "you can't".
      const state = this.spell === spell ? 0 : usable ? 1 : 2;
      if (leds) {
        ctx.drawImage(leds, state * LED_W, 0, LED_W, LED_H,
          rect.left, rect.top + 1, LED_W, LED_H);
      }
      // Simulacrum's cost depends on the creature, so the C++ shows '?'.
      const rawCost = SPELLS[spell]?.cost ?? 0;
      const cost = rawCost < 0 ? '?' : String(rawCost);
      drawString(ctx, {
        left: rect.left + LED_W + 3, top: rect.top - 1,
        right: rect.right, bottom: rect.top + LED_PITCH,
      }, `${spellName(spell)} (${cost})`, {
        size: 10, font: 'bold', colour: usable ? TEXT : Colours.GREY,
      });
    }
  }

  private drawButtons(): void {
    const { ctx } = this;
    const rects = this.buttonRects();
    const lg = this.store.get('dlogbtnlg');
    const med = this.store.get('dlogbtnmed');
    const label = (r: UiRect, text: string): void => {
      drawStringCentre(ctx, { ...r, top: r.top + 4 }, text,
        { size: 12, colour: Colours.BLACK });
    };
    if (lg) ctx.drawImage(lg, 0, 0, W_LARGE, BTN_H, rects.other.left, rects.other.top, W_LARGE, BTN_H);
    if (med) {
      ctx.drawImage(med, 0, 0, W_REGULAR, BTN_H,
        rects.cancel.left, rects.cancel.top, W_REGULAR, BTN_H);
      ctx.drawImage(med, 0, 0, W_REGULAR, BTN_H,
        rects.cast.left, rects.cast.top, W_REGULAR, BTN_H);
    }
    label(rects.other, 'Other Spells');
    label(rects.cancel, 'Cancel');
    label(rects.cast, 'Cast');
  }

  /** A 23x23 button from dlogbtnsm.png; frame 1 is the pressed state. */
  private drawSmallButton(rect: UiRect, key: string, lit: boolean, dim: boolean): void {
    const { ctx } = this;
    const sheet = this.store.get('dlogbtnsm');
    if (sheet) {
      ctx.drawImage(sheet, lit ? SMALL : 0, 0, SMALL, SMALL,
        rect.left, rect.top, SMALL, SMALL);
    }
    drawStringCentre(ctx, { ...rect, top: rect.top + 4 }, key,
      { size: 12, colour: dim ? Colours.GREY : Colours.BLACK });
  }
}
