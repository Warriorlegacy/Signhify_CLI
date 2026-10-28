// Build an FTS5 MATCH expression from a free-form user query.
//
// FTS5's MATCH grammar treats `"`, `(`, `)`, `*`, `:`, `^`, `-`, `{`, `}` as
// operators; a raw user string with any of them throws. Each token is wrapped
// as a phrase and OR-joined so recall stays high: AND-join requires EVERY word
// to appear, which zeroes the query when one descriptive word is absent.
//
// Pattern taken from MiMo-Code packages/cli/src/memory/fts-query.ts, which
// ported it from openclaw. \p{L} keeps CJK recall.
//
// Returns null when no usable tokens remain; callers treat that as "no results"
// instead of sending an empty query to SQL.
export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  // Inner `"` must be doubled, not stripped (MATCH syntax injection).
  const quoted = tokens.map((t) => `"${t.replaceAll('"', '""')}"`);
  return quoted.join(' OR ');
}
