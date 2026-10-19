import { describe, expect, it } from 'vitest';
import { sampleSpatialModel } from '@/sample/sampleClinic';
import { SpatialContext } from './spatialContext';
import { buildNavGrid, findRoute, lineOfSight } from './navGrid';
import { rectPolygon } from '@/geometry/polygon';
import type { SpatialModel } from '@/domain/types';

const empty = (): SpatialModel => ({ rooms: [], doors: [], circulation: [], obstacles: [], zones: [], anchors: [] });
const room = (id: string, poly = rectPolygon(0, 0, 4, 4)) => ({
  id, name: id, number: '', type: 'Exam Room', department: '', zoneId: null, polygon: poly,
  activityPoint: null, notes: '', targetOccupancy: null, plannedUtilization: '', color: null,
  locked: false, restricted: false, staffOnly: false, sensitive: false,
});

describe('nav grid on sample clinic', () => {
  const ctx = new SpatialContext(sampleSpatialModel());
  it('resolves every door to two spaces', () => {
    const bad = ctx.grid.doors.filter((d) => !d.groups);
    expect(bad.map((d) => `${d.id}: ${d.problem}`)).toEqual([]);
  });
  it('reaches every room from the nurse station', () => {
    const unreachable = ctx.rooms.filter((r) => !Number.isFinite(ctx.roomDistance('room-ns', r.id)));
    expect(unreachable.map((r) => r.id)).toEqual([]);
  });
  it('routes are at least the straight-line distance and go through doors', () => {
    const r = ctx.roomRoute('room-exam-101', 'room-exam-107')!;
    expect(r).not.toBeNull();
    const a = ctx.activityPoint.get('room-exam-101')!;
    const b = ctx.activityPoint.get('room-exam-107')!;
    expect(r.lengthM).toBeGreaterThan(Math.hypot(a.x - b.x, a.y - b.y));
    // Exam 101 -> 107 must leave via north corridor and circulate around the core.
    expect(r.spaceSequence[0]).toBe('room-exam-101');
    expect(r.spaceSequence.at(-1)).toBe('room-exam-107');
    expect(r.spaceSequence).toContain('circ-north');
  });
  it('does not pass through restricted rooms', () => {
    const r = ctx.roomRoute('room-ma-1', 'room-treat')!;
    expect(r.spaceSequence).not.toContain('room-clean');
  });
});

describe('nav grid walls', () => {
  it('blocks movement between adjacent rooms without a door', () => {
    const s = empty();
    s.rooms.push(room('a', rectPolygon(0, 0, 4, 4)), room('b', rectPolygon(4, 0, 8, 4)));
    const g = buildNavGrid(s, { cellSize: 0.2 });
    expect(findRoute(g, { x: 2, y: 2 }, { x: 6, y: 2 })).toBeNull();
    expect(lineOfSight(g, { x: 2, y: 2 }, { x: 6, y: 2 }, g.groupOf.get('a')!)).toBe(false);
  });
  it('allows movement through a door, with distance close to geometric', () => {
    const s = empty();
    s.rooms.push(room('a', rectPolygon(0, 0, 4, 4)), room('b', rectPolygon(4, 0, 8, 4)));
    s.doors.push({ id: 'd', name: 'd', position: { x: 4, y: 2 }, widthM: 1, oneWayFromSpaceId: null, locked: false });
    const g = buildNavGrid(s, { cellSize: 0.2 });
    const r = findRoute(g, { x: 2, y: 2 }, { x: 6, y: 2 })!;
    expect(r).not.toBeNull();
    expect(r.lengthM).toBeCloseTo(4, 1);
    // Detour via door at the top: distance must be larger than straight line.
    const r2 = findRoute(g, { x: 2, y: 0.5 }, { x: 6, y: 3.5 })!;
    expect(r2.lengthM).toBeGreaterThanOrEqual(Math.hypot(4, 3) - 1e-6);
  });
  it('honours one-way doors', () => {
    const s = empty();
    s.rooms.push(room('a', rectPolygon(0, 0, 4, 4)), room('b', rectPolygon(4, 0, 8, 4)));
    s.doors.push({ id: 'd', name: 'd', position: { x: 4, y: 2 }, widthM: 1, oneWayFromSpaceId: 'a', locked: false });
    const g = buildNavGrid(s, { cellSize: 0.2 });
    expect(findRoute(g, { x: 2, y: 2 }, { x: 6, y: 2 })).not.toBeNull();
    expect(findRoute(g, { x: 6, y: 2 }, { x: 2, y: 2 })).toBeNull();
  });
  it('routes around obstacles', () => {
    const s = empty();
    s.circulation.push({ id: 'c', name: 'c', polygon: rectPolygon(0, 0, 10, 4), locked: false });
    s.obstacles.push({ id: 'o', name: 'o', polygon: rectPolygon(4, 0, 6, 3) });
    const g = buildNavGrid(s, { cellSize: 0.1 });
    const r = findRoute(g, { x: 1, y: 1 }, { x: 9, y: 1 })!;
    expect(r.lengthM).toBeGreaterThan(8.5);
    expect(r.points.every((p) => !(p.x > 4.05 && p.x < 5.95 && p.y < 2.95))).toBe(true);
  });
});
