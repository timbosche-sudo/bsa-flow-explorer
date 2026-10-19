/**
 * Activity-based staff movement simulation.
 *
 * Each simulated person alternates between a home base and role-specific
 * activities. Destinations are chosen among rooms of the activity's types
 * weighted by proximity (configurable `locality`). All movement follows
 * routes computed on the navigation grid — staff never cross walls or
 * teleport. Output is emitted as time-stamped position samples identical in
 * shape to imported observations, plus a ground-truth activity log that is
 * available ONLY for simulated data.
 *
 * Determinism: the engine uses only the seeded RNG (one sub-stream per staff
 * member derived from the global seed and staff id), so identical inputs
 * produce identical outputs.
 */
import type {
  ActivityDef,
  ID,
  Project,
  Room,
  SimActivitySpan,
  SimulationConfig,
  SimulationResult,
  StaffMember,
  StaffRole,
  Track,
  Vec2,
} from '@/domain/types';
import { pointInPolygon } from '@/geometry/polygon';
import { dist, polylineLength } from '@/geometry/vec';
import { SpatialContext } from '@/routing/spatialContext';
import { lineOfSight } from '@/routing/navGrid';
import { Rng, hashString } from './rng';

export const ENGINE_VERSION = '1.0';

export interface SimulationInput {
  spatial: Project['spatial'];
  roles: StaffRole[];
  staff: StaffMember[];
  config: SimulationConfig;
}

export function simulationHash(input: SimulationInput): string {
  return hashString(JSON.stringify(input)).toString(16);
}

class TrackBuilder {
  t: number[] = [];
  x: number[] = [];
  y: number[] = [];
  gap: number[] = [];
  push(t: number, p: Vec2, gap = 0) {
    const n = this.t.length;
    if (n && t < this.t[n - 1]) t = this.t[n - 1];
    if (n && t === this.t[n - 1]) {
      // Same timestamp: replace (keeps times strictly increasing).
      this.x[n - 1] = p.x;
      this.y[n - 1] = p.y;
      return;
    }
    this.t.push(t);
    this.x.push(p.x);
    this.y.push(p.y);
    this.gap.push(gap);
  }
  build(staffId: ID, roleId: ID): Track {
    return {
      staffId,
      roleId,
      t: Float64Array.from(this.t),
      x: Float32Array.from(this.x),
      y: Float32Array.from(this.y),
      gap: Uint8Array.from(this.gap),
    };
  }
}

interface PersonState {
  t: number; // seconds since midnight
  pos: Vec2;
  roomId: ID;
}

export function runSimulation(input: SimulationInput, ctx?: SpatialContext): SimulationResult {
  const { roles, staff, config } = input;
  const context = ctx ?? new SpatialContext(input.spatial);
  const warnings: string[] = [];
  const tracks: Track[] = [];
  const spans: SimActivitySpan[] = [];
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const dt = Math.max(0.2, config.sampleIntervalS);

  if (!context.rooms.length) warnings.push('No rooms are defined; nothing to simulate.');

  for (const member of staff) {
    const role = roleById.get(member.roleId);
    if (!role) {
      warnings.push(`${member.code}: unknown role; skipped.`);
      continue;
    }
    const rng = new Rng(hashString(`${config.seed}:${member.id}`));
    const home = resolveHome(member, role, context);
    if (!home) {
      warnings.push(`${member.code}: no reachable home base of type ${role.homeBaseTypes.join(', ') || '(none)'}; skipped.`);
      continue;
    }
    const tb = new TrackBuilder();
    const res = simulatePerson(member, role, home, context, config, rng, tb, spans, dt, warnings);
    if (res) tracks.push(tb.build(member.id, role.id));
  }

  return {
    meta: {
      id: `sim-${config.seed}`,
      name: `Simulation (seed ${config.seed})`,
      kind: 'simulated',
      createdAt: new Date().toISOString(),
      studyDate: config.studyDate,
      source: `BSA Flow Explorer simulation engine v${ENGINE_VERSION}, seed ${config.seed}`,
      coordinateFrameId: null,
      provenance: [
        {
          date: new Date().toISOString(),
          action: 'simulate',
          detail: `Activity-based simulation of ${tracks.length} staff, ${dt}s sample interval. Hypothetical movement — not measured.`,
        },
      ],
      positionAccuracyM: null,
    },
    tracks,
    spans,
    warnings: Array.from(new Set(warnings)),
    configHash: simulationHash(input),
  };
}

function resolveHome(member: StaffMember, role: StaffRole, ctx: SpatialContext): Room | null {
  if (member.homeRoomId) {
    const r = ctx.roomById.get(member.homeRoomId);
    if (r) return r;
  }
  return ctx.roomsOfTypes(role.homeBaseTypes)[0] ?? null;
}

/** Peak-period intensity multiplier at a given time (seconds since midnight). */
function intensityAt(config: SimulationConfig, tS: number): number {
  const m = tS / 60;
  let k = 1;
  for (const p of config.peakPeriods) if (m >= p.startMin && m < p.endMin) k = Math.max(k, p.intensity);
  return k;
}

