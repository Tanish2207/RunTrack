/** Local-first SQLite queue (#016). Firestore push happened in #013; the retry worker is #017. */
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { ActivityType, RoutePoint } from '../api/types';

const DATABASE_NAME = 'runtrack.db';
const DAY_MS = 86_400_000;

/** What a caller supplies; `route` is stored as a JSON string, `synced` starts at 0. */
export interface PendingActivityInsert {
  localId: string;
  userId: string;
  type: ActivityType;
  startTime: number;
  endTime: number;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  caloriesEstimate: number;
  route: RoutePoint[];
  aiSummary?: string | null;
  createdAt: number;
}

/** A stored row with `route` parsed back to points; only validated rows survive. */
export interface PendingActivityRow extends PendingActivityInsert {
  firestoreId: string | null;
  aiSummary: string | null;
  synced: boolean;
  retryCount: number;
  lastAttempt: number;
}

/**
 * Versioned with `PRAGMA user_version`; v1 is #016's initial schema. `firestoreId`
 * is our one spec deviation (additive): activities are create-only with no server
 * dedup, so idempotent retries in #017 must know a push already landed.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE IF NOT EXISTS pending_activities (
    localId TEXT PRIMARY KEY NOT NULL,
    firestoreId TEXT,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    startTime INTEGER NOT NULL,
    endTime INTEGER NOT NULL,
    distanceKm REAL NOT NULL,
    durationSec INTEGER NOT NULL,
    avgPaceSecPerKm REAL NOT NULL,
    caloriesEstimate REAL NOT NULL,
    route TEXT NOT NULL,
    aiSummary TEXT,
    synced INTEGER NOT NULL DEFAULT 0,
    retryCount INTEGER NOT NULL DEFAULT 0,
    lastAttempt INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS pending_activities_unsynced_idx
    ON pending_activities (createdAt) WHERE synced = 0;
  CREATE INDEX IF NOT EXISTS pending_activities_created_idx
    ON pending_activities (createdAt);
  `,
];

let databasePromise: Promise<SQLiteDatabase> | null = null;

async function migrate(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const migration = MIGRATIONS[version];
    if (!migration) break;
    await db.execAsync(migration);
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

async function openDatabase(): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(DATABASE_NAME);
  // WAL keeps the Save-time insert fast even while a History read is open.
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await migrate(db);
  return db;
}

export function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    // A failed open must not poison every later call; the next caller retries.
    databasePromise = openDatabase().catch((error: unknown) => {
      databasePromise = null;
      throw error;
    });
  }
  return databasePromise;
}

/** Test seam; a later `getDatabase` reopens (and re-migrates) from scratch. */
export async function closeDatabase(): Promise<void> {
  const promise = databasePromise;
  databasePromise = null;
  if (!promise) return;
  try {
    const db = await promise;
    await db.closeAsync();
  } catch {
    // Closing is best-effort; the open retry path already covers failures.
  }
}

function assertNonEmptyId(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('/')) {
    throw new TypeError(`A valid ${label} ID is required.`);
  }
}

