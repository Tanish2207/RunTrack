import type { SessionSnapshot } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { useTrackingStore } from '../stores/trackingStore';
import { saveActivityFlow, snapshotToActivityInput, type SaveOutcome } from './saveFlow';

// A logout/replaced review can overlap an older network request. Keep every
// request's guard until it settles, without retaining completed snapshots.
const saving = new WeakMap<SessionSnapshot, Map<string, Promise<SaveOutcome>>>();

/** Save exactly the reviewed snapshot; a failure never clears or replaces it. */
export function savePendingActivity(): Promise<SaveOutcome> {
  const snapshot = useTrackingStore.getState().pendingSummary;
  const userId = useAuthStore.getState().user?.uid;
  if (!snapshot) return Promise.reject(new Error('There is no finished activity to save.'));
  if (!userId) return Promise.reject(new Error('Sign in before saving your activity.'));
  const pending = saving.get(snapshot) ?? new Map<string, Promise<SaveOutcome>>();
  const existing = pending.get(userId);
  if (existing) return existing;

  const request = (async () => {
    const outcome = await saveActivityFlow(snapshotToActivityInput(userId, snapshot));
    // Logout or a replaced session must not clear another user's review.
    if (useAuthStore.getState().user?.uid === userId &&
      useTrackingStore.getState().pendingSummary === snapshot) {
      useTrackingStore.getState().reset();
    }
    return outcome;
  })();
  pending.set(userId, request);
  saving.set(snapshot, pending);
  void request.finally(() => {
    pending.delete(userId);
    if (pending.size === 0) saving.delete(snapshot);
  }).catch(() => undefined);
  return request;
}

/** Called only after confirmation; never writes to a repository. */
export function discardPendingActivity(): boolean {
  const snapshot = useTrackingStore.getState().pendingSummary;
  if (!snapshot || saving.get(snapshot)?.size) return false;
  useTrackingStore.getState().reset();
  return true;
}
