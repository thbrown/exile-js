/**
 * The dialogxml parser — the reading half of `cDialog`'s loader
 * (dialogxml/dialogs/dialog.cpp, schema in rsrc/schemas/dialog.xsd).
 *
 * A dialog definition is a flat list of positioned controls: pictures, text,
 * buttons, LEDs, LED groups, text fields and rules. The game ships 211 of
 * these and addresses their controls by name (`me["day"].setTextToNum(…)`), so
 * the parser's job is to turn one file into a `DialogDef` whose controls can be
 * looked up the same way.
 *
 * Only the reading is here; `xmlDialog.ts` draws the result and runs it.
 */

import { attr, children, tag } from '../fileio/xml';
import { UiRect } from '../render/layout';

/** eBtnType (button.hpp:19), in the order `basic_buttons` uses. */
export type ButtonType =
  | 'small' | 'regular' | 'large' | 'help' | 'left' | 'right' | 'up' | 'down'
  | 'tiny' | 'done' | 'tall' | 'trait' | 'push';

/** ePicType (pictypes.hpp), narrowed to the kinds the player's dialogs use. */
export type PictType =
  | 'blank' | 'ter' | 'teranim' | 'monst' | 'dlog' | 'talk' | 'scen' | 'item'
  | 'pc' | 'field' | 'boom' | 'missile' | 'full' | 'map' | 'status' | 'btn';

export type FieldType = 'int' | 'uint' | 'real' | 'text';
export type LedState = 'red' | 'green' | 'off';

/** The `font`/`size`/`colour` attribute group, shared by text, LEDs and fields. */
export interface FontSpec {
  font: 'dungeon' | 'plain' | 'bold' | 'maidenword';
  /** A point size; the named sizes resolve to 10 (small), 12 (large), 18 (title). */
  size: number;
  colour?: string;
}

interface Base {
  name: string;
  rect: UiRect;
  /**
   * The positioning attributes, kept as read. `anchor` names the control this
   * one is placed against; `relative` is the two-axis mode list.
   */
  anchor?: string;
  relAnchor?: 'next' | 'prev';
  relative: string[];
  /** `def-key`, lowercased; 'none' is dropped. */
  defKey?: string;
}

export interface TextControl extends Base {
  kind: 'text';
  /** The label, with `<br/>` turned into newlines. */
  text: string;
  framed: boolean;
  font: FontSpec;
  align: 'left' | 'right';
  underline: boolean;
  ellipsis: boolean;
}

export interface ButtonControl extends Base {
  kind: 'button';
  type: ButtonType;
  label: string;
  wrap: boolean;
  textSize?: number;
}

export interface PictControl extends Base {
  kind: 'pict';
  type: PictType;
  num: number;
  custom: boolean;
  framed: boolean;
  filled: boolean;
  size?: 'small' | 'wide' | 'tall' | 'large';
}

export interface LedControl extends Base {
  kind: 'led';
  label: string;
  state: LedState;
  font: FontSpec;
  labelPos: 'left' | 'right';
}

export interface FieldControl extends Base {
  kind: 'field';
  type: FieldType;
  text: string;
  maxChars?: number;
  tabOrder?: number;
}

export interface LineControl extends Base {
  kind: 'line';
}

/**
 * An LED group (`<group>`): a set of LEDs of which exactly one is lit, which is
 * how the dialogs do radio buttons. The members are also registered by their
 * own names, as the C++ does.
 */
export interface GroupControl extends Base {
  kind: 'group';
  leds: LedControl[];
}

export type DialogControl =
  | TextControl | ButtonControl | PictControl | LedControl
  | FieldControl | LineControl | GroupControl;

export interface DialogDef {
  /** The button Enter presses, and the one Escape does. */
  defBtn?: string;
  escBtn?: string;
  controls: DialogControl[];
  /** Every control by name, groups' members included. */
  byName: Map<string, DialogControl>;
}

