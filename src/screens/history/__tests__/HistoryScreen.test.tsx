import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Activity, AuthUser } from '../../../api/types';
import { SyncBanner } from '../../../components/SyncBanner';
import type { Theme } from '../../../theme';
import HistoryScreen from '../HistoryScreen';

type EffectCallback = () => void | (() => void);
type InspectedElement = ReactElement<Record<string, unknown>>;
interface HistoryListener {
  ownerId: string;
  snapshot: (activities: Activity[]) => void;
  fail: (error: Error) => void;
  unsubscribe: ReturnType<typeof vi.fn<() => void>>;
}

/**
 * Controlled hook/JSX orchestration tests exercising the real useActivityHistory.
 * Effects, focus cleanup, rerenders, and handlers are driven explicitly; this
 * does not model React scheduling, native lists/accessibility, or router transitions.
 */
const hooks = vi.hoisted(() => {
  const states: { value: unknown; set: (update: unknown) => void }[] = [];
  const refs: { current: unknown }[] = [];
  const memos: { value: unknown; deps: readonly unknown[] | undefined }[] = [];
  const effects: {
    run: EffectCallback;
    deps: readonly unknown[];
    cleanup: (() => void) | undefined;
    pending: boolean;
  }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let memoIndex = 0;
  let effectIndex = 0;
  let mounted = false;
  let focused = true;
  let stateUpdates = 0;
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
          stateUpdates++;
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

  function memoValue<T>(create: () => T, deps?: readonly unknown[]): T {
    const index = memoIndex++;
    if (!memos[index] || changed(memos[index].deps, deps)) memos[index] = { value: create(), deps };
    return memos[index].value as T;
  }

  function useCallback<T>(callback: T, deps: readonly unknown[]): T {
    return memoValue(() => callback, deps);
  }

  function useFocusEffect(run: EffectCallback): void {
    const index = effectIndex++;
    const previous = effects[index];
    const deps = [run];
    if (!previous || changed(previous.deps, deps)) {
      effects[index] = { run, deps, cleanup: previous?.cleanup, pending: true };
    }
  }

  function cleanEffects(): void {
    for (const effect of effects) {
      effect.cleanup?.();
      effect.cleanup = undefined;
    }
  }

  function unmount(): void {
    mounted = false;
    cleanEffects();
  }

  return {
    useState, useRef, useMemo: memoValue, useCallback, useFocusEffect, unmount,
    beginRender: () => {
      mounted = true;
      stateIndex = 0; refIndex = 0; memoIndex = 0; effectIndex = 0;
    },
    commit: () => {
      for (const effect of effects) {
        if (!effect.pending) continue;
        effect.cleanup?.();
        const cleanup = focused ? effect.run() : undefined;
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        effect.pending = false;
      }
    },
    blur: () => { focused = false; cleanEffects(); },
    reset: () => {
      unmount();
      states.length = 0; refs.length = 0; memos.length = 0; effects.length = 0;
      focused = true; stateUpdates = 0; updatesAfterUnmount = 0;
    },
    get focused() { return focused; },
    set focused(value: boolean) { focused = value; },
    get stateUpdates() { return stateUpdates; },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
  };
});

const mocks = vi.hoisted(() => ({
  auth: { user: null as AuthUser | null },
  listeners: [] as HistoryListener[],
  immediateError: null as Error | null,
  subscribeHistory: vi.fn<typeof import('../../../api/activities').subscribeHistory>(),
  showToast: vi.fn<(message: string, type?: string) => void>(),
  push: vi.fn<(href: unknown, options?: unknown) => void>(),
  navigate: vi.fn<(href: string) => void>(),
  navigation: { isFocused: () => hooks.focused },
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: hooks.useState,
  useRef: hooks.useRef,
  useMemo: hooks.useMemo,
  useCallback: hooks.useCallback,
}));
vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Text: 'Text', View: 'View' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('expo-router', () => ({
  useIsFocused: () => hooks.focused,
  useFocusEffect: hooks.useFocusEffect,
  useNavigation: () => mocks.navigation,
  useRouter: () => ({ push: mocks.push, navigate: mocks.navigate }),
}));
vi.mock('../../../api/activities', () => ({ subscribeHistory: mocks.subscribeHistory }));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    <T,>(select: (state: { user: AuthUser | null }) => T) => select(mocks.auth),
    { getState: () => mocks.auth },
  ),
}));
vi.mock('../../../stores/uiStore', () => ({ useUiStore: { getState: () => ({ showToast: mocks.showToast }) } }));
vi.mock('../../../components', () => ({ Button: 'Button', EmptyState: 'EmptyState' }));
vi.mock('../../../components/ActivityRow', () => ({ ActivityRow: 'ActivityRow' }));
vi.mock('../../../theme', async () => {
  const { colors, spacing, radius, typography } = await import('../../../theme/tokens');
  const theme = { colors, spacing, radius, typography };
  return {
    theme,
    makeStyles: <T,>(build: (theme: Theme) => T) => {
      const styles = build(theme);
      return () => styles;
    },
  };
});

