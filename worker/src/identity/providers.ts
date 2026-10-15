/** Linked sign-in methods, not the provider used to create the current session.
 * Passkeys live in their own table. Only public method names leave this query. */
export const linkedProviders = async (db: D1Database, userId: string) => {
  const rows = await db
    .prepare(`
    SELECT provider FROM (
      SELECT providerId AS provider,
        MIN(CASE WHEN typeof(createdAt) IN ('integer', 'real') THEN createdAt / 1000.0
          ELSE unixepoch(createdAt) END) AS linked_at
      FROM auth_account WHERE userId = ? AND providerId IN ('apple', 'google') GROUP BY providerId
      UNION ALL
      SELECT 'passkey', MIN(CASE WHEN typeof(createdAt) IN ('integer', 'real') THEN createdAt / 1000.0
          ELSE unixepoch(createdAt) END)
      FROM auth_passkey WHERE userId = ? HAVING COUNT(*) > 0
    ) ORDER BY COALESCE(linked_at, 9000000000000000), provider
  `)
    .bind(userId, userId)
    .all<{ provider: 'apple' | 'google' | 'passkey' }>();
  return rows.results.map((row) => row.provider);
};
