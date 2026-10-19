/**
 * Navigation grid.
 *
 * The walkable model is rasterised into a uniform occupancy grid in world
 * meters. Each walkable cell belongs to exactly one "space" (a room or a
 * circulation area). Rooms take priority over circulation where polygons
 * overlap; obstacles block cells.
 *
 * Spaces are grouped for the purpose of wall-crossing: every room is its own
 * group, while ALL circulation areas share a single group (overlapping or
 * abutting corridor polygons merge into one walkable network).
 *
 * Moving between two adjacent cells of different groups is allowed ONLY
 * through a door: both cells must lie within the same door's footprint and
 * that door must connect exactly those two groups. This is what prevents
 * routes from passing through walls between adjacent spaces.
 *
 * Shortest paths are found with A* (8-connected, no corner cutting) and then
 * shortened by line-of-sight string pulling, which yields near-geodesic
 * polylines whose lengths are used as travel distances.
 */
import type { Door, ID, SpatialModel, Vec2 } from '@/domain/types';
import { bbox, interiorPoint, nearestEdge, pointInPolygon, unionBBox } from '@/geometry/polygon';
import { dist, polylineLength } from '@/geometry/vec';
import { MinHeap } from './heap';

export type SpaceKind = 'room' | 'circulation';

export interface SpaceRef {
  kind: SpaceKind;
  id: ID;
  group: number;
}

export interface DoorRef {
  id: ID;
  /** The two groups connected by this door, or null if the door is invalid. */
  groups: [number, number] | null;
  /** Group a one-way door may be entered from (null = two-way). */
  oneWayFromGroup: number | null;
  center: Vec2;
  /** Unit vector along the wall. */
  along: Vec2;
  spaceIds: [ID | null, ID | null];
  problem: string | null;
}

export interface NavGrid {
  originX: number;
  originY: number;
  cell: number;
  cols: number;
  rows: number;
  /** Space index per cell, -1 = not walkable. */
  space: Int32Array;
  /** Door index per cell, -1 = none. */
  door: Int32Array;
  spaces: SpaceRef[];
  doors: DoorRef[];
  /** Group index per space id. */
  groupOf: Map<ID, number>;
  restrictedGroups: Set<number>;
  circulationGroup: number;
  roomGroup: Map<ID, number>;
  groupRoom: (ID | null)[];
  /**
   * Precomputed 8-neighbour move mask per cell (bit k = NEI[k] allowed),
   * ignoring the origin-dependent no-through-traffic rule.
   */
  nbMask: Uint8Array;
  /** Group index per cell (-1 = blocked). */
  cellGroup: Int32Array;
}

const DOOR_DEPTH_M = 0.45;

export interface NavGridOptions {
  cellSize?: number;
  margin?: number;
}

export function chooseCellSize(spatial: SpatialModel): number {
  const polys = [...spatial.rooms.map((r) => r.polygon), ...spatial.circulation.map((c) => c.polygon)];
  const b = unionBBox(polys.filter((p) => p.length >= 3).map(bbox));
  if (!b) return 0.2;
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  // ~0.2 m for clinic-scale plans; coarser for very large plans to bound memory.
  return Math.max(0.15, Math.min(0.5, extent / 500));
}

