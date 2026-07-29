/**
 * Running a dialogxml definition — the drawing and event halves of `cDialog`
 * (dialogxml/dialogs/dialog.cpp) and its widgets.
 *
 * The C++ blocks in `cDialog::run()` and calls click handlers from inside;
 * here the dialog is a `ModalScreen` the host pumps, and a handler that wants
 * the dialog to stay open says so. That is the same ASYNCIFY replacement
 * PLAN.md §2.3 describes, applied to the toolkit itself.
 *
 * The API mirrors how the game code addresses its dialogs — `me["day"]
 * .setTextToNum(n)`, `me["take1"].hide()` — so a ported call site reads like
 * the original: `dlg.setNum('day', n)`, `dlg.hide('take1')`.
 */

import { Colours } from '../render/colours';
import { BOE_HEIGHT, BOE_WIDTH, UiRect, height, width } from '../render/layout';
import { itemGraphic } from '../render/itemPics';
import { monsterGraphic } from '../render/monsterPics';
import { SheetStore, calcRect } from '../render/sheets';
import { statIconRect } from '../data/statusIcons';
import { terrainGraphic } from '../render/terrainPics';
import { drawString, drawStringCentre, measureString, wrapLines } from '../render/text';
import { tilePattern } from '../render/tiling';
import {
  ButtonControl, ButtonType, DialogControl, DialogDef, FontSpec, LedControl,
  LedState, PictControl, PictType, TextControl,
} from './dialogXml';
import { ModalScreen } from './dialog';

/** cDialog::BG_DARK, and the white text that goes with it (dialog.cpp:49/405). */
const BG_DARK = 5;
const DEF_TEXT = Colours.WHITE;

/**
 * `cButton::btnRects` (button.cpp:247) — the source rect of each button type's
 * unpressed frame, and which sheet it comes from. The pressed frame sits at a
 * fixed offset, given here as `pressed`.
 */
const BUTTON_ART: Record<ButtonType, {
  sheet: string; w: number; h: number; x: number; y: number;
  pressed: { dx: number; dy: number };
}> = {
  small: { sheet: 'dlogbtnsm', w: 23, h: 23, x: 0, y: 0, pressed: { dx: 23, dy: 0 } },
  regular: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  done: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  left: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 23, pressed: { dx: 63, dy: 0 } },
  right: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 46, pressed: { dx: 63, dy: 0 } },
  up: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 69, pressed: { dx: 63, dy: 0 } },
  down: { sheet: 'dlogbtnmed', w: 63, h: 23, x: 0, y: 92, pressed: { dx: 63, dy: 0 } },
  large: { sheet: 'dlogbtnlg', w: 102, h: 23, x: 0, y: 0, pressed: { dx: 102, dy: 0 } },
  help: { sheet: 'dlogbtnhelp', w: 16, h: 13, x: 0, y: 0, pressed: { dx: 16, dy: 0 } },
  // btnRects are {top,left,bottom,right}: the tiny button sits at x=42 on the
  // LED sheet, not y=42.
  tiny: { sheet: 'dlogbtnled', w: 14, h: 10, x: 42, y: 0, pressed: { dx: 0, dy: 10 } },
  tall: { sheet: 'dlogbtntall', w: 63, h: 40, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  trait: { sheet: 'dlogbtntall', w: 63, h: 40, x: 0, y: 0, pressed: { dx: 63, dy: 0 } },
  push: { sheet: 'dlgbtnred', w: 30, h: 30, x: 0, y: 0, pressed: { dx: 30, dy: 0 } },
};

/** `basic_buttons` (basicbtns.cpp:19) — a `done` button labels itself. */
const DONE_LABEL = 'Done';

/** cLed::ledRects (led.cpp:18): three states across, pressed below. */
const LED_W = 14;
const LED_H = 10;
const LED_TEXT_SPACE = 4;
const LED_ORDER: LedState[] = ['red', 'green', 'off'];

/** The `colour_map` names the dialogs actually use. */
const COLOURS: Record<string, string> = {
  black: Colours.BLACK,
  white: Colours.WHITE,
  red: Colours.RED,
  'light-green': Colours.LIGHT_GREEN,
  'light-blue': Colours.LIGHT_BLUE,
  // `link` is the blue the C++ uses for clickable text in a message.
  link: Colours.LIGHT_BLUE,
};

/** cControl::drawFrame's two greys (control.cpp:443). */
const FRAME_DARK = 'rgb(48,48,48)';
const FRAME_LIGHT = 'rgb(224,224,224)';

