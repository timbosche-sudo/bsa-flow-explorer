# Hardware integration

BSA Flow Explorer runs entirely without tracking hardware. This document describes how a portable UWB kit is expected to connect to it in the future.

## Expected kit

- ESP32 microcontrollers with UWB modules (for example DW3000-class).
- Fixed temporary anchors. Their positions are planned in **Plan → Spatial definition → Anchors** and surveyed on site.
- Battery-powered wearable tags, identified by pseudonymous IDs only.
- A local Raspberry Pi (or similar) collection hub. No hospital internet is required.

## Data path

```
tags ⇄ anchors ──ranges──▶ collection hub ──▶ positioning engine ──▶ position CSV/JSON ──▶ Import wizard
                               (raw ranges archived)                  (schemas/position-observation)
```

1. **Raw ranges** (`RangeObservation`, see `src/domain/types.ts`) are archived on the hub exactly as measured.
2. **A positioning engine** (`PositioningEngine` in `src/positioning/positioning.ts`) combines near-simultaneous ranges with surveyed anchor coordinates to produce positions with residual and GDOP indicators. The repository includes `leastSquaresEngine`, a reference 2D Gauss–Newton multilaterator. It is for testing and integration only; it is not a validated positioning system.
3. **Positions** are exported in the documented CSV/JSON format and imported through the wizard. The wizard handles coordinate frame mapping, time conversion and quality filtering.

Do not assume the hardware's X/Y output is reliable. Before trusting room- or corridor-level conclusions, record a calibration walk along known paths and enter the achieved accuracy as the dataset's *positional accuracy*. Analytics show warnings when accuracy is unknown or coarse.

## Anchor planning

The anchor distribution layer counts planned anchors within a chosen radius of each walkable cell. It is a geometric planning aid only: walls, equipment, antenna orientation and RF conditions are not modelled. Record measured survey coordinates for each anchor once installed.

## Future work (not implemented)

- Tag discovery, battery monitoring and configuration over the hub.
- Hub synchronisation API: a local HTTP endpoint delivering the position schema.
- Range-level import and an in-app positioning run using `PositioningEngine`.
- Anchor calibration recordings and geometry validation (GDOP maps from surveyed anchors).
- Tracking-quality dashboards.
