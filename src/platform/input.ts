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
  onMove(dir: Direction): void;
  onClick(x: number, y: number): void;
  onKey(key: string, event: KeyboardEvent): void;
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
  }

  private get blocked(): boolean {
    return this.dialogStack.length > 0;
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (this.blocked) return;
    const dir = KEY_DIRECTIONS[ev.code] ?? KEY_DIRECTIONS[ev.key];
    if (dir !== undefined) {
      ev.preventDefault();
      this.handlers.onMove(dir);
      return;
    }
    this.handlers.onKey(ev.key, ev);
  }

  private onMouseDown(ev: MouseEvent): void {
    if (this.blocked) return;
    // The canvas is drawn at native size and may be CSS-scaled up.
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    this.handlers.onClick((ev.clientX - rect.left) * scaleX, (ev.clientY - rect.top) * scaleY);
  }
}
