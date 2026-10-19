/**
 * Movement analytics.
 *
 * Works identically on simulated and observed tracks. All metrics are
 * computed from time-stamped world positions within an analysis window.
 *
 * DEFINITIONS (also surfaced in the UI via metricDefinitions.ts)
 *  - Tracked time: time covered by valid consecutive samples (gaps excluded).
 *  - Gap: consecutive samples further apart than maxGapS, or flagged gaps.
 *    Movement across gaps is NOT counted as observed distance; the
 *    straight-line displacement across gaps is reported separately as an
 *    estimated lower bound.
 *  - Moving: segment speed >= movingSpeedMps.
 *  - Space presence interval: contiguous samples located in the same space.
 *  - Visit: presence interval in a ROOM (not circulation) lasting at least
 *    minVisitS. Shorter intervals are pass-throughs.
 *  - Trip: movement between two consecutive visits (origin → destination),
 *    from departure (last continuous movement in the origin) to arrival.
 *  - Dwell time: sum of visit durations.
 *  - Presence (≥1 person): union over staff of presence intervals.
 */
import type { ID, RoomTypeDef, SpatialModel, Track } from '@/domain/types';
import { sliceTrack } from './trackUtils';
import { SpaceLocator } from './spaceLocator';

export interface AnalysisOptions {
  range: [number, number];
  minVisitS: number;
  movingSpeedMps: number;
  maxGapS: number;
  /** Bin size for occupancy time series, seconds. */
  binS: number;
}

export const DEFAULT_ANALYSIS_OPTIONS: Omit<AnalysisOptions, 'range'> = {
  minVisitS: 20,
  movingSpeedMps: 0.3,
  maxGapS: 30,
  binS: 60,
};

export interface Interval {
  staffId: ID;
  roleId: ID | null;
  spaceIndex: number;
  start: number;
  end: number;
  /** Track sample indices (inclusive) in the sliced track. */
  i0: number;
  i1: number;
}

export interface Visit extends Interval {
  roomId: ID;
}

export interface Trip {
  staffId: ID;
  roleId: ID | null;
  fromRoomId: ID;
  toRoomId: ID;
  start: number;
  end: number;
  distanceM: number;
  /** True if the trip spans a tracking gap (distance underestimated). */
  hasGap: boolean;
}

export interface StaffAnalysis {
  staffId: ID;
  roleId: ID | null;
  trackedS: number;
  gapS: number;
  movingS: number;
  stationaryS: number;
  distanceM: number;
  /** Straight-line displacement across gaps (estimated lower bound, not observed). */
  gapBridgeM: number;
  visits: Visit[];
  trips: Trip[];
  intervals: Interval[];
  /** Distance per hour-of-day bucket (index = hour). */
  hourlyDistanceM: Float64Array;
  hourlyMovingS: Float64Array;
  firstT: number | null;
  lastT: number | null;
  /** Fraction of tracked samples located outside any defined space. */
  unlocatedFraction: number;
}

export interface SpaceAnalysis {
  spaceIndex: number;
  id: ID;
  kind: 'room' | 'circulation';
  type: string;
  name: string;
  visitCount: number;
  dwellS: number;
  avgVisitS: number;
  /** Person-seconds of presence (including pass-throughs). */
  personS: number;
  /** Time with at least one tracked person present. */
  presenceS: number;
  peakOccupancy: number;
  peakAt: number | null;
  dwellByRole: Record<ID, number>;
  visitsByRole: Record<ID, number>;
  /** Mean simultaneous occupancy per bin (person-seconds / binS). */
  occupancy: Float32Array;
  uniqueStaff: number;
}

export interface DatasetAnalysis {
  options: AnalysisOptions;
  staff: StaffAnalysis[];
  spaces: SpaceAnalysis[];
  spaceById: Map<ID, SpaceAnalysis>;
  trips: Trip[];
  binCount: number;
  /** Simultaneously present staff per bin (mean). */
  totalOccupancy: Float32Array;
  locator: SpaceLocator;
}

