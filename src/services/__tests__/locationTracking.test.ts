import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { DependencyList, Dispatch, EffectCallback, SetStateAction } from 'react';
import type { AppStateStatus } from 'react-native';
import type { LocationObject, LocationOptions, LocationSubscription } from 'expo-location';

import { useAuthStore } from '../../stores/authStore';
import { useTrackingStore, type TrackingState, type TrackingStatus } from '../../stores/trackingStore';
import { useUiStore } from '../../stores/uiStore';
import { computeElapsedMs } from '../../utils/tracking';
import type { ForegroundLocationPermission } from '../permissions';
import {
  disposeTracking, pauseTracking, resumeTracking, startTracking, stopTracking,
  TrackingError, useElapsedMs, useTrackingLifecycle, WATCH_OPTIONS,
} from '../locationTracking';

type FixCallback = (fix: LocationObject) => void;
type ErrorCallback = (reason: string) => void;
type ClockSubscribe = (listener: () => void) => () => void;

const mocks = vi.hoisted(() => ({
  ensureForegroundLocation: vi.fn<() => Promise<ForegroundLocationPermission>>(),
  hasServicesEnabledAsync: vi.fn<() => Promise<boolean>>(),
  watchPositionAsync: vi.fn<(
    options: LocationOptions, callback: FixCallback, errorHandler?: ErrorCallback,
  ) => Promise<LocationSubscription>>(),
  requestBackgroundPermissionsAsync: vi.fn<typeof import('expo-location').requestBackgroundPermissionsAsync>(),
  startLocationUpdatesAsync: vi.fn<typeof import('expo-location').startLocationUpdatesAsync>(),
  activateKeepAwakeAsync: vi.fn<(tag?: string) => Promise<void>>(),
  deactivateKeepAwake: vi.fn<(tag?: string) => Promise<void>>(),
  appState: {
    currentState: 'active' as AppStateStatus | null,
    addEventListener: vi.fn<(
      event: 'change', listener: (state: AppStateStatus) => void,
    ) => { remove: () => void }>(),
  },
  useEffect: vi.fn<(effect: EffectCallback, dependencies?: DependencyList) => void>(),
  useState: vi.fn<(initial: unknown) => [unknown, Dispatch<SetStateAction<unknown>>]>(),
  refresh: vi.fn<Dispatch<SetStateAction<unknown>>>(),
  useCallback: vi.fn<(callback: ClockSubscribe, dependencies: DependencyList) => ClockSubscribe>(),
  useSyncExternalStore: vi.fn<(
    subscribe: ClockSubscribe, getSnapshot: () => number, getServerSnapshot?: () => number,
  ) => number>(),
  onTick: vi.fn<() => void>(),
}));

vi.mock('expo-location', () => ({
  Accuracy: { Highest: 5 },
  hasServicesEnabledAsync: mocks.hasServicesEnabledAsync,
  watchPositionAsync: mocks.watchPositionAsync,
  requestBackgroundPermissionsAsync: mocks.requestBackgroundPermissionsAsync,
  startLocationUpdatesAsync: mocks.startLocationUpdatesAsync,
}));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: mocks.activateKeepAwakeAsync,
  deactivateKeepAwake: mocks.deactivateKeepAwake,
}));
vi.mock('react-native', () => ({ AppState: mocks.appState }));
vi.mock('../permissions', () => ({ ensureForegroundLocation: mocks.ensureForegroundLocation }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: mocks.useEffect,
  useState: mocks.useState,
  useCallback: mocks.useCallback,
  useSyncExternalStore: mocks.useSyncExternalStore,
}));
vi.mock('../../stores/trackingStore', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../stores/trackingStore')>();
  // Keep the real Zustand state/actions/subscriptions; only bypass the React
  // selector hook so lifecycle effects and the ticker need no renderer.
  return {
    useTrackingStore: Object.assign(
      <T>(selector: (state: TrackingState) => T) => selector(original.useTrackingStore.getState()),
      original.useTrackingStore,
    ),
  };
});

const START_TIME = 1_000_000;

interface Watch {
  callback: FixCallback;
  errorHandler?: ErrorCallback;
  subscription: { remove: Mock<() => void> };
}

interface AppStateListener {
  callback: (state: AppStateStatus) => void;
  active: boolean;
  remove: Mock<() => void>;
}

