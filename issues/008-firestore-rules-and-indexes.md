# 008 — Firestore security rules + composite index

> **Milestone:** M1 · **Labels:** `firebase`, `security` · **Depends on:** #003 · **Size:** S

## Summary

Author the Firestore security rules and indexes from spec §4/§9 item 3 so the database is
correct from day one — shipped **restrictive** rules from the start (no temporary
test-mode stage; `docs/FIREBASE_SETUP.md` recommends the same), so dev happens against
real constraints. Deploy and two-account verification remain pending.

## Tasks

- [x] `firebase init` (Hosting: no; Firestore: yes) to generate `firestore.rules` + `firestore.indexes.json` + `firebase.json`. *(hand-authored deployment-ready instead of via `firebase init` — no Firebase CLI login available in this environment; output is identical to what `init` generates)*
- [x] `firestore.rules`:
  ```
  users/{uid}:    read, write  → request.auth != null && request.auth.uid == uid
  users/{uid}/heatmapPoints: read, write → request.auth.uid == uid  (for #024 client bootstrap)
  activities:     create       → request.auth != null
                                  && request.resource.data.userId == request.auth.uid
                  read         → resource.data.userId == request.auth.uid
                  update       → owner only, userId unchanged, and affected keys
                                  exactly {aiSummary} (#019's recap write — the
                                  single documented exception to create-only)
                  delete       → never
  ```
  Include a default `allow read, write: if false;` catch-all.
- [x] `firestore.indexes.json` — composite index: collection `activities`, fields `userId ASC`, `startTime DESC`.
- [ ] Deploy: `firebase deploy --only firestore:rules,firestore:indexes`. *(NOTE: deferred — requires the user's Firebase CLI login (`firebase login`), covered again in #028 QA.)*
- [ ] Sanity-test with two accounts (A, B): A can create/read own activity; A cannot read B's activity or B's user doc (use console or a temporary test screen; document results). *(NOTE: deferred with the deploy — needs live rules, covered again in #028 QA.)*

## Acceptance Criteria

- [ ] Deployed rules reject cross-user reads/writes; own-doc access works.
- [ ] `update`/`delete` on `activities` are rejected for every field change except the owner's `aiSummary` recap write; the recap update by its owner is accepted, and a foreign user's recap write is denied.
- [ ] Composite index exists and a `where(userId).orderBy(startTime desc)` query runs without a "requires an index" error (will be exercised by #015).
- [ ] Rules + index files are committed; `firebase.json` wiring present. *(files are authored locally in the workspace; no commit/push has been recorded)*

## Implementation Notes

- `users/{uid}` write-all is intentional: client-side gamification (#020/#021) updates totals/streaks/badges server-side trigger would be nicer but is explicitly optional in spec §3.7.
- The heatmapPoints subdoc write allowance is for #024's client bootstrap; the Cloud Function trigger (admin SDK) bypasses rules anyway.
- Keep `request.resource.data.userId == request.auth.uid` on create — it's also what stops a user forging another user's activity.

## Agent Log

- Authored the four deployment-ready files at repo root: `firestore.rules`, `firestore.indexes.json`, `firebase.json` (firestore block only; #018 adds `functions`), `.firebaserc` (placeholder `PASTE_FIREBASE_PROJECT_ID` per `docs/FIREBASE_SETUP.md`). Hand-authored instead of `firebase init` — no CLI login available here.
- `update` on `activities` was intentionally narrowed to `aiSummary`-only (`affectedKeys().hasOnly(['aiSummary'])` + `userId` unchanged), reconciling spec §3.5's create-only collection with issue #019's AI-recap write — rather than "allow none" as this ticket originally said.
- `users/{uid}/heatmapPoints` is matched as a subcollection (`.../heatmapPoints/{pointId}`) since rules are not inherited downward from the parent `users/{uid}` match; both are owner-only for #024's client bootstrap, with the #018 Admin SDK trigger unaffected.
- `firestore.indexes.json` uses `collectionGroup: "activities"` + `queryScope: "COLLECTION"` with `userId ASC`, `startTime DESC` (the query #015 exercises), plus an empty `fieldOverrides` array as `firebase init` generates.
- Deferred: `firebase deploy --only firestore:rules,firestore:indexes` and the two-account sanity test — both require the user's Firebase CLI login and are covered again in #028 QA.

### Reconciliation — 2026-11-16

- Corrected the stale "test-mode only" summary and the update/deny-all task/acceptance text to match the shipped `firestore.rules`: restrictive rules from day one, `activities` create/read owner-only, updates narrowed to the owner's `aiSummary`-only recap write (`userId` unchanged), deletes denied. Deployment, two-account negative tests, and commit/push remain pending; `firestore.indexes.json` and `firebase.json` are hand-authored local files, not "identical `firebase init` output" and not committed.
