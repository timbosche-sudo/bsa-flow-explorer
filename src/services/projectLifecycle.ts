/**
 * Project lifecycle: bootstrapping, new/open/save, drawing import and
 * portable archive (.bsaflow zip) export/import.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { ObservedDataset, Project, Track } from '@/domain/types';
import { CURRENT_SCHEMA_VERSION } from '@/domain/types';
import { defaultPrefs, defaultRoles, defaultRoomTypes, defaultSimulationConfig, uid } from '@/domain/defaults';
import { defaultCalibration } from '@/geometry/calibration';
import { migrateProject } from '@/domain/migrations';
import { createSampleProject, SAMPLE_PROJECT_ID } from '@/sample/sampleClinic';
import { useProject } from '@/store/projectStore';
import { useData } from '@/store/dataStore';
import { useDrawing } from '@/store/drawingStore';
import { usePlayback } from '@/store/playback';
import { useUI } from '@/store/uiStore';
import * as db from './persistence';
import { openPdf, pageSize } from './pdf';

export function blankProject(name = 'Untitled study'): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      id: uid('proj'),
      name,
      facilityName: '',
      description: '',
      studyArea: '',
      date: now.slice(0, 10),
      notes: '',
      createdAt: now,
      updatedAt: now,
      governanceAcknowledged: false,
      isSample: false,
    },
    floorPlan: { blobKey: null, fileName: null, pageCount: 0, pageIndex: 0, pageWidth: 2592, pageHeight: 1728, opacity: 1, visible: true, muted: false },
    calibration: defaultCalibration(),
    spatial: { rooms: [], doors: [], circulation: [], obstacles: [], zones: [], anchors: [] },
    roomTypes: defaultRoomTypes(),
    roles: defaultRoles(),
    staff: [],
    simulation: defaultSimulationConfig(),
    coordinateFrames: [{ id: 'frame-world', name: 'Building world frame (meters, y down)', unit: 'm', offset: { x: 0, y: 0 }, rotationDeg: 0, flipY: false }],
    observedDatasetIds: [],
    prefs: defaultPrefs(),
  };
}

/** Activate a project in the stores and (re)load its drawing, datasets and simulation. */
export async function activateProject(p: Project) {
  useProject.getState().load(p);
  useData.setState({ simulation: null, simStatus: 'idle', observed: {}, activeId: 'simulation', compareId: null });
  useUI.getState().select(null);
  // Drawings usually carry their own room labels; avoid duplicating them.
  const hasDrawing = !!(p.floorPlan.blobKey || p.floorPlan.bundledUrl);
  useUI.getState().setLayer('roomLabels', { visible: !hasDrawing });
  // Projects without movement inputs open in Plan mode; ready studies open in Explore.
  useUI.getState().setMode(p.staff.length && p.spatial.rooms.length ? 'explore' : 'plan');
  usePlayback.getState().setStudy(p.simulation.studyStartMin * 60, p.simulation.studyEndMin * 60);
  usePlayback.getState().setPlaying(false);
  useDrawing.getState().clear();
  void useDrawing.getState().ensure(p.floorPlan);
  const observed: Record<string, ObservedDataset> = {};
  for (const id of p.observedDatasetIds) {
    const d = await db.getDataset(id);
    if (d) observed[id] = d;
  }
  useData.getState().setObserved(observed);
  if (p.staff.length && p.spatial.rooms.length) void useData.getState().runSimulation(p);
}

export async function bootstrap(): Promise<void> {
  try {
    const last = await db.getSetting<string>('lastProjectId');
    if (last) {
      const p = await db.loadProject(last);
      if (p) return activateProject(p);
    }
  } catch (e) {
    console.warn('Could not open last project', e);
  }
  const sample = createSampleProject();
  try {
    await db.saveProject(sample);
  } catch {
    /* IndexedDB unavailable (private mode) — continue in memory */
  }
  await activateProject(sample);
}

export async function saveNow(): Promise<boolean> {
  const { project, revision } = useProject.getState();
  if (!project) return false;
  try {
    await db.saveProject(project);
    useProject.getState().markSaved(revision);
    return true;
  } catch (e) {
    useUI.getState().notify(`Save failed: ${e instanceof Error ? e.message : e}`, 'error');
    return false;
  }
}

export async function openProjectById(id: string) {
  await saveNow();
  const p = await db.loadProject(id);
  if (!p) throw new Error('Project not found');
  await db.setSetting('lastProjectId', id);
  await activateProject(p);
}

export async function createNewProject(name: string, acknowledged: boolean) {
  await saveNow();
  const p = blankProject(name);
  p.meta.governanceAcknowledged = acknowledged;
  await db.saveProject(p);
  await activateProject(p);
  useUI.getState().setMode('plan');
}

