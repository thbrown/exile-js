/**
 * Mersenne Twister (MT19937), bit-for-bit compatible with C++ std::mt19937.
 *
 * Fidelity matters: BoE replays record only the seed, so combat/AI outcomes
 * are reproducible iff our generator AND the order of getRan() calls match
 * the C++ engine (../exile-wasm/src/mathutil.cpp).
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class MT19937 {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  // std::mt19937's default seed
  constructor(seed = 5489) {
    this.seed(seed);
  }

  seed(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = this.mt[i - 1]! ^ (this.mt[i - 1]! >>> 30);
      this.mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
  }

  /** Next uint32. */
  next(): number {
    if (this.mti >= N) this.generateBlock();
    let y = this.mt[this.mti++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  private generateBlock(): void {
    const mt = this.mt;
    for (let kk = 0; kk < N; kk++) {
      const y = (mt[kk]! & UPPER_MASK) | (mt[(kk + 1) % N]! & LOWER_MASK);
      mt[kk] = (mt[(kk + M) % N]! ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
    }
    this.mti = 0;
  }
}

function toInt16(n: number): number {
  return (n << 16) >> 16;
}

/**
 * The engine's two RNG streams, mirroring game_rand/unique_rand in
 * mathutil.cpp. Replays seed only the game stream; calls that must not
 * affect replay determinism use the unique stream.
 */
export class GameRng {
  readonly game = new MT19937();
  readonly unique = new MT19937();

  seedGame(seed: number): void {
    this.game.seed(seed);
  }

  /** Verbatim port of get_ran(times, min, max, use_unique_ran). */
  getRan(times: number, min: number, max: number, useUnique = false): number {
    if (max < min) max = min;
    if (max === min) return toInt16(times * min);
    let toRet = 0;
    for (let i = 1; i < times + 1; i++) {
      const store = useUnique ? this.unique.next() : this.game.next();
      toRet = toInt16(toRet + min + (store % (max - min + 1)));
    }
    return toRet;
  }
}
