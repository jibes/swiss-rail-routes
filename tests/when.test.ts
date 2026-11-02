import { describe, expect, it } from 'vitest';
import { acceptDate, acceptTime, timeOnDate } from '../src/core/when';

const today = '2026-11-02';

describe('acceptTime', () => {
  it('today, a time gone becomes now', () => {
    expect(acceptTime('07:00', today, today, '09:00')).toBe('09:00');
    expect(acceptTime('14:30', today, today, '09:00')).toBe('14:30');
  });
  it('another day, any time', () => {
    expect(acceptTime('07:00', '2026-11-07', today, '09:00')).toBe('07:00');
  });
  it('a field being typed is no time', () => {
    expect(acceptTime('', today, today, '09:00')).toBeNull();
  });
});

describe('acceptDate', () => {
  it('today and later', () => {
    expect(acceptDate(today, today)).toBe(today);
    expect(acceptDate('2027-01-01', today)).toBe('2027-01-01');
  });
  it('refuses a day gone, however it was entered', () => {
    expect(acceptDate('2026-10-01', today)).toBeNull();
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
  });
});
