import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivityType, AuthUser, SessionSnapshot } from '../../../api/types';
import type { TrackingStatus } from '../../../stores/trackingStore';
import type { ToastType } from '../../../stores/uiStore';
import type { SaveOutcome } from '../../../services/saveFlow';
import ActivitySummaryScreen from '../ActivitySummaryScreen';

type Confirmation = Parameters<typeof import('../../../utils/confirm').confirmDestructiveAction>[0];
type TrackingReview = { pendingSummary: SessionSnapshot | null; status: TrackingStatus };
type EffectCallback = () => void | (() => void);
type InspectedElement = ReactElement<Record<string, unknown>>;

/**
 * Orchestration unit tests, not a renderer: commit hook updates and store reads
 * explicitly, inspect JSX, and invoke supplied handlers without rendering children.
 * React scheduling, store subscriptions, native alerts/maps/accessibility, and
 * real Expo navigator transitions are deliberately outside this harness.
 */
const hooks = vi.hoisted(() => {
  const states: { value: unknown; set: (update: unknown) => void }[] = [];
  const refs: { current: unknown }[] = [];
  const effects: {
    run: EffectCallback;
    deps: readonly unknown[] | undefined;
    cleanup: (() => void) | undefined;
    pending: boolean;
  }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effectIndex = 0;
  let mounted = false;
  let updatesAfterUnmount = 0;

  function useState<T>(initial: T | (() => T)): [T, (update: T | ((previous: T) => T)) => void] {
    const index = stateIndex++;
    if (!(index in states)) {
      states[index] = {
        value: typeof initial === 'function' ? (initial as () => T)() : initial,
        set: (update) => {
          if (!mounted) { updatesAfterUnmount++; return; }
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

  function useEffect(run: EffectCallback, deps?: readonly unknown[]): void {
    const index = effectIndex++;
    const previous = effects[index];
    const changed = !previous || !deps || !previous.deps || deps.length !== previous.deps.length ||
      deps.some((value, position) => !Object.is(value, previous.deps?.[position]));
    if (changed) effects[index] = { run, deps, cleanup: previous?.cleanup, pending: true };
  }

  function unmount(): void {
    mounted = false;
    for (const effect of effects) {
      effect.cleanup?.();
      effect.cleanup = undefined;
    }
  }

  return {
    useState, useRef, useEffect, unmount,
    beginRender: () => { mounted = true; stateIndex = 0; refIndex = 0; effectIndex = 0; },
    commit: () => {
      for (const effect of effects) {
        if (!effect.pending) continue;
        effect.cleanup?.();
        const cleanup = effect.run();
        effect.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
        effect.pending = false;
      }
    },
    reset: () => {
      unmount();
      states.length = 0;
      refs.length = 0;
      effects.length = 0;
      updatesAfterUnmount = 0;
    },
    get updatesAfterUnmount() { return updatesAfterUnmount; },
  };
});

const mocks = vi.hoisted(() => ({
  tracking: { pendingSummary: null, status: 'idle' } as TrackingReview,
  auth: { user: null as AuthUser | null },
  savePendingActivity: vi.fn<() => Promise<SaveOutcome>>(),
  discardPendingActivity: vi.fn<() => boolean>(),
  confirmDestructiveAction: vi.fn<(options: Confirmation) => void>(),
  showToast: vi.fn<(message: string, type?: ToastType) => void>(),
  disablePrevention: vi.fn<() => void>(),
  usePreventRemove: vi.fn<(enabled: boolean, onBlocked: () => void) => () => void>(),
  dismissTo: vi.fn<(href: string) => void>(),
  navigate: vi.fn<(href: string) => void>(),
  navigation: [] as string[],
}));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: hooks.useState,
  useRef: hooks.useRef,
  useEffect: hooks.useEffect,
}));
vi.mock('react-native', () => ({ Text: 'Text', View: 'View' }));
vi.mock('expo-router', () => ({
  Redirect: 'Redirect',
  useRouter: () => ({ dismissTo: mocks.dismissTo, navigate: mocks.navigate }),
  usePreventRemove: mocks.usePreventRemove,
}));
vi.mock('../../../components', () => ({
  ACTIVITY_LABELS: { run: 'Run', cycle: 'Cycle', walk: 'Walk' },
  AiSummaryCard: 'AiSummaryCard', Button: 'Button', Card: 'Card',
  RouteMap: 'RouteMap', Screen: 'Screen', StatTile: 'StatTile',
}));
vi.mock('../../../theme', () => ({ makeStyles: () => () => ({}) }));
vi.mock('../../../services/activityReview', () => ({
  savePendingActivity: mocks.savePendingActivity,
  discardPendingActivity: mocks.discardPendingActivity,
}));
vi.mock('../../../utils/confirm', () => ({ confirmDestructiveAction: mocks.confirmDestructiveAction }));
vi.mock('../../../stores/trackingStore', () => ({
  useTrackingStore: Object.assign(
    <T,>(select: (state: TrackingReview) => T) => select(mocks.tracking),
    { getState: () => mocks.tracking },
  ),
}));
vi.mock('../../../stores/authStore', () => ({
  useAuthStore: Object.assign(
    <T,>(select: (state: { user: AuthUser | null }) => T) => select(mocks.auth),
    { getState: () => mocks.auth },
  ),
}));
vi.mock('../../../stores/uiStore', () => ({
  useUiStore: { getState: () => ({ showToast: mocks.showToast }) },
}));

function snapshot(activityType: ActivityType = 'run'): SessionSnapshot {
  const points = [
    { lat: 10, lng: 20, timestamp: 1000, speed: 2.5 },
    { lat: 10.01, lng: 20.01, timestamp: 3000 },
    { lat: 11, lng: 21, timestamp: 120_000, speed: 0 },
    { lat: 11.01, lng: 21.01, timestamp: 122_000 },
  ];
  return {
    activityType, startedAt: 1000, endedAt: 4_001_000, durationSec: 3725,
    distanceKm: 5.126, avgPaceSecPerKm: 342, caloriesEstimate: 362.6,
    points, segments: [points.slice(0, 2), points.slice(2)],
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

function textContent(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (Array.isArray(tree)) return tree.map(textContent).join('');
  return isValidElement<Record<string, unknown>>(tree) ? textContent(tree.props.children) : '';
}

function requiredNode(tree: unknown, type: string, label?: string): InspectedElement {
  const found = nodes(tree, type).find((element) => label === undefined || element.props.label === label);
  if (!found) throw new Error(`Expected a ${type}${label ? ` labelled ${label}` : ''}.`);
  return found;
}

function onPress(tree: unknown, label: string): () => void {
  const handler = requiredNode(tree, 'Button', label).props.onPress;
  if (typeof handler !== 'function') throw new Error(`Expected ${label} to supply an onPress handler.`);
  // Deliberately bypass child Button gating to exercise the screen's own locks.
  return handler as () => void;
}

function confirmation(): Confirmation {
  const call = mocks.confirmDestructiveAction.mock.calls.at(-1);
  if (!call) throw new Error('Expected a captured confirmation dialog.');
  return call[0];
}

const settleSaves: (() => void)[] = [];
function pendingSave() {
  let resolve!: (outcome: SaveOutcome) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<SaveOutcome>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  settleSaves.push(() => resolve({ localId: 'cleanup-local', firestoreId: 'cleanup-id' }));
  mocks.savePendingActivity.mockReturnValueOnce(promise);
  return { promise, resolve, reject };
}

async function flushSave(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface MountedReview {
  tree: ReactElement;
  renders: ReactElement[];
  render: () => void;
  unmount: () => void;
}

let mountedReview: MountedReview | undefined;
function mountReview(): MountedReview {
  let active = true;
  hooks.beginRender();
  const initial = ActivitySummaryScreen();
  hooks.commit();
  const review: MountedReview = {
    tree: initial,
    renders: [initial],
    render: () => {
      if (!active) throw new Error('Cannot rerender an unmounted review.');
      hooks.beginRender();
      review.tree = ActivitySummaryScreen();
      review.renders.push(review.tree);
      hooks.commit();
    },
    unmount: () => { if (active) hooks.unmount(); active = false; },
  };
  mountedReview = review;
  return review;
}

function expectNoNavigation(): void {
  expect(mocks.disablePrevention).not.toHaveBeenCalled();
  expect(mocks.dismissTo).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
}

function expectNoRedirects(review: MountedReview): void {
  expect(review.renders.flatMap((tree) => nodes(tree, 'Redirect'))).toEqual([]);
}

type StaleChange = 'unmount' | 'logout' | 'new user' | 'equal replacement' | 'different replacement';
const staleChanges: StaleChange[] = ['unmount', 'logout', 'new user', 'equal replacement', 'different replacement'];

function invalidateReview(review: MountedReview, change: StaleChange, source: SessionSnapshot): void {
  if (change === 'unmount') review.unmount();
  if (change === 'logout') mocks.auth.user = null;
  if (change === 'new user') mocks.auth.user = { uid: 'other-owner', email: null };
  if (change === 'equal replacement') mocks.tracking.pendingSummary = structuredClone(source);
  if (change === 'different replacement') mocks.tracking.pendingSummary = snapshot('cycle');
}

beforeEach(() => {
  hooks.reset();
  vi.resetAllMocks();
  mountedReview = undefined;
  settleSaves.length = 0;
  mocks.navigation.length = 0;
  mocks.tracking = { pendingSummary: snapshot(), status: 'idle' };
  mocks.auth = { user: { uid: 'owner', email: 'owner@example.com' } };
  mocks.savePendingActivity.mockImplementation(async () => {
    mocks.tracking.pendingSummary = null;
    return { localId: 'local-1', firestoreId: 'saved-id' };
  });
  mocks.discardPendingActivity.mockImplementation(() => {
    mocks.tracking.pendingSummary = null;
    return true;
  });
  mocks.usePreventRemove.mockReturnValue(mocks.disablePrevention);
  mocks.disablePrevention.mockImplementation(() => { mocks.navigation.push('disable-prevention'); });
  mocks.dismissTo.mockImplementation((href) => { mocks.navigation.push(`dismissTo:${href}`); });
  mocks.navigate.mockImplementation((href) => { mocks.navigation.push(`navigate:${href}`); });
});

afterEach(async () => {
  for (const settle of settleSaves) settle();
  await flushSave();
  mountedReview?.unmount();
  hooks.reset();
  vi.restoreAllMocks();
});

describe('ActivitySummaryScreen review content', () => {
  it('redirects a missing review to Track without saving, discarding, or showing feedback', () => {
    mocks.tracking.pendingSummary = null;
    const review = mountReview();
    expect(requiredNode(review.tree, 'Redirect').props.href).toBe('/(tabs)/track');
    expect(nodes(review.tree, 'Button')).toEqual([]);
    expect(mocks.usePreventRemove.mock.calls[0][0]).toBe(false);
    expect(mocks.savePendingActivity).not.toHaveBeenCalled();
    expect(mocks.discardPendingActivity).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expectNoNavigation();
  });

  it.each<[ActivityType, string]>([['run', 'Run'], ['cycle', 'Cycle'], ['walk', 'Walk']])(
    'shows the full %s snapshot, pause-separated map segments, and formatted stats', (type, label) => {
      const source = snapshot(type);
      mocks.tracking.pendingSummary = source;
      const review = mountReview();
      expect(textContent(review.tree)).toContain(`${label} complete`);
      expect(textContent(review.tree)).toContain('Nothing has been committed yet.');
      expect(requiredNode(review.tree, 'Screen').props).toMatchObject({ scroll: true, edges: [] });
      expect(requiredNode(review.tree, 'RouteMap').props.segments).toBe(source.segments);
      expect(requiredNode(review.tree, 'RouteMap').props.fitRoute).toBe(true);
      expect(nodes(review.tree, 'StatTile').map(({ props }) => [props.label, props.value])).toEqual([
        ['Distance', '5.13 km'], ['Duration', '1:02:05'], ['Avg pace', '5:42 /km'], ['Est. calories', '363 kcal'],
      ]);
      expect(requiredNode(review.tree, 'AiSummaryCard').props.state).toBe('hidden');
      expect(requiredNode(review.tree, 'Button', 'Save Activity').props).toMatchObject({ loading: false, disabled: false });
      expect(requiredNode(review.tree, 'Button', 'Discard').props.disabled).toBe(false);
      expectNoRedirects(review);
      expectNoNavigation();
    },
  );

  it('keeps an empty-route review available with zero stats and an honest route notice', () => {
    mocks.tracking.pendingSummary = {
      ...snapshot('walk'), points: [], segments: [], durationSec: 0,
      distanceKm: 0, avgPaceSecPerKm: 0, caloriesEstimate: 0,
    };
    const review = mountReview();
    expect(requiredNode(review.tree, 'RouteMap').props.segments).toEqual([]);
    expect(textContent(review.tree)).toContain('No precise route points were recorded.');
    expect(nodes(review.tree, 'StatTile').map(({ props }) => props.value)).toEqual(['0.00 km', '0:00:00', '—', '0 kcal']);
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props.disabled).toBe(false);
    expectNoRedirects(review);
  });

  it('does not retain a review cleared externally when no action is saving or resolved', () => {
    const review = mountReview();
    mocks.tracking.pendingSummary = null;
    review.render();
    expect(requiredNode(review.tree, 'Redirect').props.href).toBe('/(tabs)/track');
    expectNoNavigation();
  });
});

describe('ActivitySummaryScreen saving', () => {
  it('shows inline loading, blocks rapid taps/discard, and retains review through the pre-navigation reset', async () => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const save = pendingSave();
    const review = mountReview();
    const pressSave = onPress(review.tree, 'Save Activity');
    pressSave();
    pressSave();
    onPress(review.tree, 'Discard')();
    review.render();
    onPress(review.tree, 'Save Activity')();
    expect(mocks.savePendingActivity).toHaveBeenCalledOnce();
    expect(mocks.confirmDestructiveAction).not.toHaveBeenCalled();
    expect(mocks.discardPendingActivity).not.toHaveBeenCalled();
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props.loading).toBe(true);
    expect(requiredNode(review.tree, 'Button', 'Discard').props.disabled).toBe(true);
    const prevention = mocks.usePreventRemove.mock.calls.at(-1);
    if (!prevention) throw new Error('Expected removal prevention to be registered.');
    expect(prevention[0]).toBe(true);
    prevention[1]();
    expect(mocks.showToast).toHaveBeenCalledWith('Saving your activity. Please wait before leaving review.', 'info');
    mocks.tracking.pendingSummary = null;
    review.render();
    expect(requiredNode(review.tree, 'RouteMap').props.segments).toBe(source.segments);
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props.loading).toBe(true);
    expectNoRedirects(review);
    expectNoNavigation();
    save.resolve({ localId: 'local-saved-id', firestoreId: 'saved-id' });
    await flushSave();
    review.render();
    expect(mocks.navigation).toEqual(['disable-prevention', 'dismissTo:/(tabs)/track', 'navigate:/(tabs)/history']);
    expect(mocks.savePendingActivity).toHaveBeenCalledOnce();
    expectNoRedirects(review);
  });

  it('disables prevention, dismisses to Track, then selects History without a competing Redirect', async () => {
    const review = mountReview();
    mocks.dismissTo.mockImplementationOnce((href) => {
      mocks.navigation.push(`dismissTo:${href}`);
      review.render(); // Inspect the resolved render between the two router calls.
    });
    onPress(review.tree, 'Save Activity')();
    await flushSave();
    review.render();
    review.render();
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith('Activity saved', 'success');
    expect(mocks.navigation).toEqual(['disable-prevention', 'dismissTo:/(tabs)/track', 'navigate:/(tabs)/history']);
    expect(mocks.dismissTo).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('/(tabs)/history');
    expect(mocks.usePreventRemove.mock.calls.at(-1)?.[0]).toBe(false);
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props).toMatchObject({ loading: false, disabled: true });
    expect(requiredNode(review.tree, 'Button', 'Discard').props.disabled).toBe(true);
    onPress(review.tree, 'Save Activity')();
    onPress(review.tree, 'Discard')();
    expect(mocks.savePendingActivity).toHaveBeenCalledOnce();
    expect(mocks.confirmDestructiveAction).not.toHaveBeenCalled();
    expectNoRedirects(review);
  });

  it('announces a queued offline save and still routes to History', async () => {
    const review = mountReview();
    mocks.savePendingActivity.mockImplementationOnce(async () => {
      mocks.tracking.pendingSummary = null;
      return { localId: 'local-1', firestoreId: null };
    });
    onPress(review.tree, 'Save Activity')();
    await flushSave();
    review.render();
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith('Activity saved (offline — will sync)', 'success');
    expect(mocks.navigation).toEqual(['disable-prevention', 'dismissTo:/(tabs)/track', 'navigate:/(tabs)/history']);
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props).toMatchObject({ loading: false, disabled: true });
  });

  it('captures the currently reviewed replacement, not the snapshot retained on initial mount', async () => {
    const review = mountReview();
    const replacement = snapshot('cycle');
    mocks.tracking.pendingSummary = replacement;
    review.render();
    const save = pendingSave();
    onPress(review.tree, 'Save Activity')();
    mocks.tracking.pendingSummary = null;
    review.render();
    expect(textContent(review.tree)).toContain('Cycle complete');
    expect(requiredNode(review.tree, 'RouteMap').props.segments).toBe(replacement.segments);
    expectNoNavigation();
    expectNoRedirects(review);
    save.resolve({ localId: 'local-cycle-id', firestoreId: 'cycle-id' });
    await flushSave();
    review.render();
    expect(requiredNode(review.tree, 'RouteMap').props.segments).toBe(replacement.segments);
    expectNoRedirects(review);
  });

  it.each([
    { failure: new Error('permission-denied'), message: 'permission-denied' },
    { failure: 'offline', message: 'Check your connection and try again.' },
  ])('keeps the exact snapshot and permits retry after $message', async ({ failure, message }) => {
    const source = snapshot();
    const original = structuredClone(source);
    mocks.tracking.pendingSummary = source;
    const save = pendingSave();
    const review = mountReview();
    onPress(review.tree, 'Save Activity')();
    save.reject(failure);
    await flushSave();
    review.render();
    expect(mocks.tracking.pendingSummary).toBe(source);
    expect(source).toEqual(original);
    expect(nodes(review.tree, 'Text').filter(({ props }) => props.accessibilityRole === 'alert').map(({ props }) => props.children)).toEqual([message]);
    expect(textContent(review.tree)).toContain('Your activity is kept here for retry.');
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props).toMatchObject({ loading: false, disabled: false });
    expect(requiredNode(review.tree, 'Button', 'Discard').props.disabled).toBe(false);
    expect(mocks.showToast).toHaveBeenCalledExactlyOnceWith('Save failed — activity kept on screen; try again.', 'error');
    expectNoNavigation();
    const retry = pendingSave();
    onPress(review.tree, 'Save Activity')();
    review.render();
    expect(nodes(review.tree, 'Text').filter(({ props }) => props.accessibilityRole === 'alert')).toEqual([]);
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props.loading).toBe(true);
    mocks.tracking.pendingSummary = null;
    retry.resolve({ localId: 'local-retry-id', firestoreId: 'retry-id' });
    await flushSave();
    review.render();
    expect(mocks.savePendingActivity).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).toHaveBeenLastCalledWith('Activity saved', 'success');
    expect(mocks.navigation).toEqual(['disable-prevention', 'dismissTo:/(tabs)/track', 'navigate:/(tabs)/history']);
    expectNoRedirects(review);
  });

  it('does not navigate or announce success if persistence resolves without clearing the current review', async () => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const save = pendingSave();
    const review = mountReview();
    onPress(review.tree, 'Save Activity')();
    save.resolve({ localId: 'local-old-id', firestoreId: 'old-id' });
    await flushSave();
    review.render();
    expect(mocks.tracking.pendingSummary).toBe(source);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props.loading).toBe(false);
    expectNoNavigation();
    expectNoRedirects(review);
  });

  it.each<TrackingStatus>(['recording', 'paused'])('does not navigate a new %s session on late save success', async (status) => {
    const save = pendingSave();
    const review = mountReview();
    onPress(review.tree, 'Save Activity')();
    mocks.tracking = { pendingSummary: null, status };
    save.resolve({ localId: 'local-old-id', firestoreId: 'old-id' });
    await flushSave();
    review.render();
    expect(mocks.tracking.status).toBe(status);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(requiredNode(review.tree, 'Redirect').props.href).toBe('/(tabs)/track');
    expectNoNavigation();
  });

  it.each(staleChanges)('ignores late save success after %s', async (change) => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const save = pendingSave();
    const review = mountReview();
    onPress(review.tree, 'Save Activity')();
    review.render();
    invalidateReview(review, change, source);
    // A logout/unmount can independently clear tracking; isolate the identity/mount guard.
    if (change === 'unmount' || change === 'logout' || change === 'new user') mocks.tracking.pendingSummary = null;
    const current = mocks.tracking.pendingSummary;
    save.resolve({ localId: 'local-old-id', firestoreId: 'old-id' });
    await flushSave();
    if (change !== 'unmount') review.render();
    expect(mocks.tracking.pendingSummary).toBe(current);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.discardPendingActivity).not.toHaveBeenCalled();
    expectNoNavigation();
    expect(review.renders.flatMap((tree) => nodes(tree, 'Redirect')).some(({ props }) => props.href === '/(tabs)/history')).toBe(false);
    if (current) expect(requiredNode(review.tree, 'RouteMap').props.segments).toBe(current.segments);
    if (change === 'unmount') expect(hooks.updatesAfterUnmount).toBe(0);
  });

  it.each(staleChanges)('does not display an old save error or toast another review after %s', async (change) => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const save = pendingSave();
    const review = mountReview();
    onPress(review.tree, 'Save Activity')();
    review.render();
    invalidateReview(review, change, source);
    const current = mocks.tracking.pendingSummary;
    save.reject(new Error('old owner network failure'));
    await flushSave();
    if (change !== 'unmount') review.render();
    expect(mocks.tracking.pendingSummary).toBe(current);
    expect(nodes(review.tree, 'Text').filter(({ props }) => props.accessibilityRole === 'alert')).toEqual([]);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expectNoNavigation();
    expectNoRedirects(review);
    if (change === 'unmount') expect(hooks.updatesAfterUnmount).toBe(0);
  });

  it('ignores a stale save callback if the reviewed snapshot changed before the next render', () => {
    const review = mountReview();
    const pressSave = onPress(review.tree, 'Save Activity');
    const replacement = snapshot('cycle');
    mocks.tracking.pendingSummary = replacement;
    pressSave();
    expect(mocks.savePendingActivity).not.toHaveBeenCalled();
    expect(mocks.tracking.pendingSummary).toBe(replacement);
    expectNoNavigation();
  });
});

