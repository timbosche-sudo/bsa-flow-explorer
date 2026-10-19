import { useProject } from '@/store/projectStore';
import { useActiveDataset } from '@/store/dataStore';
import { useAnalysis } from '@/store/analysis';
import { usePlayback } from '@/store/playback';
import { useUI } from '@/store/uiStore';
import { Stat } from '@/ui/components/controls';
import { fmtClock, fmtDistance, fmtDistanceLong, fmtDuration, fmtPct } from '@/ui/format';
import { QualityTag } from './QualityTag';

/** Study-level statistics for the active dataset and time window. */
export function StudySummary() {
  const ds = useActiveDataset();
  const a = useAnalysis();
  const p = useProject((s) => s.project!);
  const select = useUI((s) => s.select);
  const range = [usePlayback((s) => s.rangeStart), usePlayback((s) => s.rangeEnd)] as const;
  const unit = p.prefs.units;
  if (!ds || !a) return <div className="text-[12.5px] text-muted">No movement data. Run the simulation (Configure) or import observed data.</div>;
  const kind = ds.meta.kind === 'simulated' ? 'simulated' : 'calculated';
  const n = a.staff.length;
  const total = a.staff.reduce((s, x) => s + x.distanceM, 0);
  const moving = a.staff.reduce((s, x) => s + x.movingS, 0);
  const tracked = a.staff.reduce((s, x) => s + x.trackedS, 0);
  const trips = a.trips.length;
  const hours = Math.max(1e-9, (range[1] - range[0]) / 3600);
  const roles = p.roles.filter((r) => a.staff.some((s) => s.roleId === r.id));
  const minGroup = p.prefs.minGroupSize;
  return (
    <div>
      <div className="mb-3">
        <div className="text-2xs font-medium tracking-[0.06em] text-muted uppercase">Study overview</div>
        <div className="text-[13.5px] font-semibold">
          {fmtClock(range[0])} – {fmtClock(range[1])}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <Stat label="Total distance" value={fmtDistanceLong(total, unit)} quality={<QualityTag kind={kind} />} sub={`${n} tracked staff`} />
        <Stat label="Avg per person" value={fmtDistanceLong(n ? total / n : NaN, unit)} sub={n ? `${fmtDistance(total / n / hours, unit)} per hour` : ''} />
        <Stat label="Journeys" value={trips} sub={`${(trips / Math.max(1, n) / hours).toFixed(1)} per person-hour`} />
        <Stat label="Time moving" value={fmtPct(moving / Math.max(1, tracked))} sub={`${fmtDuration(moving / Math.max(1, n))} avg per person`} />
      </div>
      <div className="mt-4">
        <div className="mb-1.5 text-2xs font-semibold tracking-[0.06em] text-muted uppercase">By role</div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-2xs text-muted">
              <th className="pb-1 font-medium">Role</th>
              <th className="pb-1 text-right font-medium">n</th>
              <th className="pb-1 text-right font-medium">Dist / person</th>
              <th className="pb-1 text-right font-medium">Trips / p</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const rs = a.staff.filter((s) => s.roleId === r.id);
              const suppressed = rs.length < minGroup;
              const d = rs.reduce((s, x) => s + x.distanceM, 0) / rs.length;
              const t = rs.reduce((s, x) => s + x.trips.length, 0) / rs.length;
              return (
                <tr key={r.id} className="cursor-pointer border-t border-line-2 hover:bg-black/[0.02]" onClick={() => select({ kind: 'role', id: r.id })}>
                  <td className="py-1">
                    <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
                    {r.shortName}
                  </td>
                  <td className="py-1 text-right tnum">{rs.length}</td>
                  <td className="py-1 text-right tnum">{suppressed ? '—' : fmtDistance(d, unit)}</td>
                  <td className="py-1 text-right tnum">{suppressed ? '—' : t.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {roles.some((r) => a.staff.filter((s) => s.roleId === r.id).length < minGroup) && <p className="mt-1 text-2xs text-muted">— suppressed: fewer than {minGroup} tracked people (privacy setting).</p>}
      </div>
    </div>
  );
}
