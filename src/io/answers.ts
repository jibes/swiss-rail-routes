// Timetable answers kept on the device (IndexedDB database `srr.answers.v1`, one entry per
// query): the planner asks the service only for questions not answered yet, or answered too
// long ago (core/answers.ts). Answers that are no longer good go once a visit, after the first
// one kept. A storage failure only means asking again.
import { createStore, delMany, entries, get, set } from 'idb-keyval';
import { answerKey, dayOfQuery, stillGood, toDrop, type KeptAnswer } from '../core/answers';
import type { Connection } from '../core/model';
import type { TripQuery } from '../core/ojp/request';
import { log } from './log';
import { fetchTrips } from './ojp';

let store: ReturnType<typeof createStore> | undefined;
const db = () => (store ??= createStore('srr.answers.v1', 'answers'));

let tidied = false;

/** Drops what is no longer good, and the oldest beyond the size limit. */
export async function tidyAnswers(now = Date.now()): Promise<void> {
  try {
    const all = await entries<string, KeptAnswer>(db());
    const drop = toDrop(all, now);
    if (drop.length) await delMany(drop, db());
    log('answers.tidy', { kept: all.length - drop.length, dropped: drop.length });
  } catch (e) {
    log('answers.tidy.fail', { e });
  }
}

/** `fetchTrips`, answered from the device when it asked the same not long ago. */
export async function cachedTrips(q: TripQuery, signal?: AbortSignal): Promise<Connection[]> {
  const key = answerKey(q);
  const now = Date.now();
  const kept = await get<KeptAnswer>(key, db()).catch(() => undefined);
  if (kept && stillGood(kept, now) && Array.isArray(kept.connections)) {
    log('ojp.trip.kept', {
      from: q.origin.name,
      to: q.destination.name,
      time: q.time,
      age: Math.round((now - kept.at) / 1000),
      connections: kept.connections.length,
    });
    return kept.connections;
  }
  const connections = await fetchTrips(q, signal);
  const answer: KeptAnswer = {
    day: dayOfQuery(q),
    at: Date.now(),
    size: JSON.stringify(connections).length,
    connections,
  };
  await set(key, answer, db()).catch((e: unknown) => log('answers.keep.fail', { e }));
  if (!tidied) {
    tidied = true;
    void tidyAnswers();
  }
  return connections;
}
