/** Online-first activity repository (#013); SQLite-first persistence is #016. */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';

import { assertFirebaseConfigured, db } from './firebase';
import type { Activity, ActivityInput, ActivityType, RoutePoint } from './types';

export interface ActivityPatch {
  aiSummary: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isActivityType(value: unknown): value is ActivityType {
  return value === 'run' || value === 'cycle' || value === 'walk';
}

function timestampToMs(value: unknown): number | undefined {
  const millis = value instanceof Timestamp ? value.toMillis() : value;
  return isFiniteNumber(millis) ? millis : undefined;
}

function nonNegativeNumber(value: unknown): number {
  return isFiniteNumber(value) && value >= 0 ? value : 0;
}

function normalizeRoutePoint(data: unknown): RoutePoint | null {
  const raw = asRecord(data);
  if (!isFiniteNumber(raw.lat) || raw.lat < -90 || raw.lat > 90 ||
    !isFiniteNumber(raw.lng) || raw.lng < -180 || raw.lng > 180 ||
    !isFiniteNumber(raw.timestamp)) return null;
  const point: RoutePoint = { lat: raw.lat, lng: raw.lng, timestamp: raw.timestamp };
  if (isFiniteNumber(raw.speed) && raw.speed >= 0) point.speed = raw.speed;
  return point;
}

/** Whitelist fields and copy points; malformed remote values never reach UI. */
function normalizeActivity(id: string, data: unknown): Activity {
  const raw = asRecord(data);
  const route = Array.isArray(raw.route)
    ? raw.route.map((point: unknown) => normalizeRoutePoint(point))
      .filter((point): point is RoutePoint => point !== null)
    : [];
  return {
    id,
    userId: typeof raw.userId === 'string' ? raw.userId : '',
    type: isActivityType(raw.type) ? raw.type : 'run',
    startTime: timestampToMs(raw.startTime) ?? 0,
    endTime: timestampToMs(raw.endTime) ?? 0,
    durationSec: nonNegativeNumber(raw.durationSec),
    distanceKm: nonNegativeNumber(raw.distanceKm),
    avgPaceSecPerKm: nonNegativeNumber(raw.avgPaceSecPerKm),
    caloriesEstimate: nonNegativeNumber(raw.caloriesEstimate),
    route,
    ...(typeof raw.aiSummary === 'string' ? { aiSummary: raw.aiSummary } : {}),
    createdAt: timestampToMs(raw.createdAt),
  };
}

function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('/')) {
    throw new TypeError(`A valid ${label} ID is required.`);
  }
}

function prepareActivityInput(input: ActivityInput): ActivityInput {
  assertId(input.userId, 'user');
  if (!isActivityType(input.type)) throw new TypeError('A valid activity type is required.');
  if (!isFiniteNumber(input.startTime) || !isFiniteNumber(input.endTime) ||
    input.endTime < input.startTime) {
    throw new TypeError('Activity start/end times must be epoch milliseconds in order.');
  }
  for (const key of ['durationSec', 'distanceKm', 'avgPaceSecPerKm', 'caloriesEstimate'] as const) {
    if (!isFiniteNumber(input[key]) || input[key] < 0) {
      throw new TypeError(`${key} must be a non-negative finite number.`);
    }
  }
  if (!Array.isArray(input.route)) throw new TypeError('Activity route must be an array.');
  const route = input.route.map((point: unknown) => {
    const normalized = normalizeRoutePoint(point);
    if (!normalized) throw new TypeError('Activity route contains an invalid GPS point.');
    return normalized;
  });
  return {
    userId: input.userId,
    type: input.type,
    startTime: input.startTime,
    endTime: input.endTime,
    durationSec: input.durationSec,
    distanceKm: input.distanceKm,
    avgPaceSecPerKm: input.avgPaceSecPerKm,
    caloriesEstimate: input.caloriesEstimate,
    route,
  };
}

/**
 * About 5,400 points for a 3h run sampled every 2s fits well below Firestore's
 * 1 MiB document limit with this compact point schema; no route chunking yet.
 * The document ID is returned and materialized as Activity.id on reads.
 */
export async function saveActivity(input: ActivityInput): Promise<string> {
  assertFirebaseConfigured();
  const payload = prepareActivityInput(input);
  const ref = await addDoc(collection(db, 'activities'), {
    ...payload,
    startTime: Timestamp.fromMillis(payload.startTime),
    endTime: Timestamp.fromMillis(payload.endTime),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Matches firestore.indexes.json: userId ASC + startTime DESC. */
function ownerHistoryQuery(uid: string, count: number) {
  assertId(uid, 'user');
  return query(
    collection(db, 'activities'),
    where('userId', '==', uid),
    orderBy('startTime', 'desc'),
    limit(count),
  );
}

export async function fetchRecentActivities(
  uid: string,
  n = 5,
  excludeId?: string,
): Promise<Activity[]> {
  assertFirebaseConfigured();
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(n + 1)) {
    throw new TypeError('Recent activity count must be a non-negative integer.');
  }
  const snapshot = await getDocs(ownerHistoryQuery(uid, n + 1));
  return snapshot.docs
    .filter((entry) => entry.id !== excludeId)
    .slice(0, n)
    .map((entry) => normalizeActivity(entry.id, entry.data()));
}

export function subscribeHistory(
  uid: string,
  callback: (activities: Activity[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  try {
    assertFirebaseConfigured();
    return onSnapshot(
      ownerHistoryQuery(uid, 50),
      (snapshot) => {
        callback(snapshot.docs.map((entry) => normalizeActivity(entry.id, entry.data())));
      },
      onError,
    );
  } catch (error) {
    if (!onError) throw error;
    onError(error instanceof Error ? error : new Error(String(error)));
    return () => undefined;
  }
}

export async function getActivity(activityId: string): Promise<Activity | null> {
  assertFirebaseConfigured();
  assertId(activityId, 'activity');
  const snapshot = await getDoc(doc(db, 'activities', activityId));
  return snapshot.exists() ? normalizeActivity(snapshot.id, snapshot.data()) : null;
}

/** History is immutable; even untyped callers may only attach an AI summary. */
export async function updateActivity(activityId: string, patch: ActivityPatch): Promise<void> {
  assertFirebaseConfigured();
  assertId(activityId, 'activity');
  const raw = asRecord(patch);
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== 1 || keys[0] !== 'aiSummary' || typeof raw.aiSummary !== 'string') {
    throw new TypeError('Activity updates may only set aiSummary to a string.');
  }
  await updateDoc(doc(db, 'activities', activityId), { aiSummary: raw.aiSummary });
}