let watches: Watch[];
let appStateListeners: AppStateListener[];
let effectCleanups: (() => void)[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function at(time: number): void {
  vi.setSystemTime(time);
}

function fix(coords: Partial<LocationObject['coords']> = {}, timestamp = Date.now()): LocationObject {
  return {
    timestamp,
    coords: {
      latitude: 0, longitude: 0, accuracy: 5, speed: 3,
      altitude: null, altitudeAccuracy: null, heading: null,
      ...coords,
    },
  };
}

function recordWatch(callback: FixCallback, errorHandler?: ErrorCallback): Watch {
  const watch: Watch = { callback, errorHandler, subscription: { remove: vi.fn<() => void>() } };
  watches.push(watch);
  return watch;
}

function watchAt(index = 0): Watch {
  const watch = watches[index];
  if (!watch) throw new Error(`Expected native watch ${index} to have been requested.`);
  return watch;
}

function failWatch(watch: Watch): void {
  if (!watch.errorHandler) throw new Error('Expected a native GPS error handler.');
  watch.errorHandler('GPS provider unavailable');
}

function wakeTagAt(index = 0): string {
  const tag = mocks.activateKeepAwakeAsync.mock.calls[index]?.[0];
  if (typeof tag !== 'string') throw new Error('Expected an explicitly tagged keep-awake lock.');
  return tag;
}

function delayNextWatch() {
  const requested = deferred<Watch>();
  const result = deferred<LocationSubscription>();
  mocks.watchPositionAsync.mockImplementationOnce((_options, callback, errorHandler) => {
    const watch = recordWatch(callback, errorHandler);
    requested.resolve(watch);
    return result.promise;
  });
  return { requested: requested.promise, result };
}

function delayNextWakeLock() {
  const requested = deferred<void>();
  const result = deferred<void>();
  mocks.activateKeepAwakeAsync.mockImplementationOnce(() => {
    requested.resolve(undefined);
    return result.promise;
  });
  return { requested: requested.promise, result };
}

function emitAppState(state: AppStateStatus): void {
  mocks.appState.currentState = state;
  for (const listener of appStateListeners) {
    if (listener.active) listener.callback(state);
  }
}

function unmountEffects(): void {
  for (const cleanup of effectCleanups.splice(0).reverse()) cleanup();
}

function useMockTrackingLifecycle() {
  const trackingSubscribe = useTrackingStore.subscribe;
  const authSubscribe = useAuthStore.subscribe;
  const unsubscribeTracking = vi.fn<() => void>();
  const unsubscribeAuth = vi.fn<() => void>();
  const trackingSpy = vi.spyOn(useTrackingStore, 'subscribe').mockImplementation((listener) => {
    unsubscribeTracking.mockImplementation(trackingSubscribe(listener));
    return unsubscribeTracking;
  });
  const authSpy = vi.spyOn(useAuthStore, 'subscribe').mockImplementation((listener) => {
    unsubscribeAuth.mockImplementation(authSubscribe(listener));
    return unsubscribeAuth;
  });
  useTrackingLifecycle();
  return { trackingSpy, authSpy, unsubscribeTracking, unsubscribeAuth };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  at(START_TIME);
  watches = [];
  appStateListeners = [];
  effectCleanups = [];
  mocks.appState.currentState = 'active';
  mocks.ensureForegroundLocation.mockResolvedValue('granted');
  mocks.hasServicesEnabledAsync.mockResolvedValue(true);
  mocks.activateKeepAwakeAsync.mockResolvedValue(undefined);
  mocks.deactivateKeepAwake.mockResolvedValue(undefined);
  mocks.watchPositionAsync.mockImplementation(async (_options, callback, errorHandler) => (
    recordWatch(callback, errorHandler).subscription
  ));
  mocks.appState.addEventListener.mockImplementation((_event, callback) => {
    const listener: AppStateListener = { callback, active: true, remove: vi.fn<() => void>() };
    listener.remove.mockImplementation(() => { listener.active = false; });
    appStateListeners.push(listener);
    return listener;
  });
  mocks.useEffect.mockImplementation((effect) => {
    const cleanup = effect();
    if (cleanup) effectCleanups.push(cleanup);
  });
  mocks.useState.mockImplementation((initial) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    mocks.refresh,
  ]);
  mocks.useCallback.mockImplementation((callback) => callback);
  mocks.useSyncExternalStore.mockImplementation((subscribe, getSnapshot) => {
    effectCleanups.push(subscribe(mocks.onTick));
    return getSnapshot();
  });
  useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useAuthStore.getState().setUser({ uid: 'owner', email: 'owner@example.test' });
  useUiStore.setState(useUiStore.getInitialState(), true);
});

