import { useRef, useState } from 'react';
import { Building2, Crosshair, FileText, Layers, LocateFixed, Plus, RotateCw, Shapes, Trash2, TriangleAlert, CircleAlert, Info } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI, type LayerId } from '@/store/uiStore';
import { useDrawing } from '@/store/drawingStore';
import { useValidation } from '@/store/derived';
import { Badge, Button, Field, NumberInput, Section, Select, Slider, TextInput, Toggle, cx } from '@/ui/components/controls';
import { compose, describeScale, sheetToWorld, worldToSheet } from '@/geometry/calibration';
import { remapSpatial } from '@/geometry/remap';
import { area } from '@/geometry/polygon';
import { fmtArea, fmtDistance } from '@/ui/format';
import { importDrawing, selectDrawingPage } from '@/services/projectLifecycle';
import { viewCommands } from '@/ui/plan/FloorPlanView';
import { uid } from '@/domain/defaults';
import { roomLabel } from '@/domain/validation';

export function useSectionState(initial: Record<string, boolean>) {
  const [open, setOpen] = useState(initial);
  return { open, toggle: (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] })) };
}

export function ProjectSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const meta = useProject((s) => s.project!.meta);
  const update = useProject((s) => s.updateMeta);
  return (
    <Section title="Project" icon={<Building2 size={13} />} open={open} onToggle={onToggle}>
      <div className="space-y-2.5">
        <Field label="Project name">
          <TextInput value={meta.name} onCommit={(name) => update({ name })} />
        </Field>
        <Field label="Facility">
          <TextInput value={meta.facilityName} onCommit={(facilityName) => update({ facilityName })} placeholder="Facility name" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Study area">
            <TextInput value={meta.studyArea} onCommit={(studyArea) => update({ studyArea })} placeholder="e.g. Level 2 clinic" />
          </Field>
          <Field label="Date">
            <input type="date" className="h-7 w-full rounded-[3px] border border-line bg-paper px-2 text-[12.5px]" value={meta.date} onChange={(e) => update({ date: e.target.value })} />
          </Field>
        </div>
        <Field label="Study description">
          <TextInput multiline value={meta.description} onCommit={(description) => update({ description })} />
        </Field>
        <Field label="Notes">
          <TextInput multiline value={meta.notes} onCommit={(notes) => update({ notes })} />
        </Field>
        {!meta.governanceAcknowledged && (
          <div className="rounded-[3px] border border-[#ecd9b0] bg-[#fdf6e7] p-2 text-2xs text-warn">
            Study governance not yet acknowledged.{' '}
            <button className="underline" onClick={() => update({ governanceAcknowledged: true })}>
              Acknowledge
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

export function FloorPlanSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const p = useProject((s) => s.project!);
  const fp = p.floorPlan;
  const cal = p.calibration;
  const updateFp = useProject((s) => s.updateFloorPlan);
  const drawing = useDrawing();
  const setTool = useUI((s) => s.setTool);
  const notify = useUI((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);
  const unit = p.prefs.units;

  const rotate = (deg: number) => {
    const next = { ...cal, rotationDeg: ((deg % 360) + 360) % 360 };
    const m = compose(sheetToWorld(next), worldToSheet(cal));
    useProject.getState().setCalibrationAndSpatial(next, remapSpatial(p.spatial, m), 'Rotate drawing');
    setTimeout(() => viewCommands.fitPlan(), 0);
  };

  return (
    <Section
      title="Floor plan"
      icon={<FileText size={13} />}
      open={open}
      onToggle={onToggle}
      badge={cal.calibrated ? <Badge tone="ok">Calibrated</Badge> : <Badge tone="warn">Not calibrated</Badge>}
    >
      <div className="space-y-3">
        <div className="rounded-[3px] border border-line bg-paper p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium">{fp.fileName ?? 'No drawing loaded'}</div>
              <div className="text-2xs text-muted">
                {drawing.status === 'loading' ? 'Loading…' : drawing.status === 'error' ? <span className="text-err">{drawing.error}</span> : fp.pageCount ? `${fp.pageCount} page${fp.pageCount > 1 ? 's' : ''} · ${(fp.pageWidth / 72).toFixed(0)}″ × ${(fp.pageHeight / 72).toFixed(0)}″` : 'Vector or raster PDF'}
              </div>
            </div>
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              {fp.fileName ? 'Replace' : 'Upload PDF'}
            </Button>
          </div>
          {fp.pageCount > 1 && (
            <Field label="Page" className="mt-2">
              <Select
                value={String(fp.pageIndex)}
                onChange={(v) => selectDrawingPage(Number(v))}
                options={Array.from({ length: fp.pageCount }, (_, i) => ({ value: String(i), label: `Page ${i + 1}` }))}
              />
            </Field>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                await importDrawing(f);
                notify(`Drawing replaced with ${f.name}. Geometry and data were kept — verify alignment and calibration.`);
              } catch (err) {
                notify(`Could not open PDF: ${err instanceof Error ? err.message : err}`, 'error');
              }
            }}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-2xs font-medium tracking-[0.06em] text-muted uppercase">Scale calibration</span>
          </div>
          {cal.calibrated ? (
            <div className="space-y-0.5 text-[12px] text-ink-2">
              <div>
                Scale <b className="tnum">{describeScale(cal.metersPerUnit)}</b>
              </div>
              <div className="text-2xs text-muted">
                Reference {fmtDistance(cal.knownDistanceM, unit)} · {cal.date ? new Date(cal.date).toLocaleDateString() : ''}
              </div>
              {cal.verifications.map((v) => {
                const err = Math.abs(v.measuredDistanceM - v.knownDistanceM) / v.knownDistanceM;
                return (
                  <div key={v.id} className="text-2xs text-muted">
                    Check: {fmtDistance(v.measuredDistanceM, unit)} measured vs {fmtDistance(v.knownDistanceM, unit)} known —{' '}
                    <span className={err > 0.02 ? 'text-warn' : 'text-ok'}>{(err * 100).toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[12px] text-warn">Distances use an assumed scale and are not verified until calibrated.</div>
          )}
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" icon={<Crosshair size={13} />} onClick={() => setTool('calibrate')}>
              {cal.calibrated ? 'Re-calibrate' : 'Calibrate'}
            </Button>
            <Button size="sm" disabled={!cal.calibrated} onClick={() => viewCommands.startVerify()}>
              Verify
            </Button>
            <Button size="sm" icon={<LocateFixed size={13} />} onClick={() => setTool('origin')} title="Set drawing origin">
              Origin
            </Button>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <Field label="Rotation" className="flex-1">
            <NumberInput value={cal.rotationDeg} step={90} suffix="°" onCommit={(v) => rotate(v ?? 0)} />
          </Field>
          <Button size="sm" className="mb-[2px]" icon={<RotateCw size={13} />} onClick={() => rotate(cal.rotationDeg + 90)}>
            90°
          </Button>
        </div>
        <div>
          <Slider label="Drawing opacity" min={0} max={1} step={0.05} value={fp.opacity} onChange={(opacity) => updateFp({ opacity })} format={(v) => `${Math.round(v * 100)}%`} />
          <Toggle label="Show drawing" checked={fp.visible} onChange={(visible) => updateFp({ visible })} />
          <Toggle label="Muted (grayscale) drawing" checked={fp.muted} onChange={(muted) => updateFp({ muted })} />
        </div>
      </div>
    </Section>
  );
}

const ROOM_TYPE_PREVIEW = 6;

export function SpatialSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const p = useProject((s) => s.project!);
  const select = useUI((s) => s.select);
  const selection = useUI((s) => s.selection);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'rooms' | 'doors' | 'circulation' | 'obstacles' | 'zones' | 'anchors' | 'types'>('rooms');
  const unit = p.prefs.units;
  const s = p.spatial;
  const tabs = [
    ['rooms', 'Rooms', s.rooms.length],
    ['doors', 'Doors', s.doors.length],
    ['circulation', 'Circ.', s.circulation.length],
    ['obstacles', 'Obst.', s.obstacles.length],
    ['zones', 'Zones', s.zones.length],
    ['anchors', 'Anchors', s.anchors.length],
    ['types', 'Types', p.roomTypes.length],
  ] as const;
  const pick = (kind: 'room' | 'door' | 'circulation' | 'obstacle' | 'anchor' | 'zone', id: string) => {
    select({ kind, id });
    if (kind !== 'zone') setTimeout(() => viewCommands.fitSelection(), 0);
  };
  const row = (key: string, active: boolean, onClick: () => void, left: React.ReactNode, right?: React.ReactNode) => (
    <button key={key} onClick={onClick} className={cx('flex w-full items-center gap-2 px-2 py-1 text-left text-[12px]', active ? 'bg-accent-soft' : 'hover:bg-black/[0.03]')}>
      <span className="min-w-0 flex-1 truncate">{left}</span>
      {right && <span className="tnum shrink-0 text-2xs text-muted">{right}</span>}
    </button>
  );
  const typeColor = (t: string) => p.roomTypes.find((x) => x.name === t)?.color ?? '#999';
  const query = q.trim().toLowerCase();

  return (
    <Section title="Spatial definition" icon={<Shapes size={13} />} open={open} onToggle={onToggle}>
      <div className="mb-2 flex flex-wrap gap-1">
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cx('rounded-[2px] px-1.5 py-0.5 text-[11px] font-medium', tab === k ? 'bg-ink text-white' : 'bg-line-2 text-ink-2 hover:bg-line')}
          >
            {label} <span className={tab === k ? 'text-white/60' : 'text-faint'}>{n}</span>
          </button>
        ))}
      </div>
      {tab === 'rooms' && (
        <>
          <input className="mb-1.5 h-7 w-full rounded-[3px] border border-line px-2 text-[12px] outline-none focus:border-accent" placeholder="Filter rooms…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-[260px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
            {s.rooms
              .filter((r) => !query || `${r.name} ${r.number} ${r.type}`.toLowerCase().includes(query))
              .map((r) =>
                row(
                  r.id,
                  selection?.id === r.id,
                  () => pick('room', r.id),
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: r.color ?? typeColor(r.type) }} />
                    {roomLabel(r)}
                    <span className="truncate text-2xs text-faint">{r.type}</span>
                  </span>,
                  fmtArea(area(r.polygon), unit),
                ),
              )}
            {!s.rooms.length && <div className="p-3 text-center text-2xs text-muted">Use the Rectangle or Polygon room tools to define rooms.</div>}
          </div>
        </>
      )}
      {tab === 'doors' && (
        <div className="max-h-[260px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
          {s.doors.map((d) => row(d.id, selection?.id === d.id, () => pick('door', d.id), d.name || 'Door', fmtDistance(d.widthM, unit)))}
          {!s.doors.length && <div className="p-3 text-center text-2xs text-muted">Use Place door on walls between spaces.</div>}
        </div>
      )}
      {tab === 'circulation' && (
        <div className="max-h-[260px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
          {s.circulation.map((c) => row(c.id, selection?.id === c.id, () => pick('circulation', c.id), c.name, fmtArea(area(c.polygon), unit)))}
          {!s.circulation.length && <div className="p-3 text-center text-2xs text-muted">Draw corridors with the Circulation tool.</div>}
        </div>
      )}
      {tab === 'obstacles' && (
        <div className="max-h-[260px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
          {s.obstacles.map((o) => row(o.id, selection?.id === o.id, () => pick('obstacle', o.id), o.name))}
          {!s.obstacles.length && <div className="p-3 text-center text-2xs text-muted">No obstacles.</div>}
        </div>
      )}
      {tab === 'anchors' && (
        <div className="max-h-[260px] overflow-auto rounded-[3px] border border-line-2 bg-paper">
          {s.anchors.map((a) => row(a.id, selection?.id === a.id, () => pick('anchor', a.id), a.label, a.status))}
          {!s.anchors.length && <div className="p-3 text-center text-2xs text-muted">Place planned UWB anchors with the anchor tool.</div>}
        </div>
      )}
      {tab === 'zones' && <ZonesEditor />}
      {tab === 'types' && <RoomTypesEditor preview={ROOM_TYPE_PREVIEW} />}
    </Section>
  );
}

