# 005 — Global state stores (Zustand)

> **Milestone:** M1 · **Labels:** `state`, `architecture` · **Depends on:** #001 · **Size:** S

## Summary

Create the Zustand stores that carry global state per spec §7: auth/session, the active
tracking session, persisted settings, and a tiny UI store for toasts. History/Detail/
Heatmap data deliberately stays in component-level `useEffect` + Firestore calls — not
in these stores.

## Tasks

- [x] `src/stores/authStore.ts`:
  ```ts
  { user: { uid, email } | null,
    profile: UserProfile | null,          // users/{uid} doc shape (spec §4)
    initializing: boolean,                // true until first onAuthStateChanged fires (#007)
    setUser, setProfile, clear }
  ```
- [x] `src/stores/trackingStore.ts` — the live session state machine:
  ```ts
  { status: 'idle' | 'recording' | 'paused',
    activityType: 'run' | 'cycle' | 'walk',
    segments: RoutePoint[][],             // route split by pauses (each segment → one Polyline)
    startedAt: number | null,             // epoch ms
    totalPausedMs: number,
    pauseStartedAt: number | null,
    lastAnnouncedKm: number,              // voice coach trigger state (#023)
    pendingSummary: SessionSnapshot | null, // set on Stop, consumed by Summary screen (#014)
    actions: start(type), pause(), resume(), appendPoint(p), stop() → snapshot, reset() }
  ```
  `RoutePoint = { lat: number; lng: number; timestamp: number }` (+ optional `speed`).
- [x] `src/stores/settingsStore.ts` — persisted with `zustand/middleware` `persist` + AsyncStorage:
  ```ts
  { voiceCoachingEnabled: boolean,        // default true (#023 mute toggle)
    weightKg: number,                     // default 70, editable in Profile (#022)
    setVoiceCoachingEnabled, setWeightKg }
  ```
- [x] `src/stores/syncStore.ts` — `{ pendingCount: number, syncInProgress: boolean, setPendingCount, setSyncInProgress }` (drives the History banner in #017).
- [x] `src/stores/uiStore.ts` — `{ toast: { message, type } | null, showToast(message, type?) , clearToast }` consumed by the `Toast` component from #002.
- [ ] Wire `settingsStore` persistence and verify it survives app reload.
  > Persistence is wired (persist middleware + AsyncStorage, key `runtrack-settings`); restart survival needs a device/dev-build run.

## Acceptance Criteria

- [x] All five stores exist with the shapes above and compile under strict TS.
- [ ] `settingsStore` values persist across a full app restart.
  > Requires runtime verification on a device/dev build; rehydration via `createJSONStorage(() => AsyncStorage)` is wired, not yet runtime-proven.
- [ ] `trackingStore.pause()/resume()` math is unit-testable in isolation: elapsed = `now - startedAt - (totalPausedMs + (paused ? now - pauseStartedAt : 0))`.
  > Math is pure and side-effect-free (all inputs explicit, `Date.now()` only inside actions), but no test runner is configured in this milestone yet, so no unit test proves it.
- [x] No store fetches from Firestore directly (repos in #013 own I/O; stores own state).

## Implementation Notes

- Keep actions as plain reducers over state (no side effects inside stores except `persist` rehydration); the tracking engine (#010) is the caller that feeds points in.
- `SessionSnapshot` type (shared with #014): `{ activityType, points, startedAt, endedAt, durationSec, distanceKm, avgPaceSecPerKm, caloriesEstimate }`.
- `UserProfile` / `Activity` / `ActivityType` types live in `src/api/types.ts` (created here, filled per spec §4) so stores don't import Firebase code.

## Agent Log

- Created `src/stores/authStore.ts`, `src/stores/trackingStore.ts`, `src/stores/settingsStore.ts`, `src/stores/syncStore.ts` exactly per the ticket interfaces; `uiStore.ts` already existed (from #002) and was left untouched. Nothing else modified.
- `trackingStore` action guards implemented: `start` only from `idle` (clears any stale `pendingSummary`), `pause` only from `recording`, `resume` only from `paused` (folds `now - pauseStartedAt` into `totalPausedMs`, pushes a new empty segment for the polyline break), `appendPoint` only while `recording` (blind append to the last segment), `stop` returns `null` and changes nothing when `idle` or `startedAt === null`.
- `stop(weightKg)` folds the open pause span into `totalPausedMs` before computing, delegates stats to pure `computeSessionStats` from `src/utils/stats.ts`, stores the snapshot in `pendingSummary`, and resets all live fields while keeping it; `reset()` is the only action that clears `pendingSummary`.
- `settingsStore` uses zustand v5 `create<T>()` + `persist` with `createJSONStorage(() => AsyncStorage)`, key `runtrack-settings`, defaults `voiceCoachingEnabled: true`, `weightKg: 70`; no validation added (deferred to UI per ticket).
- No store imports Firebase or performs I/O other than the settings persist middleware; each store has a header comment naming its writers and consumers.
- Verification: `npx tsc --noEmit` → exit code 0 (whole project, strict mode, zero errors). Deferred: device-run checks for settings persistence across restart and a unit test for pause/resume math (no test runner configured in M1).
