/**
 * Memoised analytics for the active dataset and analysis window. The window
 * is debounced so dragging timeline handles does not recompute every frame.
 */
import { useEffect, useMemo, useState } from 'react';
import { analyzeTracks, DEFAULT_ANALYSIS_OPTIONS, type DatasetAnalysis } from '@/analytics/engine';
import { SpaceLocator } from '@/analytics/spaceLocator';
import type { SpatialModel, Track } from '@/domain/types';
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
