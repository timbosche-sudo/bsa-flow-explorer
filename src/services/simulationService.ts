import type { SimulationResult } from '@/domain/types';
import { runSimulation, type SimulationInput } from '@/simulation/engine';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: SimulationResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, result, error } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    return worker;
  } catch {
    return null;
  }
}

/** Run the simulation off the main thread (falls back to main thread). */
export function runSimulationAsync(input: SimulationInput): Promise<SimulationResult> {
  const w = getWorker();
  if (!w) return Promise.resolve(runSimulation(input));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, input });
  });
}
