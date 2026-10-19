/** Client-facing presentation chrome: title block, view switcher, key figures. */
import { Download } from 'lucide-react';
import { useProject } from '@/store/projectStore';
import { useUI } from '@/store/uiStore';
import { usePlayback } from '@/store/playback';
import { useAnalysis } from '@/store/analysis';
import { cx } from './components/controls';
import { chooseView } from './panels/AnalyzePanel';
import { DatasetBadge } from './DatasetBadge';
import { fmtClock, fmtDistanceLong, fmtPct } from './format';

type PresentView = 'movement' | 'heatmap' | 'rooms' | 'congestion' | 'od';

const PRESENT_VIEWS: { id: PresentView; label: string }[] = [
  { id: 'movement', label: 'Movement' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'rooms', label: 'Room use' },
  { id: 'congestion', label: 'Overlap' },
  { id: 'od', label: 'Flows' },
];

export function setPresentView(v: PresentView) {
  const ui = useUI.getState();
  if (v === 'movement') {
    chooseView('overview');
    ui.setLayer('heatmap', { visible: false });
    ui.setLayer('staff', { visible: true });
    ui.setLayer('trails', { visible: true });
    if (ui.trails.mode === 'off') ui.setTrails({ mode: 'tail' });
  } else chooseView(v);
}

function currentPresentView(): PresentView {
  const ui = useUI.getState();
  if (ui.analysisView === 'overview' && !ui.layers.heatmap.visible) return 'movement';
  if (ui.analysisView === 'rooms') return 'rooms';
  if (ui.analysisView === 'congestion') return 'congestion';
  if (ui.analysisView === 'od') return 'od';
  return 'heatmap';
}

export function PresentOverlay() {
  const p = useProject((s) => s.project!);
  useUI((s) => s.analysisView);
  useUI((s) => s.layers);
  const a0 = usePlayback((s) => s.rangeStart);
  const a1 = usePlayback((s) => s.rangeEnd);
  const roleFilter = useUI((s) => s.roleFilter);
  const a = useAnalysis();
  const view = currentPresentView();
  const total = a?.staff.reduce((s, x) => s + x.distanceM, 0) ?? 0;
  const moving = a?.staff.reduce((s, x) => s + x.movingS, 0) ?? 0;
  const tracked = a?.staff.reduce((s, x) => s + x.trackedS, 0) ?? 0;
  const roles = roleFilter.length ? roleFilter.map((id) => p.roles.find((r) => r.id === id)?.shortName).join(', ') : 'All roles';
  return (
    <>
      <div className="pointer-events-none absolute top-4 left-4 z-20 max-w-[520px]">
        <div className="pointer-events-auto rounded-[4px] border border-line bg-paper/95 px-4 py-3 shadow-sm">
          <div className="text-[18px] leading-tight font-semibold">{p.meta.name}</div>
          <div className="mt-0.5 text-[12px] text-muted">{[p.meta.facilityName, p.meta.studyArea].filter(Boolean).join(' · ')}</div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2 tnum">
            <span>
              {fmtClock(a0)} – {fmtClock(a1)}
            </span>
            <span>{roles}</span>
            {a && (
              <>
                <span>
                  <b>{fmtDistanceLong(total, p.prefs.units)}</b> walked
                </span>
                <span>
                  <b>{a.trips.length}</b> journeys
                </span>
                <span>
                  <b>{fmtPct(moving / Math.max(1, tracked))}</b> of time moving
                </span>
              </>
            )}
          </div>
          <div className="mt-2.5 flex gap-1">
            {PRESENT_VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setPresentView(v.id)}
                className={cx('h-7 rounded-[3px] px-2.5 text-[12px] font-medium', view === v.id ? 'bg-ink text-white' : 'bg-line-2 text-ink-2 hover:bg-line')}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute top-4 right-4 z-20 flex flex-col items-end gap-2">
        <DatasetBadge />
        <button
          className="pointer-events-auto flex h-7 items-center gap-1.5 rounded-[3px] border border-line bg-paper px-2.5 text-[12px] font-medium shadow-sm hover:bg-panel"
          onClick={() => useUI.getState().setDialog('exportOpen', true)}
        >
          <Download size={13} /> Export
        </button>
      </div>
    </>
  );
}
