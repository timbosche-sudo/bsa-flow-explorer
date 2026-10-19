import { useMemo, useState } from 'react';
import { ChevronRight, Clock, Dices, Play, Plus, Trash2, Users, Workflow } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { isSimulationStale, useData } from '@/store/dataStore';
import { usePlayback } from '@/store/playback';
import { Badge, Button, Field, NumberInput, Section, Select, Slider, TextInput, cx } from '@/ui/components/controls';
import { ROLE_PALETTE, uid } from '@/domain/defaults';
import type { ActivityDef, BreakDef, DurationDist, StaffRole } from '@/domain/types';
import { clockInputToMinutes, minutesToClockInput } from '@/ui/format';
import { useSectionState } from './PlanPanels';

export function ConfigurePanel() {
  const { open, toggle } = useSectionState({ sim: true, staff: true, roles: true, peaks: false });
  return (
    <>
      <SimulationSection open={open.sim} onToggle={() => toggle('sim')} />
      <StaffSection open={open.staff} onToggle={() => toggle('staff')} />
      <RolesSection open={open.roles} onToggle={() => toggle('roles')} />
      <PeaksSection open={open.peaks} onToggle={() => toggle('peaks')} />
    </>
  );
}

export function RunSimulationButton({ className }: { className?: string }) {
  const project = useProject((s) => s.project!);
  const sim = useData((s) => s.simulation);
  const status = useData((s) => s.simStatus);
  const stale = isSimulationStale(project, sim);
  return (
    <Button
      variant={stale ? 'primary' : 'default'}
      className={className}
      icon={<Play size={13} />}
      disabled={status === 'running' || !project.staff.length}
      onClick={() => {
        usePlayback.getState().setStudy(project.simulation.studyStartMin * 60, project.simulation.studyEndMin * 60);
        void useData.getState().runSimulation(project);
        useData.getState().setActive('simulation');
      }}
    >
      {status === 'running' ? 'Simulating…' : stale ? (sim ? 'Re-run simulation' : 'Run simulation') : 'Simulation up to date'}
    </Button>
  );
}

function SimulationSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const cfg = useProject((s) => s.project!.simulation);
  const update = useProject((s) => s.updateSimulation);
  const sim = useData((s) => s.simulation);
  const err = useData((s) => s.simError);
  const project = useProject((s) => s.project!);
  const stale = isSimulationStale(project, sim);
  return (
    <Section title="Simulation" icon={<Workflow size={13} />} open={open} onToggle={onToggle} badge={sim && !stale ? <Badge tone="sim">Ready</Badge> : <Badge tone="warn">{sim ? 'Outdated' : 'Not run'}</Badge>}>
      <div className="space-y-2.5">
        <p className="text-2xs leading-relaxed text-muted">
          Activity-based, explicitly hypothetical movement generated from the roles, workflows and spatial model below. Results are labelled <b>simulated</b> everywhere.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Study start">
            <input type="time" className="h-7 w-full rounded-[3px] border border-line bg-paper px-2 text-[12.5px]" value={minutesToClockInput(cfg.studyStartMin)} onChange={(e) => update({ studyStartMin: clockInputToMinutes(e.target.value) })} />
          </Field>
          <Field label="Study end">
            <input type="time" className="h-7 w-full rounded-[3px] border border-line bg-paper px-2 text-[12.5px]" value={minutesToClockInput(cfg.studyEndMin)} onChange={(e) => update({ studyEndMin: clockInputToMinutes(e.target.value) })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Random seed">
            <div className="flex gap-1">
              <NumberInput className="flex-1" value={cfg.seed} step={1} onCommit={(v) => update({ seed: Math.round(v ?? 1) })} />
              <button title="New random seed" className="rounded-[3px] border border-line px-1.5 text-muted hover:text-ink" onClick={() => update({ seed: Math.floor(Math.random() * 1e6) })}>
                <Dices size={14} />
              </button>
            </div>
          </Field>
          <Field label="Sample interval">
            <NumberInput value={cfg.sampleIntervalS} min={0.5} max={10} step={0.5} suffix="s" onCommit={(v) => update({ sampleIntervalS: v ?? 1 })} />
          </Field>
        </div>
        <Slider label="Position variation in rooms" min={0} max={1.5} step={0.1} value={cfg.positionJitterM} onChange={(positionJitterM) => update({ positionJitterM })} format={(v) => `${v.toFixed(1)} m`} />
        <Field label="Study date">
          <input type="date" className="h-7 w-full rounded-[3px] border border-line bg-paper px-2 text-[12.5px]" value={cfg.studyDate} onChange={(e) => update({ studyDate: e.target.value })} />
        </Field>
        <RunSimulationButton className="w-full" />
        {err && <div className="text-2xs text-err">{err}</div>}
        {sim?.warnings.length ? (
          <div className="space-y-0.5 rounded-[3px] bg-[#fdf6e7] p-2 text-2xs text-[#7a5410]">
            {sim.warnings.slice(0, 8).map((w, i) => (
              <div key={i}>• {w}</div>
            ))}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function StaffSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const staff = useProject((s) => s.project!.staff);
  const roles = useProject((s) => s.project!.roles);
  const rooms = useProject((s) => s.project!.spatial.rooms);
  const setStaff = useProject((s) => s.setStaff);
  const updateStaff = useProject((s) => s.updateStaff);
  const [addRole, setAddRole] = useState(roles[0]?.id ?? '');
  const roleOf = (id: string) => roles.find((r) => r.id === id);
  const add = (roleId: string, n = 1) => {
    const role = roleOf(roleId);
    if (!role) return;
    const next = [...staff];
    for (let i = 0; i < n; i++) {
      const count = next.filter((s) => s.roleId === roleId).length + 1;
      const code = `${role.shortName}-${String(count).padStart(2, '0')}`;
      next.push({ id: uid('staff'), code, roleId, homeRoomId: null, shiftStartMin: 8 * 60, shiftEndMin: 16 * 60, tagId: `TAG-${code}` });
    }
    setStaff(next);
  };
  return (
    <Section title="Study population" icon={<Users size={13} />} open={open} onToggle={onToggle} badge={<Badge>{staff.length} staff</Badge>}>
      <div className="mb-2 flex flex-wrap gap-1">
        {roles
          .filter((r) => staff.some((s) => s.roleId === r.id))
          .map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-[2px] bg-paper px-1.5 py-0.5 text-[11px] ring-1 ring-line">
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.shortName} <b className="tnum">{staff.filter((s) => s.roleId === r.id).length}</b>
            </span>
          ))}
      </div>
      <div className="max-h-[280px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
        {staff.map((s) => (
          <div key={s.id} className="grid grid-cols-[70px_1fr_auto] items-center gap-1.5 border-b border-line-2 px-2 py-1 last:border-0">
            <input className="h-6 rounded-[2px] border border-transparent px-1 text-[12px] font-medium tnum hover:border-line focus:border-accent focus:outline-none" defaultValue={s.code} onBlur={(e) => updateStaff(s.id, { code: e.target.value })} />
            <div className="flex min-w-0 items-center gap-1">
              <select className="h-6 min-w-0 flex-1 rounded-[2px] border border-line bg-paper px-1 text-[11.5px]" value={s.roleId} onChange={(e) => updateStaff(s.id, { roleId: e.target.value })}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.shortName}
                  </option>
                ))}
              </select>
              <select className="h-6 min-w-0 flex-1 rounded-[2px] border border-line bg-paper px-1 text-[11.5px]" value={s.homeRoomId ?? ''} title="Home base" onChange={(e) => updateStaff(s.id, { homeRoomId: e.target.value || null })}>
                <option value="">Auto base</option>
                {rooms
                  .filter((r) => roleOf(s.roleId)?.homeBaseTypes.includes(r.type))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.number}
                    </option>
                  ))}
              </select>
            </div>
            <button className="text-faint hover:text-err" title="Remove" onClick={() => setStaff(staff.filter((x) => x.id !== s.id))}>
              <Trash2 size={13} />
            </button>
            <div className="col-span-3 flex items-center gap-1 pb-0.5 pl-1 text-2xs text-muted">
              <Clock size={11} />
              <input type="time" className="h-5 rounded-[2px] border border-line px-1 text-[11px]" value={minutesToClockInput(s.shiftStartMin)} onChange={(e) => updateStaff(s.id, { shiftStartMin: clockInputToMinutes(e.target.value) })} />
              –
              <input type="time" className="h-5 rounded-[2px] border border-line px-1 text-[11px]" value={minutesToClockInput(s.shiftEndMin)} onChange={(e) => updateStaff(s.id, { shiftEndMin: clockInputToMinutes(e.target.value) })} />
              <span className="ml-auto truncate" title="Pseudonymous tag id">{s.tagId}</span>
            </div>
          </div>
        ))}
        {!staff.length && <div className="p-3 text-center text-2xs text-muted">Add simulated staff by role.</div>}
      </div>
      <div className="mt-2 flex gap-1.5">
        <Select className="flex-1" value={addRole} onChange={setAddRole} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
        <Button size="sm" icon={<Plus size={13} />} onClick={() => add(addRole)}>
          Add
        </Button>
      </div>
      <p className="mt-2 text-2xs text-muted">Identifiers are pseudonymous codes. Do not enter employee names.</p>
    </Section>
  );
}

