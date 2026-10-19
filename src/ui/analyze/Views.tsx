import { useMemo, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { useActiveDataset, useData } from '@/store/dataStore';
import { useAnalysis, useCongestion, useHeatmap, getLocator, analyzeCached } from '@/store/analysis';
import { clock } from '@/store/playback';
import { Badge, Segmented, Select, Stat, cx } from '@/ui/components/controls';
import { ChartFrame, HBars, Lines, StackedBars, AreaSeries } from '@/ui/charts';
import { fmtClock, fmtDistance, fmtDistanceLong, fmtDuration, fmtPct, fmtInt } from '@/ui/format';
import { QualityTag } from '@/ui/panels/QualityTag';
import { buildOD, odKey } from '@/analytics/od';
import { rampRGB, rgbStr } from '@/ui/colormaps';
import { FT_PER_M } from '@/geometry/calibration';
import { area } from '@/geometry/polygon';
import { Definition, ROOM_METRICS, SectionTitle, roleRows, useBasis } from './shared';
import { useCompareSides } from '@/ui/plan/useDiffHeat';
import { useSpatialContext } from '@/store/derived';

const hourFmt = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

function useUnits() {
  const unit = useProject((s) => s.project!.prefs.units);
  const dFmt = (m: number) => fmtDistance(m, unit);
  const toU = (m: number) => (unit === 'ft' ? m * FT_PER_M : m);
  return { unit, dFmt, toU, uLabel: unit };
}

function DataQualityNotes() {
  const ds = useActiveDataset();
  const a = useAnalysis();
  const calibrated = useProject((s) => s.project!.calibration.calibrated);
  if (!ds || !a) return null;
  const notes: string[] = [];
  if (!calibrated) notes.push('Drawing scale is not calibrated: distances use an assumed scale and are not verified.');
  if (ds.meta.kind === 'observed') {
    const gap = a.staff.reduce((s, x) => s + x.gapS, 0);
    const tracked = a.staff.reduce((s, x) => s + x.trackedS, 0);
    if (gap > 0.05 * (gap + tracked)) notes.push(`${fmtPct(gap / (gap + tracked))} of the window is tracking gaps; distances are lower bounds.`);
    const un = a.staff.reduce((s, x) => s + x.unlocatedFraction, 0) / Math.max(1, a.staff.length);
    if (un > 0.05) notes.push(`${fmtPct(un)} of positions fall outside defined spaces (position error or incomplete spatial model).`);
    if (ds.meta.positionAccuracyM == null) notes.push('Positional accuracy unknown — fine-grained room and corridor conclusions may be unreliable.');
  }
  if (!notes.length) return null;
  return (
    <div className="mb-3 space-y-1 rounded-[3px] border border-[#ecd9b0] bg-[#fdf8ec] p-2">
      {notes.map((n) => (
        <div key={n} className="flex gap-1.5 text-[11px] leading-snug text-[#7a5410]">
          <TriangleAlert size={12} className="mt-[1px] shrink-0" />
          {n}
        </div>
      ))}
    </div>
  );
}

export function OverviewView() {
  const a = useAnalysis();
  const roles = useProject((s) => s.project!.roles);
  const minGroup = useProject((s) => s.project!.prefs.minGroupSize);
  const basis = useBasis();
  const { dFmt, toU, uLabel, unit } = useUnits();
  if (!a) return null;
  const n = a.staff.length;
  const total = a.staff.reduce((s, x) => s + x.distanceM, 0);
  const trips = a.trips;
  const longest = trips.reduce((b, t) => (t.distanceM > (b?.distanceM ?? -1) ? t : b), trips[0]);
  const moving = a.staff.reduce((s, x) => s + x.movingS, 0);
  const stationary = a.staff.reduce((s, x) => s + x.stationaryS, 0);
  const tracked = moving + stationary;
  const rows = roleRows(a, roles);
  const hours: number[] = [];
  for (let h = Math.floor(a.options.range[0] / 3600); h < Math.ceil(a.options.range[1] / 3600); h++) hours.push(h);
  const hourly = hours.map((h) => {
    const o: Record<string, number> = { h };
    for (const r of rows) o[r.role.id] = toU(a.staff.filter((s) => s.roleId === r.role.id).reduce((q, s) => q + s.hourlyDistanceM[h % 24], 0));
    return o;
  });
  return (
    <div>
      <DataQualityNotes />
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Stat label="Total distance" value={fmtDistanceLong(total, unit)} quality={<QualityTag kind={basis} />} sub={`${n} tracked staff`} />
        <Stat label="Avg per tracked person" value={fmtDistanceLong(n ? total / n : NaN, unit)} />
        <Stat label="Journeys" value={fmtInt(trips.length)} sub={`avg ${dFmt(trips.length ? trips.reduce((s, t) => s + t.distanceM, 0) / trips.length : NaN)}`} />
        <Stat label="Longest trip" value={longest ? dFmt(longest.distanceM) : '—'} sub={longest ? fmtClock(longest.start) : undefined} />
        <Stat label="Time moving" value={fmtDuration(moving)} sub={`${fmtPct(moving / Math.max(1, tracked))} of tracked time`} />
        <Stat label="Time stationary" value={fmtDuration(stationary)} />
      </div>
      <SectionTitle>Distance per person by role</SectionTitle>
      <HBars data={rows.filter((r) => r.n >= minGroup).map((r) => ({ name: r.role.shortName, value: toU(r.distPerPerson), color: r.role.color }))} fmt={(v) => `${fmtInt(v)} ${uLabel}`} />
      <ChartFrame title="Distance by hour" sub={`${uLabel} walked, stacked by role`}>
        <StackedBars data={hourly} xKey="h" xFmt={hourFmt} fmt={(v) => fmtInt(v)} series={rows.map((r) => ({ key: r.role.id, name: r.role.shortName, color: r.role.color }))} />
      </ChartFrame>
      <SectionTitle>Movement patterns by role</SectionTitle>
      <RoleTable rows={rows} minGroup={minGroup} />
      <div className="mt-3 space-y-1.5">
        <Definition k="distance" />
        <Definition k="trip" />
      </div>
    </div>
  );
}

export function RoleTable({ rows, minGroup }: { rows: ReturnType<typeof roleRows>; minGroup: number }) {
  const { dFmt } = useUnits();
  const select = useUI((s) => s.select);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="text-left text-[10.5px] text-muted">
            <th className="pb-1 font-medium">Role</th>
            <th className="pb-1 text-right font-medium">n</th>
            <th className="pb-1 text-right font-medium" title="Distance per tracked hour">Dist/h</th>
            <th className="pb-1 text-right font-medium">Trips/h</th>
            <th className="pb-1 text-right font-medium">Avg trip</th>
            <th className="pb-1 text-right font-medium">Moving</th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((r) => {
            const hide = r.n < minGroup;
            return (
              <tr key={r.role.id} className="cursor-pointer border-t border-line-2 hover:bg-black/[0.02]" onClick={() => select({ kind: 'role', id: r.role.id })}>
                <td className="py-1">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: r.role.color }} />
                  {r.role.shortName}
                </td>
                <td className="py-1 text-right">{r.n}</td>
                <td className="py-1 text-right">{hide ? '—' : dFmt(r.distPerHour)}</td>
                <td className="py-1 text-right">{hide ? '—' : r.tripsPerHour.toFixed(1)}</td>
                <td className="py-1 text-right">{hide ? '—' : dFmt(r.avgTrip)}</td>
                <td className="py-1 text-right">{hide ? '—' : fmtPct(r.movingShare)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r.n < minGroup) && <div className="mt-1 text-[10px] text-muted">— suppressed (group smaller than {minGroup}).</div>}
    </div>
  );
}

