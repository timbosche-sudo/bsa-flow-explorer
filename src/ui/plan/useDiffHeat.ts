/**
 * Comparison inputs: dataset/time-window "B" relative to the active
 * dataset/window "A", and a per-staff-hour normalized movement-density
 * difference map.
 */
import { useMemo } from 'react';
import type { Track } from '@/domain/types';
import type { HeatGrid } from '@/analytics/heatmap';
import { useUI } from '@/store/uiStore';
import { useProject } from '@/store/projectStore';
import { getActiveDataset, useData, type ActiveDataset } from '@/store/dataStore';
import { computeHeat, useDebouncedRange, useFilteredTracks } from '@/store/analysis';

export interface DiffResult {
  grid: HeatGrid;
  maxAbs: number;
}

export interface CompareSide {
  label: string;
  dataset: ActiveDataset;
  tracks: Track[];
  range: [number, number];
}

const staffHours = (tracks: Track[], r: [number, number]) =>
  tracks.reduce((s, t) => (t.t.length ? s + Math.max(0, Math.min(r[1], t.t[t.t.length - 1]) - Math.max(r[0], t.t[0])) : s), 0) / 3600;

export function useCompareSides(): { a: CompareSide; b: CompareSide } | null {
  const cmp = useUI((s) => s.compare);
  const roleFilter = useUI((s) => s.roleFilter);
  const data = useData();
  const tracksA = useFilteredTracks();
  const rangeA = useDebouncedRange();
  return useMemo(() => {
    const dsA = getActiveDataset(data);
    if (!dsA || !tracksA) return null;
    let dsB = dsA;
    let rangeB: [number, number] = [cmp.bStart, cmp.bEnd];
    if (cmp.mode === 'datasets') {
      const other = cmp.bDataset ? getActiveDataset(data, cmp.bDataset) : null;
      if (!other) return null;
      dsB = other;
      rangeB = rangeA;
    }
    const tracksB = roleFilter.length ? dsB.tracks.filter((t) => roleFilter.includes(t.roleId ?? '')) : dsB.tracks;
    const fmt = (r: [number, number]) => `${Math.floor(r[0] / 3600)}:${String(Math.floor((r[0] % 3600) / 60)).padStart(2, '0')}–${Math.floor(r[1] / 3600)}:${String(Math.floor((r[1] % 3600) / 60)).padStart(2, '0')}`;
    const label = (d: ActiveDataset, r: [number, number]) => (cmp.mode === 'datasets' ? `${d.meta.kind === 'simulated' ? 'SIM' : 'OBS'} ${d.meta.name}` : fmt(r));
    return {
      a: { label: label(dsA, rangeA), dataset: dsA, tracks: tracksA, range: rangeA },
      b: { label: label(dsB, rangeB), dataset: dsB, tracks: tracksB, range: rangeB },
    };
  }, [cmp.mode, cmp.bStart, cmp.bEnd, cmp.bDataset, data, tracksA, rangeA, roleFilter]);
}

export function useDiffHeat(sides: { a: CompareSide; b: CompareSide } | null, enabled: boolean): DiffResult | null {
  const spatial = useProject((s) => s.project!.spatial);
  const hm = useUI((s) => s.heatmap);
  return useMemo(() => {
    if (!sides || !enabled) return null;
    const spec = { metric: 'movement' as const, cellM: hm.cellM, smoothingM: Math.max(0.8, hm.smoothingM) };
    const A = computeHeat(sides.a.tracks, spatial, { ...spec, range: sides.a.range });
    const B = computeHeat(sides.b.tracks, spatial, { ...spec, range: sides.b.range });
    const ha = Math.max(1e-6, staffHours(sides.a.tracks, sides.a.range));
    const hb = Math.max(1e-6, staffHours(sides.b.tracks, sides.b.range));
    const values = new Float32Array(A.values.length);
    let maxAbs = 0;
    for (let i = 0; i < values.length; i++) {
      values[i] = B.values[i] / hb - A.values[i] / ha;
      maxAbs = Math.max(maxAbs, Math.abs(values[i]));
    }
    return { grid: { ...A, values, max: maxAbs, total: 0 }, maxAbs: maxAbs || 1 };
  }, [sides, enabled, spatial, hm.cellM, hm.smoothingM]);
}
