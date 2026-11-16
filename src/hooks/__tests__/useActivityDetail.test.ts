import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, AuthUser } from '../../api/types';
import type { ToastType } from '../../stores/uiStore';
import { useActivityDetail, type ActivityDetailResult } from '../useActivityDetail';

type EffectCallback = () => void | (() => void);
type ActivityIdParam = string | string[] | undefined;

/**
 * Controlled hook orchestration, not a renderer. Reads, renders, and effect
 * cleanup are advanced separately so render-to-cleanup races are observable.
 * React scheduling, actual store subscriptions, and native/Router behavior are
 * intentionally not claimed by these unit tests.
 */
const hooks = vi.hoisted(() => {
  const states: { value: unknown; set: (update: unknown) => void }[] = [];
  const refs: { current: unknown }[] = [];
  const memos: { value: unknown; deps: readonly unknown[] }[] = [];
  const effects: {
    run: EffectCallback;
    deps: readonly unknown[] | undefined;
    cleanup: (() => void) | undefined;
    pending: boolean;
    focusOnly: boolean;
  }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let memoIndex = 0;
  let effectIndex = 0;
  let mounted = false;
  let updates = 0;
  let updatesAfterUnmount = 0;

  function changed(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) {
    return !previous || !next || previous.length !== next.length ||
      next.some((value, index) => !Object.is(value, previous[index]));
  }

  function useState<T>(initial: T | (() => T)): [T, (update: T | ((previous: T) => T)) => void] {
    const index = stateIndex++;
    if (!(index in states)) {
      states[index] = {
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
        set: (update) => {
          if (!mounted) { updatesAfterUnmount++; return; }
          updates++;
          states[index].value = typeof update === 'function'
            ? (update as (previous: unknown) => unknown)(states[index].value)
            : update;
        },
      };
    }
    return [states[index].value as T, states[index].set];
  }

  function useRef<T>(initial: T): { current: T } {
    const index = refIndex++;
    if (!(index in refs)) refs[index] = { current: initial };
    return refs[index] as { current: T };
  }

  function memoValue<T>(build: () => T, deps: readonly unknown[]): T {
    const index = memoIndex++;
    if (!memos[index] || changed(memos[index].deps, deps)) memos[index] = { value: build(), deps };
    return memos[index].value as T;
  }

  function useCallback<T>(callback: T, deps: readonly unknown[]): T {
    return memoValue(() => callback, deps);
  }

  function registerEffect(run: EffectCallback, deps?: readonly unknown[], focusOnly = false): void {
    const index = effectIndex++;
    const previous = effects[index];
    if (!previous || changed(previous.deps, deps)) {
      effects[index] = { run, deps, cleanup: previous?.cleanup, pending: true, focusOnly };
    }
  }

  function unmount(): void {
    mounted = false;
    for (const effect of effects) {
      effect.cleanup?.();
      effect.cleanup = undefined;
    }
  }

  return {
    useState, useRef, useMemo: memoValue, useCallback, useEffect: registerEffect, unmount,
    useFocusEffect: (run: EffectCallback) => registerEffect(run, [run], true),
    beginRender: () => { mounted = true; stateIndex = 0; refIndex = 0; memoIndex = 0; effectIndex = 0; },
    commit: () => {
      for (const effect of effects) {
        if (!effect.pending) continue;
        effect.cleanup?.();
        const cleanup = !effect.focusOnly || mocks.navigation.isFocused() ? effect.run() : undefined;
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        effect.pending = false;
      }
    },
    blur: () => {
      for (const effect of effects) {
        if (!effect.focusOnly) continue;
        effect.cleanup?.();
        effect.cleanup = undefined;
      }
    },
    refocus: () => {
      for (const effect of effects) {
        if (!effect.focusOnly) continue;
        effect.cleanup?.();
        const cleanup = effect.run();
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
    },
    reset: () => {
      unmount();
      states.length = 0;
      refs.length = 0;
      memos.length = 0;
      effects.length = 0;
      updates = 0;
      updatesAfterUnmount = 0;
    },
    get updates() { return updates; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
  };
});

const mocks = vi.hoisted(() => ({
  focused: true,
  navigation: { focused: true, isFocused() { return this.focused; } },
  auth: { user: null as AuthUser | null },
  getActivity: vi.fn<(id: string) => Promise<Activity | null>>(),
  showToast: vi.fn<(message: string, type?: ToastType) => void>(),
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: hooks.useState,
  useRef: hooks.useRef,
  useMemo: hooks.useMemo,
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
}));
vi.mock('expo-router', () => ({
  useIsFocused: () => mocks.focused,
  useNavigation: () => mocks.navigation,
  useFocusEffect: hooks.useFocusEffect,
}));
vi.mock('../../api/activities', () => ({ getActivity: mocks.getActivity }));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    <T,>(select: (state: { user: AuthUser | null }) => T) => select(mocks.auth),
    { getState: () => mocks.auth },
  ),
}));
vi.mock('../../stores/uiStore', () => ({
  useUiStore: { getState: () => ({ showToast: mocks.showToast }) },
}));