export async function insertPending(activity: PendingActivityInsert): Promise<void> {
  assertNonEmptyId(activity.localId, 'local activity');
  assertNonEmptyId(activity.userId, 'user');
  if (activity.type !== 'run' && activity.type !== 'cycle' && activity.type !== 'walk') {
    throw new TypeError('A valid activity type is required.');
  }
  if (!Array.isArray(activity.route)) throw new TypeError('Activity route must be an array.');
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO pending_activities (
      localId, firestoreId, userId, type, startTime, endTime, distanceKm, durationSec,
      avgPaceSecPerKm, caloriesEstimate, route, aiSummary, synced, retryCount, lastAttempt, createdAt
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)`,
    activity.localId,
    activity.userId,
    activity.type,
    activity.startTime,
    activity.endTime,
    activity.distanceKm,
    activity.durationSec,
    activity.avgPaceSecPerKm,
    activity.caloriesEstimate,
    JSON.stringify(activity.route),
    activity.aiSummary ?? null,
    activity.createdAt,
  );
}

export async function markSynced(localId: string, firestoreId: string): Promise<void> {
  assertNonEmptyId(localId, 'local activity');
  assertNonEmptyId(firestoreId, 'firestore');
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE pending_activities SET synced = 1, firestoreId = ? WHERE localId = ?',
    firestoreId,
    localId,
  );
}

/** Records a failed push attempt; the row stays unsynced for the #017 worker. */
export async function markFailed(localId: string): Promise<void> {
  assertNonEmptyId(localId, 'local activity');
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE pending_activities SET retryCount = retryCount + 1, lastAttempt = ? WHERE localId = ?',
    Date.now(),
    localId,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Malformed JSON or points never crash a read; they degrade to a shorter route. */
function parseRoute(json: string): RoutePoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((point) => {
    const raw = asRecord(point);
    if (!isFiniteNumber(raw.lat) || raw.lat < -90 || raw.lat > 90 ||
      !isFiniteNumber(raw.lng) || raw.lng < -180 || raw.lng > 180 ||
      !isFiniteNumber(raw.timestamp)) return [];
    const routePoint: RoutePoint = { lat: raw.lat, lng: raw.lng, timestamp: raw.timestamp };
    if (isFiniteNumber(raw.speed) && raw.speed >= 0) routePoint.speed = raw.speed;
    return [routePoint];
  });
}

function isActivityType(value: unknown): value is ActivityType {
  return value === 'run' || value === 'cycle' || value === 'walk';
}

function toPendingRow(data: unknown): PendingActivityRow | null {
  const raw = asRecord(data);
  if (typeof raw.localId !== 'string' || raw.localId.length === 0 ||
    typeof raw.userId !== 'string' || !isActivityType(raw.type) ||
    !isFiniteNumber(raw.startTime) || !isFiniteNumber(raw.endTime) ||
    !isFiniteNumber(raw.distanceKm) || !isFiniteNumber(raw.durationSec) ||
    !isFiniteNumber(raw.avgPaceSecPerKm) || !isFiniteNumber(raw.caloriesEstimate) ||
    typeof raw.route !== 'string' || !isFiniteNumber(raw.createdAt)) return null;
  return {
    localId: raw.localId,
    firestoreId: typeof raw.firestoreId === 'string' ? raw.firestoreId : null,
    userId: raw.userId,
    type: raw.type,
    startTime: raw.startTime,
    endTime: raw.endTime,
    distanceKm: raw.distanceKm,
    durationSec: raw.durationSec,
    avgPaceSecPerKm: raw.avgPaceSecPerKm,
    caloriesEstimate: raw.caloriesEstimate,
    route: parseRoute(raw.route),
    aiSummary: typeof raw.aiSummary === 'string' ? raw.aiSummary : null,
    synced: raw.synced === 1,
    retryCount: isFiniteNumber(raw.retryCount) ? raw.retryCount : 0,
    lastAttempt: isFiniteNumber(raw.lastAttempt) ? raw.lastAttempt : 0,
    createdAt: raw.createdAt,
  };
}

const ROW_COLUMNS = `localId, firestoreId, userId, type, startTime, endTime, distanceKm,
  durationSec, avgPaceSecPerKm, caloriesEstimate, route, aiSummary, synced, retryCount,
  lastAttempt, createdAt`;

/** Oldest first so the #017 worker pushes in the order activities were finished. */
export async function getUnsynced(): Promise<PendingActivityRow[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<unknown>(
    `SELECT ${ROW_COLUMNS} FROM pending_activities WHERE synced = 0 ORDER BY createdAt ASC, localId ASC`,
  );
  return rows
    .map((row) => toPendingRow(row))
    .filter((row): row is PendingActivityRow => row !== null);
}

export async function getPendingCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM pending_activities WHERE synced = 0',
  );
  return row?.count ?? 0;
}

/** #019 extension point: attach an offline AI recap to a queued row. */
export async function updateAiSummary(localId: string, text: string): Promise<void> {
  assertNonEmptyId(localId, 'local activity');
  if (typeof text !== 'string') throw new TypeError('An AI summary must be a string.');
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE pending_activities SET aiSummary = ? WHERE localId = ?',
    text,
    localId,
  );
}

/** Called on app start and after each #017 sync pass, so synced rows expire. */
export async function purgeSyncedOlderThan(days = 30): Promise<number> {
  if (!Number.isFinite(days) || days < 0) {
    throw new TypeError('Purge age must be a non-negative number of days.');
  }
  const db = await getDatabase();
  const result = await db.runAsync(
    'DELETE FROM pending_activities WHERE synced = 1 AND createdAt < ?',
    Date.now() - days * DAY_MS,
  );
  return result.changes;
}