function ZonesEditor() {
  const zones = useProject((s) => s.project!.spatial.zones);
  const rooms = useProject((s) => s.project!.spatial.rooms);
  const { addItem, updateItem, removeItem } = useProject.getState();
  return (
    <div className="space-y-1.5">
      {zones.map((z) => (
        <div key={z.id} className="flex items-center gap-1.5">
          <input type="color" value={z.color} onChange={(e) => updateItem('zones', z.id, { color: e.target.value })} className="h-6 w-6 shrink-0 cursor-pointer rounded border border-line" />
          <TextInput className="flex-1" value={z.name} onCommit={(name) => updateItem('zones', z.id, { name })} />
          <span className="tnum w-6 text-right text-2xs text-muted">{rooms.filter((r) => r.zoneId === z.id).length}</span>
          <button className="text-faint hover:text-err" title="Delete zone" onClick={() => removeItem('zones', z.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <Button size="sm" icon={<Plus size={13} />} onClick={() => addItem('zones', { id: uid('zone'), name: `Zone ${zones.length + 1}`, color: '#8fa3b0' }, 'Add zone')}>
        Add zone
      </Button>
      <p className="text-2xs text-muted">Assign rooms to zones in the room inspector. Toggle the Functional Zones layer to view.</p>
    </div>
  );
}

function RoomTypesEditor({ preview }: { preview: number }) {
  const types = useProject((s) => s.project!.roomTypes);
  const set = useProject((s) => s.setRoomTypes);
  const [all, setAll] = useState(false);
  const [name, setName] = useState('');
  const list = all ? types : types.slice(0, preview);
  return (
    <div className="space-y-1">
      {list.map((t) => (
        <div key={t.name} className="flex items-center gap-1.5 text-[12px]">
          <input type="color" value={t.color} onChange={(e) => set(types.map((x) => (x.name === t.name ? { ...x, color: e.target.value } : x)))} className="h-5 w-5 shrink-0 cursor-pointer rounded border border-line" />
          <span className="flex-1 truncate">{t.name}</span>
          {t.isCirculation && <Badge>circ.</Badge>}
          {t.custom && (
            <button className="text-faint hover:text-err" onClick={() => set(types.filter((x) => x.name !== t.name))}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      ))}
      {types.length > preview && (
        <button className="text-2xs text-accent" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${types.length}`}
        </button>
      )}
      <div className="flex gap-1.5 pt-1">
        <input className="h-7 flex-1 rounded-[3px] border border-line px-2 text-[12px] outline-none focus:border-accent" placeholder="Custom room type…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button
          size="sm"
          disabled={!name.trim() || types.some((t) => t.name === name.trim())}
          onClick={() => {
            set([...types, { name: name.trim(), color: '#9aa5ad', isCirculation: false, custom: true }]);
            setName('');
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

const LAYER_LABELS: [LayerId, string][] = [
  ['floorPlan', 'Floor plan'],
  ['rooms', 'Room boundaries'],
  ['roomLabels', 'Room labels'],
  ['zones', 'Functional zones'],
  ['circulation', 'Circulation network'],
  ['doors', 'Doors'],
  ['obstacles', 'Obstacles'],
  ['anchors', 'Anchor locations'],
  ['staff', 'Staff markers'],
  ['trails', 'Individual trajectories'],
  ['aggregateTrails', 'Aggregate trajectories'],
  ['heatmap', 'Heatmap'],
  ['occupancy', 'Occupancy'],
  ['congestion', 'Congestion'],
  ['navGrid', 'Door footprints (diagnostic)'],
];

export function LayersSection({ open, onToggle, only }: { open: boolean; onToggle: () => void; only?: LayerId[] }) {
  const layers = useUI((s) => s.layers);
  const setLayer = useUI((s) => s.setLayer);
  return (
    <Section title="Layers" icon={<Layers size={13} />} open={open} onToggle={onToggle}>
      <div className="space-y-0.5">
        {LAYER_LABELS.filter(([id]) => !only || only.includes(id)).map(([id, label]) => (
          <div key={id} className="flex items-center gap-2">
            <input type="checkbox" checked={layers[id].visible} onChange={(e) => setLayer(id, { visible: e.target.checked })} />
            <span className="flex-1 text-[12px] text-ink-2">{label}</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={layers[id].opacity}
              onChange={(e) => setLayer(id, { opacity: Number(e.target.value) })}
              className="w-16"
              title="Opacity"
              disabled={!layers[id].visible}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

export function ValidationList({ max = 50 }: { max?: number }) {
  const issues = useValidation();
  const select = useUI((s) => s.select);
  if (!issues.length) return <div className="rounded-[3px] bg-[#e9f4ed] px-2.5 py-2 text-[12px] text-ok">No spatial model issues found.</div>;
  return (
    <div className="space-y-1">
      {issues.slice(0, max).map((i, k) => (
        <button
          key={k}
          onClick={() => {
            if (i.target) {
              select({ kind: i.target.kind, id: i.target.id });
              setTimeout(() => viewCommands.fitSelection(), 0);
            }
          }}
          className={cx('flex w-full items-start gap-2 rounded-[3px] px-2 py-1.5 text-left text-[11.5px] leading-snug', i.target && 'hover:bg-black/[0.03]')}
        >
          <span className="mt-[1px] shrink-0">
            {i.severity === 'error' ? <CircleAlert size={13} className="text-err" /> : i.severity === 'warning' ? <TriangleAlert size={13} className="text-warn" /> : <Info size={13} className="text-faint" />}
          </span>
          <span className="text-ink-2">{i.message}</span>
        </button>
      ))}
      {issues.length > max && <div className="text-2xs text-muted">+ {issues.length - max} more</div>}
    </div>
  );
}
