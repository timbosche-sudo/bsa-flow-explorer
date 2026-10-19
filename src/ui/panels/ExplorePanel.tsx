import { useMemo } from 'react';
import { Database, Route, UserRound, Users } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { isSimulationStale, useActiveDataset, useData } from '@/store/dataStore';
import { useAnalysis } from '@/store/analysis';
import { Badge, Section, Segmented, Select, Slider, Toggle, cx } from '@/ui/components/controls';
import { fmtDistance } from '@/ui/format';
import { LayersSection, useSectionState } from './PlanPanels';
import { RunSimulationButton } from './ConfigurePanel';

export function ExplorePanel() {
  const { open, toggle } = useSectionState({ data: true, staff: true, trails: true, layers: false });
  return (
    <>
      <DatasetSection open={open.data} onToggle={() => toggle('data')} />
      <StaffListSection open={open.staff} onToggle={() => toggle('staff')} />
      <TrailsSection open={open.trails} onToggle={() => toggle('trails')} />
      <LayersSection open={open.layers} onToggle={() => toggle('layers')} />
    </>
  );
}

export function DatasetSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const ds = useActiveDataset();
  const activeId = useData((s) => s.activeId);
  const observed = useData((s) => s.observed);
  const sim = useData((s) => s.simulation);
  const project = useProject((s) => s.project!);
  const stale = isSimulationStale(project, sim);
  const opts = [
    { value: 'simulation', label: sim ? `Simulation · seed ${sim.meta.id.replace('sim-', '')}` : 'Simulation (not run)' },
    ...Object.values(observed).map((o) => ({ value: o.meta.id, label: `Observed · ${o.meta.name}` })),
  ];
  return (
    <Section title="Dataset" icon={<Database size={13} />} open={open} onToggle={onToggle}>
      <Select value={activeId} onChange={(v) => useData.getState().setActive(v)} options={opts} />
      <div className="mt-2 text-2xs leading-relaxed text-muted">
        {ds ? (
          <>
            <Badge tone={ds.meta.kind === 'simulated' ? 'sim' : 'obs'}>{ds.meta.kind}</Badge> {ds.tracks.length} tracks · {ds.meta.source}
          </>
        ) : (
          'No movement data loaded.'
        )}
      </div>
      {activeId === 'simulation' && stale && (
        <div className="mt-2">
          {sim && <div className="mb-1.5 text-2xs text-warn">Spatial model or settings changed since this simulation was generated.</div>}
          <RunSimulationButton className="w-full" />
        </div>
      )}
    </Section>
  );
}

export function RoleChips() {
  const roles = useProject((s) => s.project!.roles);
  const ds = useActiveDataset();
  const roleFilter = useUI((s) => s.roleFilter);
  const setRoleFilter = useUI((s) => s.setRoleFilter);
  const present = useMemo(() => new Set((ds?.tracks ?? []).map((t) => t.roleId)), [ds]);
  const shown = roles.filter((r) => present.has(r.id));
  return (
    <div className="flex flex-wrap gap-1">
      <button onClick={() => setRoleFilter([])} className={cx('rounded-[2px] px-1.5 py-0.5 text-[11px] font-medium', !roleFilter.length ? 'bg-ink text-white' : 'bg-line-2 text-ink-2')}>
        All roles
      </button>
      {shown.map((r) => {
        const on = roleFilter.includes(r.id);
        return (
          <button
            key={r.id}
            onClick={() => setRoleFilter(on ? roleFilter.filter((x) => x !== r.id) : [...roleFilter, r.id])}
            className={cx('inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 text-[11px] font-medium', on ? 'bg-ink text-white' : 'bg-line-2 text-ink-2 hover:bg-line')}
            title={r.name}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
            {r.shortName}
          </button>
        );
      })}
    </div>
  );
}

function StaffListSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const ds = useActiveDataset();
  const staffDefs = useProject((s) => s.project!.staff);
  const roles = useProject((s) => s.project!.roles);
  const unit = useProject((s) => s.project!.prefs.units);
  const selection = useUI((s) => s.selection);
  const select = useUI((s) => s.select);
  const roleFilter = useUI((s) => s.roleFilter);
  const analysis = useAnalysis({ ignoreFilters: true });
  const byId = new Map(analysis?.staff.map((s) => [s.staffId, s]));
  const label = (id: string) => staffDefs.find((s) => s.id === id)?.code ?? id;
  return (
    <Section title="Tracked staff" icon={<Users size={13} />} open={open} onToggle={onToggle} badge={ds && <Badge>{ds.tracks.length}</Badge>}>
      <RoleChips />
      <div className="mt-2 max-h-[300px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
        {(ds?.tracks ?? []).map((t) => {
          const role = roles.find((r) => r.id === t.roleId);
          const a = byId.get(t.staffId);
          const sel = selection?.kind === 'staff' && selection.id === t.staffId;
          const dim = roleFilter.length > 0 && !roleFilter.includes(t.roleId ?? '');
          return (
            <button
              key={t.staffId}
              onClick={() => select(sel ? null : { kind: 'staff', id: t.staffId })}
              className={cx('flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px]', sel ? 'bg-accent-soft' : 'hover:bg-black/[0.03]', dim && 'opacity-40')}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: role?.color ?? '#999' }} />
              <span className="w-16 font-medium tnum">{label(t.staffId)}</span>
              <span className="flex-1 truncate text-2xs text-muted">{role?.name ?? 'Unassigned role'}</span>
              <span className="tnum text-2xs text-muted">{a ? fmtDistance(a.distanceM, unit) : ''}</span>
            </button>
          );
        })}
        {!ds && <div className="p-3 text-center text-2xs text-muted">No movement data.</div>}
      </div>
      <p className="mt-1.5 text-2xs text-muted">Distances cover the selected time window. Click a person (or their marker with the Select staff tool) for details.</p>
    </Section>
  );
}

function TrailsSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const trails = useUI((s) => s.trails);
  const setTrails = useUI((s) => s.setTrails);
  const markers = useUI((s) => s.markers);
  const setMarkers = useUI((s) => s.setMarkers);
  const ds = useActiveDataset();
  return (
    <Section title="Trajectories & markers" icon={<Route size={13} />} open={open} onToggle={onToggle}>
      <Segmented
        className="w-full"
        size="sm"
        value={trails.mode}
        onChange={(mode) => setTrails({ mode })}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'tail', label: 'Trail', title: 'Recent movement only' },
          { value: 'buildup', label: 'Build-up', title: 'Paths accumulate during playback' },
          { value: 'full', label: 'Full', title: 'All paths in the selected window' },
        ]}
      />
      <div className="mt-2 space-y-1">
        {trails.mode === 'tail' && <Slider label="Trail length" min={1} max={30} step={1} value={trails.tailMinutes} onChange={(tailMinutes) => setTrails({ tailMinutes })} format={(v) => `${v} min`} />}
        <Slider label="Line width" min={0.5} max={5} step={0.25} value={trails.width} onChange={(width) => setTrails({ width })} format={(v) => `${v} px`} />
        <Slider label="Line opacity" min={0.05} max={1} step={0.05} value={trails.opacity} onChange={(opacity) => setTrails({ opacity })} format={(v) => `${Math.round(v * 100)}%`} />
        <Toggle label="Temporal fading" checked={trails.fade} onChange={(fade) => setTrails({ fade })} />
        <Toggle label="Direction arrows" checked={trails.arrows} onChange={(arrows) => setTrails({ arrows })} />
        <Toggle label="Path labels" checked={trails.showLabels} onChange={(showLabels) => setTrails({ showLabels })} />
      </div>
      <div className="mt-3 mb-1 flex items-center gap-1.5 text-2xs font-medium tracking-[0.06em] text-muted uppercase">
        <UserRound size={12} /> Markers
      </div>
      <Toggle label="Staff IDs" checked={markers.labels} onChange={(labels) => setMarkers({ labels })} />
      <Toggle label="Direction indicator" checked={markers.direction} onChange={(direction) => setMarkers({ direction })} />
      <Toggle
        label={
          <span>
            Current destination <span className="text-2xs text-faint">(simulation only)</span>
          </span>
        }
        checked={markers.destination && ds?.meta.kind === 'simulated'}
        onChange={(destination) => setMarkers({ destination })}
      />
      <p className="mt-1.5 text-2xs text-muted">Hollow dashed markers show the last known position during a tracking gap.</p>
    </Section>
  );
}
