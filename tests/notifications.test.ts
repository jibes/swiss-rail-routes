// Trip notifications in the app (src/io/notifications.ts): what was scheduled is cancelled
// before anything else, and the trains are scheduled even when the stop index cannot load.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTrip } from '../src/core/trip';
import { DATE, conn, ref, ride } from './helpers/timetable';
import { newTour } from './helpers/edit';

const calls: string[] = [];
const LocalNotifications = {
  checkPermissions: vi.fn(async () => ({ display: 'granted' })),
  getPending: vi.fn(async () => ({ notifications: [{ id: 7 }] })),
  cancel: vi.fn(async () => void calls.push('cancel')),
  createChannel: vi.fn(async () => undefined),
  schedule: vi.fn(async (o: { notifications: { id: number; title: string }[] }) => {
    calls.push(`schedule ${o.notifications.length}`);
  }),
};

afterEach(() => {
  vi.doUnmock('@capacitor/local-notifications');
  vi.doUnmock('../src/native');
  vi.doUnmock('../src/io/stops');
});

async function setup(stops: () => Promise<unknown>) {
  vi.resetModules();
  calls.length = 0;
  for (const f of Object.values(LocalNotifications)) f.mockClear();
  vi.doMock('@capacitor/local-notifications', () => ({ LocalNotifications }));
  vi.doMock('../src/native', () => ({ isNative: true, publicUrl: () => '' }));
  vi.doMock('../src/io/stops', () => ({ stopSearch: stops }));
  return import('../src/io/notifications');
}

const chain = [
  conn(
    ride('IR 70', [
      ['Zürich HB', '08:04'],
      ['Luzern', '08:45'],
    ]),
  ),
];
const trip = newTrip(
  'trip-n',
  newTour('r', DATE, { stopRef: ref('Zürich HB'), name: 'Zürich HB' }),
  [],
  { connections: chain, warnings: [], score: 0, dep: chain[0]!.dep, arr: chain[0]!.arr },
  new Date(0),
);
const before = Date.parse(`${DATE}T06:00:00Z`);

describe('scheduleTrips', () => {
  it('cancels what was scheduled first, then schedules the trains', async () => {
    const { scheduleTrips } = await setup(async () => ({ byRef: () => undefined }));
    await scheduleTrips([trip], 'en', before);
    expect(calls).toEqual(['cancel', 'schedule 2']);
  });

  it('without the stop index the trains are still scheduled, the old notices gone', async () => {
    const { scheduleTrips } = await setup(async () => {
      throw new Error('no index');
    });
    await scheduleTrips([trip], 'en', before);
    expect(calls).toEqual(['cancel', 'schedule 2']);
  });
});
