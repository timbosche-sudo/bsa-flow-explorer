import type { SpatialModel, Vec2 } from '@/domain/types';
import { apply, affineScale, type Affine } from './calibration';

/**
 * Apply an affine transform to every coordinate in the spatial model.
 * Used when re-calibrating or moving the origin so that previously drawn
 * geometry stays aligned with the drawing. Door widths and anchor survey
 * data scale with the transform.
 */
export function remapSpatial(s: SpatialModel, m: Affine): SpatialModel {
  const P = (p: Vec2) => apply(m, p);
  const k = affineScale(m);
  return {
    rooms: s.rooms.map((r) => ({ ...r, polygon: r.polygon.map(P), activityPoint: r.activityPoint ? P(r.activityPoint) : null })),
    doors: s.doors.map((d) => ({ ...d, position: P(d.position), widthM: d.widthM * k })),
    circulation: s.circulation.map((c) => ({ ...c, polygon: c.polygon.map(P) })),
    obstacles: s.obstacles.map((o) => ({ ...o, polygon: o.polygon.map(P) })),
    zones: s.zones,
    anchors: s.anchors.map((a) => ({ ...a, position: P(a.position), surveyedPosition: a.surveyedPosition ? P(a.surveyedPosition) : null })),
  };
}
