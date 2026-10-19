import { useState } from 'react';
import { FileArchive, FileImage, FileJson, FileSpreadsheet, FileText } from 'lucide-react';
import { useUI, type LayerId, type LayerState } from '@/store/uiStore';
import { useProject } from '@/store/projectStore';
import { useActiveDataset } from '@/store/dataStore';
import { Button, Field, Modal, Segmented, TextInput } from '@/ui/components/controls';
import { downloadBlob, exportArchive, safeFileName } from '@/services/projectLifecycle';
import { exportObservationsCsv, exportOdCsv, exportPdfReport, exportPng, exportProjectJson, exportRoomsCsv, exportStaffCsv, datasetDesignation } from '@/services/exporting';
import { VIEWS } from '@/ui/panels/AnalyzePanel';

type Preset = 'current' | 'heatmap' | 'trajectories' | 'rooms';

export function currentAnalysisLabel(): string {
  const ui = useUI.getState();
  if (ui.mode === 'analyze' || ui.mode === 'present') return VIEWS.find((v) => v.id === ui.analysisView)?.label ?? 'Floor plan';
  if (ui.mode === 'explore') return 'Movement playback';
  return 'Floor plan';
}

/** Temporarily apply a layer preset, run fn, then restore. */
async function withPreset(preset: Preset, fn: (label: string) => Promise<void>) {
  const ui = useUI.getState();
  const saved = { layers: ui.layers, trails: ui.trails };
  const set = (id: LayerId, patch: Partial<LayerState>) => useUI.getState().setLayer(id, patch);
  let label = currentAnalysisLabel();
  if (preset === 'heatmap') {
    set('heatmap', { visible: true });
    set('occupancy', { visible: false });
    set('congestion', { visible: false });
    label = 'Heatmap';
  } else if (preset === 'trajectories') {
    set('heatmap', { visible: false });
    set('occupancy', { visible: false });
    set('trails', { visible: true });
    useUI.getState().setTrails({ mode: 'full' });
    label = 'Movement trajectories';
  } else if (preset === 'rooms') {
    set('heatmap', { visible: false });
    set('occupancy', { visible: true });
    label = 'Room utilization (staff presence)';
  }
  try {
    await new Promise((r) => setTimeout(r, 300));
    await fn(label);
  } finally {
    useUI.setState({ layers: saved.layers, trails: saved.trails });
  }
}

export function ExportDialog() {
  const close = () => useUI.getState().setDialog('exportOpen', false);
  const name = useProject((s) => s.project!.meta.name);
  const notify = useUI((s) => s.notify);
  const ds = useActiveDataset();
  const [scale, setScale] = useState<'2' | '3' | '4'>('3');
  const [title, setTitle] = useState(name);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void> | void, msg: string) => {
    setBusy(true);
    try {
      await f();
      notify(msg);
    } catch (e) {
      notify(`Export failed: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const graphic = (preset: Preset) => () =>
    run(() => withPreset(preset, (label) => exportPng({ scale: Number(scale), title, analysisLabel: label })), 'Image exported.');
  const noData = !ds;
  return (
    <Modal title="Export" width={640} onClose={close} footer={<Button onClick={close}>Close</Button>}>
      <div className="mb-3 rounded-[3px] bg-panel px-3 py-2 text-[11.5px] text-ink-2">
        Every export states its dataset type: <b>{datasetDesignation().label}</b>.
      </div>
      <div className="mb-3 grid grid-cols-[1fr_auto] gap-3">
        <Field label="Title for graphics">
          <TextInput value={title} onCommit={setTitle} />
        </Field>
        <Field label="Resolution">
          <Segmented value={scale} onChange={setScale} options={[{ value: '2', label: '2×' }, { value: '3', label: '3×' }, { value: '4', label: '4×' }]} />
        </Field>
      </div>
      <Group title="Graphics (PNG / PDF)">
        <ExportRow icon={<FileImage size={16} />} title="Current floor plan view" desc="Exactly what is on screen, with title block, legend and data designation." onClick={graphic('current')} disabled={busy} />
        <ExportRow icon={<FileImage size={16} />} title="Heatmap overlay" desc="Current heatmap metric, window and filters." onClick={graphic('heatmap')} disabled={busy || noData} />
        <ExportRow icon={<FileImage size={16} />} title="Movement trajectories" desc="All paths in the analysis window, coloured by role." onClick={graphic('trajectories')} disabled={busy || noData} />
        <ExportRow icon={<FileImage size={16} />} title="Room utilization" desc="Room choropleth of tracked-staff presence (selected room metric)." onClick={graphic('rooms')} disabled={busy || noData} />
        <ExportRow
          icon={<FileText size={16} />}
          title="PDF report"
          desc="Tabloid PDF: the current view with legend, plus summary metrics, room and origin–destination tables and data notes."
          onClick={() => run(() => withPreset('current', (label) => exportPdfReport({ scale: Number(scale), title, analysisLabel: label })), 'PDF report exported.')}
          disabled={busy || noData}
        />
      </Group>
      <Group title="Data (CSV)">
        <ExportRow icon={<FileSpreadsheet size={16} />} title="Movement observations" desc="Positions in the analysis window (tag, role, time, x, y, gap flag)." onClick={() => run(exportObservationsCsv, 'Observations exported.')} disabled={busy || noData} />
        <ExportRow icon={<FileSpreadsheet size={16} />} title="Staff-level statistics" desc="Distance, moving/stationary time, gaps, visits and trips per tag." onClick={() => run(exportStaffCsv, 'Staff statistics exported.')} disabled={busy || noData} />
        <ExportRow icon={<FileSpreadsheet size={16} />} title="Room-level statistics" desc="Visits, dwell, presence, person-time and peak per space." onClick={() => run(exportRoomsCsv, 'Room statistics exported.')} disabled={busy || noData} />
        <ExportRow icon={<FileSpreadsheet size={16} />} title="Origin–destination relationships" desc="Trips, distances and times between room functions." onClick={() => run(() => exportOdCsv('type'), 'Origin–destination exported.')} disabled={busy || noData} />
      </Group>
      <Group title="Project">
        <ExportRow icon={<FileJson size={16} />} title="Project JSON" desc="Project metadata, calibration, geometry, staff and simulation settings (no drawing, no datasets)." onClick={() => run(exportProjectJson, 'Project JSON exported.')} disabled={busy} />
        <ExportRow
          icon={<FileArchive size={16} />}
          title="Project archive (.bsaflow)"
          desc="Portable zip with project JSON, drawing PDF and imported datasets. Re-open with Open project → Import archive."
          onClick={() => run(async () => downloadBlob(await exportArchive(), `${safeFileName(name)}.bsaflow`), 'Project archive exported.')}
          disabled={busy}
        />
      </Group>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function ExportRow({ icon, title, desc, onClick, disabled }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-[3px] border border-line-2 px-3 py-2">
      <span className="mt-0.5 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium">{title}</div>
        <div className="text-2xs leading-relaxed text-muted">{desc}</div>
      </div>
      <Button size="sm" disabled={disabled} onClick={onClick}>
        Export
      </Button>
    </div>
  );
}
