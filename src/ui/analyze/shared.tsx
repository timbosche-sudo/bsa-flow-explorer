import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useActiveDataset } from '@/store/dataStore';
import { useAnalysis } from '@/store/analysis';
import { useUI, type RoomMetric } from '@/store/uiStore';
import type { DatasetAnalysis, SpaceAnalysis } from '@/analytics/engine';
import { rampRGB, rgbStr, rampCss } from '@/ui/colormaps';
import { fmtDuration, fmtPct } from '@/ui/format';
import { METRIC_DEFINITIONS } from '@/analytics/definitions';
import type { DataBasis } from '@/ui/panels/QualityTag';
import { LegendBox } from '@/ui/plan/AnalysisLayers';

export function useBasis(): DataBasis {
  const ds = useActiveDataset();
  return ds?.meta.kind === 'simulated' ? 'simulated' : ds ? 'calculated' : 'unavailable';
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-5 mb-2 flex items-center justify-between first:mt-0">
      <div className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{children}</div>
      {right}
    </div>
  );
}

export function Definition({ k, children }: { k?: keyof typeof METRIC_DEFINITIONS | string; children?: ReactNode }) {
  return (
    <div className="flex gap-1.5 rounded-[3px] bg-line-2/60 px-2 py-1.5 text-[10.5px] leading-snug text-ink-2">
      <Info size={12} className="mt-[1px] shrink-0 text-faint" />
      <span>{children ?? (k ? METRIC_DEFINITIONS[k] : null)}</span>
    </div>
  );
}

export const ROOM_METRICS: { value: RoomMetric; label: string; fmt: (s: SpaceAnalysis, range: number) => string; get: (s: SpaceAnalysis, range: number) => number; def: string }[] = [
  { value: 'dwell', label: 'Total dwell time', get: (s) => s.dwellS, fmt: (s) => fmtDuration(s.dwellS), def: 'dwell' },
  { value: 'visits', label: 'Number of visits', get: (s) => s.visitCount, fmt: (s) => String(s.visitCount), def: 'visit' },
  { value: 'presence', label: 'Time with ≥1 staff present', get: (s, r) => s.presenceS / r, fmt: (s, r) => fmtPct(s.presenceS / r), def: 'presence' },
  { value: 'avgVisit', label: 'Average visit duration', get: (s) => s.avgVisitS, fmt: (s) => fmtDuration(s.avgVisitS), def: 'visit' },
  { value: 'peak', label: 'Peak simultaneous staff', get: (s) => s.peakOccupancy, fmt: (s) => String(s.peakOccupancy), def: 'peak' },
];

/** Room fill colours for the occupancy choropleth, or null when inactive. */
export function useRoomChoropleth(): Map<string, string> | null {
  const a = useAnalysis();
  const on = useUI((s) => s.layers.occupancy.visible);
  const metric = useUI((s) => s.roomMetric);
  const rooms = useProject((s) => s.project!.spatial.rooms);
  return useMemo(() => {
    if (!a || !on) return null;
    const m = ROOM_METRICS.find((x) => x.value === metric)!;
    const range = a.options.range[1] - a.options.range[0];
    const sensitive = new Set(rooms.filter((r) => r.sensitive).map((r) => r.id));
    const vals = a.spaces.filter((s) => s.kind === 'room' && !sensitive.has(s.id) && s.type !== 'Corridor');
    const max = Math.max(1e-9, ...vals.map((s) => m.get(s, range)));
    const out = new Map<string, string>();
    for (const s of vals) {
      const v = m.get(s, range);
      out.set(s.id, v > 0 ? rgbStr(rampRGB('blue', 0.08 + 0.92 * (v / max))) : '#f0efec');
    }
    for (const id of sensitive) out.set(id, '#d9d7d2');
    return out;
  }, [a, on, metric, rooms]);
}

export function ChoroplethLegend() {
  const a = useAnalysis();
  const metric = useUI((s) => s.roomMetric);
  if (!a) return null;
  const m = ROOM_METRICS.find((x) => x.value === metric)!;
  const range = a.options.range[1] - a.options.range[0];
  const rooms = a.spaces.filter((s) => s.kind === 'room');
  const max = rooms.reduce((best, s) => (m.get(s, range) > m.get(best, range) ? s : best), rooms[0]);
  return (
    <LegendBox title={`Rooms: ${m.label.toLowerCase()}`} sub="Tracked staff only">
      <div className="h-2.5 w-full rounded-[2px]" style={{ background: rampCss('blue') }} />
      <div className="mt-0.5 flex justify-between text-[10px] text-muted tnum">
        <span>0</span>
        <span>{max ? m.fmt(max, range) : '—'}</span>
      </div>
      <div className="mt-1 text-[10px] leading-snug text-muted">Grey rooms are sensitive and excluded. Staff presence is not clinical room utilisation.</div>
    </LegendBox>
  );
}

export const UNASSIGNED_ROLE = { id: '__unassigned', name: 'Unassigned role', shortName: 'Unassigned', color: '#898781' };

export function roleRows(a: DatasetAnalysis, roles: { id: string; name: string; shortName: string; color: string }[]) {
  const all = a.staff.some((s) => !s.roleId || !roles.some((r) => r.id === s.roleId)) ? [...roles, UNASSIGNED_ROLE] : roles;
  const known = new Set(roles.map((r) => r.id));
  return all
    .map((r) => {
      const st = a.staff.filter((s) => (r.id === UNASSIGNED_ROLE.id ? !s.roleId || !known.has(s.roleId) : s.roleId === r.id));
      const n = st.length;
      const trackedH = st.reduce((s, x) => s + x.trackedS, 0) / 3600;
      const dist = st.reduce((s, x) => s + x.distanceM, 0);
      const trips = st.reduce((s, x) => s + x.trips.length, 0);
      const tripDist = st.reduce((s, x) => s + x.trips.reduce((q, t) => q + t.distanceM, 0), 0);
      const tripTime = st.reduce((s, x) => s + x.trips.reduce((q, t) => q + (t.end - t.start), 0), 0);
      const moving = st.reduce((s, x) => s + x.movingS, 0);
      const tracked = st.reduce((s, x) => s + x.trackedS, 0);
      const rooms = st.reduce((s, x) => s + new Set(x.visits.map((v) => v.roomId)).size, 0);
      return {
        role: r,
        n,
        distPerPerson: n ? dist / n : NaN,
        distPerHour: trackedH ? dist / trackedH : NaN,
        tripsPerHour: trackedH ? trips / trackedH : NaN,
        avgTrip: trips ? tripDist / trips : NaN,
        avgTripTime: trips ? tripTime / trips : NaN,
        movingShare: tracked ? moving / tracked : NaN,
        roomsPerPerson: n ? rooms / n : NaN,
        trips,
      };
    })
    .filter((r) => r.n > 0);
}
