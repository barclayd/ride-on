export const recordRecommendation = async (
  db: D1Database,
  owner: string,
  createdAt: string,
  snapshot: unknown,
) => {
  // Diagnostic evidence must never make an otherwise usable ranking fail.
  try {
    const id = crypto.randomUUID();
    const json = JSON.stringify(snapshot);
    const size = new TextEncoder().encode(json).length;
    if (size > 500_000) return null;
    const result = await db
      .prepare(`INSERT INTO recommendation_snapshots (owner_id, id, created_at, snapshot_json, size_bytes)
        SELECT ?, ?, ?, ?, ?
        WHERE (SELECT count(*) FROM recommendation_snapshots WHERE owner_id = ?) < 1000
        AND (SELECT COALESCE(sum(size_bytes), 0) FROM recommendation_snapshots WHERE owner_id = ?) + ? <= 50000000`)
      .bind(owner, id, createdAt, json, size, owner, owner, size)
      .run();
    return result.meta.changes === 1 ? id : null;
  } catch {
    return null;
  }
};