export function RoomsView() {
  const a = useAnalysis();
  const metric = useUI((s) => s.roomMetric);
  const setMetric = useUI((s) => s.setRoomMetric);
  const select = useUI((s) => s.select);
  const selection = useUI((s) => s.selection);
  const rooms = useProject((s) => s.project!.spatial.rooms);
  const mode = useUI((s) => s.mode);
  const [sortDir] = useState(-1);
  if (!a) return null;
  const range = a.options.range[1] - a.options.range[0];
  const m = ROOM_METRICS.find((x) => x.value === metric)!;
  const sensitive = new Set(rooms.filter((r) => r.sensitive).map((r) => r.id));
  const list = a.spaces.filter((s) => s.kind === 'room' && !(mode === 'present' && sensitive.has(s.id))).sort((x, y) => sortDir * (m.get(x, range) - m.get(y, range)));
  const byType = new Map<string, { n: number; dwell: number; visits: number }>();
  for (const s of a.spaces.filter((s) => s.kind === 'room')) {
    const e = byType.get(s.type) ?? { n: 0, dwell: 0, visits: 0 };
    e.n++;
    e.dwell += s.dwellS;
    e.visits += s.visitCount;
    byType.set(s.type, e);
  }
  return (
    <div>
      <Select value={metric} onChange={setMetric} options={ROOM_METRICS.map((x) => ({ value: x.value, label: x.label }))} />
      <div className="mt-1.5">
        <Definition k={m.def} />
      </div>
      <div className="mt-3 max-h-[380px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 bg-panel">
            <tr className="text-left text-[10.5px] text-muted">
              <th className="px-2 py-1 font-medium">Room</th>
              <th className="py-1 text-right font-medium">Visits</th>
              <th className="py-1 text-right font-medium">Dwell</th>
              <th className="py-1 text-right font-medium">Avg</th>
              <th className="px-2 py-1 text-right font-medium" title="Share of window with ≥1 tracked staff present">≥1 present</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {list.map((s) => (
              <tr
                key={s.id}
                onClick={() => select({ kind: 'room', id: s.id })}
                className={cx('cursor-pointer border-t border-line-2', selection?.id === s.id ? 'bg-accent-soft' : 'hover:bg-black/[0.02]')}
              >
                <td className="max-w-[120px] truncate px-2 py-1" title={s.type}>
                  {s.name}
                  {sensitive.has(s.id) && <span className="ml-1 text-[9.5px] text-warn">sensitive</span>}
                </td>
                <td className="py-1 text-right">{s.visitCount}</td>
                <td className="py-1 text-right">{fmtDuration(s.dwellS)}</td>
                <td className="py-1 text-right">{s.visitCount ? fmtDuration(s.avgVisitS) : '—'}</td>
                <td className="px-2 py-1 text-right">{fmtPct(s.presenceS / range)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionTitle>By room type (average per room)</SectionTitle>
      <table className="w-full text-[11.5px] tnum">
        <tbody>
          {[...byType.entries()]
            .sort((x, y) => y[1].dwell / y[1].n - x[1].dwell / x[1].n)
            .map(([t, e]) => (
              <tr key={t} className="border-t border-line-2">
                <td className="py-1">
                  {t} <span className="text-faint">×{e.n}</span>
                </td>
                <td className="py-1 text-right">{(e.visits / e.n).toFixed(1)} visits</td>
                <td className="py-1 text-right">{fmtDuration(e.dwell / e.n)}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="mt-3">
        <Definition k="presence" />
      </div>
    </div>
  );
}

export function HeatmapView() {
  const heat = useHeatmap();
  const a = useAnalysis();
  const spatial = useProject((s) => s.project!.spatial);
  const unit = useProject((s) => s.project!.prefs.units);
  const ranking = useMemo(() => {
    if (!heat || !a) return [];
    const loc = getLocator(spatial);
    const sums = new Map<number, number>();
    const g = heat.grid;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const v = g.values[r * g.cols + c];
        if (!v) continue;
        const si = loc.locate(g.originX + (c + 0.5) * g.cell, g.originY + (r + 0.5) * g.cell);
        if (si >= 0) sums.set(si, (sums.get(si) ?? 0) + v);
      }
    }
    const total = [...sums.values()].reduce((s, v) => s + v, 0) || 1;
    const polyArea = (id: string) => {
      const room = spatial.rooms.find((r) => r.id === id) ?? spatial.circulation.find((c) => c.id === id);
      return room ? area(room.polygon) : 1;
    };
    return [...sums.entries()]
      .map(([si, v]) => ({ space: loc.spaces[si], share: v / total, density: v / total / polyArea(loc.spaces[si].id) }))
      .sort((x, y) => y.share - x.share)
      .slice(0, 10);
  }, [heat, a, spatial]);
  if (!heat) return null;
  const metricName = { presence: 'presence', movement: 'movement', frequency: 'passes', encounters: 'encounters' }[heat.metric];
  return (
    <div>
      <DataQualityNotes />
      <Definition k={{ presence: 'heatPresence', movement: 'heatMovement', frequency: 'heatFrequency', encounters: 'heatEncounters' }[heat.metric]} />
      <SectionTitle>Spaces with the most {metricName}</SectionTitle>
      <table className="w-full text-[11.5px] tnum">
        <thead>
          <tr className="text-left text-[10.5px] text-muted">
            <th className="pb-1 font-medium">Space</th>
            <th className="pb-1 text-right font-medium">Share</th>
            <th className="pb-1 text-right font-medium" title="Share per unit floor area">Intensity / {unit === 'ft' ? '100 sf' : '10 m²'}</th>
          </tr>
        </thead>
        <tbody>
          {ranking.map((r) => (
            <tr key={r.space.id} className="border-t border-line-2">
              <td className="py-1">
                {r.space.name} {r.space.kind === 'circulation' && <Badge>circ.</Badge>}
              </td>
              <td className="py-1 text-right">{fmtPct(r.share, 1)}</td>
              <td className="py-1 text-right">{fmtPct(r.density * (unit === 'ft' ? 9.2903 : 10), 1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[10.5px] leading-snug text-muted">
        Heatmap intensity reflects where tracked staff spent time or passed, within the selected window and filters. It is not a measure of congestion — see the Congestion view for simultaneous overlap.
      </p>
    </div>
  );
}

export function CongestionView() {
  const c = useCongestion();
  const threshold = useUI((s) => s.congestionThreshold);
  const ds = useActiveDataset();
  const p = useProject((s) => s.project!);
  const loc = getLocator(p.spatial);
  const ctx = useSpatialContext();
  if (!c || !ds) return null;
  const segName = (s: { spaceId: string; cx: number; cy: number }) => {
    const space = loc.spaces[loc.index.get(s.spaceId) ?? -1]?.name ?? '';
    let best: { name: string; d: number } | null = null;
    for (const r of p.spatial.rooms) {
      const ap = ctx.activityPoint.get(r.id);
      if (!ap) continue;
      const d = Math.hypot(ap.x - s.cx, ap.y - s.cy);
      if (!best || d < best.d) best = { name: r.number ? `${r.name} ${r.number}` : r.name, d };
    }
    return best ? `${space} near ${best.name}` : space;
  };
  const peak = c.segments.reduce((b, s) => (s.peak > (b?.peak ?? -1) ? s : b), c.segments[0]);
  const above = Math.max(0, ...c.segments.map((s) => s.secondsAtOrAbove));
  const anyAbove = (() => {
    let n = 0;
    for (let i = 0; i < c.maxSeries.length; i++) if (c.maxSeries[i] >= threshold) n++;
    return n * c.options.stepS;
  })();
  const bin = 300;
  const per = bin / c.options.stepS;
  const series: Record<string, number>[] = [];
  for (let i = 0; i < c.maxSeries.length; i += per) {
    let mx = 0;
    let circ = 0;
    for (let j = i; j < Math.min(c.maxSeries.length, i + per); j++) {
      mx = Math.max(mx, c.maxSeries[j]);
      circ = Math.max(circ, c.circSeries[j]);
    }
    series.push({ t: c.options.range[0] + i * c.options.stepS, max: mx, circ });
  }
  const top = [...c.segments].filter((s) => s.peak >= 2).sort((a, b) => b.secondsAtOrAbove - a.secondsAtOrAbove || b.peak - a.peak).slice(0, 8);
  const roleName = (id: string | null) => p.roles.find((r) => r.id === id)?.shortName ?? '?';
  const pairs = new Map<string, number>();
  for (const e of c.encounters) {
    const k = [roleName(e.roleA), roleName(e.roleB)].sort().join(' – ');
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  const hourly = new Map<number, number>();
  for (const e of c.encounters) hourly.set(Math.floor(e.t / 3600), (hourly.get(Math.floor(e.t / 3600)) ?? 0) + 1);
  const peakHour = [...hourly.entries()].sort((a, b) => b[1] - a[1])[0];
  const warn = ds.meta.kind === 'observed' && (ds.meta.positionAccuracyM == null || ds.meta.positionAccuracyM > 0.5);
  return (
    <div>
      {warn && (
        <div className="mb-3 flex gap-1.5 rounded-[3px] border border-[#ecd9b0] bg-[#fdf8ec] p-2 text-[11px] text-[#7a5410]">
          <TriangleAlert size={12} className="mt-[1px] shrink-0" />
          Positional accuracy is {ds.meta.positionAccuracyM == null ? 'unknown' : `about ${ds.meta.positionAccuracyM} m`}; segment-level overlap and encounter counts may be unreliable at this resolution.
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Stat label="Peak in a segment" value={peak?.peak ?? 0} sub={peak ? `${segName(peak)} · ${fmtClock(peak.peakAt)}` : undefined} />
        <Stat label={`Any segment ≥ ${threshold}`} value={fmtDuration(anyAbove)} sub={`longest single segment ${fmtDuration(above)}`} />
        <Stat label="Encounters" value={fmtInt(c.encounters.length)} sub={peakHour ? `most at ${hourFmt(peakHour[0])} (${peakHour[1]})` : undefined} />
        <Stat label="Prolonged stops in circulation" value={c.prolongedDwell.length} sub="≥ 60 s nearly stationary" />
      </div>
      <ChartFrame title="Maximum simultaneous people in any circulation segment" sub="5-minute maxima">
        <AreaSeries data={series} xKey="t" yKey="max" name="Max in a segment" color="#a14512" fmt={(v) => String(v)} xFmt={(t) => fmtClock(t)} threshold={threshold} />
      </ChartFrame>
      <ChartFrame title="People in circulation" sub="5-minute maxima" height={110}>
        <AreaSeries data={series} xKey="t" yKey="circ" name="In circulation" color="#256abf" fmt={(v) => String(v)} xFmt={(t) => fmtClock(t)} />
      </ChartFrame>
      <SectionTitle>Recurring overlap locations</SectionTitle>
      <table className="w-full text-[11.5px] tnum">
        <thead>
          <tr className="text-left text-[10.5px] text-muted">
            <th className="pb-1 font-medium">Location</th>
            <th className="pb-1 text-right font-medium">Peak</th>
            <th className="pb-1 text-right font-medium">≥ {threshold}</th>
            <th className="pb-1 text-right font-medium">Person-time</th>
          </tr>
        </thead>
        <tbody>
          {top.map((s) => (
            <tr key={s.index} className="cursor-pointer border-t border-line-2 hover:bg-black/[0.02]" onClick={() => clock.set(s.peakAt)} title="Jump playback to peak">
              <td className="max-w-[190px] truncate py-1" title={segName(s)}>{segName(s)}</td>
              <td className="py-1 text-right">{s.peak}</td>
              <td className="py-1 text-right">{fmtDuration(s.secondsAtOrAbove)}</td>
              <td className="py-1 text-right">{fmtDuration(s.personSeconds)}</td>
            </tr>
          ))}
          {!top.length && (
            <tr>
              <td colSpan={4} className="py-2 text-center text-muted">
                No segment held two or more tracked people at once.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <SectionTitle>Encounters by role pair</SectionTitle>
      <HBars data={[...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ name: k, value: v, color: '#6da7ec' }))} fmt={(v) => String(v)} />
      <div className="mt-2 space-y-1.5">
        <Definition k="segmentOccupancy" />
        <Definition k="encounter" />
      </div>
    </div>
  );
}

export function ODView() {
  const a = useAnalysis();
  const [by, setBy] = useState<'type' | 'room'>('type');
  const [measure, setMeasure] = useState<'trips' | 'avg' | 'total'>('trips');
  const highlight = useUI((s) => s.odHighlight);
  const setHighlight = useUI((s) => s.setOdHighlight);
  const roles = useProject((s) => s.project!.roles);
  const { dFmt } = useUnits();
  const od = useMemo(() => (a ? buildOD(a.trips, a.locator, by) : null), [a, by]);
  if (!a || !od) return null;
  const keys = od.keys.slice(0, by === 'type' ? 12 : 14);
  const label = (k: string) => (by === 'type' ? k : (a.locator.spaces[a.locator.index.get(k) ?? -1]?.name ?? k));
  const short = (k: string) => {
    const l = label(k);
    return l.length > 12 ? l.replace('Medical Assistant Workstation', 'MA work').replace('Room', '').slice(0, 12) : l;
  };
  const val = (c: { trips: number; totalDistanceM: number } | undefined) => (!c ? 0 : measure === 'trips' ? c.trips : measure === 'avg' ? c.totalDistanceM / c.trips : c.totalDistanceM);
  const maxV = Math.max(1e-9, ...[...od.cells.values()].map((c) => val(c)));
  const cells = [...od.cells.values()].sort((x, y) => y.trips - x.trips);
  return (
    <div>
      <div className="flex gap-2">
        <Segmented size="sm" value={by} onChange={(v) => (setBy(v), setHighlight(null))} options={[{ value: 'type', label: 'By function' }, { value: 'room', label: 'By room' }]} />
        <Segmented size="sm" value={measure} onChange={setMeasure} options={[{ value: 'trips', label: 'Trips' }, { value: 'avg', label: 'Avg length' }, { value: 'total', label: 'Total dist.' }]} />
      </div>
      <SectionTitle right={highlight && <button className="text-[10.5px] text-accent" onClick={() => setHighlight(null)}>Clear highlight</button>}>Origin → destination matrix</SectionTitle>
      <div className="overflow-auto">
        <table className="border-separate border-spacing-[2px] text-[10px] tnum">
          <thead>
            <tr>
              <th className="sticky left-0 bg-panel text-left text-[9.5px] font-medium text-muted">from \ to</th>
              {keys.map((k) => (
                <th key={k} className="h-[74px] min-w-[22px] align-bottom font-medium text-muted">
                  <div className="w-[14px] origin-bottom-left translate-x-[12px] -rotate-60 whitespace-nowrap">{short(k)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((r) => (
              <tr key={r}>
                <td className="sticky left-0 max-w-[96px] truncate bg-panel pr-1 text-[10px] text-ink-2" title={label(r)}>
                  {short(r)}
                </td>
                {keys.map((c) => {
                  const cell = od.cells.get(odKey(r, c));
                  const v = val(cell);
                  const t = v / maxV;
                  const sel = highlight?.fromType === r && highlight?.toType === c;
                  return (
                    <td
                      key={c}
                      title={cell ? `${label(r)} → ${label(c)}: ${cell.trips} trips, avg ${dFmt(cell.totalDistanceM / cell.trips)}` : `${label(r)} → ${label(c)}: none`}
                      onClick={() => cell && by === 'type' && setHighlight(sel ? null : { fromType: r, toType: c })}
                      className={cx('h-[22px] min-w-[22px] rounded-[2px] text-center', cell && by === 'type' && 'cursor-pointer', sel && 'ring-2 ring-accent')}
                      style={{ background: cell ? rgbStr(rampRGB('blue', 0.05 + 0.95 * t)) : '#f3f2ef', color: t > 0.55 ? '#fff' : '#3a4147' }}
                    >
                      {cell ? (measure === 'trips' ? cell.trips : '') : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {by === 'type' && <p className="mt-1 text-[10px] text-muted">Click a cell to highlight those journeys on the plan.</p>}
      <SectionTitle>Top relationships</SectionTitle>
      <table className="w-full text-[11.5px] tnum">
        <thead>
          <tr className="text-left text-[10.5px] text-muted">
            <th className="pb-1 font-medium">From → to</th>
            <th className="pb-1 text-right font-medium">Trips</th>
            <th className="pb-1 text-right font-medium">Avg</th>
            <th className="pb-1 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {cells.slice(0, 12).map((c) => (
            <tr
              key={odKey(c.from, c.to)}
              className={cx('border-t border-line-2', by === 'type' && 'cursor-pointer hover:bg-black/[0.02]', highlight?.fromType === c.from && highlight.toType === c.to && 'bg-accent-soft')}
              onClick={() => by === 'type' && setHighlight({ fromType: c.from, toType: c.to })}
            >
              <td className="py-1">
                <div className="max-w-[170px] truncate">
                  {label(c.from)} → {label(c.to)}
                </div>
                <div className="flex gap-1">
                  {Object.entries(c.byRole).map(([rid, n]) => (
                    <span key={rid} className="text-[9.5px] text-muted">
                      <span className="mr-0.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: roles.find((r) => r.id === rid)?.color ?? '#999' }} />
                      {n}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-1 text-right align-top">{c.trips}</td>
              <td className="py-1 text-right align-top">{dFmt(c.totalDistanceM / c.trips)}</td>
              <td className="py-1 text-right align-top">{fmtDuration(c.totalTimeS)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <Definition k="trip" />
      </div>
    </div>
  );
}

export function TimeView() {
  const a = useAnalysis();
  const roles = useProject((s) => s.project!.roles);
  const hm = useUI((s) => s.heatmap);
  const setHeatmap = useUI((s) => s.setHeatmap);
  const setLayer = useUI((s) => s.setLayer);
  const { toU, uLabel } = useUnits();
  if (!a) return null;
  const rows = roleRows(a, roles);
  const h0 = Math.floor(a.options.range[0] / 3600);
  const h1 = Math.ceil(a.options.range[1] / 3600);
  const hourly: Record<string, number>[] = [];
  for (let h = h0; h < h1; h++) {
    const o: Record<string, number> = { h };
    for (const r of rows) {
      const st = a.staff.filter((s) => s.roleId === r.role.id);
      o[r.role.id] = st.length ? toU(st.reduce((q, s) => q + s.hourlyDistanceM[h % 24], 0) / st.length) : 0;
    }
    hourly.push(o);
  }
  // Occupancy over time: staff in rooms vs circulation (10-min means).
  const binsPer = Math.max(1, Math.round(600 / a.options.binS));
  const occ: Record<string, number>[] = [];
  for (let b = 0; b < a.binCount; b += binsPer) {
    let room = 0;
    let circ = 0;
    for (const s of a.spaces) {
      let v = 0;
      for (let k = b; k < Math.min(a.binCount, b + binsPer); k++) v += s.occupancy[k];
      v /= Math.min(binsPer, a.binCount - b);
      if (s.kind === 'room') room += v;
      else circ += v;
    }
    occ.push({ t: a.options.range[0] + b * a.options.binS, room, circ });
  }
  // Room activity by type and hour (visit starts).
  const types = [...new Set(a.spaces.filter((s) => s.kind === 'room').map((s) => s.type))];
  const grid = types.map((t) => {
    const arr = new Array(h1 - h0).fill(0);
    for (const s of a.staff) for (const v of s.visits) if (a.locator.spaces[v.spaceIndex].type === t) arr[Math.floor(v.start / 3600) - h0] += 1;
    return { t, arr };
  });
  const gmax = Math.max(1, ...grid.flatMap((g) => g.arr));
  return (
    <div>
      <ChartFrame title="Distance per person by hour" sub={`${uLabel}, average across each role`}>
        <Lines data={hourly} xKey="h" xFmt={hourFmt} fmt={(v) => fmtInt(v)} series={rows.map((r) => ({ key: r.role.id, name: r.role.shortName, color: r.role.color }))} />
      </ChartFrame>
      <ChartFrame title="Tracked staff by location type" sub="Mean simultaneous people, 10-minute bins">
        <Lines
          data={occ}
          xKey="t"
          xFmt={(t) => fmtClock(t)}
          fmt={(v) => v.toFixed(1)}
          series={[
            { key: 'room', name: 'In rooms', color: '#2a78d6' },
            { key: 'circ', name: 'In circulation', color: '#eb6834' },
          ]}
        />
      </ChartFrame>
      <SectionTitle>Room visits by function and hour</SectionTitle>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[10px] tnum">
          <thead>
            <tr>
              <th />
              {Array.from({ length: h1 - h0 }, (_, i) => (
                <th key={i} className="font-medium text-muted">
                  {hourFmt(h0 + i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((g) => (
              <tr key={g.t}>
                <td className="max-w-[110px] truncate pr-1 text-ink-2" title={g.t}>
                  {g.t.replace('Medical Assistant Workstation', 'MA workstation')}
                </td>
                {g.arr.map((v, i) => (
                  <td key={i} className="h-[18px] min-w-[24px] rounded-[2px] text-center" style={{ background: v ? rgbStr(rampRGB('blue', 0.05 + 0.95 * (v / gmax))) : '#f3f2ef', color: v / gmax > 0.55 ? '#fff' : '#52514e' }} title={`${g.t}, ${hourFmt(h0 + i)}: ${v} visits`}>
                    {v || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionTitle>Heatmap animation</SectionTitle>
      <label className="flex items-center gap-2 text-[12px] text-ink-2">
        <input
          type="checkbox"
          checked={hm.rolling}
          onChange={(e) => {
            setHeatmap({ rolling: e.target.checked });
            if (e.target.checked) setLayer('heatmap', { visible: true });
          }}
        />
        Animate heatmap as a rolling {hm.rollingMinutes}-minute window during playback
      </label>
      <p className="mt-2 text-[10.5px] text-muted">All charts follow the analysis window set on the timeline.</p>
    </div>
  );
}

export function CompareView() {
  const cmp = useUI((s) => s.compare);
  const setCompare = useUI((s) => s.setCompare);
  const roles = useProject((s) => s.project!.roles);
  const spatial = useProject((s) => s.project!.spatial);
  const roomTypes = useProject((s) => s.project!.roomTypes);
  const minGroup = useProject((s) => s.project!.prefs.minGroupSize);
  const a = useAnalysis();
  const observed = useData((s) => s.observed);
  const sim = useData((s) => s.simulation);
  const activeId = useData((s) => s.activeId);
  const sides = useCompareSides();
  const { dFmt, toU, uLabel } = useUnits();
  const analyses = useMemo(() => {
    if (!sides) return null;
    return { A: analyzeCached(sides.a.tracks, spatial, roomTypes, sides.a.range), B: analyzeCached(sides.b.tracks, spatial, roomTypes, sides.b.range) };
  }, [sides, spatial, roomTypes]);
  const datasetOpts = [
    ...(sim && activeId !== 'simulation' ? [{ value: 'simulation', label: 'Simulation' }] : []),
    ...Object.values(observed)
      .filter((o) => o.meta.id !== activeId)
      .map((o) => ({ value: o.meta.id, label: `Observed · ${o.meta.name}` })),
  ];
  const summary = (an: typeof a) => {
    if (!an) return null;
    const trackedH = an.staff.reduce((s, x) => s + x.trackedS, 0) / 3600;
    const dist = an.staff.reduce((s, x) => s + x.distanceM, 0);
    const trips = an.trips.length;
    const moving = an.staff.reduce((s, x) => s + x.movingS, 0);
    const tripTime = an.trips.reduce((s, t) => s + (t.end - t.start), 0);
    const visits = an.staff.reduce((s, x) => s + x.visits.length, 0);
    const dwell = an.staff.reduce((s, x) => s + x.visits.reduce((q, v) => q + v.end - v.start, 0), 0);
    return {
      n: an.staff.length,
      trackedH,
      dist,
      distPerH: dist / Math.max(1e-9, trackedH),
      tripsPerH: trips / Math.max(1e-9, trackedH),
      avgTrip: trips ? an.trips.reduce((s, t) => s + t.distanceM, 0) / trips : NaN,
      avgTripTime: trips ? tripTime / trips : NaN,
      moving: moving / Math.max(1, trackedH * 3600),
      visitsPerH: visits / Math.max(1e-9, trackedH),
      avgDwell: visits ? dwell / visits : NaN,
    };
  };
  const SA = summary(analyses?.A ?? null);
  const SB = summary(analyses?.B ?? null);
  const kindsDiffer = sides && sides.a.dataset.meta.kind !== sides.b.dataset.meta.kind;
  const metricRows: [string, (s: NonNullable<typeof SA>) => string, (s: NonNullable<typeof SA>) => number][] = [
    ['Tracked staff', (s) => String(s.n), (s) => s.n],
    ['Tracked staff-hours', (s) => s.trackedH.toFixed(1), (s) => s.trackedH],
    ['Total distance', (s) => fmtDistanceLong(s.dist, useProject.getState().project!.prefs.units), (s) => s.dist],
    ['Distance per staff-hour', (s) => dFmt(s.distPerH), (s) => s.distPerH],
    ['Trips per staff-hour', (s) => s.tripsPerH.toFixed(1), (s) => s.tripsPerH],
    ['Average trip length', (s) => dFmt(s.avgTrip), (s) => s.avgTrip],
    ['Average trip time', (s) => fmtDuration(s.avgTripTime), (s) => s.avgTripTime],
    ['Share of time moving', (s) => fmtPct(s.moving), (s) => s.moving],
    ['Room visits per staff-hour', (s) => s.visitsPerH.toFixed(1), (s) => s.visitsPerH],
    ['Average visit dwell', (s) => fmtDuration(s.avgDwell), (s) => s.avgDwell],
  ];

  return (
    <div>
      <Segmented
        className="w-full"
        size="sm"
        value={cmp.mode}
        onChange={(mode) => setCompare({ mode })}
        options={[
          { value: 'roles', label: 'Roles' },
          { value: 'periods', label: 'Time periods' },
          { value: 'datasets', label: 'Datasets' },
        ]}
      />
      {cmp.mode === 'roles' && a && (
        <>
          <SectionTitle>Normalized role comparison</SectionTitle>
          <RoleTable rows={roleRows(a, roles)} minGroup={minGroup} />
          <ChartFrame title="Distance per tracked hour" sub={uLabel} height={Math.max(80, roleRows(a, roles).length * 26 + 16)}>
            <HBars data={roleRows(a, roles).filter((r) => r.n >= minGroup).map((r) => ({ name: r.role.shortName, value: toU(r.distPerHour), color: r.role.color }))} fmt={(v) => `${fmtInt(v)} ${uLabel}`} />
          </ChartFrame>
          <ChartFrame title="Trips per tracked hour" height={Math.max(80, roleRows(a, roles).length * 26 + 16)}>
            <HBars data={roleRows(a, roles).filter((r) => r.n >= minGroup).map((r) => ({ name: r.role.shortName, value: r.tripsPerHour, color: r.role.color }))} fmt={(v) => v.toFixed(1)} />
          </ChartFrame>
          <Definition>Per-hour values divide by each role's tracked time, so roles with different staff counts or shift lengths are comparable.</Definition>
        </>
      )}
      {cmp.mode === 'periods' && (
        <div className="mt-3 rounded-[3px] border border-line-2 bg-paper p-2 text-[12px]">
          <div className="mb-1 text-muted">
            <b className="text-ink">A</b> = timeline window. <b className="text-ink">B</b> =
          </div>
          <div className="flex items-center gap-1.5">
            <input type="time" className="h-7 rounded-[3px] border border-line px-1 text-[12px]" value={toClock(cmp.bStart)} onChange={(e) => setCompare({ bStart: fromClock(e.target.value) })} />
            –
            <input type="time" className="h-7 rounded-[3px] border border-line px-1 text-[12px]" value={toClock(cmp.bEnd)} onChange={(e) => setCompare({ bEnd: fromClock(e.target.value) })} />
          </div>
        </div>
      )}
      {cmp.mode === 'datasets' && (
        <div className="mt-3">
          {datasetOpts.length ? (
            <Select value={cmp.bDataset ?? ''} onChange={(v) => setCompare({ bDataset: v || null })} options={[{ value: '', label: 'Choose dataset B…' }, ...datasetOpts]} />
          ) : (
            <div className="text-[12px] text-muted">Import an observed dataset (or run a simulation) to compare two datasets.</div>
          )}
          {kindsDiffer && (
            <div className="mt-2 flex gap-1.5 rounded-[3px] border border-[#ecd9b0] bg-[#fdf8ec] p-2 text-[11px] text-[#7a5410]">
              <TriangleAlert size={12} className="mt-[1px] shrink-0" />
              Comparing simulated with observed data. Simulated values are hypothetical; differences are not evidence of model error or performance.
            </div>
          )}
        </div>
      )}
      {cmp.mode !== 'roles' && sides && SA && SB && (
        <>
          <SectionTitle>Side by side</SectionTitle>
          <table className="w-full text-[11.5px] tnum">
            <thead>
              <tr className="text-left text-[10.5px] text-muted">
                <th className="pb-1 font-medium">Metric</th>
                <th className="pb-1 text-right font-medium">A · {sides.a.label}</th>
                <th className="pb-1 text-right font-medium">B · {sides.b.label}</th>
                <th className="pb-1 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map(([name, f, g]) => {
                const va = g(SA);
                const vb = g(SB);
                const d = Number.isFinite(va) && va !== 0 ? (vb - va) / va : NaN;
                return (
                  <tr key={name} className="border-t border-line-2">
                    <td className="py-1">{name}</td>
                    <td className="py-1 text-right">{f(SA)}</td>
                    <td className="py-1 text-right">{f(SB)}</td>
                    <td className="py-1 text-right text-muted">{Number.isFinite(d) ? `${d > 0 ? '+' : ''}${Math.round(d * 100)}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <label className="mt-3 flex items-center gap-2 text-[12px] text-ink-2">
            <input type="checkbox" checked={cmp.diffMap} onChange={(e) => setCompare({ diffMap: e.target.checked })} />
            Show difference map on plan (movement density, per staff-hour)
          </label>
          <p className="mt-2 text-[10.5px] text-muted">Per-hour rows normalize for different window lengths and staff counts. Role filters apply to both sides.</p>
        </>
      )}
    </div>
  );
}

const toClock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
const fromClock = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 3600 + (m || 0) * 60;
};
