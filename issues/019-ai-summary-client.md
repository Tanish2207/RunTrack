# 019 — Client AI-summary integration (non-blocking)

> **Milestone:** M5 · **Labels:** `ai`, `ui` · **Depends on:** #013, #014, #018 · **Size:** M

## Summary

Spec §3.6 client side: after Save, call the callable with current + last-5 stats, show the
recap in the reserved highlighted card with a spinner, persist it to the activity doc as
`aiSummary`, and guarantee the feature can **never** block or fail saving.

## Tasks

- [ ] `src/api/cloudFunctions.ts`: `getFunctions(app)` (+ `connectFunctionsEmulator` under `__DEV__`), `callGenerateWorkoutSummary(input)` typed wrapper with a built-in timeout via `Promise.race` (12s).
- [ ] Implement the `generateAndAttachSummary(activityIdOrLocalRow, input, recent)` stub from #013:
  1. Fetch `fetchRecentActivities(uid, 5)` excluding the current activity.
  2. Call the callable; on success:
     - Row synced → `updateActivity(id, { aiSummary })`.
     - Row unsynced (offline save not yet pushed) → `updateAiSummary(localId, text)` in SQLite (#016 helper); the worker pushes it with the doc, or `updateActivity` after sync (#017 covers the after-sync case).
  3. Any failure (no internet, function error, timeout) → silently skip; **never** throws, **never** blocks save/navigation.
- [ ] Wire `AiSummaryCard` (#014's reserved slot): `loading` → spinner + "Writing your recap…"; `ready` → the text in the highlighted card; `hidden` on failure. Update Activity Detail (#015) automatically via the stored field (no extra work).
- [ ] Flow placement: called from `saveActivityFlow` **after** the save resolves; the Summary screen may already be navigating — the card must update in place if still mounted (drive card state from a small `uiStore`-style ephemeral store or local state keyed by `activityId`).
- [ ] Also fire for offline-synced activities from the sync worker path (#017) — recap appears in Detail after sync.

## Acceptance Criteria

- [ ] Online save → card spins → recap appears → `aiSummary` field set on the Firestore doc → visible in Activity Detail later.
- [ ] Callable unreachable/fails → card goes `hidden`, save flow unaffected, no error toast spam (silent per spec).
- [ ] Never blocks: navigating away during the call causes no crash/leak (unsubscribe/ignore resolution).
- [ ] Timeout (12s) behaves like failure.
- [ ] Offline save → sync → recap still generated and attached.

## Implementation Notes

- The card on Summary is best-effort live; Detail is the durable home for the recap.
- If `updateActivity` races the worker's push (both writing `aiSummary`), last-write-wins is fine — the text is identical or newer.
- Add one `__DEV__` log of call duration; strip in #028.
