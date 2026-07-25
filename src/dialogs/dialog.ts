/**
 * A minimal async modal dialog, standing in for the dialogxml toolkit until
 * that lands. It covers what the game needs most often: a picture, some text,
 * and a row of buttons — the shape of `view-sign`, `locked-door-action`, and
 * the message/choice dialogs the specials VM raises.
 *
 * This is the async replacement for the C++ ASYNCIFY-blocking `cDialog::show()`
 * described in PLAN.md §2.3: `run()` returns a Promise that resolves with the
 * name of the button the player clicked. While a dialog is up the input router
 * suppresses game input via its `dialogStack`, giving the same observable
 * modality without blocking.
 */

import { Colours } from '../render/colours';
import { BOE_HEIGHT, BOE_WIDTH, UiRect, height, width } from '../render/layout';
import { itemGraphic } from '../render/itemPics';
import { SheetStore } from '../render/sheets';
import { terrainGraphic } from '../render/terrainPics';
import { drawString, wrapLines } from '../render/text';
import { tilePattern } from '../render/tiling';

/**
 * cDialog::BG_DARK (dialog.cpp:49) is the game's default dialog background, and
 * text on it is white (dialog.cpp:405).
 */
const DIALOG_BG = 5;
const DIALOG_TEXT = Colours.WHITE;
const TEXT_SIZE = 12;
const LINE_HEIGHT = 14;
const PADDING = 10;
/**
 * Two button sizes, matching the dialogs' `type='regular'` and `type='large'`:
 * regular frames are 63x23 on dlogbtnmed.png, large ones 102x23 on
 * dlogbtnlg.png. Each sheet holds the normal frame then the pressed frame.
 */
const BUTTON_H = 23;
const BUTTON_REGULAR_W = 63;
const BUTTON_LARGE_W = 102;
const BUTTON_GAP = 8;

export interface DialogButton {
  /** Returned by `run()` when this button is clicked. */
  name: string;
  label: string;
  /** Keyboard shortcut, matched case-insensitively against event.key. */
  key?: string;
}

/** A selectable row, used for pick-lists like "get which item?". */
export interface DialogRow {
  /** Returned by `run()` when this row is clicked. */
  name: string;
  label: string;
  /** Item graphic number to show beside the label, if any. */
  itemPic?: number;
}

export interface DialogSpec {
  text: string;
  buttons: DialogButton[];
  /** Terrain picture number shown at the left, if any. */
  terPic?: number;
  /** Selectable rows shown between the text and the buttons. */
  rows?: DialogRow[];
  /** Button returned when the player presses Escape. */
  escapeButton?: string;
  title?: string;
}

interface PlacedDialogButton extends DialogButton {
  rect: UiRect;
  large: boolean;
}

interface PlacedDialogRow extends DialogRow {
  rect: UiRect;
}

/** Selectable rows are a line tall plus a little breathing room. */
const ROW_H = 20;

