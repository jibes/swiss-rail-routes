import { describe, expect, it } from 'vitest';
import {
  deriveKeys,
  formatKey,
  itemsOf,
  mergeEntries,
  newKey,
  open,
  parseKey,
  sameEntries,
  seal,
  stampLocal,
  stampsOf,
  TOMBSTONE_DAYS,
} from '../src/core/sync';

const item = (id: string, name: string) => ({ id, name });

describe('sync key', () => {
  it('formats 32 bytes as 13 groups and reads them back however typed', () => {
    const key = newKey();
    expect(key).toMatch(/^([0-9A-Z]{4}-){12}[0-9A-Z]{4}$/);
    const bytes = parseKey(key)!;
    expect(formatKey(bytes)).toBe(key);
    expect(parseKey(key.toLowerCase().replaceAll('-', ' '))).toEqual(bytes);
    expect(parseKey(key.replaceAll('0', 'O').replaceAll('1', 'l'))).toEqual(bytes);
    expect(parseKey(key.slice(0, -1))).toBeNull();
    expect(parseKey(key.slice(0, -1) + 'U')).toBeNull();
  });

  it('derives the same id on every device and a different one for another key', async () => {
    const k = parseKey(newKey())!;
    const a = await deriveKeys(k);
    const b = await deriveKeys(new Uint8Array(k));
    expect(a.id).toMatch(/^[\w-]{43}$/);
    expect(b.id).toBe(a.id);
    expect((await deriveKeys(parseKey(newKey())!)).id).not.toBe(a.id);
  });

  it('seals and opens; the wrong key cannot open it', async () => {
    const { aes } = await deriveKeys(parseKey(newKey())!);
    const doc = { v: 1, tours: [{ id: 'a', at: 1, value: item('a', 'Zürich ↺') }], trips: [] };
    const data = await seal(doc, aes);
    expect(data).not.toContain('Zürich');
    expect(await open(data, aes)).toEqual(doc);
    const other = (await deriveKeys(parseKey(newKey())!)).aes;
    await expect(open(data, other)).rejects.toThrow();
  });
});

describe('merging', () => {
  it('stamps changes with now, keeps unchanged times, turns removals into tombstones', () => {
    const first = stampLocal({}, [item('a', 'A'), item('b', 'B')], 100);
    const prev = stampsOf(first);
    const next = stampLocal(prev, [item('a', 'A'), item('c', 'C')], 200);
    expect(next).toEqual([
      { id: 'a', at: 100, value: item('a', 'A') },
      { id: 'c', at: 200, value: item('c', 'C') },
      { id: 'b', at: 200 },
    ]);
    expect(stampLocal(prev, [item('a', 'A2'), item('b', 'B')], 300)[0]!.at).toBe(300);
  });

  it('the newer change wins per item, both ways', () => {
    const phone = [
      { id: 'a', at: 300, value: item('a', 'renamed on phone') },
      { id: 'b', at: 100, value: item('b', 'B') },
    ];
    const laptop = [
      { id: 'a', at: 200, value: item('a', 'A') },
      { id: 'b', at: 250 }, // deleted on the laptop later
      { id: 'c', at: 260, value: item('c', 'new on laptop') },
    ];
    const m = mergeEntries(phone, laptop, 400);
    expect(itemsOf(m, [item('a', ''), item('b', '')])).toEqual([
      item('c', 'new on laptop'),
      item('a', 'renamed on phone'),
    ]);
    expect(sameEntries(m, mergeEntries(laptop, phone, 400))).toBe(true);
  });

  it(`forgets tombstones after ${TOMBSTONE_DAYS} days`, () => {
    const day = 86_400_000;
    expect(mergeEntries([{ id: 'x', at: 0 }], [], TOMBSTONE_DAYS * day - 1)).toHaveLength(1);
    expect(mergeEntries([{ id: 'x', at: 0 }], [], TOMBSTONE_DAYS * day)).toHaveLength(0);
  });
});
