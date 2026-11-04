// A platform the train reports other than the planned one is shown as a change, both platforms.
import { describe, expect, it } from 'vitest';
import { liveRides, platformMoved } from '../src/core/live';
import type { JourneyStatus } from '../src/core/ojp/journey';
import { zurichDateTime } from '../src/core/ojp/request';
import { DATE, conn, ref, ride } from './helpers/timetable';

const at = (hhmm: string) => zurichDateTime(`${DATE}T${hhmm}`);
const s = ride(
  'IC 1',
  [
    ['Zürich HB', '08:04'],
    ['Luzern', '08:45'],
  ],
  { journey: 'j1' },
);
const chain = [conn({ ...s, from: { ...s.from, platform: '7' } })];
const status = (platform?: string): JourneyStatus => ({
  cancelled: false,
  calls: [
    {
      key: ref('Zürich HB'),
      name: 'Zürich HB',
      dep: at('08:04'),
      platform,
      passed: false,
      cancelled: false,
    },
  ],
});

describe('a platform changed', () => {
  it('is the reported one beside the planned one', () => {
    const stop = liveRides(chain, new Map([['j1', status('9')]]))[0]!.stops[0]!;
    expect(stop).toMatchObject({ platform: '9', platformPlan: '7' });
    expect(platformMoved(stop)).toEqual({ now: '9', was: '7' });
  });

  it('is no change while the train reports the planned one, none or nothing', () => {
    const same = liveRides(chain, new Map([['j1', status('7')]]))[0]!.stops[0]!;
    const none = liveRides(chain, new Map([['j1', status()]]))[0]!.stops[0]!;
    const unreported = liveRides(chain, new Map())[0]!.stops[0]!;
    expect([same, none, unreported].map(platformMoved)).toEqual([undefined, undefined, undefined]);
    expect(none.platform).toBe('7');
  });
});