export class Dialog {
  private frame: UiRect = { top: 0, left: 0, bottom: 0, right: 0 };
  private placed: PlacedDialogButton[] = [];
  private placedRows: PlacedDialogRow[] = [];
  private lines: string[] = [];

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    readonly spec: DialogSpec,
  ) {
    this.layout();
  }

  /**
   * Size the panel to its content and centre it, then place the buttons in a
   * row along the bottom.
   */
  private layout(): void {
    const maxTextWidth = 300;
    const picWidth = this.spec.terPic === undefined ? 0 : 28 + PADDING;
    this.lines = [];
    // The game's text uses '|' as a hard line break (see showError and the
    // dialog XML), so honour both that and real newlines.
    for (const paragraph of this.spec.text.split(/[\n|]/)) {
      if (paragraph.trim().length === 0) {
        this.lines.push('');
        continue;
      }
      this.lines.push(
        ...wrapLines(this.ctx, paragraph, maxTextWidth, { size: TEXT_SIZE }),
      );
    }

    this.ctx.font = `${TEXT_SIZE}px BoEPlain, sans-serif`;
    let textWidth = 0;
    for (const line of this.lines) textWidth = Math.max(textWidth, this.ctx.measureText(line).width);
    textWidth = Math.min(Math.max(textWidth, 180), maxTextWidth);

    // A label that won't fit a regular button gets a large one.
    const sizes = this.spec.buttons.map((btn) => {
      const labelWidth = this.ctx.measureText(btn.label).width;
      return labelWidth + 12 <= BUTTON_REGULAR_W ? BUTTON_REGULAR_W : BUTTON_LARGE_W;
    });
    const buttonsWidth =
      sizes.reduce((a, b) => a + b, 0) + (this.spec.buttons.length - 1) * BUTTON_GAP;
    const innerWidth = Math.max(textWidth + picWidth, buttonsWidth);
    const rows = this.spec.rows ?? [];
    const innerHeight =
      Math.max(this.lines.length * LINE_HEIGHT, this.spec.terPic === undefined ? 0 : 36) +
      (rows.length > 0 ? PADDING + rows.length * ROW_H : 0) +
      PADDING +
      BUTTON_H;

    const w = innerWidth + 2 * PADDING;
    const h = innerHeight + 2 * PADDING;
    const left = Math.round((BOE_WIDTH - w) / 2);
    const top = Math.round((BOE_HEIGHT - h) / 2);
    this.frame = { top, left, bottom: top + h, right: left + w };

    // Rows stack under the text, each one clickable across the full width.
    this.placedRows = [];
    let rowY = this.frame.top + PADDING + Math.max(
      this.lines.length * LINE_HEIGHT,
      this.spec.terPic === undefined ? 0 : 36,
    ) + (rows.length > 0 ? PADDING : 0);
    for (const row of rows) {
      this.placedRows.push({
        ...row,
        rect: {
          top: rowY,
          left: this.frame.left + PADDING,
          bottom: rowY + ROW_H,
          right: this.frame.right - PADDING,
        },
      });
      rowY += ROW_H;
    }

    // Buttons sit right-aligned along the bottom edge, as the game's do.
    this.placed = [];
    let x = this.frame.right - PADDING - buttonsWidth;
    const y = this.frame.bottom - PADDING - BUTTON_H;
    this.spec.buttons.forEach((btn, i) => {
      const w = sizes[i]!;
      this.placed.push({
        ...btn,
        large: w === BUTTON_LARGE_W,
        rect: { top: y, left: x, bottom: y + BUTTON_H, right: x + w },
      });
      x += w + BUTTON_GAP;
    });
  }

  draw(): void {
    const { ctx, frame } = this;
    // Drop shadow, frame, patterned interior.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(frame.left + 4, frame.top + 4, width(frame), height(frame));
    ctx.fillStyle = Colours.BLACK;
    ctx.fillRect(frame.left, frame.top, width(frame), height(frame));
    const pats = this.store.get('pixpats');
    const inner: UiRect = {
      top: frame.top + 2,
      left: frame.left + 2,
      bottom: frame.bottom - 2,
      right: frame.right - 2,
    };
    if (pats) tilePattern(ctx, pats, DIALOG_BG, inner);
    else {
      ctx.fillStyle = Colours.GREY;
      ctx.fillRect(inner.left, inner.top, width(inner), height(inner));
    }

    let textLeft = frame.left + PADDING;
    if (this.spec.terPic !== undefined) {
      const g = terrainGraphic(this.spec.terPic);
      const sheet = g ? this.store.get(g.sheetName) : undefined;
      if (g && sheet) {
        ctx.drawImage(
          sheet, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
          textLeft, frame.top + PADDING, 28, 36,
        );
      }
      textLeft += 28 + PADDING;
    }

    let y = frame.top + PADDING;
    for (const line of this.lines) {
      drawString(ctx, { top: y, left: textLeft, bottom: y + LINE_HEIGHT, right: frame.right }, line, {
        size: TEXT_SIZE,
        colour: DIALOG_TEXT,
      });
      y += LINE_HEIGHT;
    }

    for (const row of this.placedRows) {
      const label = row.rect;
      let textLeft2 = label.left + 2;
      if (row.itemPic !== undefined) {
        const g = itemGraphic(row.itemPic);
        const sheet = g ? this.store.get(g.sheetName) : undefined;
        if (g && sheet) {
          ctx.drawImage(
            sheet, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
            textLeft2, label.top, 18, 18,
          );
        }
        textLeft2 += 22;
      }
      drawString(
        ctx,
        { ...label, left: textLeft2, top: label.top + 3 },
        row.label,
        { size: TEXT_SIZE, colour: Colours.LIGHT_BLUE },
      );
    }

    for (const btn of this.placed) {
      const btnSheet = this.store.get(btn.large ? 'dlogbtnlg' : 'dlogbtnmed');
      if (btnSheet) {
        ctx.drawImage(
          btnSheet, 0, 0, width(btn.rect), BUTTON_H,
          btn.rect.left, btn.rect.top, width(btn.rect), height(btn.rect),
        );
      } else {
        ctx.fillStyle = Colours.GREY;
        ctx.fillRect(btn.rect.left, btn.rect.top, width(btn.rect), height(btn.rect));
      }
      // Centre the label on the button face.
      ctx.font = `${TEXT_SIZE}px BoEPlain, sans-serif`;
      const w = ctx.measureText(btn.label).width;
      drawString(
        ctx,
        {
          top: btn.rect.top + 5,
          left: btn.rect.left + (width(btn.rect) - w) / 2,
          bottom: btn.rect.bottom,
          right: btn.rect.right,
        },
        btn.label,
        { size: TEXT_SIZE, colour: Colours.BLACK },
      );
    }
  }

  /** The button or row (if any) at a screen position. */
  buttonAt(x: number, y: number): { name: string } | null {
    for (const btn of this.placed) {
      const r = btn.rect;
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return btn;
    }
    for (const row of this.placedRows) {
      const r = row.rect;
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return row;
    }
    return null;
  }

  /** The button a keypress activates, if any. */
  buttonForKey(key: string): DialogButton | null {
    if (key === 'Escape') {
      const name = this.spec.escapeButton;
      if (name) return this.placed.find((b) => b.name === name) ?? null;
      return null;
    }
    if (key === 'Enter' || key === ' ') return this.placed[this.placed.length - 1] ?? null;
    const lower = key.toLowerCase();
    return this.placed.find((b) => b.key?.toLowerCase() === lower) ?? null;
  }
}

