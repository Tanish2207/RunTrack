import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivityInput, ActivityType, AuthUser, SessionSnapshot } from '../../api/types';
import { useAuthStore } from '../../stores/authStore';
import { useSyncStore } from '../../stores/syncStore';
import { useTrackingStore } from '../../stores/trackingStore';
import type { SaveOutcome } from '../saveFlow';
import { discardPendingActivity, savePendingActivity } from '../activityReview';

const mocks = vi.hoisted(() => ({
  saveActivity: vi.fn<(input: ActivityInput) => Promise<string>>(),
  insertPending: vi.fn<(activity: unknown) => Promise<void>>(),
  markSynced: vi.fn<(localId: string, firestoreId: string) => Promise<void>>(),
  markFailed: vi.fn<(localId: string) => Promise<void>>(),
  isInternetLikelyReachable: vi.fn<() => Promise<boolean>>(),
  recomputeUserAfterActivity: vi.fn<(userId: string, input: ActivityInput, id: string) => Promise<void>>(),
  generateAndAttachSummary: vi.fn<(id: string, input: ActivityInput) => Promise<void>>(),
}));

// Keep saveFlow's real snapshot conversion; stop before Firebase/native imports.
vi.mock('../../api/activities', () => ({ saveActivity: mocks.saveActivity }));
vi.mock('../db', () => ({
  insertPending: mocks.insertPending,
  markSynced: mocks.markSynced,
  markFailed: mocks.markFailed,
}));
vi.mock('../network', () => ({ isInternetLikelyReachable: mocks.isInternetLikelyReachable }));
vi.mock('../gamification', () => ({ recomputeUserAfterActivity: mocks.recomputeUserAfterActivity }));
vi.mock('../aiSummary', () => ({ generateAndAttachSummary: mocks.generateAndAttachSummary }));

const saveRequests: Promise<SaveOutcome>[] = [];
const settleDeferred: (() => void)[] = [];

function deferred<T>(cleanupValue: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  settleDeferred.push(() => resolve(cleanupValue));
  return { promise, resolve, reject };
}

/** Track cleanup without wrapping or changing the service's promise identity. */
function requestSave(): Promise<SaveOutcome> {
  const request = savePendingActivity();
  saveRequests.push(request);
  return request;
}

/** The #016 queue write + reachability probe add microtask hops before the push. */
async function flushSaveQueue(): Promise<void> {
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
}

function user(uid = 'owner'): AuthUser {
  return { uid, email: `${uid}@example.com` };
}

function snapshot(activityType: ActivityType = 'run', startedAt = 1000): SessionSnapshot {
  const points = [
    { lat: 10, lng: 20, timestamp: startedAt, speed: 2.5 },
    { lat: 10.01, lng: 20.01, timestamp: startedAt + 2000 },
    { lat: 11, lng: 21, timestamp: startedAt + 120_000, speed: 0 },
  ];
  return {
    activityType, startedAt, endedAt: startedAt + 1_860_000, durationSec: 1800,
    distanceKm: 4.5, avgPaceSecPerKm: 400, caloriesEstimate: 326.3,
    points, segments: [points.slice(0, 2), points.slice(2)],
  };
}

function review(source: SessionSnapshot = snapshot()): SessionSnapshot {
  useTrackingStore.setState({ activityType: source.activityType, pendingSummary: source });
  return source;
}

function finishSession(): SessionSnapshot {
  vi.setSystemTime(1000);
  useTrackingStore.getState().start('cycle');
  useTrackingStore.getState().appendPoint({ lat: 0, lng: 0, timestamp: 1000, speed: 3 });
  vi.setSystemTime(11_000);
  useTrackingStore.getState().appendPoint({ lat: 0.001, lng: 0, timestamp: 11_000 });
  useTrackingStore.getState().pause();
  vi.setSystemTime(21_000);
  useTrackingStore.getState().resume();
  useTrackingStore.getState().appendPoint({ lat: 1, lng: 1, timestamp: 21_000, speed: 0 });
  vi.setSystemTime(31_000);
  const finished = useTrackingStore.getState().stop(80);
  if (!finished) throw new Error('Expected the real tracking store to finish its session.');
  return finished;
}

