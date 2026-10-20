# BSA Flow Explorer

**Portable clinical movement analysis and spatial intelligence platform.**

BSA Flow Explorer is a local-first browser application for studying how healthcare staff move through clinics. You can import architectural floor plans (PDF), calibrate them to real-world scale and define rooms, doors and circulation. You can then generate configurable *simulated* staff movement or import *observed* positions from wearable tracking systems. The app plays movement back over the plan and analyses travel, dwell, congestion and origin–destination patterns.

> On first launch the app opens a fictional sample clinic with ten simulated staff. Everything derived from it is labelled **SIMULATED DATA — DEMONSTRATION ONLY**. Simulated movement is a hypothetical model, not measured evidence.

## Live preview

The `main` branch deploys automatically to GitHub Pages:
**https://timbosche-sudo.github.io/bsa-flow-explorer/**

(Workflow: `.github/workflows/deploy-pages.yml`. Production builds use the base path `/bsa-flow-explorer/`; set `BASE_PATH=/` to build for a different host.)

## Quick start

Requires Node.js 20+ (developed on Node 22).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # production build in dist/
BASE_PATH=/bsa-flow-explorer/ npm run preview   # serve the production build at its Pages path
```

After installation no internet connection is required. Fonts and libraries are bundled, and the app makes no external requests involving project or location data. There is no telemetry.

## What you can do

| Mode | Purpose |
|---|---|
| **1 Plan** | Import a PDF (vector or raster), choose the page, calibrate the scale with two points and verify it with a second dimension. Set the origin and rotation. Draw rooms (rectangle or polygon), doors, circulation areas, obstacles, zones and planned UWB anchors. A validation panel lists missing doors, unreachable rooms, disconnected corridors and invalid polygons. |
| **2 Configure** | Edit staff roles, activity workflows (destinations, frequencies, dwell distributions, chaining), breaks, peak periods, home bases, shift times and walking speeds. Set the random seed and re-run the simulation. |
| **3 Explore** | Play back a shift at 1×–60× or an adaptive speed, scrub and set the analysis window. Show trails, build-up or full trajectories. Select a person to see their current room, simulated activity and destination, distance and moving/stationary time up to the current moment, and travel history. Inspect individual data points. |
| **4 Analyze** | Overview statistics, heatmaps (movement density, presence, circulation frequency, encounters), room visits and dwell with a choropleth, circulation overlap and congestion, an origin–destination matrix with flow arcs, time-of-day charts, and role, period and dataset comparisons with normalized metrics and difference maps. |
| **5 Present** | A simplified client-facing view with title block, key figures, view switcher and the dataset designation always visible. |

**Import / export**
- Tracking data: CSV or JSON import wizard with column mapping, timestamp formats and UTC offset, units, coordinate frames, tag→role association, and a documented validation and cleaning report.
- Graphics: high-resolution PNG of the current view or of heatmap, trajectory and room-utilisation presets, plus a tabloid PDF report. Every graphic carries the project, analysis, time window, filters, legend, units, date, dataset type and data-quality notes.
- Data: CSV of observations, staff-level, room-level and origin–destination statistics (with a provenance header). Project JSON and a portable `.bsaflow` archive (project + drawing + datasets).

**Persistence:** projects autosave to IndexedDB in the browser. The schema is versioned with migrations (`src/domain/migrations.ts`).

## Architecture

```
src/
  domain/        types (strict data model), defaults, validation, migrations
  geometry/      vectors, polygons, calibration (sheet↔world transforms), remap, walls
  routing/       navigation grid, A*, Dijkstra fields, string pulling, spatial context
  simulation/    seeded RNG, activity-based simulation engine (runs in a Web Worker)
  analytics/     visits, trips, dwell, occupancy, heatmaps, congestion, OD, definitions
  importer/      observed-data parsing, frame transforms, validation & cleaning
  positioning/   positioning-engine interface + reference multilateration (raw UWB ranges)
  services/      PDF.js, IndexedDB persistence, project lifecycle, exports, worker client
  store/         Zustand stores (project + undo history, UI, view, playback clock, data)
  ui/            React components: workspace layers, panels, dialogs, charts