describe('ActivitySummaryScreen discarding', () => {
  it('writes nothing before confirmation or on cancel, and keeps only one dialog open', () => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const review = mountReview();
    const pressDiscard = onPress(review.tree, 'Discard');
    pressDiscard();
    pressDiscard();
    onPress(review.tree, 'Save Activity')();
    expect(mocks.confirmDestructiveAction).toHaveBeenCalledOnce();
    expect(confirmation()).toMatchObject({
      title: 'Discard activity?', message: 'This activity will not be saved.',
      cancelLabel: 'Keep editing', confirmLabel: 'Discard',
    });
    expect(mocks.savePendingActivity).not.toHaveBeenCalled();
    expect(mocks.discardPendingActivity).not.toHaveBeenCalled();
    expect(mocks.tracking.pendingSummary).toBe(source);
    expectNoNavigation();
    confirmation().onCancel?.();
    review.render();
    expect(mocks.tracking.pendingSummary).toBe(source);
    expect(mocks.discardPendingActivity).not.toHaveBeenCalled();
    expect(mocks.savePendingActivity).not.toHaveBeenCalled();
    expectNoRedirects(review);
    onPress(review.tree, 'Discard')();
    expect(mocks.confirmDestructiveAction).toHaveBeenCalledTimes(2);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expectNoNavigation();
  });

  it('discards only after confirmation, dismisses to Track only, and never redirects to History on rerender', () => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const review = mountReview();
    mocks.dismissTo.mockImplementationOnce((href) => {
      mocks.navigation.push(`dismissTo:${href}`);
      review.render();
    });
    onPress(review.tree, 'Discard')();
    confirmation().onConfirm();
    review.render();
    review.render();
    expect(mocks.discardPendingActivity).toHaveBeenCalledOnce();
    expect(mocks.savePendingActivity).not.toHaveBeenCalled();
    expect(mocks.tracking.pendingSummary).toBeNull();
    expect(mocks.navigation).toEqual(['disable-prevention', 'dismissTo:/(tabs)/track']);
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(requiredNode(review.tree, 'RouteMap').props.segments).toBe(source.segments);
    expect(requiredNode(review.tree, 'Button', 'Save Activity').props.disabled).toBe(true);
    expect(requiredNode(review.tree, 'Button', 'Discard').props.disabled).toBe(true);
    onPress(review.tree, 'Discard')();
    onPress(review.tree, 'Save Activity')();
    expect(mocks.confirmDestructiveAction).toHaveBeenCalledOnce();
    expect(mocks.discardPendingActivity).toHaveBeenCalledOnce();
    expect(mocks.savePendingActivity).not.toHaveBeenCalled();
    expectNoRedirects(review);
  });

  it('captures the current review in confirmation before discard clears the store', () => {
    const review = mountReview();
    const replacement = snapshot('cycle');
    mocks.tracking.pendingSummary = replacement;
    review.render();
    onPress(review.tree, 'Discard')();
    confirmation().onConfirm();
    review.render();
    expect(textContent(review.tree)).toContain('Cycle complete');
    expect(requiredNode(review.tree, 'RouteMap').props.segments).toBe(replacement.segments);
    expect(mocks.navigation).toEqual(['disable-prevention', 'dismissTo:/(tabs)/track']);
    expectNoRedirects(review);
  });

  it('does not resolve or navigate when the discard service refuses', () => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    mocks.discardPendingActivity.mockReturnValueOnce(false);
    const review = mountReview();
    onPress(review.tree, 'Discard')();
    confirmation().onConfirm();
    review.render();
    expect(mocks.tracking.pendingSummary).toBe(source);
    expect(requiredNode(review.tree, 'Button', 'Discard').props.disabled).toBe(false);
    expectNoNavigation();
    expectNoRedirects(review);
    onPress(review.tree, 'Discard')();
    expect(mocks.confirmDestructiveAction).toHaveBeenCalledTimes(2);
  });

  it.each(staleChanges)('does nothing when an OS confirmation outlives %s', (change) => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const review = mountReview();
    onPress(review.tree, 'Discard')();
    const staleConfirmation = confirmation();
    invalidateReview(review, change, source);
    const current = mocks.tracking.pendingSummary;
    const currentUser = mocks.auth.user;
    // No rerender first: the callback must check live identity/snapshot, not its closure alone.
    staleConfirmation.onConfirm();
    expect(mocks.tracking.pendingSummary).toBe(current);
    expect(mocks.auth.user).toBe(currentUser);
    expect(mocks.discardPendingActivity).not.toHaveBeenCalled();
    expect(mocks.savePendingActivity).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expectNoNavigation();
    if (change === 'unmount') expect(hooks.updatesAfterUnmount).toBe(0);
  });

  it('ignores a stale confirmation while a save is busy after the dialog was canceled', async () => {
    const source = snapshot();
    mocks.tracking.pendingSummary = source;
    const review = mountReview();
    onPress(review.tree, 'Discard')();
    const staleConfirmation = confirmation();
    staleConfirmation.onCancel?.();
    const save = pendingSave();
    onPress(review.tree, 'Save Activity')();
    staleConfirmation.onConfirm();
    expect(mocks.savePendingActivity).toHaveBeenCalledOnce();
    expect(mocks.discardPendingActivity).not.toHaveBeenCalled();
    expect(mocks.tracking.pendingSummary).toBe(source);
    expectNoNavigation();
    mocks.tracking.pendingSummary = null;
    save.resolve({ localId: 'local-saved-id', firestoreId: 'saved-id' });
    await flushSave();
    expect(mocks.navigation).toEqual(['disable-prevention', 'dismissTo:/(tabs)/track', 'navigate:/(tabs)/history']);
  });
});
