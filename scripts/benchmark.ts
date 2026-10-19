/** Performance check: analytics on 50 tags × 12 h at 1 Hz (2.16 M samples). Run: npx vite-node scripts/benchmark.ts */
import { createSampleProject } from '../src/sample/sampleClinic';
import { runSimulation } from '../src/simulation/engine';
import { analyzeTracks, DEFAULT_ANALYSIS_OPTIONS } from '../src/analytics/engine';
import { SpaceLocator } from '../src/analytics/spaceLocator';
import { accumulate, emptyGrid, finalize, smooth } from '../src/analytics/heatmap';
import { analyzeCongestion } from '../src/analytics/congestion';

const p = createSampleProject();
const staff = Array.from({ length: 50 }, (_, i) => ({ ...p.staff[i % p.staff.length], id: `s${i}`, code: `T${i}`, shiftStartMin: 7 * 60, shiftEndMin: 19 * 60 }));
let t0 = performance.now();
const sim = runSimulation({ spatial: p.spatial, roles: p.roles, staff, config: { ...p.simulation, studyStartMin: 7 * 60, studyEndMin: 19 * 60 } });
const n = sim.tracks.reduce((s, t) => s + t.t.length, 0);
console.log(`simulate 50 staff × 12 h: ${(performance.now() - t0).toFixed(0)} ms, ${n.toLocaleString()} samples`);
const loc = new SpaceLocator(p.spatial);
t0 = performance.now();
analyzeTracks(sim.tracks, p.spatial, p.roomTypes, { ...DEFAULT_ANALYSIS_OPTIONS, range: [7 * 3600, 19 * 3600] }, loc);
console.log(`analytics: ${(performance.now() - t0).toFixed(0)} ms`);
t0 = performance.now();
const g = emptyGrid(p.spatial, 0.25, loc, new Set());
accumulate(g, sim.tracks, 'movement', { range: [7 * 3600, 19 * 3600], movingSpeedMps: 0.3, maxGapS: 30 });
smooth(g, 2.4);
finalize(g);
console.log(`heatmap: ${(performance.now() - t0).toFixed(0)} ms`);
t0 = performance.now();
analyzeCongestion(sim.tracks, p.spatial, loc, { range: [7 * 3600, 19 * 3600], stepS: 2, segmentM: 2, encounterRadiusM: 1.5, threshold: 3 });
console.log(`congestion: ${(performance.now() - t0).toFixed(0)} ms`);