/** A position near a room's activity point, inside the room and visible from it. */
function jitteredPoint(ctx: SpatialContext, room: Room, rng: Rng, radius: number): Vec2 {
  const ap = ctx.activityPoint.get(room.id)!;
  if (radius <= 0) return ap;
  const g = ctx.grid.groupOf.get(room.id) ?? -1;
  for (let i = 0; i < 8; i++) {
    const a = rng.uniform(0, Math.PI * 2);
    const r = radius * Math.sqrt(rng.next());
    const p = { x: ap.x + Math.cos(a) * r, y: ap.y + Math.sin(a) * r };
    if (pointInPolygon(p, room.polygon) && lineOfSight(ctx.grid, ap, p, g)) return p;
  }
  return ap;
}

function simulatePerson(
  member: StaffMember,
  role: StaffRole,
  home: Room,
  ctx: SpatialContext,
  config: SimulationConfig,
  rng: Rng,
  tb: TrackBuilder,
  spans: SimActivitySpan[],
  dt: number,
  warnings: string[],
): boolean {
  const studyStart = config.studyStartMin * 60;
  const studyEnd = config.studyEndMin * 60;
  const vary = role.shiftVariationMin * 60;
  const start = Math.max(studyStart, member.shiftStartMin * 60 + Math.abs(rng.normal(0, vary)));
  const end = Math.min(studyEnd, member.shiftEndMin * 60 - Math.abs(rng.normal(0, vary)));
  if (end <= start + 60) {
    warnings.push(`${member.code}: shift does not overlap the study period.`);
    return false;
  }
  const speed = Math.max(0.6, rng.normal(role.walkingSpeedMps, role.walkingSpeedSd));

  // Schedule breaks (absolute seconds).
  const breaks = role.breaks
    .map((b) => {
      const room = nearestRoomOfTypes(ctx, home.id, b.destinationTypes, rng, 2);
      if (!room) warnings.push(`${role.shortName}: break "${b.label}" has no reachable destination.`);
      return {
        def: b,
        room,
        at: member.shiftStartMin * 60 + rng.uniform(b.earliestMin, Math.max(b.earliestMin, b.latestMin)) * 60,
      };
    })
    .filter((b) => b.room && b.at > start && b.at + b.def.durationMin * 60 < end)
    .sort((a, b) => a.at - b.at);

  // Destination candidates per activity (reachable only).
  const candidates = new Map<ID, Room[]>();
  for (const a of role.activities) {
    const rooms = ctx.roomsOfTypes(a.destinationTypes).filter((r) => Number.isFinite(ctx.roomDistance(home.id, r.id)));
    if (!rooms.length) warnings.push(`${role.shortName}: activity "${a.label}" has no reachable destination rooms; it is never selected.`);
    candidates.set(a.id, rooms);
  }
  const activeActivities = role.activities.filter((a) => (candidates.get(a.id)?.length ?? 0) > 0);

  const st: PersonState = { t: start, pos: jitteredPoint(ctx, home, rng, config.positionJitterM * 0.6), roomId: home.id };
  tb.push(st.t, st.pos, 1);
  let atHome = true;

  const dwell = (room: Room, durationS: number, label: string) => {
    const s0 = st.t;
    const until = Math.min(end, st.t + durationS);
    // Long dwells include small repositioning within the room.
    while (st.t < until) {
      const hold = Math.min(until - st.t, rng.uniform(90, 300));
      emitStationary(tb, st, st.t + hold, dt);
      if (st.t >= until - 1) break;
      if (config.positionJitterM > 0 && until - st.t > 60) {
        const target = jitteredPoint(ctx, room, rng, config.positionJitterM);
        const g = ctx.grid.groupOf.get(room.id) ?? -1;
        // Both points are visible from the activity point; go via it if needed.
        const pts = lineOfSight(ctx.grid, st.pos, target, g) ? [st.pos, target] : [st.pos, ctx.activityPoint.get(room.id)!, target];
        walkPolyline(tb, st, pts, speed * 0.6, dt);
      }
    }
    spans.push({ staffId: member.id, startS: s0, endS: st.t, kind: 'dwell', label, roomId: room.id, fromRoomId: null, distanceM: 0 });
  };

  const travel = (to: Room, label: string): boolean => {
    if (to.id === st.roomId) return true;
    const target = jitteredPoint(ctx, to, rng, config.positionJitterM);
    // Cached activity-point-to-activity-point route, joined to the actual
    // start/end positions (both are visible from their room's activity point).
    const route = ctx.roomRoute(st.roomId, to.id);
    if (!route) {
      warnings.push(`${member.code}: no route from ${ctx.roomById.get(st.roomId)?.name ?? st.roomId} to ${to.name} ${to.number}.`);
      return false;
    }
    const s0 = st.t;
    const from = st.roomId;
    const pts = joinRoute(ctx, route.points, st.pos, target, ctx.grid.groupOf.get(from) ?? -1);
    walkPolyline(tb, st, pts, speed, dt);
    const distanceM = polylineLength(pts);
    st.roomId = to.id;
    spans.push({ staffId: member.id, startS: s0, endS: st.t, kind: 'walk', label, roomId: to.id, fromRoomId: from, distanceM });
    return true;
  };

  let guard = 0;
  while (st.t < end - 30 && guard++ < 5000) {
    const nextBreak = breaks[0];
    if (nextBreak && st.t >= nextBreak.at) {
      breaks.shift();
      if (travel(nextBreak.room!, nextBreak.def.label)) {
        dwell(nextBreak.room!, nextBreak.def.durationMin * 60 * rng.uniform(0.9, 1.15), nextBreak.def.label);
      }
      atHome = false;
      continue;
    }
    if (!atHome) {
      if (travel(home, 'Return to home base')) atHome = true;
      else break;
      continue;
    }
    // At home base: work locally, then pick an activity.
    const k = intensityAt(config, st.t);
    let homeS = (rng.triangular(role.homeDwell) * 60) / k;
    if (nextBreak) homeS = Math.min(homeS, Math.max(30, nextBreak.at - st.t));
    dwell(home, homeS, 'Work at home base');
    if (st.t >= end - 30) break;
    if (!activeActivities.length) continue;

    let activity: ActivityDef | null = pickActivity(activeActivities, rng);
    let chained = 0;
    while (activity && st.t < end - 30) {
      const dest = chooseDestination(ctx, st.roomId, candidates.get(activity.id)!, role.locality, rng);
      if (!dest || !travel(dest, activity.label)) break;
      atHome = dest.id === home.id;
      dwell(dest, rng.triangular(activity.dwell) * 60, activity.label);
      const breakDue = breaks[0] && st.t >= breaks[0].at;
      if (!breakDue && chained < 4 && rng.chance(activity.chainProbability)) {
        activity = pickActivity(activeActivities, rng);
        chained++;
      } else activity = null;
    }
  }

  // End of shift: return to home base, then stop tracking.
  if (st.roomId !== home.id) travel(home, 'Return to home base');
  if (st.t < end) emitStationary(tb, st, end, dt);
  return true;
}

