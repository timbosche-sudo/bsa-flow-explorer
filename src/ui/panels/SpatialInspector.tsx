import { Copy, Lock, Trash2, Unlock, ZoomIn } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { useSpatialContext } from '@/store/derived';
import { Badge, Button, Field, NumberInput, Select, TextInput, Toggle } from '@/ui/components/controls';
import { area, translatePolygon } from '@/geometry/polygon';
import { fmtArea, fmtDistance } from '@/ui/format';
import { fromMeters, toMeters } from '@/geometry/calibration';
import { uid } from '@/domain/defaults';
import { viewCommands } from '@/ui/plan/FloorPlanView';
import { roomLabel } from '@/domain/validation';
import type { AnchorPower, AnchorStatus } from '@/domain/types';

function Header({ kind, title, locked, onLock, onDelete, onDuplicate }: { kind: string; title: string; locked?: boolean; onLock?: () => void; onDelete: () => void; onDuplicate?: () => void }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-2xs font-medium tracking-[0.06em] text-muted uppercase">{kind}</div>
        <div className="truncate text-[14px] font-semibold">{title}</div>
      </div>
      <div className="flex gap-0.5">
        <button className="rounded p-1 text-muted hover:bg-black/5" title="Zoom to" onClick={() => viewCommands.fitSelection()}>
          <ZoomIn size={14} />
        </button>
        {onDuplicate && (
          <button className="rounded p-1 text-muted hover:bg-black/5" title="Duplicate" onClick={onDuplicate}>
            <Copy size={14} />
          </button>
        )}
        {onLock && (
          <button className="rounded p-1 text-muted hover:bg-black/5" title={locked ? 'Unlock geometry' : 'Lock geometry'} onClick={onLock}>
            {locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
        )}
        <button className="rounded p-1 text-muted hover:bg-[#fbeeee] hover:text-err disabled:opacity-30" disabled={locked} title="Delete" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function SpatialInspector() {
  const sel = useUI((s) => s.selection);
  const p = useProject((s) => s.project!);
  const { updateItem, removeItem, addItem } = useProject.getState();
  const select = useUI((s) => s.select);
  const ctx = useSpatialContext();
  const unit = p.prefs.units;
  if (!sel) return null;

  if (sel.kind === 'room') {
    const r = p.spatial.rooms.find((x) => x.id === sel.id);
    if (!r) return null;
    const u = (patch: Partial<typeof r>) => updateItem('rooms', r.id, patch, 'Edit room');
    const doorsHere = ctx.grid.doors.filter((d) => d.spaceIds.includes(r.id) && d.groups).length;
    return (
      <div>
        <Header
          kind="Room"
          title={roomLabel(r)}
          locked={r.locked}
          onLock={() => u({ locked: !r.locked })}
          onDelete={() => (removeItem('rooms', r.id), select(null))}
          onDuplicate={() => {
            const id = uid('room');
            addItem('rooms', { ...r, id, number: `${r.number}-copy`, polygon: translatePolygon(r.polygon, 1, 1), locked: false }, 'Duplicate room');
            select({ kind: 'room', id });
          }}
        />
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Badge>{fmtArea(area(r.polygon), unit)}</Badge>
          <Badge tone={doorsHere ? 'neutral' : 'err'}>
            {doorsHere} door{doorsHere === 1 ? '' : 's'}
          </Badge>
          {r.restricted && <Badge tone="accent">No through-traffic</Badge>}
          {r.sensitive && <Badge tone="warn">Sensitive</Badge>}
        </div>
        <div className="space-y-2.5">
          <div className="grid grid-cols-[1fr_88px] gap-2">
            <Field label="Name">
              <TextInput value={r.name} onCommit={(name) => u({ name })} />
            </Field>
            <Field label="Number">
              <TextInput value={r.number} onCommit={(number) => u({ number })} />
            </Field>
          </div>
          <Field label="Room type">
            <Select value={r.type} onChange={(type) => u({ type })} options={p.roomTypes.map((t) => ({ value: t.name, label: t.name }))} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Department">
              <TextInput value={r.department} onCommit={(department) => u({ department })} />
            </Field>
            <Field label="Zone">
              <Select value={r.zoneId ?? ''} onChange={(z) => u({ zoneId: z || null })} options={[{ value: '', label: '— none —' }, ...p.spatial.zones.map((z) => ({ value: z.id, label: z.name }))]} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Target occupancy">
              <NumberInput value={r.targetOccupancy} allowNull min={0} step={1} onCommit={(targetOccupancy) => u({ targetOccupancy })} />
            </Field>
            <Field label="Planned utilization">
              <Select
                value={r.plannedUtilization || ''}
                onChange={(plannedUtilization) => u({ plannedUtilization })}
                options={[{ value: '', label: '—' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }, { value: 'flex', label: 'Flexible' }]}
              />
            </Field>
          </div>
          <Field label="Colour override">
            <div className="flex items-center gap-2">
              <input type="color" value={r.color ?? p.roomTypes.find((t) => t.name === r.type)?.color ?? '#999999'} onChange={(e) => u({ color: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-line" />
              {r.color && (
                <Button size="sm" variant="ghost" onClick={() => u({ color: null })}>
                  Use type colour
                </Button>
              )}
            </div>
          </Field>
          <div>
            <Toggle label="No through-traffic (route may end here only)" checked={r.restricted} onChange={(restricted) => u({ restricted })} />
            <Toggle label="Staff-only area" checked={r.staffOnly} onChange={(staffOnly) => u({ staffOnly })} />
            <Toggle label="Sensitive — exclude from visualizations" checked={r.sensitive} onChange={(sensitive) => u({ sensitive })} />
          </div>
          <Field label="Notes">
            <TextInput multiline value={r.notes} onCommit={(notes) => u({ notes })} />
          </Field>
        </div>
      </div>
    );
  }

  if (sel.kind === 'door') {
    const d = p.spatial.doors.find((x) => x.id === sel.id);
    if (!d) return null;
    const ref = ctx.grid.doors.find((x) => x.id === d.id);
    const u = (patch: Partial<typeof d>) => updateItem('doors', d.id, patch, 'Edit door');
    const spaceName = (id: string | null) => {
      if (!id) return '— undefined area —';
      const r = p.spatial.rooms.find((x) => x.id === id);
      return r ? roomLabel(r) : (p.spatial.circulation.find((c) => c.id === id)?.name ?? id);
    };
    const [a, b] = ref?.spaceIds ?? [null, null];
    return (
      <div>
        <Header kind="Door / opening" title={d.name || 'Door'} locked={d.locked} onLock={() => u({ locked: !d.locked })} onDelete={() => (removeItem('doors', d.id), select(null))} />
        {ref?.problem ? <div className="mb-3 rounded-[3px] bg-[#f8e3e3] px-2 py-1.5 text-[12px] text-err">{ref.problem}</div> : <div className="mb-3 text-[12px] text-ink-2">Connects <b>{spaceName(a)}</b> ↔ <b>{spaceName(b)}</b></div>}
        <div className="space-y-2.5">
          <Field label="Name">
            <TextInput value={d.name} onCommit={(name) => u({ name })} />
          </Field>
          <Field label={`Clear width (${unit})`}>
            <NumberInput value={Math.round(fromMeters(d.widthM, unit) * 100) / 100} min={0.3} step={0.25} onCommit={(v) => u({ widthM: toMeters(v ?? 3, unit) })} />
          </Field>
          <Field label="Direction">
            <Select
              value={d.oneWayFromSpaceId ?? ''}
              onChange={(v) => u({ oneWayFromSpaceId: v || null })}
              options={[
                { value: '', label: 'Two-way' },
                ...(a ? [{ value: a, label: `One-way from ${spaceName(a)}` }] : []),
                ...(b && b !== a ? [{ value: b, label: `One-way from ${spaceName(b)}` }] : []),
              ]}
            />
          </Field>
          <div className="text-2xs text-muted">Position {fmtDistance(d.position.x, unit)}, {fmtDistance(d.position.y, unit)} from origin.</div>
        </div>
      </div>
    );
  }

  if (sel.kind === 'circulation' || sel.kind === 'obstacle') {
    const k = sel.kind === 'circulation' ? 'circulation' : 'obstacles';
    const it = (p.spatial[k] as { id: string; name: string; polygon: { x: number; y: number }[]; locked?: boolean }[]).find((x) => x.id === sel.id);
    if (!it) return null;
    return (
      <div>
        <Header
          kind={sel.kind === 'circulation' ? 'Circulation area' : 'Obstacle'}
          title={it.name}
          locked={it.locked}
          onLock={sel.kind === 'circulation' ? () => updateItem('circulation', it.id, { locked: !it.locked }) : undefined}
          onDelete={() => (removeItem(k, it.id), select(null))}
          onDuplicate={() => {
            const id = uid(sel.kind === 'circulation' ? 'circ' : 'obs');
            addItem(k, { ...it, id, name: `${it.name} copy`, polygon: translatePolygon(it.polygon, 1, 1) } as never);
            select({ kind: sel.kind, id });
          }}
        />
        <div className="mb-3">
          <Badge>{fmtArea(area(it.polygon), unit)}</Badge>
        </div>
        <Field label="Name">
          <TextInput value={it.name} onCommit={(name) => updateItem(k, it.id, { name } as never)} />
        </Field>
        <p className="mt-3 text-2xs text-muted">
          {sel.kind === 'circulation'
            ? 'Circulation areas that overlap or share an edge form one walkable network. Rooms connect to it only through doors.'
            : 'Obstacles block walking. Routes pass around them.'}
        </p>
      </div>
    );
  }

  if (sel.kind === 'anchor') {
    const a = p.spatial.anchors.find((x) => x.id === sel.id);
    if (!a) return null;
    const u = (patch: Partial<typeof a>) => updateItem('anchors', a.id, patch, 'Edit anchor');
    return (
      <div>
        <Header kind="UWB anchor (planned)" title={a.label} onDelete={() => (removeItem('anchors', a.id), select(null))} />
        <div className="space-y-2.5">
          <Field label="Label / ID">
            <TextInput value={a.label} onCommit={(label) => u({ label })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={`X (${unit})`}>
              <NumberInput value={Math.round(fromMeters(a.position.x, unit) * 100) / 100} step={0.5} onCommit={(v) => u({ position: { ...a.position, x: toMeters(v ?? 0, unit) } })} />
            </Field>
            <Field label={`Y (${unit})`}>
              <NumberInput value={Math.round(fromMeters(a.position.y, unit) * 100) / 100} step={0.5} onCommit={(v) => u({ position: { ...a.position, y: toMeters(v ?? 0, unit) } })} />
            </Field>
          </div>
          <Field label={`Mounting height (${unit})`}>
            <NumberInput value={a.mountingHeightM == null ? null : Math.round(fromMeters(a.mountingHeightM, unit) * 100) / 100} allowNull step={0.5} onCommit={(v) => u({ mountingHeightM: v == null ? null : toMeters(v, unit) })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Power">
              <Select<AnchorPower> value={a.power} onChange={(power) => u({ power })} options={(['battery', 'mains', 'poe', 'usb', 'unknown'] as const).map((v) => ({ value: v, label: v.toUpperCase() === 'POE' ? 'PoE' : v[0].toUpperCase() + v.slice(1) }))} />
            </Field>
            <Field label="Status">
              <Select<AnchorStatus> value={a.status} onChange={(status) => u({ status })} options={(['planned', 'installed', 'surveyed', 'removed'] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} />
            </Field>
          </div>
          <Field label="Mounting location notes">
            <TextInput multiline value={a.mountingNotes} onCommit={(mountingNotes) => u({ mountingNotes })} />
          </Field>
          <div className="rounded-[3px] border border-line-2 p-2">
            <div className="mb-1.5 text-2xs font-medium tracking-[0.06em] text-muted uppercase">Measured survey coordinates</div>
            <div className="grid grid-cols-3 gap-2">
              {(['x', 'y'] as const).map((axis) => (
                <NumberInput
                  key={axis}
                  allowNull
                  value={a.surveyedPosition ? Math.round(fromMeters(a.surveyedPosition[axis], unit) * 100) / 100 : null}
                  step={0.1}
                  suffix={axis}
                  onCommit={(v) =>
                    u({
                      surveyedPosition: v == null ? null : { ...(a.surveyedPosition ?? a.position), [axis]: toMeters(v, unit) },
                      status: v == null ? a.status : 'surveyed',
                    })
                  }
                />
              ))}
              <NumberInput allowNull value={a.surveyedZ == null ? null : Math.round(fromMeters(a.surveyedZ, unit) * 100) / 100} step={0.1} suffix="z" onCommit={(v) => u({ surveyedZ: v == null ? null : toMeters(v, unit) })} />
            </div>
            {a.surveyedPosition && <div className="mt-1 text-2xs text-muted">Survey offset from plan: {fmtDistance(Math.hypot(a.surveyedPosition.x - a.position.x, a.surveyedPosition.y - a.position.y), unit)}</div>}
          </div>
          <p className="text-2xs leading-relaxed text-muted">
            Anchor placement here is geometric planning only. Actual UWB performance depends on obstructions, antenna geometry, RF conditions and hardware, and must be verified on site.
          </p>
        </div>
      </div>
    );
  }
  return null;
}
