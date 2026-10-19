/**
 * Local-first persistence in IndexedDB. Nothing leaves the device.
 *
 * Stores:
 *  - projects: Project JSON documents keyed by meta.id
 *  - blobs:    drawing PDFs keyed by blob key
 *  - datasets: observed datasets (typed arrays are structured-cloned natively)
 *  - settings: small key/value pairs (e.g. last opened project)
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { ID, ObservedDataset, Project } from '@/domain/types';
import { migrateProject } from '@/domain/migrations';

const DB_NAME = 'bsa-flow-explorer';
const DB_VERSION = 1;

let dbp: Promise<IDBPDatabase> | null = null;

function db() {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects');
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('datasets')) d.createObjectStore('datasets');
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings');
      },
    });
  }
  return dbp;
}

export interface ProjectSummary {
  id: ID;
  name: string;
  facilityName: string;
  updatedAt: string;
  isSample: boolean;
}

export async function saveProject(p: Project): Promise<void> {
  await (await db()).put('projects', p, p.meta.id);
  await setSetting('lastProjectId', p.meta.id);
}

export async function loadProject(id: ID): Promise<Project | null> {
  const raw = await (await db()).get('projects', id);
  return raw ? migrateProject(raw) : null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = (await (await db()).getAll('projects')) as Project[];
  return all
    .map((p) => ({ id: p.meta.id, name: p.meta.name, facilityName: p.meta.facilityName, updatedAt: p.meta.updatedAt, isSample: p.meta.isSample }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Delete a project and everything it owns (drawing blob, observed datasets). */
export async function deleteProject(id: ID): Promise<void> {
  const d = await db();
  const p = (await d.get('projects', id)) as Project | undefined;
  if (p?.floorPlan.blobKey) await d.delete('blobs', p.floorPlan.blobKey);
  for (const ds of p?.observedDatasetIds ?? []) await d.delete('datasets', ds);
  await d.delete('projects', id);
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await (await db()).put('blobs', blob, key);
}
export async function getBlob(key: string): Promise<Blob | null> {
  return ((await (await db()).get('blobs', key)) as Blob | undefined) ?? null;
}
export async function deleteBlob(key: string): Promise<void> {
  await (await db()).delete('blobs', key);
}

export async function putDataset(d: ObservedDataset): Promise<void> {
  await (await db()).put('datasets', d, d.meta.id);
}
export async function getDataset(id: ID): Promise<ObservedDataset | null> {
  return ((await (await db()).get('datasets', id)) as ObservedDataset | undefined) ?? null;
}
export async function deleteDataset(id: ID): Promise<void> {
  await (await db()).delete('datasets', id);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('settings', key)) as T | undefined;
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', value, key);
}
