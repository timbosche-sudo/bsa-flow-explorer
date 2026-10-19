/// <reference lib="webworker" />
import { runSimulation, type SimulationInput } from '@/simulation/engine';

self.onmessage = (ev: MessageEvent<{ id: number; input: SimulationInput }>) => {
  const { id, input } = ev.data;
  try {
    const result = runSimulation(input);
    const transfer: Transferable[] = [];
    for (const t of result.tracks) transfer.push(t.t.buffer, t.x.buffer, t.y.buffer, t.gap.buffer);
    (self as unknown as Worker).postMessage({ id, result }, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
