import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivityInput, ActivityType, SessionSnapshot } from '../../api/types';
import { useSyncStore } from '../../stores/syncStore';
import { newLocalId, saveActivityFlow, snapshotToActivityInput } from '../saveFlow';

const mocks = vi.hoisted(() => ({
  saveActivity: vi.fn<(input: ActivityInput) => Promise<string>>(),
  insertPending: vi.fn<(activity: unknown) => Promise<void>>(),
  markSynced: vi.fn<(localId: string, firestoreId: string) => Promise<void>>(),
  markFailed: vi.fn<(localId: string) => Promise<void>>(),
  isInternetLikelyReachable: vi.fn<() => Promise<boolean>>(),
  recomputeUserAfterActivity: vi.fn<(userId: string, input: ActivityInput, id: string) => Promise<void>>(),
  generateAndAttachSummary: vi.fn<(id: string, input: ActivityInput) => Promise<void>>(),
}));

vi.mock('../../api/activities', () => ({ saveActivity: mocks.saveActivity }));
vi.mock('../db', () => ({
  insertPending: mocks.insertPending,
  markSynced: mocks.markSynced,
  markFailed: mocks.markFailed,
}));
vi.mock('../network', () => ({ isInternetLikelyReachable: mocks.isInternetLikelyReachable }));
vi.mock('../gamification', () => ({ recomputeUserAfterActivity: mocks.recomputeUserAfterActivity }));
vi.mock('../aiSummary', () => ({ generateAndAttachSummary: mocks.generateAndAttachSummary }));