function activity(id = 'saved-id', userId = 'owner'): Activity {
  return {
    id, userId, type: 'run', startTime: 1000, endTime: 4_001_000,
    distanceKm: 5.126, durationSec: 3725, avgPaceSecPerKm: 342, caloriesEstimate: 362.6,
    route: [{ lat: 10, lng: 20, timestamp: 1000 }, { lat: 11, lng: 21, timestamp: 3000 }],
    aiSummary: 'The exact saved recap.',
  };
}

const settleReads: (() => void)[] = [];
function pendingRead() {
  let resolve!: (value: Activity | null) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<Activity | null>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  settleReads.push(() => resolve(null));
  mocks.getActivity.mockReturnValueOnce(promise);
  return { resolve, reject };
}

async function flushRead(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface MountedDetail {
  result: ActivityDetailResult;
  render: (options?: { activityId?: ActivityIdParam; commit?: boolean }) => void;
  commit: () => void;
  unmount: () => void;
}

let mountedDetail: MountedDetail | undefined;
function DetailHookHarness(activityId: ActivityIdParam): ActivityDetailResult {
  return useActivityDetail(activityId);
}

function mountDetail(...ids: [] | [ActivityIdParam]): MountedDetail {
  let id = ids.length === 0 ? 'saved-id' : ids[0];
  let active = true;
  hooks.beginRender();
  const initial = DetailHookHarness(id);
  hooks.commit();
  const detail: MountedDetail = {
    result: initial,
    render: (options = {}) => {
      if (!active) throw new Error('Cannot render an unmounted detail.');
      if ('activityId' in options) id = options.activityId;
      hooks.beginRender();
      detail.result = DetailHookHarness(id);
      if (options.commit !== false) hooks.commit();
    },
    commit: hooks.commit,
    unmount: () => { if (active) hooks.unmount(); active = false; },
  };
  mountedDetail = detail;
  return detail;
}

async function loadedDetail(source = activity()): Promise<MountedDetail> {
  mocks.getActivity.mockResolvedValueOnce(source);
  const detail = mountDetail(source.id);
  await flushRead();
  detail.render();
  expect(detail.result.state).toEqual({ status: 'ready', activity: source });
  return detail;
}

beforeEach(() => {
  hooks.reset();
  vi.resetAllMocks();
  mountedDetail = undefined;
  settleReads.length = 0;
  mocks.focused = true;
  mocks.navigation.focused = true;
  mocks.auth = { user: { uid: 'owner', email: 'owner@example.com' } };
  mocks.getActivity.mockResolvedValue(activity());
});

afterEach(async () => {
  mountedDetail?.unmount();
  for (const settle of settleReads) settle();
  await flushRead();
  hooks.reset();
  vi.restoreAllMocks();
});

describe('useActivityDetail saved reads', () => {
  it('loads the exact ID once, keeps loading scoped, and returns the unmodified stored activity', async () => {
    const read = pendingRead();
    const source = activity();
    const original = structuredClone(source);
    const detail = mountDetail();
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(mocks.getActivity).toHaveBeenCalledExactlyOnceWith('saved-id');
    const loadingRetry = detail.result.retry;
    loadingRetry();
    detail.render();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
    read.resolve(source);
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'ready', activity: source });
    if (detail.result.state.status !== 'ready') throw new Error('Expected a ready activity.');
    expect(detail.result.state.activity).toBe(source);
    expect(source).toEqual(original);
    expect(detail.result.isCurrent()).toBe(true);
    detail.result.retry();
    loadingRetry();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  const invalidIds: ActivityIdParam[] = [undefined, [], ['saved-id'], ['one', 'two'], '', ' \t ', 'folder/id', '/id', 'id/'];
  it.each(invalidIds.map((id) => ({ id })))('never queries a missing/ambiguous/invalid URL ID: $id', async ({ id }) => {
    const detail = mountDetail(id);
    expect(detail.result.state).toEqual({ status: 'not-found' });
    detail.render();
    await flushRead();
    expect(mocks.getActivity).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('does not read while signed out, and waits for the new owner effect after sign-in', async () => {
    mocks.auth.user = null;
    const detail = mountDetail();
    expect(detail.result.state).toEqual({ status: 'signed-out' });
    expect(mocks.getActivity).not.toHaveBeenCalled();
    mocks.auth.user = { uid: 'owner', email: null };
    detail.render({ commit: false });
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(mocks.getActivity).not.toHaveBeenCalled();
    detail.commit();
    await flushRead();
    detail.render();
    expect(detail.result.state.status).toBe('ready');
    expect(mocks.getActivity).toHaveBeenCalledExactlyOnceWith('saved-id');
  });

  it('does not read an initially blurred detail', async () => {
    mocks.focused = false;
    const detail = mountDetail();
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(detail.result.isCurrent()).toBe(false);
    expect(mocks.getActivity).not.toHaveBeenCalled();
    mocks.focused = true;
    detail.render();
    await flushRead();
    detail.render();
    expect(detail.result.state.status).toBe('ready');
    expect(mocks.getActivity).toHaveBeenCalledOnce();
  });

  it('checks live navigation focus before an initial read even if the focus hook has not rerendered', async () => {
    mocks.navigation.focused = false;
    const detail = mountDetail();
    expect(detail.result.isCurrent()).toBe(false);
    expect(mocks.getActivity).not.toHaveBeenCalled();
    mocks.navigation.focused = true;
    hooks.refocus();
    await flushRead();
    detail.render();
    expect(detail.result.state.status).toBe('ready');
    expect(mocks.getActivity).toHaveBeenCalledExactlyOnceWith('saved-id');
  });

  it.each([
    { name: 'missing document', value: null },
    { name: 'another owner', value: activity('saved-id', 'other-owner') },
    { name: 'a mismatched document ID', value: activity('different-id') },
    { name: 'no stored owner', value: activity('saved-id', '') },
  ])('uses the same non-revealing not-found state for $name', async ({ value }) => {
    mocks.getActivity.mockResolvedValueOnce(value);
    const detail = mountDetail();
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'not-found' });
    detail.result.retry();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it.each(['permission-denied', 'firestore/permission-denied', 'not-found', 'firestore/not-found'])(
    'treats %s as not-found without backend details or an error toast', async (code) => {
      mocks.getActivity.mockRejectedValueOnce(Object.assign(new Error('Private backend details'), { code }));
      const detail = mountDetail();
      await flushRead();
      detail.render();
      expect(detail.result.state).toEqual({ status: 'not-found' });
      expect(mocks.showToast).not.toHaveBeenCalled();
    },
  );
});

describe('useActivityDetail errors and request-keyed retry', () => {
  it.each([
    { failure: new Error('Private network/backend details'), message: 'Your saved activity could not be loaded. Check your connection and try again.' },
    { failure: 'offline', message: 'Your saved activity could not be loaded. Check your connection and try again.' },
    { failure: { code: 'runtrack/firebase-not-configured', message: 'PASTE_PROJECT_ID' }, message: 'Activity storage is not available yet. Try again after setup is complete.' },
  ])('shows safe inline failure and one toast, then retries without duplicate requests', async ({ failure, message }) => {
    const first = pendingRead();
    const detail = mountDetail();
    const loadingRetry = detail.result.retry;
    first.reject(failure);
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'error', message });
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith('Could not load activity. Please try again.', 'error');
    loadingRetry();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
    const retry = detail.result.retry;
    const second = pendingRead();
    retry();
    retry();
    detail.render();
    detail.result.retry();
    retry();
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(mocks.getActivity).toHaveBeenCalledTimes(2);
    second.resolve(activity());
    await flushRead();
    detail.render();
    expect(detail.result.state.status).toBe('ready');
    retry();
    expect(mocks.getActivity).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it('does not let an earlier failure handler retry a newer failure on the same owner/ID', async () => {
    mocks.getActivity.mockRejectedValueOnce(new Error('first failure'));
    const detail = mountDetail();
    await flushRead();
    detail.render();
    const olderRetry = detail.result.retry;
    const read = pendingRead();
    olderRetry();
    read.reject(new Error('second failure'));
    await flushRead();
    detail.render();
    expect(detail.result.state.status).toBe('error');
    olderRetry();
    expect(mocks.getActivity).toHaveBeenCalledTimes(2);
    detail.result.retry();
    await flushRead();
    detail.render();
    expect(mocks.getActivity).toHaveBeenCalledTimes(3);
    expect(detail.result.state.status).toBe('ready');
    expect(mocks.showToast).toHaveBeenCalledTimes(2);
  });
});

describe('useActivityDetail render-time scope invalidation', () => {
  it('masks a ready activity before ID cleanup and keeps old action guards inert', async () => {
    const detail = await loadedDetail();
    const olderGuard = detail.result.isCurrent;
    const olderRetry = detail.result.retry;
    const next = pendingRead();
    detail.render({ activityId: 'next-id', commit: false });
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(olderGuard()).toBe(false);
    olderRetry();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
    detail.commit();
    expect(mocks.getActivity).toHaveBeenLastCalledWith('next-id');
    next.resolve(activity('next-id'));
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'ready', activity: activity('next-id') });
  });

  it('masks owner data immediately, including A -> B -> A before effect cleanup', async () => {
    const detail = await loadedDetail();
    const olderGuard = detail.result.isCurrent;
    mocks.auth.user = { uid: 'new-owner', email: null };
    detail.render({ commit: false });
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(olderGuard()).toBe(false);
    mocks.auth.user = { uid: 'owner', email: null };
    detail.render({ commit: false });
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(olderGuard()).toBe(false);
    detail.commit();
    await flushRead();
    detail.render();
    expect(detail.result.state.status).toBe('ready');
    expect(mocks.getActivity).toHaveBeenCalledTimes(2);
  });

  it('masks a ready activity on logout before cleanup and cannot retry or act on the old account', async () => {
    const detail = await loadedDetail();
    const olderGuard = detail.result.isCurrent;
    mocks.auth.user = null;
    detail.render({ commit: false });
    expect(detail.result.state).toEqual({ status: 'signed-out' });
    expect(olderGuard()).toBe(false);
    detail.result.retry();
    detail.commit();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
  });

  it('masks a ready activity for an invalid replacement ID without querying it', async () => {
    const detail = await loadedDetail();
    detail.render({ activityId: ['saved-id', 'another-id'], commit: false });
    expect(detail.result.state).toEqual({ status: 'not-found' });
    detail.commit();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
  });

  it('refetches on focus to show a newly attached stored recap, never resurrecting the old read', async () => {
    const source = activity();
    const detail = await loadedDetail(source);
    const olderGuard = detail.result.isCurrent;
    mocks.focused = false;
    detail.render({ commit: false });
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(olderGuard()).toBe(false);
    mocks.focused = true;
    detail.render({ commit: false });
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(olderGuard()).toBe(false);
    const refreshed = { ...source, aiSummary: 'Newly attached stored recap.' };
    mocks.getActivity.mockResolvedValueOnce(refreshed);
    detail.commit();
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'ready', activity: refreshed });
    expect(mocks.getActivity).toHaveBeenCalledTimes(2);
  });
});

