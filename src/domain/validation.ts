/**
 * Spatial-model validation: identifies problems that would make routing,
 * simulation or analytics untrustworthy.
 */
import type { ID, Project } from './types';
import { validatePolygon, pointInPolygon, centroid, area } from '@/geometry/polygon';
import type { SpatialContext } from '@/routing/spatialContext';

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  target?: { kind: 'room' | 'door' | 'circulation' | 'obstacle'; id: ID };
}

export function validateProject(p: Project, ctx: SpatialContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const { spatial } = p;
  const grid = ctx.grid;

  if (!p.calibration.calibrated) {
    out.push({
      severity: 'warning',
      code: 'calibration-missing',
      message: 'Drawing scale has not been calibrated. Distances use an assumed 1/8" = 1\'-0" scale and are not verified.',
    });
  }
  if (!spatial.rooms.length) out.push({ severity: 'info', code: 'no-rooms', message: 'No rooms defined yet.' });
  if (!spatial.circulation.length && spatial.rooms.length) {
    out.push({
      severity: 'warning',
      code: 'no-circulation',
      message: 'No circulation areas defined. Rooms can only connect through doors between rooms — the spatial model is simplified/incomplete.',
    });
  }

  const polyIssues = (kind: 'room' | 'circulation' | 'obstacle', id: ID, name: string, poly: { x: number; y: number }[]) => {
    const issues = validatePolygon(poly);
    if (issues.length) {
      out.push({ severity: 'error', code: 'invalid-polygon', message: `${name}: invalid polygon (${issues.join(', ')}).`, target: { kind, id } });
    }
  };
  for (const r of spatial.rooms) polyIssues('room', r.id, roomLabel(r), r.polygon);
  for (const c of spatial.circulation) polyIssues('circulation', c.id, c.name, c.polygon);
  for (const o of spatial.obstacles) polyIssues('obstacle', o.id, o.name, o.polygon);

  // Overlapping rooms (approximate: a room's interior point inside another room).
  for (let i = 0; i < spatial.rooms.length; i++) {
    for (let j = i + 1; j < spatial.rooms.length; j++) {
      const a = spatial.rooms[i];
      const b = spatial.rooms[j];
      if (a.polygon.length < 3 || b.polygon.length < 3) continue;
      const smaller = area(a.polygon) < area(b.polygon) ? a : b;
      const larger = smaller === a ? b : a;
      if (pointInPolygon(centroid(smaller.polygon), larger.polygon)) {
        out.push({
          severity: 'warning',
          code: 'room-overlap',
          message: `${roomLabel(smaller)} overlaps ${roomLabel(larger)}; overlapping cells are assigned to one room only.`,
          target: { kind: 'room', id: smaller.id },
        });
      }
    }
  }

  // Doors.
  grid.doors.forEach((d) => {
    if (d.problem) {
      const door = spatial.doors.find((x) => x.id === d.id);
      out.push({ severity: 'error', code: 'door-invalid', message: `${door?.name || 'Door'}: ${d.problem}.`, target: { kind: 'door', id: d.id } });
    }
  });

  // Group connectivity through doors.
  const groupCount = grid.groupRoom.length;
  const adj: number[][] = Array.from({ length: groupCount }, () => []);
  for (const d of grid.doors) {
    if (!d.groups) continue;
    adj[d.groups[0]].push(d.groups[1]);
    adj[d.groups[1]].push(d.groups[0]);
  }
  for (const r of ctx.rooms) {
    const g = grid.roomGroup.get(r.id)!;
    if (!adj[g].length) {
      out.push({ severity: 'error', code: 'room-no-door', message: `${roomLabel(r)} has no accessible door.`, target: { kind: 'room', id: r.id } });
    }
  }
  // Reachability from the circulation network (or the first room if none).
  const hub = spatial.circulation.length ? grid.circulationGroup : grid.roomGroup.get(ctx.rooms[0]?.id ?? '') ?? -1;
  if (hub >= 0) {
    const seen = new Set<number>([hub]);
    const q = [hub];
    while (q.length) {
      const g = q.pop()!;
      for (const n of adj[g]) if (!seen.has(n)) (seen.add(n), q.push(n));
    }
    for (const r of ctx.rooms) {
      const g = grid.roomGroup.get(r.id)!;
      if (adj[g].length && !seen.has(g)) {
        out.push({ severity: 'error', code: 'room-unreachable', message: `${roomLabel(r)} is not reachable from the main circulation network.`, target: { kind: 'room', id: r.id } });
      }
    }
  }

  // Circulation connectivity (cell flood fill over circulation cells).
  if (spatial.circulation.length > 1) {
    const comps = circulationComponents(ctx);
    if (comps.length > 1) {
      for (const comp of comps.slice(1)) {
        const names = comp.map((id) => spatial.circulation.find((c) => c.id === id)?.name ?? id);
        out.push({
          severity: 'warning',
          code: 'circulation-disconnected',
          message: `Circulation not connected to the main network: ${names.join(', ')}. Circulation areas must overlap or share an edge.`,
          target: { kind: 'circulation', id: comp[0] },
        });
      }
    }
  }

  // Activity points that ended up unreachable (e.g. room fully blocked by obstacles).
  for (const r of ctx.rooms) {
    const ap = ctx.activityPoint.get(r.id)!;
    const idx = Math.floor((ap.y - grid.originY) / grid.cell) * grid.cols + Math.floor((ap.x - grid.originX) / grid.cell);
    const s = grid.space[idx];
    if (s < 0 || grid.spaces[s].id !== r.id) {
      out.push({ severity: 'warning', code: 'activity-point', message: `${roomLabel(r)}: no walkable interior (blocked by obstacles?).`, target: { kind: 'room', id: r.id } });
    }
  }

  // Simulation destinations.
  const types = new Set(spatial.rooms.map((r) => r.type));
  const usedRoles = new Set(p.staff.map((s) => s.roleId));
  for (const role of p.roles) {
    if (!usedRoles.has(role.id)) continue;
    if (!role.homeBaseTypes.some((t) => types.has(t))) {
      out.push({ severity: 'warning', code: 'sim-home', message: `${role.name}: no room of home-base type (${role.homeBaseTypes.join(', ')}).` });
    }
    for (const a of role.activities) {
      if (!a.destinationTypes.some((t) => types.has(t))) {
        out.push({ severity: 'info', code: 'sim-destination', message: `${role.name} — "${a.label}": no destination rooms of type ${a.destinationTypes.join(', ')}; activity is skipped.` });
      }
    }
  }
  return out;
}

