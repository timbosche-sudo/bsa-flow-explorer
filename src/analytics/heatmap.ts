/**
 * Spatial heatmaps.
 *
 * METRICS (different questions — not interchangeable):
 *  - presence:   person-time spent in each cell, including stationary time.
 *                "Where are tracked staff?"
 *  - movement:   person-time spent in each cell while moving (speed >=
 *                threshold). "Where does walking happen?" (movement density)
 *  - frequency:  number of distinct passes through each cell while moving
 *                (re-entries within 10 s are not counted again).
 *                "Which circulation routes are used most often?"
 *  - encounters: locations where two tracked people came within the
 *                encounter radius (see congestion.ts).
 *
 * None of these measure congestion or obstruction directly.
 */
import type { SpatialModel, Track } from '@/domain/types';
import { bbox, unionBBox } from '@/geometry/polygon';
import { sliceTrack } from './trackUtils';
import type { SpaceLocator } from './spaceLocator';

export type HeatMetric = 'presence' | 'movement' | 'frequency' | 'encounters';

export interface HeatGrid {
  originX: number;
  originY: number;
  cell: number;
  cols: number;
  rows: number;
  values: Float32Array;
  /** 1 where the cell centre lies in a walkable, non-sensitive space. */
  mask: Uint8Array;
  max: number;
  total: number;
}

export function emptyGrid(spatial: SpatialModel, cell: number, locator: SpaceLocator, sensitiveIds: Set<string>): HeatGrid {
  const polys = [...spatial.rooms.map((r) => r.polygon), ...spatial.circulation.map((c) => c.polygon)].filter((p) => p.length >= 3);
  const b = unionBBox(polys.map(bbox)) ?? { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const originX = b.minX - cell;
  const originY = b.minY - cell;
  const cols = Math.ceil((b.maxX - b.minX) / cell) + 2;
  const rows = Math.ceil((b.maxY - b.minY) / cell) + 2;
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const si = locator.locate(originX + (c + 0.5) * cell, originY + (r + 0.5) * cell);
      mask[r * cols + c] = si >= 0 && !sensitiveIds.has(locator.spaces[si].id) ? 1 : 0;
    }
  }
  return { originX, originY, cell, cols, rows, values: new Float32Array(cols * rows), mask, max: 0, total: 0 };
}

export interface HeatOptions {
  range: [number, number];
  movingSpeedMps: number;
  maxGapS: number;
}

export function accumulate(grid: HeatGrid, tracks: Track[], metric: Exclude<HeatMetric, 'encounters'>, o: HeatOptions) {
  const { cell, cols, rows, originX, originY, values } = grid;
  const half = cell / 2;
  for (const full of tracks) {
    const tr = sliceTrack(full, o.range[0], o.range[1]);
    const lastPass = new Map<number, number>();
    let lastCell = -1;
    for (let i = 1; i < tr.t.length; i++) {
      const dt = tr.t[i] - tr.t[i - 1];
      if (tr.gap[i] || dt <= 0 || dt > o.maxGapS) {
        lastCell = -1;
        continue;
      }
      const x0 = tr.x[i - 1];
      const y0 = tr.y[i - 1];
      const dx = tr.x[i] - x0;
      const dy = tr.y[i] - y0;
      const d = Math.hypot(dx, dy);
      const moving = d / dt >= o.movingSpeedMps;
      if (metric !== 'presence' && !moving) {
        lastCell = -1;
        continue;
      }
      const steps = Math.max(1, Math.ceil(d / half));
      const w = dt / steps;
      for (let k = 0; k < steps; k++) {
        const f = (k + 0.5) / steps;
        const c = Math.floor((x0 + dx * f - originX) / cell);
        const r = Math.floor((y0 + dy * f - originY) / cell);
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const idx = r * cols + c;
        if (metric === 'frequency') {
          if (idx !== lastCell) {
            const lp = lastPass.get(idx);
            const now = tr.t[i - 1] + dt * f;
            if (lp === undefined || now - lp > 10) values[idx] += 1;
            lastPass.set(idx, now);
            lastCell = idx;
          }
        } else {
          values[idx] += w;
        }
      }
    }
  }
}

/** Separable Gaussian blur (sigma in cells), constrained to the walkable mask. */
export function smooth(grid: HeatGrid, sigmaCells: number) {
  if (sigmaCells < 0.3) return;
  const { cols, rows, values, mask } = grid;
  const R = Math.ceil(sigmaCells * 2.5);
  const k = new Float32Array(2 * R + 1);
  let ks = 0;
  for (let i = -R; i <= R; i++) ks += k[i + R] = Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells));
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float32Array(values.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let j = -R; j <= R; j++) {
        const cc = c + j;
        if (cc >= 0 && cc < cols) s += values[r * cols + cc] * k[j + R];
      }
      tmp[r * cols + c] = s;
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let s = 0;
      for (let j = -R; j <= R; j++) {
        const rr = r + j;
        if (rr >= 0 && rr < rows) s += tmp[rr * cols + c] * k[j + R];
      }
      values[r * cols + c] = mask[r * cols + c] ? s : 0;
    }
  }
}

export function finalize(grid: HeatGrid) {
  let max = 0;
  let total = 0;
  for (let i = 0; i < grid.values.length; i++) {
    if (!grid.mask[i]) grid.values[i] = 0;
    const v = grid.values[i];
    total += v;
    if (v > max) max = v;
  }
  grid.max = max;
  grid.total = total;
}

export interface HeatResult {
  grid: HeatGrid;
  metric: HeatMetric;
  /** Raw-unit description for the legend. */
  unitLabel: string;
  staffCount: number;
  hours: number;
}

export function unitFor(metric: HeatMetric, normalization: 'absolute' | 'relative' | 'per-staff-hour', cell: number): string {
  const area = `${cell.toFixed(2)} m cell`;
  if (normalization === 'relative') return 'Relative to peak cell in view (0–100%)';
  const base =
    metric === 'presence' || metric === 'movement' ? 'person-minutes' : metric === 'frequency' ? 'passes' : 'encounters';
  return normalization === 'per-staff-hour' ? `${base} per tracked staff-hour, per ${area}` : `${base} per ${area}`;
}

/** Value displayed for a cell given the normalization mode. */
export function displayValue(v: number, metric: HeatMetric, normalization: 'absolute' | 'relative' | 'per-staff-hour', max: number, staffHours: number): number {
  if (normalization === 'relative') return max > 0 ? v / max : 0;
  const base = metric === 'presence' || metric === 'movement' ? v / 60 : v;
  return normalization === 'per-staff-hour' ? base / Math.max(1e-9, staffHours) : base;
}
