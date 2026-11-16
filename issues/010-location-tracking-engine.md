# 010 — Location permissions + GPS tracking engine

> **Milestone:** M2 · **Labels:** `core`, `gps` · **Depends on:** #005, #009 · **Size:** L

## Summary

Build the tracking heart of the app (spec §3.2): a `services/locationTracking.ts` engine
that owns the `watchPositionAsync` subscription, filters bad GPS fixes, feeds points into
`trackingStore`, and implements pause/resume semantics. Also settle the background-location
question with a time-boxed spike, defaulting to the spec's documented foreground-only
fallback.

## Tasks

- [x] Permission helper `src/services/permissions.ts`: coalesced `ensureForegroundLocation()` checks/requests foreground access and returns `granted | denied | blocked`; approximate/reduced access is blocked with an Open Settings recovery action.
- [x] **Background decision:** a documentation-only feasibility review chose foreground-only tracking; no native spike/build loop was performed. The engine owns keep-awake, inactive/background transitions auto-pause, and explicit Resume is required. Decision and limitations recorded in `docs/DECISIONS.md`; background tasks are not implemented.
- [x] Engine `src/services/locationTracking.ts`:
  - `startTracking(type)` — recheck precise permission/services and foreground state, acquire one tagged `activateKeepAwakeAsync` lock, start the store session, then `watchPositionAsync({ accuracy: Location.Accuracy.Highest, timeInterval: 2000, distanceInterval: 5 }, onPoint)`.
  - `onPoint(p)` filters, then `trackingStore.appendPoint(...)`:
    - discard `coords.accuracy > 20 m`;
    - discard teleport jumps: implied speed > 28 m/s (~100 km/h, covers cycling downhill);
    - reject invalid coordinates, missing accuracy, stale/future/out-of-order timestamps; omit unavailable provider speed;
    - point shape: `{ lat, lng, timestamp, speed? }`.
  - `pauseTracking()` — capture pause time; retain watch/wake lock and drop paused fixes. App interruptions automatically pause without auto-resuming.
  - `resumeTracking()` — recheck access, fold the pause span, and start a new segment; replace a failed/missing watch when needed. Resume during pending Start shares Start's promise rather than installing another watch.
  - `stopTracking(weightKg)` — dispose watch/listener/lock via `deactivateKeepAwake(tag)` and build a `SessionSnapshot` with flattened points **and preserved segments**, using #009 stats. Distance sums within segments, never across paused movement.
  - Generation guards, startup/Resume coalescing, root lifecycle cleanup, and safe late-subscription cancellation.
- [x] `useElapsedMs()` derives time from timestamps and pause spans with a cached per-view `useSyncExternalStore` clock; view subscriptions tick every second and refresh immediately on focus/subscription.
- [ ] Emulator/simulator test loop: Android emulator extended controls → load a GPX route; iOS simulator → Freeway Drive. Confirm distance grows plausibly while "moving".

## Acceptance Criteria

- [ ] Walking an emulator GPX route produces a growing `segments` array and correct cumulative distance (spot-check vs. known route length).
- [x] Low-accuracy fixes and teleport spikes are filtered (pure-helper and mocked-engine tests; no per-fix logging added).
- [x] Pause freezes timer/distance; Resume creates a segment; final stats exclude paused time and movement (unit tests).
- [x] Stop returns a complete segmented `SessionSnapshot` using #009 helpers (unit tests).
- [x] Foreground/background decision is recorded in `docs/DECISIONS.md`.
- [ ] Device checks of precise permission/Settings recovery, interruptions, GPS recovery, and wake-lock cleanup pass (`docs/TRACKING_QA.md`).

## Implementation Notes

- The engine is the **only** caller of `watchPositionAsync`; screens call its public actions and read store selectors. Native Maps user-location preview does not add a second recording watch.
- Keep the watch subscription handle in module scope of the service (not React state) so screen re-mounts don't kill tracking.
- SDK 58: `timeInterval` is an **Android-only minimum interval**; `distanceInterval` is a movement threshold. Do not promise an either-condition trigger or a fixed iOS cadence. See https://docs.expo.dev/versions/v58.0.0/sdk/location.md.
- Android emulator GPS is jumpy — trust the filters, test with a smooth GPX file.

## Verification

Implementation complete; native acceptance pending. **70 engine, 37 permission,
and 8 elapsed-clock tests pass**, alongside store/stats/filter tests. Full batch
lint/typecheck and 391 tests pass; Expo Doctor is 20/20 and Android export succeeds.
Mocks/export do not establish hardware or backend behavior. See `issues/README.md`
and `docs/TRACKING_QA.md` for evidence and pending checks.
