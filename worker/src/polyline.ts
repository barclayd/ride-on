import type { Point } from './types.ts';

// Google polyline algorithm format, precision 5 (1e5). ~40 lines, not worth a dependency.
// https://developers.google.com/maps/documentation/utilities/polylinealgorithm
const PRECISION = 1e5;

export const decodePolyline = (encoded: string): Point[] => {
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  const decodeValue = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) {
        throw new Error('Malformed polyline: unexpected end of string');
      }
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    lat += decodeValue();
    lon += decodeValue();
    points.push([lat / PRECISION, lon / PRECISION]);
  }

  return points;
};

export const encodePolyline = (points: readonly Point[]): string => {
  let output = '';
  let prevLat = 0;
  let prevLon = 0;

  for (const [lat, lon] of points) {
    const latE5 = Math.round(lat * PRECISION);
    const lonE5 = Math.round(lon * PRECISION);
    output += encodeValue(latE5 - prevLat);
    output += encodeValue(lonE5 - prevLon);
    prevLat = latE5;
    prevLon = lonE5;
  }

  return output;
};

const encodeValue = (value: number): string => {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let result = '';
  while (v >= 0x20) {
    result += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return result + String.fromCharCode(v + 63);
};
