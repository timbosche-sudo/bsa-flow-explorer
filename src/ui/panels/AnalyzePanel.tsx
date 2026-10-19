import { LayersSection, useSectionState } from './PlanPanels';

export function AnalyzePanel() {
  const { open, toggle } = useSectionState({ layers: true });
  return <LayersSection open={open.layers} onToggle={() => toggle('layers')} />;
}
