/**
 * Sound playback over Web Audio, replacing SFML's sound buffers
 * (src/sounds.cpp). Sounds are SND0..SND99.wav; they are fetched and decoded
 * lazily on first use, then cached.
 *
 * Browsers won't start an AudioContext until the user interacts with the
 * page, so playback is silently dropped until `resume()` succeeds — the same
 * observable behaviour as running with sound switched off.
 */

/** Sound numbers the game refers to by name. */
export const Snd = {
  /** Footstep pair; the game alternates them (move_sound, boe.main.cpp:1995). */
  STEP_A: 49,
  STEP_B: 50,
  SQUISH: 55,
  CRUNCH: 47,
  SPLASH: 17,
  ENTER_TOWN: 16,
  ENTER_DUNGEON: 95,
  BUTTON: 37,
  BLOCKED: 0,
} as const;

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private pending = new Set<number>();
  enabled = true;

  constructor(private baseUrl = '/data/sounds/') {}

  /** Call from a user-gesture handler; safe to call repeatedly. */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.enabled = false;
        return;
      }
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** play_sound(n): fire and forget. */
  play(which: number): void {
    if (!this.enabled || which < 0) return;
    const buf = this.buffers.get(which);
    if (!buf) {
      void this.preload(which);
      return;
    }
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  }

  async preload(which: number): Promise<void> {
    if (!this.enabled || this.buffers.has(which) || this.pending.has(which)) return;
    this.pending.add(which);
    try {
      await this.resume();
      if (!this.ctx) return;
      const resp = await fetch(`${this.baseUrl}SND${which}.wav`);
      if (!resp.ok) return;
      this.buffers.set(which, await this.ctx.decodeAudioData(await resp.arrayBuffer()));
    } catch {
      // A missing or undecodable sound is not worth failing the game over.
    } finally {
      this.pending.delete(which);
    }
  }

  /** Warm the cache for the sounds walking around needs. */
  async preloadCommon(): Promise<void> {
    await Promise.all(Object.values(Snd).map((n) => this.preload(n)));
  }
}
