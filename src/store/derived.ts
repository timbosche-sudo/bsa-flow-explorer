/** Memoised derived data shared across components. */
import { useMemo } from 'react';
import type { Project, SpatialModel } from '@/domain/types';
import { SpatialContext } from '@/routing/spatialContext';
import { validateProject } from '@/domain/validation';
import { useProject } from './projectStore';

let cache: { spatial: SpatialModel; ctx: SpatialContext } | null = null;

/** Spatial context for the current spatial model (rebuilt when geometry changes). */
export function getSpatialContext(spatial: SpatialModel): SpatialContext {
  if (cache?.spatial !== spatial) cache = { spatial, ctx: new SpatialContext(spatial) };
  return cache.ctx;
}

export function useSpatialContext(): SpatialContext {
  const spatial = useProject((s) => s.project!.spatial);
  return useMemo(() => getSpatialContext(spatial), [spatial]);
}

export function useValidation() {
  const project = useProject((s) => s.project!) as Project;
  const ctx = useSpatialContext();
  return useMemo(() => validateProject(project, ctx), [project.spatial, project.calibration, project.roles, project.staff, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
}
