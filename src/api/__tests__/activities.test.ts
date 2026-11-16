import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import indexes from '../../../firestore.indexes.json';
import type { Activity, ActivityInput } from '../types';
import {
  fetchRecentActivities,
  getActivity,
  saveActivity,
  subscribeHistory,
  updateActivity,
  type ActivityPatch,
} from '../activities';

interface ActivitySnapshot {
  id: string;
  exists(): boolean;
  data(): unknown;
}

interface HistorySnapshot {
  docs: ActivitySnapshot[];
}

interface Constraint {
  kind: string;
  args: unknown[];
}

interface OwnerQuery {
  collection: { path: string };
  constraints: Constraint[];
}

const mocks = vi.hoisted(() => ({
  assertFirebaseConfigured: vi.fn<() => void>(),
  collection: vi.fn<(db: unknown, path: string) => { path: string }>(),
  doc: vi.fn<(db: unknown, path: string, id: string) => { path: string; id: string }>(),
  addDoc: vi.fn<(ref: unknown, data: Record<string, unknown>) => Promise<{ id: string }>>(),
  getDoc: vi.fn<(ref: unknown) => Promise<ActivitySnapshot>>(),
  getDocs: vi.fn<(query: unknown) => Promise<HistorySnapshot>>(),
  limit: vi.fn<(count: number) => Constraint>(),
  orderBy: vi.fn<(field: string, direction: string) => Constraint>(),
  where: vi.fn<(field: string, operator: string, value: unknown) => Constraint>(),
  query: vi.fn<(collection: { path: string }, ...constraints: Constraint[]) => OwnerQuery>(),
  onSnapshot: vi.fn<(
    ref: unknown,
    next: (snapshot: HistorySnapshot) => void,
    error?: (error: Error) => void,
  ) => () => void>(),
  serverTimestamp: vi.fn<() => { operation: string }>(),
  updateDoc: vi.fn<(ref: unknown, patch: unknown) => Promise<void>>(),
  unsubscribe: vi.fn<() => void>(),
}));

vi.mock('../firebase', () => ({ db: {}, assertFirebaseConfigured: mocks.assertFirebaseConfigured }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  collection: mocks.collection,
  doc: mocks.doc,
  addDoc: mocks.addDoc,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  limit: mocks.limit,
  orderBy: mocks.orderBy,
  where: mocks.where,
  query: mocks.query,
  onSnapshot: mocks.onSnapshot,
  serverTimestamp: mocks.serverTimestamp,
  updateDoc: mocks.updateDoc,
}));

function input(): ActivityInput {
  return {
    userId: 'owner', type: 'run', startTime: 1000, endTime: 1_801_000,
    durationSec: 1800, distanceKm: 5, avgPaceSecPerKm: 360, caloriesEstimate: 362.6,
    route: [
      { lat: 10, lng: 20, timestamp: 1000, speed: 2.5 },
      { lat: 10.01, lng: 20.01, timestamp: 3000 },
    ],
  };
}

function snapshot(id: string, data: unknown, exists = true): ActivitySnapshot {
  return { id, exists: () => exists, data: () => data };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.collection.mockImplementation((_db, path) => ({ path }));
  mocks.doc.mockImplementation((_db, path, id) => ({ path, id }));
  mocks.limit.mockImplementation((count) => ({ kind: 'limit', args: [count] }));
  mocks.orderBy.mockImplementation((field, direction) => ({ kind: 'orderBy', args: [field, direction] }));
  mocks.where.mockImplementation((field, operator, value) => ({ kind: 'where', args: [field, operator, value] }));
  mocks.query.mockImplementation((collection, ...constraints) => ({ collection, constraints }));
  mocks.serverTimestamp.mockReturnValue({ operation: 'serverTimestamp' });
  mocks.onSnapshot.mockReturnValue(mocks.unsubscribe);
  mocks.addDoc.mockResolvedValue({ id: 'saved-id' });
  mocks.updateDoc.mockResolvedValue(undefined);
  mocks.getDocs.mockResolvedValue({ docs: [] });
});

