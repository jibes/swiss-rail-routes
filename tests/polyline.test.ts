import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline, simplify } from '../src/core/polyline';

describe('polyline', () => {
  it("encodes as Google's reference example and decodes back", () => {
    const pts: [number, number][] = [
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ];
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(pts);
  });

  it('simplifies a straight run to its ends and keeps a real bend', () => {
    const line: [number, number][] = [
      [8, 46],
      [8.001, 46.00001],
      [8.002, 46],
      [8.002, 46.01],
    ];
    expect(simplify(line, 0.0005)).toEqual([
      [8, 46],
      [8.002, 46],
      [8.002, 46.01],
    ]);
  });
});