type Invalidation = 'logout without render' | 'owner change without render' | 'logout before cleanup' |
  'owner change before cleanup' | 'blur before cleanup' | 'blur without render' |
  'blur event without render' | 'ID change before cleanup' | 'unmount';
const invalidations: Invalidation[] = [
  'logout without render', 'owner change without render', 'logout before cleanup',
  'owner change before cleanup', 'blur before cleanup', 'blur without render',
  'blur event without render', 'ID change before cleanup', 'unmount',
];

function invalidate(detail: MountedDetail, change: Invalidation): void {
  if (change.startsWith('logout')) mocks.auth.user = null;
  if (change.startsWith('owner change')) mocks.auth.user = { uid: 'new-owner', email: null };
  if (change.startsWith('blur')) mocks.navigation.focused = false;
  if (change === 'blur before cleanup') mocks.focused = false;
  if (change === 'blur event without render') hooks.blur();
  if (change === 'unmount') detail.unmount();
  else if (change.endsWith('before cleanup')) {
    detail.render({ ...(change === 'ID change before cleanup' ? { activityId: 'next-id' } : {}), commit: false });
  }
}

describe('useActivityDetail late response protection', () => {
  it.each(invalidations)('ignores late success after %s', async (change) => {
    const read = pendingRead();
    const detail = mountDetail();
    const olderGuard = detail.result.isCurrent;
    invalidate(detail, change);
    expect(olderGuard()).toBe(false);
    const updates = hooks.updates;
    read.resolve(activity());
    await flushRead();
    expect(hooks.updates).toBe(updates);
    expect(hooks.updatesAfterUnmount).toBe(0);
    expect(mocks.showToast).not.toHaveBeenCalled();
    if (change !== 'unmount') {
      detail.render({ commit: false });
      expect(detail.result.state).not.toHaveProperty('activity');
    }
  });

  it.each(invalidations)('ignores late rejection/error/toast after %s', async (change) => {
    const read = pendingRead();
    const detail = mountDetail();
    invalidate(detail, change);
    const updates = hooks.updates;
    read.reject(new Error('Old owner private backend failure'));
    await flushRead();
    expect(hooks.updates).toBe(updates);
    expect(hooks.updatesAfterUnmount).toBe(0);
    expect(mocks.showToast).not.toHaveBeenCalled();
    if (change !== 'unmount') {
      detail.render({ commit: false });
      expect(detail.result.state.status).not.toBe('error');
    }
  });

  it.each(['success', 'rejection'])('does not let an older ID %s replace a newer successful read', async (outcome) => {
    const first = pendingRead();
    const detail = mountDetail();
    const second = pendingRead();
    detail.render({ activityId: 'next-id' });
    const latest = activity('next-id');
    second.resolve(latest);
    await flushRead();
    detail.render();
    const updates = hooks.updates;
    if (outcome === 'success') first.resolve(activity());
    else first.reject(new Error('older request error'));
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'ready', activity: latest });
    expect(hooks.updates).toBe(updates);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it.each(['success', 'rejection'])('rejects an earlier focus lifetime %s even for the same owner/ID', async (outcome) => {
    const first = pendingRead();
    const detail = mountDetail();
    mocks.focused = false;
    detail.render();
    const second = pendingRead();
    mocks.focused = true;
    detail.render();
    const refreshed = { ...activity(), aiSummary: 'Newest stored recap.' };
    second.resolve(refreshed);
    await flushRead();
    detail.render();
    const updates = hooks.updates;
    if (outcome === 'success') first.resolve(activity());
    else first.reject(new Error('old focus error'));
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'ready', activity: refreshed });
    expect(hooks.updates).toBe(updates);
    expect(mocks.getActivity).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it.each(['success', 'rejection'])('starts a fresh read after a no-render blur/refocus and ignores the earlier %s', async (outcome) => {
    const first = pendingRead();
    const detail = mountDetail();
    mocks.navigation.focused = false;
    hooks.blur();
    const second = pendingRead();
    mocks.navigation.focused = true;
    hooks.refocus();
    expect(mocks.getActivity).toHaveBeenCalledTimes(2);
    const refreshed = { ...activity(), aiSummary: 'Refreshed after a rapid focus cycle.' };
    second.resolve(refreshed);
    await flushRead();
    detail.render();
    const updates = hooks.updates;
    if (outcome === 'success') first.resolve(activity());
    else first.reject(new Error('Earlier focus failure'));
    await flushRead();
    detail.render();
    expect(detail.result.state).toEqual({ status: 'ready', activity: refreshed });
    expect(hooks.updates).toBe(updates);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('rejects captured Retry on live blur before rerender or focus-effect cleanup', async () => {
    mocks.getActivity.mockRejectedValueOnce(new Error('Read failure'));
    const detail = mountDetail();
    await flushRead();
    detail.render();
    const retry = detail.result.retry;
    mocks.navigation.focused = false;
    retry();
    detail.render({ commit: false });
    expect(detail.result.state).toEqual({ status: 'loading' });
    expect(mocks.getActivity).toHaveBeenCalledOnce();
    hooks.blur();
    retry();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
  });

  it('keeps an earlier retry handler inert after owner/ID/focus invalidation and unmount', async () => {
    mocks.getActivity.mockRejectedValueOnce(new Error('network error'));
    const detail = mountDetail();
    await flushRead();
    detail.render();
    const olderRetry = detail.result.retry;
    mocks.auth.user = { uid: 'new-owner', email: null };
    detail.render({ activityId: 'next-id', commit: false });
    mocks.focused = false;
    detail.render({ commit: false });
    olderRetry();
    detail.unmount();
    olderRetry();
    expect(mocks.getActivity).toHaveBeenCalledOnce();
    expect(hooks.updatesAfterUnmount).toBe(0);
  });
});
