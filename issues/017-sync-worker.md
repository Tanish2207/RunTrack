# 017 — Sync worker (NetInfo + exponential backoff) + pending-sync banner

> **Milestone:** M4 · **Labels:** `offline`, `core` · **Depends on:** #015, #016 · **Size:** L

## Summary

Spec §3.5's sync worker: on connectivity restore (and app start / app foreground), push all
`synced = 0` rows to Firestore in order, mark them synced, retry failures with exponential
backoff, and surface live state via the History banner ("2 activities pending sync").

## Tasks

- [ ] `src/services/syncWorker.ts`:
  - `initSyncWorker()` (call from `RootNavigator` mount): register `NetInfo.addEventListener` → when `isInternetReachable` flips truthy → `syncNow()`; also run `syncNow()` once on init.
  - `syncNow()`: guard against concurrent runs (`syncStore.syncInProgress`); `getUnsynced()` ordered by `createdAt ASC`; for each row:
    - Skip rows in backoff: `now < lastAttempt + min(2^retryCount * 15s, 5min)`.
    - If `firestoreId` already set → just `markSynced` (crash-recovery path).
    - `saveActivity(rowToInput(row))` → `markSynced(localId, firestoreId)` → `retryCount = 0`.
    - Failure → `markFailed(localId)` (increments `retryCount`, sets `lastAttempt`) and continue with the rest.
    - After each successful push, run the gamification + AI hooks for that activity (offline-saved runs must still earn badges/streaks/recaps).
  - End of pass: refresh `syncStore.pendingCount`; `purgeSyncedOlderThan(30)`.
- [ ] `usePendingSyncCount()` hook + `SyncBanner` component (top of History per #015's slot): hidden at 0; "⏳ N activities pending sync" otherwise; subtle "Syncing…" state while `syncInProgress`.
- [ ] Also trigger `syncNow()` on app foreground (AppState listener) — NetInfo only fires on connectivity *change*, but the app may be backgrounded when Wi-Fi returns.
- [ ] AI summary interplay (#019): if a row gets its `aiSummary` before syncing, push it as part of the activity doc; if it arrives after sync, `updateActivity(id, { aiSummary })`.

## Acceptance Criteria

- [ ] Airplane-mode save → turn Wi-Fi back on → row(s) push to Firestore in order, marked synced, banner disappears, History list gains the rows (onSnapshot).
- [ ] Forced-failure test (e.g. temporarily bad rule) → `retryCount` increments; successful pass after rule fix pushes everything; no duplicate Firestore docs (multiple saves + retries → exactly one doc per activity).
- [ ] Banner shows the correct count in all states (pending / syncing / zero).
- [ ] Sync survives app restart (unsynced rows from a previous session push on next launch).
- [ ] A run saved offline still triggers badges/streak/AI hooks at sync time, not just at online save time.

## Implementation Notes

- Push in `createdAt ASC` order so streaks/lastActivityDate (#021) evaluate chronologically even for batch offline saves.
- `isInternetReachable` can be `null` on some platforms — treat `null` as "unknown, attempt anyway" on explicit `syncNow()` calls, but don't count it as a restore event.
- Keep the worker module-level singleton; screens never call Firestore push directly.
