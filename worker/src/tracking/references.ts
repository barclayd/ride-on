import {
  boundedJson,
  type Candidate,
  type Pick,
  type TrackingContext,
} from './model.ts';

export const pickKey = (routeId: string, candidate: Candidate) =>
  `${routeId}:${candidate.departureAt}`;
/** Persist before exposing references. Failure affects tracking availability, never ranking. */
export const issueReferences = async (
  db: D1Database,
  owner: string,
  context: TrackingContext,
  picks: readonly Pick[],
) => {
  const refs = new Map<string, string>();
  if (!picks.length) return refs;
  try {
    const now = context.generatedAt;
    const candidates = [
      ...new Map(
        picks
          .filter((p) => p.candidate.departureAt > now)
          .map((p) => [pickKey(p.routeId, p.candidate), p]),
      ).values(),
    ];
    if (!candidates.length) return refs;
    const id = crypto.randomUUID();
    // Bound abandoned snapshot storage. Never evict an unexpired reference to make room.
    // At most 500KB per context including its candidates, <=50MB per owner.
    if (candidates.length > 48) return refs;
    const contextJson = boundedJson(context, 200_000);
    const pickJson = candidates.map((pick) => boundedJson(pick, 80_000));
    const size = new TextEncoder().encode(
      contextJson + pickJson.join(''),
    ).byteLength;
    if (size > 500_000) return refs;
    const expiry = candidates.reduce(
      (v, p) => (p.candidate.departureAt > v ? p.candidate.departureAt : v),
      now,
    );
    const statements = [
      db
        .prepare(
          'DELETE FROM tracking_contexts WHERE (owner_id, id) IN (SELECT owner_id, id FROM tracking_contexts WHERE expires_at <= ? LIMIT 100)',
        )
        .bind(now),
      db
        .prepare(`INSERT INTO tracking_contexts SELECT ?, ?, ?, ?, ?, ?
        WHERE (SELECT count(*) FROM tracking_contexts WHERE owner_id = ?) < 1000
        AND (SELECT COALESCE(sum(size_bytes),0) FROM tracking_contexts WHERE owner_id = ?) + ? <= 50000000
        AND (SELECT count(*) FROM tracking_contexts WHERE owner_id = ? AND created_at > ?) < 400`)
        .bind(
          owner,
          id,
          now,
          expiry,
          contextJson,
          size,
          owner,
          owner,
          size,
          owner,
          new Date(Date.parse(now) - 3600_000).toISOString(),
        ),
    ];
    for (const [index, pick] of candidates.entries()) {
      const ref = crypto.randomUUID();
      refs.set(pickKey(pick.routeId, pick.candidate), ref);
      statements.push(
        db
          .prepare(`INSERT INTO tracking_recommendations
        SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tracking_contexts WHERE owner_id = ? AND id = ?)`)
          .bind(
            owner,
            ref,
            id,
            pick.candidate.departureAt,
            pickJson[index],
            owner,
            id,
          ),
      );
    }
    const results = await db.batch(statements);
    if (results[1]?.meta.changes !== 1) refs.clear();
  } catch {
    refs.clear();
  }
  return refs;
};
export const withReference = <T extends Candidate>(
  candidate: T,
  routeId: string,
  refs: ReadonlyMap<string, string>,
) => ({
  ...candidate,
  recommendationRef: refs.get(pickKey(routeId, candidate)) ?? null,
  trackingAvailability: refs.has(pickKey(routeId, candidate))
    ? ('available' as const)
    : ('unavailable' as const),
});
