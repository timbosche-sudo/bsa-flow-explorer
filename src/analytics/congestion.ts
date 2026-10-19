/**
 * Overlap / potential-congestion analysis for circulation areas.
 *
 * Positions of all tracked people are sampled every `stepS` seconds. For each
 * circulation "segment" (a square cell of `segmentM` inside circulation) we
 * record simultaneous presence. Encounters are moments when two people come
 * within `encounterRadiusM` while at least one is in circulation.
 *
 * These are observations of SPATIAL OVERLAP. They do not establish that
 * movement was obstructed or that operational congestion occurred.
 */
import type { ID, SpatialModel, Track } from '@/domain/types';
import { positionAt } from './trackUtils';
import type { SpaceLocator } from './spaceLocator';
import { bbox, unionBBox } from '@/geometry/polygon';

export interface CongestionOptions {
  range: [number, number];
  stepS: number;
  segmentM: number;
  encounterRadiusM: number;
  threshold: number;
}

export interface SegmentStat {
  index: number;
  cx: number;
  cy: number;
  spaceId: ID;
  peak: number;
  peakAt: number;
  secondsAtOrAbove: number;
  personSeconds: number;
}

export interface Encounter {
  t: number;
  x: number;
  y: number;
  a: ID;
  b: ID;
  roleA: ID | null;
  roleB: ID | null;
}

export interface CongestionResult {
  options: CongestionOptions;
  segments: SegmentStat[];
  segOrigin: { x: number; y: number; cols: number; rows: number };
  encounters: Encounter[];
  /** Per time step: maximum simultaneous count in any circulation segment. */
  maxSeries: Uint8Array;
  /** Per time step: people in circulation. */
  circSeries: Uint8Array;
  /** Prolonged dwell in circulation (>= 60 s stationary-ish presence). */
  prolongedDwell: { staffId: ID; spaceId: ID; start: number; end: number }[];
}

export function analyzeCongestion(tracks: Track[], spatial: SpatialModel, locator: SpaceLocator, o: CongestionOptions): CongestionResult {
  const circPolys = spatial.circulation.map((c) => c.polygon).filter((p) => p.length >= 3);
  const b = unionBBox(circPolys.map(bbox)) ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / o.segmentM));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / o.segmentM));
  const segIndex = new Int32Array(cols * rows).fill(-1);
  const segments: SegmentStat[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = b.minX + (c + 0.5) * o.segmentM;
      const cy = b.minY + (r + 0.5) * o.segmentM;
      const si = locator.locate(cx, cy);
      if (si >= 0 && locator.spaces[si].kind === 'circulation') {
        segIndex[r * cols + c] = segments.length;
        segments.push({ index: segments.length, cx, cy, spaceId: locator.spaces[si].id, peak: 0, peakAt: 0, secondsAtOrAbove: 0, personSeconds: 0 });
      }
    }
  }
  const steps = Math.max(0, Math.floor((o.range[1] - o.range[0]) / o.stepS));
  const maxSeries = new Uint8Array(steps);
  const circSeries = new Uint8Array(steps);
  const encounters: Encounter[] = [];
  const counts = new Uint16Array(segments.length);
  const hints = tracks.map(() => -1);
  const prevClose = new Set<string>();
  const px = new Float64Array(tracks.length);
  const py = new Float64Array(tracks.length);
  const valid = new Uint8Array(tracks.length);
  const inCirc = new Uint8Array(tracks.length);
  const r2 = o.encounterRadiusM * o.encounterRadiusM;
  // Prolonged circulation dwell tracking.
  const circSince = new Float64Array(tracks.length).fill(NaN);
  const circSpace: (ID | null)[] = tracks.map(() => null);
  const prolongedDwell: CongestionResult['prolongedDwell'] = [];

  for (let s = 0; s < steps; s++) {
    const t = o.range[0] + s * o.stepS;
    counts.fill(0);
    let nCirc = 0;
    for (let k = 0; k < tracks.length; k++) {
      const p = positionAt(tracks[k], t, hints[k]);
      valid[k] = 0;
      inCirc[k] = 0;
      if (!p || p.inGap) {
        closeDwell(k, t);
        continue;
      }
      hints[k] = p.index;
      px[k] = p.p.x;
      py[k] = p.p.y;
      valid[k] = 1;
      const c = Math.floor((p.p.x - b.minX) / o.segmentM);
      const r = Math.floor((p.p.y - b.minY) / o.segmentM);
      const si = c >= 0 && r >= 0 && c < cols && r < rows ? segIndex[r * cols + c] : -1;
      if (si >= 0) {
        counts[si]++;
        inCirc[k] = 1;
        nCirc++;
        const sid = segments[si].spaceId;
        // Slow movement inside circulation counts toward prolonged dwell.
        if (p.speed < 0.3) {
          if (Number.isNaN(circSince[k])) {
            circSince[k] = t;
            circSpace[k] = sid;
          }
        } else closeDwell(k, t);
      } else closeDwell(k, t);
    }
    circSeries[s] = Math.min(255, nCirc);
    let mx = 0;
    for (let i = 0; i < segments.length; i++) {
      const n = counts[i];
      if (!n) continue;
      const seg = segments[i];
      seg.personSeconds += n * o.stepS;
      if (n >= o.threshold) seg.secondsAtOrAbove += o.stepS;
      if (n > seg.peak) {
        seg.peak = n;
        seg.peakAt = t;
      }
      if (n > mx) mx = n;
    }
    maxSeries[s] = Math.min(255, mx);
    // Encounters (pairwise; tens of tags => trivial cost).
    const nowClose = new Set<string>();
    for (let i = 0; i < tracks.length; i++) {
      if (!valid[i]) continue;
      for (let j = i + 1; j < tracks.length; j++) {
        if (!valid[j] || !(inCirc[i] || inCirc[j])) continue;
        const dx = px[i] - px[j];
        const dy = py[i] - py[j];
        if (dx * dx + dy * dy > r2) continue;
        const key = `${i}|${j}`;
        nowClose.add(key);
        if (!prevClose.has(key)) {
          encounters.push({ t, x: (px[i] + px[j]) / 2, y: (py[i] + py[j]) / 2, a: tracks[i].staffId, b: tracks[j].staffId, roleA: tracks[i].roleId, roleB: tracks[j].roleId });
        }
      }
    }
    prevClose.clear();
    for (const k of nowClose) prevClose.add(k);
  }
  for (let k = 0; k < tracks.length; k++) closeDwell(k, o.range[1]);

  function closeDwell(k: number, t: number) {
    if (Number.isNaN(circSince[k])) return;
    if (t - circSince[k] >= 60) prolongedDwell.push({ staffId: tracks[k].staffId, spaceId: circSpace[k]!, start: circSince[k], end: t });
    circSince[k] = NaN;
    circSpace[k] = null;
  }

  return { options: o, segments, segOrigin: { x: b.minX, y: b.minY, cols, rows }, encounters, maxSeries, circSeries, prolongedDwell };
}
