// Counts the SQL the app actually sends, for finding N+1s and duplicate reads. Off unless
// TAGMEX_QUERY_LOG is set, and the hook is never installed in production builds, so the normal
// path pays nothing. See the `ops` skill for how to read a run.
export interface LoggedQuery {
  sql: string;
  at: number;
}

const log: LoggedQuery[] = [];
let on = false;

export const queryLogEnabled = () => process.env.TAGMEX_QUERY_LOG === '1' && process.env.NODE_ENV !== 'production';

export function record(sql: string) {
  if (on) log.push({ sql, at: Date.now() });
}

// Collects every query one block of work sends. Not safe across concurrent requests: this is a
// measuring tool for a single run, not per-request telemetry.
export async function measureQueries<T>(fn: () => Promise<T>): Promise<{ result: T; queries: LoggedQuery[]; ms: number }> {
  log.length = 0;
  on = true;
  const started = performance.now();
  try {
    const result = await fn();
    return { result, queries: [...log], ms: performance.now() - started };
  } finally {
    on = false;
    log.length = 0;
  }
}

// Collapses a statement to the shape that matters: whitespace flattened, long literal lists cut.
export function shape(sql: string) {
  return sql.replace(/\s+/g, ' ').replace(/\$\d+/g, '?').trim();
}

// Round trips on the critical path: queries issued together (within `gapMs` of each other) went out
// as one wave and cost one round trip between them, so the wave count, not the query count, is what
// a page's latency scales with.
export function waves(queries: readonly LoggedQuery[], gapMs = 2) {
  let n = 0;
  let last = -Infinity;
  for (const q of queries) {
    if (q.at - last > gapMs) n++;
    last = q.at;
  }
  return n;
}

// Counts identical statement shapes: anything above 1 ran more than once in the same block.
export function byShape(queries: readonly LoggedQuery[]) {
  const counts = new Map<string, number>();
  for (const q of queries) {
    const key = shape(q.sql);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