export async function resetSampleProject() {
  const p = createSampleProject();
  await db.saveProject(p);
  await activateProject(p);
}

export { SAMPLE_PROJECT_ID };

/**
 * Import (or replace) the drawing PDF. Analysis data, geometry and
 * calibration are retained; the user is told to verify alignment.
 */
export async function importDrawing(file: File): Promise<{ pageCount: number }> {
  const bytes = await file.arrayBuffer();
  const doc = await openPdf(bytes.slice(0));
  const page = await doc.getPage(1);
  const size = pageSize(page);
  const key = uid('pdf');
  await db.putBlob(key, new Blob([bytes], { type: 'application/pdf' }));
  const prev = useProject.getState().project!.floorPlan;
  useProject.getState().updateFloorPlan({
    blobKey: key,
    bundledUrl: undefined,
    fileName: file.name,
    pageCount: doc.numPages,
    pageIndex: 0,
    pageWidth: size.width,
    pageHeight: size.height,
    visible: true,
  });
  if (prev.blobKey) await db.deleteBlob(prev.blobKey);
  await useDrawing.getState().loadBytes(key, bytes, 0);
  await saveNow();
  return { pageCount: doc.numPages };
}

export async function selectDrawingPage(index: number) {
  const st = useDrawing.getState();
  if (!st.doc) return;
  const page = await st.doc.getPage(index + 1);
  const size = pageSize(page);
  useProject.getState().updateFloorPlan({ pageIndex: index, pageWidth: size.width, pageHeight: size.height });
  useDrawing.setState({ page, pageIndex: index, version: st.version + 1 });
}

// --- portable archive -----------------------------------------------------------

type SerialTrack = Omit<Track, 't' | 'x' | 'y' | 'gap'> & { t: number[]; x: number[]; y: number[]; gap: number[] };
const serTrack = (t: Track): SerialTrack => ({ ...t, t: Array.from(t.t), x: Array.from(t.x), y: Array.from(t.y), gap: Array.from(t.gap) });
const deTrack = (t: SerialTrack): Track => ({
  ...t,
  t: Float64Array.from(t.t),
  x: Float32Array.from(t.x),
  y: Float32Array.from(t.y),
  gap: Uint8Array.from(t.gap),
});

export async function exportArchive(): Promise<Blob> {
  const p = useProject.getState().project!;
  const files: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(p, null, 1)),
    'README.txt': strToU8(
      `BSA Flow Explorer project archive\nSchema version ${p.schemaVersion}\nProject: ${p.meta.name}\nExported: ${new Date().toISOString()}\n\nContents: project.json (metadata, geometry, calibration, staff, simulation settings), drawing.pdf (if any), datasets/*.json (imported observed datasets: raw and cleaned tracks).\nSimulated movement is not stored; it is regenerated deterministically from the saved settings and seed.\n`,
    ),
  };
  if (p.floorPlan.blobKey) {
    const b = await db.getBlob(p.floorPlan.blobKey);
    if (b) files['drawing.pdf'] = new Uint8Array(await b.arrayBuffer());
  }
  for (const d of Object.values(useData.getState().observed)) {
    files[`datasets/${d.meta.id}.json`] = strToU8(
      JSON.stringify({ ...d, rawTracks: d.rawTracks.map(serTrack), cleanTracks: d.cleanTracks.map(serTrack) }),
    );
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

export async function importArchive(file: File): Promise<Project> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!entries['project.json']) throw new Error('Not a BSA Flow Explorer archive (project.json missing).');
  const p = migrateProject(JSON.parse(strFromU8(entries['project.json'])));
  // Imported projects get a fresh id so they never overwrite an existing local project.
  p.meta = { ...p.meta, id: uid('proj'), isSample: false, name: p.meta.name.endsWith('(imported)') ? p.meta.name : `${p.meta.name} (imported)` };
  if (entries['drawing.pdf']) {
    const key = uid('pdf');
    await db.putBlob(key, new Blob([entries['drawing.pdf'] as BlobPart], { type: 'application/pdf' }));
    p.floorPlan = { ...p.floorPlan, blobKey: key, bundledUrl: undefined };
  }
  const ids: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith('datasets/') || !name.endsWith('.json')) continue;
    const raw = JSON.parse(strFromU8(data));
    const d: ObservedDataset = { ...raw, rawTracks: raw.rawTracks.map(deTrack), cleanTracks: raw.cleanTracks.map(deTrack) };
    await db.putDataset(d);
    ids.push(d.meta.id);
  }
  p.observedDatasetIds = ids;
  await db.saveProject(p);
  await activateProject(p);
  return p;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeFileName = (s: string) => s.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'project';
