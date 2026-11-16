import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';

import type { UserProfile } from '../types';
import {
  ensureUserProfile,
  getUserProfile,
  subscribeUserProfile,
  updateUserProfile,
  type UserProfilePatch,
} from '../users';

interface ProfileSnapshot {
  exists(): boolean;
  data(): unknown;
}

interface ProfileTransaction {
  get(ref: unknown): Promise<ProfileSnapshot>;
  set(ref: unknown, data: Record<string, unknown>): void;
}

const mocks = vi.hoisted(() => ({
  assertFirebaseConfigured: vi.fn<() => void>(),
  doc: vi.fn<(db: unknown, path: string, id: string) => { path: string; id: string }>(),
  getDoc: vi.fn<(ref: unknown) => Promise<ProfileSnapshot>>(),
  onSnapshot: vi.fn<(
    ref: unknown,
    next: (snapshot: ProfileSnapshot) => void,
    error?: (error: Error) => void,
  ) => () => void>(),
  runTransaction: vi.fn<(
    db: unknown,
    callback: (transaction: ProfileTransaction) => Promise<UserProfile>,
  ) => Promise<UserProfile>>(),
  serverTimestamp: vi.fn<() => { operation: string }>(),
  updateDoc: vi.fn<(ref: unknown, patch: unknown) => Promise<void>>(),
  unsubscribe: vi.fn<() => void>(),
}));

// Do not load expo-constants / native persistence or contact a real backend.
vi.mock('../firebase', () => ({ db: {}, assertFirebaseConfigured: mocks.assertFirebaseConfigured }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  onSnapshot: mocks.onSnapshot,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
  updateDoc: mocks.updateDoc,
}));

function snapshot(data: unknown, exists = true): ProfileSnapshot {
  return { exists: () => exists, data: () => data };
}

const transactionGet = vi.fn<(ref: unknown) => Promise<ProfileSnapshot>>();
const transactionSet = vi.fn<(ref: unknown, data: Record<string, unknown>) => void>();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.doc.mockImplementation((_db, path, id) => ({ path, id }));
  mocks.serverTimestamp.mockReturnValue({ operation: 'serverTimestamp' });
  mocks.onSnapshot.mockReturnValue(mocks.unsubscribe);
  mocks.updateDoc.mockResolvedValue(undefined);
  transactionGet.mockResolvedValue(snapshot(undefined, false));
  mocks.runTransaction.mockImplementation(async (_db, callback) => callback({
    get: transactionGet,
    set: transactionSet,
  }));
});