function activity(id = 'newest', ownerId = 'owner', type: Activity['type'] = 'run'): Activity {
  return {
    id, userId: ownerId, type, startTime: new Date(2026, 10, 10, 7, 2).getTime(),
    endTime: new Date(2026, 10, 10, 8, 4, 5).getTime(),
    durationSec: 3725, distanceKm: 5.126, avgPaceSecPerKm: 342, caloriesEstimate: 362.6,
    route: [{ lat: 10, lng: 20, timestamp: 1000 }], aiSummary: 'Stored recap', createdAt: 1234,
  };
}

function elements(tree: unknown): InspectedElement[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [tree, ...elements(tree.props.children)];
}

function nodes(tree: unknown, type: string): InspectedElement[] {
  return elements(tree).filter((element) => element.type === type);
}

function requiredNode(tree: unknown, type: string, label?: string): InspectedElement {
  const found = nodes(tree, type).find((element) => label === undefined || element.props.label === label);
  if (!found) throw new Error(`Expected a ${type}${label ? ` labelled ${label}` : ''}.`);
  return found;
}

function list(tree: unknown): InspectedElement { return requiredNode(tree, 'FlatList'); }

function listData(tree: unknown): readonly Activity[] {
  return list(tree).props.data as readonly Activity[];
}

function emptyContent(tree: unknown): unknown {
  // Native FlatList uses this prop only when data is empty; children are not rendered here.
  return listData(tree).length === 0 ? list(tree).props.ListEmptyComponent ?? null : null;
}

function row(tree: unknown, source = listData(tree)[0]): InspectedElement {
  const renderItem = list(tree).props.renderItem;
  if (!source || typeof renderItem !== 'function') throw new Error('Expected a row render callback and activity.');
  return requiredNode((renderItem as (info: { item: Activity }) => unknown)({ item: source }), 'ActivityRow');
}

function pressRow(tree: unknown, source = listData(tree)[0]): () => void {
  return row(tree, source).props.onPress as () => void;
}

function pressButton(tree: unknown, label: string): () => void {
  return requiredNode(emptyContent(tree), 'Button', label).props.onPress as () => void;
}

function listener(index = mocks.listeners.length - 1): HistoryListener {
  const current = mocks.listeners[index];
  if (!current) throw new Error('Expected a subscribed History listener.');
  return current;
}

interface MountedHistory {
  tree: ReactElement;
  renders: ReactElement[];
  render: (commit?: boolean) => void;
  unmount: () => void;
}

let mountedHistory: MountedHistory | undefined;
function mountHistory(commit = true): MountedHistory {
  let active = true;
  hooks.beginRender();
  const initial = HistoryScreen();
  const history: MountedHistory = {
    tree: initial,
    renders: [initial],
    render: (commit = true) => {
      if (!active) throw new Error('Cannot rerender an unmounted History.');
      hooks.beginRender();
      history.tree = HistoryScreen();
      history.renders.push(history.tree);
      if (commit) hooks.commit();
    },
    unmount: () => { if (active) hooks.unmount(); active = false; },
  };
  mountedHistory = history;
  if (commit) hooks.commit();
  return history;
}

function expectNoNavigation(): void {
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
}