export const roomLabel = (r: { name: string; number: string }) => (r.number ? `${r.name} ${r.number}` : r.name || 'Room');

function circulationComponents(ctx: SpatialContext): ID[][] {
  const g = ctx.grid;
  const n = g.cols * g.rows;
  const comp = new Int32Array(n).fill(-1);
  const result: Set<ID>[] = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0 || g.cellGroup[i] !== g.circulationGroup) continue;
    const id = result.length;
    const ids = new Set<ID>();
    const stack = [i];
    comp[i] = id;
    while (stack.length) {
      const c = stack.pop()!;
      ids.add(g.spaces[g.space[c]].id);
      const cc = c % g.cols;
      const nbs = [c - g.cols, c + g.cols, cc > 0 ? c - 1 : -1, cc < g.cols - 1 ? c + 1 : -1];
      for (const nb of nbs) {
        if (nb < 0 || nb >= n || comp[nb] >= 0 || g.cellGroup[nb] !== g.circulationGroup) continue;
        comp[nb] = id;
        stack.push(nb);
      }
    }
    result.push(ids);
  }
  // Areas with no cells at all (too thin) count as their own component.
  const covered = new Set(result.flatMap((s) => [...s]));
  for (const c of ctx.spatial.circulation) if (!covered.has(c.id)) result.push(new Set([c.id]));
  return result.sort((a, b) => b.size - a.size).map((s) => [...s]);
}
