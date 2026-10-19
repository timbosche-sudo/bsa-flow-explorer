import { create } from 'zustand';
import type { ID } from '@/domain/types';

export type AppMode = 'plan' | 'configure' | 'explore' | 'analyze' | 'present';

export type ToolId =
  | 'select'
  | 'pan'
  | 'zoom'
  | 'measure'
  | 'calibrate'
  | 'origin'
  | 'room-polygon'
  | 'room-rect'
  | 'edit-polygon'
  | 'door'
  | 'circulation'
  | 'obstacle'
  | 'anchor'
  | 'select-staff'
  | 'inspect';

export type SelectionKind = 'room' | 'door' | 'circulation' | 'obstacle' | 'anchor' | 'zone' | 'staff' | 'role' | 'trip' | 'od' | 'sample';

export interface Selection {
  kind: SelectionKind;
  id: ID;
}

export type LayerId =
  | 'floorPlan'
  | 'rooms'
  | 'roomLabels'
  | 'zones'
  | 'circulation'
  | 'doors'
  | 'obstacles'
  | 'anchors'
  | 'staff'
  | 'trails'
  | 'aggregateTrails'
  | 'heatmap'
  | 'occupancy'
  | 'congestion'
  | 'navGrid';

export interface LayerState {
  visible: boolean;
  opacity: number;
}

export type HeatmapMetric = 'presence' | 'movement' | 'frequency' | 'encounters';
export type Normalization = 'absolute' | 'relative' | 'per-staff-hour';
export type Gradient = 'warm' | 'blue' | 'mono';
export type RoomMetric = 'dwell' | 'visits' | 'presence' | 'peak' | 'avgVisit';

export type AnalysisView = 'overview' | 'rooms' | 'heatmap' | 'congestion' | 'od' | 'time' | 'compare';
export type ShapeMode = 'polygon' | 'rect';
export type DialogKey = 'settingsOpen' | 'importOpen' | 'exportOpen' | 'newOpen' | 'openOpen';

interface UIState {
  mode: AppMode;
  tool: ToolId;
  shapeMode: ShapeMode;
  selection: Selection | null;
  hover: Selection | null;
  leftOpen: boolean;
  rightOpen: boolean;
  layers: Record<LayerId, LayerState>;
  /** Role / staff filters (empty = all). */
  roleFilter: ID[];
  staffFilter: ID[];
  trails: {
    mode: 'off' | 'tail' | 'buildup' | 'full';
    tailMinutes: number;
    width: number;
    opacity: number;
    arrows: boolean;
    fade: boolean;
    showLabels: boolean;
  };
  markers: { labels: boolean; direction: boolean; destination: boolean };
  heatmap: {
    metric: HeatmapMetric;
    intensity: number;
    smoothingM: number;
    gradient: Gradient;
    normalization: Normalization;
    cellM: number;
    /** Animate as a rolling window ending at the playback time. */
    rolling: boolean;
    rollingMinutes: number;
  };
  roomMetric: RoomMetric;
  choropleth: boolean;
  compare: { mode: 'roles' | 'periods' | 'datasets'; bStart: number; bEnd: number; bDataset: string | null; diffMap: boolean };
  analysisView: AnalysisView;
  congestionThreshold: number;
  odHighlight: { fromType: string; toType: string } | null;
  settingsOpen: boolean;
  importOpen: boolean;
  exportOpen: boolean;
  newOpen: boolean;
  openOpen: boolean;
  autosave: boolean;
  toast: { id: number; text: string; tone: 'info' | 'warn' | 'error' } | null;

  setMode: (m: AppMode) => void;
  setTool: (t: ToolId) => void;
  setShapeMode: (m: ShapeMode) => void;
  select: (s: Selection | null) => void;
  setHover: (s: Selection | null) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLayer: (id: LayerId, patch: Partial<LayerState>) => void;
  setRoleFilter: (ids: ID[]) => void;
  setStaffFilter: (ids: ID[]) => void;
  setTrails: (patch: Partial<UIState['trails']>) => void;
  setMarkers: (patch: Partial<UIState['markers']>) => void;
  setHeatmap: (patch: Partial<UIState['heatmap']>) => void;
  setAnalysisView: (v: AnalysisView) => void;
  setRoomMetric: (m: RoomMetric) => void;
  setChoropleth: (on: boolean) => void;
  setCompare: (patch: Partial<UIState['compare']>) => void;
  setCongestionThreshold: (n: number) => void;
  setOdHighlight: (h: UIState['odHighlight']) => void;
  setDialog: (k: DialogKey, open: boolean) => void;
  notify: (text: string, tone?: 'info' | 'warn' | 'error') => void;
}

