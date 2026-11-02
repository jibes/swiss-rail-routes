import { describe, expect, it } from 'vitest';
import {
  appendLog,
  emptyLog,
  LOG_LINE_CHARS,
  logLine,
  logSize,
  logText,
  screenOf,
  scrub,
} from '../src/core/log';

describe('debug log', () => {
  it('writes one line per event: time, name, data', () => {
    const line = logLine(Date.UTC(2026, 10, 2, 9, 1, 2, 345), 'plan.done', { ms: 812 });
    expect(line).toBe('2026-11-02T09:01:02.345Z plan.done {"ms":812}\n');
    expect(logLine(0, 'app.hidden')).toBe('1970-01-01T00:00:00.000Z app.hidden\n');
  });

  it('keeps every line on one line and cuts a huge one', () => {
    expect(logLine(0, 'x', { m: 'a\nb' }).split('\n')).toHaveLength(2);
    const big = logLine(0, 'x', { list: Array.from({ length: 40 }, () => 'y'.repeat(299)) });
    expect(big.length).toBeLessThanOrEqual(LOG_LINE_CHARS + 2);
  });

  it('never writes a key or secret', () => {
    const out = JSON.stringify(
      scrub({ key: 'ABCD-EFGH', nested: [{ syncKey: 'K' }], token: 't', ok: 1 }),
    );
    expect(out).not.toMatch(/ABCD|"K"|"t"/);
    expect(out).toContain('"ok":1');
  });

  it('logs errors by name, message and stack, and survives cycles', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    expect(JSON.stringify(scrub(a))).toContain('"self":"…"');
    expect(scrub(new TypeError('Failed to fetch'))).toMatchObject({
      error: 'TypeError',
      message: 'Failed to fetch',
    });
  });

  it('rotates by size: a full part becomes the old one, the one before goes', () => {
    const line = (n: number) => `${String(n).padStart(9, '0')}\n`; // 10 chars
    let log = emptyLog();
    for (let n = 0; n < 35; n++) log = appendLog(log, [line(n)], 100);
    // Parts of 10 lines: 30–34 current, 20–29 old, 0–19 dropped.
    expect(log.cur).toBe([30, 31, 32, 33, 34].map(line).join(''));
    expect(log.old).toBe([20, 21, 22, 23, 24, 25, 26, 27, 28, 29].map(line).join(''));
    expect(logText(log).startsWith(line(20))).toBe(true);
    expect(logSize(log)).toBeLessThanOrEqual(200);
  });

  it('keeps a line longer than a part rather than looping', () => {
    const log = appendLog(emptyLog(), ['x'.repeat(150), 'y\n'], 100);
    expect(log.old).toBe('x'.repeat(150));
    expect(log.cur).toBe('y\n');
  });

  it('logs the screen, never a link’s data or a sync key', () => {
    expect(screenOf('#/')).toBe('/');
    expect(screenOf('#/trip/abc-1/map')).toBe('/trip/abc-1/map');
    expect(screenOf('#/sync/ABCD-EFGH-IJKL')).toBe('/sync/…');
    expect(screenOf('#/j/eyJ0cmlwIjp7fX0')).toBe('/j/…');
    expect(screenOf('#/r/8503000~8507000?d=2026-11-07')).toBe('/r/…');
    expect(screenOf('#/settings')).toBe('/settings');
  });
});
