/**
 * Canvas text helpers standing in for win_draw_string (gfx/render_text.cpp).
 * The original's fonts ship with the game; index.html registers them as
 * `BoEPlain` / `BoEBold` so metrics stay close to the C++ build.
 */

import { Colours } from './colours';
import { UiRect } from './layout';

export type FontName = 'plain' | 'bold' | 'dungeon' | 'maidenword';

export interface TextStyle {
  font?: FontName;
  size?: number;
  colour?: string;
  italic?: boolean;
}

const FAMILIES: Record<FontName, string> = {
  plain: 'BoEPlain, "Helvetica Neue", Arial, sans-serif',
  bold: 'BoEBold, "Helvetica Neue", Arial, sans-serif',
  dungeon: 'BoEDungeon, serif',
  maidenword: 'BoEMaidenword, serif',
};

function applyStyle(ctx: CanvasRenderingContext2D, style: TextStyle): void {
  const size = style.size ?? 12;
  const family = FAMILIES[style.font ?? 'plain'];
  const weight = style.font === 'bold' ? 'bold' : 'normal';
  ctx.font = `${style.italic ? 'italic ' : ''}${weight} ${size}px ${family}`;
  ctx.fillStyle = style.colour ?? Colours.BLACK;
  ctx.textBaseline = 'alphabetic';
}

/** string_length (render_text.cpp) — how wide `text` is in `style`, in pixels. */
export function measureString(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextStyle = {},
): number {
  applyStyle(ctx, style);
  return ctx.measureText(text).width;
}

/** Draw a single line, left-aligned, baselined near the bottom of `rect`. */
export function drawString(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  text: string,
  style: TextStyle = {},
): void {
  applyStyle(ctx, style);
  const size = style.size ?? 12;
  ctx.fillText(text, rect.left, rect.top + size - 1);
}

/** Draw a line, truncating with an ellipsis if it overflows (eTextMode::ELLIPSIS). */
export function drawStringEllipsis(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  text: string,
  style: TextStyle = {},
): void {
  applyStyle(ctx, style);
  const maxWidth = rect.right - rect.left;
  let out = text;
  if (ctx.measureText(out).width > maxWidth) {
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
    out += '…';
  }
  const size = style.size ?? 12;
  ctx.fillText(out, rect.left, rect.top + size - 1);
}

/** Split `text` into lines that fit `maxWidth` (eTextMode::WRAP). */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  style: TextStyle = {},
): string[] {
  applyStyle(ctx, style);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = words[0]!;
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** Centre a single line inside `rect` (eTextMode::CENTRE). */
export function drawStringCentre(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  text: string,
  style: TextStyle = {},
): void {
  applyStyle(ctx, style);
  const size = style.size ?? 12;
  const w = ctx.measureText(text).width;
  ctx.fillText(text, rect.left + (rect.right - rect.left - w) / 2, rect.top + size - 1);
}

/** Right-align a single line inside `rect`. */
export function drawStringRight(
  ctx: CanvasRenderingContext2D,
  rect: UiRect,
  text: string,
  style: TextStyle = {},
): void {
  applyStyle(ctx, style);
  const size = style.size ?? 12;
  const w = ctx.measureText(text).width;
  ctx.fillText(text, rect.right - w, rect.top + size - 1);
}
