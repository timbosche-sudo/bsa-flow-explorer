/**
 * Origin–destination aggregation of trips (between consecutive room visits),
 * by room function (type) or by individual room.
 */
import type { ID } from '@/domain/types';
import type { Trip } from './engine';
import type { SpaceLocator } from './spaceLocator';

export interface ODCell {
  from: string;
  to: string;
  trips: number;
  totalDistanceM: number;
  totalTimeS: number;
  byRole: Record<ID, number>;
  gapTrips: number;
}

export interface ODMatrix {
  keys: string[];
  cells: Map<string, ODCell>;
  maxTrips: number;
}

export const odKey = (a: string, b: string) => `${a}→${b}`;

export function buildOD(trips: Trip[], locator: SpaceLocator, by: 'type' | 'room'): ODMatrix {
  const label = (roomId: ID) => {
    const s = locator.spaces[locator.index.get(roomId) ?? -1];
    return s ? (by === 'type' ? s.type : s.id) : roomId;
  };
  const cells = new Map<string, ODCell>();
  const keys = new Set<string>();
  for (const t of trips) {
    const a = label(t.fromRoomId);
    const b = label(t.toRoomId);
    if (by === 'room' && a === b) continue;
    keys.add(a);
    keys.add(b);
    const k = odKey(a, b);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { from: a, to: b, trips: 0, totalDistanceM: 0, totalTimeS: 0, byRole: {}, gapTrips: 0 }));
    c.trips++;
    c.totalDistanceM += t.distanceM;
    c.totalTimeS += t.end - t.start;
    const r = t.roleId ?? 'unassigned';
    c.byRole[r] = (c.byRole[r] ?? 0) + 1;
    if (t.hasGap) c.gapTrips++;
  }
  // Order keys by total involvement.
  const involvement = new Map<string, number>();
  for (const c of cells.values()) {
    involvement.set(c.from, (involvement.get(c.from) ?? 0) + c.trips);
    involvement.set(c.to, (involvement.get(c.to) ?? 0) + c.trips);
  }
  const sorted = [...keys].sort((a, b) => (involvement.get(b) ?? 0) - (involvement.get(a) ?? 0));
  return { keys: sorted, cells, maxTrips: Math.max(0, ...[...cells.values()].map((c) => c.trips)) };
}
