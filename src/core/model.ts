// Entities from docs/SPEC.md §2. Pure types, no runtime code.

export type TicketType = 'GA' | 'Tageskarte' | 'Halbtax' | 'none';
export type WaypointKind = 'start' | 'via' | 'stop' | 'turnaround' | 'end';
export type Mode = 'rail' | 'cog' | 'cableCar' | 'boat' | 'bus';

/** Local date `YYYY-MM-DD` and time `HH:MM` in Europe/Zurich. */
export type Anchor = { departAt: string } | { arriveBy: string };

export interface Waypoint {
  /** SLOID, e.g. `ch:1:sloid:3000`. */
  stopRef: string;
  name: string;
  kind: WaypointKind;
  dwellMin: number;
  earliestArr?: string;
  latestDep?: string;
  /** Set on the stops a route template inserted; its rules apply to the leg containing them. */
  templateId?: string;
  /** A scenic line's must-pass station between the two you entered (0.4.0): part of the line. */
  ring?: boolean;
}

export interface Tour {
  id: string;
  name: string;
  date: string;
  anchor: Anchor;
  ticket: TicketType;
  travelClass: 1 | 2;
  waypoints: Waypoint[];
  notes?: string;
  schema: 1;
}

export interface Leg {
  index: number;
  from: Waypoint;
  to: Waypoint;
  /** Ride-through waypoints between `from` and `to`. */
  vias: Waypoint[];
}

export type WarningType =
  'disruption' | 'after-sunset' | 'not-ga' | 'reservation' | 'tight-transfer' | 'seasonal';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface StopCall {
  stopRef: string;
  name: string;
  arr?: string;
  dep?: string;
}

/** One vehicle ride (or walk) inside a connection. Times are ISO 8601 with offset. */
export interface Section {
  mode: Mode | 'walk';
  line?: string;
  category?: string;
  number?: string;
  operator?: string;
  from: StopCall & { platform?: string };
  to: StopCall & { platform?: string };
  intermediate: StopCall[];
  /** Track geometry, [lon, lat] pairs (GeoJSON order). */
  geometry?: [number, number][];
  reservationRequired?: boolean;
  supplement?: boolean;
  situationIds?: string[];
  /** Situation summaries, in the order of `situationIds` (operator's language). */
  notices?: string[];
  /** Product name as OJP gives it, e.g. "Luzern-Interlaken Express", "BERNINA EXPRESS". */
  product?: string;
  /** A walk's planned minutes (OJP `Duration`); walks carry no times of their own. */
  walkMin?: number;
  /** Dated journey (`<OperatingDay>:<JourneyRef>`): same value = same vehicle. */
  journey?: string;
}

export interface Connection {
  legIndex: number;
  dep: string;
  arr: string;
  transfers: number;
  sections: Section[];
}
