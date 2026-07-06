/**
 * Minimal XML access layer working in both the browser (DOMParser) and
 * Node/Vitest (@xmldom/xmldom). All scenario XML goes through here.
 */

type DomParserCtor = new () => { parseFromString(text: string, mime: string): Document };

let parserCtor: DomParserCtor | undefined;

async function getParser(): Promise<DomParserCtor> {
  if (parserCtor) return parserCtor;
  if (typeof DOMParser !== 'undefined') {
    parserCtor = DOMParser;
  } else {
    const mod = await import('@xmldom/xmldom');
    parserCtor = mod.DOMParser as unknown as DomParserCtor;
  }
  return parserCtor;
}

export async function parseXmlDoc(text: string, fname = ''): Promise<Element> {
  const Parser = await getParser();
  const doc = new Parser().parseFromString(text, 'text/xml');
  const root = doc.documentElement;
  if (!root) throw new Error(`empty XML document: ${fname}`);
  return root as Element;
}

export function children(el: Element): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i]!;
    if (n.nodeType === 1) out.push(n as Element);
  }
  return out;
}

export function tag(el: Element): string {
  return el.tagName;
}

/** Text content including CDATA, trimmed like ticpp GetText. */
export function text(el: Element): string {
  return (el.textContent ?? '').trim();
}

export function intText(el: Element): number {
  const v = parseInt(text(el), 10);
  if (Number.isNaN(v)) throw new Error(`expected integer in <${tag(el)}>, got '${text(el)}'`);
  return v;
}

export function boolText(el: Element): boolean {
  return text(el) === 'true';
}

export function attr(el: Element, name: string): string | undefined {
  const v = el.getAttribute(name);
  return v === null ? undefined : v;
}

export function intAttr(el: Element, name: string): number {
  const v = attr(el, name);
  const n = v === undefined ? NaN : parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`expected integer attribute ${name} on <${tag(el)}>`);
  return n;
}

/** readLocFromXml — reads x/y attributes. */
export function locFromXml(el: Element): { x: number; y: number } {
  return { x: intAttr(el, 'x'), y: intAttr(el, 'y') };
}

/** readRectFromXml — reads top/left/bottom/right attributes. */
export function rectFromXml(el: Element): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} {
  return {
    top: intAttr(el, 'top'),
    left: intAttr(el, 'left'),
    bottom: intAttr(el, 'bottom'),
    right: intAttr(el, 'right'),
  };
}
