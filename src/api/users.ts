/** Firestore user profiles. All timestamps stay at this repository boundary. */
import {
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';

import { assertFirebaseConfigured, db } from './firebase';
import type { UserProfile } from './types';

const DEFAULT_NAME = 'Runner';
const DEFAULT_WEIGHT_KG = 70;

export interface UserProfileFallbacks {
  name?: string;
  email?: string;
}

/** Identity and creation time cannot be changed through profile updates. */
export type UserProfilePatch = Partial<Omit<UserProfile, 'uid' | 'createdAt'>>;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function nonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function timestampToMs(value: unknown): number | undefined {
  const millis = value instanceof Timestamp ? value.toMillis() : value;
  return typeof millis === 'number' && Number.isFinite(millis) ? millis : undefined;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const millis = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value;
}

/** Never trust a document's identity, numeric values, or array element types. */
function normalizeUserProfile(uid: string, data: unknown): UserProfile {
  const raw = asRecord(data);
  const weightKg = nonNegativeNumber(raw.weightKg, DEFAULT_WEIGHT_KG);
  return {
    uid,
    name: nonEmptyString(raw.name, DEFAULT_NAME),
    email: typeof raw.email === 'string' ? raw.email : '',
    weightKg: weightKg > 0 ? weightKg : DEFAULT_WEIGHT_KG,
    createdAt: timestampToMs(raw.createdAt),
    totalDistanceKm: nonNegativeNumber(raw.totalDistanceKm),
    totalActivities: nonNegativeInteger(raw.totalActivities),
    currentStreak: nonNegativeInteger(raw.currentStreak),
    longestStreak: nonNegativeInteger(raw.longestStreak),
    lastActivityDate: isCalendarDate(raw.lastActivityDate) ? raw.lastActivityDate : null,
    badges: Array.isArray(raw.badges)
      ? raw.badges.filter((badge: unknown): badge is string => typeof badge === 'string')
      : [],
  };
}

function profileRef(uid: string) {
  if (typeof uid !== 'string' || uid.trim().length === 0 || uid.includes('/')) {
    throw new TypeError('A valid user ID is required.');
  }
  return doc(db, 'users', uid);
}

/**
 * Create defaults only when missing. The transaction retries concurrent
 * creation, preserving the winning profile and all existing totals/badges.
 */
export async function ensureUserProfile(
  uid: string,
  fallbacks?: UserProfileFallbacks,
): Promise<UserProfile> {
  assertFirebaseConfigured();
  const ref = profileRef(uid);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (snapshot.exists()) return normalizeUserProfile(uid, snapshot.data());

    const seed = {
      uid,
      name: nonEmptyString(fallbacks?.name, DEFAULT_NAME),
      email: typeof fallbacks?.email === 'string' ? fallbacks.email : '',
      weightKg: DEFAULT_WEIGHT_KG,
      createdAt: serverTimestamp(),
      totalDistanceKm: 0,
      totalActivities: 0,
      currentStreak: 0,
      longestStreak: 0,
      lastActivityDate: null,
      badges: [],
    };
    transaction.set(ref, seed);
    // Until the server timestamp resolves, callers receive an epoch-ms estimate.
    return normalizeUserProfile(uid, { ...seed, createdAt: Date.now() });
  });
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  assertFirebaseConfigured();
  const snapshot = await getDoc(profileRef(uid));
  return snapshot.exists() ? normalizeUserProfile(uid, snapshot.data()) : null;
}

/** A missing profile emits null; callers may also surface setup/listener errors. */
export function subscribeUserProfile(
  uid: string,
  callback: (profile: UserProfile | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  try {
    assertFirebaseConfigured();
    return onSnapshot(
      profileRef(uid),
      (snapshot) => {
        callback(snapshot.exists() ? normalizeUserProfile(uid, snapshot.data()) : null);
      },
      onError,
    );
  } catch (error) {
    if (!onError) throw error;
    onError(error instanceof Error ? error : new Error(String(error)));
    return () => undefined;
  }
}

function prepareProfilePatch(patch: UserProfilePatch): UserProfilePatch {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new TypeError('Profile updates must be an object of supported fields.');
  }
  const raw = asRecord(patch);
  const result: UserProfilePatch = {};
  for (const key of Reflect.ownKeys(raw)) {
    const value = typeof key === 'string' ? raw[key] : undefined;
    switch (key) {
      case 'name':
      case 'email':
        if (typeof value !== 'string') throw new TypeError(`${key} must be a string.`);
        result[key] = value;
        break;
      case 'weightKg':
      case 'totalDistanceKm':
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
          (key === 'weightKg' && value === 0)) {
          throw new TypeError(`${key} must be a valid non-negative number (weight must be positive).`);
        }
        result[key] = value;
        break;
      case 'totalActivities':
      case 'currentStreak':
      case 'longestStreak':
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
          throw new TypeError(`${key} must be a non-negative integer.`);
        }
        result[key] = value;
        break;
      case 'lastActivityDate':
        if (value !== null && !isCalendarDate(value)) {
          throw new TypeError('lastActivityDate must be a YYYY-MM-DD date or null.');
        }
        result.lastActivityDate = value;
        break;
      case 'badges':
        if (!Array.isArray(value) || !value.every((badge: unknown) => typeof badge === 'string')) {
          throw new TypeError('badges must be an array of strings.');
        }
        result.badges = value.filter((badge: unknown): badge is string => typeof badge === 'string');
        break;
      default:
        throw new TypeError(`Unsupported profile field: ${String(key)}.`);
    }
  }
  return result;
}

export async function updateUserProfile(uid: string, patch: UserProfilePatch): Promise<void> {
  assertFirebaseConfigured();
  const ref = profileRef(uid);
  const payload = prepareProfilePatch(patch);
  if (Object.keys(payload).length === 0) return;
  await updateDoc(ref, payload);
}
