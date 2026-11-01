import type { Route } from '../routes/model.ts';
import type { Cell, Coordinate } from './contracts.ts';

// A shared request lattice, not a claim about the upstream model's native grid.
export const cellFor = (point: Coordinate): Cell => {
  const y = Math.min(3599, Math.floor((point.latitude + 90) * 20));
  const x = Math.min(7199, Math.floor((point.longitude + 180) * 20));
  return {
    id: `lattice-v1:${y}:${x}`,
    latitude: (y + 0.5) / 20 - 90,
    longitude: (x + 0.5) / 20 - 180,
  };
};
export const routeExposure = (route: Route, mergeAdjacent = true) => {
  const evidence =
    route.surface?.sourceHash === route.sourceHash ? route.surface : null;
  const intervals: { fromM: number; toM: number; surface: string }[] = [];
  let end = 0;
  for (const section of evidence?.sections ?? []) {
    if (section.fromM > end)
      intervals.push({ fromM: end, toM: section.fromM, surface: 'unknown' });
    if (!['paved', 'non-cycling'].includes(section.surface))
      intervals.push(section);
    end = section.toM;
  }
  if (end < route.distanceM)
    intervals.push({ fromM: end, toM: route.distanceM, surface: 'unknown' });
  const cells = new Map<string, Cell>();
  const sections: {
    fromM: number;
    toM: number;
    surface: string;
    cellId: string;
  }[] = [];
  let index = 0;
  for (const leg of route.legs) {
    while (
      index < intervals.length &&
      (intervals[index]?.toM ?? 0) <= leg.fromM
    )
      index++;
    for (let i = index; i < intervals.length; i++) {
      const part = intervals[i];
      if (!part || part.fromM >= leg.toM) break;
      const fromM = Math.max(part.fromM, leg.fromM);
      const toM = Math.min(part.toM, leg.toM);
      if (toM <= fromM) continue;
      const cell = cellFor(leg.coordinate);
      cells.set(cell.id, cell);
      const previous = sections.at(-1);
      if (
        mergeAdjacent &&
        previous?.cellId === cell.id &&
        previous.surface === part.surface &&
        previous.toM === fromM
      )
        previous.toM = toM;
      else
        sections.push({ fromM, toM, surface: part.surface, cellId: cell.id });
    }
  }
  return {
    routeId: route.id,
    sourceHash: route.sourceHash,
    sections,
    cells: [...cells.values()],
  };
};
