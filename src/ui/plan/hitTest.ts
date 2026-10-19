import type { Polygon, Project, Vec2 } from '@/domain/types';
import { closestOnSegment, dist } from '@/geometry/vec';
import { pointInPolygon } from '@/geometry/polygon';
import type { Selection } from '@/store/uiStore';

/** Pick the topmost spatial object at a world point. `tolM` is a screen tolerance in meters. */
export function hitTestSpatial(p: Project, w: Vec2, tolM: number, opts: { anchors: boolean; doors: boolean }): Selection | null {
  const s = p.spatial;
  if (opts.anchors) {
    for (const a of s.anchors) if (dist(a.position, w) < tolM) return { kind: 'anchor', id: a.id };
  }
  if (opts.doors) {
    let best: { id: string; d: number } | null = null;
    for (const d of s.doors) {
      const dd = dist(d.position, w);
      if (dd < Math.max(tolM, d.widthM / 2) && (!best || dd < best.d)) best = { id: d.id, d: dd };
    }
    if (best) return { kind: 'door', id: best.id };
  }
  for (const o of s.obstacles) if (pointInPolygon(w, o.polygon)) return { kind: 'obstacle', id: o.id };
  for (let i = s.rooms.length - 1; i >= 0; i--) if (pointInPolygon(w, s.rooms[i].polygon)) return { kind: 'room', id: s.rooms[i].id };
  for (const c of s.circulation) if (pointInPolygon(w, c.polygon)) return { kind: 'circulation', id: c.id };
  return null;
}

/** Nearest existing vertex within tolerance (for snapping while drawing). */
export function snapVertex(p: Project, w: Vec2, tolM: number, exclude?: Polygon): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = tolM;
  const polys = [...p.spatial.rooms.map((r) => r.polygon), ...p.spatial.circulation.map((c) => c.polygon), ...p.spatial.obstacles.map((o) => o.polygon)];
  for (const poly of polys) {
    if (poly === exclude) continue;
    for (const v of poly) {
      const d = dist(v, w);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
  }
  return best ? { ...best } : null;
}

/** Nearest point on any space edge within tolerance (door placement / edge snapping). */
export function snapEdge(p: Project, w: Vec2, tolM: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = tolM;
  const polys = [...p.spatial.rooms.map((r) => r.polygon), ...p.spatial.circulation.map((c) => c.polygon)];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const c = closestOnSegment(w, poly[i], poly[(i + 1) % poly.length]);
      if (c.d < bestD) {
        bestD = c.d;
        best = c.point;
      }
    }
  }
  return best;
}

/** Constrain b to horizontal/vertical from a (Shift-drawing). */
export function orthogonal(a: Vec2, b: Vec2): Vec2 {
  return Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
}
