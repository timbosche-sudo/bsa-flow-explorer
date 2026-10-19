import { useUI } from '@/store/uiStore';
import { SpatialInspector } from './panels/SpatialInspector';
import { ValidationList } from './panels/PlanPanels';
import { useProject } from '@/store/projectStore';
import { fmtArea } from './format';
import { area } from '@/geometry/polygon';
import { Stat, cx } from './components/controls';
import { StaffInspector } from './panels/StaffInspector';
import { StudySummary } from './panels/StudySummary';
import { SampleInspector } from './panels/SampleInspector';
import { RoleAnalytics, RoomAnalytics } from './analyze/Selections';
import { CompareView, CongestionView, HeatmapView, ODView, OverviewView, RoomsView, TimeView } from './analyze/Views';
import { VIEWS } from './panels/AnalyzePanel';
import { DatasetBadge } from './DatasetBadge';
import { useActiveDataset } from '@/store/dataStore';

function PlanSummary() {
  const p = useProject((s) => s.project!);
  const unit = p.prefs.units;
  const total = p.spatial.rooms.reduce((s, r) => s + area(r.polygon), 0);
  const circ = p.spatial.circulation.reduce((s, r) => s + area(r.polygon), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <Stat label="Rooms" value={p.spatial.rooms.length} sub={fmtArea(total, unit)} />
        <Stat label="Circulation" value={p.spatial.circulation.length} sub={fmtArea(circ, unit)} />
        <Stat label="Doors" value={p.spatial.doors.length} />
        <Stat label="Anchors" value={p.spatial.anchors.length} />
      </div>
      <div>
        <div className="mb-1.5 text-2xs font-semibold tracking-[0.06em] text-muted uppercase">Validation</div>
        <ValidationList />
      </div>
    </div>
  );
}

function AnalysisBody() {
  const view = useUI((s) => s.analysisView);
  const def = VIEWS.find((v) => v.id === view)!;
  const ds = useActiveDataset();
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="text-2xs font-medium tracking-[0.06em] text-muted uppercase">Analysis</div>
          <div className="text-[15px] font-semibold">{def.label}</div>
        </div>
        <DatasetBadge compact />
      </div>
      {!ds ? (
        <div className="text-[12.5px] text-muted">No movement data. Run the simulation (Configure) or import observed data.</div>
      ) : view === 'overview' ? (
        <OverviewView />
      ) : view === 'rooms' ? (
        <RoomsView />
      ) : view === 'heatmap' ? (
        <HeatmapView />
      ) : view === 'congestion' ? (
        <CongestionView />
      ) : view === 'od' ? (
        <ODView />
      ) : view === 'time' ? (
        <TimeView />
      ) : (
        <CompareView />
      )}
    </div>
  );
}

export function RightPanel() {
  const mode = useUI((s) => s.mode);
  const selection = useUI((s) => s.selection);
  const spatialSel = selection && ['room', 'door', 'circulation', 'obstacle', 'anchor'].includes(selection.kind);
  let body: React.ReactNode;
  if (mode === 'plan') body = spatialSel ? <SpatialInspector /> : <PlanSummary />;
  else if (selection?.kind === 'staff') body = <StaffInspector staffId={selection.id} />;
  else if (selection?.kind === 'sample') body = <SampleInspector id={selection.id} />;
  else if (selection?.kind === 'role') body = <RoleAnalytics roleId={selection.id} />;
  else if (selection && (selection.kind === 'room' || selection.kind === 'circulation') && mode !== 'configure') body = <RoomAnalytics roomId={selection.id} />;
  else if (spatialSel && mode === 'configure') body = <SpatialInspector />;
  else if (mode === 'analyze') body = <AnalysisBody />;
  else body = <StudySummary />;
  return (
    <aside className={cx('flex shrink-0 flex-col overflow-hidden border-l border-line bg-panel', mode === 'analyze' ? 'w-[430px]' : 'w-[340px]')}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{body}</div>
    </aside>
  );
}
