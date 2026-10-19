import { useRef, useState } from 'react';
import { DatabaseZap, Download, FilePlus2, FileUp, FolderOpen, Redo2, Save, Settings, Undo2 } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI, type AppMode } from '@/store/uiStore';
import { IconButton, cx } from './components/controls';
import { importDrawing, saveNow } from '@/services/projectLifecycle';
import { DatasetBadge } from './DatasetBadge';

const MODES: { id: AppMode; label: string; n: number }[] = [
  { id: 'plan', label: 'Plan', n: 1 },
  { id: 'configure', label: 'Configure', n: 2 },
  { id: 'explore', label: 'Explore', n: 3 },
  { id: 'analyze', label: 'Analyze', n: 4 },
  { id: 'present', label: 'Present', n: 5 },
];

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="3" fill="#1d2327" />
      <path d="M8 22c4-10 12-2 16-12" stroke="#d39a5c" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="8" cy="22" r="2.4" fill="#ece9e4" />
      <circle cx="24" cy="10" r="2.4" fill="#ece9e4" />
    </svg>
  );
}

export function TopBar() {
  const project = useProject((s) => s.project!);
  const revision = useProject((s) => s.revision);
  const saved = useProject((s) => s.savedRevision);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  const mode = useUI((s) => s.mode);
  const setMode = useUI((s) => s.setMode);
  const setDialog = useUI((s) => s.setDialog);
  const notify = useUI((s) => s.notify);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const dirty = revision !== saved;

  const onPdf = async (f: File | undefined) => {
    if (!f) return;
    try {
      const had = project.spatial.rooms.length > 0;
      const r = await importDrawing(f);
      setMode('plan');
      notify(
        `Imported ${f.name} (${r.pageCount} page${r.pageCount > 1 ? 's' : ''}). ${had ? 'Existing geometry was kept — check alignment and re-calibrate if needed.' : 'Next: calibrate the scale.'}`,
      );
    } catch (e) {
      notify(`Could not open PDF: ${e instanceof Error ? e.message : e}`, 'error');
    }
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-paper px-3">
      <div className="flex items-center gap-2 pr-1">
        <BrandMark />
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-[0.01em] whitespace-nowrap">BSA Flow Explorer</div>
          <div className="mt-[2px] hidden text-[10px] tracking-[0.08em] whitespace-nowrap text-faint uppercase 2xl:block">Clinical movement analysis</div>
        </div>
      </div>
      <div className="h-6 w-px bg-line" />
      <div className="flex min-w-0 items-center gap-2">
        {editing ? (
          <input
            autoFocus
            defaultValue={project.meta.name}
            className="h-7 w-56 rounded-[3px] border border-accent px-2 text-[13px] outline-none"
            onBlur={(e) => {
              useProject.getState().updateMeta({ name: e.target.value || 'Untitled study' });
              setEditing(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className="max-w-[220px] truncate text-[13px] font-medium text-ink-2 hover:text-ink" title="Rename project" onClick={() => setEditing(true)}>
            {project.meta.name}
          </button>
        )}
        <span className={cx('hidden text-2xs whitespace-nowrap xl:inline', dirty ? 'text-warn' : 'text-faint')}>{dirty ? 'Unsaved changes' : 'Saved locally'}</span>
      </div>

      <nav className="mx-auto flex items-center rounded-[3px] border border-line bg-panel p-[2px]" aria-label="Application mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cx(
              'flex h-7 items-center gap-1.5 rounded-[2px] px-3 text-[12.5px] font-medium transition-colors',
              mode === m.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-black/5',
            )}
            title={`${m.label} mode (${m.n})`}
          >
            <span className={cx('tnum text-[10px]', mode === m.id ? 'text-white/50' : 'text-faint')}>{m.n}</span>
            {m.label}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-0.5">
        <DatasetBadge compact />
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton title="New project" onClick={() => setDialog('newOpen', true)}>
          <FilePlus2 size={16} />
        </IconButton>
        <IconButton title="Open project" onClick={() => setDialog('openOpen', true)}>
          <FolderOpen size={16} />
        </IconButton>
        <IconButton
          title="Save project (Ctrl+S)"
          onClick={async () => {
            if (await saveNow()) notify('Project saved to this device.');
          }}
        >
          <Save size={16} />
        </IconButton>
        <IconButton title="Import floor plan PDF" onClick={() => fileRef.current?.click()}>
          <FileUp size={16} />
        </IconButton>
        <IconButton title="Import tracking data (CSV / JSON)" onClick={() => setDialog('importOpen', true)}>
          <DatabaseZap size={16} />
        </IconButton>
        <IconButton title="Export" onClick={() => setDialog('exportOpen', true)}>
          <Download size={16} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton title="Undo spatial edit (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
          <Redo2 size={16} />
        </IconButton>
        <IconButton title="Settings" onClick={() => setDialog('settingsOpen', true)}>
          <Settings size={16} />
        </IconButton>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => (onPdf(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
    </header>
  );
}