const L = (visible: boolean, opacity = 1): LayerState => ({ visible, opacity });

export const MODE_DEFAULT_TOOL: Record<AppMode, ToolId> = {
  plan: 'select',
  configure: 'select',
  explore: 'select-staff',
  analyze: 'select',
  present: 'pan',
};

export const useUI = create<UIState>((set, get) => ({
  mode: 'explore',
  tool: 'select-staff',
  shapeMode: 'rect',
  selection: null,
  hover: null,
  leftOpen: true,
  rightOpen: true,
  layers: {
    floorPlan: L(true, 1),
    rooms: L(true, 0.55),
    roomLabels: L(true),
    zones: L(false, 0.35),
    circulation: L(true, 0.5),
    doors: L(true),
    obstacles: L(true),
    anchors: L(false),
    staff: L(true),
    trails: L(true, 0.8),
    aggregateTrails: L(false, 0.6),
    heatmap: L(false, 0.75),
    occupancy: L(false, 0.7),
    congestion: L(false, 0.85),
    navGrid: L(false, 0.5),
  },
  roleFilter: [],
  staffFilter: [],
  trails: { mode: 'tail', tailMinutes: 4, width: 2, opacity: 0.8, arrows: false, fade: true, showLabels: false },
  markers: { labels: true, direction: true, destination: false },
  heatmap: { metric: 'movement', intensity: 1, smoothingM: 0.6, gradient: 'warm', normalization: 'relative', cellM: 0.25, rolling: false, rollingMinutes: 30 },
  roomMetric: 'dwell',
  choropleth: false,
  compare: { mode: 'roles', bStart: 12 * 3600, bEnd: 16 * 3600, bDataset: null, diffMap: false },
  analysisView: 'overview',
  congestionThreshold: 3,
  odHighlight: null,
  settingsOpen: false,
  importOpen: false,
  exportOpen: false,
  newOpen: false,
  openOpen: false,
  autosave: true,
  toast: null,

  setMode: (mode) => {
    const layers = { ...get().layers };
    if (mode === 'plan') {
      layers.circulation = { ...layers.circulation, visible: true };
      layers.doors = { ...layers.doors, visible: true };
    }
    if (mode === 'analyze') layers.heatmap = { ...layers.heatmap, visible: true };
    set({ mode, tool: MODE_DEFAULT_TOOL[mode], layers, rightOpen: mode === 'present' ? false : get().rightOpen });
  },
  setTool: (tool) => set({ tool }),
  setShapeMode: (shapeMode) => set({ shapeMode }),
  select: (selection) => set({ selection }),
  setHover: (hover) => set({ hover }),
  toggleLeft: () => set({ leftOpen: !get().leftOpen }),
  toggleRight: () => set({ rightOpen: !get().rightOpen }),
  setLayer: (id, patch) => set({ layers: { ...get().layers, [id]: { ...get().layers[id], ...patch } } }),
  setRoleFilter: (roleFilter) => set({ roleFilter }),
  setStaffFilter: (staffFilter) => set({ staffFilter }),
  setTrails: (patch) => set({ trails: { ...get().trails, ...patch } }),
  setMarkers: (patch) => set({ markers: { ...get().markers, ...patch } }),
  setHeatmap: (patch) => set({ heatmap: { ...get().heatmap, ...patch } }),
  setAnalysisView: (analysisView) => set({ analysisView }),
  setRoomMetric: (roomMetric) => set({ roomMetric }),
  setChoropleth: (choropleth) => set({ choropleth }),
  setCompare: (patch) => set({ compare: { ...get().compare, ...patch } }),
  setCongestionThreshold: (congestionThreshold) => set({ congestionThreshold }),
  setOdHighlight: (odHighlight) => set({ odHighlight }),
  setDialog: (k, open) => set({ [k]: open } as Partial<UIState>),
  notify: (text, tone = 'info') => set({ toast: { id: Date.now(), text, tone } }),
}));
