import type { Polygon, Vec2 } from '@/domain/types';
import { closestOnSegment, cross, dist, sub } from './vec';

/** Signed area (shoelace). Positive for clockwise rings in y-down coordinates. */
export function signedArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const area = (poly: Polygon) => Math.abs(signedArea(poly));

export function centroid(poly: Polygon): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-12) {
    const n = poly.length || 1;
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / n,
      y: poly.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bbox(poly: Polygon): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  return boxes.reduce((u, b) => ({
    minX: Math.min(u.minX, b.minX),
    minY: Math.min(u.minY, b.minY),
    maxX: Math.max(u.maxX, b.maxX),
    maxY: Math.max(u.maxY, b.maxY),
  }));
}

/** Even-odd ray casting point-in-polygon test. Boundary points are ambiguous. */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from p to the polygon boundary. */
export function distanceToBoundary(p: Vec2, poly: Polygon): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]).d);
  }
  return d;
}

/** Proper intersection of segments p1p2 and p3p4 (excluding collinear touching). */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross(sub(p4, p3), sub(p1, p3));
  const d2 = cross(sub(p4, p3), sub(p2, p3));
  const d3 = cross(sub(p2, p1), sub(p3, p1));
  const d4 = cross(sub(p2, p1), sub(p4, p1));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export type PolygonIssue =
  | 'too-few-vertices'
  | 'zero-area'
  | 'self-intersecting'
  | 'duplicate-vertices'
  | 'non-finite';

/** Validates a simple polygon. Returns an empty list if valid. */
export function validatePolygon(poly: Polygon, eps = 1e-6): PolygonIssue[] {
  const issues: PolygonIssue[] = [];
  if (poly.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return ['non-finite'];
  if (poly.length < 3) return ['too-few-vertices'];
  for (let i = 0; i < poly.length; i++) {
    if (dist(poly[i], poly[(i + 1) % poly.length]) < eps) {
      issues.push('duplicate-vertices');
      break;
    }
  }
  if (area(poly) < eps) issues.push('zero-area');
  const n = poly.length;
  outer: for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent edges.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (segmentsIntersect(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) {
        issues.push('self-intersecting');
        break outer;
      }
    }
  }
  return issues;
}

/**
 * Approximate "pole of inaccessibility" — an interior point far from edges.
 * Used as a default activity point for non-convex rooms where the centroid may
 * fall outside the polygon. Grid search refined twice; adequate for room-sized polygons.
 */
export function interiorPoint(poly: Polygon): Vec2 {
  const c = centroid(poly);
  if (pointInPolygon(c, poly) && distanceToBoundary(c, poly) > 0.25) return c;
  const b = bbox(poly);
  let best = c;
  let bestD = pointInPolygon(c, poly) ? distanceToBoundary(c, poly) : -Infinity;
  let cx = (b.minX + b.maxX) / 2;
  let cy = (b.minY + b.maxY) / 2;
  let w = b.maxX - b.minX;
  let h = b.maxY - b.minY;
  for (let iter = 0; iter < 3; iter++) {
    const N = 16;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) {
        const p = { x: cx - w / 2 + (w * i) / N, y: cy - h / 2 + (h * j) / N };
        if (!pointInPolygon(p, poly)) continue;
        const d = distanceToBoundary(p, poly);
        if (d > bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    cx = best.x;
    cy = best.y;
    w /= 4;
    h /= 4;
  }
  return best;
}

export function rectPolygon(x0: number, y0: number, x1: number, y1: number): Polygon {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function translatePolygon(poly: Polygon, dx: number, dy: number): Polygon {
  return poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Nearest boundary edge to point p: returns edge index and distance. */
export function nearestEdge(p: Vec2, poly: Polygon): { index: number; d: number; t: number; point: Vec2 } {
  let best = { index: -1, d: Infinity, t: 0, point: p };
  for (let i = 0; i < poly.length; i++) {
    const r = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (r.d < best.d) best = { index: i, d: r.d, t: r.t, point: r.point };
  }
  return best;
}
