import { describe, expect, it } from 'vitest';
import { acceptDate, acceptTime, earliestDay, PAST_DAYS, timeOnDate } from '../src/core/when';

const today = '2026-11-02';

describe('acceptTime', () => {
  it('any time, also one gone today (a trip already under way, 0.49.0)', () => {
    expect(acceptTime('07:00')).toBe('07:00');
    expect(acceptTime('14:30')).toBe('14:30');
  });
  it('a field being typed is no time', () => {
    expect(acceptTime('')).toBeNull();
  });
});

describe('acceptDate', () => {
  it('today, later, and back as far as the timetable answers', () => {
    expect(acceptDate(today, today)).toBe(today);
    expect(acceptDate('2027-01-01', today)).toBe('2027-01-01');
    expect(earliestDay(today)).toBe('2026-10-19');
    expect(PAST_DAYS).toBe(14);
    expect(acceptDate('2026-10-19', today)).toBe('2026-10-19');
  });
  it('refuses a day further back, however it was entered', () => {
    expect(acceptDate('2026-10-18', today)).toBeNull();
    expect(acceptDate('0002-11-12', today)).toBeNull();
  });
  it('a field being typed is no day', () => {
    expect(acceptDate('', today)).toBeNull();
  });
});

describe('timeOnDate', () => {
  it('moved to today, a time gone becomes the next few minutes', () => {
    expect(timeOnDate(today, today, '09:05', '07:00')).toBe('09:05');
  });
  it('a time still to come stays, and another day keeps its time', () => {
    expect(timeOnDate(today, today, '09:05', '14:30')).toBe('14:30');
    expect(timeOnDate('2026-11-07', today, '09:05', '07:00')).toBe('07:00');
    expect(timeOnDate('2026-10-30', today, '09:05', '07:00')).toBe('07:00');
  });
});
