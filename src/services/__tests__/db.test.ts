import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, getDatabase, insertPending, markFailed, markSynced,
  getUnsynced, getPendingCount, updateAiSummary, purgeSyncedOlderThan } from '../db';

const mocks = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));

vi.mock('expo-sqlite', () => ({ openDatabaseAsync: mocks.openDatabaseAsync }));

interface Handle {
  execAsync: ReturnType<typeof vi.fn>;
  runAsync: ReturnType<typeof vi.fn>;
  getFirstAsync: ReturnType<typeof vi.fn>;
  getAllAsync: ReturnType<typeof vi.fn>;
  closeAsync: ReturnType<typeof vi.fn>;
}

let handle: Handle;

function validInsert() {
  return {
    localId: 'local-1', userId: 'owner', type: 'run' as const,
    startTime: 1000, endTime: 2000, distanceKm: 1, durationSec: 1000,
    avgPaceSecPerKm: 1000, caloriesEstimate: 60,
    route: [{ lat: 10, lng: 20, timestamp: 1000, speed: 2 }],
    createdAt: 5000,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  handle = {
    execAsync: vi.fn<(source: string) => Promise<unknown>>().mockResolvedValue({ rows: [] }),
    runAsync: vi.fn<(source: string, ...params: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ changes: 1, lastInsertRowid: 1 }),
    getFirstAsync: vi.fn<(source: string, ...params: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ user_version: 0 }),
    getAllAsync: vi.fn<(source: string, ...params: unknown[]) => Promise<unknown[]>>()
      .mockResolvedValue([]),
    closeAsync: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  mocks.openDatabaseAsync.mockResolvedValue(handle);
});

afterEach(async () => {
  await closeDatabase();
  vi.useRealTimers();
});

