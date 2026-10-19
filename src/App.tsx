import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { bootstrap, saveNow } from '@/services/projectLifecycle';
import { TopBar } from '@/ui/TopBar';
import { LeftPanel } from '@/ui/LeftPanel';
import { RightPanel } from '@/ui/RightPanel';
import { Toast } from '@/ui/Toast';
import { FloorPlanView, viewCommands } from '@/ui/plan/FloorPlanView';
import { GridLayer, ScaleBar, ToolPalette, ZoomControls } from '@/ui/plan/Hud';
import { NewProjectDialog, OpenProjectDialog, SettingsDialog } from '@/ui/dialogs/ProjectDialogs';
import { ExportDialog } from '@/ui/dialogs/ExportDialog';
import { DatasetBadge } from '@/ui/DatasetBadge';
import { TOOLS } from '@/ui/plan/tools';
import { IconButton } from '@/ui/components/controls';

function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const ui = useUI.getState();
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useProject.getState().redo();
        else useProject.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useProject.getState().redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow().then((ok) => ok && ui.notify('Project saved to this device.'));
        return;
      }
      if (mod || e.altKey) return;
      if (/^[1-5]$/.test(e.key)) {
        ui.setMode((['plan', 'configure', 'explore', 'analyze', 'present'] as const)[Number(e.key) - 1]);
        return;
      }
      if (e.key === 'f' || e.key === 'F') return viewCommands.fitPlan();
      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selection && ui.mode === 'plan') {
        const map = { room: 'rooms', door: 'doors', circulation: 'circulation', obstacle: 'obstacles', anchor: 'anchors' } as const;
        const k = map[ui.selection.kind as keyof typeof map];
        if (!k) return;
        const item = (useProject.getState().project!.spatial[k] as { id: string; locked?: boolean }[]).find((x) => x.id === ui.selection!.id);
        if (item && !item.locked) {
          useProject.getState().removeItem(k, item.id);
          ui.select(null);
        }
        return;
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase() && x.modes.includes(ui.mode));
      if (t) ui.setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function useAutosave() {
  const revision = useProject((s) => s.revision);
  const autosave = useUI((s) => s.autosave);
  useEffect(() => {
    if (!autosave || revision === 0) return;
    const t = setTimeout(() => void saveNow(), 1200);
    return () => clearTimeout(t);
  }, [revision, autosave]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      const s = useProject.getState();
      if (s.revision !== s.savedRevision) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
}

export default function App() {
  const project = useProject((s) => s.project);
  const leftOpen = useUI((s) => s.leftOpen);
  const rightOpen = useUI((s) => s.rightOpen);
  const mode = useUI((s) => s.mode);
  const dialogs = useUI(useShallow((s) => ({ settings: s.settingsOpen, exp: s.exportOpen, neu: s.newOpen, open: s.openOpen })));
  useKeyboardShortcuts();
  useAutosave();
  useEffect(() => {
    void bootstrap();
  }, []);

  if (!project) {
    return <div className="flex h-full items-center justify-center text-muted">Loading BSA Flow Explorer…</div>;
  }
  const present = mode === 'present';
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {leftOpen && !present && <LeftPanel />}
        <main className="relative min-w-0 flex-1">
          <FloorPlanView
            dynamicLayers={<GridLayer />}
            hud={
              <>
                <ToolPalette />
                <ZoomControls />
                <ScaleBar />
                <div className="pointer-events-none absolute top-3 right-3 z-10">
                  <DatasetBadge />
                </div>
              </>
            }
          />
          {!present && (
            <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1 rounded-[4px] border border-line bg-paper/95 p-0.5 shadow-sm">
              <IconButton title={leftOpen ? 'Hide left panel' : 'Show left panel'} onClick={() => useUI.getState().toggleLeft()}>
                {leftOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              </IconButton>
              <IconButton title={rightOpen ? 'Hide right panel' : 'Show right panel'} onClick={() => useUI.getState().toggleRight()}>
                {rightOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </IconButton>
            </div>
          )}
        </main>
        {rightOpen && !present && <RightPanel />}
      </div>
      <Toast />
      {dialogs.settings && <SettingsDialog />}
      {dialogs.exp && <ExportDialog />}
      {dialogs.neu && <NewProjectDialog />}
      {dialogs.open && <OpenProjectDialog />}
    </div>
  );
}
