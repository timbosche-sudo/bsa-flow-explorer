import { LayersSection, useSectionState } from './PlanPanels';

export function ExplorePanel() {
  const { open, toggle } = useSectionState({ layers: true });
  return <LayersSection open={open.layers} onToggle={() => toggle('layers')} />;
}
