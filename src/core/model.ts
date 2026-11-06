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
  /** Set on the stops a route template inserted; its rules apply to the leg containing them. */
  templateId?: string;
  /**
   * The scenic line that leads here from the station before (0.8.1): set on the line's end
   * only, so one station can end a line and start the next. Before, both ends carried the
   * line's templateId; `withLines` (src/core/line.ts) reads those as well.
   */
  line?: string;
  /** A scenic line's must-pass station between the two you entered (0.4.0): part of the line. */
  ring?: boolean;
  /**
   * Leave by then (`HH:MM`, Zurich, on the trip's date): the place closes (0.20.0). The planner
   * keeps to it, and says so where no connection can.
   */
  leaveBy?: string;
  /** Not there before then (`HH:MM`): the place opens; a stay starts then at the earliest. */
  arriveAfter?: string;
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
  | 'disruption'
  /** A notice its words grade as information ("Information zu …"): said, hardly counted. */
  | 'notice'
  /** The operator advises a reservation on this train: said, not counted. */
  | 'reservation-advised'
  /** A notice of the train about a stretch you do not ride: said, not counted. */
  | 'disruption-away'
  | 'after-sunset'
  /** A scenic line's own stretch ridden after sunset (and dusk): little to see. */
  | 'line-after-dark'
  | 'not-ga'
  /** A cable car or cog railway the GA data does not name: its cover is not known. */
  | 'ga-unknown'
  | 'reservation'
  | 'tight-transfer'
  /** A tight change the operator times its vehicles for (`timedChanges`): said, not counted. */
  | 'timed-change'
  /** A replacement bus on a scenic line's stretch: the view is from the road. */
  | 'replacement-bus'
  /** Asked again, the timetable no longer has this train. */
  | 'train-gone'
  | 'seasonal'
  /** The connection after this one on the leg leaves over `GAP_MIN` later: said, not counted. */
  | 'sparse'
  /** A scenic line the leg asks for is not ridden at that time (its stations not reached). */
  | 'line-missed'
  /** A day trip back only the next morning (the only way back there is). */
  | 'next-day'
  /** No connection leaves a stop by the time you asked to leave it (`leaveBy`). */
  | 'window-missed';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface StopCall {
  stopRef: string;
  name: string;
  /** Timetabled times. */
  arr?: string;
  dep?: string;
  /** Expected times, when the timetable service knew a delay as it answered (the day itself). */
  arrEst?: string;
  depEst?: string;
}

/**
 * A ride's end with its platform: `platform` is the timetable's (OJP `PlannedQuay`), what links,
 * the calendar and print carry; `platformEst` the one the service already knew another
 * (`EstimatedQuay`, asked on the day). With only an expected platform, `platform` is empty.
 */
export type PlatformCall = StopCall & { platform?: string; platformEst?: string };

/** One vehicle ride (or walk) inside a connection. Times are ISO 8601 with offset. */
/** A situation beyond its headline (OJP `PtSituation`). */
export interface NoticeInfo {
  /** How much it weighs, by the operator's words (`gradeNotice`): absent in plans saved before 0.21.2. */
  grade?: 'info' | 'warn' | 'error';
  /** Valid until (ISO, UTC), the latest end of its validity periods. */
  until?: string;
  /** The stops it names (`AffectedStopPlace`), when it names any. */
  affected?: string[];
  /** The operator's description and remarks, in their language. */
  detail?: string;
}

export interface Section {
  mode: Mode | 'walk';
  line?: string;
  category?: string;
  number?: string;
  operator?: string;
  from: PlatformCall;
  to: PlatformCall;
  intermediate: StopCall[];
  /** Track geometry, [lon, lat] pairs (GeoJSON order). */
  geometry?: [number, number][];
  reservationRequired?: boolean;
  supplement?: boolean;
  situationIds?: string[];
  /** Situation summaries, in the order of `situationIds` (operator's language). */
  notices?: string[];
  /** More of each notice, in the order of `notices` (absent in plans saved before 0.19.1). */
  noticeInfo?: NoticeInfo[];
  /** Product name as OJP gives it, e.g. "Luzern-Interlaken Express", "BERNINA EXPRESS". */
  product?: string;
  /** A walk's planned minutes (OJP `Duration`); walks carry no times of their own. */
  walkMin?: number;
  /** Dated journey (`<OperatingDay>:<JourneyRef>`): same value = same vehicle. */
  journey?: string;
  /** Where the vehicle goes (OJP `DestinationText`), as the departure boards say it. */
  destination?: string;
  /** A replacement bus standing in for the leg's scenic line: the line's stations from where it
   * leaves to where it arrives (stop keys, in order), passed by road though it calls at none
   * between (the Albula's express bus Thusis–Preda). Set by the planner. */
  byRoad?: string[];
  /**
   * How full the train is expected to be while you are on it (0.39.0), the fullest from where you
   * board to the last stop before you get off: 1 seats free, 2 few seats, 3 standing room only;
   * `[first class, second class]`. From OJP's `ExpectedDepartureOccupancy` (SBB and SOB trains
   * in the recorded answers; none for the RhB or the Bernese Oberland's).
   */
  occupancy?: [Occupancy | undefined, Occupancy | undefined];
}

export type Occupancy = 1 | 2 | 3;

export interface Connection {
  legIndex: number;
  /** Timetabled, walks at the ends included. */
  dep: string;
  arr: string;
  /** Expected, as `StopCall.depEst`/`arrEst`: the first and last ride's, walks included. */
  depEst?: string;
  arrEst?: string;
  transfers: number;
  sections: Section[];
}
