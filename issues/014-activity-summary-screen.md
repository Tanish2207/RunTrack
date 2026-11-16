# 014 — Activity Summary screen (Save / Discard)

> **Milestone:** M3 · **Labels:** `ui`, `core` · **Depends on:** #009, #012, #013 · **Size:** M

## Summary

Post-tracking, pre-save screen per spec §3.2/§6: static route map, stats grid, AI-summary
card slot (wired in #019), primary **Save Activity**, secondary **Discard** with confirm.
Nothing is committed to Firestore until Save is tapped.

## Tasks

- [x] `src/screens/track/ActivitySummaryScreen.tsx`:
  - Consume `trackingStore.pendingSummary` (redirect to Track if null). Ordinary navigation does not clear review; capture/retain the snapshot while a successful resolution resets the store and navigation is completing. Prevent removal during Save.
  - Static shared `RouteMap` fits all coordinates after map readiness/layout and draws one polyline per frozen `snapshot.segments`, preserving pause breaks; web has an informational fallback.
  - Stats grid: four `StatTile`s — Distance, Duration, Avg Pace, Calories (all from the snapshot via #009 formatters).
  - AI summary card: `AiSummaryCard` component with states `loading | ready | hidden`; renders spinner in `loading`; **#019** drives it — until then it renders `hidden`.
  - **Save Activity** (primary): loading → `savePendingActivity()` → save flow; matching owner/snapshot alone may reset review. Success toast, disable prevention, `router.dismissTo('/(tabs)/track')`, then `router.navigate('/(tabs)/history')`. History rows remain #015.
  - **Discard** (secondary): shared destructive confirmation → `discardPendingActivity()` → disable prevention and dismiss to Track only; cancel leaves review untouched. Stale dialogs cannot discard another owner's/replaced snapshot.
  - Save error path: toast "Save failed — activity kept on screen; try again" and keep the run (do not reset store). Offline handling of Save itself is #016's job — for now a network failure surfaces the toast.
- [x] `src/services/activityReview.ts`: `WeakMap<SessionSnapshot, Map<userId, Promise<activityId>>>` shares simultaneous saves; Discard is blocked while that snapshot has any in-flight save. Completion checks owner/snapshot before reset.

## Acceptance Criteria

- [ ] Map fits the whole route with padding; route matches what was just recorded.
- [x] Stats grid reads the frozen snapshot using shared formatters (orchestration unit tests/source); live-to-summary visual/device comparison remains pending.
- [ ] Save → Firestore doc exists (verify in console) → toast → lands on History with the new row (row list is #015; navigating there with an empty list until then is acceptable).
- [x] Discard requires confirmation and the discard service never writes to Firestore (unit tests; native dialog acceptance pending).
- [x] Save failure retains the same snapshot and restores retry; Save shows loading/guards duplicate actions (unit tests with controlled hooks).
- [ ] Device Back/swipe behavior, real Save/Discard transitions, logout/late dialogs, and map rendering pass `docs/TRACKING_QA.md`.

## Implementation Notes

- `snapshotToActivityInput` helper lives in `src/services/saveFlow.ts` — single conversion point reused by tests.
- Do not trigger the AI call here directly; it belongs to the pipeline (#019) so offline-synced saves (#017) get recaps too.
- Keep the AI card reserved/hidden (not conditionally absent) so layout doesn't shift when #019 lands.

## Verification

**34 review-service and 35 Summary-orchestration tests pass**, covering save
coalescing/retry, review retention, navigation order, discard/no-write, and stale
owner/dialog callbacks. Lint/typecheck/full tests and Android export pass.
Orchestration tests inspect JSX and explicitly drive mocked hooks; native
rendering, React scheduling, alerts, maps, actual Router transitions, and backend
persistence remain unverified. Do not check the real Save/map criteria until QA.
