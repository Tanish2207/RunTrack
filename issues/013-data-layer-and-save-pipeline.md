# 013 — Data layer: Firestore repositories + save pipeline

> **Milestone:** M3 · **Labels:** `data`, `firestore`, `architecture` · **Depends on:** #003, #005 · **Size:** M

## Summary

Centralize all Firestore I/O behind repositories (`src/api/`) per spec §3.4/§4, and define
the `saveActivity` pipeline that later tickets extend: save → gamification hook (#020/#021)
→ AI summary hook (#019). Online-first in this ticket; the local SQLite-first rewrite is #016.

## Tasks

- [x] `src/api/types.ts`: strict domain/input types and segmented review snapshot; epoch-ms times in the app, Timestamps at the repository boundary.
- [x] `src/api/users.ts`:
  - `ensureUserProfile(uid, fallbacks)` — transaction-based idempotent defaults-doc creation (used by #006/#007), preserving an existing profile.
  - `getUserProfile(uid)`, `subscribeUserProfile(uid, cb)` (`onSnapshot` for Profile screen #022), `updateUserProfile(uid, patch)`.
- [x] `src/api/activities.ts`:
  - `saveActivity(input: ActivityInput): Promise<activityId>` — `addDoc(activities, { ...input, startTime: Timestamp.fromMillis, endTime: Timestamp.fromMillis, createdAt: serverTimestamp() })`.
  - `fetchRecentActivities(uid, n = 5, excludeId?)` — query `where userId == uid, orderBy startTime desc, limit(n+1)` (composite index from #008) — feeds AI context (#019) and badge checks (#020).
  - `subscribeHistory(uid, cb, onError?)` — same query, limit 50, for #015, including configuration/listener error handling.
  - `getActivity(activityId)` — for #015 detail.
  - `updateActivity(activityId, patch)` — only `aiSummary` (#019), enforced by typed/runtime whitelist and owner-only `aiSummary` rule in #008; no client delete or other activity editing.
  - Validate/whitelist write payloads, normalize remote fields, and reject incomplete/placeholder Firebase configuration before Firestore requests.
- [x] Save pipeline `saveActivityFlow(input)` in `src/services/saveFlow.ts`:
  1. `const id = await saveActivity(input)`.
  2. `await recomputeUserAfterActivity(uid, input, id)` — gamification hook; **stub here** (`services/gamification.ts` exports a no-op) — #020/#021 fill it in.
  3. Launch `generateAndAttachSummary(id, input)` without blocking — **stub here** (no-op) until #019. Catch synchronous throws and asynchronous rejections.
  4. Return `id`.
- [x] Documented route-size estimate: a 3h run at 2s sampling is about 5,400 compact points, estimated below 1 MiB; no chunking yet. This is not a guarantee for unlimited sessions or a measured Firestore write.
- [x] Detached `snapshotToActivityInput` conversion copies points; per-owner/snapshot concurrent review-save locking is in `services/activityReview.ts` (#014).

## Acceptance Criteria

- [ ] `saveActivity` writes a document whose fields exactly match spec §4 (types: Timestamps for start/end/createdAt).
- [ ] Query helpers run against the composite index without index errors.
- [x] `saveActivityFlow` calls both hooks; synchronous/asynchronous hook failures cannot fail persistence, and the AI promise does not delay the result (unit tests).
- [x] No screen imports Firestore directly — everything goes through `src/api/*` (source inspection).
- [x] Repository tests verify payload Timestamp conversion, owner query shape/limit, normalization, update restrictions, and configuration failures with Firebase mocked.

## Implementation Notes

- `ActivityInput` uses epoch-ms `startTime/endTime`; repo converts to Firestore `Timestamp` — callers never construct Timestamps themselves.
- `firestore.rules` already restricts owner updates to `affectedKeys().hasOnly(['aiSummary'])`; deployed enforcement and final schema hardening still need #008/#028 backend acceptance.
- Keep functions individually small and named — #016 swaps the pipeline's step 1 for the SQLite-first variant.

## Verification

Implementation complete; full batch lint/typecheck and **391 tests / 15 files**
pass. No real Firebase configuration, console document, deployed index, or rules
test is claimed. Keep the first two acceptance boxes unchecked until the user-run
steps in `docs/FIREBASE_SETUP.md` and `docs/TRACKING_QA.md` are verified.
