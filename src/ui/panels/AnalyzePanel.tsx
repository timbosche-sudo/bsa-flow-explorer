import { BarChart3, CalendarClock, Columns2, Flame, GitCompareArrows, LayoutDashboard, Route, SlidersHorizontal, Users } from 'lucide-react';
import { useUI, type AnalysisView } from '@/store/uiStore';
import { useActiveDataset } from '@/store/dataStore';
import { Section, Segmented, Select, Slider, Toggle, cx } from '@/ui/components/controls';
import { DatasetSection, RoleChips } from './ExplorePanel';
import { LayersSection, useSectionState } from './PlanPanels';
import { ROOM_METRICS } from '@/ui/analyze/shared';

export const VIEWS: { id: AnalysisView; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} />, desc: 'Travel and movement statistics' },
  { id: 'heatmap', label: 'Heatmaps', icon: <Flame size={14} />, desc: 'Movement density, presence and route frequency' },
  { id: 'rooms', label: 'Rooms & dwell', icon: <BarChart3 size={14} />, desc: 'Visits, dwell time, presence by room' },
  { id: 'congestion', label: 'Congestion', icon: <Users size={14} />, desc: 'Simultaneous overlap in circulation' },
  { id: 'od', label: 'Origin–destination', icon: <Route size={14} />, desc: 'Travel between clinical functions' },
  { id: 'time', label: 'Time of day', icon: <CalendarClock size={14} />, desc: 'Hourly patterns through the shift' },
  { id: 'compare', label: 'Compare', icon: <GitCompareArrows size={14} />, desc: 'Roles, periods and datasets' },
];

/** Layers implied by each analysis view. */
export const VIEW_LAYERS: Record<AnalysisView, { heatmap: boolean; occupancy: boolean; congestion: boolean; staff: boolean; trails: boolean }> = {
  overview: { heatmap: true, occupancy: false, congestion: false, staff: true, trails: false },
  heatmap: { heatmap: true, occupancy: false, congestion: false, staff: false, trails: false },
  rooms: { heatmap: false, occupancy: true, congestion: false, staff: false, trails: false },
  congestion: { heatmap: false, occupancy: false, congestion: true, staff: true, trails: false },
  od: { heatmap: false, occupancy: false, congestion: false, staff: false, trails: false },
  time: { heatmap: true, occupancy: false, congestion: false, staff: true, trails: false },
  compare: { heatmap: true, occupancy: false, congestion: false, staff: false, trails: false },
};

export function chooseView(v: AnalysisView) {
  const ui = useUI.getState();
  ui.setAnalysisView(v);
  const L = VIEW_LAYERS[v];
  ui.setLayer('heatmap', { visible: L.heatmap });
  ui.setLayer('occupancy', { visible: L.occupancy });
  ui.setLayer('congestion', { visible: L.congestion });
  ui.setLayer('staff', { visible: L.staff });
  ui.setLayer('trails', { visible: L.trails });
  if (v !== 'od') ui.setOdHighlight(null);
  ui.select(null);
}