describe('ensureUserProfile', () => {
  it('creates exactly the defaults document in a transaction and returns epoch ms', async () => {
    const before = Date.now();
    const profile = await ensureUserProfile('owner', { name: 'Ari', email: 'ari@example.com' });

    expect(mocks.assertFirebaseConfigured).toHaveBeenCalledOnce();
    expect(transactionGet).toHaveBeenCalledWith({ path: 'users', id: 'owner' });
    expect(transactionSet).toHaveBeenCalledWith({ path: 'users', id: 'owner' }, {
      uid: 'owner',
      name: 'Ari',
      email: 'ari@example.com',
      weightKg: 70,
      createdAt: { operation: 'serverTimestamp' },
      totalDistanceKm: 0,
      totalActivities: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: null,
      badges: [],
    });
    expect(profile).toEqual({
      uid: 'owner', name: 'Ari', email: 'ari@example.com', weightKg: 70,
      createdAt: expect.any(Number), totalDistanceKm: 0, totalActivities: 0,
      currentStreak: 0, longestStreak: 0, lastActivityDate: null, badges: [],
    });
    expect(profile.createdAt).toBeGreaterThanOrEqual(before);
    expect(profile.createdAt).toBeLessThanOrEqual(Date.now());
    expect(mocks.getDoc).not.toHaveBeenCalled();
  });

  it('preserves existing profile fields and totals instead of reapplying fallbacks', async () => {
    const existing = {
      uid: 'owner', name: 'Existing', email: 'existing@example.com', weightKg: 82,
      createdAt: Timestamp.fromMillis(1234), totalDistanceKm: 55.5, totalActivities: 12,
      currentStreak: 4, longestStreak: 7, lastActivityDate: '2026-11-15', badges: ['5k'],
    };
    transactionGet.mockResolvedValue(snapshot(existing));

    expect(await ensureUserProfile('owner', { name: 'Replacement' })).toEqual({
      ...existing, createdAt: 1234,
    });
    expect(transactionSet).not.toHaveBeenCalled();
    expect(mocks.serverTimestamp).not.toHaveBeenCalled();
  });

  it('uses the winning existing profile if Firestore retries a competing creation', async () => {
    transactionGet
      .mockResolvedValueOnce(snapshot(undefined, false))
      .mockResolvedValueOnce(snapshot({ name: 'Winner', totalDistanceKm: 99, totalActivities: 8 }));
    mocks.runTransaction.mockImplementation(async (_db, callback) => {
      const transaction = { get: transactionGet, set: transactionSet };
      await callback(transaction); // Aborted attempt: another client commits first.
      return callback(transaction); // SDK retry reads the winner; no overwrite.
    });

    const profile = await ensureUserProfile('owner', { name: 'Loser' });
    expect(profile.name).toBe('Winner');
    expect(profile.totalDistanceKm).toBe(99);
    expect(profile.totalActivities).toBe(8);
    expect(transactionGet).toHaveBeenCalledTimes(2);
    expect(transactionSet).toHaveBeenCalledOnce();
  });

  it('defaults blank names and missing email', async () => {
    const profile = await ensureUserProfile('owner', { name: '   ' });
    expect(profile.name).toBe('Runner');
    expect(profile.email).toBe('');
  });

  it('propagates transaction failures', async () => {
    const failure = new Error('permission-denied');
    mocks.runTransaction.mockRejectedValue(failure);
    await expect(ensureUserProfile('owner')).rejects.toBe(failure);
  });
});

describe('getUserProfile normalization', () => {
  it('returns null for a missing profile', async () => {
    mocks.getDoc.mockResolvedValue(snapshot(undefined, false));
    await expect(getUserProfile('owner')).resolves.toBeNull();
  });

  it('strictly defaults malformed data, trusts the path UID, and copies valid badges', async () => {
    const badges: unknown[] = ['first', 42, null, '5k'];
    const toMillis = vi.fn<() => number>();
    mocks.getDoc.mockResolvedValue(snapshot({
      uid: 'forged', name: '', email: 17, weightKg: -2, createdAt: { toMillis },
      totalDistanceKm: Number.NaN, totalActivities: 1.5, currentStreak: -3,
      longestStreak: Number.POSITIVE_INFINITY, lastActivityDate: '2026-02-31', badges,
      unexpected: 'discard',
    }));
    const profile = await getUserProfile('owner');

    expect(profile).toEqual({
      uid: 'owner', name: 'Runner', email: '', weightKg: 70, createdAt: undefined,
      totalDistanceKm: 0, totalActivities: 0, currentStreak: 0, longestStreak: 0,
      lastActivityDate: null, badges: ['first', '5k'],
    });
    expect(profile?.badges).not.toBe(badges);
    expect(toMillis).not.toHaveBeenCalled();
  });

  it.each([null, 'bad profile', [], 42])('handles non-record data: %j', async (data) => {
    mocks.getDoc.mockResolvedValue(snapshot(data));
    const profile = await getUserProfile('owner');
    expect(profile?.uid).toBe('owner');
    expect(profile?.weightKg).toBe(70);
    expect(profile?.badges).toEqual([]);
  });

  it('supports epoch-ms reads and valid leap-day dates without coercing strings', async () => {
    mocks.getDoc.mockResolvedValue(snapshot({ createdAt: 9876, lastActivityDate: '2024-02-29', weightKg: 0 }));
    const profile = await getUserProfile('owner');
    expect(profile?.createdAt).toBe(9876);
    expect(profile?.lastActivityDate).toBe('2024-02-29');
    expect(profile?.weightKg).toBe(70);
  });

  it('propagates backend read failures', async () => {
    const failure = new Error('unavailable');
    mocks.getDoc.mockRejectedValue(failure);
    await expect(getUserProfile('owner')).rejects.toBe(failure);
  });
});

