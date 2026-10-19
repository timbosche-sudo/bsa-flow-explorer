/**
 * Precomputed routing context shared by the simulation engine and the UI:
 * nav grid, room activity points and lazily cached room-to-room routes.
 */
import type { ID, Room, SpatialModel, Vec2 } from '@/domain/types';
import { buildNavGrid, cellCenter, cellIndex, distanceField, findRoute, roomActivityPoint, snapToWalkable, type NavGrid, type Route } from './navGrid';

export class SpatialContext {
  readonly grid: NavGrid;
  readonly rooms: Room[];
  readonly roomById = new Map<ID, Room>();
  readonly activityPoint = new Map<ID, Vec2>();
  private fields = new Map<ID, Float32Array>();
  private routes = new Map<string, Route | null>();

  constructor(readonly spatial: SpatialModel, cellSize?: number) {
    this.grid = buildNavGrid(spatial, { cellSize });
    this.rooms = spatial.rooms.filter((r) => r.polygon.length >= 3);
    for (const r of this.rooms) {
      this.roomById.set(r.id, r);
      this.activityPoint.set(r.id, this.walkableActivityPoint(r));
    }
  }

  /** Activity point moved off obstacles / walls onto the nearest walkable cell of the room. */
  private walkableActivityPoint(r: Room): Vec2 {
    const p = roomActivityPoint(r);
    const idx = cellIndex(this.grid, p);
    const spaceIdx = idx >= 0 ? this.grid.space[idx] : -1;
    if (spaceIdx >= 0 && this.grid.spaces[spaceIdx].id === r.id) return p;
    const snapped = snapToWalkable(this.grid, p, r.id, 6);
    return snapped >= 0 ? cellCenter(this.grid, snapped) : p;
  }

  /** Grid distance field from a room's activity point (cached). */
  field(roomId: ID): Float32Array {
    let f = this.fields.get(roomId);
    if (!f) {
      f = distanceField(this.grid, this.activityPoint.get(roomId)!, roomId);
      this.fields.set(roomId, f);
    }
    return f;
  }

  /** Approximate walking distance (grid metric) between rooms; Infinity if unreachable. */
  roomDistance(a: ID, b: ID): number {
    if (a === b) return 0;
    const idx = cellIndex(this.grid, this.activityPoint.get(b)!);
    if (idx < 0) return Infinity;
    return this.field(a)[idx];
  }

  /** Smoothed route between two rooms' activity points (cached). */
  roomRoute(a: ID, b: ID): Route | null {
    const key = `${a}|${b}`;
    if (!this.routes.has(key)) {
      this.routes.set(key, findRoute(this.grid, this.activityPoint.get(a)!, this.activityPoint.get(b)!, a, b));
    }
    return this.routes.get(key)!;
  }

  route(from: Vec2, to: Vec2, fromSpace?: ID | null, toSpace?: ID | null): Route | null {
    return findRoute(this.grid, from, to, fromSpace, toSpace);
  }

  roomsOfTypes(types: string[]): Room[] {
    return this.rooms.filter((r) => types.includes(r.type));
  }
}