/**
 * How big a control actually is. The C++ settles this when the definition is
 * parsed — `cButton::setBtnType` and `cLed` write their art's size into the
 * control's frame — so by the time `recalcRect` measures the window the sizes
 * are there. This port keeps the definition as read and answers the question
 * here instead, which means *both* the measuring pass and the hit test have to
 * ask; a button given only a `top`/`left` (quest-info's Done) sized as nothing
 * otherwise, and the window closed above it.
 *
 * A pict is the exception: it draws at its picture's natural size, which can
 * change at runtime with `setPictType`, so it is left as written.
 */
function controlSize(control: DialogControl): { w: number; h: number } {
  let w = width(control.rect);
  let h = height(control.rect);
  if (control.kind === 'button') {
    const art = BUTTON_ART[control.type];
    // A button is exactly its art, except the labelled kinds, which the
    // definition may stretch wider.
    w = Math.max(w, art.w);
    h = Math.max(h, art.h);
    if (control.type !== 'large' && control.type !== 'regular' && control.type !== 'done') {
      w = art.w;
      h = art.h;
    }
  } else if (control.kind === 'led') {
    w = Math.max(w, LED_W);
    h = Math.max(h, LED_H);
  }
  return { w, h };
}

/** What a handler tells the runner to do once it has run. */
export type DialogAction = 'stay' | 'close';

export interface XmlDialogOptions {
  /** Where to put the panel; by default it is centred, as the C++ centres it. */
  origin?: { x: number; y: number };
}

/**
 * One running dialog. Controls keep their definition; what the game changes at
 * runtime (text, visibility, LED state, picture number) lives in the maps here,
 * so a definition can be shown twice without carrying state between showings.
 */