function DistInputs({ value, onChange, unit = 'min' }: { value: DurationDist; onChange: (d: DurationDist) => void; unit?: string }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {(['min', 'mode', 'max'] as const).map((k) => (
        <NumberInput key={k} value={value[k]} min={0} step={0.5} suffix={k === 'mode' ? 'typ' : k} onCommit={(v) => onChange(sanitizeDist({ ...value, [k]: v ?? 0 }))} />
      ))}
      <span className="sr-only">{unit}</span>
    </div>
  );
}

const sanitizeDist = (d: DurationDist): DurationDist => {
  const min = Math.max(0, Math.min(d.min, d.max));
  const max = Math.max(d.min, d.max);
  return { min, max, mode: Math.max(min, Math.min(max, d.mode)) };
};

function TypeMulti({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const types = useProject((s) => s.project!.roomTypes);
  const rooms = useProject((s) => s.project!.spatial.rooms);
  const present = useMemo(() => new Set(rooms.map((r) => r.type)), [rooms]);
  return (
    <div className="flex flex-wrap gap-1">
      {types
        .filter((t) => !t.isCirculation)
        .map((t) => {
          const on = value.includes(t.name);
          return (
            <button
              key={t.name}
              onClick={() => onChange(on ? value.filter((x) => x !== t.name) : [...value, t.name])}
              className={cx('rounded-[2px] px-1.5 py-[1px] text-[10.5px]', on ? 'bg-ink text-white' : 'bg-line-2 text-ink-2 hover:bg-line', !present.has(t.name) && !on && 'opacity-50')}
              title={present.has(t.name) ? '' : 'No rooms of this type in the plan'}
            >
              {t.name}
            </button>
          );
        })}
    </div>
  );
}

function RolesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const roles = useProject((s) => s.project!.roles);
  const setRoles = useProject((s) => s.setRoles);
  const updateRole = useProject((s) => s.updateRole);
  const staff = useProject((s) => s.project!.staff);
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Section title="Roles & workflows" icon={<Workflow size={13} />} open={open} onToggle={onToggle}>
      <div className="space-y-1">
        {roles.map((r) => (
          <div key={r.id} className="rounded-[3px] border border-line-2 bg-paper">
            <button className="flex w-full items-center gap-2 px-2 py-1.5 text-left" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
              <ChevronRight size={13} className={cx('text-faint transition-transform', expanded === r.id && 'rotate-90')} />
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
              <span className="flex-1 truncate text-[12.5px] font-medium">{r.name}</span>
              <span className="tnum text-2xs text-muted">{staff.filter((s) => s.roleId === r.id).length}</span>
            </button>
            {expanded === r.id && <RoleEditor role={r} update={(patch) => updateRole(r.id, patch)} onDelete={() => setRoles(roles.filter((x) => x.id !== r.id))} canDelete={!staff.some((s) => s.roleId === r.id)} />}
          </div>
        ))}
        <Button
          size="sm"
          icon={<Plus size={13} />}
          onClick={() => {
            const id = uid('role');
            setRoles([
              ...roles,
              {
                id,
                name: 'Custom role',
                shortName: 'CUS',
                color: ROLE_PALETTE[roles.length % ROLE_PALETTE.length],
                custom: true,
                homeBaseTypes: ['Nurse Station'],
                homeDwell: { min: 3, mode: 8, max: 15 },
                activities: [],
                breaks: [],
                walkingSpeedMps: 1.2,
                walkingSpeedSd: 0.08,
                locality: 1,
                shiftVariationMin: 5,
              },
            ]);
            setExpanded(id);
          }}
        >
          Add custom role
        </Button>
      </div>
      <p className="mt-2 text-2xs leading-relaxed text-muted">Workflows are illustrative assumptions. Edit them to reflect the operational model being tested.</p>
    </Section>
  );
}