beforeEach(() => {
  hooks.reset();
  vi.resetAllMocks();
  mountedHistory = undefined;
  mocks.auth = { user: { uid: 'owner', email: 'owner@example.com' } };
  mocks.listeners.length = 0;
  mocks.immediateError = null;
  mocks.subscribeHistory.mockImplementation((ownerId, snapshot, onError) => {
    if (!onError) throw new Error('History must supply an error callback.');
    const captured = { ownerId, snapshot, fail: onError, unsubscribe: vi.fn<() => void>() };
    mocks.listeners.push(captured);
    if (mocks.immediateError) onError(mocks.immediateError);
    return captured.unsubscribe;
  });
});

afterEach(() => {
  mountedHistory?.unmount();
  hooks.reset();
  vi.restoreAllMocks();
});

describe('History list content and navigation', () => {
  it('fills the screen with one vertical list, automatic iOS insets, and a stable banner header', () => {
    const history = mountHistory();
    const root = requiredNode(history.tree, 'SafeAreaView');
    expect(root.props).toMatchObject({ edges: [], collapsable: false, style: { flex: 1 } });
    expect(root.props.children).toBe(list(history.tree));
    expect(nodes(history.tree, 'Screen')).toEqual([]);
    expect(nodes(history.tree, 'FlatList')).toHaveLength(1);
    expect(nodes(history.tree, 'ScrollView')).toEqual([]);
    expect(list(history.tree).props).toMatchObject({ style: { flex: 1 }, contentInsetAdjustmentBehavior: 'automatic' });
    expect(list(history.tree).props.horizontal).not.toBe(true);
    expect(list(history.tree).props.getItemLayout).toBeUndefined();
    expect(list(history.tree).props.contentContainerStyle).toMatchObject({ flexGrow: 1 });
    expect(list(history.tree).props.ListHeaderComponent).toBe(SyncBanner);
    expect(requiredNode(emptyContent(history.tree), 'ActivityIndicator').props).toMatchObject({ size: 'small', accessibilityLabel: 'Loading activities' });
    expect(nodes(emptyContent(history.tree), 'EmptyState')).toEqual([]);
    listener().snapshot([]);
    history.render();
    listener().fail(new Error('offline'));
    history.render();
    expect(history.renders.every((tree) => list(tree).props.ListHeaderComponent === SyncBanner)).toBe(true);
  });

  it('shows a true empty state only after the first snapshot and navigates its action to Track', () => {
    const history = mountHistory();
    expect(nodes(emptyContent(history.tree), 'EmptyState')).toEqual([]);
    listener().snapshot([]);
    history.render();
    const empty = requiredNode(emptyContent(history.tree), 'EmptyState');
    expect(empty.props.title).toBe('No activities yet');
    expect(empty.props.message).toContain('Tap Track');
    expect(nodes(emptyContent(history.tree), 'ActivityIndicator')).toEqual([]);
    pressButton(history.tree, 'Go to Track')();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/(tabs)/track');
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('passes exact stored activities in repository order to rows and uses complete typed detail hrefs', () => {
    const newest = activity('newest', 'owner', 'cycle');
    const older = { ...activity('older', 'owner', 'walk'), startTime: newest.startTime - 86_400_000 };
    const original = structuredClone([newest, older]);
    const history = mountHistory();
    listener().snapshot([newest, older]);
    history.render();
    expect(listData(history.tree)).toEqual([newest, older]);
    expect(row(history.tree, newest).props.activity).toBe(newest);
    expect(row(history.tree, older).props.activity).toBe(older);
    expect(emptyContent(history.tree)).toBeNull();
    const keyExtractor = list(history.tree).props.keyExtractor as (item: Activity) => string;
    expect(keyExtractor(newest)).toBe('newest');
    expect(keyExtractor(older)).toBe('older');
    pressRow(history.tree, older)();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith({
      pathname: '/(tabs)/history/[activityId]', params: { activityId: 'older' },
    }, { withAnchor: true });
    expect([newest, older]).toEqual(original);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('defensively excludes foreign-owner activities without modifying or reordering owned records', () => {
    const first = activity('first');
    const second = activity('second', 'owner', 'walk');
    const foreign = activity('foreign', 'other-owner');
    const history = mountHistory();
    listener().snapshot([first, foreign, second]);
    history.render();
    expect(listData(history.tree)).toEqual([first, second]);
    expect(listData(history.tree)[0]).toBe(first);
    expect(listData(history.tree)[1]).toBe(second);
    const renderItem = list(history.tree).props.renderItem as (info: { item: Activity }) => unknown;
    const foreignRow = requiredNode(renderItem({ item: foreign }), 'ActivityRow');
    (foreignRow.props.onPress as () => void)();
    expectNoNavigation();
  });

  it.each(['removed', 'replaced'] as const)('rejects an old row handler when its item is %s before rerender', (change) => {
    const saved = activity();
    const history = mountHistory();
    listener().snapshot([saved]);
    history.render();
    const oldTap = pressRow(history.tree);
    const replacement = change === 'removed' ? activity('different') : { ...saved, aiSummary: 'New stored recap' };
    listener().snapshot([replacement]);
    oldTap();
    expectNoNavigation();
    history.render();
    pressRow(history.tree)();
    expect(mocks.push).toHaveBeenCalledOnce();
  });
});

describe('History subscription lifecycle', () => {
  it('does not subscribe signed out or show loading/empty feedback for a protected inactive session', () => {
    mocks.auth.user = null;
    const history = mountHistory();
    expect(mocks.subscribeHistory).not.toHaveBeenCalled();
    expect(listData(history.tree)).toEqual([]);
    expect(emptyContent(history.tree)).toBeNull();
    expect(list(history.tree).props.ListHeaderComponent).toBe(SyncBanner);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expectNoNavigation();
  });

  it('subscribes only when focused and does not resubscribe on ordinary renders or same-uid identity updates', () => {
    hooks.focused = false;
    const history = mountHistory();
    expect(mocks.subscribeHistory).not.toHaveBeenCalled();
    expect(emptyContent(history.tree)).toBeNull();
    hooks.focused = true;
    history.render();
    expect(listener().ownerId).toBe('owner');
    history.render();
    mocks.auth.user = { uid: 'owner', email: 'changed@example.com' };
    history.render();
    expect(mocks.subscribeHistory).toHaveBeenCalledOnce();
    expect(listener().unsubscribe).not.toHaveBeenCalled();
  });

  it('cleans up on blur, ignores queued callbacks, and starts fresh on refocus to receive new saves', () => {
    const history = mountHistory();
    const old = listener();
    old.snapshot([activity('old-save')]);
    history.render();
    hooks.blur();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    const updates = hooks.stateUpdates;
    old.snapshot([activity('late-save')]);
    old.fail(new Error('late blur error'));
    expect(hooks.stateUpdates).toBe(updates);
    history.render();
    expect(listData(history.tree)).toEqual([]);
    expect(emptyContent(history.tree)).toBeNull();
    hooks.focused = true;
    history.render();
    expect(mocks.subscribeHistory).toHaveBeenCalledTimes(2);
    expect(listData(history.tree)).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'ActivityIndicator')).toHaveLength(1);
    listener().snapshot([activity('new-save'), activity('old-save')]);
    history.render();
    expect(listData(history.tree).map((item) => item.id)).toEqual(['new-save', 'old-save']);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('masks previous-owner rows in the owner-change render before cleaning up or subscribing again', () => {
    const history = mountHistory();
    const old = listener();
    old.snapshot([activity('private-old-owner')]);
    history.render();
    const oldTap = pressRow(history.tree);
    mocks.auth.user = { uid: 'next-owner', email: null };
    history.render(false);
    expect(old.unsubscribe).not.toHaveBeenCalled();
    expect(mocks.subscribeHistory).toHaveBeenCalledOnce();
    expect(listData(history.tree)).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'EmptyState')).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'ActivityIndicator')).toHaveLength(1);
    const updates = hooks.stateUpdates;
    old.snapshot([activity('late-private-old-owner')]);
    old.fail(new Error('private-old-owner error'));
    oldTap();
    expect(hooks.stateUpdates).toBe(updates);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expectNoNavigation();
    hooks.commit();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(listener().ownerId).toBe('next-owner');
    listener().snapshot([activity('new-owner-save', 'next-owner')]);
    history.render();
    expect(listData(history.tree).map((item) => item.id)).toEqual(['new-owner-save']);
  });

  it.each(['rows', 'error'] as const)('masks %s immediately when focus is lost before passive-effect cleanup', (state) => {
    const history = mountHistory();
    const old = listener();
    if (state === 'rows') old.snapshot([activity('private-row')]);
    else old.fail(new Error('private-error'));
    history.render();
    const toastCount = mocks.showToast.mock.calls.length;
    hooks.focused = false; // Do not deliver the focus cleanup until commit.
    history.render(false);
    expect(old.unsubscribe).not.toHaveBeenCalled();
    expect(listData(history.tree)).toEqual([]);
    expect(emptyContent(history.tree)).toBeNull();
    const updates = hooks.stateUpdates;
    old.snapshot([activity('late-row')]);
    old.fail(new Error('late-error'));
    expect(hooks.stateUpdates).toBe(updates);
    expect(mocks.showToast).toHaveBeenCalledTimes(toastCount);
    hooks.commit();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
  });

  it.each(['owner switch', 'logout'] as const)('does not display old-owner errors or Retry on %s before cleanup', (change) => {
    const history = mountHistory();
    const old = listener();
    old.fail(new Error('private account message'));
    history.render();
    const oldRetry = pressButton(history.tree, 'Retry');
    mocks.auth.user = change === 'logout' ? null : { uid: 'next-owner', email: null };
    history.render(false);
    expect(old.unsubscribe).not.toHaveBeenCalled();
    expect(listData(history.tree)).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'EmptyState')).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'Button')).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'Text').some(({ props }) => props.children === 'private account message')).toBe(false);
    const updates = hooks.stateUpdates;
    oldRetry();
    expect(hooks.stateUpdates).toBe(updates);
    hooks.commit();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.subscribeHistory).toHaveBeenCalledTimes(change === 'logout' ? 1 : 2);
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it('checks live auth again before starting an effect whose rendered owner has already logged out', () => {
    const history = mountHistory(false);
    mocks.auth.user = null;
    hooks.commit();
    expect(mocks.subscribeHistory).not.toHaveBeenCalled();
    history.render();
    expect(emptyContent(history.tree)).toBeNull();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});

