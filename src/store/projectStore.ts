/**
 * Project document store. Holds the persisted Project and an undo/redo
 * history for spatial editing (geometry + calibration).
 */
import { create } from 'zustand';
import type {
  Anchor,
  Calibration,
  CirculationArea,
  Door,
  FloorPlanSource,
  ID,
  Obstacle,
  Project,
  ProjectMeta,
  Room,
  SimulationConfig,
  SpatialModel,
  StaffMember,
  StaffRole,
  VisualizationPrefs,
  Zone,
  RoomTypeDef,
  CoordinateFrame,
} from '@/domain/types';

interface Snapshot {
  spatial: SpatialModel;
  calibration: Calibration;
  label: string;
}

const MAX_HISTORY = 120;

export type SpatialCollection = 'rooms' | 'doors' | 'circulation' | 'obstacles' | 'zones' | 'anchors';
type ItemOf<K extends SpatialCollection> = SpatialModel[K][number];

interface ProjectState {
  project: Project | null;
  /** Incremented on every change (used for dirty tracking / autosave). */
  revision: number;
  savedRevision: number;
  past: Snapshot[];
  future: Snapshot[];

  load: (p: Project) => void;
  markSaved: (rev: number) => void;

  updateMeta: (patch: Partial<ProjectMeta>) => void;
  updateFloorPlan: (patch: Partial<FloorPlanSource>) => void;
  updatePrefs: (patch: Partial<VisualizationPrefs>) => void;
  /** Calibration changes are undoable together with geometry. */
  setCalibrationAndSpatial: (cal: Calibration, spatial: SpatialModel, label: string) => void;

  /** Undoable spatial edit. */
  editSpatial: (label: string, fn: (s: SpatialModel) => SpatialModel) => void;
  addItem: <K extends SpatialCollection>(k: K, item: ItemOf<K>, label?: string) => void;
  updateItem: <K extends SpatialCollection>(k: K, id: ID, patch: Partial<ItemOf<K>>, label?: string) => void;
  removeItem: (k: SpatialCollection, id: ID) => void;

  undo: () => void;
  redo: () => void;

  setRoomTypes: (types: RoomTypeDef[]) => void;
  setRoles: (roles: StaffRole[]) => void;
  updateRole: (id: ID, patch: Partial<StaffRole>) => void;
  setStaff: (staff: StaffMember[]) => void;
  updateStaff: (id: ID, patch: Partial<StaffMember>) => void;
  updateSimulation: (patch: Partial<SimulationConfig>) => void;
  setCoordinateFrames: (frames: CoordinateFrame[]) => void;
  setObservedDatasetIds: (ids: ID[]) => void;
}

const touch = (p: Project): Project => ({ ...p, meta: { ...p.meta, updatedAt: new Date().toISOString() } });

export const useProject = create<ProjectState>((set, get) => {
  const mutate = (fn: (p: Project) => Project) => {
    const p = get().project;
    if (!p) return;
    set({ project: touch(fn(p)), revision: get().revision + 1 });
  };
  const pushHistory = (label: string) => {
    const p = get().project!;
    const past = [...get().past, { spatial: p.spatial, calibration: p.calibration, label }];
    if (past.length > MAX_HISTORY) past.shift();
    return past;
  };
  return {
    project: null,
    revision: 0,
    savedRevision: 0,
    past: [],
    future: [],

    load: (p) => set({ project: p, past: [], future: [], revision: 0, savedRevision: 0 }),
    markSaved: (rev) => set({ savedRevision: rev }),

    updateMeta: (patch) => mutate((p) => ({ ...p, meta: { ...p.meta, ...patch } })),
    updateFloorPlan: (patch) => mutate((p) => ({ ...p, floorPlan: { ...p.floorPlan, ...patch } })),
    updatePrefs: (patch) => mutate((p) => ({ ...p, prefs: { ...p.prefs, ...patch } })),

    setCalibrationAndSpatial: (cal, spatial, label) => {
      if (!get().project) return;
      const past = pushHistory(label);
      set({ past, future: [] });
      mutate((p) => ({ ...p, calibration: cal, spatial }));
    },

    editSpatial: (label, fn) => {
      const p = get().project;
      if (!p) return;
      const next = fn(p.spatial);
      if (next === p.spatial) return;
      const past = pushHistory(label);
      set({ past, future: [] });
      mutate((pp) => ({ ...pp, spatial: next }));
    },
    addItem: (k, item, label) =>
      get().editSpatial(label ?? `Add ${k}`, (s) => ({ ...s, [k]: [...(s[k] as unknown[]), item] })),
    updateItem: (k, id, patch, label) =>
      get().editSpatial(label ?? `Edit ${k}`, (s) => ({
        ...s,
        [k]: (s[k] as { id: ID }[]).map((it) => (it.id === id ? { ...it, ...patch } : it)),
      })),
    removeItem: (k, id) =>
      get().editSpatial(`Delete ${k}`, (s) => {
        const next: SpatialModel = { ...s, [k]: (s[k] as { id: ID }[]).filter((it) => it.id !== id) };
        if (k === 'zones') next.rooms = s.rooms.map((r) => (r.zoneId === id ? { ...r, zoneId: null } : r));
        if (k === 'rooms' || k === 'circulation') {
          next.doors = next.doors.map((d) => (d.oneWayFromSpaceId === id ? { ...d, oneWayFromSpaceId: null } : d));
        }
        return next;
      }),

    undo: () => {
      const { past, future, project } = get();
      if (!past.length || !project) return;
      const prev = past[past.length - 1];
      set({
        past: past.slice(0, -1),
        future: [{ spatial: project.spatial, calibration: project.calibration, label: prev.label }, ...future],
      });
      mutate((p) => ({ ...p, spatial: prev.spatial, calibration: prev.calibration }));
    },
    redo: () => {
      const { past, future, project } = get();
      if (!future.length || !project) return;
      const next = future[0];
      set({
        future: future.slice(1),
        past: [...past, { spatial: project.spatial, calibration: project.calibration, label: next.label }],
      });
      mutate((p) => ({ ...p, spatial: next.spatial, calibration: next.calibration }));
    },

    setRoomTypes: (roomTypes) => mutate((p) => ({ ...p, roomTypes })),
    setRoles: (roles) => mutate((p) => ({ ...p, roles })),
    updateRole: (id, patch) => mutate((p) => ({ ...p, roles: p.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
    setStaff: (staff) => mutate((p) => ({ ...p, staff })),
    updateStaff: (id, patch) => mutate((p) => ({ ...p, staff: p.staff.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    updateSimulation: (patch) => mutate((p) => ({ ...p, simulation: { ...p.simulation, ...patch } })),
    setCoordinateFrames: (coordinateFrames) => mutate((p) => ({ ...p, coordinateFrames })),
    setObservedDatasetIds: (observedDatasetIds) => mutate((p) => ({ ...p, observedDatasetIds })),
  };
});

/** Convenience non-null project accessor for components rendered only when loaded. */
export const useP = <T,>(sel: (p: Project) => T): T => useProject((s) => sel(s.project!));

export type { Room, Door, CirculationArea, Obstacle, Anchor, Zone };
