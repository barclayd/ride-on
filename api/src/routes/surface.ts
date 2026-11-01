import { AppError } from '../errors.ts';

export {
  type SurfaceEvidence,
  type SurfaceInput,
  surfaceEvidenceSchema,
  surfaceInputSchema,
  surfaceKindSchema,
} from '../schemas/surface.ts';

import type { SurfaceEvidence, SurfaceInput } from '../schemas/surface.ts';
export const bindSurfaceEvidence = (
  input: SurfaceInput,
  route: { sourceHash: string; distanceM: number },
  providerId: string,
  capturedAt: string,
): SurfaceEvidence => {
  const invalid = () =>
    new AppError(
      422,
      'INVALID_SURFACE_EVIDENCE',
      'Surface evidence must match the source and GPX distance, with ordered, non-overlapping sections.',
    );
  // Allow rounding only, not a different route or instruction-distance scale.
  if (
    input.source.providerId !== providerId ||
    Math.abs(input.geometryDistanceM - route.distanceM) > 1
  )
    throw invalid();
  let end = 0;
  for (const section of input.sections) {
    if (
      section.fromM < end ||
      section.toM <= section.fromM ||
      section.toM > input.geometryDistanceM
    )
      throw invalid();
    end = section.toM;
  }
  const scale = route.distanceM / input.geometryDistanceM;
  return {
    ...input,
    geometryDistanceM: route.distanceM,
    sections: input.sections.map((s) => ({
      ...s,
      fromM: s.fromM * scale,
      toM: s.toM * scale,
    })),
    sourceHash: route.sourceHash,
    capturedAt,
  };
};

/** Retrieval time isn't a change in evidence; an identical retry stays idempotent. */
export const sameSurfaceEvidence = (
  a: SurfaceEvidence | null | undefined,
  b: SurfaceEvidence | null | undefined,
): boolean => {
  const stable = (s: SurfaceEvidence | null | undefined) =>
    s
      ? {
          schemaVersion: s.schemaVersion,
          source: s.source,
          geometryDistanceM: s.geometryDistanceM,
          sections: s.sections,
          sourceHash: s.sourceHash,
        }
      : null;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
};

export const surfaceSummary = (route: {
  distanceM: number;
  sourceHash: string;
  surface?: SurfaceEvidence | null;
}) => {
  const evidence =
    route.surface?.sourceHash === route.sourceHash ? route.surface : null;
  let pavedM = 0;
  let unpavedM = 0;
  let nonCyclingM = 0;
  for (const section of evidence?.sections ?? []) {
    const length = section.toM - section.fromM;
    if (section.surface === 'paved') pavedM += length;
    else if (section.surface === 'non-cycling') nonCyclingM += length;
    else if (section.surface !== 'unknown') unpavedM += length;
  }
  const classifiedM = pavedM + unpavedM + nonCyclingM;
  const unknownM = Math.max(0, route.distanceM - classifiedM);
  // Arithmetic roundoff is not a missing section.
  const complete = unknownM < 0.000001;
  return {
    status:
      classifiedM === 0
        ? ('unavailable' as const)
        : complete
          ? ('complete' as const)
          : ('partial' as const),
    pavedM,
    unpavedM,
    nonCyclingM,
    unknownM: complete ? 0 : unknownM,
    classifiedFraction: Math.min(1, classifiedM / route.distanceM),
    // Don't imply an exact total unpaved share when some of the route is unknown.
    unpavedFraction: complete ? unpavedM / route.distanceM : null,
    source: evidence?.source ?? null,
    capturedAt: evidence?.capturedAt ?? null,
  };
};
