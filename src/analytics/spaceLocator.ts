/**
 * Fast point -> space lookup using a uniform bucket grid of candidate
 * polygons. Rooms take priority over circulation (consistent with the
 * navigation grid). Points outside every space return -1.
 */
import type { ID, SpatialModel, Vec2 } from '@/domain/types';
import { bbox, pointInPolygon, unionBBox } from '@/geometry/polygon';

export interface SpaceInfo {
  id: ID;
  kind: 'room' | 'circulation';
  type: string; // room type or 'Corridor'
  name: string;
}

export class SpaceLocator {
  readonly spaces: SpaceInfo[] = [];
  readonly index = new Map<ID, number>();
  private polys: Vec2[][] = [];
  private buckets: Int32Array[] = [];
  private bx = 0;
  private by = 0;
  private cols = 1;
  private rows = 1;
  private size = 2;

  constructor(spatial: SpatialModel) {
    for (const r of spatial.rooms) {
      if (r.polygon.length < 3) continue;
      this.index.set(r.id, this.spaces.length);
      this.spaces.push({ id: r.id, kind: 'room', type: r.type, name: r.number ? `${r.name} ${r.number}` : r.name });
      this.polys.push(r.polygon);
    }
    for (const c of spatial.circulation) {
      if (c.polygon.length < 3) continue;
      this.index.set(c.id, this.spaces.length);
      this.spaces.push({ id: c.id, kind: 'circulation', type: 'Corridor', name: c.name });
      this.polys.push(c.polygon);
    }
    const b = unionBBox(this.polys.map(bbox));
    if (!b) return;
    this.bx = b.minX;
    this.by = b.minY;
    this.cols = Math.max(1, Math.ceil((b.maxX - b.minX) / this.size) + 1);
    this.rows = Math.max(1, Math.ceil((b.maxY - b.minY) / this.size) + 1);
    const lists: number[][] = Array.from({ length: this.cols * this.rows }, () => []);
    this.polys.forEach((p, i) => {
      const pb = bbox(p);
      const c0 = Math.floor((pb.minX - this.bx) / this.size);
      const c1 = Math.floor((pb.maxX - this.bx) / this.size);
      const r0 = Math.floor((pb.minY - this.by) / this.size);
      const r1 = Math.floor((pb.maxY - this.by) / this.size);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lists[r * this.cols + c]?.push(i);
    });
    this.buckets = lists.map((l) => Int32Array.from(l));
  }

  /** Space index at a point (rooms first), or -1. */
  locate(x: number, y: number): number {
    const c = Math.floor((x - this.bx) / this.size);
    const r = Math.floor((y - this.by) / this.size);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    const cand = this.buckets[r * this.cols + c];
    if (!cand) return -1;
    const p = { x, y };
    // Candidates are stored rooms-first, so the first hit honours room priority.
    for (let k = 0; k < cand.length; k++) if (pointInPolygon(p, this.polys[cand[k]])) return cand[k];
    return -1;
  }
}
