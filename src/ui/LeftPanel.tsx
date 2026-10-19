import { useUI } from '@/store/uiStore';
import { FloorPlanSection, LayersSection, ProjectSection, SpatialSection, useSectionState } from './panels/PlanPanels';
import { ConfigurePanel } from './panels/ConfigurePanel';
import { ExplorePanel } from './panels/ExplorePanel';
import { AnalyzePanel } from './panels/AnalyzePanel';

export function LeftPanel() {
  const mode = useUI((s) => s.mode);
  const { open, toggle } = useSectionState({ project: false, floor: true, spatial: true, layers: false, explore: true, viz: true });
  return (
    <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-r border-line bg-panel">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === 'plan' && (
          <>
            <ProjectSection open={open.project} onToggle={() => toggle('project')} />
            <FloorPlanSection open={open.floor} onToggle={() => toggle('floor')} />
            <SpatialSection open={open.spatial} onToggle={() => toggle('spatial')} />
            <LayersSection open={open.layers} onToggle={() => toggle('layers')} />
          </>
        )}
        {mode === 'configure' && <ConfigurePanel />}
        {mode === 'explore' && <ExplorePanel />}
        {mode === 'analyze' && <AnalyzePanel />}
      </div>
    </aside>
  );
}
