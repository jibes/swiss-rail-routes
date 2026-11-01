import { describe, expect, it } from 'vitest';
import {
  cacheKeyOf,
  parseStopQuery,
  parseTripQuery,
  stopRequestXml,
  tripRequestXml,
  zurichDateTime,
} from '../src/core/ojp/request';

const zh = { ref: 'ch:1:sloid:3000', name: 'Zürich HB' };
const chur = { ref: '8509000', name: 'Chur' };
const valid = { origin: zh, destination: chur, time: '2026-11-07T08:00' };

describe('parseTripQuery', () => {
  it('fills defaults and drops unknown fields', () => {
    expect(parseTripQuery({ ...valid, evil: '<x/>' })).toEqual({
      origin: zh,
      destination: chur,
      vias: [],
      notVias: [],
      time: '2026-11-07T08:00',
      arriveBy: false,
      results: 6,
    });
  });

  it.each([
    ['origin', { ...valid, origin: { ref: 'x', name: 'A' } }],
    ['destination', { ...valid, destination: null }],
    ['vias', { ...valid, vias: Array(21).fill(zh) }],
    ['vias', { ...valid, vias: [{ ref: '8509000', name: '' }] }],
    ['notVias', { ...valid, notVias: ['<NotVia/>'] }],
    ['time', { ...valid, time: '2026-11-07 08:00' }],
    ['time', { ...valid, time: '2026-13-40T08:00' }],
    ['results', { ...valid, results: 50 }],
    ['body', 'text'],
  ])('rejects bad %s', (field, body) => {
    expect(parseTripQuery(body)).toBe(field);
  });
});

describe('parseStopQuery', () => {
  it('trims and limits', () => {
    expect(parseStopQuery({ text: '  Mür ' })).toEqual({ text: 'Mür', results: 10 });
    expect(parseStopQuery({ text: 'M' })).toBe('text');
    expect(parseStopQuery({ text: 'x'.repeat(81) })).toBe('text');
  });
});

describe('zurichDateTime', () => {
  it('uses CET in winter and CEST in summer', () => {
    expect(zurichDateTime('2026-11-07T08:00')).toBe('2026-11-07T08:00:00+01:00');
    expect(zurichDateTime('2026-07-01T08:00')).toBe('2026-07-01T08:00:00+02:00');
  });
  it('handles the switch nights', () => {
    expect(zurichDateTime('2026-03-29T03:30')).toBe('2026-03-29T03:30:00+02:00');
    expect(zurichDateTime('2026-10-25T01:30')).toBe('2026-10-25T01:30:00+02:00');
    expect(zurichDateTime('2026-10-25T04:00')).toBe('2026-10-25T04:00:00+01:00');
  });
});

describe('request XML', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const q = parseTripQuery({
    ...valid,
    vias: [{ ref: '8509253', name: 'Filisur' }],
    notVias: ['8505300'],
  });
  if (typeof q === 'string') throw new Error(q);

  it('builds a trip request with vias, not-vias and params', () => {
    const xml = tripRequestXml(q, now, 'srr');
    expect(xml).toContain('<OJP xmlns="http://www.vdv.de/ojp"');
    expect(xml).toContain('version="2.0"');
    expect(xml).toContain(
      '<siri:RequestTimestamp>2026-11-01T12:00:00.000Z</siri:RequestTimestamp>',
    );
    expect(xml).toMatch(
      /<Origin><PlaceRef><StopPlaceRef>ch:1:sloid:3000<\/StopPlaceRef><Name><Text>Zürich HB<\/Text><\/Name><\/PlaceRef><DepArrTime>2026-11-07T08:00:00\+01:00<\/DepArrTime><\/Origin>/,
    );
    expect(xml).toContain('<Via><ViaPoint><StopPlaceRef>8509253</StopPlaceRef></ViaPoint></Via>');
    expect(xml).toContain('<NotVia><StopPlaceRef>8505300</StopPlaceRef></NotVia>');
    expect(xml).toContain('<NumberOfResults>6</NumberOfResults>');
    expect(xml).toContain('<IncludeLegProjection>true</IncludeLegProjection>');
  });

  it('puts the time on the destination for arrive-by', () => {
    const xml = tripRequestXml({ ...q, arriveBy: true }, now, 'srr');
    expect(xml).toMatch(/<Destination>.*<DepArrTime>/);
    expect(xml).not.toMatch(/<Origin>.*<DepArrTime>.*<\/Origin>/);
  });

  it('escapes names', () => {
    const s = parseStopQuery({ text: 'A&B <c>' });
    if (typeof s === 'string') throw new Error(s);
    expect(stopRequestXml(s, now, 'srr')).toContain('<Name>A&amp;B &lt;c&gt;</Name>');
  });

  it('cache key ignores field order of the input', () => {
    const a = parseTripQuery({ time: valid.time, destination: chur, origin: zh });
    const b = parseTripQuery(valid);
    expect(cacheKeyOf('trip', a as never)).toBe(cacheKeyOf('trip', b as never));
  });
});
