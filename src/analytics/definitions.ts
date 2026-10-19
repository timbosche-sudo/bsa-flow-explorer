/** Plain-language metric definitions shown alongside analytics. */
export const METRIC_DEFINITIONS: Record<string, string> = {
  distance:
    'Sum of straight-line distances between consecutive position samples inside the analysis window. Segments across tracking gaps are excluded (reported separately as an estimated lower bound).',
  trip: 'Movement between two consecutive room visits, from departure (start of the last continuous movement in the origin room) to arrival (first stop in the destination room).',
  visit: 'A continuous stay in a room (not circulation) of at least 20 seconds. Briefer passes are treated as pass-throughs.',
  dwell: 'Total time of all visits to a room by tracked staff.',
  presence: 'Time during which at least one tracked person was present in the space (union over people). This is staff presence, not clinical room utilisation — a room can be occupied by patients with no tracked staff present.',
  personTime: 'Sum over tracked people of time present (two people for 10 minutes = 20 person-minutes).',
  peak: 'Maximum number of tracked people simultaneously present.',
  moving: 'Share of tracked time spent moving faster than 0.3 m/s.',
  occupancy: 'Mean number of tracked people simultaneously present during each time bin.',
  encounter: 'Two tracked people within 1.5 m of each other while at least one is in circulation (counted once per approach). Indicates spatial overlap only.',
  segmentOccupancy: 'Simultaneous presence in ~2 m circulation segments, sampled every 2 s. High values show overlap, not confirmed obstruction.',
  heatPresence: 'Person-time spent in each cell, including stationary time.',
  heatMovement: 'Person-time spent in each cell while moving — the density of walking activity.',
  heatFrequency: 'Number of distinct passes through each cell while moving — how often a route is used, regardless of speed.',
  heatEncounters: 'Locations of encounters between tracked people.',
};
