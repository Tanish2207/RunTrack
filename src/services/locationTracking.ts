import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { ActivityType, SessionSnapshot } from '../api/types';
import { useAuthStore } from '../stores/authStore';
import { useTrackingStore } from '../stores/trackingStore';
import { useUiStore } from '../stores/uiStore';
import { filterLocationFix } from '../utils/locationFix';
import { createElapsedClock } from '../utils/elapsedClock';
import { DEFAULT_WEIGHT_KG } from '../utils/stats';
import { computeElapsedMs } from '../utils/tracking';
import { ensureForegroundLocation } from './permissions';

export const WATCH_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.Highest,
  timeInterval: 2000, // Android-only minimum interval; iOS uses distanceInterval.
  distanceInterval: 5,
};

export type TrackingErrorCode =
  | 'permission-denied' | 'permission-blocked' | 'services-disabled'
  | 'not-foreground' | 'session-pending' | 'cancelled' | 'location-unavailable';

export class TrackingError extends Error {
  constructor(public readonly code: TrackingErrorCode, message: string) {
    super(message);
    this.name = 'TrackingError';
  }
}

// Engine-owned resources survive tab/screen re-mounts. Generation tokens stop
// late native subscriptions and old callbacks from reviving a stopped session.
let generation = 0;
let watchGeneration = 0;
let subscription: Location.LocationSubscription | null = null;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
let starting: Promise<void> | null = null;
let resuming: Promise<void> | null = null;
let wakeTag: string | null = null;
let segmentStartedAt = 0;

function releaseWakeLock(tag: string | null): void {
  if (!tag) return;
  try { void deactivateKeepAwake(tag).catch(() => undefined); }
  catch { /* Cleanup must still finish if the native Activity is gone. */ }
}

function removeNativeSubscription(resource: { remove: () => void } | null): void {
  try { resource?.remove(); }
  catch { /* An expired native resource must not prevent the rest of cleanup. */ }
}

function removeWatch(): void {
  watchGeneration++;
  const watch = subscription;
  subscription = null;
  removeNativeSubscription(watch);
}

/** Resource cleanup only: caller decides whether to keep a summary or reset. */
export function disposeTracking(): void {
  generation++;
  removeWatch();
  const listener = appStateSubscription;
  appStateSubscription = null;
  removeNativeSubscription(listener);
  releaseWakeLock(wakeTag);
  wakeTag = null;
  starting = null;
  resuming = null;
}

function assertGeneration(token: number): void {
  if (token !== generation) throw new TrackingError('cancelled', 'Tracking request was cancelled.');
}

function assertForeground(): void {
  if (AppState.currentState && AppState.currentState !== 'active') {
    throw new TrackingError('not-foreground', 'Return to RunTrack to start or resume tracking.');
  }
}

async function checkLocationAccess(token: number): Promise<void> {
  const permission = await ensureForegroundLocation();
  assertGeneration(token);
  if (permission !== 'granted') {
    throw new TrackingError(
      permission === 'blocked' ? 'permission-blocked' : 'permission-denied',
      permission === 'blocked'
        ? 'Allow precise location in Settings before starting.'
        : 'Location permission is needed to record your route.',
    );
  }
  const enabled = await Location.hasServicesEnabledAsync();
  assertGeneration(token);
  if (!enabled) {
    throw new TrackingError('services-disabled', 'Turn on device location services, then try again.');
  }
  assertForeground();
}

function onAppStateChange(state: AppStateStatus): void {
  if ((state === 'background' || state === 'inactive') && useTrackingStore.getState().status === 'recording') {
    pauseTracking();
    useUiStore.getState().showToast('Activity paused: keep RunTrack open, then tap Resume.', 'info');
  }
  // Foreground-only means no automatic resume: no timer or route bridges over
  // an interruption. A deliberate Resume creates a fresh segment.
}

function ensureAppStateListener(token: number): void {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (token === generation) onAppStateChange(state);
  });
}

async function installWatch(token: number): Promise<void> {
  const watchToken = ++watchGeneration;
  let watch: Location.LocationSubscription;
  try {
    watch = await Location.watchPositionAsync(
      WATCH_OPTIONS,
      (fix) => {
        if (token !== generation || watchToken !== watchGeneration ||
          (AppState.currentState && AppState.currentState !== 'active')) return;
        const state = useTrackingStore.getState();
        if (state.status !== 'recording') return;
        const segment = state.segments[state.segments.length - 1] ?? [];
        const previous = segment[segment.length - 1] ?? null;
        const filtered = filterLocationFix(fix, previous, segmentStartedAt, Date.now());
        if (filtered.accepted) state.appendPoint(filtered.point);
      },
      () => {
        if (token !== generation || watchToken !== watchGeneration || useTrackingStore.getState().status === 'idle') return;
        // A native error can terminate the watch, including during a pause.
        // Invalidate its callbacks and force Resume to install a fresh watch.
        removeWatch();
        pauseTracking();
        useUiStore.getState().showToast('GPS interrupted. Check location settings, then tap Resume.', 'error');
      },
    );
  } catch (error) {
    if (token === generation && watchToken === watchGeneration) removeWatch();
    throw error;
  }
  if (token !== generation || useTrackingStore.getState().status === 'idle') {
    removeNativeSubscription(watch);
    assertGeneration(token);
    throw new TrackingError('cancelled', 'Tracking request was cancelled.');
  }
  if (watchToken !== watchGeneration) {
    // An error arrived before watchPositionAsync resolved. Keep the paused
    // session for retry, but never retain the now-failed native subscription.
    removeNativeSubscription(watch);
    return;
  }
  subscription = watch;
  if (AppState.currentState === 'background' || AppState.currentState === 'inactive') {
    onAppStateChange(AppState.currentState);
  }
}

