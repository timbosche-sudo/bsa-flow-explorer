/**
 * Memoised analytics for the active dataset and analysis window. The window
 * is debounced so dragging timeline handles does not recompute every frame.
 */
import { useEffect, useMemo, useState } from 'react';
import { analyzeTracks, DEFAULT_ANALYSIS_OPTIONS, type DatasetAnalysis } from '@/analytics/engine';
import { SpaceLocator } from '@/analytics/spaceLocator';
import type { SpatialModel, Track } from '@/domain/types';
import { accumulate, emptyGrid, finalize, smooth, type HeatGrid, type HeatMetric } from '@/analytics/heatmap';
import { analyzeCongestion, type CongestionResult } from '@/analytics/congestion';
import { clock } from './playback';
import { usePlayback } from './playback';
import { useProject } from './projectStore';
import { useActiveDataset } from './dataStore';
import { useUI } from './uiStore';

let locCache: { spatial: SpatialModel; loc: SpaceLocator } | null = null;
export function getLocator(spatial: SpatialModel) {
  if (locCache?.spatial !== spatial) locCache = { spatial, loc: new SpaceLocator(spatial) };
  return locCache.loc;
}

export function useDebouncedRange(delay = 220): [number, number] {
  const a = usePlayback((s) => s.rangeStart);
  const b = usePlayback((s) => s.rangeEnd);
  const [r, setR] = useState<[number, number]>([a, b]);
  useEffect(() => {
    const t = setTimeout(() => setR([a, b]), delay);
    return () => clearTimeout(t);
  }, [a, b, delay]);
  return r;
}

type Entry = { spatial: SpatialModel; roomTypes: unknown; res: DatasetAnalysis };
const cache = new WeakMap<Track[], Map<string, Entry>>();

export function analyzeCached(tracks: Track[], spatial: SpatialModel, roomTypes: Parameters<typeof analyzeTracks>[2], range: [number, number]) {
  let m = cache.get(tracks);
  if (!m) cache.set(tracks, (m = new Map()));
  const key = `${range[0]}|${range[1]}`;
  const hit = m.get(key);
  if (hit && hit.spatial === spatial && hit.roomTypes === roomTypes) return hit.res;
  const res = analyzeTracks(tracks, spatial, roomTypes, { ...DEFAULT_ANALYSIS_OPTIONS, range }, getLocator(spatial));
  if (m.size > 12) m.clear();
  m.set(key, { spatial, roomTypes, res });
  return res;
}

/** Analysis of the active dataset for the (debounced) time window and role/staff filters. */
export function useAnalysis(opts: { ignoreFilters?: boolean } = {}): DatasetAnalysis | null {
  const ds = useActiveDataset();
  const spatial = useProject((s) => s.project!.spatial);
  const roomTypes = useProject((s) => s.project!.roomTypes);
  const roleFilter = useUI((s) => s.roleFilter);
  const staffFilter = useUI((s) => s.staffFilter);
  const range = useDebouncedRange();
  const tracks = useMemo(() => {
    if (!ds) return null;
    if (opts.ignoreFilters || (!roleFilter.length && !staffFilter.length)) return ds.tracks;
    return ds.tracks.filter((t) => (!roleFilter.length || roleFilter.includes(t.roleId ?? '')) && (!staffFilter.length || staffFilter.includes(t.staffId)));
  }, [ds, roleFilter, staffFilter, opts.ignoreFilters]);
  return useMemo(() => {
    if (!tracks) return null;
    return analyzeCached(tracks, spatial, roomTypes, range);
  }, [tracks, spatial, roomTypes, range]);
}

// --- heatmaps & congestion -------------------------------------------------


export function useFilteredTracks(): Track[] | null {
  const ds = useActiveDataset();
  const roleFilter = useUI((s) => s.roleFilter);
  const staffFilter = useUI((s) => s.staffFilter);
  return useMemo(() => {
    if (!ds) return null;
    if (!roleFilter.length && !staffFilter.length) return ds.tracks;
    return ds.tracks.filter((t) => (!roleFilter.length || roleFilter.includes(t.roleId ?? '')) && (!staffFilter.length || staffFilter.includes(t.staffId)));
  }, [ds, roleFilter, staffFilter]);
}

