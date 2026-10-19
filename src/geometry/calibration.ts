import type { Calibration, LengthUnit, Vec2 } from '@/domain/types';
import { deg2rad, dist } from './vec';

export const FT_PER_M = 1 / 0.3048;
export const M_PER_FT = 0.3048;

export const toMeters = (value: number, unit: LengthUnit) => (unit === 'ft' ? value * M_PER_FT : value);
export const fromMeters = (m: number, unit: LengthUnit) => (unit === 'ft' ? m * FT_PER_M : m);

/** Default assumption for an uncalibrated drawing: 1/8" = 1'-0". */
// 1/8 in on paper = 1 ft real. 1 in = 72 pt, so 9 pt = 1 ft = 0.3048 m.
export const DEFAULT_METERS_PER_POINT = M_PER_FT / 9;

export function defaultCalibration(): Calibration {
  return {
    calibrated: false,
    pointA: null,
    pointB: null,
    knownDistanceM: null,
    enteredUnit: 'ft',
    metersPerUnit: DEFAULT_METERS_PER_POINT,
    originSheet: { x: 0, y: 0 },
    rotationDeg: 0,
    date: null,
    verifications: [],
  };
}

/**
 * 2D affine transform [a c e; b d f] mapping (x,y) -> (a x + c y + e, b x + d y + f).
 * Same convention as Canvas/SVG matrix(a,b,c,d,e,f).
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const identity = (): Affine => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function apply(m: Affine, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Compose: result(p) = m1(m2(p)). */
export function compose(m1: Affine, m2: Affine): Affine {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-18) throw new Error('Non-invertible transform');
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Uniform scale of an affine (sqrt of |det|). */
export const affineScale = (m: Affine) => Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));

/**
 * Sheet -> world transform: world = R(rot) * s * (sheet - origin).
 * Similarity transform (uniform scale, rotation, translation). Double precision.
 */
export function sheetToWorld(cal: Calibration): Affine {
  const s = cal.metersPerUnit;
  const r = deg2rad(cal.rotationDeg);
  const cos = Math.cos(r) * s;
  const sin = Math.sin(r) * s;
  const o = cal.originSheet;
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: -(cos * o.x - sin * o.y),
    f: -(sin * o.x + cos * o.y),
  };
}

export const worldToSheet = (cal: Calibration) => invert(sheetToWorld(cal));

/** Meters-per-sheet-unit from two picked sheet points and a known distance. */
export function computeScale(a: Vec2, b: Vec2, knownDistanceM: number): number {
  const d = dist(a, b);
  if (!(d > 0)) throw new Error('Calibration points must be distinct');
  if (!(knownDistanceM > 0) || !Number.isFinite(knownDistanceM)) {
    throw new Error('Known distance must be a positive number');
  }
  return knownDistanceM / d;
}

/** Apply a two-point calibration, returning a new calibration object. */
export function calibrate(
  cal: Calibration,
  a: Vec2,
  b: Vec2,
  knownValue: number,
  unit: LengthUnit,
): Calibration {
  const knownDistanceM = toMeters(knownValue, unit);
  return {
    ...cal,
    calibrated: true,
    pointA: a,
    pointB: b,
    knownDistanceM,
    enteredUnit: unit,
    metersPerUnit: computeScale(a, b, knownDistanceM),
    date: new Date().toISOString(),
  };
}

/** Distance in meters between two sheet points under a calibration. */
export function measureSheet(cal: Calibration, a: Vec2, b: Vec2): number {
  return dist(a, b) * cal.metersPerUnit;
}

/**
 * Human-readable drawing scale, e.g. 1/8" = 1'-0" when it matches a common
 * architectural scale within 1%, otherwise 1 in = X ft.
 */
export function describeScale(metersPerPoint: number): string {
  const ftPerInch = (metersPerPoint * 72) / M_PER_FT;
  const common: [string, number][] = [
    ['1" = 1\'-0"', 1],
    ['3/4" = 1\'-0"', 4 / 3],
    ['1/2" = 1\'-0"', 2],
    ['3/8" = 1\'-0"', 8 / 3],
    ['1/4" = 1\'-0"', 4],
    ['3/16" = 1\'-0"', 16 / 3],
    ['1/8" = 1\'-0"', 8],
    ['3/32" = 1\'-0"', 32 / 3],
    ['1/16" = 1\'-0"', 16],
    ['1/32" = 1\'-0"', 32],
  ];
  for (const [label, v] of common) {
    if (Math.abs(ftPerInch - v) / v < 0.01) return label;
  }
  const ratio = (metersPerPoint * 72) / 0.0254; // 1 : ratio
  return `1" = ${ftPerInch.toFixed(2)}' (1:${Math.round(ratio)})`;
}
