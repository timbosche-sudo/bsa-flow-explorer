import { describe, expect, it } from 'vitest';
import { apply, calibrate, compose, defaultCalibration, describeScale, invert, measureSheet, sheetToWorld, worldToSheet, M_PER_FT } from './calibration';
import { remapSpatial } from './remap';
import { area, centroid, pointInPolygon, rectPolygon, validatePolygon, interiorPoint } from './polygon';

describe('calibration', () => {
  it('computes scale from two points and a known distance (imperial)', () => {
    const cal = calibrate(defaultCalibration(), { x: 100, y: 100 }, { x: 100 + 9 * 20, y: 100 }, 20, 'ft');
    expect(cal.calibrated).toBe(true);
    expect(cal.metersPerUnit).toBeCloseTo(M_PER_FT / 9, 12);
    expect(describeScale(cal.metersPerUnit)).toBe('1/8" = 1\'-0"');
    expect(measureSheet(cal, { x: 0, y: 0 }, { x: 0, y: 90 })).toBeCloseTo(10 * M_PER_FT, 10);
  });
  it('rejects invalid input', () => {
    expect(() => calibrate(defaultCalibration(), { x: 1, y: 1 }, { x: 1, y: 1 }, 10, 'm')).toThrow();
    expect(() => calibrate(defaultCalibration(), { x: 0, y: 0 }, { x: 1, y: 1 }, -3, 'm')).toThrow();
  });
  it('sheet <-> world round-trips with origin and rotation', () => {
    const cal = { ...defaultCalibration(), metersPerUnit: 0.01, originSheet: { x: 50, y: 70 }, rotationDeg: 90 };
    const m = sheetToWorld(cal);
    expect(apply(m, { x: 50, y: 70 })).toEqual({ x: 0, y: 0 });
    const w = apply(m, { x: 150, y: 70 }); // 100 units along sheet x
    expect(w.x).toBeCloseTo(0, 9);
    expect(w.y).toBeCloseTo(1, 9); // rotated 90° -> along world +y
    const back = apply(worldToSheet(cal), w);
    expect(back.x).toBeCloseTo(150, 9);
    expect(back.y).toBeCloseTo(70, 9);
  });
  it('compose/invert are consistent', () => {
    const m = sheetToWorld({ ...defaultCalibration(), metersPerUnit: 0.02, originSheet: { x: 3, y: 4 }, rotationDeg: 33 });
    const id = compose(m, invert(m));
    expect(id.a).toBeCloseTo(1);
    expect(id.d).toBeCloseTo(1);
    expect(id.e).toBeCloseTo(0);
  });
  it('remaps geometry to stay aligned after re-calibration', () => {
    const old = { ...defaultCalibration(), metersPerUnit: 0.01 };
    const neu = { ...old, metersPerUnit: 0.02 };
    const m = compose(sheetToWorld(neu), worldToSheet(old));
    const s = remapSpatial(
      { rooms: [], doors: [{ id: 'd', name: '', position: { x: 1, y: 1 }, widthM: 1, oneWayFromSpaceId: null, locked: false }], circulation: [], obstacles: [], zones: [], anchors: [] },
      m,
    );
    expect(s.doors[0].position.x).toBeCloseTo(2);
    expect(s.doors[0].widthM).toBeCloseTo(2);
  });
});

describe('polygons', () => {
  it('area, centroid and containment', () => {
    const r = rectPolygon(0, 0, 4, 2);
    expect(area(r)).toBeCloseTo(8);
    expect(centroid(r)).toEqual({ x: 2, y: 1 });
    expect(pointInPolygon({ x: 1, y: 1 }, r)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 1 }, r)).toBe(false);
  });
  it('detects invalid polygons', () => {
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toContain('too-few-vertices');
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toContain('self-intersecting');
    expect(validatePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toContain('zero-area');
    expect(validatePolygon(rectPolygon(0, 0, 1, 1))).toEqual([]);
  });
  it('interior point of a non-convex room lies inside it', () => {
    const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
    expect(pointInPolygon(interiorPoint(L), L)).toBe(true);
  });
});
