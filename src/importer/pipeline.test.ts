import { describe, expect, it } from 'vitest';
import { cleanRecords, DEFAULT_THRESHOLDS, frameToWorld, guessMapping, parseRows, parseTimestamp, rowsFromJson, toStudySeconds } from './pipeline';

const opts = {
  mapping: guessMapping(['tag_id', 'timestamp_utc', 'x_m', 'y_m']),
  timestampFormat: 'auto' as const,
  unit: 'm' as const,
  utcOffsetMin: -300,
  studyDate: '2025-03-12',
};
const row = (tag: string, ts: string | number | null, x: unknown, y: unknown) => ({ tag_id: tag, timestamp_utc: ts, x_m: x, y_m: y });

describe('import parsing', () => {
  it('guesses column mapping from headers', () => {
    const m = guessMapping(['study_id', 'tag_id', 'timestamp_utc', 'x_m', 'y_m', 'z_m', 'quality', 'uncertainty_m']);
    expect(m).toMatchObject({ tag: 'tag_id', timestamp: 'timestamp_utc', x: 'x_m', y: 'y_m', z: 'z_m', quality: 'quality', uncertainty: 'uncertainty_m' });
  });
  it('parses ISO UTC, epoch seconds/ms and time-of-day into study-local seconds', () => {
    const iso = parseTimestamp('2025-03-12T13:00:00Z', 'auto', '2025-03-12', -300)!;
    expect(toStudySeconds(iso, '2025-03-12', -300)).toBe(8 * 3600); // 13:00Z = 08:00 at UTC-5
    expect(parseTimestamp(String(iso / 1000), 'auto', '2025-03-12', -300)).toBe(iso);
    expect(parseTimestamp(String(iso), 'auto', '2025-03-12', -300)).toBe(iso);
    expect(parseTimestamp('08:00:00', 'auto', '2025-03-12', -300)).toBe(iso);
    expect(parseTimestamp('', 'auto', '2025-03-12', -300)).toBeNull();
    expect(parseTimestamp('not a date', 'iso', '2025-03-12', -300)).toBeNull();
  });
  it('counts missing values and invalid coordinates', () => {
    const r = parseRows([row('A', '2025-03-12T13:00:00Z', 1, 2), row('', '2025-03-12T13:00:01Z', 1, 2), row('A', null, 1, 2), row('A', '2025-03-12T13:00:02Z', 'abc', 2)], opts);
    expect(r.records).toHaveLength(1);
    expect(r.missingTag).toBe(1);
    expect(r.missingTimestamp).toBe(1);
    expect(r.invalidCoordinate).toBe(1);
  });
  it('converts units', () => {
    const r = parseRows([row('A', '2025-03-12T13:00:00Z', 10, 0)], { ...opts, unit: 'ft' });
    expect(r.records[0].x).toBeCloseTo(3.048);
  });
  it('maps coordinate frames (offset, rotation, y-up)', () => {
    const w = frameToWorld({ offset: { x: 5, y: 10 }, rotationDeg: 0, flipY: true }, 1, 2);
    expect(w).toEqual({ x: 6, y: 8 });
    const r = frameToWorld({ offset: { x: 0, y: 0 }, rotationDeg: 90, flipY: false }, 1, 0);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });
  it('reads JSON arrays and nested position objects', () => {
    const rows = rowsFromJson(JSON.stringify({ observations: [{ tagId: 'T', timestampUtc: '2025-03-12T13:00:00Z', position: { x: 1, y: 2 } }] }));
    expect(rows[0]['position.x']).toBe(1);
  });
});

describe('import cleaning', () => {
  const rec = (t: number, x: number, y = 0, tag = 'A', row = 0) => ({ tag, t, x, y, z: null, quality: null, uncertainty: null, row });
  const pr = { missingTimestamp: 0, missingTag: 0, invalidCoordinate: 0, totalRows: 0 };
  const inside = () => true;

  it('sorts non-monotonic records and removes duplicates, recording both', () => {
    const r = cleanRecords([rec(2, 2), rec(0, 0), rec(1, 1), rec(1, 1)], pr, DEFAULT_THRESHOLDS, inside);
    expect(Array.from(r.cleanTracks[0].t)).toEqual([0, 1, 2]);
    const issue = (c: string) => r.report.issues.find((i) => i.code === c)!.count;
    expect(issue('non-monotonic')).toBeGreaterThan(0);
    expect(issue('duplicate')).toBe(1);
  });
  it('keeps the first of two records sharing a timestamp with different positions', () => {
    const r = cleanRecords([rec(0, 0), rec(1, 1), rec(1, 5)], pr, DEFAULT_THRESHOLDS, inside);
    expect(Array.from(r.cleanTracks[0].x)).toEqual([0, 1]);
    expect(r.report.issues.find((i) => i.code === 'same-time-conflict')!.count).toBe(1);
  });
  it('drops implausible jumps from clean tracks but preserves them in raw tracks', () => {
    const r = cleanRecords([rec(0, 0), rec(1, 1), rec(2, 30), rec(3, 2)], pr, DEFAULT_THRESHOLDS, inside);
    expect(Array.from(r.cleanTracks[0].x)).toEqual([0, 1, 2]);
    expect(r.rawTracks[0].x).toHaveLength(4);
    expect(r.report.issues.find((i) => i.code === 'implausible-speed')!.count).toBe(1);
  });
  it('marks large gaps without interpolating', () => {
    const r = cleanRecords([rec(0, 0), rec(1, 1), rec(200, 2), rec(201, 2.5)], pr, DEFAULT_THRESHOLDS, inside);
    expect(Array.from(r.cleanTracks[0].gap)).toEqual([1, 0, 1, 0]);
    expect(r.report.issues.find((i) => i.code === 'gap')!.count).toBe(1);
  });
  it('flags or excludes positions outside the study area per threshold', () => {
    const isIn = (x: number) => x < 10;
    const keep = cleanRecords([rec(0, 0), rec(1, 20)], pr, { ...DEFAULT_THRESHOLDS, maxSpeedMps: 100 }, isIn);
    expect(keep.cleanTracks[0].t).toHaveLength(2);
    const drop = cleanRecords([rec(0, 0), rec(1, 20)], pr, { ...DEFAULT_THRESHOLDS, maxSpeedMps: 100, outsideMarginM: 0 }, isIn);
    expect(drop.cleanTracks[0].t).toHaveLength(1);
  });
  it('handles an empty dataset', () => {
    const r = cleanRecords([], pr, DEFAULT_THRESHOLDS, inside);
    expect(r.cleanTracks).toHaveLength(0);
    expect(r.report.importedRecords).toBe(0);
  });
});
