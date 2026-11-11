// What the MCP tests share (split from mcp.test.ts, which outgrew 800 lines): the fixtures' tool
// deps and names.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { ToolDeps } from '../../mcp/src/tools';
import { parseDepartures } from '../../src/core/ojp/departures';
import { parseJourney } from '../../src/core/ojp/journey';
import { stopKey } from '../../src/core/stops';
import { FIXTURE_DATE, ojpFor } from '../acceptance/ojp';
import { ga, index, templates } from './timetable';

export const NOW = Date.parse('2026-11-02T08:00:00Z');
export const URL_ = 'https://viadukt.example/';
export const T5 = {
  date: FIXTURE_DATE,
  departAt: '09:00',
  stops: [{ name: 'Interlaken Ost' }, { name: 'Kleine Scheidegg' }],
};

export const deps = (over: Partial<ToolDeps> = {}): ToolDeps => ({
  index,
  timetable: {
    trips: ojpFor('T5').fetchTrips,
    journey: async () =>
      parseJourney(readFileSync('tests/fixtures/ojp/tripinfo/running.xml', 'utf8')),
    // Interlaken Ost from 09:00 on the fixtures' day (recorded 6 Nov 2026).
    departures: async () =>
      parseDepartures(
        gunzipSync(readFileSync('tests/fixtures/ojp/departures/interlaken-ost.xml.gz')).toString(),
      ),
  },
  templates,
  ga,
  publicUrl: URL_,
  now: () => NOW,
  ...over,
});
export const nameOf = (r: string) => index.byRef(stopKey(r))?.name;
