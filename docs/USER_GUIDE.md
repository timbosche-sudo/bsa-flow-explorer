# User guide

## 1. First look (sample clinic)

1. Open the app. The fictional sample clinic loads in **Explore** mode with ten simulated staff.
2. Press **Space** or ▶ in the timeline. *Auto* speed plays the whole shift in about 90 seconds.
3. Click a staff marker (Select staff tool, **S**) or a name in the left list to see their current room, simulated activity and destination, distance so far and travel history.
4. Drag the timeline handles to set an **analysis window**, or choose a preset (Morning, Afternoon, peak periods). Every statistic, heatmap and chart follows this window.
5. Switch to **Analyze** (**4**). Choose a view on the left: Overview, Heatmaps, Rooms & dwell, Congestion, Origin–destination, Time of day or Compare. Use the role chips to filter, for example to RN or MA.
6. Click a room on the plan to see its visits, dwell, presence and occupancy over time.
7. **Export** (toolbar) to get a presentation-quality PNG or PDF, or CSV data.

## 2. A new study

1. **New project** (toolbar) and acknowledge the governance statement.
2. **Import floor plan** (toolbar) and choose a PDF. For multi-page PDFs, choose the page under *Floor plan → Page*.
3. **Calibrate** (**K**): click both ends of a known dimension (hold Shift to constrain the line). Enter its length in decimal feet or meters, then apply. Use **Verify** to check a second dimension; the error is recorded.
4. Optionally **Set origin** (**G**) and **Rotate**. Existing geometry stays aligned.
5. Draw **rooms** (**R** rectangle, **P** polygon). Click the first point, double-click or press Enter to close a polygon. Backspace removes the last point, Esc cancels. Set name, number, type and zone in the right panel.
6. Draw **circulation** (**C**). Corridors that overlap or touch form one network.
7. Place **doors** (**D**) on walls between spaces, including corridor-to-room openings. Wide openings such as an open nurse station are doors with a large width.
8. Add **obstacles** (**O**) such as casework or columns, and planned **anchors** (**A**).
9. Fix anything in the **Validation** list (right panel, Plan mode). Click an issue to zoom to it.
10. In **Configure**, add staff by role, adjust workflows and run the simulation.

Editing tips: **E** edits vertices (drag; double-click an edge to add; Alt-click to remove). Ctrl+Z / Ctrl+Shift+Z undo and redo. Delete removes the selected item. Lock geometry from the inspector to prevent accidental changes. Drag empty space to pan and scroll to zoom. **F** fits the plan.

## 3. Importing tracking data

Toolbar → **Import tracking data**:

1. Choose one or more CSV/JSON files.
2. Map the columns (tag, timestamp, x, y are required).
3. Set the timestamp format, the site's offset from UTC, the study date and the units.
4. Define the coordinate frame: the world position of the system's (0,0), its rotation, and whether its Y axis points up. Check that the preview points fall inside rooms.
5. Assign tags to roles.
6. Review the validation and cleaning report, adjust thresholds, name the dataset and enter its known positional accuracy. Then import.

The dataset becomes active and the timeline adjusts to its time span. Switch datasets under *Dataset* in Explore or Analyze, where you can also view provenance and delete datasets. Try the wizard with `public/sample/synthetic-tag-export-TEST.csv`, which is synthetic data with injected defects: use offset −1, 19, Y up and UTC−5.

## 4. Reading the analytics

- **Movement density** shows where walking happens. **Circulation frequency** counts distinct passes. **Presence** includes standing still. None of these is congestion.
- **Dwell** is the time in visits of at least 20 s. **≥1 present** is the share of time with any tracked staff member in the room. It is not patient or clinical utilisation.
- **Congestion** reports simultaneous people in ~2 m circulation segments and encounters within 1.5 m. These are overlaps, not confirmed obstructions.
- **Compare** normalizes per tracked staff-hour, so windows or datasets with different durations or staffing are comparable.
- Tags marked *Simulated*, *Calculated* or *Estimated* tell you how each value was obtained.

## 5. Presenting

**Present** mode (**5**) hides the editing tools. Use the view buttons (Movement, Heatmap, Room use, Overlap, Flows), play the timeline and export from the top-right. Rooms marked *sensitive* are excluded.

## 6. Moving projects between computers

Export → **Project archive (.bsaflow)**, then on the other computer Open project → **Import archive**. Simulated movement regenerates from the saved seed.
