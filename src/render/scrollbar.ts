/**
 * `cScrollbar` (dialogxml/widgets/scrollbar.cpp) — the scrollbar the item
 * window, the shop list and several dialogs hang off.
 *
 * The model half (`pos`/`max`/`pageSize`, `locationToPart`, `pressPart`) is
 * plain data so it can be tested headless; `draw` is `draw_vertical` against
 * the same sheet the C++ uses.
 *
 * Only the vertical form is ported: the player's windows have no horizontal
 * scrollbar. The geometry below is written the way the C++ writes it, with
 * `vert` picking the axis, so the horizontal half is a drawing routine away.
 */

import { UiRect, height } from './layout';
import { SheetStore } from './sheets';

/** eScrollbarPart (scrollbar.hpp:39). */
export enum ScrollPart {
  UP = 0,
  PGUP = 1,
  THUMB = 2,
  PGDN = 3,
  DOWN = 4,
}

/** eScrollStyle — which sheet the parts come from (scrollbar.cpp:25). */
export enum ScrollStyle {
  WHITE = 0,
  LED = 1,
}

const SHEETS = ['dlogscrollwh', 'dlogscrollled'];

/**
 * The four part rects per style, indexed VERT / VERT_PRESSED / HORZ /
 * HORZ_PRESSED (scrollbar.hpp:36). These are `{top,left,bottom,right}`, so the
 * *column* is what changes between up/down/thumb/bar and the *row* is the
 * orientation-and-pressed index.
 */
const UP_RECT: UiRect[][] = [
  [r(0, 0, 16, 16), r(16, 0, 32, 16), r(32, 0, 48, 16), r(48, 0, 64, 16)],
  [r(0, 0, 10, 14), r(10, 0, 20, 14), r(20, 0, 34, 10), r(34, 0, 48, 10)],
];
const DOWN_RECT: UiRect[][] = [
  [r(0, 16, 16, 32), r(16, 16, 32, 32), r(32, 16, 48, 32), r(48, 16, 64, 32)],
  [r(0, 14, 10, 28), r(10, 14, 20, 28), r(20, 10, 34, 20), r(34, 10, 48, 20)],
];
const THUMB_RECT: UiRect[][] = [
  [r(0, 32, 16, 48), r(16, 32, 32, 48), r(32, 32, 48, 48), r(48, 32, 64, 48)],
  [r(0, 28, 10, 42), r(10, 28, 20, 42), r(20, 20, 34, 30), r(34, 20, 48, 30)],
];
const BAR_RECT: UiRect[][] = [
  [r(0, 48, 16, 64), r(16, 48, 32, 64), r(32, 48, 48, 64), r(48, 48, 64, 64)],
  [r(0, 42, 10, 56), r(10, 42, 20, 56), r(20, 30, 34, 40), r(34, 30, 48, 40)],
];

function r(top: number, left: number, bottom: number, right: number): UiRect {
  return { top, left, bottom, right };
}

const VERT = 0;
const VERT_PRESSED = 1;

export class Scrollbar {
  /** The bar's rect on screen. */
  frame: UiRect;
  style: ScrollStyle;

  private pos = 0;
  private max = 0;
  private pgsz = 10;

  /** Which part is held down, for the pressed artwork. */
  depressed = false;
  pressedPart: ScrollPart = ScrollPart.UP;

  constructor(frame: UiRect, style: ScrollStyle = ScrollStyle.WHITE) {
    this.frame = frame;
    this.style = style;
  }

  getPosition(): number {
    return this.pos;
  }

  /** setPosition clamps into [0, max] rather than refusing (scrollbar.cpp:52). */
  setPosition(newPos: number): void {
    this.pos = Math.max(0, Math.min(this.max, Math.round(newPos)));
  }

  getMaximum(): number {
    return this.max;
  }

  /** Setting the maximum re-clamps the position, as `setMaximum` does. */
  setMaximum(newMax: number): void {
    this.max = Math.max(0, newMax);
    this.setPosition(this.pos);
  }

  getPageSize(): number {
    return this.pgsz;
  }

  setPageSize(size: number): void {
    this.pgsz = size;
  }

  /** The height of one arrow button, which is also the thumb's height. */
  private get btnSize(): number {
    return height(UP_RECT[this.style]![VERT]!);
  }