/** Permission → wake lock → session → watch. Failed startup rolls back safely. */
export function startTracking(type: ActivityType): Promise<void> {
  if (starting) return starting;
  if (useTrackingStore.getState().status !== 'idle') return Promise.resolve();
  if (useTrackingStore.getState().pendingSummary) {
    return Promise.reject(new TrackingError('session-pending', 'Save or discard your finished activity first.'));
  }

  const token = ++generation;
  const tag = `runtrack-tracking-${token}`;
  const request = (async () => {
    let sessionStarted = false;
    try {
      await checkLocationAccess(token);
      assertGeneration(token);
      await activateKeepAwakeAsync(tag);
      if (token !== generation) {
        releaseWakeLock(tag);
        assertGeneration(token);
      }
      wakeTag = tag;
      assertForeground();
      const state = useTrackingStore.getState();
      if (state.pendingSummary) {
        throw new TrackingError('session-pending', 'Save or discard your finished activity first.');
      }
      if (state.status !== 'idle') throw new TrackingError('cancelled', 'Another tracking session is already open.');
      useTrackingStore.getState().start(type);
      sessionStarted = true;
      segmentStartedAt = useTrackingStore.getState().startedAt ?? Date.now();
      ensureAppStateListener(token);
      await installWatch(token);
    } catch (error) {
      assertGeneration(token);
      if (token === generation) {
        disposeTracking();
        if (sessionStarted) useTrackingStore.getState().reset();
      }
      if (error instanceof TrackingError) throw error;
      throw new TrackingError('location-unavailable', 'Could not start GPS. Check location services and try again.');
    }
  })();
  starting = request;
  void request.finally(() => {
    if (starting === request) starting = null;
  }).catch(() => undefined);
  return request;
}

/** Keep the watch/wake lock alive on screen; callbacks simply drop paused fixes. */
export function pauseTracking(): void {
  useTrackingStore.getState().pause();
}

export function resumeTracking(): Promise<void> {
  // Start owns the watch until its native subscription resolves. A screen
  // arriving during startup must join it, not recover a second missing watch.
  if (starting) return starting;
  if (resuming) return resuming;
  const state = useTrackingStore.getState();
  if (state.status === 'idle' || (state.status === 'recording' && subscription)) return Promise.resolve();
  // Recover a UI remount with a missing native watch without counting the gap.
  if (state.status === 'recording') state.pause();
  const token = generation;
  const request = (async () => {
    try {
      await checkLocationAccess(token);
      assertGeneration(token);
      if (useTrackingStore.getState().status !== 'paused') return;
      if (!wakeTag) {
        const tag = `runtrack-tracking-${token}`;
        await activateKeepAwakeAsync(tag);
        if (token !== generation) {
          releaseWakeLock(tag);
          assertGeneration(token);
        }
        wakeTag = tag;
      }
      assertForeground();
      segmentStartedAt = Date.now();
      useTrackingStore.getState().resume();
      ensureAppStateListener(token);
      if (!subscription) await installWatch(token);
    } catch (error) {
      assertGeneration(token);
      pauseTracking();
      if (error instanceof TrackingError) throw error;
      throw new TrackingError('location-unavailable', 'Could not resume GPS. Check location services and try again.');
    }
  })();
  resuming = request;
  void request.finally(() => {
    if (resuming === request) resuming = null;
  }).catch(() => undefined);
  return request;
}

export function stopTracking(weightKg: number = DEFAULT_WEIGHT_KG): SessionSnapshot | null {
  disposeTracking();
  return useTrackingStore.getState().stop(weightKg);
}

/** A view ticker only: timestamps remain authoritative after tab switches. */
export function useElapsedMs(ticking = true): number {
  const startedAt = useTrackingStore((state) => state.startedAt);
  const totalPausedMs = useTrackingStore((state) => state.totalPausedMs);
  const pauseStartedAt = useTrackingStore((state) => state.pauseStartedAt);
  const [clock] = useState(createElapsedClock);
  const subscribe = useCallback((onTick: () => void) => {
    if (!ticking || startedAt === null || pauseStartedAt !== null) return () => {};
    return clock.subscribe(onTick);
  }, [clock, ticking, startedAt, pauseStartedAt]);
  const now = useSyncExternalStore(subscribe, clock.getSnapshot, getServerClockSnapshot);
  return computeElapsedMs({ startedAt, totalPausedMs, pauseStartedAt }, now);
}

const getServerClockSnapshot = () => 0;

/** Mount once at the root, not per screen: logout/unmount cannot leak GPS. */
export function useTrackingLifecycle(): void {
  useEffect(() => {
    // Fast Refresh/root remounts may preserve state but not native resources.
    if (useTrackingStore.getState().status === 'recording' && !subscription && !starting) pauseTracking();
    const unsubscribeTracking = useTrackingStore.subscribe((state, previous) => {
      if (state.status === 'idle' && previous.status !== 'idle') disposeTracking();
    });
    const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
      if (state.user?.uid !== previous.user?.uid) {
        disposeTracking();
        useTrackingStore.getState().reset();
      }
    });
    return () => {
      unsubscribeTracking();
      unsubscribeAuth();
      pauseTracking();
      disposeTracking();
    };
  }, []);
}
