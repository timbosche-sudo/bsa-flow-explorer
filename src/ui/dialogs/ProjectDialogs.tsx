import { useEffect, useRef, useState } from 'react';
import { FileArchive, Trash2 } from 'lucide-react';
import { useUI } from '@/store/uiStore';
import { useProject } from '@/store/projectStore';
import { Button, Field, Modal, Segmented, TextInput, Toggle, NumberInput, Empty } from '@/ui/components/controls';
import * as db from '@/services/persistence';
import { createNewProject, importArchive, openProjectById, resetSampleProject } from '@/services/projectLifecycle';

export const GOVERNANCE_TEXT =
  'Field studies that track staff movement require applicable organizational approval (for example leadership, privacy/compliance, labor relations and, where applicable, an IRB or quality-improvement determination), informed participation, and appropriate privacy and security procedures. BSA Flow Explorer stores data locally and uses pseudonymous tag identifiers, but the software alone does not guarantee HIPAA or any other regulatory compliance. Findings describe building and operational patterns and must not be used to evaluate individual employee performance.';

export function NewProjectDialog() {
  const close = () => useUI.getState().setDialog('newOpen', false);
  const [name, setName] = useState('New clinic study');
  const [ack, setAck] = useState(false);
  return (
    <Modal
      title="New project"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!ack}
            onClick={async () => {
              await createNewProject(name, ack);
              close();
            }}
          >
            Create project
          </Button>
        </>
      }
    >
      <Field label="Project name">
        <TextInput value={name} onCommit={setName} />
      </Field>
      <div className="mt-4 rounded-[3px] border border-line bg-panel p-3 text-[12px] leading-relaxed text-ink-2">
        <div className="mb-1 text-[11px] font-semibold tracking-[0.05em] text-ink uppercase">Study governance acknowledgment</div>
        {GOVERNANCE_TEXT}
      </div>
      <label className="mt-3 flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>I understand that any real-world data collection for this project requires the approvals and procedures described above.</span>
      </label>
      <p className="mt-3 text-2xs text-muted">The new project starts with default staff roles and no floor plan. Import a PDF from the toolbar to begin.</p>
    </Modal>
  );
}

export function OpenProjectDialog() {
  const close = () => useUI.getState().setDialog('openOpen', false);
  const notify = useUI((s) => s.notify);
  const current = useProject((s) => s.project?.meta.id);
  const [list, setList] = useState<db.ProjectSummary[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => db.listProjects().then(setList).catch(() => setList([]));
  useEffect(() => void refresh(), []);
  return (
    <Modal
      title="Open project"
      width={620}
      onClose={close}
      footer={
        <>
          <Button icon={<FileArchive size={14} />} onClick={() => fileRef.current?.click()}>
            Import archive…
          </Button>
          <Button
            onClick={async () => {
              await resetSampleProject();
              close();
              notify('Sample clinic restored.');
            }}
          >
            Load fresh sample clinic
          </Button>
          <Button onClick={close}>Close</Button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".bsaflow,.zip"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const p = await importArchive(f);
            notify(`Imported “${p.meta.name}”.`);
            close();
          } catch (err) {
            notify(`Import failed: ${err instanceof Error ? err.message : err}`, 'error');
          }
        }}
      />
      {!list ? (
        <div className="text-muted">Loading…</div>
      ) : !list.length ? (
        <Empty>No saved projects on this device.</Empty>
      ) : (
        <div className="divide-y divide-line-2 rounded-[3px] border border-line">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">
                  {p.name} {p.id === current && <span className="ml-1 text-2xs text-accent">(open)</span>}
                </div>
                <div className="text-2xs text-muted">
                  {p.facilityName || '—'} · updated {new Date(p.updatedAt).toLocaleString()}
                  {p.isSample && ' · sample'}
                </div>
              </div>
              <Button
                size="sm"
                disabled={p.id === current}
                onClick={async () => {
                  await openProjectById(p.id);
                  close();
                }}
              >
                Open
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={p.id === current}
                title="Delete project and all its local data"
                onClick={async () => {
                  if (!confirm(`Permanently delete “${p.name}” and its drawing and datasets from this device?`)) return;
                  await db.deleteProject(p.id);
                  refresh();
                }}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-2xs text-muted">Projects are stored only in this browser (IndexedDB). Use Export → Project archive to move a project between computers.</p>
    </Modal>
  );
}

export function SettingsDialog() {
  const close = () => useUI.getState().setDialog('settingsOpen', false);
  const prefs = useProject((s) => s.project!.prefs);
  const update = useProject((s) => s.updatePrefs);
  const autosave = useUI((s) => s.autosave);
  return (
    <Modal title="Settings" onClose={close} footer={<Button onClick={close}>Done</Button>}>
      <div className="space-y-4">
        <Field label="Display units">
          <Segmented value={prefs.units} onChange={(u) => update({ units: u })} options={[{ value: 'ft', label: 'Imperial (ft, sf)' }, { value: 'm', label: 'Metric (m, m²)' }]} />
        </Field>
        <div>
          <Toggle label="Show scale bar" checked={prefs.showScaleBar} onChange={(v) => update({ showScaleBar: v })} />
          <Toggle label="Show measurement grid" checked={prefs.showGrid} onChange={(v) => update({ showGrid: v })} />
          <Toggle label="Autosave to this device" checked={autosave} onChange={(v) => useUI.setState({ autosave: v })} />
        </div>
        <Field label="Minimum group size for reported group results" hint="Role or group results with fewer tracked people than this are suppressed in client-facing views (privacy). Use 1 to disable.">
          <NumberInput value={prefs.minGroupSize} min={1} max={20} step={1} onCommit={(v) => update({ minGroupSize: Math.round(v ?? 1) })} className="w-24" />
        </Field>
        <div className="rounded-[3px] border border-line bg-panel p-3 text-2xs leading-relaxed text-muted">
          <b className="text-ink-2">Privacy &amp; data locality.</b> All project data stays in this browser. The application makes no network requests involving project or location data and includes no analytics or telemetry. Delete individual projects from Open project.
        </div>
      </div>
    </Modal>
  );
}