function expectNoWrites(): void {
  expect(mocks.saveActivity).not.toHaveBeenCalled();
  expect(mocks.insertPending).not.toHaveBeenCalled();
  expect(mocks.markSynced).not.toHaveBeenCalled();
  expect(mocks.markFailed).not.toHaveBeenCalled();
  expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
  expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
}

function expectReset(activityType: ActivityType): void {
  expect(useTrackingStore.getState()).toMatchObject({
    status: 'idle', activityType, pendingSummary: null, segments: [], startedAt: null,
    totalPausedMs: 0, pauseStartedAt: null, lastAnnouncedKm: 0,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  saveRequests.length = 0;
  settleDeferred.length = 0;
  useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useSyncStore.setState(useSyncStore.getInitialState(), true);
  useAuthStore.getState().setUser(user());
  mocks.saveActivity.mockResolvedValue('saved-id');
  mocks.insertPending.mockResolvedValue(undefined);
  mocks.markSynced.mockResolvedValue(undefined);
  mocks.markFailed.mockResolvedValue(undefined);
  mocks.isInternetLikelyReachable.mockResolvedValue(true);
  mocks.recomputeUserAfterActivity.mockResolvedValue(undefined);
  mocks.generateAndAttachSummary.mockResolvedValue(undefined);
});

afterEach(async () => {
  // A failed assertion must not leave the module's single-flight state pending.
  for (const settle of settleDeferred) settle();
  await Promise.allSettled(saveRequests);
  useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useSyncStore.setState(useSyncStore.getInitialState(), true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('savePendingActivity', () => {
  it.each(['idle', 'recording', 'paused'] as const)(
    'rejects without a finished snapshot while %s and does not write or reset', async (status) => {
      if (status !== 'idle') useTrackingStore.getState().start('run');
      if (status === 'paused') useTrackingStore.getState().pause();
      const before = useTrackingStore.getState();
      await expect(requestSave()).rejects.toThrow('There is no finished activity to save.');
      expect(useTrackingStore.getState()).toBe(before);
      expectNoWrites();
    },
  );

  it('prioritizes the missing-snapshot error when signed out too', async () => {
    useAuthStore.getState().clear();
    await expect(requestSave()).rejects.toThrow('There is no finished activity to save.');
    expectNoWrites();
  });

  it.each<AuthUser | null>([null, { uid: '', email: null }])(
    'rejects an unavailable identity %j, preserves the review, and permits sign-in retry', async (identity) => {
      const source = review();
      const before = useTrackingStore.getState();
      useAuthStore.getState().setUser(identity);
      await expect(requestSave()).rejects.toThrow('Sign in before saving your activity.');
      expect(useTrackingStore.getState()).toBe(before);
      expect(useTrackingStore.getState().pendingSummary).toBe(source);
      expectNoWrites();
      useAuthStore.getState().setUser(user());
      await expect(requestSave()).resolves.toMatchObject({ firestoreId: 'saved-id' });
      expect(mocks.saveActivity).toHaveBeenCalledOnce();
      expectReset('run');
    },
  );

  it.each<ActivityType>(['run', 'cycle', 'walk'])(
    'persists only the reviewed %s fields, not unrelated live state', async (activityType) => {
      const source = review(snapshot(activityType));
      const original = structuredClone(source);
      useTrackingStore.setState({
        activityType: activityType === 'walk' ? 'cycle' : 'walk',
        segments: [[{ lat: 80, lng: 50, timestamp: 999 }]],
        lastAnnouncedKm: 9,
      });
      await expect(requestSave()).resolves.toMatchObject({ firestoreId: 'saved-id' });
      expect(mocks.saveActivity).toHaveBeenCalledOnce();
      expect(mocks.saveActivity).toHaveBeenCalledWith({
        userId: 'owner', type: activityType, startTime: 1000, endTime: 1_861_000,
        durationSec: 1800, distanceKm: 4.5, avgPaceSecPerKm: 400, caloriesEstimate: 326.3,
        route: original.points,
      });
      expect(source).toEqual(original);
    },
  );

  it('queues offline saves locally, marks the attempt failed, and still resets the review', async () => {
    const source = review(snapshot('walk'));
    const original = structuredClone(source);
    mocks.isInternetLikelyReachable.mockResolvedValue(false);
    const outcome = await requestSave();
    expect(outcome.firestoreId).toBeNull();
    expect(outcome.localId.trim().length).toBeGreaterThan(0);
    expect(mocks.insertPending).toHaveBeenCalledOnce();
    expect(mocks.saveActivity).not.toHaveBeenCalled();
    expect(mocks.markFailed).toHaveBeenCalledOnce();
    expect(useSyncStore.getState().pendingCount).toBe(1);
    expectReset('walk');
    expect(source).toEqual(original);
  });

  it('detaches the persisted route and every point from both review representations', async () => {
    const source = review();
    const original = structuredClone(source);
    const write = deferred<string>('cleanup-id');
    mocks.saveActivity.mockReturnValue(write.promise);
    const request = requestSave();
    await flushSaveQueue();
    const input = mocks.saveActivity.mock.calls[0][0];
    expect(input.route).not.toBe(source.points);
    input.route.forEach((point, index) => {
      expect(point).not.toBe(source.points[index]);
      expect(point).not.toBe(source.segments.flat()[index]);
    });
    expect(input.route[0].speed).toBe(2.5);
    expect(input.route[1]).not.toHaveProperty('speed');
    expect(input.route[2].speed).toBe(0);
    input.route[0].lat = 30;
    input.route[0].speed = 10;
    input.route.push({ lat: 12, lng: 22, timestamp: 4000 });
    expect(source).toEqual(original);
    source.points[1].lng = 40;
    source.points.push({ lat: 13, lng: 23, timestamp: 5000 });
    source.segments[1].push({ lat: 14, lng: 24, timestamp: 6000 });
    source.startedAt = 99;
    source.distanceKm = 99;
    expect(input.route[1].lng).toBe(20.01);
    expect(input.route).toHaveLength(4);
    expect(input.route[3]).toEqual({ lat: 12, lng: 22, timestamp: 4000 });
    expect(input.startTime).toBe(1000);
    expect(input.distanceKm).toBe(4.5);
    write.resolve('saved-id');
    await expect(request).resolves.toMatchObject({ firestoreId: 'saved-id' });
  });

  it('returns the exact same promise and persists once for the same owner and snapshot', async () => {
    const source = review();
    const before = useTrackingStore.getState();
    const write = deferred<string>('cleanup-id');
    mocks.saveActivity.mockReturnValue(write.promise);
    const first = requestSave();
    const second = requestSave();
    await flushSaveQueue();
    const third = requestSave();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(useTrackingStore.getState()).toBe(before);
    expect(useTrackingStore.getState().pendingSummary).toBe(source);
    write.resolve('single-id');
    await expect(first).resolves.toMatchObject({ firestoreId: 'single-id' });
    await expect(second).resolves.toMatchObject({ firestoreId: 'single-id' });
    await expect(third).resolves.toMatchObject({ firestoreId: 'single-id' });
    expectReset('run');
    await expect(requestSave()).rejects.toThrow('There is no finished activity to save.');
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
  });

  it('keeps duplicate-save and discard guards until the entire saveFlow finishes', async () => {
    const source = review();
    const write = deferred<string>('cleanup-id');
    const postSave = deferred<void>(undefined);
    mocks.saveActivity.mockReturnValue(write.promise);
    mocks.recomputeUserAfterActivity.mockReturnValue(postSave.promise);
    const first = requestSave();
    await flushSaveQueue();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
    expect(requestSave()).toBe(first);
    expect(discardPendingActivity()).toBe(false);
    expect(useTrackingStore.getState().pendingSummary).toBe(source);
    write.resolve('saved-id');
    await flushSaveQueue();
    // The push landed; gamification is still in flight, so guards must hold.
    expect(mocks.recomputeUserAfterActivity).toHaveBeenCalledOnce();
    expect(requestSave()).toBe(first);
    expect(discardPendingActivity()).toBe(false);
    postSave.resolve(undefined);
    await expect(first).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expectReset('run');
  });

  it('resets the real finished session only after its own save succeeds', async () => {
    const source = finishSession();
    useTrackingStore.getState().setLastAnnouncedKm(7);
    const before = useTrackingStore.getState();
    const write = deferred<string>('cleanup-id');
    mocks.saveActivity.mockReturnValue(write.promise);
    const request = requestSave();
    expect(useTrackingStore.getState()).toBe(before);
    expect(before.pendingSummary).toBe(source);
    write.resolve('cycle-id');
    await expect(request).resolves.toMatchObject({ firestoreId: 'cycle-id' });
    expectReset('cycle');
    useTrackingStore.getState().start('walk');
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', activityType: 'walk', startedAt: 31_000 });
  });

  it('treats a refreshed auth object with the same uid as the same owner', async () => {
    review();
    const write = deferred<string>('cleanup-id');
    mocks.saveActivity.mockReturnValue(write.promise);
    const request = requestSave();
    useAuthStore.getState().setUser({ uid: 'owner', email: 'updated@example.com' });
    expect(requestSave()).toBe(request);
    write.resolve('saved-id');
    await expect(request).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expectReset('run');
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
  });

  it.each(['rejection', 'synchronous throw'] as const)(
    'preserves the exact review when the queue write and fallback push both fail (%s) and allows a fresh retry', async (mode) => {
      const source = review(snapshot('walk'));
      const original = structuredClone(source);
      const before = useTrackingStore.getState();
      const failure = new Error('permission-denied');
      const write = deferred<string>('cleanup-id');
      // The row never lands, so the flow falls back to a direct #013 push.
      if (mode === 'rejection') {
        mocks.insertPending.mockRejectedValueOnce(failure);
        mocks.saveActivity.mockReturnValueOnce(write.promise);
        write.reject(failure);
      } else {
        mocks.insertPending.mockImplementationOnce(() => { throw failure; });
        mocks.saveActivity.mockImplementationOnce(() => { throw failure; });
      }
      const first = requestSave();
      const duplicate = requestSave();
      expect(duplicate).toBe(first);
      await expect(first).rejects.toBe(failure);
      await expect(duplicate).rejects.toBe(failure);
      expect(useTrackingStore.getState()).toBe(before);
      expect(useTrackingStore.getState().pendingSummary).toBe(source);
      expect(source).toEqual(original);
      expect(mocks.markFailed).not.toHaveBeenCalled();
      expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
      expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
      const retry = requestSave();
      expect(retry).not.toBe(first);
      await flushSaveQueue();
      await expect(retry).resolves.toMatchObject({ firestoreId: 'saved-id' });
      expect(mocks.saveActivity).toHaveBeenCalledTimes(2);
      expect(useSyncStore.getState().pendingCount).toBe(0);
      expectReset('walk');
    },
  );

  it('rebuilds a detached retry payload even if failed persistence mutated its input', async () => {
    const source = review();
    const original = structuredClone(source);
    const failure = new Error('offline');
    mocks.insertPending.mockRejectedValueOnce(new Error('sqlite unavailable'));
    mocks.saveActivity.mockImplementationOnce(async (input) => {
      input.route[0].lat = 80;
      input.route.pop();
      throw failure;
    });
    await expect(requestSave()).rejects.toBe(failure);
    expect(useTrackingStore.getState().pendingSummary).toBe(source);
    expect(source).toEqual(original);
    await flushSaveQueue();
    await expect(requestSave()).resolves.toMatchObject({ firestoreId: 'saved-id' });
    const firstInput = mocks.saveActivity.mock.calls[0][0];
    const retryInput = mocks.saveActivity.mock.calls[1][0];
    expect(retryInput).not.toBe(firstInput);
    expect(retryInput.route).not.toBe(firstInput.route);
    expect(retryInput.route).not.toBe(source.points);
    expect(retryInput.route).toEqual(original.points);
    expect(mocks.saveActivity).toHaveBeenCalledTimes(2);
  });

  it.each(['logout', 'new user', 'equal replacement', 'different replacement', 'new recording'] as const)(
    'does not reset the current store on a late success after %s', async (change) => {
      const source = review();
      const original = structuredClone(source);
      const write = deferred<string>('cleanup-id');
      mocks.saveActivity.mockReturnValue(write.promise);
      const request = requestSave();
      if (change === 'logout') useAuthStore.getState().clear();
      if (change === 'new user') useAuthStore.getState().setUser(user('other-owner'));
      if (change === 'equal replacement') review(structuredClone(source));
      if (change === 'different replacement') review(snapshot('cycle', 2_000_000));
      if (change === 'new recording') {
        useTrackingStore.getState().reset();
        useTrackingStore.getState().start('walk');
        useTrackingStore.getState().appendPoint({ lat: 30, lng: 40, timestamp: 0 });
      }
      const current = useTrackingStore.getState();
      const currentAuth = useAuthStore.getState();
      write.resolve('original-owner-id');
      await expect(request).resolves.toMatchObject({ firestoreId: 'original-owner-id' });
      expect(useTrackingStore.getState()).toBe(current);
      expect(useAuthStore.getState()).toBe(currentAuth);
      expect(source).toEqual(original);
      expect(mocks.saveActivity.mock.calls[0][0].userId).toBe('owner');
      expect(mocks.saveActivity).toHaveBeenCalledOnce();
    },
  );

  it('does not alter a new owner or replacement review when an old save rejects', async () => {
    const source = review();
    const write = deferred<string>('cleanup-id');
    // The old owner's row never queues and its fallback push fails too.
    const failure = new Error('old request failed');
    mocks.insertPending.mockRejectedValueOnce(new Error('sqlite unavailable'));
    mocks.saveActivity.mockReturnValueOnce(write.promise);
    const request = requestSave();
    useAuthStore.getState().setUser(user('other-owner'));
    const replacement = review(snapshot('cycle', 2_000_000));
    const current = useTrackingStore.getState();
    write.reject(failure);
    await expect(request).rejects.toBe(failure);
    expect(useTrackingStore.getState()).toBe(current);
    expect(current.pendingSummary).toBe(replacement);
    expect(replacement).not.toBe(source);
    await expect(requestSave()).resolves.toMatchObject({ firestoreId: 'saved-id' });
    expect(mocks.saveActivity.mock.calls[1][0].userId).toBe('other-owner');
    expectReset('cycle');
  });
});

describe('discardPendingActivity', () => {
  it.each(['idle', 'recording', 'paused'] as const)(
    'does nothing without a pending review while %s', (status) => {
      if (status !== 'idle') useTrackingStore.getState().start('run');
      if (status === 'paused') useTrackingStore.getState().pause();
      const before = useTrackingStore.getState();
      expect(discardPendingActivity()).toBe(false);
      expect(useTrackingStore.getState()).toBe(before);
      expectNoWrites();
    },
  );

  it('discards without authentication or persistence, then allows a new session', () => {
    const source = review(snapshot('cycle'));
    const original = structuredClone(source);
    useAuthStore.getState().clear();
    expect(discardPendingActivity()).toBe(true);
    expectReset('cycle');
    const reset = useTrackingStore.getState();
    expect(discardPendingActivity()).toBe(false);
    expect(useTrackingStore.getState()).toBe(reset);
    expect(source).toEqual(original);
    useTrackingStore.getState().start('walk');
    expect(useTrackingStore.getState().status).toBe('recording');
    expectNoWrites();
  });

  it('blocks during a save even after the owner changes, then permits discard on completion', async () => {
    const source = review();
    const before = useTrackingStore.getState();
    const write = deferred<string>('cleanup-id');
    mocks.saveActivity.mockReturnValue(write.promise);
    const request = requestSave();
    useAuthStore.getState().setUser(user('other-owner'));
    expect(discardPendingActivity()).toBe(false);
    expect(useTrackingStore.getState()).toBe(before);
    expect(useTrackingStore.getState().pendingSummary).toBe(source);
    await flushSaveQueue();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    write.resolve('old-id');
    await expect(request).resolves.toMatchObject({ firestoreId: 'old-id' });
    expect(discardPendingActivity()).toBe(true);
    expectReset('run');
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
  });

  it('resets the review after a failed push without adding another persistence write', async () => {
    review();
    const write = deferred<string>('cleanup-id');
    mocks.saveActivity.mockReturnValue(write.promise);
    const request = requestSave();
    expect(discardPendingActivity()).toBe(false);
    await flushSaveQueue();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    write.reject(new Error('offline'));
    // A failed push is a queued offline save: the request resolves and resets.
    await expect(request).resolves.toMatchObject({ firestoreId: null });
    expect(useTrackingStore.getState().pendingSummary).toBeNull();
    expect(useTrackingStore.getState().status).toBe('idle');
    expect(mocks.markFailed).toHaveBeenCalledOnce();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
    expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
  });

  it('unblocks discard after a save fails completely, without another persistence write', async () => {
    review();
    const failure = new Error('offline');
    const write = deferred<string>('cleanup-id');
    // The row never queues, and the fallback push fails: nothing was saved.
    mocks.insertPending.mockRejectedValueOnce(new Error('sqlite unavailable'));
    mocks.saveActivity.mockReturnValue(write.promise);
    const request = requestSave();
    expect(discardPendingActivity()).toBe(false);
    await flushSaveQueue();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    write.reject(failure);
    await expect(request).rejects.toBe(failure);
    expect(discardPendingActivity()).toBe(true);
    expectReset('run');
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
    expect(mocks.recomputeUserAfterActivity).not.toHaveBeenCalled();
    expect(mocks.generateAndAttachSummary).not.toHaveBeenCalled();
  });

  it('can discard a replacement not being saved, without an old completion resetting a new run', async () => {
    review();
    const write = deferred<string>('cleanup-id');
    mocks.saveActivity.mockReturnValue(write.promise);
    const request = requestSave();
    review(snapshot('cycle', 2_000_000));
    expect(discardPendingActivity()).toBe(true);
    expectReset('cycle');
    useTrackingStore.getState().start('walk');
    const current = useTrackingStore.getState();
    write.resolve('old-id');
    await expect(request).resolves.toMatchObject({ firestoreId: 'old-id' });
    expect(useTrackingStore.getState()).toBe(current);
    expect(mocks.saveActivity).toHaveBeenCalledOnce();
  });
});

describe('overlapping activity saves', () => {
  it.each(['success', 'failure'] as const)(
    'keeps a different owner/snapshot request guarded when the older save ends in %s', async (result) => {
      review();
      const olderWrite = deferred<string>('cleanup-old-id');
      const newerWrite = deferred<string>('cleanup-new-id');
      mocks.saveActivity.mockReturnValueOnce(olderWrite.promise).mockReturnValueOnce(newerWrite.promise);
      const older = requestSave();
      useAuthStore.getState().setUser(user('other-owner'));
      const replacement = review(snapshot('cycle', 2_000_000));
      const current = useTrackingStore.getState();
      const newer = requestSave();
      expect(newer).not.toBe(older);
      await flushSaveQueue();
      expect(mocks.saveActivity).toHaveBeenCalledTimes(2);
      expect(mocks.saveActivity.mock.calls.map(([input]) => [input.userId, input.type])).toEqual([
        ['owner', 'run'], ['other-owner', 'cycle'],
      ]);
      if (result === 'success') {
        olderWrite.resolve('old-id');
        await expect(older).resolves.toMatchObject({ firestoreId: 'old-id' });
      } else {
        // A failed older push stays queued locally; it never rejects the request.
        const failure = new Error('old save failed');
        olderWrite.reject(failure);
        await expect(older).resolves.toMatchObject({ firestoreId: null });
      }
      expect(useTrackingStore.getState()).toBe(current);
      expect(current.pendingSummary).toBe(replacement);
      expect(requestSave()).toBe(newer);
      expect(discardPendingActivity()).toBe(false);
      expect(mocks.saveActivity).toHaveBeenCalledTimes(2);
      newerWrite.resolve('new-id');
      await expect(newer).resolves.toMatchObject({ firestoreId: 'new-id' });
      expectReset('cycle');
    },
  );

  it('retains an earlier identity\'s exact in-flight promise when another identity also saves', async () => {
    const source = review();
    const ownerWrite = deferred<string>('cleanup-owner-id');
    const otherWrite = deferred<string>('cleanup-other-id');
    mocks.saveActivity.mockImplementation((input) => input.userId === 'owner' ? ownerWrite.promise : otherWrite.promise);
    const ownerRequest = requestSave();
    useAuthStore.getState().setUser(user('other-owner'));
    const otherRequest = requestSave();
    useAuthStore.getState().setUser(user());
    const repeatedOwnerRequest = requestSave();
    await flushSaveQueue();
    const writes = mocks.saveActivity.mock.calls.length;
    ownerWrite.resolve('owner-id');
    otherWrite.resolve('other-id');
    await expect(ownerRequest).resolves.toMatchObject({ firestoreId: 'owner-id' });
    await expect(otherRequest).resolves.toMatchObject({ firestoreId: 'other-id' });
    await expect(repeatedOwnerRequest).resolves.toMatchObject({ firestoreId: 'owner-id' });
    expect(otherRequest).not.toBe(ownerRequest);
    expect(repeatedOwnerRequest).toBe(ownerRequest);
    expect(writes).toBe(2);
    expect(source.activityType).toBe('run');
  });

  it('does not release an older review\'s discard guard when a newer request settles first', async () => {
    const source = review();
    const ownerWrite = deferred<string>('cleanup-owner-id');
    const otherWrite = deferred<string>('cleanup-other-id');
    mocks.saveActivity.mockReturnValueOnce(ownerWrite.promise).mockReturnValueOnce(otherWrite.promise);
    const ownerRequest = requestSave();
    useAuthStore.getState().setUser(user('other-owner'));
    const otherRequest = requestSave();
    useAuthStore.getState().setUser(user());
    otherWrite.resolve('other-id');
    await flushSaveQueue();
    await expect(otherRequest).resolves.toMatchObject({ firestoreId: 'other-id' });
    expect(useTrackingStore.getState().pendingSummary).toBe(source);
    const beforeDiscard = useTrackingStore.getState();
    const discarded = discardPendingActivity();
    const afterDiscard = useTrackingStore.getState();
    ownerWrite.resolve('owner-id');
    await expect(ownerRequest).resolves.toMatchObject({ firestoreId: 'owner-id' });
    expect(discarded).toBe(false);
    expect(afterDiscard).toBe(beforeDiscard);
    expect(mocks.saveActivity).toHaveBeenCalledTimes(2);
  });
});
