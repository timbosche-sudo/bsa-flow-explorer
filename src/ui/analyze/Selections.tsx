import { X } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { useAnalysis } from '@/store/analysis';
import { Badge, Stat } from '@/ui/components/controls';
import { ChartFrame, HBars, AreaSeries } from '@/ui/charts';
import { fmtClock, fmtDistance, fmtDuration, fmtPct } from '@/ui/format';
import { QualityTag } from '@/ui/panels/QualityTag';
import { Definition, SectionTitle, roleRows, useBasis } from './shared';
import { area } from '@/geometry/polygon';
import { fmtArea } from '@/ui/format';
import { roomLabel } from '@/domain/validation';

function Head({ kind, title, color }: { kind: string; title: string; color?: string }) {
  const select = useUI((s) => s.select);
  return (
    <div className="mb-3 flex items-start gap-2">
      {color && <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />}
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-medium tracking-[0.06em] text-muted uppercase">{kind}</div>
        <div className="truncate text-[15px] font-semibold">{title}</div>
      </div>
      <button className="rounded p-1 text-muted hover:bg-black/5" onClick={() => select(null)} title="Back to overview">
        <X size={14} />
      </button>
    </div>
  );
}

export function RoomAnalytics({ roomId }: { roomId: string }) {
  const a = useAnalysis();
  const p = useProject((s) => s.project!);
  const basis = useBasis();
  const room = p.spatial.rooms.find((r) => r.id === roomId);
  const circ = p.spatial.circulation.find((c) => c.id === roomId);
  const s = a?.spaceById.get(roomId);
  if (!a || !s || (!room && !circ)) return null;
  const range = a.options.range[1] - a.options.range[0];
  const unit = p.prefs.units;
  const typeMates = a.spaces.filter((x) => x.kind === 'room' && x.type === s.type);
  const mateAvg = typeMates.reduce((q, x) => q + x.dwellS, 0) / Math.max(1, typeMates.length);
  const roles = p.roles;
  const byRole = Object.entries(s.dwellByRole)
    .map(([rid, v]) => ({ name: roles.find((r) => r.id === rid)?.shortName ?? 'n/a', value: v / 60, color: roles.find((r) => r.id === rid)?.color ?? '#999' }))
    .sort((x, y) => y.value - x.value);
  const step = Math.max(1, Math.round(600 / a.options.binS));
  const occ: Record<string, number>[] = [];
  for (let b = 0; b < a.binCount; b += step) {
    let v = 0;
    for (let k = b; k < Math.min(a.binCount, b + step); k++) v += s.occupancy[k];
    occ.push({ t: a.options.range[0] + b * a.options.binS, v: v / Math.min(step, a.binCount - b) });
  }
  if (room?.sensitive && useUI.getState().mode === 'present') return <div className="text-muted">Sensitive room — excluded from presentation.</div>;
  return (
    <div>
      <Head kind={s.kind === 'room' ? s.type : 'Circulation'} title={room ? roomLabel(room) : circ!.name} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge>{fmtArea(area((room ?? circ)!.polygon), unit)}</Badge>
        {room?.targetOccupancy != null && <Badge>Target occupancy {room.targetOccupancy}</Badge>}
        {room?.sensitive && <Badge tone="warn">Sensitive</Badge>}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Stat label="Visits" value={s.kind === 'room' ? s.visitCount : '—'} quality={<QualityTag kind={basis} />} sub={`${s.uniqueStaff} different staff`} />
        <Stat label="Total dwell" value={s.kind === 'room' ? fmtDuration(s.dwellS) : '—'} sub={s.kind === 'room' ? `type average ${fmtDuration(mateAvg)}` : 'circulation: no visits'} />
        <Stat label="Avg per visit" value={s.visitCount ? fmtDuration(s.avgVisitS) : '—'} />
        <Stat label="≥1 staff present" value={fmtPct(s.presenceS / range)} sub={fmtDuration(s.presenceS)} />
        <Stat label="Person-time" value={fmtDuration(s.personS)} sub={`avg ${(s.personS / range).toFixed(2)} people`} />
        <Stat label="Peak simultaneous" value={s.peakOccupancy} sub={s.peakAt != null ? `at ${fmtClock(s.peakAt)}` : undefined} />
      </div>
      {byRole.length > 0 && (
        <>
          <SectionTitle>Dwell by role (minutes)</SectionTitle>
          <HBars data={byRole} fmt={(v) => `${Math.round(v)} min`} />
        </>
      )}
      <ChartFrame title="Tracked staff present" sub="Mean simultaneous people, 10-minute bins" height={120}>
        <AreaSeries data={occ} xKey="t" yKey="v" name="Present" color="#256abf" fmt={(v) => v.toFixed(1)} xFmt={(t) => fmtClock(t)} threshold={room?.targetOccupancy ?? undefined} />
      </ChartFrame>
      <Definition k="presence" />
    </div>
  );
}

export function RoleAnalytics({ roleId }: { roleId: string }) {
  const a = useAnalysis({ ignoreFilters: true });
  const p = useProject((s) => s.project!);
  const select = useUI((s) => s.select);
  const basis = useBasis();
  const role = p.roles.find((r) => r.id === roleId);
  if (!a || !role) return null;
  const row = roleRows(a, [role])[0];
  const members = a.staff.filter((s) => s.roleId === roleId);
  const unit = p.prefs.units;
  const suppressed = members.length < p.prefs.minGroupSize;
  const dests = new Map<string, number>();
  for (const s of members) for (const t of s.trips) {
    const type = a.locator.spaces[a.locator.index.get(t.toRoomId) ?? -1]?.type ?? '?';
    dests.set(type, (dests.get(type) ?? 0) + 1);
  }
  return (
    <div>
      <Head kind="Staff role" title={role.name} color={role.color} />
      {suppressed || !row ? (
        <div className="text-[12px] text-muted">Group has fewer than {p.prefs.minGroupSize} tracked people; results suppressed (privacy setting).</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
            <Stat label="Tracked staff" value={row.n} />
            <Stat label="Distance / person" value={fmtDistance(row.distPerPerson, unit)} quality={<QualityTag kind={basis} />} />
            <Stat label="Distance / hour" value={fmtDistance(row.distPerHour, unit)} />
            <Stat label="Trips / hour" value={row.tripsPerHour.toFixed(1)} />
            <Stat label="Avg trip" value={fmtDistance(row.avgTrip, unit)} sub={fmtDuration(row.avgTripTime)} />
            <Stat label="Time moving" value={fmtPct(row.movingShare)} />
          </div>
          <SectionTitle>Trip destinations by function</SectionTitle>
          <HBars data={[...dests.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => ({ name: k.replace('Medical Assistant Workstation', 'MA workstation').slice(0, 14), value: v, color: role.color }))} fmt={(v) => String(v)} />
          <SectionTitle>Members</SectionTitle>
          {members.map((m) => (
            <button key={m.staffId} onClick={() => select({ kind: 'staff', id: m.staffId })} className="flex w-full justify-between border-t border-line-2 py-1 text-left text-[12px] hover:bg-black/[0.02]">
              <span className="tnum font-medium">{p.staff.find((s) => s.id === m.staffId)?.code ?? m.staffId}</span>
              <span className="tnum text-muted">{fmtDistance(m.distanceM, unit)}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
