/** Distance-weighted circular mean of meaningful wind directions, in degrees
 * from true north. Calm samples carry no directional evidence. */
export const meanWindFrom = (
  rows: readonly {
    distanceM: number;
    windSpeedKph: number;
    windFromDegrees: number;
  }[],
): number | null => {
  const distance = rows.reduce((sum, r) => sum + r.distanceM, 0);
  if (
    !distance ||
    rows.reduce((sum, r) => sum + r.windSpeedKph * r.distanceM, 0) / distance <
      3
  )
    return null;
  let north = 0;
  let east = 0;
  let directedDistance = 0;
  for (const row of rows) {
    if (row.windSpeedKph < 3) continue;
    const radians = (row.windFromDegrees * Math.PI) / 180;
    north += Math.cos(radians) * row.distanceM;
    east += Math.sin(radians) * row.distanceM;
    directedDistance += row.distanceM;
  }
  if (!directedDistance || Math.hypot(north, east) / directedDistance < 0.3)
    return null;
  return (
    Math.round(((Math.atan2(east, north) * 180) / Math.PI + 360) % 360) % 360
  );
};