describe('database lifecycle', () => {
  it('opens once, enables WAL, and applies the v1 schema from user_version 0', async () => {
    await getDatabase();
    await getDatabase();
    expect(mocks.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(mocks.openDatabaseAsync).toHaveBeenCalledWith('runtrack.db');
    const executed = handle.execAsync.mock.calls.map(([source]) => source as string);
    expect(executed[0]).toBe('PRAGMA journal_mode = WAL;');
    expect(executed.some((source) => source.includes('CREATE TABLE IF NOT EXISTS pending_activities'))).toBe(true);
    expect(executed).toContain('PRAGMA user_version = 1');
    expect(handle.getFirstAsync).toHaveBeenCalledWith('PRAGMA user_version');
  });

  it('skips migrations when the stored version is current', async () => {
    handle.getFirstAsync.mockResolvedValue({ user_version: 1 });
    await getDatabase();
    const executed = handle.execAsync.mock.calls.map(([source]) => source as string);
    expect(executed).toEqual(['PRAGMA journal_mode = WAL;']);
  });

  it('reopens after close and reports open failures without caching them', async () => {
    await getDatabase();
    await closeDatabase();
    expect(handle.closeAsync).toHaveBeenCalledOnce();
    mocks.openDatabaseAsync.mockRejectedValueOnce(new Error('open failed'));
    await expect(getDatabase()).rejects.toThrow('open failed');
    await expect(getDatabase()).resolves.toBe(handle);
    expect(mocks.openDatabaseAsync).toHaveBeenCalledTimes(3);
  });
});

describe('insertPending', () => {
  it('stores the queue row with a stringified route and zeroed sync columns', async () => {
    await expect(insertPending(validInsert())).resolves.toBeUndefined();
    const [source, ...params] = handle.runAsync.mock.calls[0] as [string, ...unknown[]];
    expect(source).toContain('INSERT INTO pending_activities');
    expect(params).toEqual([
      'local-1', 'owner', 'run', 1000, 2000, 1, 1000, 1000, 60,
      JSON.stringify([{ lat: 10, lng: 20, timestamp: 1000, speed: 2 }]),
      null, 5000,
    ]);
    expect(source).toContain('VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)');
  });

  it('stores an optional aiSummary value instead of null', async () => {
    await insertPending({ ...validInsert(), aiSummary: 'Nice pace.' });
    expect(handle.runAsync.mock.calls[0].slice(11, 13)).toEqual(['Nice pace.', 5000]);
  });

  it.each([
    { label: 'localId', patch: { localId: ' ' } },
    { label: 'userId', patch: { userId: '' } },
    { label: 'type', patch: { type: 'swim' } },
    { label: 'route', patch: { route: 'not-an-array' } },
  ])('rejects an invalid $label before touching the database', async ({ patch }) => {
    await expect(insertPending({ ...validInsert(), ...patch } as never)).rejects.toThrow(TypeError);
    expect(handle.runAsync).not.toHaveBeenCalled();
  });
});

describe('sync bookkeeping helpers', () => {
  it('markSynced flags the row and records the Firestore ID', async () => {
    await markSynced('local-1', 'fire-1');
    expect(handle.runAsync).toHaveBeenCalledExactlyOnceWith(
      'UPDATE pending_activities SET synced = 1, firestoreId = ? WHERE localId = ?',
      'fire-1', 'local-1',
    );
  });

  it('markFailed bumps retryCount with the attempt time and keeps the row unsynced', async () => {
    vi.setSystemTime(99_000);
    await markFailed('local-1');
    expect(handle.runAsync).toHaveBeenCalledExactlyOnceWith(
      'UPDATE pending_activities SET retryCount = retryCount + 1, lastAttempt = ? WHERE localId = ?',
      99_000, 'local-1',
    );
  });

  it('getPendingCount counts unsynced rows only', async () => {
    handle.getFirstAsync.mockResolvedValue({ count: 7 });
    await expect(getPendingCount()).resolves.toBe(7);
    expect(handle.getFirstAsync).toHaveBeenCalledWith(
      'SELECT COUNT(*) AS count FROM pending_activities WHERE synced = 0',
    );
  });

  it('getPendingCount treats a missing count row as zero', async () => {
    handle.getFirstAsync.mockResolvedValue(null);
    await expect(getPendingCount()).resolves.toBe(0);
  });

  it('updateAiSummary writes text for #019 without touching sync state', async () => {
    await updateAiSummary('local-1', 'Great consistent pace.');
    expect(handle.runAsync).toHaveBeenCalledExactlyOnceWith(
      'UPDATE pending_activities SET aiSummary = ? WHERE localId = ?',
      'Great consistent pace.', 'local-1',
    );
  });
});

describe('getUnsynced', () => {
  it('returns oldest-first rows with parsed routes and boolean sync flags', async () => {
    handle.getAllAsync.mockResolvedValue([{
      localId: 'local-1', firestoreId: null, userId: 'owner', type: 'run',
      startTime: 1000, endTime: 2000, distanceKm: 1, durationSec: 1000,
      avgPaceSecPerKm: 1000, caloriesEstimate: 60,
      route: JSON.stringify([
        { lat: 10, lng: 20, timestamp: 1000, speed: 2 },
        { lat: 'bad', lng: 20, timestamp: 2000 },
        { lat: 11, lng: 20, timestamp: 3000 },
      ]),
      aiSummary: 'ok', synced: 0, retryCount: 2, lastAttempt: 900, createdAt: 500,
    }]);
    const rows = await getUnsynced();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      localId: 'local-1', firestoreId: null, userId: 'owner', type: 'run',
      startTime: 1000, endTime: 2000, distanceKm: 1, durationSec: 1000,
      avgPaceSecPerKm: 1000, caloriesEstimate: 60,
      route: [{ lat: 10, lng: 20, timestamp: 1000, speed: 2 }, { lat: 11, lng: 20, timestamp: 3000 }],
      aiSummary: 'ok', synced: false, retryCount: 2, lastAttempt: 900, createdAt: 500,
    });
    expect(handle.getAllAsync.mock.calls[0][0] as string).toContain('WHERE synced = 0');
    expect(handle.getAllAsync.mock.calls[0][0] as string).toContain('ORDER BY createdAt ASC');
  });

  it('drops malformed rows and degrades unreadable routes instead of throwing', async () => {
    handle.getAllAsync.mockResolvedValue([
      { localId: 'broken', userId: 'owner', type: 'swim', route: '[]', createdAt: 1,
        startTime: 0, endTime: 1, distanceKm: 0, durationSec: 0, avgPaceSecPerKm: 0, caloriesEstimate: 0 },
      { localId: 'ok', userId: 'owner', type: 'walk', route: 'not-json', createdAt: 2,
        startTime: 0, endTime: 1, distanceKm: 0, durationSec: 0, avgPaceSecPerKm: 0, caloriesEstimate: 0 },
    ]);
    const rows = await getUnsynced();
    expect(rows.map((row) => [row.localId, row.route])).toEqual([['ok', []]]);
  });
});

describe('purgeSyncedOlderThan', () => {
  it('deletes synced rows older than 30 days by default', async () => {
    vi.setSystemTime(10_000_000);
    handle.runAsync.mockResolvedValue({ changes: 4, lastInsertRowid: 0 });
    await expect(purgeSyncedOlderThan()).resolves.toBe(4);
    expect(handle.runAsync).toHaveBeenCalledExactlyOnceWith(
      'DELETE FROM pending_activities WHERE synced = 1 AND createdAt < ?',
      10_000_000 - 30 * 86_400_000,
    );
  });

  it('accepts an explicit age in days', async () => {
    vi.setSystemTime(10_000_000);
    await purgeSyncedOlderThan(7);
    expect(handle.runAsync).toHaveBeenCalledExactlyOnceWith(
      'DELETE FROM pending_activities WHERE synced = 1 AND createdAt < ?',
      10_000_000 - 7 * 86_400_000,
    );
  });

  it.each([-1, Number.NaN])('rejects an invalid age %s', async (days) => {
    await expect(purgeSyncedOlderThan(days)).rejects.toThrow(TypeError);
    expect(handle.runAsync).not.toHaveBeenCalled();
  });
});
