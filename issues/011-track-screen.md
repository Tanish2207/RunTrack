# 011 — Track screen (map, activity selector, Start)

> **Milestone:** M2 · **Labels:** `ui`, `gps` · **Depends on:** #002, #010 · **Size:** S

## Summary

Build the Track tab home per spec §3.2/§6: full-screen map centered on the user's location,
Run/Cycle/Walk selector, and one prominent primary Start button — the launch point into
Active Tracking.

## Tasks

- [x] `src/screens/track/TrackScreen.tsx`:
  - Shared native `RouteMap` fills the screen with Google provider on both platforms, foreground/permitted `showsUserLocation`, and imperative camera following. Google Maps does not use the Apple-only `followsUserLocation` prop. Web gets an informational fallback.
  - Request permission on first focus via #010's `ensureForegroundLocation()`; render an explanation + "Open Settings" button when `blocked`.
  - Activity-type selector: segmented control (three chips with icons + labels) writing to local state (default Run).
  - Safe-area-aware primary **Start** with loading/error feedback; disabled until access is granted. `await startTracking(type)` owns store startup, then Router pushes `/(tabs)/track/active` with an anchor. Busy guard prevents duplicate UI starts.
- [x] Existing in-memory live/paused session shows **Continue activity**; a pending snapshot shows **Review activity** instead of Start. Paused recording only resumes from explicit live controls. **Process death is not recoverable.**
- [x] GPS acquisition/accuracy hint from native map preview, and persistent foreground-only explanation.

## Acceptance Criteria

- [ ] Map renders centered on device/emulator location; user location dot visible.
- [ ] Type selector switches Run/Cycle/Walk and the choice carries into the session.
- [ ] Start with permission denied is disabled/redirects to settings; never crashes without permission.
- [ ] Start navigates to Active Tracking with a recording session already ticking.
- [x] Theme-token styling and primary-button component are implemented (source inspection/lint); visual device review remains pending.

## Implementation Notes

- Provider choice: `provider={PROVIDER_GOOGLE}` on native platforms. Own binaries require separately configured Android/iOS Maps keys in the `react-native-maps` config plugin; see `docs/FIREBASE_SETUP.md` and #027. No real keys have been supplied.
- `useForegroundLocation` requests on first focus and rechecks on later focus/return from Settings; `RouteMap` supplies preview events. The tracking engine alone owns the recording watch.

## Verification

Implementation, lint, typecheck, and Android bundling pass. Permission/engine logic
is covered by mocked unit tests, not native rendering. All map/selector/Start
device acceptance above remains pending in `docs/TRACKING_QA.md`.