export function buildNavGrid(spatial: SpatialModel, opts: NavGridOptions = {}): NavGrid {
  const cell = opts.cellSize ?? chooseCellSize(spatial);
  const margin = opts.margin ?? 1;
  const rooms = spatial.rooms.filter((r) => r.polygon.length >= 3);
  const circ = spatial.circulation.filter((c) => c.polygon.length >= 3);
  const all = [...rooms.map((r) => r.polygon), ...circ.map((c) => c.polygon)];
  const b = unionBBox(all.map(bbox)) ?? { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const originX = b.minX - margin;
  const originY = b.minY - margin;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX + 2 * margin) / cell));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY + 2 * margin) / cell));
  const n = cols * rows;
  const space = new Int32Array(n).fill(-1);
  const doorArr = new Int32Array(n).fill(-1);

  const spaces: SpaceRef[] = [];
  const groupOf = new Map<ID, number>();
  const roomGroup = new Map<ID, number>();
  const groupRoom: (ID | null)[] = [];
  const restrictedGroups = new Set<number>();
  // Group 0 is reserved for circulation.
  const circulationGroup = 0;
  groupRoom.push(null);
  for (const c of circ) {
    groupOf.set(c.id, circulationGroup);
    spaces.push({ kind: 'circulation', id: c.id, group: circulationGroup });
  }
  for (const r of rooms) {
    const g = groupRoom.length;
    groupRoom.push(r.id);
    groupOf.set(r.id, g);
    roomGroup.set(r.id, g);
    if (r.restricted) restrictedGroups.add(g);
    spaces.push({ kind: 'room', id: r.id, group: g });
  }

  // Rasterise: circulation first, rooms overwrite (rooms take priority).
  const rasterise = (poly: Vec2[], spaceIndex: number) => {
    const pb = bbox(poly);
    const c0 = Math.max(0, Math.floor((pb.minX - originX) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((pb.maxX - originX) / cell));
    const r0 = Math.max(0, Math.floor((pb.minY - originY) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((pb.maxY - originY) / cell));
    for (let r = r0; r <= r1; r++) {
      const cy = originY + (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const cx = originX + (c + 0.5) * cell;
        if (pointInPolygon({ x: cx, y: cy }, poly)) space[r * cols + c] = spaceIndex;
      }
    }
  };
  circ.forEach((c, i) => rasterise(c.polygon, i));
  rooms.forEach((r, i) => rasterise(r.polygon, circ.length + i));

  // Obstacles block.
  for (const o of spatial.obstacles) {
    if (o.polygon.length < 3) continue;
    const pb = bbox(o.polygon);
    const c0 = Math.max(0, Math.floor((pb.minX - originX) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((pb.maxX - originX) / cell));
    const r0 = Math.max(0, Math.floor((pb.minY - originY) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((pb.maxY - originY) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const p = { x: originX + (c + 0.5) * cell, y: originY + (r + 0.5) * cell };
        if (pointInPolygon(p, o.polygon)) space[r * cols + c] = -1;
      }
    }
  }

  const grid: NavGrid = {
    originX,
    originY,
    cell,
    cols,
    rows,
    space,
    door: doorArr,
    spaces,
    doors: [],
    groupOf,
    restrictedGroups,
    circulationGroup,
    roomGroup,
    groupRoom,
    nbMask: new Uint8Array(n),
    cellGroup: new Int32Array(n).fill(-1),
  };

  // Doors.
  const polys: { id: ID; poly: Vec2[] }[] = [
    ...rooms.map((r) => ({ id: r.id, poly: r.polygon })),
    ...circ.map((c) => ({ id: c.id, poly: c.polygon })),
  ];
  spatial.doors.forEach((d, di) => {
    const ref = resolveDoor(d, polys, grid);
    grid.doors.push(ref);
    if (!ref.groups) return;
    // Mark the door footprint: a rectangle |along| <= w/2, |across| <= depth.
    const half = d.widthM / 2;
    const reach = Math.max(half, DOOR_DEPTH_M) + cell;
    const c0 = Math.max(0, Math.floor((d.position.x - reach - originX) / cell));
    const c1 = Math.min(cols - 1, Math.ceil((d.position.x + reach - originX) / cell));
    const r0 = Math.max(0, Math.floor((d.position.y - reach - originY) / cell));
    const r1 = Math.min(rows - 1, Math.ceil((d.position.y + reach - originY) / cell));
    const nrm = { x: -ref.along.y, y: ref.along.x };
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = r * cols + c;
        const s = space[idx];
        if (s < 0) continue;
        const g = spaces[s].group;
        if (g !== ref.groups[0] && g !== ref.groups[1]) continue;
        const px = originX + (c + 0.5) * cell - d.position.x;
        const py = originY + (r + 0.5) * cell - d.position.y;
        const a = Math.abs(px * ref.along.x + py * ref.along.y);
        const q = Math.abs(px * nrm.x + py * nrm.y);
        if (a <= half && q <= DOOR_DEPTH_M) doorArr[idx] = di;
      }
    }
  });

  computeMasks(grid);
  return grid;
}

function computeMasks(grid: NavGrid) {
  const { cols, rows } = grid;
  for (let i = 0; i < cols * rows; i++) {
    const sp = grid.space[i];
    grid.cellGroup[i] = sp >= 0 ? grid.spaces[sp].group : -1;
  }
  const NO_ORIGIN = -2; // ignore restriction rule while precomputing
  for (let idx = 0; idx < cols * rows; idx++) {
    if (grid.space[idx] < 0) continue;
    const c = idx % cols;
    const r = (idx - c) / cols;
    let m = 0;
    for (let k = 0; k < 8; k++) {
      const [dc, dr] = NEI[k];
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const nb = nr * cols + nc;
      if (!stepRaw(grid, idx, nb, NO_ORIGIN, true)) continue;
      if (dc !== 0 && dr !== 0) {
        const h = r * cols + nc;
        const v2 = nr * cols + c;
        if (!stepRaw(grid, idx, h, NO_ORIGIN, true) || !stepRaw(grid, h, nb, NO_ORIGIN, true)) continue;
        if (!stepRaw(grid, idx, v2, NO_ORIGIN, true) || !stepRaw(grid, v2, nb, NO_ORIGIN, true)) continue;
      }
      m |= 1 << k;
    }
    grid.nbMask[idx] = m;
  }
}

function resolveDoor(d: Door, polys: { id: ID; poly: Vec2[] }[], grid: NavGrid): DoorRef {
  // Find nearest wall edge across all spaces to derive the wall direction.
  let best: { d: number; a: Vec2; b: Vec2 } | null = null;
  for (const { poly } of polys) {
    const e = nearestEdge(d.position, poly);
    if (e.index >= 0 && (!best || e.d < best.d)) {
      best = { d: e.d, a: poly[e.index], b: poly[(e.index + 1) % poly.length] };
    }
  }
  const base: DoorRef = {
    id: d.id,
    groups: null,
    oneWayFromGroup: null,
    center: d.position,
    along: { x: 1, y: 0 },
    spaceIds: [null, null],
    problem: null,
  };
  if (!best || best.d > 0.6) return { ...base, problem: 'Door is not on a wall of any defined space' };
  const L = dist(best.a, best.b) || 1;
  const along = { x: (best.b.x - best.a.x) / L, y: (best.b.y - best.a.y) / L };
  const nrm = { x: -along.y, y: along.x };
  const probe = (s: number) => spaceIdAtPoint(grid, { x: d.position.x + nrm.x * s, y: d.position.y + nrm.y * s });
  const sA = probe(0.35) ?? probe(0.6);
  const sB = probe(-0.35) ?? probe(-0.6);
  const ref = { ...base, along, spaceIds: [sA, sB] as [ID | null, ID | null] };
  if (!sA || !sB) return { ...ref, problem: 'Door opens onto an undefined (non-walkable) area' };
  const gA = grid.groupOf.get(sA)!;
  const gB = grid.groupOf.get(sB)!;
  if (gA === gB) return { ...ref, problem: 'Door connects a space to itself' };
  let oneWayFromGroup: number | null = null;
  if (d.oneWayFromSpaceId) oneWayFromGroup = grid.groupOf.get(d.oneWayFromSpaceId) ?? null;
  return { ...ref, groups: [gA, gB], oneWayFromGroup };
}

function spaceIdAtPoint(grid: NavGrid, p: Vec2): ID | null {
  const idx = cellIndex(grid, p);
  if (idx < 0) return null;
  const s = grid.space[idx];
  return s >= 0 ? grid.spaces[s].id : null;
}

export function cellIndex(grid: NavGrid, p: Vec2): number {
  const c = Math.floor((p.x - grid.originX) / grid.cell);
  const r = Math.floor((p.y - grid.originY) / grid.cell);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return -1;
  return r * grid.cols + c;
}

export const cellCenter = (grid: NavGrid, idx: number): Vec2 => ({
  x: grid.originX + ((idx % grid.cols) + 0.5) * grid.cell,
  y: grid.originY + (Math.floor(idx / grid.cols) + 0.5) * grid.cell,
});

export const groupOfCell = (grid: NavGrid, idx: number) => {
  const s = grid.space[idx];
  return s >= 0 ? grid.spaces[s].group : -1;
};

function stepRaw(grid: NavGrid, a: number, b: number, originGroup: number, ignoreRestriction = false): boolean {
  const sb = grid.space[b];
  if (sb < 0 || grid.space[a] < 0) return false;
  const ga = grid.spaces[grid.space[a]].group;
  const gb = grid.spaces[sb].group;
  if (ga === gb) return true;
  // Leaving a restricted room is only permitted from the route origin.
  if (!ignoreRestriction && grid.restrictedGroups.has(ga) && ga !== originGroup) return false;
  const da = grid.door[a];
  if (da < 0 || da !== grid.door[b]) return false;
  const door = grid.doors[da];
  if (!door.groups) return false;
  const [g0, g1] = door.groups;
  if (!((ga === g0 && gb === g1) || (ga === g1 && gb === g0))) return false;
  if (door.oneWayFromGroup !== null && door.oneWayFromGroup !== ga) return false;
  return true;
}

/**
 * Can one step from cell a to adjacent cell b?
 * `originGroup` is exempt from the no-through-traffic restriction.
 */
export function canStep(grid: NavGrid, a: number, b: number, originGroup: number): boolean {
  return stepRaw(grid, a, b, originGroup);
}

/** Restriction check for leaving cell a's group into cell b's group. */
function leaves(grid: NavGrid, a: number, b: number, originGroup: number): boolean {
  const ga = grid.cellGroup[a];
  if (ga === originGroup || grid.cellGroup[b] === ga || !grid.restrictedGroups.has(ga)) return true;
  return false;
}

const NEI = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

function forEachNeighbor(
  grid: NavGrid,
  idx: number,
  originGroup: number,
  fn: (nb: number, cost: number) => void,
) {
  const m = grid.nbMask[idx];
  if (!m) return;
  const cols = grid.cols;
  for (let k = 0; k < 8; k++) {
    if (!(m & (1 << k))) continue;
    const nb = idx + NEI[k][1] * cols + NEI[k][0];
    if (!leaves(grid, idx, nb, originGroup)) continue;
    fn(nb, NEI[k][2] * grid.cell);
  }
}

/** Fast adjacency check using the precomputed mask (a, b must be 8-adjacent). */
function maskStep(grid: NavGrid, a: number, b: number, originGroup: number): boolean {
  const cols = grid.cols;
  const dc = (b % cols) - (a % cols);
  const dr = Math.floor(b / cols) - Math.floor(a / cols);
  for (let k = 0; k < 8; k++) {
    if (NEI[k][0] === dc && NEI[k][1] === dr) {
      return (grid.nbMask[a] & (1 << k)) !== 0 && leaves(grid, a, b, originGroup);
    }
  }
  return false;
}

/**
 * Snap a point to the nearest walkable cell, preferring cells of `preferSpace`.
 * Returns -1 if nothing walkable within `maxRadius` meters.
 */
export function snapToWalkable(grid: NavGrid, p: Vec2, preferSpaceId?: ID | null, maxRadius = 1.5): number {
  const idx = cellIndex(grid, p);
  const prefer = preferSpaceId != null ? grid.spaces.findIndex((s) => s.id === preferSpaceId) : -1;
  if (idx >= 0 && grid.space[idx] >= 0 && (prefer < 0 || grid.space[idx] === prefer)) return idx;
  const c0 = Math.floor((p.x - grid.originX) / grid.cell);
  const r0 = Math.floor((p.y - grid.originY) / grid.cell);
  const R = Math.ceil(maxRadius / grid.cell);
  let best = -1;
  let bestD = Infinity;
  for (let dr = -R; dr <= R; dr++) {
    for (let dc = -R; dc <= R; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const i = r * grid.cols + c;
      const s = grid.space[i];
      if (s < 0 || (prefer >= 0 && s !== prefer)) continue;
      const d = dc * dc + dr * dr;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

export interface Route {
  points: Vec2[];
  lengthM: number;
  /** Space ids traversed in order (deduplicated consecutive). */
  spaceSequence: ID[];
}

/** A* between two world points. Returns null if unreachable. */
export function findRoute(
  grid: NavGrid,
  from: Vec2,
  to: Vec2,
  fromSpaceId?: ID | null,
  toSpaceId?: ID | null,
): Route | null {
  const s = snapToWalkable(grid, from, fromSpaceId);
  const t = snapToWalkable(grid, to, toSpaceId);
  if (s < 0 || t < 0) return null;
  const originGroup = groupOfCell(grid, s);
  const n = grid.cols * grid.rows;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap(4096);
  const tc = cellCenter(grid, t);
  const h = (i: number) => {
    const p = cellCenter(grid, i);
    return Math.hypot(p.x - tc.x, p.y - tc.y);
  };
  g[s] = 0;
  heap.push(s, h(s));
  let found = false;
  while (heap.size) {
    const cur = heap.pop()!;
    if (closed[cur]) continue;
    if (cur === t) {
      found = true;
      break;
    }
    closed[cur] = 1;
    forEachNeighbor(grid, cur, originGroup, (nb, w) => {
      if (closed[nb]) return;
      const ng = g[cur] + w;
      if (ng < g[nb]) {
        g[nb] = ng;
        came[nb] = cur;
        heap.push(nb, ng + h(nb));
      }
    });
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = t; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  // Use the original endpoints when they lie in their snapped cells; otherwise
  // (point on a wall line or outside) start/end at the snapped cell centre.
  const start = cellIndex(grid, from) === s ? from : cellCenter(grid, s);
  const end = cellIndex(grid, to) === t ? to : cellCenter(grid, t);
  const raw: Vec2[] = [start, ...cells.slice(1, -1).map((c) => cellCenter(grid, c)), end];
  const pts = smoothPath(grid, raw, originGroup);
  const seq: ID[] = [];
  for (const c of cells) {
    const id = grid.spaces[grid.space[c]].id;
    if (seq[seq.length - 1] !== id) seq.push(id);
  }
  return { points: pts, lengthM: polylineLength(pts), spaceSequence: seq };
}

/** Is the straight segment a->b traversable on the grid? */
export function lineOfSight(grid: NavGrid, a: Vec2, b: Vec2, originGroup: number): boolean {
  const L = dist(a, b);
  const step = grid.cell * 0.25;
  const n = Math.max(1, Math.ceil(L / step));
  let prev = cellIndex(grid, a);
  if (prev < 0 || grid.space[prev] < 0) return false;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const cur = cellIndex(grid, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (cur === prev) continue;
    if (cur < 0) return false;
    const pc = prev % grid.cols;
    const pr = (prev - pc) / grid.cols;
    const cc = cur % grid.cols;
    const cr = (cur - cc) / grid.cols;
    if (Math.abs(pc - cc) > 1 || Math.abs(pr - cr) > 1) return false; // should not happen with small steps
    if (Math.abs(pc - cc) + Math.abs(pr - cr) === 2) {
      // A thin line crossing a cell corner: require both orthogonal routes (no wall corners).
      const h = pr * grid.cols + cc;
      const v2 = cr * grid.cols + pc;
      if (grid.space[h] < 0 || grid.space[v2] < 0) return false;
      if (!(maskStep(grid, prev, h, originGroup) && maskStep(grid, h, cur, originGroup))) return false;
      if (!(maskStep(grid, prev, v2, originGroup) && maskStep(grid, v2, cur, originGroup))) return false;
    } else if (!maskStep(grid, prev, cur, originGroup)) return false;
    prev = cur;
  }
  return true;
}

/**
 * String pulling: advance from an anchor while line of sight holds, then
 * re-anchor at the last visible point (O(n·L)). A second greedy
 * "furthest visible" pass over the reduced polyline removes leftover kinks.
 */
export function smoothPath(grid: NavGrid, pts: Vec2[], originGroup: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const pass1: Vec2[] = [pts[0]];
  let anchor = 0;
  for (let j = 2; j < pts.length; j++) {
    if (!lineOfSight(grid, pts[anchor], pts[j], originGroup)) {
      anchor = j - 1;
      pass1.push(pts[anchor]);
    }
  }
  pass1.push(pts[pts.length - 1]);
  if (pass1.length <= 2) return pass1;
  const out: Vec2[] = [pass1[0]];
  let i = 0;
  while (i < pass1.length - 1) {
    let j = pass1.length - 1;
    while (j > i + 1 && !lineOfSight(grid, pass1[i], pass1[j], originGroup)) j--;
    out.push(pass1[j]);
    i = j;
  }
  return out;
}

/** Dijkstra distance field (meters along grid) from a point to every cell. */
export function distanceField(grid: NavGrid, from: Vec2, fromSpaceId?: ID | null): Float32Array {
  const n = grid.cols * grid.rows;
  const d = new Float32Array(n).fill(Infinity);
  const s = snapToWalkable(grid, from, fromSpaceId);
  if (s < 0) return d;
  const originGroup = groupOfCell(grid, s);
  const heap = new MinHeap();
  d[s] = 0;
  heap.push(s, 0);
  const closed = new Uint8Array(n);
  while (heap.size) {
    const cur = heap.pop()!;
    if (closed[cur]) continue;
    closed[cur] = 1;
    forEachNeighbor(grid, cur, originGroup, (nb, w) => {
      const nd = d[cur] + w;
      if (nd < d[nb]) {
        d[nb] = nd;
        heap.push(nb, nd);
      }
    });
  }
  return d;
}

/** Default activity point for a room: user point if set, else an interior point. */
export function roomActivityPoint(room: { polygon: Vec2[]; activityPoint: Vec2 | null }): Vec2 {
  return room.activityPoint ?? interiorPoint(room.polygon);
}
