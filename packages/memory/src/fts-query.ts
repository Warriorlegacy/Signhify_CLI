/**
 * Sanitize a free-form query string into a safe SQLite FTS5 MATCH expression.
 *
 * FTS5's MATCH grammar treats `"`, `(`, `)`, `*`, `:`, `^`, `-`, `{`, `}`
 * and boolean operators (AND, OR, NOT, NEAR) as query syntax. Passing raw
 * user input containing these characters directly can cause syntax errors or
 * unexpected query behaviour.
 *
 * This function extracts unicode word/number tokens (supporting letters,
 * numbers, and underscores across all scripts including CJK), quotes each
 * token safely as a literal phrase, and joins them with `OR`.
 *
 * OR-join ensures high recall so that a single missing descriptive word
 * does not zero out search results.
 *
 * Returns `null` if the query is empty or contains no usable tokens,
 * allowing callers to avoid executing a pointless or invalid FTS query.
 */
export function sanitizeFts5Query(query: string): string | null {
  if (!query || typeof query !== 'string') {
    return null;
  }

  const tokens =
    query
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.trim())
      .filter((t) => Boolean(t) && /[\p{L}\p{N}]/u.test(t)) ?? [];

  if (tokens.length === 0) {
    return null;
  }

  // Inner `"` must be doubled, not stripped (MATCH syntax injection).
  const quoted = tokens.map((t) => `"${t.replaceAll('"', '""')}"`);
  return quoted.join(' OR ');
}

/**
 * Backwards compatibility alias for `sanitizeFts5Query`.
 */
export const buildFtsQuery = sanitizeFts5Query;
