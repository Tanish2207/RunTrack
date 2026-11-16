import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused, useNavigation } from 'expo-router';

import { subscribeHistory } from '../api/activities';
import type { Activity } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';

type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';
interface FocusKey {
  ownerId: string | null;
  focused: boolean;
  attempt: number;
}
interface SubscriptionScope {
  key: FocusKey;
  generation: number;
  ownerId: string;
  active: boolean;
  failed: boolean;
  activities: readonly Activity[];
}
interface HistorySnapshot {
  key: FocusKey;
  generation: number;
  status: Exclude<HistoryStatus, 'idle'>;
  activities: readonly Activity[];
  error: string | null;
}

const NO_ACTIVITIES: readonly Activity[] = [];

export interface ActivityHistory {
  activities: readonly Activity[];
  status: HistoryStatus;
  error: string | null;
  retry: () => void;
  /** Owner/focus/generation guard for actions captured by an earlier render. */
  isCurrent: () => boolean;
  /** Also rejects foreign, removed, or replaced rows from earlier snapshots. */
  canOpenActivity: (activity: Activity) => boolean;
}

/** Read-only, focused owner history; the repository owns ordering and the limit. */
export function useActivityHistory(): ActivityHistory {
  const ownerId = useAuthStore((state) => state.user?.uid ?? null);
  const focused = useIsFocused();
  const navigation = useNavigation();
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const key = useMemo(() => ({ ownerId, focused, attempt }), [ownerId, focused, attempt]);
  const subscription = useRef<SubscriptionScope | null>(null);
  const sequence = useRef(0);

  const isGenerationCurrent = useCallback((expectedKey: FocusKey, generation: number | null) => {
    const scope = subscription.current;
    return scope !== null && scope.active && scope.key === expectedKey &&
      scope.generation === generation && navigation.isFocused() &&
      useAuthStore.getState().user?.uid === scope.ownerId;
  }, [navigation]);

  useFocusEffect(useCallback(() => {
    if (!key.ownerId || !key.focused || !navigation.isFocused() ||
      useAuthStore.getState().user?.uid !== key.ownerId) return;

    const scope: SubscriptionScope = {
      key, generation: ++sequence.current, ownerId: key.ownerId,
      active: true, failed: false, activities: NO_ACTIVITIES,
    };
    subscription.current = scope;
    const generation = scope.generation;
    setSnapshot({ key, generation, status: 'loading', activities: NO_ACTIVITIES, error: null });

    const fail = (failure: unknown) => {
      if (!isGenerationCurrent(key, generation) || scope.failed) return;
      scope.failed = true;
      scope.activities = NO_ACTIVITIES;
      const message = failure instanceof Error && failure.message.trim()
        ? failure.message
        : 'Check your connection and try again.';
      setSnapshot({ key, generation, status: 'error', activities: NO_ACTIVITIES, error: message });
      if (isGenerationCurrent(key, generation)) {
        useUiStore.getState().showToast("Couldn't load activities. Try again.", 'error');
      }
    };

    let unsubscribe = () => {};
    try {
      // Install the scope/loading state BEFORE subscribing: placeholder Firebase
      // configuration calls onError synchronously, before returning unsubscribe.
      unsubscribe = subscribeHistory(scope.ownerId, (activities) => {
        if (!isGenerationCurrent(key, generation) || scope.failed) return;
        // Defense in depth only; Firestore rules remain the authorization boundary.
        const owned = activities.filter((activity) => activity.userId === scope.ownerId);
        scope.activities = owned;
        setSnapshot({ key, generation, status: 'ready', activities: owned, error: null });
      }, fail);
    } catch (failure) {
      fail(failure);
    }

    return () => {
      scope.active = false;
      if (subscription.current === scope) subscription.current = null;
      unsubscribe();
    };
  }, [key, isGenerationCurrent, navigation]));

  const enabled = Boolean(ownerId && focused && useAuthStore.getState().user?.uid === ownerId);
  // Immutable keys mask old rows/errors in the owner/focus-change render itself,
  // without reading or mutating refs while rendering or waiting for cleanup.
  const current = enabled && snapshot?.key === key ? snapshot : null;
  const generation = current?.generation ?? null;

  const retry = useCallback(() => {
    const scope = subscription.current;
    if (!scope || !isGenerationCurrent(key, generation) || !scope.failed) return;
    // Reject a queued snapshot, a duplicate tap, or an old Retry callback even
    // before React commits the next subscription's effect.
    scope.active = false;
    subscription.current = null;
    setAttempt((previous) => previous + 1);
  }, [key, generation, isGenerationCurrent]);

  const isCurrent = useCallback(() => isGenerationCurrent(key, generation), [key, generation, isGenerationCurrent]);
  const canOpenActivity = useCallback((activity: Activity) => {
    if (!isGenerationCurrent(key, generation)) return false;
    const scope = subscription.current;
    return scope !== null && !scope.failed && activity.userId === scope.ownerId &&
      scope.activities.includes(activity);
  }, [key, generation, isGenerationCurrent]);

  return {
    activities: current?.status === 'ready' ? current.activities : NO_ACTIVITIES,
    status: enabled ? current?.status ?? 'loading' : 'idle',
    error: current?.error ?? null,
    retry,
    isCurrent,
    canOpenActivity,
  };
}
