import { createSampleProject } from '../src/sample/sampleClinic';
import { runSimulation } from '../src/simulation/engine';
import { SpatialContext } from '../src/routing/spatialContext';
import { cellIndex } from '../src/routing/navGrid';
const p = createSampleProject();
const ctx = new SpatialContext(p.spatial);
let t0 = performance.now();
for (const r of ctx.rooms) ctx.field(r.id);
console.log('fields', performance.now() - t0);
t0 = performance.now();
const r1 = ctx.roomRoute('room-exam-101', 'room-exam-112');
console.log('route', performance.now() - t0, r1?.points.length, r1?.lengthM);
t0 = performance.now();
const res = runSimulation({ spatial: p.spatial, roles: p.roles, staff: p.staff, config: p.simulation }, ctx);
console.log('sim', performance.now() - t0, res.warnings);
const tr = res.tracks[0];
const offs: string[] = [];
for (let i = 0; i < tr.t.length; i += 50) {
  const idx = cellIndex(ctx.grid, { x: tr.x[i], y: tr.y[i] });
  if (idx < 0 || ctx.grid.space[idx] < 0) offs.push(`${tr.t[i]} ${tr.x[i].toFixed(2)},${tr.y[i].toFixed(2)}`);
}
console.log(offs.length, offs.slice(0, 10));
console.log(ctx.activityPoint.get('room-ns'));
