import { describe, expect, it } from 'vitest';
import { createSampleProject } from '@/sample/sampleClinic';
import { runSimulation } from './engine';
import { SpatialContext } from '@/routing/spatialContext';
import { cellIndex } from '@/routing/navGrid';

const p = createSampleProject();
const input = { spatial: p.spatial, roles: p.roles, staff: p.staff, config: p.simulation };

describe('simulation engine', () => {
  const ctx = new SpatialContext(p.spatial);
  const t0 = performance.now();
  const res = runSimulation(input, ctx);
  const elapsed = performance.now() - t0;

  it('simulates all sample staff over the shift', () => {
    expect(res.tracks).toHaveLength(10);
    expect(res.warnings).toEqual([]);
    for (const tr of res.tracks) {
      expect(tr.t[0]).toBeGreaterThanOrEqual(8 * 3600);
      expect(tr.t[tr.t.length - 1]).toBeLessThanOrEqual(16 * 3600);
      expect(tr.t[tr.t.length - 1] - tr.t[0]).toBeGreaterThan(7 * 3600);
    }
    console.log('sim ms', elapsed.toFixed(0), 'samples', res.tracks.reduce((s, t) => s + t.t.length, 0), 'walks', res.spans.filter((s) => s.kind === 'walk').length);
  });

  it('is reproducible for the same seed', () => {
    const again = runSimulation(input);
    expect(again.tracks[3].x).toEqual(res.tracks[3].x);
    expect(again.configHash).toBe(res.configHash);
    const other = runSimulation({ ...input, config: { ...input.config, seed: 7 } });
    expect(other.tracks[3].x.length === res.tracks[3].x.length && other.tracks[3].x.every((v, i) => v === res.tracks[3].x[i])).toBe(false);
  });

  it('never teleports and stays on walkable cells', () => {
    for (const tr of res.tracks) {
      let maxSpeed = 0;
      let minDt = Infinity;
      for (let i = 1; i < tr.t.length; i++) {
        const d = Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]);
        const dt = tr.t[i] - tr.t[i - 1];
        minDt = Math.min(minDt, dt);
        maxSpeed = Math.max(maxSpeed, d / dt);
      }
      expect(minDt).toBeGreaterThan(0);
      expect(maxSpeed).toBeLessThan(2.2);
      let off = 0;
      for (let i = 0; i < tr.t.length; i += 7) {
        const idx = cellIndex(ctx.grid, { x: tr.x[i], y: tr.y[i] });
        if (idx < 0 || ctx.grid.space[idx] < 0) off++;
      }
      // Corner waypoints can sit exactly on a cell boundary next to a wall.
      expect(off / (tr.t.length / 7)).toBeLessThan(0.01);
    }
  });

  it('produces role differences in movement', () => {
    const walk = (role: string) =>
      res.spans.filter((s) => s.kind === 'walk' && p.staff.find((m) => m.id === s.staffId)?.roleId === role).reduce((a, s) => a + s.distanceM, 0);
    const rn = walk('role-rn') / 3;
    const adm = walk('role-admin');
    expect(rn).toBeGreaterThan(adm);
  });
});
