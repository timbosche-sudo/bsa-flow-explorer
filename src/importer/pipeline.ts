/**
 * Observed position import pipeline (pure, framework-free).
 *
 *   raw rows ──map columns──▶ ParsedRecord[] ──frame transform──▶ world records
 *            ──validate & clean──▶ raw tracks (all valid-coordinate records)
 *                               + clean tracks (filtered) + QualityReport
 *
 * Original observations are preserved: `rawTracks` contain every record that
 * had a usable tag, time and coordinate (in world meters, unfiltered), while
 * `cleanTracks` apply the documented filters. Every exclusion is counted in
 * the quality report together with the threshold that caused it.
 */
import type { CoordinateFrame, ID, QualityReport, Track } from '@/domain/types';
import { deg2rad } from '@/geometry/vec';

export type TimestampFormat = 'auto' | 'iso' | 'epoch-s' | 'epoch-ms' | 'time-of-day';
export type CoordUnit = 'm' | 'ft' | 'mm' | 'cm';

export interface ColumnMapping {
  tag: string | null;
  timestamp: string | null;
  x: string | null;
  y: string | null;
  z: string | null;
  quality: string | null;
  uncertainty: string | null;
  source: string | null;
}

export interface ParseOptions {
  mapping: ColumnMapping;
  timestampFormat: TimestampFormat;
  unit: CoordUnit;
  /** Study site offset from UTC in minutes (e.g. -300 for UTC−5). */
  utcOffsetMin: number;
  /** Local study date (YYYY-MM-DD) used for time-of-day timestamps and as the day origin. */
  studyDate: string;
}

export interface ParsedRecord {
  tag: string;
  /** Seconds since local midnight of the study date. */
  t: number;
  x: number;
  y: number;
  z: number | null;
  quality: number | null;
  uncertainty: number | null;
  row: number;
}

export interface ParseResult {
  records: ParsedRecord[];
  missingTimestamp: number;
  missingTag: number;
  invalidCoordinate: number;
  totalRows: number;
  /** Earliest/latest absolute times (ms since epoch) for date detection. */
  firstEpochMs: number | null;
}

const UNIT_TO_M: Record<CoordUnit, number> = { m: 1, ft: 0.3048, mm: 0.001, cm: 0.01 };

/** Guess a column mapping from header names. */
export function guessMapping(headers: string[]): ColumnMapping {
  const find = (...pats: RegExp[]) => headers.find((h) => pats.some((p) => p.test(h.trim().toLowerCase()))) ?? null;
  return {
    tag: find(/^tag(_?id)?$/, /tag/, /device/, /^id$/),
    timestamp: find(/timestamp/, /^time(_utc)?$/, /datetime/, /^ts$/, /^t$/),
    x: find(/^x(_m|_ft)?$/, /^pos_?x$/, /^x/),
    y: find(/^y(_m|_ft)?$/, /^pos_?y$/, /^y/),
    z: find(/^z(_m|_ft)?$/, /^pos_?z$/),
    quality: find(/quality/, /^q$/),
    uncertainty: find(/uncert/, /accuracy/, /error/, /^sigma/),
    source: find(/^source$/, /method/),
  };
}

/** Parse a timestamp cell into absolute epoch milliseconds (or null). */
export function parseTimestamp(v: unknown, fmt: TimestampFormat, studyDate: string, utcOffsetMin: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const num = Number(s);
  const isNum = s !== '' && Number.isFinite(num);
  const f: TimestampFormat =
    fmt !== 'auto' ? fmt : isNum ? (num > 1e11 ? 'epoch-ms' : 'epoch-s') : /^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? 'time-of-day' : 'iso';
  if (f === 'epoch-ms') return isNum ? num : null;
  if (f === 'epoch-s') return isNum ? num * 1000 : null;
  if (f === 'time-of-day') {
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
    if (!m) return null;
    const localMs = Date.parse(`${studyDate}T00:00:00Z`) + ((+m[1] * 60 + +m[2]) * 60 + (m[3] ? +m[3] : 0)) * 1000;
    return localMs - utcOffsetMin * 60000; // local -> UTC
  }
  // ISO: strings without zone are interpreted as UTC (the schema requires UTC).
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Seconds since local midnight of `studyDate` for an absolute epoch time. */
export function toStudySeconds(epochMs: number, studyDate: string, utcOffsetMin: number): number {
  const localMidnightUtcMs = Date.parse(`${studyDate}T00:00:00Z`) - utcOffsetMin * 60000;
  return (epochMs - localMidnightUtcMs) / 1000;
}

export function parseRows(rows: Record<string, unknown>[], o: ParseOptions): ParseResult {
  const m = o.mapping;
  const res: ParseResult = { records: [], missingTimestamp: 0, missingTag: 0, invalidCoordinate: 0, totalRows: rows.length, firstEpochMs: null };
  const k = UNIT_TO_M[o.unit];
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === '') return NaN;
    return Number(v);
  };
  rows.forEach((r, row) => {
    const tag = m.tag ? String(r[m.tag] ?? '').trim() : '';
    if (!tag) return void res.missingTag++;
    const ms = m.timestamp ? parseTimestamp(r[m.timestamp], o.timestampFormat, o.studyDate, o.utcOffsetMin) : null;
    if (ms === null) return void res.missingTimestamp++;
    const x = num(m.x ? r[m.x] : undefined);
    const y = num(m.y ? r[m.y] : undefined);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return void res.invalidCoordinate++;
    if (res.firstEpochMs === null || ms < res.firstEpochMs) res.firstEpochMs = ms;
    const z = m.z ? num(r[m.z]) : NaN;
    const q = m.quality ? num(r[m.quality]) : NaN;
    const u = m.uncertainty ? num(r[m.uncertainty]) : NaN;
    res.records.push({
      tag,
      t: toStudySeconds(ms, o.studyDate, o.utcOffsetMin),
      x: x * k,
      y: y * k,
      z: Number.isFinite(z) ? z * k : null,
      quality: Number.isFinite(q) ? q : null,
      uncertainty: Number.isFinite(u) ? u * k : null,
      row,
    });
  });
  return res;
}

