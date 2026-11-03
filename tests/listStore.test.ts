import { describe, expect, it } from 'vitest';
import { applyChanges, changesOf, readUnsaved, settleUnsaved } from '../src/io/listStore';

const item = (id: string, n = 0) => ({ id, n });

describe('saved lists: changes item by item', () => {
  it('records what changed: edited, added, removed', () => {
    const a = item('a');
    const b = item('b');
    const before = [a, b];
    const after = [item('c'), { ...a, n: 1 }];
    const c = changesOf(before, after);
    expect([...c.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(c.get('b')).toBeNull();
    expect(c.get('a')).toEqual({ id: 'a', n: 1 });
    // The same objects again: nothing to save.
    expect(changesOf(before, [...before]).size).toBe(0);
  });

  it('applies them to what another tab stored, never dropping its items', () => {
    // Tab A stored x (B does not know it); B edits a and removes b.
    const stored = [item('x'), item('a'), item('b')];
    const changes = changesOf([item('a'), item('b')], [{ id: 'a', n: 2 }]);
    expect(applyChanges(stored, changes)).toEqual([item('x'), { id: 'a', n: 2 }]);
  });

  it('puts new items first and keeps the stored order otherwise', () => {
    const changes = changesOf([], [item('n')]);
    expect(applyChanges([item('a'), item('b')], changes).map((x) => x.id)).toEqual(['n', 'a', 'b']);
  });

  it('reads what a page left unsaved: edits and removals, nothing when unreadable', () => {
    const left = readUnsaved(
      JSON.stringify([
        ['a', item('a', 2)],
        ['b', null],
      ]),
    );
    expect(applyChanges([item('a'), item('b'), item('c')], left)).toEqual([
      item('a', 2),
      item('c'),
    ]);
    expect(readUnsaved(null).size).toBe(0);
    expect(readUnsaved('{not json').size).toBe(0);
    expect(readUnsaved('{"a":1}').size).toBe(0);
  });

  it('a write that finished takes its change out of what was left unsaved, no other', () => {
    const raw = JSON.stringify([
      ['a', item('a', 2)],
      ['b', null],
      ['c', item('c', 5)],
    ]);
    // a as left, b's removal: stored now. c was edited again by another tab: stays.
    const written = new Map<string, { id: string; n: number } | null>([
      ['a', item('a', 2)],
      ['b', null],
      ['c', item('c', 4)],
    ]);
    expect(readUnsaved(settleUnsaved(raw, written))).toEqual(new Map([['c', item('c', 5)]]));
    expect(
      settleUnsaved(
        raw,
        new Map([
          ['a', item('a', 2)],
          ['b', null],
          ['c', item('c', 5)],
        ]),
      ),
    ).toBeNull();
    expect(settleUnsaved(null, written)).toBeNull();
  });
});
