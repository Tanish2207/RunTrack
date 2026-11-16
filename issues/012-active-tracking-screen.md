# 012 — Active Tracking screen (live polyline, stats HUD, controls)

> **Milestone:** M2 · **Labels:** `ui`, `gps`, `core` · **Depends on:** #010, #011 · **Size:** L

## Summary

The live-run screen per spec §3.2/§6: full-screen map with a growing polyline + user
marker, a big legible stats HUD (elapsed time, distance, current pace), Pause/Resume,
Stop behind an explicit confirmation, and the voice-coach mute toggle (top-right — the
TTS announcements themselves are #023).

## Tasks

- [x] `src/screens/track/ActiveTrackingScreen.tsx`:
  - MapView following the user; current-location marker; `Polyline` per `trackingStore.segments` (theme accent, width 5) — segments give the pause-break visual for free.
  - Subscribe to `trackingStore` points to update the polyline; keep camera centered (re-center on each point).
  - Stats HUD bottom panel (Card, large monospaced digits):
    - Elapsed time: 1s ticker using #010's `useElapsedMs()` math (never accumulate on tick — derive from timestamps so it can't drift).
    - Distance: `computeSegmentDistanceKm`, 2 decimals; paused movement never adds a gap connector.
    - Current pace: `currentPaceSecPerKm` uses recent valid speeds, with an overall average fallback; paused/unavailable values display "—".
  - Controls row: **Pause/Resume** (single toggle button) and **Stop** (destructive styling).
  - **Stop confirmation (spec-required):** shared native/web confirmation explains that Finish keeps the activity for review, not persistence. On Finish → `stopTracking(weightKg)` → `pendingSummary` → Router replaces Active with `/(tabs)/track/summary`; disable removal prevention before navigation. Late dialogs check owner/session/mounting.
  - Mute/unmute icon top-right: toggles `settingsStore.voiceCoachingEnabled` (persisted preference from #005). Icon state reflects the store.
  - **No screen-owned keep-awake calls.** #010's engine owns one lock across screen/tab changes; root lifecycle cleanup handles logout/unmount.
- [x] Idle route redirects to pending Summary or Track; `usePreventRemove` requires Finish confirmation before removing a live session.
- [x] Paused HUD, permission/Resume feedback, and always-available Stop. Inactive/background transitions pause and returning requires explicit Resume.

## Acceptance Criteria

- [ ] Polyline grows live as the emulator route advances; breaks appear at pauses.
- [ ] HUD updates every second (time) and on new fixes (distance/pace) with correct pause math (pause 30s → elapsed excludes it).
- [ ] Single accidental Stop tap never ends the run — dialog required.
- [ ] Pause/Resume toggles correctly, Stop→Finish produces a `pendingSummary` and navigates to Summary.
- [ ] Mute toggle persists across app restarts (settingsStore persistence).
- [ ] Screen stays awake during recording (no auto-lock) — foreground-only path.

## Implementation Notes

- Store selectors and a focus-aware timestamp clock drive the HUD. `RouteMap`, route lines, and recorded marker are memoized, so the one-second ticker does not redraw unchanged map content.
- If the app is killed mid-run, the run is lost (nothing persisted until Save) — acceptable for scope per spec §3.4 ordering; note it in the writeup (#028).
- Keep all stats math in #009/#010 helpers; this file is UI only.

## Verification

Implementation complete. Engine/store/stat/clock unit tests verify pause math,
segment breaks, cleanup, and interruption logic; lint/typecheck/export pass.
All native acceptance above (including alerts/back gestures, Maps, restart
settings persistence, and screen awake behavior) remains unperformed. Follow
`docs/TRACKING_QA.md`; no renderer or device checks are claimed.