  /**
   * `location_to_part` (scrollbar.cpp:162) — which part of the bar a point
   * falls in. Note the thumb's position is computed from `pos * (bar_size -
   * btn_size) / max`, so with `max` 0 this is never reached: the caller
   * declines the whole event first.
   */
  locationToPart(y: number): ScrollPart {
    const btn = this.btnSize;
    const barStart = this.frame.top;
    const barEnd = this.frame.bottom;
    const barSize = height(this.frame) - btn * 2;
    const thumbPos = barStart + btn + Math.floor(this.pos * (barSize - btn) / this.max);
    if (y < barStart + btn) return ScrollPart.UP;
    if (y < thumbPos) return ScrollPart.PGUP;
    if (y < thumbPos + btn) return ScrollPart.THUMB;
    if (y < barEnd - btn) return ScrollPart.PGDN;
    return ScrollPart.DOWN;
  }

  /** True if (x, y) is inside the bar. */
  contains(x: number, y: number): boolean {
    return x >= this.frame.left && x < this.frame.right
      && y >= this.frame.top && y < this.frame.bottom;
  }

  /**
   * `handlePressedPart` (scrollbar.cpp:275) — an arrow steps one line, the
   * track pages. The thumb moves by dragging, which this port doesn't do yet;
   * a click on it is a no-op there too.
   */
  pressPart(part: ScrollPart): void {
    switch (part) {
      case ScrollPart.UP: this.setPosition(this.pos - 1); break;
      case ScrollPart.DOWN: this.setPosition(this.pos + 1); break;
      case ScrollPart.PGUP: this.setPosition(this.pos - this.pgsz); break;
      case ScrollPart.PGDN: this.setPosition(this.pos + this.pgsz); break;
      default: break;
    }
  }

  /**
   * A click at (x, y). Returns false — "not interested" — when there's nothing
   * to scroll, which is `handle_event`'s early out for a zero maximum.
   */
  handleClick(x: number, y: number): boolean {
    if (this.max === 0 || !this.contains(x, y)) return false;
    this.pressPart(this.locationToPart(y));
    return true;
  }

  /** `handle_mouse_wheel_scrolled` (:147) — one line per notch. */
  handleWheel(delta: number): void {
    this.setPosition(this.pos - delta);
  }

  /** `draw_vertical` (scrollbar.cpp:459). */
  draw(ctx: CanvasRenderingContext2D, store: SheetStore): void {
    const sheet = store.get(SHEETS[this.style]!);
    if (!sheet) return;
    const btn = this.btnSize;
    const barHeight = height(this.frame) - btn * 2;
    const idx = (part: ScrollPart): number =>
      (this.depressed && this.pressedPart === part ? VERT_PRESSED : VERT);
    const blit = (src: UiRect, dest: UiRect): void => {
      ctx.drawImage(
        sheet,
        src.left, src.top, src.right - src.left, src.bottom - src.top,
        dest.left, dest.top, dest.right - dest.left, dest.bottom - dest.top,
      );
    };

    // The up arrow.
    const draw: UiRect = { ...this.frame, bottom: this.frame.top + btn };
    blit(UP_RECT[this.style]![idx(ScrollPart.UP)]!, draw);

    // The track above the thumb, one tile at a time.
    if (this.pos > 0) {
      const src = BAR_RECT[this.style]![idx(ScrollPart.PGUP)]!;
      const top = draw.bottom;
      const run = Math.floor(this.pos * (barHeight - btn) / this.max);
      draw.top = top;
      while (draw.top - top < run) {
        draw.bottom = draw.top + btn;
        blit(src, draw);
        draw.top = draw.bottom;
      }
      draw.bottom = top + run;
    }

    // The thumb sits where the track above it ended.
    if (this.max > 0) {
      draw.top = draw.bottom;
      draw.bottom = draw.top + btn;
      blit(THUMB_RECT[this.style]![idx(ScrollPart.THUMB)]!, draw);
    }

    // The track below it. The C++ backs the first tile up so the pattern lines
    // up with the one above the thumb, and clips the overhang away.
    if (this.pos < this.max || this.max === 0) {
      const src = BAR_RECT[this.style]![idx(ScrollPart.PGDN)]!;
      const top = draw.bottom;
      const bottom = this.frame.bottom - btn;
      let diff = (top % btn) - (this.frame.top % btn);
      if (diff < 0) diff += btn;
      draw.top = top - diff;
      draw.bottom = draw.top + btn;
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.frame.left, top, this.frame.right - this.frame.left, draw.bottom - top);
      ctx.clip();
      blit(src, draw);
      ctx.restore();
      draw.top += btn;
      while (draw.top < bottom) {
        draw.bottom = draw.top + btn;
        blit(src, draw);
        draw.top = draw.bottom;
      }
    }

    // The down arrow.
    blit(DOWN_RECT[this.style]![idx(ScrollPart.DOWN)]!, {
      ...this.frame, top: this.frame.bottom - btn,
    });
  }
}
