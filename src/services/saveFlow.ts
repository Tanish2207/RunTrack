/**
 * Local-first save flow (#016): every save lands in the SQLite queue first, then
 * attempts Firestore immediately when the network allows. The local write can
 * never be lost to a push failure, and Save never blocks long on the network.
 */
import { saveActivity } from '../api/activities';
import type { ActivityInput, SessionSnapshot } from '../api/types';
import { generateAndAttachSummary } from './aiSummary';
import { insertPending, markFailed, markSynced } from './db';
import { recomputeUserAfterActivity } from './gamification';
import { isInternetLikelyReachable } from './network';
import { useSyncStore } from '../stores/syncStore';

export interface SaveOutcome {
  /** Row key in the local `pending_activities` queue. */
  localId: string;
  /** Non-null only when Firestore accepted the activity during this save. */
  firestoreId: string | null;
}

let localIdCounter = 0;

/** SQLite PK; wall clock + process-local counter + randomness stays unique. */
export function newLocalId(now = Date.now()): string {
  localIdCounter = (localIdCounter + 1) % 0x10000;
  return `local-${now.toString(36)}-${localIdCounter.toString(36).padStart(4, '0')}-` +
    `${Math.random().toString(36).slice(2, 10)}`;
}

/** Detach the persisted payload from the tracking store's finished snapshot. */
export function snapshotToActivityInput(
  userId: string,
  snapshot: SessionSnapshot,
): ActivityInput {
  return {
    userId,
    type: snapshot.activityType,
    startTime: snapshot.startedAt,
    endTime: snapshot.endedAt,
    durationSec: snapshot.durationSec,
    distanceKm: snapshot.distanceKm,
    avgPaceSecPerKm: snapshot.avgPaceSecPerKm,
    caloriesEstimate: snapshot.caloriesEstimate,
    route: snapshot.points.map((point) => ({ ...point })),
  };
}

function bumpPendingCount(delta: 1 | -1): void {
  const { pendingCount, setPendingCount } = useSyncStore.getState();
  setPendingCount(Math.max(0, pendingCount + delta));
}

/** #013 post-save hooks; each failure is isolated and can never fail the save. */
async function runPostSaveHooks(input: ActivityInput, firestoreId: string): Promise<void> {
  try {
    await recomputeUserAfterActivity(input.userId, input, firestoreId);
  } catch {
    // #020/#021 may fail independently of the already-persisted activity.
  }
  try {
    void Promise.resolve(generateAndAttachSummary(firestoreId, input)).catch(() => undefined);
  } catch {
    // Also isolate synchronous throws before the AI hook returns a promise.
  }
}

export async function saveActivityFlow(input: ActivityInput): Promise<SaveOutcome> {
  const localId = newLocalId();
  let queued = false;
  try {
    await insertPending({
      localId,
      userId: input.userId,
      type: input.type,
      startTime: input.startTime,
      endTime: input.endTime,
      distanceKm: input.distanceKm,
      durationSec: input.durationSec,
      avgPaceSecPerKm: input.avgPaceSecPerKm,
      caloriesEstimate: input.caloriesEstimate,
      route: input.route.map((point) => ({ ...point })),
      aiSummary: null,
      createdAt: Date.now(),
    });
    queued = true;
    bumpPendingCount(1);
  } catch {
    // Without the local row (e.g. SQLite unavailable on web), fall back to the
    // #013 direct push so a save can still succeed; failures propagate so the
    // UI retains its snapshot.
  }

  if (!queued) {
    const firestoreId = await saveActivity(input);
    await runPostSaveHooks(input, firestoreId);
    return { localId, firestoreId };
  }

  // The local write is the save contract; a push failure just leaves the row
  // unsynced for the #017 worker and never rejects this promise.
  let firestoreId: string | null = null;
  try {
    if (await isInternetLikelyReachable()) firestoreId = await saveActivity(input);
  } catch {
    firestoreId = null;
  }

  if (firestoreId !== null) {
    try {
      await markSynced(localId, firestoreId);
      bumpPendingCount(-1);
    } catch {
      // Rare: the push landed but the local acknowledgement failed. The row
      // stays unsynced so #017 re-pushes it (accepted duplicate risk).
    }
    await runPostSaveHooks(input, firestoreId);
  } else {
    try {
      await markFailed(localId);
    } catch {
      // The row keeps its defaults and remains retryable.
    }
  }
  return { localId, firestoreId };
}