export function analyzeTracks(
  tracks: Track[],
  spatial: SpatialModel,
  roomTypes: RoomTypeDef[],
  options: AnalysisOptions,
  locator = new SpaceLocator(spatial),
): DatasetAnalysis {
  const [r0, r1] = options.range;
  const binCount = Math.max(1, Math.ceil((r1 - r0) / options.binS));
  const circTypes = new Set(roomTypes.filter((t) => t.isCirculation).map((t) => t.name));
  const isRoom = (si: number) => si >= 0 && locator.spaces[si].kind === 'room' && !circTypes.has(locator.spaces[si].type);

  const staff: StaffAnalysis[] = [];
  const allIntervals: Interval[] = [];
  for (const full of tracks) {
    const tr = sliceTrack(full, r0, r1);
    const a = analyzeTrack(tr, locator, options, isRoom);
    staff.push(a);
    allIntervals.push(...a.intervals);
  }

  // Per-space aggregation.
  const spaces: SpaceAnalysis[] = locator.spaces.map((s, i) => ({
    spaceIndex: i,
    id: s.id,
    kind: s.kind,
    type: s.type,
    name: s.name,
    visitCount: 0,
    dwellS: 0,
    avgVisitS: 0,
    personS: 0,
    presenceS: 0,
    peakOccupancy: 0,
    peakAt: null,
    dwellByRole: {},
    visitsByRole: {},
    occupancy: new Float32Array(binCount),
    uniqueStaff: 0,
  }));
  const totalOccupancy = new Float32Array(binCount);
  const bySpace: Interval[][] = spaces.map(() => []);
  for (const iv of allIntervals) if (iv.spaceIndex >= 0) bySpace[iv.spaceIndex].push(iv);

  for (const s of staff) {
    for (const v of s.visits) {
      const sp = spaces[v.spaceIndex];
      const d = v.end - v.start;
      sp.visitCount++;
      sp.dwellS += d;
      const role = v.roleId ?? 'unassigned';
      sp.dwellByRole[role] = (sp.dwellByRole[role] ?? 0) + d;
      sp.visitsByRole[role] = (sp.visitsByRole[role] ?? 0) + 1;
    }
  }
  spaces.forEach((sp, i) => {
    sp.avgVisitS = sp.visitCount ? sp.dwellS / sp.visitCount : 0;
    const ivs = bySpace[i];
    sp.uniqueStaff = new Set(ivs.map((v) => v.staffId)).size;
    // Sweep for presence union and peak simultaneous occupancy.
    const ev: [number, number][] = [];
    for (const v of ivs) {
      sp.personS += v.end - v.start;
      ev.push([v.start, 1], [v.end, -1]);
      addToBins(sp.occupancy, v.start, v.end, r0, options.binS);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0;
    let lastT = 0;
    for (const [t, d] of ev) {
      if (cur > 0) sp.presenceS += t - lastT;
      cur += d;
      lastT = t;
      if (cur > sp.peakOccupancy) {
        sp.peakOccupancy = cur;
        sp.peakAt = t;
      }
    }
    for (let b = 0; b < binCount; b++) {
      totalOccupancy[b] += sp.occupancy[b];
      sp.occupancy[b] /= options.binS;
    }
  });
  for (let b = 0; b < binCount; b++) totalOccupancy[b] /= options.binS;

  return {
    options,
    staff,
    spaces,
    spaceById: new Map(spaces.map((s) => [s.id, s])),
    trips: staff.flatMap((s) => s.trips),
    binCount,
    totalOccupancy,
    locator,
  };
}

function addToBins(bins: Float32Array, a: number, b: number, r0: number, binS: number) {
  let t = a;
  while (t < b) {
    const bi = Math.floor((t - r0) / binS);
    if (bi < 0 || bi >= bins.length) break;
    const binEnd = r0 + (bi + 1) * binS;
    const e = Math.min(b, binEnd);
    bins[bi] += e - t;
    t = e;
  }
}

export function analyzeTrack(tr: Track, locator: SpaceLocator, o: Omit<AnalysisOptions, 'range'>, isRoom: (si: number) => boolean): StaffAnalysis {
  const n = tr.t.length;
  const res: StaffAnalysis = {
    staffId: tr.staffId,
    roleId: tr.roleId,
    trackedS: 0,
    gapS: 0,
    movingS: 0,
    stationaryS: 0,
    distanceM: 0,
    gapBridgeM: 0,
    visits: [],
    trips: [],
    intervals: [],
    hourlyDistanceM: new Float64Array(24),
    hourlyMovingS: new Float64Array(24),
    firstT: n ? tr.t[0] : null,
    lastT: n ? tr.t[n - 1] : null,
    unlocatedFraction: 0,
  };
  if (!n) return res;

  const space = new Int32Array(n);
  let unlocated = 0;
  for (let i = 0; i < n; i++) {
    space[i] = locator.locate(tr.x[i], tr.y[i]);
    if (space[i] < 0) unlocated++;
  }
  res.unlocatedFraction = unlocated / n;

  // Segment metrics.
  const isGap = (i: number) => tr.gap[i] === 1 || tr.t[i] - tr.t[i - 1] > o.maxGapS;
  for (let i = 1; i < n; i++) {
    const dt = tr.t[i] - tr.t[i - 1];
    const d = Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]);
    if (isGap(i)) {
      res.gapS += dt;
      res.gapBridgeM += d;
      continue;
    }
    res.trackedS += dt;
    const h = Math.floor(tr.t[i - 1] / 3600) % 24;
    if (dt > 0 && d / dt >= o.movingSpeedMps) {
      res.movingS += dt;
      res.distanceM += d;
      res.hourlyDistanceM[h] += d;
      res.hourlyMovingS[h] += dt;
    } else {
      res.stationaryS += dt;
      // Small in-place repositioning still counts toward distance walked.
      res.distanceM += d;
      res.hourlyDistanceM[h] += d;
    }
  }

  // Presence intervals (contiguous runs in one space, split at gaps).
  let runStart = 0;
  for (let i = 1; i <= n; i++) {
    const brk = i === n || space[i] !== space[runStart] || isGap(i);
    if (!brk) continue;
    const end = i === n ? n - 1 : isGap(i) ? i - 1 : i;
    const si = space[runStart];
    // Interval spans from first sample in the space to the transition sample (or last sample before a gap).
    const startT = tr.t[runStart];
    const endT = tr.t[Math.max(runStart, end)];
    if (si >= 0 && endT > startT) {
      res.intervals.push({ staffId: tr.staffId, roleId: tr.roleId, spaceIndex: si, start: startT, end: endT, i0: runStart, i1: end });
    }
    runStart = i;
  }

  // Visits: room intervals >= minVisitS; merge consecutive visits to the same room separated by brief excursions.
  for (const iv of res.intervals) {
    if (!isRoom(iv.spaceIndex) || iv.end - iv.start < o.minVisitS) continue;
    const last = res.visits[res.visits.length - 1];
    if (last && last.spaceIndex === iv.spaceIndex && iv.start - last.end < o.minVisitS) {
      last.end = iv.end;
      last.i1 = iv.i1;
      continue;
    }
    res.visits.push({ ...iv, roomId: locator.spaces[iv.spaceIndex].id });
  }

  // Trips between consecutive visits: from departure (start of the final
  // continuous movement in the origin room) to arrival (first stop in the
  // destination room), so in-room walking to/from the door is included.
  const moving = (i: number) => {
    const dt = tr.t[i] - tr.t[i - 1];
    return dt > 0 && !isGap(i) && Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]) / dt >= o.movingSpeedMps;
  };
  for (let k = 1; k < res.visits.length; k++) {
    const a = res.visits[k - 1];
    const b = res.visits[k];
    let dep = a.i1;
    while (dep > a.i0 + 1 && moving(dep)) dep--;
    let arr = b.i0;
    while (arr < b.i1 && arr + 1 < n && moving(arr + 1)) arr++;
    let dist = 0;
    let hasGap = false;
    for (let i = dep + 1; i <= arr; i++) {
      if (isGap(i)) {
        hasGap = true;
        continue;
      }
      dist += Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]);
    }
    res.trips.push({ staffId: tr.staffId, roleId: tr.roleId, fromRoomId: a.roomId, toRoomId: b.roomId, start: tr.t[dep], end: tr.t[arr], distanceM: dist, hasGap });
  }
  return res;
}

/** Distance travelled by a track from its start up to time t (observed segments only). */
export function distanceUntil(tr: Track, t: number, maxGapS = 30): { distanceM: number; movingS: number; stationaryS: number } {
  let distanceM = 0;
  let movingS = 0;
  let stationaryS = 0;
  for (let i = 1; i < tr.t.length; i++) {
    if (tr.t[i - 1] >= t) break;
    const t1 = Math.min(tr.t[i], t);
    const full = tr.t[i] - tr.t[i - 1];
    if (tr.gap[i] || full > maxGapS) continue;
    const f = full > 0 ? (t1 - tr.t[i - 1]) / full : 0;
    const d = Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]);
    distanceM += d * f;
    if (full > 0 && d / full >= 0.3) movingS += t1 - tr.t[i - 1];
    else stationaryS += t1 - tr.t[i - 1];
  }
  return { distanceM, movingS, stationaryS };
}
