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
}

export interface LegConstraint {
  forcedVias: string[];
  forcedLines: string[];
  /** Segment ids from `src/data/segments.json`, e.g. `gotthard-base`. */
  avoid: string[];
  modes: Mode[];
  maxTransfers?: number;
  minTransferMin: number;
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
