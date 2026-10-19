import { describe, expect, it } from 'vitest';
import { analyzeTracks, distanceUntil, DEFAULT_ANALYSIS_OPTIONS } from './engine';
import { positionAt, sliceTrack } from './trackUtils';
import { rectPolygon } from '@/geometry/polygon';
import { defaultRoomTypes } from '@/domain/defaults';
import type { SpatialModel, Track } from '@/domain/types';

const room = (id: string, poly: { x: number; y: number }[], type = 'Exam Room') => ({
  id, name: id, number: '', type, department: '', zoneId: null, polygon: poly, activityPoint: null, notes: '',
  targetOccupancy: null, plannedUtilization: '', color: null, locked: false, restricted: false, staffOnly: false, sensitive: false,
});
// Two rooms either side of a corridor.
const spatial: SpatialModel = {
  rooms: [room('A', rectPolygon(0, 0, 4, 4)), room('B', rectPolygon(10, 0, 14, 4))],
  circulation: [{ id: 'C', name: 'C', polygon: rectPolygon(4, 0, 10, 4), locked: false }],
  doors: [], obstacles: [], zones: [], anchors: [],
};

/** Build a track from [t, x, y] samples. */
const mk = (samples: [number, number, number][], gaps: number[] = []): Track => ({
  staffId: 's1', roleId: 'r1',
  t: Float64Array.from(samples.map((s) => s[0])),
  x: Float32Array.from(samples.map((s) => s[1])),
  y: Float32Array.from(samples.map((s) => s[2])),
  gap: Uint8Array.from(samples.map((_, i) => (gaps.includes(i) ? 1 : 0))),
});

/** Stay at p from t0 to t1 (1 Hz), then walk to q at 1 m/s. */
function scenario(): Track {
  const s: [number, number, number][] = [];
  for (let t = 0; t <= 300; t++) s.push([t, 2, 2]); // 5 min in A
  for (let k = 1; k <= 10; k++) s.push([300 + k, 2 + k, 2]); // walk 10 m to (12,2)
  for (let t = 311; t <= 600; t++) s.push([t, 12, 2]); // stay in B
  return mk(s);
}

const opts = { ...DEFAULT_ANALYSIS_OPTIONS, range: [0, 600] as [number, number] };

describe('analytics engine', () => {
  it('computes distance, moving and stationary time', () => {
    const a = analyzeTracks([scenario()], spatial, defaultRoomTypes(), opts);
    const s = a.staff[0];
    expect(s.distanceM).toBeCloseTo(10, 5);
    expect(s.movingS).toBeCloseTo(10, 5);
    expect(s.stationaryS).toBeCloseTo(590, 5);
    expect(s.gapS).toBe(0);
  });
  it('detects visits, dwell and trips', () => {
    const a = analyzeTracks([scenario()], spatial, defaultRoomTypes(), opts);
    const s = a.staff[0];
    expect(s.visits.map((v) => v.roomId)).toEqual(['A', 'B']);
    expect(s.trips).toHaveLength(1);
    expect(s.trips[0].fromRoomId).toBe('A');
    expect(s.trips[0].toRoomId).toBe('B');
    expect(s.trips[0].distanceM).toBeCloseTo(10, 5);
    expect(s.trips[0].end - s.trips[0].start).toBeCloseTo(10, 5);
    const A = a.spaceById.get('A')!;
    expect(A.visitCount).toBe(1);
    expect(A.dwellS).toBeGreaterThan(299);
    expect(a.spaceById.get('C')!.visitCount).toBe(0); // corridor passes are not visits
    expect(a.spaceById.get('C')!.personS).toBeGreaterThan(0);
  });
  it('treats a stationary person as zero distance with a single visit', () => {
    const s: [number, number, number][] = [];
    for (let t = 0; t <= 600; t++) s.push([t, 2, 2]);
    const a = analyzeTracks([mk(s)], spatial, defaultRoomTypes(), opts);
    expect(a.staff[0].distanceM).toBe(0);
    expect(a.staff[0].visits).toHaveLength(1);
    expect(a.staff[0].trips).toHaveLength(0);
  });
  it('excludes tracking gaps from observed distance and reports them separately', () => {
    // Position lost for 120 s while moving from A to B.
    const s: [number, number, number][] = [];
    for (let t = 0; t <= 100; t++) s.push([t, 2, 2]);
    for (let t = 220; t <= 400; t++) s.push([t, 12, 2]);
    const a = analyzeTracks([mk(s)], spatial, defaultRoomTypes(), { ...opts, range: [0, 400] });
    const st = a.staff[0];
    expect(st.distanceM).toBe(0);
    expect(st.gapS).toBeCloseTo(120);
    expect(st.gapBridgeM).toBeCloseTo(10);
    expect(st.trips[0].hasGap).toBe(true);
    // No interpolation through the gap.
    expect(positionAt(mk(s), 160)!.inGap).toBe(true);
  });
  it('does not count a jump across the plan as distance when flagged as a gap', () => {
    const s: [number, number, number][] = [[0, 1, 1], [1, 1.5, 1], [2, 13, 3], [3, 13, 3]];
    const a = analyzeTracks([mk(s, [2])], spatial, defaultRoomTypes(), { ...opts, range: [0, 3] });
    expect(a.staff[0].distanceM).toBeCloseTo(0.5);
  });
  it('handles a study with no observations', () => {
    const a = analyzeTracks([], spatial, defaultRoomTypes(), opts);
    expect(a.staff).toHaveLength(0);
    expect(a.spaces.every((s) => s.visitCount === 0)).toBe(true);
  });
  it('time filtering slices tracks with interpolated boundaries', () => {
    const tr = scenario();
    const sl = sliceTrack(tr, 305, 308);
    expect(sl.t[0]).toBe(305);
    expect(sl.x[0]).toBeCloseTo(7);
    expect(sl.t[sl.t.length - 1]).toBe(308);
    const a = analyzeTracks([tr], spatial, defaultRoomTypes(), { ...opts, range: [305, 308] });
    expect(a.staff[0].distanceM).toBeCloseTo(3, 5);
  });
  it('interpolates movement between samples', () => {
    const p = positionAt(scenario(), 305.5)!;
    expect(p.p.x).toBeCloseTo(7.5);
    expect(p.speed).toBeCloseTo(1);
    expect(distanceUntil(scenario(), 305.5).distanceM).toBeCloseTo(5.5);
  });
  it('computes peak simultaneous occupancy and presence union', () => {
    const t1 = { ...scenario(), staffId: 'a' };
    const t2 = { ...scenario(), staffId: 'b' };
    const a = analyzeTracks([t1, t2], spatial, defaultRoomTypes(), opts);
    const A = a.spaceById.get('A')!;
    expect(A.peakOccupancy).toBe(2);
    // Presence runs until the boundary-crossing sample (~302 s); union counts overlap once.
    expect(A.presenceS).toBeGreaterThan(300);
    expect(A.presenceS).toBeLessThan(304);
    expect(A.personS).toBeCloseTo(2 * A.presenceS, 5);
  });
});
