/**
 * Low-level track utilities: time lookup, interpolation and time filtering.
 * Tracks are time-ordered arrays; samples flagged `gap` start a new
 * contiguous segment and are never interpolated across.
 */
import type { Track, Vec2 } from '@/domain/types';

/** Index of the last sample with t <= time (binary search); -1 if before the first. */
export function indexAtOrBefore(t: Float64Array, time: number, hint = -1): number {
  const n = t.length;
  if (!n || time < t[0]) return -1;
  if (time >= t[n - 1]) return n - 1;
  // Fast path for monotonic playback.
  if (hint >= 0 && hint < n - 1 && t[hint] <= time && t[hint + 1] > time) return hint;
  if (hint >= 0 && hint < n - 2 && t[hint + 1] <= time && t[hint + 2] > time) return hint + 1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface Interpolated {
  p: Vec2;
  index: number;
  /** Heading in radians (direction of travel), null when stationary. */
  heading: number | null;
  /** Instantaneous speed m/s. */
  speed: number;
  /** True when the position is inside a tracking gap (no valid position). */
  inGap: boolean;
}

/**
 * Position at `time`. Returns null outside the track's time span.
 * Within a tracking gap (> maxGapS between samples or gap flag), the last
 * known position is returned with inGap=true — positions are NOT invented.
 */
export function positionAt(tr: Track, time: number, hint = -1, maxGapS = 30): Interpolated | null {
  const n = tr.t.length;
  if (!n || time < tr.t[0] || time > tr.t[n - 1]) return null;
  const i = indexAtOrBefore(tr.t, time, hint);
  if (i < 0) return null;
  if (i === n - 1) return { p: { x: tr.x[i], y: tr.y[i] }, index: i, heading: null, speed: 0, inGap: false };
  const t0 = tr.t[i];
  const t1 = tr.t[i + 1];
  const dt = t1 - t0;
  if (tr.gap[i + 1] || dt > maxGapS) return { p: { x: tr.x[i], y: tr.y[i] }, index: i, heading: null, speed: 0, inGap: true };
  const f = dt > 0 ? (time - t0) / dt : 0;
  const dx = tr.x[i + 1] - tr.x[i];
  const dy = tr.y[i + 1] - tr.y[i];
  const d = Math.hypot(dx, dy);
  return {
    p: { x: tr.x[i] + dx * f, y: tr.y[i] + dy * f },
    index: i,
    heading: d > 1e-3 ? Math.atan2(dy, dx) : null,
    speed: dt > 0 ? d / dt : 0,
    inGap: false,
  };
}

/** Sub-track restricted to [t0, t1] with interpolated boundary samples. */
export function sliceTrack(tr: Track, t0: number, t1: number): Track {
  const n = tr.t.length;
  if (!n || t1 <= tr.t[0] || t0 >= tr.t[n - 1]) {
    return { ...tr, t: new Float64Array(0), x: new Float32Array(0), y: new Float32Array(0), gap: new Uint8Array(0) };
  }
  if (t0 <= tr.t[0] && t1 >= tr.t[n - 1]) return tr;
  let a = indexAtOrBefore(tr.t, t0);
  let b = indexAtOrBefore(tr.t, t1);
  if (a < 0) a = 0;
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const g: number[] = [];
  const startP = positionAt(tr, Math.max(t0, tr.t[0]), a, Infinity);
  if (startP && tr.t[a] < t0) {
    t.push(t0);
    x.push(startP.p.x);
    y.push(startP.p.y);
    g.push(1);
    a += 1;
  }
  for (let i = a; i <= b; i++) {
    t.push(tr.t[i]);
    x.push(tr.x[i]);
    y.push(tr.y[i]);
    g.push(t.length === 1 ? 1 : tr.gap[i]);
  }
  if (b < n - 1 && tr.t[b] < t1) {
    const endP = positionAt(tr, t1, b, Infinity);
    if (endP && !tr.gap[b + 1]) {
      t.push(t1);
      x.push(endP.p.x);
      y.push(endP.p.y);
      g.push(0);
    }
  }
  return { ...tr, t: Float64Array.from(t), x: Float32Array.from(x), y: Float32Array.from(y), gap: Uint8Array.from(g) };
}

export const trackSpan = (tr: Track): [number, number] | null => (tr.t.length ? [tr.t[0], tr.t[tr.t.length - 1]] : null);
