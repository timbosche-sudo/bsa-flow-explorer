/**
 * Generates public/sample/synthetic-tag-export-TEST.csv — a SYNTHETIC test
 * file in the documented position-observation CSV format, for trying the
 * import wizard. It is derived from the simulation (not measured) and adds
 * realistic defects: positional noise, dropouts, outlier jumps, duplicate and
 * out-of-order rows. The positioning frame has its origin at world (-1, 19) m
 * with Y pointing up (enter offset -1, 19 and "Y up" in the wizard).
 *
 * Run: npx vite-node scripts/generateSyntheticExport.ts
 */
import { writeFileSync } from 'node:fs';
import { createSampleProject } from '../src/sample/sampleClinic';
import { runSimulation } from '../src/simulation/engine';
import { positionAt } from '../src/analytics/trackUtils';
import { Rng } from '../src/simulation/rng';

const p = createSampleProject();
const sim = runSimulation({ spatial: p.spatial, roles: p.roles, staff: p.staff, config: p.simulation });
const rng = new Rng(4242);
const OX = -1;
const OY = 19;
const UTC_OFFSET_H = -5;
const t0 = 9 * 3600;
const t1 = 11 * 3600;
const step = 2;
const pick = ['staff-rn-01', 'staff-rn-02', 'staff-ma-01', 'staff-ma-03', 'staff-md-01', 'staff-tech-01'];
const rows: string[] = [];
for (const tr of sim.tracks.filter((t) => pick.includes(t.staffId))) {
  const tag = `UWB-${(pick.indexOf(tr.staffId) + 1).toString().padStart(3, '0')}`;
  let dropoutUntil = -1;
  for (let t = t0; t <= t1; t += step) {
    if (t < dropoutUntil) continue;
    if (rng.chance(0.002)) {
      dropoutUntil = t + rng.uniform(40, 150); // tag loses position
      continue;
    }
    const pos = positionAt(tr, t);
    if (!pos) continue;
    let x = pos.p.x + rng.normal(0, 0.15);
    let y = pos.p.y + rng.normal(0, 0.15);
    if (rng.chance(0.003)) {
      x += rng.uniform(-15, 15); // multipath outlier jump
      y += rng.uniform(-6, 6);
    }
    const fx = x - OX;
    const fy = OY - y; // y up
    const iso = new Date(Date.UTC(2025, 2, 12, 0, 0, 0) + (t - UTC_OFFSET_H * 3600) * 1000).toISOString();
    const line = `CLINIC-DEMO,${tag},${iso},${fx.toFixed(3)},${fy.toFixed(3)},1.20,uwb-frame-1,synthetic-test,${(0.7 + rng.next() * 0.3).toFixed(2)},0.15`;
    rows.push(line);
    if (rng.chance(0.002)) rows.push(line); // duplicate row
  }
}
// A few out-of-order rows.
for (let k = 0; k < 20; k++) {
  const i = Math.floor(rng.next() * (rows.length - 1));
  [rows[i], rows[i + 1]] = [rows[i + 1], rows[i]];
}
const header = 'study_id,tag_id,timestamp_utc,x_m,y_m,z_m,frame_id,source,quality,uncertainty_m';
writeFileSync('public/sample/synthetic-tag-export-TEST.csv', [header, ...rows].join('\n') + '\n');
console.log(`Wrote ${rows.length} rows`);