describe('History errors, retries, and stale callbacks', () => {
  it('settles synchronous placeholder-config errors, emits one toast per failed listener, and resubscribes on Retry', () => {
    mocks.immediateError = new Error('Firebase is not configured. Replace PASTE_ values.');
    const history = mountHistory();
    history.render();
    expect(nodes(emptyContent(history.tree), 'ActivityIndicator')).toEqual([]);
    expect(requiredNode(emptyContent(history.tree), 'EmptyState').props.title).toBe("Couldn't load activities");
    const errorText = nodes(emptyContent(history.tree), 'Text').find(({ props }) => props.accessibilityRole === 'alert');
    expect(errorText?.props).toMatchObject({ accessibilityLiveRegion: 'polite', children: mocks.immediateError.message });
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith("Couldn't load activities. Try again.", 'error');
    const old = listener();
    old.fail(new Error('duplicate error'));
    old.snapshot([activity('invalid-after-error')]);
    history.render();
    expect(listData(history.tree)).toEqual([]);
    expect(mocks.showToast).toHaveBeenCalledOnce();
    const oldRetry = pressButton(history.tree, 'Retry');
    mocks.immediateError = null;
    oldRetry();
    oldRetry();
    const updates = hooks.stateUpdates;
    old.snapshot([activity('queued-old-snapshot')]);
    old.fail(new Error('queued-old-error'));
    expect(hooks.stateUpdates).toBe(updates);
    history.render(false);
    expect(nodes(emptyContent(history.tree), 'ActivityIndicator')).toHaveLength(1);
    expect(nodes(emptyContent(history.tree), 'Button')).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'Text').some(({ props }) => props.accessibilityRole === 'alert')).toBe(false);
    hooks.commit();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.subscribeHistory).toHaveBeenCalledTimes(2);
    listener().snapshot([activity('retry-save')]);
    history.render();
    oldRetry();
    history.render();
    expect(listData(history.tree).map((item) => item.id)).toEqual(['retry-save']);
    expect(mocks.subscribeHistory).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenCalledOnce();
    expectNoNavigation();
  });

  it('clears rows after a listener error and permits one new toast for a newly failed retry', () => {
    const history = mountHistory();
    listener().snapshot([activity()]);
    history.render();
    listener().fail(new Error('permission-denied'));
    history.render();
    expect(listData(history.tree)).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'ActivityIndicator')).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'Text').some(({ props }) => props.children === 'permission-denied')).toBe(true);
    pressButton(history.tree, 'Retry')();
    history.render();
    listener().fail(new Error('offline'));
    listener().fail(new Error('repeated offline'));
    history.render();
    expect(mocks.showToast).toHaveBeenCalledTimes(2);
    expect(nodes(emptyContent(history.tree), 'Text').some(({ props }) => props.children === 'offline')).toBe(true);
    expect(list(history.tree).props.ListHeaderComponent).toBe(SyncBanner);
  });

  it.each([
    { failure: new Error('unexpected repository throw'), message: 'unexpected repository throw' },
    { failure: 'non-Error failure', message: 'Check your connection and try again.' },
  ])('settles an unexpected thrown subscription failure: $message', ({ failure, message }) => {
    mocks.subscribeHistory.mockImplementationOnce(() => { throw failure; });
    const history = mountHistory();
    history.render();
    expect(nodes(emptyContent(history.tree), 'ActivityIndicator')).toEqual([]);
    expect(nodes(emptyContent(history.tree), 'Text').some(({ props }) => props.children === message)).toBe(true);
    expect(requiredNode(emptyContent(history.tree), 'Button', 'Retry')).toBeDefined();
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it.each(['unmount', 'blur', 'logout', 'new owner'] as const)('ignores late snapshots/errors and captured row taps after %s', (change) => {
    const history = mountHistory();
    const old = listener();
    old.snapshot([activity()]);
    history.render();
    const oldTap = pressRow(history.tree);
    if (change === 'unmount') history.unmount();
    if (change === 'blur') hooks.blur();
    if (change === 'logout') mocks.auth.user = null;
    if (change === 'new owner') mocks.auth.user = { uid: 'next-owner', email: null };
    // For auth changes, deliberately do not rerender before invoking callbacks.
    const updates = hooks.stateUpdates;
    old.snapshot([activity('late-private-save')]);
    old.fail(new Error('late-private-error'));
    oldTap();
    expect(hooks.stateUpdates).toBe(updates);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expectNoNavigation();
    if (change !== 'unmount') {
      history.render();
      expect(listData(history.tree)).toEqual([]);
      expect(nodes(emptyContent(history.tree), 'EmptyState')).toEqual([]);
      expect(old.unsubscribe).toHaveBeenCalledOnce();
    } else {
      expect(old.unsubscribe).toHaveBeenCalledOnce();
      expect(hooks.updatesAfterUnmount).toBe(0);
    }
  });

  it.each(['unmount', 'blur', 'logout', 'new owner'] as const)('rejects captured Retry before rerender after %s', (change) => {
    const history = mountHistory();
    listener().fail(new Error('initial failure'));
    history.render();
    const oldRetry = pressButton(history.tree, 'Retry');
    if (change === 'unmount') history.unmount();
    if (change === 'blur') hooks.blur();
    if (change === 'logout') mocks.auth.user = null;
    if (change === 'new owner') mocks.auth.user = { uid: 'next-owner', email: null };
    const updates = hooks.stateUpdates;
    oldRetry();
    expect(hooks.stateUpdates).toBe(updates);
    expect(mocks.subscribeHistory).toHaveBeenCalledOnce();
    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(hooks.updatesAfterUnmount).toBe(0);
    expectNoNavigation();
  });

  it.each(['logout', 'new owner', 'blur', 'unmount'] as const)('rejects an old empty-state Track action after %s', (change) => {
    const history = mountHistory();
    listener().snapshot([]);
    history.render();
    const oldTrack = pressButton(history.tree, 'Go to Track');
    if (change === 'logout') mocks.auth.user = null;
    if (change === 'new owner') mocks.auth.user = { uid: 'next-owner', email: null };
    if (change === 'blur') hooks.blur();
    if (change === 'unmount') history.unmount();
    oldTrack();
    expectNoNavigation();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });
});