describe('subscribeUserProfile', () => {
  it('emits normalized profiles/null and returns the SDK unsubscribe', () => {
    const callback = vi.fn<(profile: UserProfile | null) => void>();
    expect(subscribeUserProfile('owner', callback)).toBe(mocks.unsubscribe);
    const next = mocks.onSnapshot.mock.calls[0][1];
    next(snapshot({ createdAt: Timestamp.fromMillis(3456), name: 'Ari' }));
    expect(callback.mock.calls[0][0]?.createdAt).toBe(3456);
    next(snapshot(undefined, false));
    expect(callback).toHaveBeenLastCalledWith(null);
  });

  it('passes backend errors to the optional listener error callback', () => {
    const onError = vi.fn<(error: Error) => void>();
    subscribeUserProfile('owner', vi.fn(), onError);
    const failure = new Error('permission-denied');
    mocks.onSnapshot.mock.calls[0][2]?.(failure);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('reports configuration failures without starting a listener', () => {
    const failure = Object.assign(new Error('Firebase is not configured'), { code: 'runtrack/firebase-not-configured' });
    mocks.assertFirebaseConfigured.mockImplementation(() => { throw failure; });
    const onError = vi.fn<(error: Error) => void>();
    const unsubscribe = subscribeUserProfile('dev-user', vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
    expect(() => subscribeUserProfile('owner', vi.fn())).toThrow(failure);
  });

  it('reports synchronous listener setup failures', () => {
    const failure = new Error('listener setup failed');
    mocks.onSnapshot.mockImplementation(() => { throw failure; });
    const onError = vi.fn<(error: Error) => void>();
    subscribeUserProfile('owner', vi.fn(), onError);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});

describe('updateUserProfile', () => {
  it('writes only mutable fields and detaches badges', async () => {
    const badges = ['first', '5k'];
    const patch = { name: 'Ari', weightKg: 80, totalActivities: 7, lastActivityDate: '2026-11-15', badges };
    await updateUserProfile('owner', patch);
    expect(mocks.updateDoc).toHaveBeenCalledWith({ path: 'users', id: 'owner' }, patch);
    const payload = mocks.updateDoc.mock.calls[0][1] as UserProfilePatch;
    expect(payload.badges).not.toBe(badges);
  });

  it('treats an empty patch as a no-op', async () => {
    await updateUserProfile('owner', {});
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it.each([
    { uid: 'forged' }, { createdAt: 1000 }, { weightKg: 0 }, { weightKg: Number.NaN },
    { badges: ['valid', 42] }, { currentStreak: 1.5 }, { lastActivityDate: '2026-02-31' },
    { name: 12 }, null, [],
  ])('rejects invalid or immutable fields: %j', async (patch) => {
    await expect(updateUserProfile('owner', patch as unknown as UserProfilePatch)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });
});

describe('profile configuration/ID guards', () => {
  it('rejects every network operation before touching Firestore when unconfigured', async () => {
    const failure = new Error('runtrack/firebase-not-configured');
    mocks.assertFirebaseConfigured.mockImplementation(() => { throw failure; });
    await expect(ensureUserProfile('dev-user')).rejects.toBe(failure);
    await expect(getUserProfile('dev-user')).rejects.toBe(failure);
    await expect(updateUserProfile('dev-user', { weightKg: 80 })).rejects.toBe(failure);
    expect(mocks.doc).not.toHaveBeenCalled();
    expect(mocks.runTransaction).not.toHaveBeenCalled();
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it.each(['', ' ', 'users/other'])('rejects invalid IDs: %j', async (uid) => {
    await expect(getUserProfile(uid)).rejects.toBeInstanceOf(TypeError);
    expect(mocks.getDoc).not.toHaveBeenCalled();
  });
});