/** Replace route endpoints with actual positions, skipping the activity point when visible. */
function joinRoute(ctx: SpatialContext, pts: Vec2[], start: Vec2, end: Vec2, originGroup: number): Vec2[] {
  const out = pts.slice();
  if (out.length >= 2 && lineOfSight(ctx.grid, start, out[1], originGroup)) out[0] = start;
  else if (dist(start, out[0]) > 1e-6) out.unshift(start);
  const n = out.length;
  if (n >= 2 && lineOfSight(ctx.grid, out[n - 2], end, originGroup)) out[n - 1] = end;
  else if (dist(end, out[n - 1]) > 1e-6) out.push(end);
  return out;
}

function pickActivity(acts: ActivityDef[], rng: Rng): ActivityDef | null {
  const i = rng.weighted(acts.map((a) => a.weight));
  return i >= 0 ? acts[i] : null;
}

function chooseDestination(ctx: SpatialContext, fromId: ID, rooms: Room[], locality: number, rng: Rng): Room | null {
  const opts = rooms.filter((r) => r.id !== fromId);
  const list = opts.length ? opts : rooms;
  const w = list.map((r) => {
    const d = ctx.roomDistance(fromId, r.id);
    return Number.isFinite(d) ? Math.pow(1 / (d + 6), locality) : 0;
  });
  const i = rng.weighted(w);
  return i >= 0 ? list[i] : null;
}

function nearestRoomOfTypes(ctx: SpatialContext, fromId: ID, types: string[], rng: Rng, locality: number): Room | null {
  return chooseDestination(ctx, fromId, ctx.roomsOfTypes(types), locality, rng);
}

function emitStationary(tb: TrackBuilder, st: PersonState, until: number, dt: number) {
  // Stationary samples at the regular interval (as a real 1 Hz tag would report).
  let t = st.t + dt;
  while (t < until) {
    tb.push(t, st.pos);
    t += dt;
  }
  st.t = until;
  tb.push(st.t, st.pos);
}

/** Walk along a polyline at constant speed, emitting samples every dt and at every corner. */
function walkPolyline(tb: TrackBuilder, st: PersonState, pts: Vec2[], speed: number, dt: number) {
  if (pts.length < 2) return;
  let t = st.t;
  let nextSample = t + dt;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L = dist(a, b);
    if (L < 1e-9) continue;
    const segT = L / speed;
    while (nextSample < t + segT) {
      const f = (nextSample - t) / segT;
      tb.push(nextSample, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      nextSample += dt;
    }
    t += segT;
    tb.push(t, b); // exact corner
  }
  st.t = t;
  st.pos = pts[pts.length - 1];
}
