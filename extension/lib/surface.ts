// Isolated adapter for cycle.travel's saved-journey directions, inspected 2026-10-12.
// These are website formats, not a stable public API. Unknown stays unknown.
import type { components } from '../../api/contracts/client';

export type SurfaceInput = components['schemas']['SurfaceInput'];
export type SurfaceKind = SurfaceInput['sections'][number]['surface'];

// Upgrade old timestamp-only markers once, including journeys with no surface data.
export const surfaceSeenKey = (externalId: string) =>
  `surface-v1:${externalId}`;

const legacyKinds: Record<string, SurfaceKind> = {
  p: 'paved',
  s: 'paved',
  o: 'paved',
  c: 'compacted',
  g: 'gravel',
  e: 'earth',
  d: 'dirt',
  r: 'grass',
  x: 'sand',
  u: 'unpaved',
};
const modeKinds: Record<number, SurfaceKind> = {
  1: 'paved',
  2: 'paved',
  3: 'paved',
  4: 'paved',
  5: 'paved',
  6: 'paved',
  7: 'unpaved',
  8: 'rough-unpaved',
  9: 'unknown',
  10: 'paved',
  11: 'paved',
  12: 'paved',
  13: 'paved',
  14: 'paved',
  15: 'unpaved',
  16: 'rough-unpaved',
  17: 'paved',
  18: 'unpaved',
  19: 'paved',
  20: 'paved',
  21: 'non-cycling',
  22: 'paved',
};

const distanceM = (a: [number, number], b: [number, number]) => {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * rad) / 2) ** 2 +
    Math.cos(a[0] * rad) *
      Math.cos(b[0] * rad) *
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export const journeySurface = (
  points: [number, number][],
  directions: unknown,
  version: unknown,
): SurfaceInput | undefined => {
  const formatVersion = version ?? 1;
  if (
    (formatVersion !== 1 && formatVersion !== 2) ||
    points.length < 2 ||
    points.length > 50_000 ||
    !Array.isArray(directions) ||
    !directions.length ||
    directions.length > 10_000
  )
    return;
  if (
    points.some(
      ([lat, lon]) =>
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180,
    )
  )
    return;
  // Match GPX normalization while retaining each original instruction index.
  const positions = [0];
  let last = points[0];
  for (const point of points.slice(1)) {
    const delta = distanceM(last, point);
    positions.push(
      positions[positions.length - 1] + (delta < 0.01 ? 0 : delta),
    );
    if (delta >= 0.01) last = point;
  }
  const total = positions[positions.length - 1];
  if (!Number.isFinite(total) || total <= 0 || total > 400_000) return;
  const first = directions[0];
  if (!Array.isArray(first)) return;
  const full = first.length > 4;
  if (!full && formatVersion === 1) return;
  const rows: { index: number; surface: SurfaceKind; sourceCode: string }[] =
    [];
  for (const row of directions) {
    if (
      !Array.isArray(row) ||
      (full ? row.length < 4 : row.length < 3 || row.length > 4)
    )
      return;
    const index = row[full ? 3 : 1];
    const length = row[full ? 2 : 0];
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= points.length ||
      (rows.length && index < rows[rows.length - 1].index) ||
      typeof length !== 'number' ||
      !Number.isFinite(length) ||
      length < 0
    )
      return;
    let surface: SurfaceKind = 'unknown';
    let sourceCode = 'missing';
    if (full && (row[0] === 126 || row[0] === 15)) {
      sourceCode = `instruction:${row[0]}`;
    } else if (formatVersion === 1) {
      if (typeof row[1] !== 'string') return;
      const fields = row[1].split('|');
      const code = fields[2] ?? '';
      if (['y', 'Y', '¥'].includes(fields[3])) {
        surface = 'non-cycling';
        sourceCode = 'legacy:transport';
      } else {
        surface = Object.hasOwn(legacyKinds, code)
          ? legacyKinds[code]
          : 'unknown';
        sourceCode = /^[a-zA-Z0-9_-]{1,16}$/.test(code)
          ? `surface:${code}`
          : 'surface:missing';
      }
    } else {
      const mode = row[full ? 8 : 2];
      if (Number.isSafeInteger(mode) && mode >= 0 && mode <= 65_535) {
        surface = modeKinds[mode & 31] ?? 'unknown';
        sourceCode = `mode:${mode}`;
      }
      if (full && typeof row[1] === 'string' && /\{[rb]\}/.test(row[1])) {
        surface = 'non-cycling';
        sourceCode = 'mode:transport';
      }
    }
    // A zero-distance/end marker cannot supply a material for a nonzero tail.
    if (length === 0) surface = 'unknown';
    rows.push({ index, surface, sourceCode });
  }
  const sections: SurfaceInput['sections'] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fromM = positions[row.index];
    const toM = positions[rows[i + 1]?.index ?? points.length - 1];
    if (toM <= fromM) continue;
    const previous = sections[sections.length - 1];
    if (
      previous?.toM === fromM &&
      previous.surface === row.surface &&
      previous.sourceCode === row.sourceCode
    )
      previous.toM = toM;
    else
      sections.push({
        fromM,
        toM,
        surface: row.surface,
        sourceCode: row.sourceCode,
      });
  }
  if (!sections.length || sections.length > 5_000) return;
  return {
    schemaVersion: 1,
    source: {
      providerId: 'cycle-travel',
      method: 'route-instructions',
      formatVersion,
      mappingVersion: 1,
    },
    geometryDistanceM: total,
    sections,
  };
};
