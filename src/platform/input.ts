/**
 * Keyboard/mouse routing. Stands in for the SFML event loop in boe.main.cpp,
 * with a dialog gate that will suppress game input once modal dialogs exist
 * (the async replacement for the C++ ASYNCIFY blocking dialogs).
 */

import { Direction } from '../core/location';

/** Arrow keys plus the numeric keypad, as the original accepts both. */
export const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: Direction.N,
  ArrowDown: Direction.S,
  ArrowLeft: Direction.W,
  ArrowRight: Direction.E,
  Home: Direction.NW,
  PageUp: Direction.NE,
  End: Direction.SW,
  PageDown: Direction.SE,
  Numpad8: Direction.N,
  Numpad9: Direction.NE,
  Numpad6: Direction.E,
  Numpad3: Direction.SE,
  Numpad2: Direction.S,
  Numpad1: Direction.SW,
  Numpad4: Direction.W,
  Numpad7: Direction.NW,
};

export interface InputHandlers {
  onMove(dir: Direction, key?: string): void;
  onClick(x: number, y: number): void;
  onKey(key: string, event: KeyboardEvent): void;
  /**
   * Where the pointer is, in canvas coordinates, or null once it leaves. The
   * targeting overlay needs this: `draw_targeting_line` reads
   * `mouse_window_coords()` every frame, which is how the spell's footprint
   * follows the cursor before you commit to a square.
   */
  onHover?(x: number, y: number): void;
  onHoverEnd?(): void;
  /**
   * Pointer movement and release anywhere on the page, not just over the
   * canvas — what dragging the automap window needs. The exile-wasm build does
   * the same thing, routing every mouse event to the map handler while a drag
   * is in progress "so dragging stays smooth even when the cursor moves
   * outside the map bounds" (boe.main.cpp:1524).
   */
  onDrag?(x: number, y: number): void;
  onRelease?(x: number, y: number): void;
}

export class InputRouter {
  /** Non-empty while a modal dialog is up; game input is ignored then. */
  dialogStack: unknown[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: InputHandlers,
  ) {}

  attach(): void {
    window.addEventListener('keydown', (ev) => this.onKeyDown(ev));
    this.canvas.addEventListener('mousedown', (ev) => this.onMouseDown(ev));
    this.canvas.addEventListener('mousemove', (ev) => this.onMouseMove(ev));
    this.canvas.addEventListener('mouseleave', () => this.handlers.onHoverEnd?.());
    window.addEventListener('mousemove', (ev) => {
      const at = this.toCanvas(ev);
      this.handlers.onDrag?.(at.x, at.y);
    });
    window.addEventListener('mouseup', (ev) => {
      const at = this.toCanvas(ev);
      this.handlers.onRelease?.(at.x, at.y);
    });
  }

  private get blocked(): boolean {
    return this.dialogStack.length > 0;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.blocked) return;
    const dir = KEY_DIRECTIONS[ev.code] ?? KEY_DIRECTIONS[ev.key];
    if (dir !== undefined) {
      ev.preventDefault();
      this.handlers.onMove(dir, ev.key);
      return;
    }
    this.handlers.onKey(ev.key, ev);
  }

  private onMouseDown(ev: MouseEvent): void {
    if (this.blocked) return;
    const at = this.toCanvas(ev);
    this.handlers.onClick(at.x, at.y);
  }

  private onMouseMove(ev: MouseEvent): void {
    // A dialog hides the terrain view, so stop tracking rather than leaving a
    // stale crosshair behind it.
    if (this.blocked) {
      this.handlers.onHoverEnd?.();
      return;
    }
    const at = this.toCanvas(ev);
    this.handlers.onHover?.(at.x, at.y);
  }

  /** The canvas is drawn at native size and may be CSS-scaled up. */
  private toCanvas(ev: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (this.canvas.height / rect.height),
    };
  }
}
