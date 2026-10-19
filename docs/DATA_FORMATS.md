# Data formats

All study data stays on the local device. Files are parsed in the browser.

## Coordinate systems

| System | Units | Origin / axes |
|---|---|---|
| Sheet | PDF points (1/72 in) | Top-left of the PDF page as rendered by PDF.js at scale 1, y down |
| World | meters | User-defined drawing origin, x right, **y down** (plan north up) |
| Positioning frame | m / ft / cm / mm | Whatever the positioning system uses; mapped to world by a *coordinate frame* |

The calibration maps sheet to world (uniform scale, rotation and translation). A coordinate frame maps incoming positions to world:

```
world = offset + R(rotation) · (x, flipY ? −y : y)
```

`offset` is the world position (in meters) of the positioning system's (0,0). Use `flipY` for engineering frames where y points up.

## Position observations (CSV)

One row per position. Column names can differ, because the import wizard maps them. Recommended header:

```
study_id,tag_id,timestamp_utc,x_m,y_m,z_m,frame_id,source,quality,uncertainty_m
CLINIC-01,UWB-001,2025-03-12T14:00:00.000Z,20.047,8.385,1.20,uwb-frame-1,uwb-twr,0.78,0.15
```

| Field | Required | Notes |
|---|---|---|
| `tag_id` | yes | Pseudonymous. Never put names here. |
| `timestamp_utc` | yes | ISO 8601 UTC (preferred), Unix seconds or milliseconds, or local `HH:MM:SS` with a study date |
| `x_m`, `y_m` | yes | Calibrated building coordinates. Not pixels. |
| `z_m` | no | Kept for future multi-floor use |
| `frame_id`, `source` | recommended | Provenance |
| `quality`, `uncertainty_m` | no | `uncertainty_m` can be used as an import filter |

JSON import accepts either an array of objects or `{ "observations": [...] }`, with the fields of [`schemas/position-observation.schema.json`](schemas/position-observation.schema.json). One level of nested objects (e.g. `position.x`) is flattened for mapping.

## Import validation and cleaning

Every check below is reported with a count and the action taken. Nothing is removed silently.

| Check | Default | Action |
|---|---|---|
| Missing timestamp / tag / coordinate | — | Excluded |
| Exact duplicates | — | One copy kept |
| Same tag and time, different position | — | First record kept |
| Non-monotonic timestamps | — | Re-sorted by time (kept) |
| Implausible speed | > 3 m/s | Excluded from clean tracks |
| Tracking gap | > 30 s | Track split, no interpolation across the gap |
| Outside mapped area | disabled | Flagged, or excluded with a margin |
| Stated uncertainty | disabled | Excluded above threshold |
| Moving-median smoothing | disabled | Applied to clean tracks only |

Raw observations, mapped to world coordinates but otherwise untouched, are stored separately from the cleaned tracks. Provenance records the column mapping, time conversion, frame transform and cleaning summary.

## Time

Imported UTC timestamps are converted to local study time using the site's UTC offset entered in the wizard. Analytics use seconds since local midnight of the study date.

## Raw UWB ranges

Ranges follow [`schemas/range-observation.schema.json`](schemas/range-observation.schema.json). They are a separate data type from positions; see [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md).

## Project archive (`.bsaflow`)

A zip file containing:

- `project.json` — project metadata, calibration, geometry, staff, roles, simulation settings and seed. It carries a `schemaVersion`, and older archives are migrated on open.
- `drawing.pdf` — the floor plan drawing.
- `datasets/*.json` — imported datasets with raw and clean tracks.

Simulated movement is not stored. It is regenerated deterministically from the settings and seed.

## Exports

CSV exports use world meters and local study time. Each CSV starts with comment lines (`#`) giving the project, dataset type (SIMULATED / OBSERVED / SYNTHETIC TEST), analysis window and units.