const congCache = new WeakMap<Track[], Map<string, CongestionResult>>();
export function congestionCached(tracks: Track[], spatial: SpatialModel, range: [number, number], threshold: number): CongestionResult {
  let m = congCache.get(tracks);
  if (!m) congCache.set(tracks, (m = new Map()));
  const key = `${range[0]}|${range[1]}|${threshold}|${spatial === locCache?.spatial}`;
  let r = m.get(key);
  if (!r || !(spatial === locCache?.spatial)) {
    r = analyzeCongestion(tracks, spatial, getLocator(spatial), { range, stepS: 2, segmentM: 2, encounterRadiusM: 1.5, threshold });
    if (m.size > 8) m.clear();
    m.set(key, r);
  }
  return r;
}

export function useCongestion(): CongestionResult | null {
  const tracks = useFilteredTracks();
  const spatial = useProject((s) => s.project!.spatial);
  const threshold = useUI((s) => s.congestionThreshold);
  const range = useDebouncedRange();
  return useMemo(() => (tracks ? congestionCached(tracks, spatial, range, threshold) : null), [tracks, spatial, range, threshold]);
}

export interface HeatSpec {
  metric: HeatMetric;
  cellM: number;
  smoothingM: number;
  range: [number, number];
}

export function computeHeat(tracks: Track[], spatial: SpatialModel, spec: HeatSpec): HeatGrid {
  const loc = getLocator(spatial);
  const sensitive = new Set(spatial.rooms.filter((r) => r.sensitive).map((r) => r.id));
  const grid = emptyGrid(spatial, spec.cellM, loc, sensitive);
  if (spec.metric === 'encounters') {
    const c = congestionCached(tracks, spatial, spec.range, 3);
    for (const e of c.encounters) {
      const col = Math.floor((e.x - grid.originX) / grid.cell);
      const row = Math.floor((e.y - grid.originY) / grid.cell);
      if (col >= 0 && row >= 0 && col < grid.cols && row < grid.rows) grid.values[row * grid.cols + col] += 1;
    }
  } else {
    accumulate(grid, tracks, spec.metric, { range: spec.range, movingSpeedMps: DEFAULT_ANALYSIS_OPTIONS.movingSpeedMps, maxGapS: DEFAULT_ANALYSIS_OPTIONS.maxGapS });
  }
  smooth(grid, spec.smoothingM / spec.cellM);
  finalize(grid);
  return grid;
}

/** Heat grid for the current settings; follows playback when rolling is on. */
export function useHeatmap(): { grid: HeatGrid; metric: HeatMetric; range: [number, number]; staffHours: number } | null {
  const tracks = useFilteredTracks();
  const spatial = useProject((s) => s.project!.spatial);
  const hm = useUI((s) => s.heatmap);
  const range = useDebouncedRange();
  const [rollT, setRollT] = useState(clock.t);
  useEffect(() => {
    if (!hm.rolling) return;
    let last = 0;
    return clock.subscribe((t) => {
      const now = performance.now();
      if (now - last > 350) {
        last = now;
        setRollT(t);
      }
    });
  }, [hm.rolling]);
  const effRange: [number, number] = useMemo(
    () => (hm.rolling ? [Math.max(range[0], rollT - hm.rollingMinutes * 60), Math.max(range[0] + 1, rollT)] : range),
    [hm.rolling, hm.rollingMinutes, range, rollT],
  );
  return useMemo(() => {
    if (!tracks) return null;
    const grid = computeHeat(tracks, spatial, { metric: hm.metric, cellM: hm.cellM, smoothingM: hm.smoothingM, range: effRange });
    let staffS = 0;
    for (const t of tracks) {
      if (!t.t.length) continue;
      staffS += Math.max(0, Math.min(effRange[1], t.t[t.t.length - 1]) - Math.max(effRange[0], t.t[0]));
    }
    return { grid, metric: hm.metric, range: effRange, staffHours: staffS / 3600 };
  }, [tracks, spatial, hm.metric, hm.cellM, hm.smoothingM, effRange]);
}
