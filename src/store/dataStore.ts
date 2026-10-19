/**
 * Movement datasets in memory: the current simulation result (regenerated
 * deterministically from project settings + seed) and imported observed
 * datasets. Simulated and observed data are never merged.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { DatasetMeta, ID, ObservedDataset, Project, SimActivitySpan, SimulationResult, Track } from '@/domain/types';
import { simulationHash, type SimulationInput } from '@/simulation/engine';
import { runSimulationAsync } from '@/services/simulationService';

export type ActiveDatasetId = 'simulation' | ID;

export interface ActiveDataset {
  meta: DatasetMeta;
  tracks: Track[];
  /** Ground-truth activity spans (simulation only). */
  spans: SimActivitySpan[] | null;
}

interface DataState {
  simulation: SimulationResult | null;
  simStatus: 'idle' | 'running' | 'ready' | 'error';
  simError: string | null;
  observed: Record<ID, ObservedDataset>;
  activeId: ActiveDatasetId;
  /** Optional secondary dataset for comparison. */
  compareId: ActiveDatasetId | null;
  runSimulation: (p: Project) => Promise<void>;
  clearSimulation: () => void;
  addObserved: (d: ObservedDataset) => void;
  removeObserved: (id: ID) => void;
  setObserved: (all: Record<ID, ObservedDataset>) => void;
  setActive: (id: ActiveDatasetId) => void;
  setCompare: (id: ActiveDatasetId | null) => void;
}

export const simInputOf = (p: Project): SimulationInput => ({
  spatial: p.spatial,
  roles: p.roles,
  staff: p.staff,
  config: p.simulation,
});

let runToken = 0;

export const useData = create<DataState>((set, get) => ({
  simulation: null,
  simStatus: 'idle',
  simError: null,
  observed: {},
  activeId: 'simulation',
  compareId: null,
  runSimulation: async (p) => {
    const token = ++runToken;
    set({ simStatus: 'running', simError: null });
    try {
      const result = await runSimulationAsync(simInputOf(p));
      if (token !== runToken) return;
      set({ simulation: result, simStatus: 'ready' });
    } catch (e) {
      if (token !== runToken) return;
      set({ simStatus: 'error', simError: e instanceof Error ? e.message : String(e) });
    }
  },
  clearSimulation: () => set({ simulation: null, simStatus: 'idle' }),
  addObserved: (d) => set({ observed: { ...get().observed, [d.meta.id]: d } }),
  removeObserved: (id) => {
    const o = { ...get().observed };
    delete o[id];
    set({ observed: o, activeId: get().activeId === id ? 'simulation' : get().activeId });
  },
  setObserved: (observed) => set({ observed }),
  setActive: (activeId) => set({ activeId }),
  setCompare: (compareId) => set({ compareId }),
}));

export function getActiveDataset(s: Pick<DataState, 'activeId' | 'simulation' | 'observed'>, id: ActiveDatasetId = s.activeId): ActiveDataset | null {
  if (id === 'simulation') {
    return s.simulation ? { meta: s.simulation.meta, tracks: s.simulation.tracks, spans: s.simulation.spans } : null;
  }
  const o = s.observed[id];
  return o ? { meta: o.meta, tracks: o.cleanTracks, spans: null } : null;
}

export function useActiveDataset(): ActiveDataset | null {
  const activeId = useData((s) => s.activeId);
  const simulation = useData((s) => s.simulation);
  const observed = useData((s) => s.observed);
  return useMemo(() => getActiveDataset({ activeId, simulation, observed }), [activeId, simulation, observed]);
}

/** True when project inputs no longer match the last simulation run. */
export function isSimulationStale(p: Project, sim: SimulationResult | null): boolean {
  if (!sim) return true;
  return simulationHash(simInputOf(p)) !== sim.configHash;
}
