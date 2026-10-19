/**
 * Positioning engine interface (raw UWB ranges -> building positions).
 *
 * Raw anchor–tag ranges are NOT positions. A positioning engine combines
 * near-simultaneous ranges with surveyed anchor coordinates to estimate a tag
 * position and an uncertainty. This module defines the interface and a
 * reference least-squares multilateration solver for testing and future
 * integration. It is not a validated positioning system: real deployments
 * need calibration (antenna delay, NLOS handling, filtering) appropriate to
 * the hardware.
 */
import type { Anchor, RangeObservation, Vec2 } from '@/domain/types';

export interface PositionEstimate {
  tagId: string;
  timestampUtc: string;
  x: number;
  y: number;
  /** RMS range residual (m) — a quality indicator, not a guaranteed accuracy. */
  residualM: number;
  anchorsUsed: number;
  /** Geometric dilution of precision (lower is better). */
  gdop: number;
}

export interface PositioningEngine {
  readonly name: string;
  /** Solve positions from range epochs. Anchors must have surveyed (or planned) world positions. */
  solve(ranges: RangeObservation[], anchors: Anchor[]): PositionEstimate[];
}

/** Group ranges into epochs per tag (ranges within `windowMs` of each other). */
export function groupEpochs(ranges: RangeObservation[], windowMs = 150): RangeObservation[][] {
  const byTag = new Map<string, RangeObservation[]>();
  for (const r of ranges) {
    if (!byTag.has(r.tagId)) byTag.set(r.tagId, []);
    byTag.get(r.tagId)!.push(r);
  }
  const epochs: RangeObservation[][] = [];
  for (const list of byTag.values()) {
    list.sort((a, b) => Date.parse(a.timestampUtc) - Date.parse(b.timestampUtc));
    let cur: RangeObservation[] = [];
    let t0 = -Infinity;
    for (const r of list) {
      const t = Date.parse(r.timestampUtc);
      if (t - t0 > windowMs && cur.length) {
        epochs.push(cur);
        cur = [];
      }
      if (!cur.length) t0 = t;
      cur.push(r);
    }
    if (cur.length) epochs.push(cur);
  }
  return epochs;
}

/**
 * 2D least-squares multilateration by Gauss–Newton, initialised at the
 * anchor centroid. Requires >= 3 anchors with non-collinear geometry.
 */
export function multilaterate(anchors: Vec2[], ranges: number[], iterations = 25): { p: Vec2; residual: number; gdop: number } | null {
  const n = anchors.length;
  if (n < 3) return null;
  let x = anchors.reduce((s, a) => s + a.x, 0) / n;
  let y = anchors.reduce((s, a) => s + a.y, 0) / n;
  let gdop = Infinity;
  for (let it = 0; it < iterations; it++) {
    // Normal equations J^T J dp = -J^T r
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = x - anchors[i].x;
      const dy = y - anchors[i].y;
      const d = Math.max(1e-6, Math.hypot(dx, dy));
      const jx = dx / d;
      const jy = dy / d;
      const r = d - ranges[i];
      a11 += jx * jx;
      a12 += jx * jy;
      a22 += jy * jy;
      b1 -= jx * r;
      b2 -= jy * r;
    }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-9) return null; // degenerate (collinear) geometry
    gdop = Math.sqrt((a11 + a22) / det);
    const sx = (a22 * b1 - a12 * b2) / det;
    const sy = (a11 * b2 - a12 * b1) / det;
    x += sx;
    y += sy;
    if (Math.hypot(sx, sy) < 1e-6) break;
  }
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (Math.hypot(x - anchors[i].x, y - anchors[i].y) - ranges[i]) ** 2;
  return { p: { x, y }, residual: Math.sqrt(ss / n), gdop };
}

export const leastSquaresEngine: PositioningEngine = {
  name: 'Reference least-squares multilateration (2D, experimental)',
  solve(ranges, anchors) {
    const pos = new Map(anchors.map((a) => [a.label, a.surveyedPosition ?? a.position]));
    for (const a of anchors) pos.set(a.id, a.surveyedPosition ?? a.position);
    const out: PositionEstimate[] = [];
    for (const epoch of groupEpochs(ranges)) {
      // Use the latest range per anchor within the epoch.
      const latest = new Map<string, RangeObservation>();
      for (const r of epoch) if (pos.has(r.anchorId)) latest.set(r.anchorId, r);
      const used = [...latest.values()];
      const sol = multilaterate(used.map((r) => pos.get(r.anchorId)!), used.map((r) => r.rangeM));
      if (!sol) continue;
      out.push({ tagId: epoch[0].tagId, timestampUtc: epoch[epoch.length - 1].timestampUtc, x: sol.p.x, y: sol.p.y, residualM: sol.residual, anchorsUsed: used.length, gdop: sol.gdop });
    }
    return out;
  },
};