export function AnalyzePanel() {
  const { open, toggle } = useSectionState({ views: true, data: false, filters: true, settings: true, layers: false });
  const view = useUI((s) => s.analysisView);
  return (
    <>
      <Section title="Analysis" icon={<Columns2 size={13} />} open={open.views} onToggle={() => toggle('views')}>
        <div className="space-y-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => chooseView(v.id)}
              className={cx('flex w-full items-start gap-2 rounded-[3px] px-2 py-1.5 text-left', view === v.id ? 'bg-ink text-white' : 'hover:bg-black/[0.04]')}
            >
              <span className={cx('mt-[1px]', view === v.id ? 'text-white/80' : 'text-muted')}>{v.icon}</span>
              <span>
                <span className="block text-[12.5px] font-medium">{v.label}</span>
                <span className={cx('block text-[10.5px]', view === v.id ? 'text-white/60' : 'text-muted')}>{v.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Filters" icon={<Users size={13} />} open={open.filters} onToggle={() => toggle('filters')}>
        <RoleChips />
        <p className="mt-2 text-2xs text-muted">The time window is set on the timeline below and filters every view.</p>
      </Section>
      <Section title="Settings" icon={<SlidersHorizontal size={13} />} open={open.settings} onToggle={() => toggle('settings')}>
        <ViewSettings />
      </Section>
      <DatasetSection open={open.data} onToggle={() => toggle('data')} />
      <LayersSection open={open.layers} onToggle={() => toggle('layers')} />
    </>
  );
}

function ViewSettings() {
  const view = useUI((s) => s.analysisView);
  const hm = useUI((s) => s.heatmap);
  const setHeatmap = useUI((s) => s.setHeatmap);
  const threshold = useUI((s) => s.congestionThreshold);
  const setThreshold = useUI((s) => s.setCongestionThreshold);
  const roomMetric = useUI((s) => s.roomMetric);
  const setRoomMetric = useUI((s) => s.setRoomMetric);
  const layers = useUI((s) => s.layers);
  const setLayer = useUI((s) => s.setLayer);
  const ds = useActiveDataset();
  const showHeat = ['overview', 'heatmap', 'time', 'compare'].includes(view);
  return (
    <div className="space-y-2">
      {showHeat && (
        <>
          <Toggle label="Show heatmap" checked={layers.heatmap.visible} onChange={(v) => setLayer('heatmap', { visible: v })} />
          <Select
            value={hm.metric}
            onChange={(metric) => setHeatmap({ metric })}
            options={[
              { value: 'movement', label: 'Movement density' },
              { value: 'frequency', label: 'Circulation frequency (passes)' },
              { value: 'presence', label: 'Presence (incl. stationary)' },
              { value: 'encounters', label: 'Encounter locations' },
            ]}
          />
          <Segmented
            className="w-full"
            size="sm"
            value={hm.normalization}
            onChange={(normalization) => setHeatmap({ normalization })}
            options={[
              { value: 'relative', label: 'Relative', title: 'Scaled to the peak cell in view' },
              { value: 'absolute', label: 'Absolute' },
              { value: 'per-staff-hour', label: 'Per staff-hr', title: 'Normalized for comparisons' },
            ]}
          />
          <Slider label="Intensity" min={0.3} max={4} step={0.1} value={hm.intensity} onChange={(intensity) => setHeatmap({ intensity })} format={(v) => `${v.toFixed(1)}×`} />
          <Slider label="Transparency" min={0.1} max={1} step={0.05} value={layers.heatmap.opacity} onChange={(opacity) => setLayer('heatmap', { opacity })} format={(v) => `${Math.round(v * 100)}% opaque`} />
          <Slider label="Smoothing radius" min={0} max={2.5} step={0.1} value={hm.smoothingM} onChange={(smoothingM) => setHeatmap({ smoothingM })} format={(v) => `${v.toFixed(1)} m`} />
          <Slider label="Cell size" min={0.15} max={1} step={0.05} value={hm.cellM} onChange={(cellM) => setHeatmap({ cellM })} format={(v) => `${v.toFixed(2)} m`} />
          <Segmented className="w-full" size="sm" value={hm.gradient} onChange={(gradient) => setHeatmap({ gradient })} options={[{ value: 'warm', label: 'Copper' }, { value: 'blue', label: 'Blue' }, { value: 'mono', label: 'Mono' }]} />
          <Toggle label="Rolling window during playback" checked={hm.rolling} onChange={(rolling) => setHeatmap({ rolling })} />
          {hm.rolling && <Slider label="Rolling window" min={5} max={120} step={5} value={hm.rollingMinutes} onChange={(rollingMinutes) => setHeatmap({ rollingMinutes })} format={(v) => `${v} min`} />}
        </>
      )}
      {view === 'rooms' && (
        <>
          <Toggle label="Room choropleth on plan" checked={layers.occupancy.visible} onChange={(v) => setLayer('occupancy', { visible: v })} />
          <Select value={roomMetric} onChange={setRoomMetric} options={ROOM_METRICS.map((m) => ({ value: m.value, label: m.label }))} />
        </>
      )}
      {view === 'congestion' && (
        <>
          <Slider label="Occupancy threshold" min={2} max={8} step={1} value={threshold} onChange={setThreshold} format={(v) => `${v} people`} />
          <p className="text-2xs text-muted">Segments reaching the threshold are flagged as potential overlap locations. Thresholds are a planning judgement, not a standard.</p>
        </>
      )}
      {view === 'od' && <p className="text-2xs text-muted">Arcs show room-to-room trips. Select a matrix cell to show the underlying journeys.</p>}
      {!ds && <p className="text-2xs text-warn">No dataset loaded.</p>}
    </div>
  );
}