/** The three named text sizes (dialog.xsd's `size` union). */
function parseSize(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value === 'small') return 10;
  if (value === 'large') return 12;
  if (value === 'title') return 18;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseFont(el: Element): FontSpec {
  const font = (attr(el, 'font') ?? 'bold') as FontSpec['font'];
  return {
    font,
    size: parseSize(attr(el, 'size'), 10),
    colour: attr(el, 'colour') ?? attr(el, 'color'),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function parseRect(el: Element): UiRect {
  // The schema marks top/left required, but a container (`<group>`) carries
  // none — its frame is grown from its members. Absent reads as 0, which is
  // what the C++ leaves the frame at.
  const top = Number(attr(el, 'top') ?? 0);
  const left = Number(attr(el, 'left') ?? 0);
  const w = attr(el, 'width');
  const h = attr(el, 'height');
  return {
    top,
    left,
    bottom: top + (w === undefined && h === undefined ? 0 : Number(h ?? 0)),
    right: left + Number(w ?? 0),
  };
}

function parseBase(el: Element): Base {
  const key = attr(el, 'def-key');
  return {
    name: attr(el, 'name') ?? '',
    rect: parseRect(el),
    anchor: attr(el, 'anchor'),
    relAnchor: attr(el, 'rel-anchor') as Base['relAnchor'],
    relative: (attr(el, 'relative') ?? 'abs').split(/\s+/).filter((s) => s.length > 0),
    defKey: key !== undefined && key !== 'none' ? key.toLowerCase() : undefined,
  };
}

/**
 * A `<text>`/`<button>` body: text nodes with `<br/>` breaks between them. The
 * C++'s `<key ref=…/>` element inlines another control's shortcut into the
 * label; it is read as its ref so the caller can substitute, since nothing in
 * the player's dialogs relies on the substitution itself.
 */
function readLabel(el: Element): string {
  let out = '';
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]!;
    if (node.nodeType === 3) out += node.nodeValue ?? '';
    else if (node.nodeType === 1) {
      const child = node as Element;
      if (tag(child) === 'br') out += '\n';
      else if (tag(child) === 'key') out += attr(child, 'ref') ?? '';
    }
  }
  // The files indent their markup, so a label spans lines with leading tabs.
  return out.split('\n').map((line) => line.trim()).join('\n').trim();
}

function parseLed(el: Element): LedControl {
  return {
    ...parseBase(el),
    kind: 'led',
    label: readLabel(el),
    state: (attr(el, 'state') ?? 'off') as LedState,
    font: parseFont(el),
    labelPos: (attr(el, 'label-pos') ?? 'right') as 'left' | 'right',
  };
}

function parseControl(el: Element): DialogControl | null {
  switch (tag(el)) {
    case 'text':
      return {
        ...parseBase(el),
        kind: 'text',
        text: readLabel(el),
        framed: parseBool(attr(el, 'framed'), false),
        font: parseFont(el),
        align: (attr(el, 'align') ?? 'left') as 'left' | 'right',
        underline: parseBool(attr(el, 'underline'), false),
        ellipsis: parseBool(attr(el, 'ellipsis'), false),
      };
    case 'button': {
      const textSize = attr(el, 'text-size');
      return {
        ...parseBase(el),
        kind: 'button',
        type: (attr(el, 'type') ?? 'regular') as ButtonType,
        label: readLabel(el),
        wrap: parseBool(attr(el, 'wrap'), false),
        textSize: textSize === undefined ? undefined : Number(textSize),
      };
    }
    case 'pict':
      return {
        ...parseBase(el),
        kind: 'pict',
        type: (attr(el, 'type') ?? 'blank') as PictType,
        num: Number(attr(el, 'num') ?? 0),
        custom: parseBool(attr(el, 'custom'), false),
        // A pict is framed and filled by default, unlike everything else.
        framed: parseBool(attr(el, 'framed'), true),
        filled: parseBool(attr(el, 'filled'), true),
        size: attr(el, 'size') as PictControl['size'],
      };
    case 'led':
      return parseLed(el);
    case 'group': {
      const leds = children(el).filter((c) => tag(c) === 'led').map(parseLed);
      return { ...parseBase(el), kind: 'group', leds };
    }
    case 'field':
      return {
        ...parseBase(el),
        kind: 'field',
        type: (attr(el, 'type') ?? 'text') as FieldType,
        text: readLabel(el),
        maxChars: attr(el, 'max-chars') === undefined
          ? undefined : Number(attr(el, 'max-chars')),
        tabOrder: attr(el, 'tab-order') === undefined
          ? undefined : Number(attr(el, 'tab-order')),
      };
    case 'line':
      return { ...parseBase(el), kind: 'line' };
    default:
      // stack/page/pane/tilemap/mapgroup belong to the scenario editor's
      // dialogs, which this port doesn't run.
      return null;
  }
}

