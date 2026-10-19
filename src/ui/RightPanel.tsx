import { useUI } from '@/store/uiStore';
import { SpatialInspector } from './panels/SpatialInspector';
import { ValidationList } from './panels/PlanPanels';
import { useProject } from '@/store/projectStore';
import { fmtArea } from './format';
import { area } from '@/geometry/polygon';
import { Stat } from './components/controls';

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

export function RightPanel() {
  const mode = useUI((s) => s.mode);
  const selection = useUI((s) => s.selection);
  const spatialSel = selection && ['room', 'door', 'circulation', 'obstacle', 'anchor'].includes(selection.kind);
  return (
    <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-line bg-panel">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {mode === 'plan' && (spatialSel ? <SpatialInspector /> : <PlanSummary />)}
        {mode !== 'plan' && (spatialSel ? <SpatialInspector /> : <PlanSummary />)}
      </div>
    </aside>
  );
}
