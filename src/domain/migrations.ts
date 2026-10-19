/**
 * Project schema migrations. Each migration upgrades a raw stored/imported
 * project by one schema version. Add new steps here when the schema changes.
 */
import { CURRENT_SCHEMA_VERSION, type Project } from './types';
import { defaultPrefs } from './defaults';

type Raw = Record<string, unknown> & { schemaVersion?: number };

const MIGRATIONS: Record<number, (p: Raw) => Raw> = {
  // 0 -> 1: introduce prefs and coordinate frames.
  0: (p) => ({
    ...p,
    schemaVersion: 1,
    prefs: (p.prefs as object) ?? defaultPrefs(),
    coordinateFrames: (p.coordinateFrames as unknown[]) ?? [],
    observedDatasetIds: (p.observedDatasetIds as unknown[]) ?? [],
  }),
};

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid project file');
  let p = raw as Raw;
  let v = typeof p.schemaVersion === 'number' ? p.schemaVersion : 0;
  if (v > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Project was created by a newer version (schema ${v}); please update BSA Flow Explorer.`);
  }
  while (v < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from schema ${v}`);
    p = step(p);
    v = p.schemaVersion as number;
  }
  const proj = p as unknown as Project;
  if (!proj.meta || !proj.spatial || !proj.calibration) throw new Error('Project file is missing required sections');
  proj.prefs = { ...defaultPrefs(), ...proj.prefs };
  return proj;
}