/**
 * Turn one parsed `<dialog>` element into a definition. Positions are resolved
 * here, so every control comes out with an absolute rect.
 */
export function readDialogDef(root: Element): DialogDef {
  const controls: DialogControl[] = [];
  for (const el of children(root)) {
    const control = parseControl(el);
    if (control) controls.push(control);
  }
  resolvePositions(controls);
  const byName = new Map<string, DialogControl>();
  for (const control of controls) {
    if (control.name) byName.set(control.name, control);
    if (control.kind === 'group') {
      for (const led of control.leds) if (led.name) byName.set(led.name, led);
    }
  }
  return {
    defBtn: attr(root, 'defbtn'),
    escBtn: attr(root, 'escbtn'),
    controls,
    byName,
  };
}

/**
 * Relative positioning (`anchor` / `rel-anchor` / `relative`), a port of
 * `cControl::relocateRelative` (control.cpp:78). A control with an anchor is
 * placed against another control's frame, and the coordinates in the file are
 * an *offset* from the chosen edge rather than a position:
 *
 * - `pos` measures right from the anchor's right edge (down from its bottom),
 * - `neg` measures **left from its left edge** (up from its top),
 * - `pos-in` measures right from its left edge (down from its top),
 * - `neg-in` measures left from its right edge (up from its bottom),
 * - `abs` keeps the coordinate as written.
 *
 * The first word is the horizontal mode and the second the vertical; one word
 * applies to both.
 *
 * *Gotcha*: the two "neg" modes place the control's **top-left corner** at the
 * computed point — the C++ negates the offset and hands it to `relocate`,
 * which never accounts for the control's own width or height. So a `neg`
 * control extends back *over* its anchor rather than sitting beside it. Kept.
 */
function resolvePositions(controls: DialogControl[]): void {
  const byName = new Map<string, DialogControl>();
  for (const c of controls) {
    if (c.name) byName.set(c.name, c);
    if (c.kind === 'group') for (const led of c.leds) if (led.name) byName.set(led.name, led);
  }
  controls.forEach((control, i) => {
    if (!control.anchor && !control.relAnchor) return;
    const anchor = control.relAnchor === 'prev'
      ? controls[i - 1]
      : control.relAnchor === 'next'
        ? controls[i + 1]
        : byName.get(control.anchor ?? '');
    if (!anchor) return;
    const [hMode = 'abs', vMode = hMode] = control.relative;
    const w = control.rect.right - control.rect.left;
    const h = control.rect.bottom - control.rect.top;
    let { left, top } = control.rect;
    switch (hMode) {
      case 'pos': left = anchor.rect.right + left; break;
      case 'neg': left = anchor.rect.left - left; break;
      case 'pos-in': left = anchor.rect.left + left; break;
      case 'neg-in': left = anchor.rect.right - left; break;
      default: break;
    }
    switch (vMode) {
      case 'pos': top = anchor.rect.bottom + top; break;
      case 'neg': top = anchor.rect.top - top; break;
      case 'pos-in': top = anchor.rect.top + top; break;
      case 'neg-in': top = anchor.rect.bottom - top; break;
      default: break;
    }
    control.rect = { top, left, bottom: top + h, right: left + w };
  });
}
