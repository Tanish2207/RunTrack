import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused, useNavigation } from 'expo-router';
import { getActivity } from '../api/activities';
import type { Activity } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';

export type ActivityDetailState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; activity: Readonly<Activity> };

export interface ActivityDetailResult {
  state: ActivityDetailState;
  /** Only the current failed request can be retried; rapid/stale taps are ignored. */
  retry: () => void;
  /** Scope-bound guard for screen actions that can outlive their rendered view. */
  isCurrent: () => boolean;
}

interface ReadScope {
  ownerId: string | undefined;
  activityId: string | null;
  focused: boolean;
}

interface ReadRequest {
  scope: ReadScope;
  id: number;
  pending: boolean;
}

interface StoredRead {
  ownerId: string;
  activityId: string;
  scope: ReadScope;
  requestId: number;
  state: ActivityDetailState;
}

function validActivityId(value: string | string[] | undefined): string | null {
  // Do not pick the first of repeated URL parameters or silently rewrite an ID.
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('/')
    ? value
    : null;
}

function errorCode(failure: unknown): unknown {
  return typeof failure === 'object' && failure !== null && 'code' in failure
    ? failure.code
    : undefined;
}

function isUnavailable(failure: unknown): boolean {
  const code = errorCode(failure);
  return code === 'permission-denied' || code === 'firestore/permission-denied' ||
    code === 'not-found' || code === 'firestore/not-found';
}

function failureMessage(failure: unknown): string {
  return errorCode(failure) === 'runtrack/firebase-not-configured'
    ? 'Activity storage is not available yet. Try again after setup is complete.'
    : 'Your saved activity could not be loaded. Check your connection and try again.';
}

/** Read-only saved detail: each owner/ID/focus lifetime gets its own request scope. */
export function useActivityDetail(activityIdParam: string | string[] | undefined): ActivityDetailResult {
  const ownerId = useAuthStore((state) => state.user?.uid);
  const focused = useIsFocused();
  const navigation = useNavigation();
  const activityId = validActivityId(activityIdParam);
  const [stored, setStored] = useState<StoredRead | null>(null);
  const mounted = useRef(false);
  // Object identity is the focus/owner/ID generation, including A -> B -> A.
  const scope = useMemo<ReadScope>(() => ({ ownerId, activityId, focused }), [ownerId, activityId, focused]);
  const scopeRef = useRef(scope);
  const requestRef = useRef<ReadRequest | null>(null);
  const requestSequence = useRef(0);

  // Invalidate during render, not only effect cleanup: old promises/handlers must
  // already be inert in the render-to-cleanup window. Only input guard keys are
  // published here; rendered data comes exclusively from the keyed state below.
  // eslint-disable-next-line react-hooks/refs -- Immediate privacy/lifecycle invalidation, never a render data source.
  scopeRef.current = scope;

  const isScopeCurrent = useCallback((target: ReadScope): boolean => (
    mounted.current && scopeRef.current === target && target.focused && navigation.isFocused() &&
    useAuthStore.getState().user?.uid === target.ownerId
  ), [navigation]);

  const load = useCallback(async (target: ReadScope): Promise<void> => {
    if (!target.ownerId || !target.activityId || !isScopeCurrent(target) ||
      (requestRef.current?.scope === target && requestRef.current.pending)) return;

    const request: ReadRequest = { scope: target, id: ++requestSequence.current, pending: true };
    requestRef.current = request;
    const key = {
      ownerId: target.ownerId, activityId: target.activityId,
      scope: target, requestId: request.id,
    };
    const isCurrentRequest = () => isScopeCurrent(target) && requestRef.current === request;
    setStored({ ...key, state: { status: 'loading' } });

    try {
      const activity = await getActivity(target.activityId);
      if (!isCurrentRequest()) return;
      request.pending = false;
      setStored({
        ...key,
        state: activity && activity.userId === target.ownerId && activity.id === target.activityId
          ? { status: 'ready', activity }
          : { status: 'not-found' },
      });
    } catch (failure) {
      if (!isCurrentRequest()) return;
      request.pending = false;
      if (isUnavailable(failure)) {
        setStored({ ...key, state: { status: 'not-found' } });
        return;
      }
      setStored({ ...key, state: { status: 'error', message: failureMessage(failure) } });
      if (isCurrentRequest()) {
        useUiStore.getState().showToast('Could not load activity. Please try again.', 'error');
      }
    }
  }, [isScopeCurrent]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestRef.current = null; };
  }, []);

  useFocusEffect(useCallback(() => {
    void load(scope);
    return () => {
      // Blur invalidates pending reads even before useIsFocused rerenders. A
      // rapid blur/refocus starts a fresh request rather than reviving this one.
      if (requestRef.current?.scope === scope) requestRef.current = null;
    };
  }, [load, scope]));

  const liveOwnerId = useAuthStore.getState().user?.uid;
  const currentRead = stored && stored.ownerId === ownerId && stored.activityId === activityId &&
    stored.scope === scope
    ? stored
    : null;
  // Never expose an old activity (including header data) while waiting for effects.
  const state: ActivityDetailState = !activityId
    ? { status: 'not-found' }
    : !liveOwnerId
      ? { status: 'signed-out' }
      : !focused || !navigation.isFocused() || ownerId !== liveOwnerId
        ? { status: 'loading' }
        : currentRead?.state ?? { status: 'loading' };
  const isCurrent = useCallback(() => isScopeCurrent(scope), [isScopeCurrent, scope]);
  const retryRequestId = state.status === 'error' ? currentRead?.requestId : undefined;
  const retry = useCallback(() => {
    if (retryRequestId === undefined || !isCurrent() ||
      requestRef.current?.id !== retryRequestId || requestRef.current.pending) return;
    void load(scope);
  }, [isCurrent, load, retryRequestId, scope]);

  return { state, retry, isCurrent };
}
