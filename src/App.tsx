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
import { MovementLayer } from '@/ui/plan/MovementLayer';
import { useAnalysisOverlay } from '@/ui/plan/AnalysisStack';
import { useRoomChoropleth } from '@/ui/analyze/shared';
import { Timeline } from '@/ui/Timeline';
import { usePlayback, clock } from '@/store/playback';
import { getActiveDataset, useData } from '@/store/dataStore';
import { positionAt, indexAtOrBefore } from '@/analytics/trackUtils';
import type { Vec2 } from '@/domain/types';
import type { ToolId } from '@/store/uiStore';

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
      if (e.code === 'Space' && ui.mode !== 'plan') {
        e.preventDefault();
        const pb = usePlayback.getState();
        pb.setPlaying(!pb.playing);
        return;
      }
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

/** Click handling for analysis tools: pick staff markers or inspect recorded samples. */
function onAnalysisClick(w: Vec2, _s: Vec2, tolM: number, tool: ToolId): boolean {
  const ds = getActiveDataset(useData.getState());
  const ui = useUI.getState();
  if (!ds) return false;
  if (tool === 'select-staff') {
    let best: { id: string; d: number } | null = null;
    for (const tr of ds.tracks) {
      const p = positionAt(tr, clock.t);
      if (!p) continue;
      const d = Math.hypot(p.p.x - w.x, p.p.y - w.y);
      if (d < tolM * 1.4 && (!best || d < best.d)) best = { id: tr.staffId, d };
    }
    ui.select(best ? { kind: 'staff', id: best.id } : null);
    return true;
  }
  if (tool === 'inspect') {
    const { rangeStart, rangeEnd } = usePlayback.getState();
    let best: { id: string; i: number; d: number } | null = null;
    for (const tr of ds.tracks) {
      const a = Math.max(0, indexAtOrBefore(tr.t, rangeStart));
      const b = indexAtOrBefore(tr.t, rangeEnd);
      for (let i = a; i <= b; i++) {
        const d = Math.hypot(tr.x[i] - w.x, tr.y[i] - w.y);
        if (d < tolM && (!best || d < best.d || (Math.abs(d - best.d) < 1e-6 && Math.abs(tr.t[i] - clock.t) < Math.abs(tr.t[best.i] - clock.t)))) best = { id: tr.staffId, i, d };
      }
    }
    ui.select(best ? { kind: 'sample', id: `${best.id}#${best.i}` } : null);
    return true;
  }
  return false;
}

export default function App() {
  const project = useProject((s) => s.project);
  const dialogs = useUI(useShallow((s) => ({ settings: s.settingsOpen, exp: s.exportOpen, neu: s.newOpen, open: s.openOpen })));
  useKeyboardShortcuts();
  useAutosave();
  useEffect(() => {
    void bootstrap();
  }, []);

  if (!project) {
    return <div className="flex h-full items-center justify-center text-muted">Loading BSA Flow Explorer…</div>;
  }
  return <Workspace dialogs={dialogs} />;
}

function Workspace({ dialogs }: { dialogs: { settings: boolean; exp: boolean; neu: boolean; open: boolean } }) {
  const leftOpen = useUI((s) => s.leftOpen);
  const rightOpen = useUI((s) => s.rightOpen);
  const mode = useUI((s) => s.mode);
  const overlay = useAnalysisOverlay();
  const roomFill = useRoomChoropleth();
  const present = mode === 'present';
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {leftOpen && !present && <LeftPanel />}
        <main className="relative min-w-0 flex-1">
          <FloorPlanView
            dynamicLayers={
              <>
                <GridLayer />
                {overlay.layersEl}
                {mode !== 'plan' && <MovementLayer />}
              </>
            }
            onAnalysisClick={onAnalysisClick}
            roomFill={mode === 'plan' ? null : roomFill}
            hud={
              <>
                <ToolPalette />
                <ZoomControls />
                <ScaleBar />
                {overlay.legends}
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
      {mode !== 'plan' && <Timeline />}
      <Toast />
      {dialogs.settings && <SettingsDialog />}
      {dialogs.exp && <ExportDialog />}
      {dialogs.neu && <NewProjectDialog />}
      {dialogs.open && <OpenProjectDialog />}
    </div>
  );
}
