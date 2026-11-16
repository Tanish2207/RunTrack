# 016 — Local-first save: SQLite `pending_activities` queue

> **Milestone:** M4 · **Labels:** `offline`, `sqlite`, `core` · **Depends on:** #013 · **Size:** M

## Summary

Implement spec §3.5's offline-first guarantee: **every** save writes to a local SQLite
table first, then attempts Firestore immediately if online. Nothing is ever lost, and the
UI never blocks on network during Save.

## Tasks

- [x] `src/services/db.ts` — `expo-sqlite` (`openDatabaseAsync('runtrack.db')`), migration:
  ```sql
  CREATE TABLE IF NOT EXISTS pending_activities (
    localId TEXT PRIMARY KEY,
    firestoreId TEXT,              -- addition vs spec §4: prevents duplicate pushes on retry
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    startTime INTEGER NOT NULL, endTime INTEGER NOT NULL,
    distanceKm REAL NOT NULL, durationSec INTEGER NOT NULL,
    avgPaceSecPerKm REAL NOT NULL, caloriesEstimate REAL NOT NULL,
    route TEXT NOT NULL,           -- JSON string of RoutePoint[]
    aiSummary TEXT,
    synced INTEGER NOT NULL DEFAULT 0,
    retryCount INTEGER NOT NULL DEFAULT 0,
    lastAttempt INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );
  ```
  Helpers: `insertPending(row)`, `markSynced(localId, firestoreId)`, `markFailed(localId)`, `getUnsynced()`, `getPendingCount()`, `updateAiSummary(localId, text)` (for #019), `purgeSyncedOlderThan(days = 30)`.
- [x] Rewrite `saveActivityFlow` (from #013) to the local-first sequence:
  1. Build row from the snapshot; `insertPending` (always, even online).
  2. Update `syncStore.pendingCount` (+1).
  3. If `NetInfo.fetchState().isInternetReachable` → attempt `saveActivity` immediately; success → `markSynced` (+ gamification + AI hooks as in #013, still non-blocking); failure → leave unsynced, worker (#017) retries. Return the `localId` either way.
  - Implemented as `saveActivityFlow(input) → { localId, firestoreId | null }` in
    `src/services/saveFlow.ts`, with `src/services/network.ts` wrapping the NetInfo
    probe (`null` reachability counts as reachable). If the SQLite write itself
    fails (e.g. web without wasm), the flow falls back to the #013 direct push.
- [x] Save UX update (#014 flow): Save resolves as soon as the local write lands → toast "Activity saved (offline — will sync)" when the Firestore attempt failed/was skipped. Never blocks on network.
- [x] Route JSON: `JSON.stringify(points)`; parse back on push. A 5400-point route ≈ ~350 KB string — fine for SQLite and under Firestore's 1 MiB doc limit on push.

## Acceptance Criteria

- [ ] With airplane mode ON: Save succeeds instantly, row exists in `pending_activities` with `synced = 0`, Firestore has nothing. *(needs device + Expo Go/dev build)*
- [ ] With airplane mode OFF: row is written then synced and marked `synced = 1` with a `firestoreId`; Firestore doc matches. *(needs device + real Firebase)*
- [ ] Killing the app right after an offline save loses nothing (row persists). *(needs device)*
- [x] `purgeSyncedOlderThan` keeps the table from growing forever (call it on app start + after each successful sync pass). *(app-start call landed in `src/app/_layout.tsx`; the per-sync-pass call is #017)*
- [x] #014's Save button no longer stalls when offline. *(unit-verified; device check pending)*

## Implementation Notes

- Use the promise-based expo-sqlite API (`execAsync`/`runAsync`/`getAllAsync`) — not callbacks.
- `firestoreId` is our one spec deviation (additive) — justify in `docs/DECISIONS.md`: idempotent retries in #017 need it because activities are create-only with no server-side dedup.
- Keep the immediate-attempt inside a try/catch that can never fail the local path.
- Status (2026-11-16): implemented and covered by unit tests (`src/services/__tests__/db.test.ts`,
  `network.test.ts`, rewritten `saveFlow.test.ts`, updated `activityReview.test.ts` and the
  Summary screen test) — lint/strict typecheck clean, `npm test` 575 tests / 24 files,
  `expo-doctor` 20/20. A push failure now *resolves* the save (queued offline) instead of
  rejecting it; only a failed queue write + failed fallback push rejects. Device/Firestore
  acceptance above remains unchecked.
