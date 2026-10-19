import type { DurationDist } from '@/domain/types';

/** Deterministic 32-bit PRNG (mulberry32). Same seed => same sequence. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  /** Standard normal via Box–Muller. */
  normal(mean = 0, sd = 1) {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  triangular(d: DurationDist) {
    const { min, mode, max } = d;
    if (max <= min) return min;
    const u = this.next();
    const c = (mode - min) / (max - min);
    return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }
  chance(p: number) {
    return this.next() < p;
  }
  /** Index chosen with probability proportional to weights; -1 if all zero. */
  weighted(weights: number[]): number {
    const total = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
    if (!(total > 0)) return -1;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }
}

/** FNV-1a 32-bit hash of a string (for seeding sub-streams and config hashes). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