sample/          fictional sample clinic (geometry shared with the generated PDF)
scripts/         sample PDF and synthetic-export generators, benchmark
docs/            data formats, hardware integration, JSON schemas, user guide
```

Key design decisions:

- **Coordinates.** All geometry and analytics use calibrated *world meters* (x right, y down from the drawing origin). The calibration is a similarity transform from PDF sheet points, and the view transform maps world to screen. Re-calibrating, moving the origin or rotating keeps existing geometry aligned with the drawing.
- **Routing.** Walkable space is rasterised into a ~0.2 m occupancy grid. Movement between different spaces is allowed **only through doors** (a door's footprint must connect exactly the two spaces either side of the wall), so routes never pass through walls. Restricted rooms forbid through-traffic, one-way doors are honoured and obstacles block cells. Paths come from 8-connected A*, shortened by line-of-sight string pulling. Their lengths are the travel distances.
- **Simulated vs observed.** Both produce the same `Track` structure, so analytics treat them identically. Datasets are never merged. Simulated activity and destination labels exist only for simulation; for observed data they are never invented.
- **Rendering.** React renders panels and vector geometry. Observations are drawn imperatively on canvases subscribed to a playback clock, so React never renders individual samples. The PDF re-renders the visible region at screen resolution after zooming.

## Data trustworthiness

- Metrics carry a basis tag (*Simulated*, *Calculated*, *Estimated*) and a plain-language definition (`src/analytics/definitions.ts`).
- Distance counts only movement at or above 0.3 m/s. Tracking gaps are never interpolated through walls: they split tracks, and the straight-line displacement across a gap is reported separately as an estimated lower bound.
- Staff presence is labelled as presence, not clinical room utilisation. Circulation overlap is labelled as overlap, not confirmed congestion.
- Warnings appear when the plan is uncalibrated, the spatial model is incomplete, positional accuracy is unknown, or gaps are significant.

## Privacy

Data uses pseudonymous tag IDs and no employee names, and is stored locally only. Rooms can be marked *sensitive* to exclude them from visualizations and exports. Group results below a configurable minimum group size are suppressed. A study-governance acknowledgment is required when creating a project. **The software does not by itself guarantee HIPAA or other regulatory compliance.**

## Documentation

- [User guide](docs/USER_GUIDE.md)
- [Data formats](docs/DATA_FORMATS.md) and [JSON schemas](docs/schemas/)
- [Hardware integration](docs/HARDWARE_INTEGRATION.md)

## Testing

`npm test` runs the unit tests: calibration and transforms, polygon validity and containment, route connectivity and shortest paths (walls, doors, one-way doors, obstacles, restricted rooms), simulation reproducibility and no-teleport checks, interpolation, time filtering, visit/dwell/trip detection, distance with gaps and jumps, heatmaps, congestion, origin–destination, import validation and cleaning, and multilateration.

`npx vite-node scripts/benchmark.ts` checks performance at study scale. 50 tags × 12 h at 1 Hz is 2.2 M samples; in the development environment analytics took about 0.4 s, a heatmap about 0.1 s and congestion about 0.4 s.

## Known limitations

- **Assisted room detection from drawing graphics is not implemented.** Rooms are defined manually (rectangle or polygon with vertex snapping).
- Single floor per project: Z is stored but not analysed. One PDF page is active at a time.
- Visits and trips use simple, documented thresholds (20 s minimum visit, 0.3 m/s movement threshold). They are not configurable in the UI yet.
- The included multilateration solver is a reference implementation for integration testing, not a validated positioning system. No live hardware connection exists yet.
- The sample clinic and the simulated workflows are illustrative assumptions. Simulated walking volumes reflect those assumptions, not benchmarks.
- Undo/redo covers spatial editing and calibration only, not metadata or simulation settings.
- Graphic exports reproduce the current view. Very large plans exported at 4× may approach browser canvas size limits.