/** Map frame coordinates (already meters) into world meters. */
export function frameToWorld(frame: Pick<CoordinateFrame, 'offset' | 'rotationDeg' | 'flipY'>, x: number, y: number): { x: number; y: number } {
  const yy = frame.flipY ? -y : y;
  const r = deg2rad(frame.rotationDeg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: frame.offset.x + x * c - yy * s, y: frame.offset.y + x * s + yy * c };
}

export interface CleaningThresholds {
  /** Maximum plausible walking speed between consecutive samples (m/s). */
  maxSpeedMps: number;
  /** Gaps longer than this split the track (s). */
  maxGapS: number;
  /** Drop points whose stated uncertainty exceeds this (m); 0 disables. */
  maxUncertaintyM: number;
  /** Drop points outside mapped spaces by more than this margin (m); <0 keeps them. */
  outsideMarginM: number;
  /** Moving-median smoothing window (samples, odd); 1 disables. */
  medianWindow: number;
}

export const DEFAULT_THRESHOLDS: CleaningThresholds = {
  maxSpeedMps: 3,
  maxGapS: 30,
  maxUncertaintyM: 0,
  outsideMarginM: -1,
  medianWindow: 1,
};

export interface CleanResult {
  rawTracks: Track[];
  cleanTracks: Track[];
  report: QualityReport;
  tags: string[];
}

/**
 * Validate and clean world-space records.
 * `isInside(x,y)` reports whether a point lies within the mapped study area
 * (within margin); used to flag/filter out-of-area positions.
 */
