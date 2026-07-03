import type { Point } from './types.ts';

export const CACHE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

// ponytail: route-level cache keyed by a hash of the whole simplified
// coordinate sequence. Two routes that share 90% of their path but diverge
// at the ends are cache misses for each other. Tile-keyed caching (hash
// individual snapped edges/tiles, union results across routes) is the
// scalable design called out in PLAN.md — upgrade to it if/when duplicate
// nearby-route traffic makes the miss rate matter.
export const hashCoordinates = async (
  points: readonly Point[],
): Promise<string> => {
  const quantized = points
    .map(([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`)
    .join(';');
  const data = new TextEncoder().encode(quantized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
