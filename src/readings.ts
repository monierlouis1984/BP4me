// Readings API backed by D1. The browser keeps a localStorage copy and
// syncs through two calls:
//
//   POST /api/readings/sync  { upserts: Reading[], deletes: {id, updatedAt}[] }
//        Applies the client's queued changes. Last-writer-wins per reading on
//        the client-side `updatedAt`; deletions are kept as tombstones.
//   GET  /api/readings?since=<ms>
//        Everything (live rows and tombstones) written to D1 after `since`,
//        by the D1 clock, plus the cursor to use next time.
//
// Rows are scoped by user_id; a client can never see or touch another user's rows.

export interface Reading {
  id: string;
  ts: string; // ISO 8601
  sys: number;
  dia: number;
  pul: number | null;
  arm: "left" | "right" | null;
  note: string | null;
  source: string | null;
  irregular: boolean;
  updatedAt: number; // ms, client clock
}

export interface Deletion {
  id: string;
  updatedAt: number;
}

interface Row {
  id: string;
  ts: string;
  sys: number | null;
  dia: number | null;
  pul: number | null;
  arm: string | null;
  note: string | null;
  source: string | null;
  irregular: number;
  updated_at: number;
  synced_at: number;
  deleted_at: number | null;
}

export const MAX_BATCH = 500; // per sync call, each direction
const PAGE = 2000; // rows per pull
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NOW_MS = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

export class BadRequest extends Error {}

const clampTime = (t: unknown): number | null => {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  // A client clock far in the future would win every merge forever; cap it.
  return Math.min(Math.floor(n), Date.now() + 60_000);
};
const intOrNull = (v: unknown, lo: number, hi: number): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
const textOrNull = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

export function parseReading(input: unknown): Reading {
  const r = (input ?? {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) throw new BadRequest("Reading id is invalid.");
  const t = Date.parse(String(r.ts));
  if (Number.isNaN(t)) throw new BadRequest(`Reading ${r.id} has an invalid timestamp.`);
  const sys = intOrNull(r.sys, 1, 400), dia = intOrNull(r.dia, 1, 400);
  if (sys === null || dia === null) throw new BadRequest(`Reading ${r.id} has invalid SYS/DIA values.`);
  const updatedAt = clampTime(r.updatedAt);
  if (updatedAt === null) throw new BadRequest(`Reading ${r.id} has no updatedAt.`);
  const arm = r.arm === "left" || r.arm === "right" ? r.arm : null;
  return {
    id: r.id,
    ts: new Date(t).toISOString(),
    sys, dia,
    pul: intOrNull(r.pul, 1, 400),
    arm,
    note: textOrNull(r.note, 300),
    source: textOrNull(r.source, 32),
    irregular: Boolean(r.irregular),
    updatedAt,
  };
}

export function parseDeletion(input: unknown): Deletion {
  const d = (input ?? {}) as Record<string, unknown>;
  if (typeof d.id !== "string" || !ID_RE.test(d.id)) throw new BadRequest("Deletion id is invalid.");
  const updatedAt = clampTime(d.updatedAt);
  if (updatedAt === null) throw new BadRequest(`Deletion ${d.id} has no updatedAt.`);
  return { id: d.id, updatedAt };
}

function rowToReading(row: Row): Reading {
  return {
    id: row.id,
    ts: row.ts,
    sys: row.sys ?? 0,
    dia: row.dia ?? 0,
    pul: row.pul,
    arm: row.arm === "left" || row.arm === "right" ? row.arm : null,
    note: row.note,
    source: row.source,
    irregular: Boolean(row.irregular),
    updatedAt: row.updated_at,
  };
}

/** Apply a batch of client changes atomically. Older writes lose; ties go to the deletion. */
export async function applyChanges(db: D1Database, userId: string, upserts: Reading[], deletes: Deletion[]): Promise<void> {
  const upsertStmt = db.prepare(
    `INSERT INTO readings (user_id, id, ts, sys, dia, pul, arm, note, source, irregular, updated_at, synced_at, deleted_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ${NOW_MS}, NULL)
     ON CONFLICT (user_id, id) DO UPDATE SET
       ts = excluded.ts, sys = excluded.sys, dia = excluded.dia, pul = excluded.pul, arm = excluded.arm,
       note = excluded.note, source = excluded.source, irregular = excluded.irregular,
       updated_at = excluded.updated_at, synced_at = excluded.synced_at, deleted_at = NULL
     WHERE excluded.updated_at > readings.updated_at`,
  );
  const deleteStmt = db.prepare(
    `INSERT INTO readings (user_id, id, ts, updated_at, synced_at, deleted_at)
     VALUES (?1, ?2, '', ?3, ${NOW_MS}, ?3)
     ON CONFLICT (user_id, id) DO UPDATE SET
       ts = '', sys = NULL, dia = NULL, pul = NULL, arm = NULL, note = NULL, source = NULL, irregular = 0,
       updated_at = excluded.updated_at, synced_at = excluded.synced_at, deleted_at = excluded.updated_at
     WHERE excluded.updated_at >= readings.updated_at`,
  );
  const statements = [
    ...upserts.map((r) =>
      upsertStmt.bind(userId, r.id, r.ts, r.sys, r.dia, r.pul, r.arm, r.note, r.source, r.irregular ? 1 : 0, r.updatedAt),
    ),
    ...deletes.map((d) => deleteStmt.bind(userId, d.id, d.updatedAt)),
  ];
  if (statements.length) await db.batch(statements);
}

export interface PullResult {
  readings: Reading[];
  deleted: Deletion[];
  cursor: number;
  more: boolean;
}

/** Everything written after `since` (D1 clock, ms), oldest first. */
export async function pullChanges(db: D1Database, userId: string, since: number): Promise<PullResult> {
  const { results } = await db
    .prepare(
      `SELECT id, ts, sys, dia, pul, arm, note, source, irregular, updated_at, synced_at, deleted_at
       FROM readings WHERE user_id = ?1 AND synced_at > ?2 ORDER BY synced_at ASC LIMIT ?3`,
    )
    .bind(userId, since, PAGE + 1)
    .all<Row>();
  const more = results.length > PAGE;
  const rows = more ? results.slice(0, PAGE) : results;
  const readings: Reading[] = [];
  const deleted: Deletion[] = [];
  for (const row of rows) {
    if (row.deleted_at !== null) deleted.push({ id: row.id, updatedAt: row.updated_at });
    else readings.push(rowToReading(row));
  }
  const cursor = rows.length ? rows[rows.length - 1].synced_at : since;
  return { readings, deleted, cursor, more };
}
