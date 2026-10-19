/**
 * Derive architectural wall linework from the spatial model.
 * Used to draw the bundled sample PDF and as a fallback "derived linework"
 * background when no drawing is loaded. Walls are polygon edges, with:
 *  - door openings cut out,
 *  - edges shared between two circulation areas removed (open corridor joints),
 *  - duplicate shared edges between neighbouring spaces drawn only once.
 */
import type { SpatialModel, Vec2 } from '@/domain/types';
import { closestOnSegment, dist } from './vec';

export interface WallSegment {
  a: Vec2;
  b: Vec2;
}

type Interval = [number, number];

function subtract(intervals: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [s, e] of intervals) {
    if (cut[1] <= s || cut[0] >= e) out.push([s, e]);
    else {
      if (cut[0] > s) out.push([s, cut[0]]);
      if (cut[1] < e) out.push([cut[1], e]);
    }
  }
  return out;
}

/** Parameter interval of segment (c,d) projected onto (a,b) when collinear & overlapping. */
function collinearOverlap(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 0.02): Interval | null {
  const L = dist(a, b);
  if (L < 1e-9) return null;
  // Both endpoints must lie on the infinite line (check via perpendicular distance).
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  const perp = (p: Vec2) => Math.abs((p.x - a.x) * -uy + (p.y - a.y) * ux);
  if (perp(c) > tol || perp(d) > tol) return null;
  const tc = ((c.x - a.x) * ux + (c.y - a.y) * uy) / L;
  const td = ((d.x - a.x) * ux + (d.y - a.y) * uy) / L;
  const s = Math.max(0, Math.min(tc, td));
  const e = Math.min(1, Math.max(tc, td));
  return e - s > 1e-6 ? [s, e] : null;
}

export function deriveWalls(spatial: SpatialModel): WallSegment[] {
  const spaces = [
    ...spatial.rooms.map((r) => ({ poly: r.polygon, circ: false })),
    ...spatial.circulation.map((c) => ({ poly: c.polygon, circ: true })),
  ].filter((s) => s.poly.length >= 3);
  const out: WallSegment[] = [];
  spaces.forEach((sp, si) => {
    const n = sp.poly.length;
    for (let i = 0; i < n; i++) {
      const a = sp.poly[i];
      const b = sp.poly[(i + 1) % n];
      const L = dist(a, b);
      if (L < 1e-6) continue;
      let iv: Interval[] = [[0, 1]];
      // Remove portions already drawn by earlier spaces, and open joints between circulation areas.
      spaces.forEach((other, oi) => {
        if (oi === si) return;
        const m = other.poly.length;
        for (let j = 0; j < m; j++) {
          const ov = collinearOverlap(a, b, other.poly[j], other.poly[(j + 1) % m]);
          if (!ov) continue;
          if ((sp.circ && other.circ) || oi < si) iv = subtract(iv, ov);
        }
      });
      // Door openings.
      for (const d of spatial.doors) {
        const c = closestOnSegment(d.position, a, b);
        if (c.d > 0.3) continue;
        const half = d.widthM / 2 / L;
        iv = subtract(iv, [c.t - half, c.t + half]);
      }
      for (const [s, e] of iv) {
        if ((e - s) * L < 0.02) continue;
        out.push({
          a: { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s },
          b: { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e },
        });
      }
    }
  });
  return out;
}
