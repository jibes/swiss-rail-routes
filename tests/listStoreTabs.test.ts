// Two tabs on one list (review of 11 Nov 2026): another tab's save, landing while this tab's
// own edit is being written, must not take that edit back out of this tab's memory.
import 'fake-indexeddb/auto';
import { get } from 'idb-keyval';
import { expect, it, vi } from 'vitest';

vi.mock('../src/io/log', () => ({ log: () => undefined }));

it('keeps an edit in flight when another tab saved', async () => {
  const { savedList } = await import('../src/io/listStore');
  type I = { id: string; n: number };
  const read = (raw: unknown) => (Array.isArray(raw) ? (raw as I[]) : []);
  const a = savedList<I>('srr.race.v1', read);
  const b = savedList<I>('srr.race.v1', read);
  let shownA: I[] = [];
  a.onOtherTab((l) => (shownA = l));
  await a.load();
  await b.load();
  const x = { id: 'x', n: 0 };
  await a.save([], [x], true);
  // A's own edit, made the moment B's message lands.
  const spy = new BroadcastChannel('srr-list:srr.race.v1');
  const edited = { id: 'x', n: 1 };
  spy.onmessage = () => void a.save([x], [edited], true);
  await b.save([], [{ id: 'y', n: 0 }], true);
  await new Promise((r) => setTimeout(r, 200));
  spy.close();
  expect(((await get('srr.race.v1')) as I[]).find((i) => i.id === 'x')?.n).toBe(1);
  expect(shownA.find((i) => i.id === 'x')?.n).toBe(1);
});