function RoleEditor({ role, update, onDelete, canDelete }: { role: StaffRole; update: (p: Partial<StaffRole>) => void; onDelete: () => void; canDelete: boolean }) {
  const setAct = (id: string, patch: Partial<ActivityDef>) => update({ activities: role.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const setBreak = (id: string, patch: Partial<BreakDef>) => update({ breaks: role.breaks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  return (
    <div className="space-y-2.5 border-t border-line-2 px-2 pt-2 pb-2.5">
      <div className="grid grid-cols-[1fr_64px_32px] gap-1.5">
        <Field label="Name">
          <TextInput value={role.name} onCommit={(name) => update({ name })} />
        </Field>
        <Field label="Code">
          <TextInput value={role.shortName} onCommit={(shortName) => update({ shortName })} />
        </Field>
        <Field label="Col.">
          <input type="color" value={role.color} onChange={(e) => update({ color: e.target.value })} className="h-7 w-full cursor-pointer rounded border border-line" />
        </Field>
      </div>
      <Field label="Home base room types">
        <TypeMulti value={role.homeBaseTypes} onChange={(homeBaseTypes) => update({ homeBaseTypes })} />
      </Field>
      <Field label="Time at home base between tasks (min)">
        <DistInputs value={role.homeDwell} onChange={(homeDwell) => update({ homeDwell })} />
      </Field>
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="Walking speed">
          <NumberInput value={role.walkingSpeedMps} min={0.5} max={2.2} step={0.05} suffix="m/s" onCommit={(v) => update({ walkingSpeedMps: v ?? 1.2 })} />
        </Field>
        <Field label="Shift variation">
          <NumberInput value={role.shiftVariationMin} min={0} max={60} step={1} suffix="min" onCommit={(v) => update({ shiftVariationMin: v ?? 0 })} />
        </Field>
      </div>
      <Slider label="Preference for nearby rooms" min={0} max={3} step={0.1} value={role.locality} onChange={(locality) => update({ locality })} format={(v) => v.toFixed(1)} />

      <div>
        <div className="mb-1 text-2xs font-medium tracking-[0.06em] text-muted uppercase">Activities</div>
        <div className="space-y-1.5">
          {role.activities.map((a) => (
            <div key={a.id} className="rounded-[3px] bg-panel p-1.5 ring-1 ring-line-2">
              <div className="mb-1 flex items-center gap-1">
                <TextInput className="flex-1" value={a.label} onCommit={(label) => setAct(a.id, { label })} />
                <button className="px-1 text-faint hover:text-err" onClick={() => update({ activities: role.activities.filter((x) => x.id !== a.id) })}>
                  <Trash2 size={12} />
                </button>
              </div>
              <TypeMulti value={a.destinationTypes} onChange={(destinationTypes) => setAct(a.id, { destinationTypes })} />
              <div className="mt-1 grid grid-cols-2 gap-1">
                <NumberInput value={a.weight} min={0} step={0.5} suffix="wt" onCommit={(v) => setAct(a.id, { weight: v ?? 0 })} />
                <NumberInput value={a.chainProbability} min={0} max={1} step={0.05} suffix="chain" onCommit={(v) => setAct(a.id, { chainProbability: v ?? 0 })} />
              </div>
              <div className="mt-1">
                <DistInputs value={a.dwell} onChange={(dwell) => setAct(a.id, { dwell })} />
              </div>
            </div>
          ))}
          <Button
            size="sm"
            icon={<Plus size={12} />}
            onClick={() => update({ activities: [...role.activities, { id: uid('act'), label: 'New activity', destinationTypes: ['Exam Room'], weight: 1, dwell: { min: 2, mode: 5, max: 10 }, chainProbability: 0.2 }] })}
          >
            Activity
          </Button>
        </div>
        <p className="mt-1 text-2xs text-muted">wt = relative frequency; chain = probability of continuing to another task without returning to base; durations in minutes (min / typical / max).</p>
      </div>

      <div>
        <div className="mb-1 text-2xs font-medium tracking-[0.06em] text-muted uppercase">Breaks</div>
        <div className="space-y-1.5">
          {role.breaks.map((b) => (
            <div key={b.id} className="rounded-[3px] bg-panel p-1.5 ring-1 ring-line-2">
              <div className="mb-1 flex items-center gap-1">
                <TextInput className="flex-1" value={b.label} onCommit={(label) => setBreak(b.id, { label })} />
                <button className="px-1 text-faint hover:text-err" onClick={() => update({ breaks: role.breaks.filter((x) => x.id !== b.id) })}>
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <NumberInput value={b.earliestMin} min={0} step={15} suffix="from" onCommit={(v) => setBreak(b.id, { earliestMin: v ?? 0 })} />
                <NumberInput value={b.latestMin} min={0} step={15} suffix="to" onCommit={(v) => setBreak(b.id, { latestMin: v ?? 0 })} />
                <NumberInput value={b.durationMin} min={1} step={5} suffix="dur" onCommit={(v) => setBreak(b.id, { durationMin: v ?? 15 })} />
              </div>
              <div className="mt-1">
                <TypeMulti value={b.destinationTypes} onChange={(destinationTypes) => setBreak(b.id, { destinationTypes })} />
              </div>
            </div>
          ))}
          <Button size="sm" icon={<Plus size={12} />} onClick={() => update({ breaks: [...role.breaks, { id: uid('brk'), label: 'Break', earliestMin: 120, latestMin: 180, durationMin: 15, destinationTypes: ['Staff Lounge'] }] })}>
            Break
          </Button>
        </div>
        <p className="mt-1 text-2xs text-muted">Break window in minutes after shift start.</p>
      </div>
      {role.custom && (
        <Button size="sm" variant="danger" disabled={!canDelete} onClick={onDelete} title={canDelete ? '' : 'Remove staff with this role first'}>
          Delete role
        </Button>
      )}
    </div>
  );
}

function PeaksSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const peaks = useProject((s) => s.project!.simulation.peakPeriods);
  const update = useProject((s) => s.updateSimulation);
  const set = (id: string, patch: Partial<(typeof peaks)[number]>) => update({ peakPeriods: peaks.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  return (
    <Section title="Peak activity periods" icon={<Clock size={13} />} open={open} onToggle={onToggle}>
      <div className="space-y-1.5">
        {peaks.map((p) => (
          <div key={p.id} className="rounded-[3px] bg-paper p-1.5 ring-1 ring-line-2">
            <div className="mb-1 flex gap-1">
              <TextInput className="flex-1" value={p.label} onCommit={(label) => set(p.id, { label })} />
              <button className="px-1 text-faint hover:text-err" onClick={() => update({ peakPeriods: peaks.filter((x) => x.id !== p.id) })}>
                <Trash2 size={12} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <input type="time" className="h-7 rounded-[3px] border border-line px-1 text-[12px]" value={minutesToClockInput(p.startMin)} onChange={(e) => set(p.id, { startMin: clockInputToMinutes(e.target.value) })} />
              <input type="time" className="h-7 rounded-[3px] border border-line px-1 text-[12px]" value={minutesToClockInput(p.endMin)} onChange={(e) => set(p.id, { endMin: clockInputToMinutes(e.target.value) })} />
              <NumberInput value={p.intensity} min={0.2} max={4} step={0.05} suffix="×" onCommit={(v) => set(p.id, { intensity: v ?? 1 })} />
            </div>
          </div>
        ))}
        <Button size="sm" icon={<Plus size={12} />} onClick={() => update({ peakPeriods: [...peaks, { id: uid('peak'), label: 'Peak', startMin: 600, endMin: 660, intensity: 1.3 }] })}>
          Peak period
        </Button>
        <p className="text-2xs text-muted">Intensity &gt; 1 shortens time at base, increasing movement frequency during the period.</p>
      </div>
    </Section>
  );
}
