# Swiss Rail Day-Trip Planner

Plans a scenic Swiss rail day trip (forced routes, stops with dwell time, round trip) as one validated timetable, with GA validity, reservation, disruption and after-sunset warnings.

**Status:** spec only, see [`docs/SPEC.md`](docs/SPEC.md).

## Privacy
Tours stay on the device. Leg queries (stops, date, time) go to this app's Cloudflare Worker, which forwards them to opentransportdata.swiss (OJP). Map tiles come from OpenFreeMap. No accounts, analytics or tracking.

## Licence
AGPL-3.0-or-later.