export class XmlDialog implements ModalScreen {
  readonly frame: UiRect;
  private textOverride = new Map<string, string>();
  private hidden = new Set<string>();
  private ledState = new Map<string, LedState>();
  private picNum = new Map<string, number>();
  private picType = new Map<string, PictType>();
  private colour = new Map<string, string>();
  private handlers = new Map<string, (dlg: XmlDialog) => DialogAction>();
  /** The control the pointer is holding down, drawn pressed. */
  private pressed: string | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    readonly def: DialogDef,
    options: XmlDialogOptions = {},
  ) {
    // `cDialog::recalcRect` (dialog.cpp:425): the window is as big as its
    // furthest control plus a 6px margin. Controls positioned against the
    // dialog's own edges (`neg` with no anchor) are placed afterwards, since
    // they need the size that measurement produced.
    let right = 0;
    let bottom = 0;
    for (const c of def.controls) {
      if (this.negX(c) || this.negY(c)) continue;
      const { w, h } = controlSize(c);
      right = Math.max(right, c.rect.left + w);
      bottom = Math.max(bottom, c.rect.top + h);
    }
    right += 6;
    bottom += 6;
    for (const c of def.controls) {
      if (!this.negX(c) && !this.negY(c)) continue;
      const w = width(c.rect);
      const h = height(c.rect);
      const left = this.negX(c) ? right - c.rect.left : c.rect.left;
      const top = this.negY(c) ? bottom - c.rect.top : c.rect.top;
      c.rect = { top, left, bottom: top + h, right: left + w };
    }
    const origin = options.origin ?? {
      x: Math.round((BOE_WIDTH - right) / 2),
      y: Math.round((BOE_HEIGHT - bottom) / 2),
    };
    this.frame = {
      left: origin.x, top: origin.y, right: origin.x + right, bottom: origin.y + bottom,
    };
  }

  /** A control still carrying `neg` positioning is placed against the window. */
  private negX(c: DialogControl): boolean {
    return !c.anchor && !c.relAnchor && (c.relative[0] === 'neg');
  }

  private negY(c: DialogControl): boolean {
    const [h = 'abs', v = h] = c.relative;
    return !c.anchor && !c.relAnchor && v === 'neg';
  }

  // ------------------------------------------------------------- the API

  /** `me[name].setText(str)`. */
  setText(name: string, text: string): this {
    this.textOverride.set(name, text);
    return this;
  }

  /** `me[name].setTextToNum(n)`. */
  setNum(name: string, n: number): this {
    return this.setText(name, String(n));
  }

  getText(name: string): string {
    const override = this.textOverride.get(name);
    if (override !== undefined) return override;
    const control = this.def.byName.get(name);
    if (!control) return '';
    if (control.kind === 'text' || control.kind === 'field') return control.text;
    if (control.kind === 'button' || control.kind === 'led') return control.label;
    return '';
  }

  show(name: string): this {
    this.hidden.delete(name);
    return this;
  }

  hide(name: string): this {
    this.hidden.add(name);
    return this;
  }

  isVisible(name: string): boolean {
    return !this.hidden.has(name);
  }

  /** `me[name].setPict(n)` — swap which picture a `<pict>` shows. */
  setPict(name: string, num: number): this {
    this.picNum.set(name, num);
    return this;
  }

  /** `setPict(n, type)` — the two-argument form, which also changes the kind. */
  setPictType(name: string, type: PictType, num: number): this {
    this.picType.set(name, type);
    return this.setPict(name, num);
  }

  setColour(name: string, colour: string): this {
    this.colour.set(name, colour);
    return this;
  }

  setLed(name: string, state: LedState): this {
    this.ledState.set(name, state);
    // A group lights one LED at a time, so setting one clears its siblings.
    const group = this.def.controls.find(
      (c) => c.kind === 'group' && c.leds.some((l) => l.name === name));
    if (group?.kind === 'group' && state !== 'off') {
      for (const led of group.leds) {
        if (led.name !== name) this.ledState.set(led.name, 'off');
      }
    }
    return this;
  }

  getLed(name: string): LedState {
    const control = this.def.byName.get(name);
    return this.ledState.get(name)
      ?? (control?.kind === 'led' ? control.state : 'off');
  }

  /** The lit LED of a group, or null — `cLedGroup::getSelected`. */
  getSelected(group: string): string | null {
    const control = this.def.byName.get(group);
    if (control?.kind !== 'group') return null;
    for (const led of control.leds) if (this.getLed(led.name) !== 'off') return led.name;
    return null;
  }

  /**
   * `attachClickHandler`. Without one, clicking a control closes the dialog and
   * hands its name back — which is what the majority of the game's buttons do.
   */
  attachHandler(name: string, fn: (dlg: XmlDialog) => DialogAction): this {
    this.handlers.set(name, fn);
    return this;
  }

  // ------------------------------------------------------- events

  onClick(x: number, y: number): string | null {
    const hit = this.controlAt(x, y);
    this.pressed = null;
    if (!hit) return null;
    return this.activate(hit.name);
  }

  onKey(key: string): string | null {
    if (key === 'Escape' && this.def.escBtn) return this.activate(this.def.escBtn);
    if ((key === 'Enter' || key === 'Return') && this.def.defBtn) {
      return this.activate(this.def.defBtn);
    }
    const wanted = key.length === 1 ? key.toLowerCase() : KEY_NAMES[key];
    if (!wanted) return null;
    for (const control of this.clickable()) {
      if (control.defKey === wanted) return this.activate(control.name);
    }
    return null;
  }

  /** Run a control's handler, or close with its name when it has none. */
  private activate(name: string): string | null {
    if (this.hidden.has(name)) return null;
    const control = this.def.byName.get(name);
    // An LED toggles itself before its handler sees the click, as cLedGroup
    // does when it selects one of its own.
    if (control?.kind === 'led') {
      this.setLed(name, this.getLed(name) === 'off' ? 'red' : 'off');
    }
    const handler = this.handlers.get(name);
    if (!handler) return name;
    return handler(this) === 'close' ? name : null;
  }

  /** Every control a click can land on, in draw order. */
  private clickable(): DialogControl[] {
    const out: DialogControl[] = [];
    for (const c of this.def.controls) {
      if (c.kind === 'button' || c.kind === 'led') out.push(c);
      else if (c.kind === 'group') out.push(...c.leds);
      // A pict or a text with a shortcut is clickable too (view-sign's
      // picture, and the `def-key` messages some dialogs use as links).
      else if ((c.kind === 'pict' || c.kind === 'text') && (c.defKey || this.handlers.has(c.name))) {
        out.push(c);
      }
    }
    return out;
  }

  private controlAt(x: number, y: number): DialogControl | null {
    for (const control of this.clickable()) {
      if (!control.name || this.hidden.has(control.name)) continue;
      const r = this.screenRect(control);
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return control;
    }
    return null;
  }

  /** A control's rect in screen coordinates (its own is dialog-relative). */
  screenRect(control: DialogControl): UiRect {
    const { rect } = control;
    const { w, h } = controlSize(control);
    return {
      left: this.frame.left + rect.left,
      top: this.frame.top + rect.top,
      right: this.frame.left + rect.left + w,
      bottom: this.frame.top + rect.top + h,
    };
  }

  // ------------------------------------------------------- drawing

  draw(): void {
    const { ctx, frame } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(frame.left + 4, frame.top + 4, width(frame), height(frame));
    ctx.fillStyle = Colours.BLACK;
    ctx.fillRect(frame.left, frame.top, width(frame), height(frame));
    const pats = this.store.get('pixpats');
    const inner: UiRect = {
      top: frame.top + 2, left: frame.left + 2,
      bottom: frame.bottom - 2, right: frame.right - 2,
    };
    if (pats) tilePattern(ctx, pats, BG_DARK, inner);
    else {
      ctx.fillStyle = Colours.GREY;
      ctx.fillRect(inner.left, inner.top, width(inner), height(inner));
    }

    for (const control of this.def.controls) {
      if (control.name && this.hidden.has(control.name)) continue;
      switch (control.kind) {
        case 'text': this.drawText(control); break;
        case 'button': this.drawButton(control); break;
        case 'pict': this.drawPict(control); break;
        case 'led': this.drawLed(control); break;
        case 'group':
          for (const led of control.leds) {
            if (!this.hidden.has(led.name)) this.drawLed(led);
          }
          break;
        case 'field': this.drawField(control); break;
        case 'line': this.drawLine(control); break;
        default: break;
      }
    }
  }

  private style(font: FontSpec, name: string): { font: 'plain' | 'bold' | 'dungeon' | 'maidenword'; size: number; colour: string } {
    const named = this.colour.get(name) ?? font.colour;
    return {
      font: font.font === 'bold' ? 'bold' : font.font,
      size: font.size,
      colour: named ? COLOURS[named] ?? named : DEF_TEXT,
    };
  }

  /** cControl::drawFrame (control.cpp:440) — a 2px inset frame. */
  private drawFrame(rect: UiRect): void {
    const { ctx } = this;
    const r = { top: rect.top - 2, left: rect.left - 2, bottom: rect.bottom + 2, right: rect.right + 2 };
    ctx.strokeStyle = FRAME_DARK;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, width(r) - 1, height(r) - 1);
    // The inset highlight: the same frame again, clipped to everything but the
    // top and left edges, so the light grey shows only on the inside corner.
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.left + 1, r.top + 1, width(r) - 1, height(r) - 1);
    ctx.clip();
    ctx.strokeStyle = FRAME_LIGHT;
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, width(r) - 1, height(r) - 1);
    ctx.restore();
  }

  private drawText(control: TextControl): void {
    const rect = this.screenRect(control);
    if (control.framed) this.drawFrame(rect);
    const style = this.style(control.font, control.name);
    const text = this.getText(control.name) || control.text;
    if (!text) return;
    // A message wraps inside its own rect, which is what gives the multi-line
    // blocks in the game's dialogs their shape.
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      lines.push(...(paragraph.length === 0
        ? ['']
        : wrapLines(this.ctx, paragraph, width(rect), style)));
    }
    const lineHeight = style.size + 2;
    let y = rect.top;
    for (const line of lines) {
      if (y > rect.bottom) break;
      const box = { ...rect, top: y, bottom: y + lineHeight };
      if (control.align === 'right') {
        const w = measureString(this.ctx, line, style);
        drawString(this.ctx, { ...box, left: rect.right - w }, line, style);
      } else {
        drawString(this.ctx, box, line, style);
      }
      y += lineHeight;
    }
  }

  private drawButton(control: ButtonControl): void {
    const rect = this.screenRect(control);
    const art = BUTTON_ART[control.type];
    const sheet = this.store.get(art.sheet);
    const down = this.pressed === control.name;
    if (sheet) {
      this.ctx.drawImage(
        sheet,
        art.x + (down ? art.pressed.dx : 0), art.y + (down ? art.pressed.dy : 0),
        art.w, art.h,
        rect.left, rect.top, width(rect), height(rect),
      );
    } else {
      this.ctx.fillStyle = Colours.GREY;
      this.ctx.fillRect(rect.left, rect.top, width(rect), height(rect));
    }
    const label = this.getText(control.name)
      || (control.type === 'done' ? DONE_LABEL : control.label);
    if (!label) return;
    // The face text is black and centred, at 12pt unless the button says
    // otherwise (a tiny button is 9, a push button 10).
    const size = control.textSize
      ?? (control.type === 'tiny' ? 9 : control.type === 'push' ? 10 : 12);
    const style = { size, colour: Colours.BLACK, font: 'bold' as const };
    if (control.type === 'tiny') {
      // A tiny button's label sits *beside* it (TINY_TEXT_OFFSET = 18).
      drawString(this.ctx, { ...rect, left: rect.left + 18, top: rect.top - 1 },
        label, { ...style, colour: this.style(
          { font: 'bold', size }, control.name).colour });
      return;
    }
    drawStringCentre(this.ctx, { ...rect, top: rect.top + Math.floor((height(rect) - size) / 2) },
      label, style);
  }

  private drawLed(control: LedControl): void {
    const rect = this.screenRect(control);
    const sheet = this.store.get('dlogbtnled');
    const state = this.getLed(control.name);
    const style = this.style(control.font, control.name);
    const label = this.getText(control.name) || control.label;
    const labelWidth = measureString(this.ctx, label, style);
    const lampLeft = control.labelPos === 'right'
      ? rect.left
      : rect.left + labelWidth + LED_TEXT_SPACE;
    const textLeft = control.labelPos === 'right'
      ? rect.left + LED_W + LED_TEXT_SPACE
      : rect.left;
    if (sheet) {
      this.ctx.drawImage(
        sheet, LED_ORDER.indexOf(state) * LED_W, 0, LED_W, LED_H,
        lampLeft, rect.top, LED_W, LED_H,
      );
    }
    if (label) {
      drawString(this.ctx, { ...rect, left: textLeft, top: rect.top - 1 }, label, style);
    }
  }

  /**
   * The `<pict>` kinds the player's dialogs use. Each draws at its own natural
   * size from the control's top-left, as `cPict`'s draw methods do — the rect
   * in the file is a position, not a scale.
   */
  private drawPict(control: PictControl): void {
    const rect = this.screenRect(control);
    const num = this.picNum.get(control.name) ?? control.num;
    const type = this.picType.get(control.name) ?? control.type;
    const { ctx } = this;
    const blit = (sheetName: string, from: { left: number; top: number; width: number; height: number },
      w = from.width, h = from.height): void => {
      const sheet = this.store.get(sheetName);
      if (!sheet) return;
      ctx.drawImage(sheet, from.left, from.top, from.width, from.height, rect.left, rect.top, w, h);
    };
    switch (type) {
      case 'dlog': {
        // dlogpics.png is a 4-across grid of 36x36 portraits.
        const size = control.size === 'large' ? 72 : 36;
        blit('dlogpics', { left: 36 * (num % 4), top: 36 * Math.floor(num / 4), width: size, height: size });
        break;
      }
      case 'talk':
        blit('talkportraits', { left: 32 * (num % 10), top: 32 * Math.floor(num / 10), width: 32, height: 32 });
        break;
      case 'scen':
        blit('scenpics', { left: 32 * (num % 5), top: 32 * Math.floor(num / 5), width: 32, height: 32 });
        break;
      case 'item': {
        const g = itemGraphic(num);
        if (g) blit(g.sheetName, g.rect);
        break;
      }
      case 'pc': {
        // calc_rect(2 * (num / 8), num % 8) — the same column pairing the
        // party symbol uses, taking the left-facing frame.
        const r = calcRect(2 * Math.floor(num / 8), num % 8);
        blit('pcs', r);
        break;
      }
      case 'monst': {
        const g = monsterGraphic(num);
        if (g) blit(g.sheetName, g.rect);
        break;
      }
      case 'ter': {
        const g = terrainGraphic(num);
        if (g) blit(g.sheetName, g.rect);
        break;
      }
      case 'status': {
        const at = statIconRect(num);
        blit('staticons', { ...at, width: 12, height: 12 });
        break;
      }
      case 'blank':
      default:
        ctx.fillStyle = Colours.GREY;
        ctx.fillRect(rect.left, rect.top, width(rect), height(rect));
        break;
    }
    if (control.framed) this.drawFrame(rect);
  }

  /**
   * A text field. It draws its frame and contents; typing into one needs the
   * focus/caret handling `cTextField` has, which no dialog this port runs yet
   * requires. TODO(M7): the save/load and character-creation dialogs will.
   */
  private drawField(control: DialogControl): void {
    if (control.kind !== 'field') return;
    const rect = this.screenRect(control);
    this.drawFrame(rect);
    const text = this.getText(control.name) || control.text;
    if (text) {
      drawString(this.ctx, rect, text, { size: 10, colour: DEF_TEXT, font: 'plain' });
    }
  }

  private drawLine(control: DialogControl): void {
    const rect = this.screenRect(control);
    this.ctx.strokeStyle = FRAME_LIGHT;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(rect.left, rect.top + 0.5);
    this.ctx.lineTo(rect.right, rect.bottom + 0.5);
    this.ctx.stroke();
  }
}

/** The `def-key` names for keys that aren't a single character. */
const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Escape: 'esc',
  Enter: 'enter',
  Tab: 'tab',
  ' ': 'space',
};
