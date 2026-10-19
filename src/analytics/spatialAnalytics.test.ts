import { describe, expect, it } from 'vitest';
import { accumulate, emptyGrid, finalize, smooth } from './heatmap';
import { analyzeCongestion } from './congestion';
import { buildOD } from './od';
import { analyzeTracks, DEFAULT_ANALYSIS_OPTIONS } from './engine';
import { SpaceLocator } from './spaceLocator';
import { rectPolygon } from '@/geometry/polygon';
import { defaultRoomTypes } from '@/domain/defaults';
import type { SpatialModel, Track } from '@/domain/types';

const room = (id: string, poly: { x: number; y: number }[], type = 'Exam Room', sensitive = false) => ({
  id, name: id, number: '', type, department: '', zoneId: null, polygon: poly, activityPoint: null, notes: '',
  targetOccupancy: null, plannedUtilization: '', color: null, locked: false, restricted: false, staffOnly: false, sensitive,
});
const spatial: SpatialModel = {
  rooms: [room('A', rectPolygon(0, 0, 4, 4)), room('B', rectPolygon(10, 0, 14, 4), 'Nurse Station'), room('S', rectPolygon(0, 4, 4, 8), 'Staff Toilet', true)],
  circulation: [{ id: 'C', name: 'C', polygon: rectPolygon(4, 0, 10, 4), locked: false }],
  doors: [], obstacles: [], zones: [], anchors: [],
};
const loc = new SpaceLocator(spatial);

/** Walk back and forth between A and B through the corridor, `laps` times. */
function shuttle(id: string, laps: number, offset = 0): Track {
  const t: number[] = [], x: number[] = [], y: number[] = [];
  let time = offset;
  const stay = (px: number, s: number) => { for (let k = 0; k < s; k++) { t.push(time++); x.push(px); y.push(2); } };
  const walk = (a: number, b: number) => { const n = Math.abs(b - a); for (let k = 1; k <= n; k++) { t.push(time++); x.push(a + Math.sign(b - a) * k); y.push(2); } };
  for (let l = 0; l < laps; l++) { stay(2, 60); walk(2, 12); stay(12, 60); walk(12, 2); }
  return { staffId: id, roleId: 'r', t: Float64Array.from(t), x: Float32Array.from(x), y: Float32Array.from(y), gap: new Uint8Array(t.length) };
}

describe('heatmaps', () => {
  const sens = new Set(['S']);
  it('movement density only counts moving time; presence includes stationary time', () => {
    const tr = [shuttle('a', 2)];
    const g1 = emptyGrid(spatial, 0.5, loc, sens);
    accumulate(g1, tr, 'movement', { range: [0, 1e6], movingSpeedMps: 0.3, maxGapS: 30 });
    finalize(g1);
    const g2 = emptyGrid(spatial, 0.5, loc, sens);
    accumulate(g2, tr, 'presence', { range: [0, 1e6], movingSpeedMps: 0.3, maxGapS: 30 });
    finalize(g2);
    expect(g1.total).toBeCloseTo(40, 0); // 4 walks × 10 s
    expect(g2.total).toBeGreaterThan(g1.total * 5);
  });
  it('frequency counts distinct passes', () => {
    const g = emptyGrid(spatial, 0.5, loc, sens);
    accumulate(g, [shuttle('a', 3)], 'frequency', { range: [0, 1e6], movingSpeedMps: 0.3, maxGapS: 30 });
    finalize(g);
    // A mid-corridor cell is passed 6 times (3 laps × 2 directions).
    const c = Math.floor((7.1 - g.originX) / g.cell);
    const r = Math.floor((2.1 - g.originY) / g.cell);
    expect(g.values[r * g.cols + c]).toBe(6);
  });
  it('masks sensitive rooms and keeps smoothing inside walkable space', () => {
    const g = emptyGrid(spatial, 0.5, loc, sens);
    accumulate(g, [shuttle('a', 1)], 'presence', { range: [0, 1e6], movingSpeedMps: 0.3, maxGapS: 30 });
    smooth(g, 4);
    finalize(g);
    const c = Math.floor((2 - g.originX) / g.cell);
    const r = Math.floor((6 - g.originY) / g.cell);
    expect(g.values[r * g.cols + c]).toBe(0);
  });
});

describe('congestion', () => {
  it('counts simultaneous presence and encounters in circulation', () => {
    const a = shuttle('a', 2);
    const b = shuttle('b', 2); // identical path & timing -> always together
    const res = analyzeCongestion([a, b], spatial, loc, { range: [0, 280], stepS: 1, segmentM: 2, encounterRadiusM: 1.5, threshold: 2 });
    expect(Math.max(...res.segments.map((s) => s.peak))).toBe(2);
    expect(res.segments.some((s) => s.secondsAtOrAbove > 0)).toBe(true);
    expect(res.encounters.length).toBeGreaterThan(0);
  });
  it('reports no overlap for a single person', () => {
    const res = analyzeCongestion([shuttle('a', 2)], spatial, loc, { range: [0, 280], stepS: 1, segmentM: 2, encounterRadiusM: 1.5, threshold: 2 });
    expect(Math.max(...res.segments.map((s) => s.peak))).toBe(1);
    expect(res.encounters).toHaveLength(0);
  });
});

describe('origin–destination', () => {
  it('aggregates trips by room type', () => {
    const an = analyzeTracks([shuttle('a', 3)], spatial, defaultRoomTypes(), { ...DEFAULT_ANALYSIS_OPTIONS, range: [0, 1e4] });
    const od = buildOD(an.trips, loc, 'type');
    const ab = od.cells.get('Exam Room→Nurse Station')!;
    const ba = od.cells.get('Nurse Station→Exam Room')!;
    expect(ab.trips).toBe(3);
    expect(ba.trips).toBe(2);
    expect(ab.totalDistanceM / ab.trips).toBeCloseTo(10, 5);
  });
});