export function cleanRecords(
  records: ParsedRecord[],
  parse: Pick<ParseResult, 'missingTimestamp' | 'missingTag' | 'invalidCoordinate' | 'totalRows'>,
  th: CleaningThresholds,
  isInside: (x: number, y: number) => boolean,
  tagRoles: Record<string, ID | null> = {},
): CleanResult {
  const byTag = new Map<string, ParsedRecord[]>();
  for (const r of records) {
    if (!byTag.has(r.tag)) byTag.set(r.tag, []);
    byTag.get(r.tag)!.push(r);
  }
  let duplicates = 0;
  let nonMonotonic = 0;
  let speed = 0;
  let gaps = 0;
  let outside = 0;
  let outsideDropped = 0;
  let uncertain = 0;
  let sameTimeConflicts = 0;
  const rawTracks: Track[] = [];
  const cleanTracks: Track[] = [];

  for (const [tag, list] of byTag) {
    // Non-monotonic timestamps (out of order in the file): counted, then sorted.
    for (let i = 1; i < list.length; i++) if (list[i].t < list[i - 1].t) nonMonotonic++;
    list.sort((a, b) => a.t - b.t || a.row - b.row);
    // Duplicates (same tag + time): exact duplicates dropped; conflicting positions keep the first.
    const dedup: ParsedRecord[] = [];
    for (const r of list) {
      const last = dedup[dedup.length - 1];
      if (last && last.t === r.t) {
        if (last.x === r.x && last.y === r.y) duplicates++;
        else sameTimeConflicts++;
        continue;
      }
      dedup.push(r);
    }
    rawTracks.push(toTrack(tag, tagRoles[tag] ?? null, dedup, th.maxGapS));

    // Clean.
    let pts = dedup;
    if (th.maxUncertaintyM > 0) {
      const before = pts.length;
      pts = pts.filter((p) => p.uncertainty === null || p.uncertainty <= th.maxUncertaintyM);
      uncertain += before - pts.length;
    }
    const kept: ParsedRecord[] = [];
    for (const p of pts) {
      if (!isInside(p.x, p.y)) {
        outside++;
        if (th.outsideMarginM >= 0) {
          outsideDropped++;
          continue;
        }
      }
      // Implausible jump relative to the last kept point (not across long gaps).
      const prev = kept[kept.length - 1];
      if (prev) {
        const dt = p.t - prev.t;
        if (dt <= th.maxGapS && dt > 0 && Math.hypot(p.x - prev.x, p.y - prev.y) / dt > th.maxSpeedMps) {
          speed++;
          continue;
        }
      }
      kept.push(p);
    }
    const smoothed = th.medianWindow > 1 ? medianSmooth(kept, th.medianWindow, th.maxGapS) : kept;
    const tr = toTrack(tag, tagRoles[tag] ?? null, smoothed, th.maxGapS);
    for (let i = 1; i < tr.gap.length; i++) if (tr.gap[i]) gaps++;
    cleanTracks.push(tr);
  }

  const imported = cleanTracks.reduce((s, t) => s + t.t.length, 0);
  const issues: QualityReport['issues'] = [
    { code: 'missing-timestamp', count: parse.missingTimestamp, description: 'Rows with a missing or unparseable timestamp', action: 'Excluded' },
    { code: 'missing-tag', count: parse.missingTag, description: 'Rows without a tag identifier', action: 'Excluded' },
    { code: 'invalid-coordinate', count: parse.invalidCoordinate, description: 'Rows with missing or non-numeric coordinates', action: 'Excluded' },
    { code: 'duplicate', count: duplicates, description: 'Exact duplicate records (same tag, time and position)', action: 'Excluded (one copy kept)' },
    { code: 'same-time-conflict', count: sameTimeConflicts, description: 'Records sharing a tag and timestamp but with different positions', action: 'First record kept' },
    { code: 'non-monotonic', count: nonMonotonic, description: 'Records out of time order in the source', action: 'Re-sorted by time (not excluded)' },
    { code: 'uncertainty', count: uncertain, description: `Stated uncertainty above ${th.maxUncertaintyM} m`, action: th.maxUncertaintyM > 0 ? 'Excluded from clean tracks' : 'Filter disabled' },
    {
      code: 'outside-area',
      count: outside,
      description: 'Positions outside the mapped study area',
      action: th.outsideMarginM >= 0 ? `Excluded from clean tracks (${outsideDropped})` : 'Kept and flagged (filter disabled)',
    },
    { code: 'implausible-speed', count: speed, description: `Jumps implying speed above ${th.maxSpeedMps} m/s`, action: 'Excluded from clean tracks (outlier)' },
    { code: 'gap', count: gaps, description: `Tracking gaps longer than ${th.maxGapS} s`, action: 'Track split; no interpolation across gaps' },
  ];
  if (th.medianWindow > 1) issues.push({ code: 'smoothing', count: imported, description: `Moving-median smoothing over ${th.medianWindow} samples`, action: 'Applied to clean tracks' });
  return {
    rawTracks,
    cleanTracks,
    tags: [...byTag.keys()],
    report: {
      totalRecords: parse.totalRows,
      importedRecords: imported,
      issues,
      thresholds: { ...th } as unknown as Record<string, number>,
    },
  };
}

function toTrack(tag: string, roleId: ID | null, pts: ParsedRecord[], maxGapS: number): Track {
  const n = pts.length;
  const t = new Float64Array(n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const gap = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = pts[i].t;
    x[i] = pts[i].x;
    y[i] = pts[i].y;
    gap[i] = i === 0 || pts[i].t - pts[i - 1].t > maxGapS ? 1 : 0;
  }
  return { staffId: tag, roleId, t, x, y, gap };
}

function medianSmooth(pts: ParsedRecord[], w: number, maxGapS: number): ParsedRecord[] {
  const h = Math.floor(w / 2);
  const med = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)];
  return pts.map((p, i) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let j = Math.max(0, i - h); j <= Math.min(pts.length - 1, i + h); j++) {
      if (Math.abs(pts[j].t - p.t) > maxGapS) continue;
      xs.push(pts[j].x);
      ys.push(pts[j].y);
    }
    return { ...p, x: med(xs), y: med(ys) };
  });
}

/** Parse a JSON payload: an array of observation objects or { observations: [...] }. */
export function rowsFromJson(text: string): Record<string, unknown>[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : Array.isArray(data?.observations) ? data.observations : null;
  if (!arr) throw new Error('JSON must be an array of observations or an object with an "observations" array.');
  return arr.map((o: Record<string, unknown>) => {
    // Flatten one level of nesting (e.g. { position: { x, y } }).
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) flat[`${k}.${k2}`] = v2;
      else flat[k] = v;
    }
    return flat;
  });
}