function snapshot(activityType: ActivityType = 'run'): SessionSnapshot {
  const points = [{ lat: 10, lng: 20, timestamp: 0, speed: 2.5 }, { lat: 11, lng: 21, timestamp: 2000 }];
  return {
    activityType, startedAt: 0, endedAt: 1_800_000, durationSec: 1800,
    distanceKm: 5, avgPaceSecPerKm: 360, caloriesEstimate: 362.6,
    points, segments: [points],
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function queuedInput(): ActivityInput {
  return snapshotToActivityInput('owner', snapshot());
}

beforeEach(() => {
  vi.resetAllMocks();
  useSyncStore.setState(useSyncStore.getInitialState(), true);
  mocks.saveActivity.mockResolvedValue('saved-id');
  mocks.insertPending.mockResolvedValue(undefined);
  mocks.markSynced.mockResolvedValue(undefined);
  mocks.markFailed.mockResolvedValue(undefined);
  mocks.isInternetLikelyReachable.mockResolvedValue(true);
  mocks.recomputeUserAfterActivity.mockResolvedValue(undefined);
  mocks.generateAndAttachSummary.mockResolvedValue(undefined);
});

describe('snapshotToActivityInput', () => {
  it.each<ActivityType>(['run', 'cycle', 'walk'])('maps %s snapshot fields to epoch-ms input', (type) => {
    const source = snapshot(type);
    expect(snapshotToActivityInput('owner', source)).toEqual({
      userId: 'owner', type, startTime: 0, endTime: 1_800_000, durationSec: 1800,
      distanceKm: 5, avgPaceSecPerKm: 360, caloriesEstimate: 362.6, route: source.points,
    });
  });

  it('copies the route array and every point defensively in both directions', () => {
    const source = snapshot();
    const input = snapshotToActivityInput('owner', source);
    expect(input.route).not.toBe(source.points);
    expect(input.route[0]).not.toBe(source.points[0]);
    expect(input.route[1]).not.toBe(source.points[1]);
    input.route[0].lat = 30;
    expect(source.points[0].lat).toBe(10);
    source.points[1].lng = 40;
    source.points.push({ lat: 12, lng: 22, timestamp: 4000 });
    expect(input.route[1].lng).toBe(21);
    expect(input.route).toHaveLength(2);
    expect(input.route[0].speed).toBe(2.5);
  });
});

describe('newLocalId', () => {
  it('generates unique, non-empty local keys for the SQLite primary key', () => {
    const ids = Array.from({ length: 1000 }, () => newLocalId());
    expect(new Set(ids).size).toBe(1000);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
  });
});

describe('saveActivityFlow — queued paths (#016)', () => {
  it('queues first, pushes when reachable, acknowledges, and runs the #013 hooks in order', async () => {
    const steps: string[] = [];
    const input = queuedInput();
    mocks.insertPending.mockImplementation(async () => { steps.push('insert'); });
    mocks.isInternetLikelyReachable.mockImplementation(async () => { steps.push('reachability'); return true; });
    mocks.saveActivity.mockImplementation(async () => { steps.push('push'); return 'saved-id'; });
    mocks.markSynced.mockImplementation(async () => { steps.push('ack'); });
    mocks.recomputeUserAfterActivity.mockImplementation(async () => { steps.push('gamification'); });
    mocks.generateAndAttachSummary.mockImplementation(async () => { steps.push('ai'); });

    await expect(saveActivityFlow(input)).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expect(steps).toEqual(['insert', 'reachability', 'push', 'ack', 'gamification', 'ai']);
    expect(mocks.insertPending.mock.calls[0][0]).toMatchObject({
      userId: 'owner', type: 'run', startTime: 0, endTime: 1_800_000, durationSec: 1800,
      distanceKm: 5, avgPaceSecPerKm: 360, caloriesEstimate: 362.6, aiSummary: null,
    });
    expect(mocks.saveActivity).toHaveBeenCalledWith(input);
    expect(mocks.recomputeUserAfterActivity).toHaveBeenCalledWith('owner', input, 'saved-id');
    expect(mocks.generateAndAttachSummary).toHaveBeenCalledWith('saved-id', input);
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it('queues a detached copy of the route so later input mutations cannot reach SQLite', async () => {
    const input = queuedInput();
    await saveActivityFlow(input);
    const stored = mocks.insertPending.mock.calls[0][0] as { route: ActivityInput['route'] };
    expect(stored.route).not.toBe(input.route);
    expect(stored.route[0]).not.toBe(input.route[0]);
    input.route[0].lat = 80;
    input.route.pop();
    expect(stored.route).toHaveLength(2);
    expect(stored.route[0].lat).toBe(10);
  });

  it('never pushes or rejects when reachability says offline, and marks the attempt failed', async () => {
    mocks.isInternetLikelyReachable.mockResolvedValue(false);
    await expect(saveActivityFlow(queuedInput())).resolves.toMatchObject({ firestoreId: null });
    expect(mocks.saveActivity).not.toHaveBeenCalled();
    expect(mocks.markSynced).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledOnce();
    expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
    expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
    expect(useSyncStore.getState().pendingCount).toBe(1);
  });

  it('keeps the queued row unsynced when the push fails, without failing the save', async () => {
    const failure = new Error('permission-denied');
    mocks.saveActivity.mockRejectedValue(failure);
    const outcome = await saveActivityFlow(queuedInput());
    expect(outcome.firestoreId).toBeNull();
    expect(outcome.localId.trim().length).toBeGreaterThan(0);
    expect(mocks.markFailed).toHaveBeenCalledOnce();
    expect(mocks.markSynced).not.toHaveBeenCalled();
    expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
    expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
    expect(useSyncStore.getState().pendingCount).toBe(1);
  });

  it('does not decrement the counter when the local acknowledgement fails after a landed push', async () => {
    mocks.markSynced.mockRejectedValue(new Error('sqlite write failed'));
    const outcome = await saveActivityFlow(queuedInput());
    expect(outcome.firestoreId).toBe('saved-id');
    expect(mocks.recomputeUserAfterActivity).toHaveBeenCalledOnce();
    expect(useSyncStore.getState().pendingCount).toBe(1);
  });

  it('isolates asynchronous gamification errors and still starts AI', async () => {
    mocks.recomputeUserAfterActivity.mockRejectedValue(new Error('gamification failed'));
    await expect(saveActivityFlow(queuedInput())).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expect(mocks.generateAndAttachSummary).toHaveBeenCalledOnce();
  });

  it('isolates synchronous gamification throws', async () => {
    mocks.recomputeUserAfterActivity.mockImplementation(() => { throw new Error('sync gamification failure'); });
    await expect(saveActivityFlow(queuedInput())).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expect(mocks.generateAndAttachSummary).toHaveBeenCalledOnce();
  });

  it('does not start AI before gamification settles', async () => {
    const gamification = deferred();
    mocks.recomputeUserAfterActivity.mockReturnValue(gamification.promise);
    const flow = saveActivityFlow(queuedInput());
    await Promise.resolve();
    expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
    gamification.resolve();
    await expect(flow).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expect(mocks.generateAndAttachSummary).toHaveBeenCalledOnce();
  });

  it('returns without waiting for AI and consumes a later rejection', async () => {
    const ai = deferred();
    mocks.generateAndAttachSummary.mockReturnValue(ai.promise);
    await expect(saveActivityFlow(queuedInput())).resolves.toMatchObject({ firestoreId: 'saved-id' });
    ai.reject(new Error('late AI failure'));
    await Promise.resolve(); // Vitest would report an unhandled rejection without .catch.
  });

  it('isolates immediately rejected and synchronously throwing AI hooks', async () => {
    mocks.generateAndAttachSummary.mockRejectedValue(new Error('AI unavailable'));
    await expect(saveActivityFlow(queuedInput())).resolves.toMatchObject({ firestoreId: 'saved-id' });
    mocks.generateAndAttachSummary.mockImplementation(() => { throw new Error('sync AI failure'); });
    await expect(saveActivityFlow(queuedInput())).resolves.toMatchObject({ firestoreId: 'saved-id' });
  });
});

describe('saveActivityFlow — fallback when the queue write fails', () => {
  it('falls back to the #013 direct push and still runs the hooks', async () => {
    mocks.insertPending.mockRejectedValue(new Error('sqlite unavailable'));
    await expect(saveActivityFlow(queuedInput())).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.recomputeUserAfterActivity).toHaveBeenCalledOnce();
    expect(mocks.generateAndAttachSummary).toHaveBeenCalledOnce();
    expect(mocks.markSynced).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });

  it('propagates a fallback push failure so the UI retains its snapshot', async () => {
    const failure = new Error('offline');
    mocks.insertPending.mockRejectedValue(new Error('sqlite unavailable'));
    mocks.saveActivity.mockRejectedValue(failure);
    await expect(saveActivityFlow(queuedInput())).rejects.toBe(failure);
    expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
    expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
    expect(useSyncStore.getState().pendingCount).toBe(0);
  });
});