describe('saveActivity', () => {
  it('writes exact spec fields, converts only boundary timestamps, and returns the ID', async () => {
    const activity = input();
    await expect(saveActivity(activity)).resolves.toBe('saved-id');
    expect(mocks.assertFirebaseConfigured).toHaveBeenCalledOnce();
    expect(mocks.addDoc).toHaveBeenCalledWith({ path: 'activities' }, {
      ...activity,
      startTime: Timestamp.fromMillis(activity.startTime),
      endTime: Timestamp.fromMillis(activity.endTime),
      createdAt: { operation: 'serverTimestamp' },
    });
    const payload = mocks.addDoc.mock.calls[0][1];
    const route = payload.route as ActivityInput['route'];
    expect(route).not.toBe(activity.route);
    expect(route[0]).not.toBe(activity.route[0]);
    expect(route[0].timestamp).toBe(1000);
    expect(route[1]).not.toHaveProperty('speed');
    expect(activity.startTime).toBe(1000);
  });

  it('never spreads untyped extra activity/point fields or undefined values into Firestore', async () => {
    const activity = {
      ...input(), id: 'injected', aiSummary: 'injected', unexpected: true,
      route: [{ lat: 10, lng: 20, timestamp: 1000, speed: undefined, accuracy: 8 }],
    };
    await saveActivity(activity);
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('aiSummary');
    expect(payload).not.toHaveProperty('unexpected');
    expect(payload.route).toEqual([{ lat: 10, lng: 20, timestamp: 1000 }]);
  });

  it.each([
    { distanceKm: Number.NaN }, { durationSec: -1 }, { endTime: 0 },
    { startTime: Number.POSITIVE_INFINITY }, { type: 'swim' },
    { route: [{ lat: 91, lng: 20, timestamp: 1000 }] },
    { route: [{ lat: 10, lng: 20, timestamp: '1000' }] },
  ])('rejects invalid inputs before persistence: %j', async (patch) => {
    await expect(saveActivity({ ...input(), ...patch } as unknown as ActivityInput)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('propagates persistence failures instead of producing a fake ID', async () => {
    const failure = new Error('permission-denied');
    mocks.addDoc.mockRejectedValue(failure);
    await expect(saveActivity({ ...input(), userId: 'dev-user' })).rejects.toBe(failure);
  });
});

describe('owner history queries', () => {
  it('matches the checked-in composite index, uses n+1, and excludes the current activity', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [
      snapshot('current', input()), snapshot('previous-1', input()), snapshot('previous-2', input()),
    ] });
    const activities = await fetchRecentActivities('owner', 2, 'current');
    expect(activities.map((activity) => activity.id)).toEqual(['previous-1', 'previous-2']);
    expect(mocks.getDocs).toHaveBeenCalledWith({
      collection: { path: 'activities' },
      constraints: [
        { kind: 'where', args: ['userId', '==', 'owner'] },
        { kind: 'orderBy', args: ['startTime', 'desc'] },
        { kind: 'limit', args: [3] },
      ],
    });
    expect(indexes.indexes).toContainEqual({
      collectionGroup: 'activities', queryScope: 'COLLECTION',
      fields: [{ fieldPath: 'userId', order: 'ASCENDING' }, { fieldPath: 'startTime', order: 'DESCENDING' }],
    });
  });

  it('defaults to five results and still caps results when no exclusion is supplied', async () => {
    mocks.getDocs.mockResolvedValue({ docs: Array.from({ length: 6 }, (_, i) => snapshot(`id-${i}`, input())) });
    const activities = await fetchRecentActivities('owner');
    expect(mocks.limit).toHaveBeenCalledWith(6);
    expect(activities).toHaveLength(5);
    expect(activities[0].startTime).toBe(1000);
  });

  it('returns fewer results for short history and supports zero requested results', async () => {
    mocks.getDocs.mockResolvedValue({ docs: [snapshot('only', input())] });
    expect(await fetchRecentActivities('owner', 3)).toHaveLength(1);
    expect(await fetchRecentActivities('owner', 0)).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'rejects invalid requested counts: %s', async (count) => {
      await expect(fetchRecentActivities('owner', count)).rejects.toBeInstanceOf(TypeError);
      expect(mocks.getDocs).not.toHaveBeenCalled();
    },
  );

  it('propagates backend/index errors', async () => {
    const failure = new Error('failed-precondition: index required');
    mocks.getDocs.mockRejectedValue(failure);
    await expect(fetchRecentActivities('owner')).rejects.toBe(failure);
  });
});

describe('getActivity normalization', () => {
  it('materializes the document ID and converts Timestamp fields to epoch milliseconds', async () => {
    mocks.getDoc.mockResolvedValue(snapshot('real-id', {
      ...input(), id: 'forged-id', startTime: Timestamp.fromMillis(1000),
      endTime: Timestamp.fromMillis(1_801_000), createdAt: Timestamp.fromMillis(2_000_000),
      aiSummary: 'Great work!',
    }));
    expect(await getActivity('real-id')).toEqual({
      ...input(), id: 'real-id', createdAt: 2_000_000, aiSummary: 'Great work!',
    });
  });

  it('strictly normalizes scalars and copies only valid route points', async () => {
    const toMillis = vi.fn<() => number>();
    const route: unknown[] = [
      { lat: 10, lng: 20, timestamp: 1000, speed: 0, ignored: true },
      { lat: 11, lng: 21, timestamp: 2000, speed: -1 },
      { lat: 12, lng: 22, timestamp: 3000, speed: 'fast' },
      { lat: 91, lng: 20, timestamp: 1000 },
      { lat: 10, lng: -181, timestamp: 1000 },
      { lat: '10', lng: 20, timestamp: 1000 },
      { lat: 10, lng: 20, timestamp: Number.NaN }, null,
    ];
    mocks.getDoc.mockResolvedValue(snapshot('real-id', {
      userId: 42, type: 'swim', startTime: '1000', endTime: Number.NaN,
      createdAt: { toMillis }, durationSec: -2, distanceKm: Number.POSITIVE_INFINITY,
      avgPaceSecPerKm: '360', caloriesEstimate: null, aiSummary: { text: 'bad' }, route,
    }));
    const activity = await getActivity('real-id');
    expect(activity).toEqual({
      id: 'real-id', userId: '', type: 'run', startTime: 0, endTime: 0,
      durationSec: 0, distanceKm: 0, avgPaceSecPerKm: 0, caloriesEstimate: 0,
      createdAt: undefined,
      route: [
        { lat: 10, lng: 20, timestamp: 1000, speed: 0 },
        { lat: 11, lng: 21, timestamp: 2000 },
        { lat: 12, lng: 22, timestamp: 3000 },
      ],
    });
    expect(activity?.route).not.toBe(route);
    expect(activity?.route[0]).not.toBe(route[0]);
    expect(activity).not.toHaveProperty('aiSummary');
    expect(toMillis).not.toHaveBeenCalled();
  });

  it.each([null, 'bad activity', [], 42])('handles non-record data: %j', async (data) => {
    mocks.getDoc.mockResolvedValue(snapshot('id', data));
    const activity = await getActivity('id');
    expect(activity?.id).toBe('id');
    expect(activity?.route).toEqual([]);
    expect(activity?.startTime).toBe(0);
  });

  it('returns null when missing and propagates read failures', async () => {
    mocks.getDoc.mockResolvedValueOnce(snapshot('id', undefined, false));
    await expect(getActivity('id')).resolves.toBeNull();
    const failure = new Error('permission-denied');
    mocks.getDoc.mockRejectedValueOnce(failure);
    await expect(getActivity('id')).rejects.toBe(failure);
  });
});

describe('subscribeHistory', () => {
  it('subscribes to 50 owner activities newest-first and returns SDK unsubscribe', () => {
    const callback = vi.fn<(activities: Activity[]) => void>();
    expect(subscribeHistory('owner', callback)).toBe(mocks.unsubscribe);
    expect(mocks.where).toHaveBeenCalledWith('userId', '==', 'owner');
    expect(mocks.orderBy).toHaveBeenCalledWith('startTime', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(50);
    const next = mocks.onSnapshot.mock.calls[0][1];
    next({ docs: [snapshot('newest', { ...input(), startTime: Timestamp.fromMillis(1000) })] });
    expect(callback.mock.calls[0][0][0].startTime).toBe(1000);
    expect(callback.mock.calls[0][0][0].id).toBe('newest');
    next({ docs: [] });
    expect(callback).toHaveBeenLastCalledWith([]);
  });

  it('forwards listener errors and reports synchronous setup failures', () => {
    const onError = vi.fn<(error: Error) => void>();
    subscribeHistory('owner', vi.fn(), onError);
    const failure = new Error('permission-denied');
    mocks.onSnapshot.mock.calls[0][2]?.(failure);
    expect(onError).toHaveBeenCalledWith(failure);

    mocks.onSnapshot.mockImplementation(() => { throw failure; });
    subscribeHistory('owner', vi.fn(), onError);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('reports configuration failure to UI without opening a listener', () => {
    const failure = new Error('runtrack/firebase-not-configured');
    mocks.assertFirebaseConfigured.mockImplementation(() => { throw failure; });
    const onError = vi.fn<(error: Error) => void>();
    const unsubscribe = subscribeHistory('dev-user', vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
    expect(() => subscribeHistory('owner', vi.fn())).toThrow(failure);
  });
});

describe('updateActivity', () => {
  it('only writes aiSummary', async () => {
    await updateActivity('saved-id', { aiSummary: 'Great work!' });
    expect(mocks.updateDoc).toHaveBeenCalledWith({ path: 'activities', id: 'saved-id' }, { aiSummary: 'Great work!' });
  });

  it.each([
    {}, { aiSummary: 42 }, { aiSummary: null }, { distanceKm: 10 },
    { aiSummary: 'text', userId: 'other' }, { aiSummary: 'text', route: [] },
    { aiSummary: 'text', startTime: 1234 }, { aiSummary: 'text', [Symbol('extra')]: true },
    Object.defineProperty({ aiSummary: 'text' }, 'distanceKm', { value: 10 }), null, [],
  ])('rejects arbitrary mutations at runtime: %j', async (patch) => {
    await expect(updateActivity('saved-id', patch as unknown as ActivityPatch)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('propagates backend update failures', async () => {
    const failure = new Error('permission-denied');
    mocks.updateDoc.mockRejectedValue(failure);
    await expect(updateActivity('saved-id', { aiSummary: 'text' })).rejects.toBe(failure);
  });
});

describe('activity configuration/ID guards', () => {
  it('rejects every network operation before Firestore, including synthetic dev saves', async () => {
    const failure = new Error('runtrack/firebase-not-configured');
    mocks.assertFirebaseConfigured.mockImplementation(() => { throw failure; });
    await expect(saveActivity({ ...input(), userId: 'dev-user' })).rejects.toBe(failure);
    await expect(fetchRecentActivities('dev-user')).rejects.toBe(failure);
    await expect(getActivity('id')).rejects.toBe(failure);
    await expect(updateActivity('id', { aiSummary: 'text' })).rejects.toBe(failure);
    expect(mocks.collection).not.toHaveBeenCalled();
    expect(mocks.doc).not.toHaveBeenCalled();
    expect(mocks.addDoc).not.toHaveBeenCalled();
    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'activities/other'])('rejects invalid IDs: %j', async (id) => {
    await expect(getActivity(id)).rejects.toBeInstanceOf(TypeError);
    await expect(fetchRecentActivities(id)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });
});