/**
 * Owns the modal stack. The game holds one of these; `run()` shows a dialog and
 * resolves once the player picks a button.
 */
export class DialogHost {
  private current: Dialog | null = null;
  private resolve: ((name: string) => void) | null = null;

  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
    /** Called whenever the dialog needs repainting over the game screen. */
    private redraw: () => void,
  ) {}

  get active(): Dialog | null {
    return this.current;
  }

  run(spec: DialogSpec): Promise<string> {
    // One dialog at a time: a second request while one is up is a bug, so fail
    // loudly rather than losing the first one's result.
    if (this.current) return Promise.reject(new Error('a dialog is already open'));
    this.current = new Dialog(this.ctx, this.store, spec);
    this.redraw();
    return new Promise<string>((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Draw the open dialog, if there is one. Call after drawing the screen. */
  draw(): void {
    this.current?.draw();
  }

  handleClick(x: number, y: number): boolean {
    if (!this.current) return false;
    const btn = this.current.buttonAt(x, y);
    if (btn) this.close(btn.name);
    return true;
  }

  handleKey(key: string): boolean {
    if (!this.current) return false;
    const btn = this.current.buttonForKey(key);
    if (btn) this.close(btn.name);
    return true;
  }

  private close(name: string): void {
    const resolve = this.resolve;
    this.current = null;
    this.resolve = null;
    this.redraw();
    resolve?.(name);
  }
}
