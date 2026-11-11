/** Terrain heights contain short vertical oscillations even in planner exports.
 * Keep a 10 m descent buffer before counting another rise, following BRouter's
 * filtered-ascent approach. Small upward steps still accumulate on a real climb;
 * inserting interpolated points does not change the result.
 * https://brouter.de/brouter/elevation.html
 */
export const filteredAscent = (elevations: readonly number[]): number => {
  let ascent = 0;
  let buffer = 0;
  for (let i = 1; i < elevations.length; i++) {
    buffer += (elevations[i] ?? 0) - (elevations[i - 1] ?? 0);
    if (buffer > 0) {
      ascent += buffer;
      buffer = 0;
    } else {
      buffer = Math.max(buffer, -10);
    }
  }
  return ascent;
};