afterEach(() => {
  // A deliberately throwing native removal must not poison later test cleanup.
  for (const watch of watches) watch.subscription.remove.mockImplementation(() => undefined);
  for (const listener of appStateListeners) {
    listener.remove.mockImplementation(() => { listener.active = false; });
  }
  mocks.deactivateKeepAwake.mockResolvedValue(undefined);
  unmountEffects();
  disposeTracking();
  useTrackingStore.setState(useTrackingStore.getInitialState(), true);
  useAuthStore.setState(useAuthStore.getInitialState(), true);
  useUiStore.setState(useUiStore.getInitialState(), true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('GPS startup and access guards', () => {
  it('uses the SDK foreground watch options, not a background task', async () => {
    await startTracking('walk');
    expect(WATCH_OPTIONS).toEqual({ accuracy: 5, timeInterval: 2000, distanceInterval: 5 });
    expect(mocks.watchPositionAsync.mock.calls[0]?.[0]).toBe(WATCH_OPTIONS);
    expect(mocks.appState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(mocks.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(mocks.startLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(wakeTagAt()).toMatch(/^runtrack-tracking-\d+$/);
    expect(useTrackingStore.getState().activityType).toBe('walk');
  });

  it('returns the exact same Start promise through permission, keep-awake, and native watch installation', async () => {
    const permission = deferred<ForegroundLocationPermission>();
    const wake = delayNextWakeLock();
    const pendingWatch = delayNextWatch();
    mocks.ensureForegroundLocation.mockReturnValueOnce(permission.promise);
    const first = startTracking('run');
    expect(startTracking('cycle')).toBe(first);
    expect(mocks.ensureForegroundLocation).toHaveBeenCalledOnce();
    expect(useTrackingStore.getState().status).toBe('idle');
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
    permission.resolve('granted');
    await wake.requested;
    expect(startTracking('walk')).toBe(first);
    expect(useTrackingStore.getState().status).toBe('idle');
    wake.result.resolve(undefined);
    const watch = await pendingWatch.requested;
    expect(startTracking('cycle')).toBe(first);
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', activityType: 'run', startedAt: START_TIME, segments: [[]] });
    pendingWatch.result.resolve(watch.subscription);
    await expect(first).resolves.toBeUndefined();
    expect(mocks.hasServicesEnabledAsync).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledOnce();
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
    expect(mocks.appState.addEventListener).toHaveBeenCalledOnce();
  });

  it('joins an unfinished Start on Resume instead of opening a second watch for the same session', async () => {
    const pending = delayNextWatch();
    const start = startTracking('run');
    const watch = await pending.requested;
    const resume = resumeTracking();
    // Let an incorrectly independent Resume finish while Start's watch remains
    // pending, so duplicate resources are observed rather than hidden by timing.
    if (resume !== start) await expect(resume).resolves.toBeUndefined();
    pending.result.resolve(watch.subscription);
    await expect(start).resolves.toBeUndefined();
    await expect(resume).resolves.toBeUndefined();
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
    expect(resume).toBe(start);
    expect(mocks.ensureForegroundLocation).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledOnce();
    expect(useTrackingStore.getState().segments).toEqual([[]]);
    expect(watch.subscription.remove).not.toHaveBeenCalled();
  });

  it.each(['recording', 'paused'] as const)('does not replace an already %s session on Start', async (status) => {
    await startTracking('walk');
    if (status === 'paused') pauseTracking();
    const state = useTrackingStore.getState();
    await expect(startTracking('cycle')).resolves.toBeUndefined();
    expect(useTrackingStore.getState()).toBe(state);
    expect(mocks.ensureForegroundLocation).toHaveBeenCalledOnce();
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledOnce();
  });

  it.each([['denied', 'permission-denied'], ['blocked', 'permission-blocked']] as const)(
    'rejects %s access before creating a session or native resources', async (permission, code) => {
      mocks.ensureForegroundLocation.mockResolvedValue(permission);
      await expect(startTracking('run')).rejects.toMatchObject({ name: 'TrackingError', code });
      expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', startedAt: null, pendingSummary: null, segments: [] });
      expect(mocks.hasServicesEnabledAsync).not.toHaveBeenCalled();
      expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
      expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
      expect(mocks.appState.addEventListener).not.toHaveBeenCalled();
    },
  );

  it('rejects disabled device location services without starting a session', async () => {
    mocks.hasServicesEnabledAsync.mockResolvedValue(false);
    await expect(startTracking('run')).rejects.toMatchObject({ code: 'services-disabled' });
    expect(useTrackingStore.getState().status).toBe('idle');
    expect(mocks.hasServicesEnabledAsync).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
  });

  it.each(['background', 'inactive'] as const)('rejects starting while the app is %s', async (state) => {
    mocks.appState.currentState = state;
    await expect(startTracking('run')).rejects.toMatchObject({ code: 'not-foreground' });
    expect(useTrackingStore.getState().status).toBe('idle');
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('does not overwrite a finished activity awaiting save or discard', async () => {
    useTrackingStore.getState().start('walk');
    at(START_TIME + 2000);
    const snapshot = useTrackingStore.getState().stop(70);
    await expect(startTracking('cycle')).rejects.toMatchObject({ code: 'session-pending' });
    expect(useTrackingStore.getState().pendingSummary).toBe(snapshot);
    expect(mocks.ensureForegroundLocation).not.toHaveBeenCalled();
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
  });

  it.each(['permission', 'services', 'keep-awake', 'watch'] as const)('rolls back a native %s startup failure and permits retry', async (stage) => {
    const failure = new Error('native startup failed');
    if (stage === 'permission') mocks.ensureForegroundLocation.mockRejectedValueOnce(failure);
    if (stage === 'services') mocks.hasServicesEnabledAsync.mockRejectedValueOnce(failure);
    if (stage === 'keep-awake') mocks.activateKeepAwakeAsync.mockRejectedValueOnce(failure);
    if (stage === 'watch') mocks.watchPositionAsync.mockRejectedValueOnce(failure);
    const first = startTracking('cycle');
    expect(startTracking('run')).toBe(first);
    await expect(first).rejects.toMatchObject({ name: 'TrackingError', code: 'location-unavailable' });
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', startedAt: null, segments: [], pendingSummary: null });
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledTimes(stage === 'watch' ? 1 : 0);
    if (stage === 'watch') expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    await expect(startTracking('walk')).resolves.toBeUndefined();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', activityType: 'walk', segments: [[]] });
  });

  it('preserves an existing typed tracking failure instead of replacing its code', async () => {
    const failure = new TrackingError('permission-blocked', 'Enable precise location.');
    mocks.ensureForegroundLocation.mockRejectedValueOnce(failure);
    await expect(startTracking('run')).rejects.toBe(failure);
    expect(useTrackingStore.getState().status).toBe('idle');
  });
});

describe('native fixes and pause segments', () => {
  const invalidFixes: { name: string; coords?: Partial<LocationObject['coords']>; timestamp?: number }[] = [
    { name: 'non-finite latitude', coords: { latitude: Number.NaN } },
    { name: 'out-of-range longitude', coords: { longitude: 181 } },
    { name: 'inaccurate', coords: { accuracy: 21 } },
    { name: 'unknown accuracy', coords: { accuracy: null } },
    { name: 'pre-session', timestamp: START_TIME - 1 },
    { name: 'stale', timestamp: START_TIME - 16_000 },
    { name: 'future', timestamp: START_TIME + 5001 },
    { name: 'invalid timestamp', timestamp: Number.NaN },
  ];

  it.each(invalidFixes)('drops $name fixes and accepts the next valid signed coordinates', async ({ coords, timestamp }) => {
    await startTracking('run');
    const segments = useTrackingStore.getState().segments;
    const watch = watchAt();
    watch.callback(fix(coords, timestamp ?? START_TIME));
    expect(useTrackingStore.getState().segments).toBe(segments);
    watch.callback(fix({ latitude: -33.86, longitude: -70.64, altitude: 400, heading: 180 }));
    expect(useTrackingStore.getState().segments).toEqual([[{ lat: -33.86, lng: -70.64, timestamp: START_TIME, speed: 3 }]]);
    expect(watch.subscription.remove).not.toHaveBeenCalled();
  });

  it('drops teleports and duplicate timestamps without poisoning the last accepted baseline', async () => {
    await startTracking('run');
    const watch = watchAt();
    watch.callback(fix());
    const segments = useTrackingStore.getState().segments;
    at(START_TIME + 2000);
    watch.callback(fix({ latitude: 40 }));
    watch.callback(fix({ latitude: 0.00005 }, START_TIME));
    expect(useTrackingStore.getState().segments).toBe(segments);
    watch.callback(fix({ latitude: 0.00005 }));
    expect(useTrackingStore.getState().segments).toEqual([[
      { lat: 0, lng: 0, timestamp: START_TIME, speed: 3 },
      { lat: 0.00005, lng: 0, timestamp: START_TIME + 2000, speed: 3 },
    ]]);
  });

  it('drops paused fixes, rejects delayed pre-resume fixes, and accepts a fresh distant baseline without bridging the pause', async () => {
    await startTracking('run');
    const watch = watchAt();
    watch.callback(fix());
    at(START_TIME + 2000);
    pauseTracking();
    const pausedSegments = useTrackingStore.getState().segments;
    watch.callback(fix({ latitude: 20, longitude: 20 }));
    expect(useTrackingStore.getState().segments).toBe(pausedSegments);
    expect(watch.subscription.remove).not.toHaveBeenCalled();
    expect(mocks.deactivateKeepAwake).not.toHaveBeenCalled();
    at(START_TIME + 12_000);
    await resumeTracking();
    watch.callback(fix({ latitude: 30, longitude: 30 }, START_TIME + 10_000));
    expect(useTrackingStore.getState().segments).toEqual([pausedSegments[0], []]);
    watch.callback(fix({ latitude: 40, longitude: 120 }));
    at(START_TIME + 14_000);
    watch.callback(fix({ latitude: 40.00005, longitude: 120 }));
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', totalPausedMs: 10_000, pauseStartedAt: null });
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledOnce();
    at(START_TIME + 16_000);
    const snapshot = stopTracking();
    expect(snapshot?.durationSec).toBe(6);
    expect(snapshot?.segments).toEqual([
      [{ lat: 0, lng: 0, timestamp: START_TIME, speed: 3 }],
      [
        { lat: 40, lng: 120, timestamp: START_TIME + 12_000, speed: 3 },
        { lat: 40.00005, lng: 120, timestamp: START_TIME + 14_000, speed: 3 },
      ],
    ]);
    expect(snapshot?.distanceKm).toBeGreaterThan(0.005);
    expect(snapshot?.distanceKm).toBeLessThan(0.006);
  });

  it('drops foreground watch callbacks while inactive even before a background event', async () => {
    await startTracking('run');
    const segments = useTrackingStore.getState().segments;
    mocks.appState.currentState = 'inactive';
    watchAt().callback(fix());
    expect(useTrackingStore.getState().segments).toBe(segments);
    mocks.appState.currentState = 'active';
    watchAt().callback(fix());
    expect(useTrackingStore.getState().segments[0]).toHaveLength(1);
  });
});

describe('Resume and foreground interruptions', () => {
  it('makes pause and Resume no-ops while idle', async () => {
    const state = useTrackingStore.getState();
    pauseTracking();
    await expect(resumeTracking()).resolves.toBeUndefined();
    expect(useTrackingStore.getState()).toBe(state);
    expect(mocks.ensureForegroundLocation).not.toHaveBeenCalled();
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('coalesces the exact Resume promise with an existing watch and creates just one new segment', async () => {
    await startTracking('run');
    at(START_TIME + 2000);
    pauseTracking();
    at(START_TIME + 12_000);
    const permission = deferred<ForegroundLocationPermission>();
    mocks.ensureForegroundLocation.mockReturnValueOnce(permission.promise);
    const first = resumeTracking();
    expect(resumeTracking()).toBe(first);
    expect(useTrackingStore.getState().status).toBe('paused');
    permission.resolve('granted');
    await expect(first).resolves.toBeUndefined();
    const resumed = useTrackingStore.getState();
    expect(resumed).toMatchObject({ status: 'recording', totalPausedMs: 10_000, segments: [[], []] });
    await resumeTracking();
    expect(useTrackingStore.getState()).toBe(resumed);
    expect(mocks.ensureForegroundLocation).toHaveBeenCalledTimes(2);
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledOnce();
  });

  it('keeps a missing-watch Resume single-flight through permission, keep-awake, and replacement watch installation', async () => {
    await startTracking('run');
    at(START_TIME + 2000);
    pauseTracking();
    disposeTracking();
    at(START_TIME + 12_000);
    const permission = deferred<ForegroundLocationPermission>();
    const wake = delayNextWakeLock();
    const pendingWatch = delayNextWatch();
    mocks.ensureForegroundLocation.mockReturnValueOnce(permission.promise);
    const first = resumeTracking();
    expect(resumeTracking()).toBe(first);
    permission.resolve('granted');
    await wake.requested;
    expect(resumeTracking()).toBe(first);
    expect(useTrackingStore.getState().status).toBe('paused');
    wake.result.resolve(undefined);
    const watch = await pendingWatch.requested;
    expect(resumeTracking()).toBe(first);
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', totalPausedMs: 10_000, segments: [[], []] });
    pendingWatch.result.resolve(watch.subscription);
    await expect(first).resolves.toBeUndefined();
    expect(mocks.watchPositionAsync).toHaveBeenCalledTimes(2);
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledTimes(2);
    expect(mocks.appState.addEventListener).toHaveBeenCalledTimes(2);
    expect(watchAt(0).subscription.remove).toHaveBeenCalledOnce();
    expect(watch.subscription.remove).not.toHaveBeenCalled();
  });

  it.each(['denied', 'blocked', 'services-disabled', 'background'] as const)('keeps a refused %s Resume paused and permits recovery', async (reason) => {
    await startTracking('run');
    pauseTracking();
    const paused = useTrackingStore.getState();
    if (reason === 'denied' || reason === 'blocked') mocks.ensureForegroundLocation.mockResolvedValue(reason);
    if (reason === 'services-disabled') mocks.hasServicesEnabledAsync.mockResolvedValue(false);
    if (reason === 'background') mocks.appState.currentState = 'background';
    const code = reason === 'denied' ? 'permission-denied'
      : reason === 'blocked' ? 'permission-blocked'
        : reason === 'background' ? 'not-foreground' : 'services-disabled';
    await expect(resumeTracking()).rejects.toMatchObject({ code });
    expect(useTrackingStore.getState()).toBe(paused);
    expect(watchAt().subscription.remove).not.toHaveBeenCalled();
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledOnce();
    mocks.ensureForegroundLocation.mockResolvedValue('granted');
    mocks.hasServicesEnabledAsync.mockResolvedValue(true);
    mocks.appState.currentState = 'active';
    await expect(resumeTracking()).resolves.toBeUndefined();
    expect(useTrackingStore.getState().status).toBe('recording');
  });

  it('auto-pauses once in the background and requires explicit Resume after returning', async () => {
    await startTracking('run');
    const watch = watchAt();
    watch.callback(fix());
    at(START_TIME + 2000);
    emitAppState('background');
    const paused = useTrackingStore.getState();
    const toast = useUiStore.getState().toast;
    expect(paused).toMatchObject({ status: 'paused', pauseStartedAt: START_TIME + 2000 });
    expect(toast).toMatchObject({ message: expect.stringContaining('Resume'), type: 'info' });
    watch.callback(fix({ latitude: 10 }));
    emitAppState('background');
    at(START_TIME + 12_000);
    emitAppState('active');
    expect(useTrackingStore.getState()).toBe(paused);
    expect(useUiStore.getState().toast).toBe(toast);
    watch.callback(fix({ latitude: 20 }));
    expect(useTrackingStore.getState().segments[0]).toHaveLength(1);
    expect(watch.subscription.remove).not.toHaveBeenCalled();
    await resumeTracking();
    watch.callback(fix({ latitude: 40, longitude: 120 }));
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', totalPausedMs: 10_000 });
    expect(useTrackingStore.getState().segments[1]).toEqual([{ lat: 40, lng: 120, timestamp: START_TIME + 12_000, speed: 3 }]);
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
  });

  it('cannot start after the app backgrounds while keep-awake activation is pending', async () => {
    const wake = delayNextWakeLock();
    const request = startTracking('run');
    await wake.requested;
    emitAppState('background');
    wake.result.resolve(undefined);
    await expect(request).rejects.toMatchObject({ code: 'not-foreground' });
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', startedAt: null, pendingSummary: null });
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
    expect(mocks.appState.addEventListener).not.toHaveBeenCalled();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledWith(wakeTagAt());
  });

  it('cannot Resume after the app backgrounds while a replacement keep-awake activation is pending', async () => {
    await startTracking('run');
    pauseTracking();
    disposeTracking();
    const paused = useTrackingStore.getState();
    const wake = delayNextWakeLock();
    const request = resumeTracking();
    await wake.requested;
    emitAppState('background');
    wake.result.resolve(undefined);
    await expect(request).rejects.toMatchObject({ code: 'not-foreground' });
    expect(useTrackingStore.getState()).toBe(paused);
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
    expect(mocks.appState.addEventListener).toHaveBeenCalledOnce();
    stopTracking();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledTimes(2);
    expect(mocks.deactivateKeepAwake).toHaveBeenLastCalledWith(wakeTagAt(1));
  });

  it.each(['background', 'inactive'] as const)('pauses a late startup watch when the current app state became %s before its listener notification', async (state) => {
    const pending = delayNextWatch();
    const request = startTracking('run');
    const watch = await pending.requested;
    at(START_TIME + 2000);
    mocks.appState.currentState = state;
    pending.result.resolve(watch.subscription);
    await expect(request).resolves.toBeUndefined();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'paused', pauseStartedAt: START_TIME + 2000 });
    watch.callback(fix({ latitude: 20 }));
    emitAppState('active');
    expect(useTrackingStore.getState().status).toBe('paused');
    expect(useTrackingStore.getState().segments).toEqual([[]]);
    at(START_TIME + 12_000);
    await resumeTracking();
    watch.callback(fix({ latitude: 40, longitude: 120 }));
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', totalPausedMs: 10_000 });
    expect(useTrackingStore.getState().segments[1]).toHaveLength(1);
    expect(mocks.watchPositionAsync).toHaveBeenCalledOnce();
  });

  it.each([
    ['recording', false], ['recording', true], ['paused', false], ['paused', true],
  ] as const)('removes and invalidates a failing %s watch, then installs a fresh one on Resume (remove throws=%s)', async (status, removeThrows) => {
    await startTracking('run');
    const old = watchAt();
    old.callback(fix());
    if (status === 'paused') {
      at(START_TIME + 1000);
      pauseTracking();
    }
    if (removeThrows) old.subscription.remove.mockImplementationOnce(() => { throw new Error('native watch removal failed'); });
    at(START_TIME + 2000);
    expect(() => failWatch(old)).not.toThrow();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'paused', pauseStartedAt: START_TIME + (status === 'paused' ? 1000 : 2000) });
    expect(old.subscription.remove).toHaveBeenCalledOnce();
    expect(useUiStore.getState().toast).toMatchObject({ type: 'error', message: expect.stringContaining('Resume') });
    at(START_TIME + 12_000);
    await resumeTracking();
    expect(mocks.watchPositionAsync).toHaveBeenCalledTimes(2);
    const resumed = useTrackingStore.getState();
    old.callback(fix({ latitude: 30, longitude: 30 }));
    failWatch(old);
    expect(useTrackingStore.getState()).toBe(resumed);
    watchAt(1).callback(fix({ latitude: 40, longitude: 120 }));
    expect(useTrackingStore.getState().segments[1]).toEqual([{ lat: 40, lng: 120, timestamp: START_TIME + 12_000, speed: 3 }]);
    stopTracking();
    expect(old.subscription.remove).toHaveBeenCalledOnce();
    expect(watchAt(1).subscription.remove).toHaveBeenCalledOnce();
  });

  it('removes a failed watch that resolves after its startup error and preserves a paused route for a fresh Resume', async () => {
    const pending = delayNextWatch();
    const request = startTracking('run');
    const old = await pending.requested;
    old.callback(fix());
    const route = useTrackingStore.getState().segments[0];
    at(START_TIME + 2000);
    failWatch(old);
    expect(useTrackingStore.getState().status).toBe('paused');
    pending.result.resolve(old.subscription);
    await expect(request).resolves.toBeUndefined();
    expect(old.subscription.remove).toHaveBeenCalledOnce();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'paused', pendingSummary: null });
    expect(useTrackingStore.getState().segments[0]).toBe(route);
    at(START_TIME + 12_000);
    await resumeTracking();
    const resumed = useTrackingStore.getState();
    old.callback(fix({ latitude: 30 }));
    failWatch(old);
    expect(useTrackingStore.getState()).toBe(resumed);
    expect(mocks.watchPositionAsync).toHaveBeenCalledTimes(2);
    watchAt(1).callback(fix({ latitude: 40, longitude: 120 }));
    expect(useTrackingStore.getState().segments[1]).toHaveLength(1);
  });

  it('keeps an existing route paused after replacement-watch startup fails and allows another Resume', async () => {
    await startTracking('run');
    watchAt().callback(fix());
    pauseTracking();
    disposeTracking();
    const route = useTrackingStore.getState().segments[0];
    const failure = new Error('replacement watch failed');
    mocks.watchPositionAsync.mockRejectedValueOnce(failure);
    await expect(resumeTracking()).rejects.toMatchObject({ name: 'TrackingError', code: 'location-unavailable' });
    expect(useTrackingStore.getState()).toMatchObject({ status: 'paused', pendingSummary: null });
    expect(useTrackingStore.getState().segments[0]).toBe(route);
    await expect(resumeTracking()).resolves.toBeUndefined();
    expect(useTrackingStore.getState().status).toBe('recording');
    expect(mocks.watchPositionAsync).toHaveBeenCalledTimes(3);
  });
});

describe('stop, cancellation, and native cleanup', () => {
  it('stops the watch, AppState subscription, and exactly one matching tagged wake lock without losing the snapshot', async () => {
    await startTracking('cycle');
    const watch = watchAt();
    watch.callback(fix());
    at(START_TIME + 2000);
    const snapshot = stopTracking(80);
    expect(snapshot).toMatchObject({ activityType: 'cycle', durationSec: 2, points: [{ lat: 0, lng: 0, timestamp: START_TIME, speed: 3 }] });
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', pendingSummary: snapshot });
    expect(watch.subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.activateKeepAwakeAsync).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledWith(wakeTagAt());
    const stopped = useTrackingStore.getState();
    watch.callback(fix({ latitude: 40 }));
    failWatch(watch);
    expect(useTrackingStore.getState()).toBe(stopped);
    expect(useUiStore.getState().toast).toBeNull();
    expect(stopTracking()).toBeNull();
    disposeTracking();
    expect(watch.subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['watch', 'app-state'] as const)('continues cleanup and finishes the session when %s removal throws', async (resource) => {
    await startTracking('run');
    const remove = resource === 'watch' ? watchAt().subscription.remove : appStateListeners[0]?.remove;
    if (!remove) throw new Error('Expected a native resource to remove.');
    remove.mockImplementationOnce(() => { throw new Error('native removal failed'); });
    at(START_TIME + 2000);
    expect(() => stopTracking()).not.toThrow();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', pendingSummary: { durationSec: 2 } });
    expect(watchAt().subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledWith(wakeTagAt());
    disposeTracking();
    expect(watchAt().subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
  });

  it.each(['reject', 'throw'] as const)('handles a keep-awake cleanup %s without skipping other resources', async (failureMode) => {
    await startTracking('run');
    const failure = new Error('original Activity is gone');
    if (failureMode === 'reject') mocks.deactivateKeepAwake.mockRejectedValueOnce(failure);
    else mocks.deactivateKeepAwake.mockImplementationOnce(() => { throw failure; });
    expect(stopTracking()).not.toBeNull();
    await Promise.resolve();
    expect(useTrackingStore.getState().status).toBe('idle');
    expect(watchAt().subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
  });

  it.each(['granted', 'denied', 'blocked'] as const)('cancels a late %s permission response after stop without acquiring native resources', async (result) => {
    const permission = deferred<ForegroundLocationPermission>();
    mocks.ensureForegroundLocation.mockReturnValueOnce(permission.promise);
    const request = startTracking('run');
    expect(stopTracking()).toBeNull();
    permission.resolve(result);
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    expect(useTrackingStore.getState().status).toBe('idle');
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('releases a keep-awake lock that resolves after stop and never creates a session', async () => {
    const wake = delayNextWakeLock();
    const request = startTracking('run');
    await wake.requested;
    expect(stopTracking()).toBeNull();
    wake.result.resolve(undefined);
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', pendingSummary: null });
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledWith(wakeTagAt());
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
    expect(mocks.appState.addEventListener).not.toHaveBeenCalled();
  });

  it('removes a watch resolving after stop and ignores its late location/error callbacks', async () => {
    const pending = delayNextWatch();
    const request = startTracking('run');
    const watch = await pending.requested;
    const snapshot = stopTracking();
    pending.result.resolve(watch.subscription);
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    const stopped = useTrackingStore.getState();
    watch.callback(fix());
    failWatch(watch);
    expect(useTrackingStore.getState()).toBe(stopped);
    expect(stopped.pendingSummary).toBe(snapshot);
    expect(watch.subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    expect(useUiStore.getState().toast).toBeNull();
  });

  it.each(['start', 'resume'] as const)('cannot revive or overwrite a replacement session when an old %s watch resolves late', async (operation) => {
    if (operation === 'resume') {
      await startTracking('run');
      pauseTracking();
      disposeTracking();
    }
    const pending = delayNextWatch();
    const request = operation === 'start' ? startTracking('run') : resumeTracking();
    const old = await pending.requested;
    stopTracking();
    useTrackingStore.getState().reset();
    at(START_TIME + 2000);
    await startTracking('walk');
    const replacement = watchAt(watches.length - 1);
    const state = useTrackingStore.getState();
    pending.result.resolve(old.subscription);
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    old.callback(fix({ latitude: 30 }));
    failWatch(old);
    expect(useTrackingStore.getState()).toBe(state);
    expect(state).toMatchObject({ status: 'recording', activityType: 'walk', pendingSummary: null });
    expect(old.subscription.remove).toHaveBeenCalledOnce();
    expect(replacement.subscription.remove).not.toHaveBeenCalled();
    replacement.callback(fix({ latitude: -33.86, longitude: -70.64 }));
    expect(useTrackingStore.getState().segments).toEqual([[{ lat: -33.86, lng: -70.64, timestamp: START_TIME + 2000, speed: 3 }]]);
    expect(useUiStore.getState().toast).toBeNull();
    expect(wakeTagAt(mocks.activateKeepAwakeAsync.mock.calls.length - 1)).not.toBe(wakeTagAt());
  });
});

describe('root tracking lifecycle', () => {
  it('subscribes once at mount and removes both store subscriptions at unmount', () => {
    const lifecycle = useMockTrackingLifecycle();
    expect(lifecycle.trackingSpy).toHaveBeenCalledOnce();
    expect(lifecycle.authSpy).toHaveBeenCalledOnce();
    expect(lifecycle.unsubscribeTracking).not.toHaveBeenCalled();
    expect(lifecycle.unsubscribeAuth).not.toHaveBeenCalled();
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
    unmountEffects();
    expect(lifecycle.unsubscribeTracking).toHaveBeenCalledOnce();
    expect(lifecycle.unsubscribeAuth).toHaveBeenCalledOnce();
  });

  it.each(['logout', 'account-switch'] as const)('releases live resources and clears the route on %s without saving another user’s activity', async (event) => {
    useMockTrackingLifecycle();
    await startTracking('run');
    const old = watchAt();
    old.callback(fix());
    at(START_TIME + 2000);
    if (event === 'logout') useAuthStore.getState().clear();
    else useAuthStore.getState().setUser({ uid: 'next-owner', email: null });
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', startedAt: null, segments: [], pendingSummary: null });
    expect(old.subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    const cleared = useTrackingStore.getState();
    old.callback(fix({ latitude: 40 }));
    failWatch(old);
    expect(useTrackingStore.getState()).toBe(cleared);
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('does not dispose GPS for an auth refresh with the same owner UID', async () => {
    useMockTrackingLifecycle();
    await startTracking('run');
    const state = useTrackingStore.getState();
    useAuthStore.getState().setUser({ uid: 'owner', email: 'updated@example.test' });
    expect(useTrackingStore.getState()).toBe(state);
    expect(watchAt().subscription.remove).not.toHaveBeenCalled();
    expect(mocks.deactivateKeepAwake).not.toHaveBeenCalled();
  });

  it('disposes native resources when the tracking store is reset directly', async () => {
    useMockTrackingLifecycle();
    await startTracking('run');
    useTrackingStore.getState().reset();
    expect(watchAt().subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    const cleared = useTrackingStore.getState();
    watchAt().callback(fix());
    expect(useTrackingStore.getState()).toBe(cleared);
    expect(cleared.pendingSummary).toBeNull();
  });

  it('does not double-remove resources when engine stop also triggers the root idle subscription', async () => {
    useMockTrackingLifecycle();
    await startTracking('run');
    const snapshot = stopTracking();
    expect(useTrackingStore.getState().pendingSummary).toBe(snapshot);
    expect(watchAt().subscription.remove).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
  });

  it('pauses before unmount disposes resources, preserving the session without charging the unmounted gap', async () => {
    const lifecycle = useMockTrackingLifecycle();
    await startTracking('run');
    watchAt().callback(fix());
    const route = useTrackingStore.getState().segments;
    const statusesAtRemoval: TrackingStatus[] = [];
    watchAt().subscription.remove.mockImplementationOnce(() => { statusesAtRemoval.push(useTrackingStore.getState().status); });
    at(START_TIME + 5000);
    unmountEffects();
    expect(statusesAtRemoval).toEqual(['paused']);
    expect(useTrackingStore.getState()).toMatchObject({ status: 'paused', pauseStartedAt: START_TIME + 5000, pendingSummary: null });
    expect(useTrackingStore.getState().segments).toBe(route);
    expect(lifecycle.unsubscribeTracking).toHaveBeenCalledOnce();
    expect(lifecycle.unsubscribeAuth).toHaveBeenCalledOnce();
    expect(appStateListeners[0]?.remove).toHaveBeenCalledOnce();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledOnce();
    at(START_TIME + 55_000);
    expect(computeElapsedMs(useTrackingStore.getState(), Date.now())).toBe(5000);
    await resumeTracking();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'recording', totalPausedMs: 50_000 });
    expect(mocks.watchPositionAsync).toHaveBeenCalledTimes(2);
    expect(useTrackingStore.getState().segments[0]).toBe(route[0]);
  });

  it('removes a late startup watch after logout without reviving or wiping a new owner’s session', async () => {
    useMockTrackingLifecycle();
    const pending = delayNextWatch();
    const request = startTracking('run');
    const old = await pending.requested;
    useAuthStore.getState().clear();
    expect(useTrackingStore.getState()).toMatchObject({ status: 'idle', segments: [], pendingSummary: null });
    useAuthStore.getState().setUser({ uid: 'next-owner', email: null });
    at(START_TIME + 2000);
    await startTracking('walk');
    const replacement = watchAt(1);
    const state = useTrackingStore.getState();
    pending.result.resolve(old.subscription);
    await expect(request).rejects.toMatchObject({ code: 'cancelled' });
    old.callback(fix({ latitude: 30 }));
    failWatch(old);
    expect(useTrackingStore.getState()).toBe(state);
    expect(old.subscription.remove).toHaveBeenCalledOnce();
    expect(replacement.subscription.remove).not.toHaveBeenCalled();
    expect(mocks.deactivateKeepAwake).toHaveBeenCalledTimes(1);
    replacement.callback(fix({ latitude: -33.86, longitude: -70.64 }));
    expect(useTrackingStore.getState().segments[0]).toHaveLength(1);
  });
});

describe('elapsed view hook without a renderer', () => {
  it.each(['idle', 'paused', 'disabled'] as const)('does not create a view interval when %s', (mode) => {
    if (mode !== 'idle') useTrackingStore.getState().start('run');
    if (mode === 'paused') {
      at(START_TIME + 5000);
      useTrackingStore.getState().pause();
    }
    at(START_TIME + 50_000);
    expect(useElapsedMs(mode !== 'disabled')).toBe(mode === 'idle' ? 0 : mode === 'paused' ? 5000 : 50_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.onTick).not.toHaveBeenCalled();
  });

  it('refreshes once per second, derives elapsed time from timestamps, and clears its interval at disposal', () => {
    useTrackingStore.getState().start('run');
    at(START_TIME + 2500);
    expect(useElapsedMs()).toBe(2500);
    expect(mocks.useCallback).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({ subscribe: expect.any(Function), getSnapshot: expect.any(Function) }),
      true, START_TIME, null,
    ]);
    expect(mocks.onTick).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3000);
    expect(mocks.onTick).toHaveBeenCalledTimes(4);
    const getSnapshot = mocks.useSyncExternalStore.mock.calls[0]?.[1];
    if (!getSnapshot) throw new Error('Expected the hook to read the elapsed clock.');
    expect(getSnapshot()).toBe(START_TIME + 5500);
    at(START_TIME + 65_000);
    vi.advanceTimersByTime(1000);
    expect(getSnapshot()).toBe(START_TIME + 66_000);
    expect(mocks.onTick).toHaveBeenCalledTimes(5);
    unmountEffects();
    expect(vi.getTimerCount()).toBe(0);
    const count = mocks.onTick.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(mocks.onTick).toHaveBeenCalledTimes(count);
    expect(mocks.watchPositionAsync).not.toHaveBeenCalled();
    expect(mocks.activateKeepAwakeAsync).not.toHaveBeenCalled();
  });

  it('freezes at the pause timestamp and derives correct elapsed time after Resume and view remounts', () => {
    useTrackingStore.getState().start('run');
    at(START_TIME + 10_000);
    useTrackingStore.getState().pause();
    at(START_TIME + 50_000);
    expect(useElapsedMs()).toBe(10_000);
    expect(mocks.useCallback).toHaveBeenCalledWith(expect.any(Function), [
      expect.objectContaining({ subscribe: expect.any(Function), getSnapshot: expect.any(Function) }),
      true, START_TIME, START_TIME + 10_000,
    ]);
    expect(vi.getTimerCount()).toBe(0);
    unmountEffects();
    at(START_TIME + 60_000);
    useTrackingStore.getState().resume();
    at(START_TIME + 65_000);
    expect(useElapsedMs()).toBe(15_000);
    expect(vi.getTimerCount()).toBe(1);
    unmountEffects();
    at(START_TIME + 100_000);
    expect(useElapsedMs()).toBe(50_000);
    unmountEffects();
    expect(vi.getTimerCount()).toBe(0);
  });
});
