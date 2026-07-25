/**
 * The talking screen — place_talk_str (boe.newgraph.cpp:978) and
 * place_talk_face (:933). It replaces the whole left column (terrain view,
 * status bar and toolbar) with a portrait, the speaker's name, the reply, and
 * the clickable words.
 *
 * Laying out the reply and the hit rects is one job: a word is clickable only
 * where it was actually drawn, so wrapping decides the hitboxes.
 */

import { TalkState, PRESET_WORDS, TalkWord } from '../game/talk';
import { Colours } from './colours';
import { UiRect, height, width } from './layout';
import { monsterGraphic } from './monsterPics';
import { SheetStore } from './sheets';
import { TextStyle, drawString } from './text';
import { tilePattern } from './tiling';

/** talk_area_rect / word_place_rect / title_rect (boe.dlgutil.cpp:79). */
export const TALK_AREA: UiRect = { top: 7, left: 19, bottom: 422, right: 298 };
const WORD_PLACE: UiRect = { top: 44, left: 7, bottom: 372, right: 257 };
const TITLE_RECT: UiRect = { top: 19, left: 48, bottom: 42, right: 260 };
const FACE_RECT: UiRect = { top: 6, left: 6, bottom: 38, right: 38 };

export const TALK_WORD_SIZE = 18;
const LINE_HEIGHT = 18;
/** The pattern behind the conversation text (bg[12]). */
const TALK_BG = 12;

const BASE_STYLE: TextStyle = { font: 'dungeon', size: TALK_WORD_SIZE, colour: Colours.NAVY };
const WORD_ON = Colours.DARK_RED;
const PRESET_ON = Colours.DARK_GREEN;

export class TalkScreen {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private store: SheetStore,
  ) {}

  draw(talk: TalkState): void {
    const { ctx } = this;
    const pats = this.store.get('pixpats');

    // Frame and patterned interior.
    ctx.fillStyle = Colours.BLACK;
    ctx.fillRect(TALK_AREA.left, TALK_AREA.top, width(TALK_AREA), height(TALK_AREA));
    const inner: UiRect = {
      top: TALK_AREA.top + 1,
      left: TALK_AREA.left + 1,
      bottom: TALK_AREA.bottom - 1,
      right: TALK_AREA.right - 1,
    };
    if (pats) tilePattern(ctx, pats, TALK_BG, inner);

    this.drawFace(talk);
    this.drawTitle(talk);
    this.drawPresets(talk);
    this.drawReply(talk);
  }

  private at(rect: UiRect): UiRect {
    return {
      top: rect.top + TALK_AREA.top,
      left: rect.left + TALK_AREA.left,
      bottom: rect.bottom + TALK_AREA.top,
      right: rect.right + TALK_AREA.left,
    };
  }

  /**
   * The portrait (place_talk_face, boe.newgraph.cpp:933). A creature with no
   * face of its own falls back to its map sprite.
   */
  private drawFace(talk: TalkState): void {
    const dest = this.at(FACE_RECT);
    const pic = talk.facePic;
    const portraits = this.store.get('talkportraits');
    if (pic >= 0 && pic < 1000 && portraits) {
      // drawPresetTalk (pict.cpp:896): 32x32 cells, ten to a row.
      const cell = 32;
      this.ctx.drawImage(
        portraits, (pic % 10) * cell, Math.floor(pic / 10) * cell, cell, cell,
        dest.left, dest.top, width(dest), height(dest),
      );
      return;
    }
    const g = monsterGraphic(talk.monsterType, 0, 0);
    if (!g) return;
    const sheet = this.store.get(g.sheetName);
    if (!sheet) return;
    this.ctx.drawImage(
      sheet, g.rect.left, g.rect.top, g.rect.width, g.rect.height,
      dest.left, dest.top, width(dest), height(dest),
    );
  }

  /** The speaker's name, drawn twice for the drop shadow. */
  private drawTitle(talk: TalkState): void {
    const dest = this.at(TITLE_RECT);
    drawString(this.ctx, { ...dest, top: dest.top + 1, left: dest.left + 1 }, talk.title, {
      ...BASE_STYLE,
      colour: Colours.SHADOW,
    });
    drawString(this.ctx, dest, talk.title, { ...BASE_STYLE, colour: Colours.TITLE_BLUE });
  }

  private drawPresets(talk: TalkState): void {
    for (const word of talk.words) {
      if (!word.preset) continue;
      const preset = PRESET_WORDS.find((p) => p.word === word.word);
      if (!preset) continue;
      const style: TextStyle = { ...BASE_STYLE, colour: PRESET_ON };
      const dest = this.at({
        top: preset.y,
        left: preset.x,
        bottom: preset.y + LINE_HEIGHT,
        right: preset.x + 200,
      });
      drawString(this.ctx, dest, word.word, style);
      this.ctx.font = `${TALK_WORD_SIZE}px BoEDungeon, serif`;
      const w = this.ctx.measureText(word.word).width;
      word.rect = { top: dest.top, left: dest.left, bottom: dest.top + LINE_HEIGHT, right: dest.left + w };
    }
  }

  /**
   * Wrap the reply into the text area, colouring keyword hits and recording
   * where each one landed so clicks can find them.
   */
  private drawReply(talk: TalkState): void {
    const area = this.at(WORD_PLACE);
    const maxWidth = width(area);
    const text = talk.fullText();
    const hits = talk.keywordHits();
    const keywordWords = talk.words.filter((w) => !w.preset);

    // Split into tokens carrying their character offsets, so a token can be
    // matched back to a keyword hit.
    const tokens: { text: string; start: number }[] = [];
    const tokenRe = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(text)) !== null) tokens.push({ text: m[0], start: m.index });

    this.ctx.font = `${TALK_WORD_SIZE}px BoEDungeon, serif`;
    const spaceW = this.ctx.measureText(' ').width;
    let x = area.left;
    let y = area.top;
    let hitIndex = 0;

    for (const token of tokens) {
      // '|' marks the break between the reply's two halves: start a new line.
      if (token.text === '|') {
        if (x > area.left) {
          x = area.left;
          y += LINE_HEIGHT * 2;
        }
        continue;
      }
      const display = token.text.replace(/\|/g, '');
      if (display.length === 0) continue;
      const w = this.ctx.measureText(display).width;
      if (x > area.left && x + w > area.right) {
        x = area.left;
        y += LINE_HEIGHT;
      }
      if (y + LINE_HEIGHT > area.bottom) break;

      // Is this token the next keyword hit?
      const hit = hits[hitIndex];
      const isHit =
        hit !== undefined && hit.start >= token.start && hit.start < token.start + token.text.length;
      const style: TextStyle = { ...BASE_STYLE, colour: isHit ? WORD_ON : BASE_STYLE.colour };
      drawString(this.ctx, { top: y, left: x, bottom: y + LINE_HEIGHT, right: area.right }, display, style);
      if (isHit) {
        const word = keywordWords[hitIndex];
        if (word) word.rect = { top: y, left: x, bottom: y + LINE_HEIGHT, right: x + w };
        hitIndex++;
      }
      x += w + spaceW;
      // Re-apply the font: drawString changes it.
      this.ctx.font = `${TALK_WORD_SIZE}px BoEDungeon, serif`;
    }
  }

  /** The word (if any) at a screen position. */
  wordAt(talk: TalkState, x: number, y: number): TalkWord | null {
    for (const word of talk.words) {
      const r = word.rect;
      if (!r) continue;
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return word;
    }
    return null;
  }
}
