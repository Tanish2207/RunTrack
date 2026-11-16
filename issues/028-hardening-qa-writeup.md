# 028 — Security hardening, final QA, project writeup

> **Milestone:** M9 · **Labels:** `security`, `qa`, `docs`, `submission` · **Depends on:** all · **Size:** L

## Summary

The submission gate (spec §9 items 3–4, §11 phase 9): tighten Firestore rules to
production, run the full QA matrix against the spec's feature list, clean the codebase,
and write the project writeup including every documented decision and limitation.

## Tasks

- [ ] **Rule hardening (edit #008's rules):**
  - Remove any test-mode looseness; keep owner-only users/activities access.
  - Tighten `activities` update to `aiSummary`-only keys if feasible
    (`diff(resource.data).affectedKeys().hasOnly(['aiSummary'])`), else keep owner-update and document.
  - `heatmapPoints`: owner-only read/write (unchanged).
  - Deploy final rules; re-run the two-account cross-user test suite from #008 — all negative cases pass.
- [ ] **Functions final deploy:** `generateWorkoutSummary` + heatmap trigger on production secrets; verify secret is not in any committed file (grep `ANTHROPIC` across repo).
- [ ] **QA matrix (record results in `docs/QA.md`):**
  - Auth: signup→doc created, login, wrong-password inline error, persist across kill, logout clears state.
  - Tracking: full run with GPX route — live polyline, HUD math incl. pause, stop-confirm, summary stats match HUD.
  - Save paths: online save; airplane-mode save → sync on reconnect; app-kill mid-offline → no loss; no duplicate docs after retries.
  - AI: recap appears + stored; failure silent; offline save still gets recap post-sync; API key server-side only.
  - Gamification: each badge unlock path exercised; streak consecutive/reset/same-day; totals correct after offline batch.
  - Voice: per-km announcements correct; mute persists + instant stop.
  - Heatmap: aggregated + fallback paths; caption count; empty state.
  - Permissions: denied path graceful on both platforms.
- [ ] **Cleanup:** remove all `console.log`/`__DEV__` toggles (#004 fake user, #025 heatmap toggle, #003 smoke logs); `npx tsc --noEmit` clean; no unused deps.
- [ ] **Writeup `docs/PROJECT_WRITEUP.md`:** architecture overview (RN+Expo / Firebase / Cloud Functions), data model + why SQLite-first, offline sync design (create-only ⇒ no conflicts), AI proxy rationale (key security), gamification approach (client-side, spec-sanctioned), the background-location decision + limitation, heatmap implementation + fallback, out-of-scope list (§12), and the issues/→implementation mapping. Screenshots of each screen for the report.
- [ ] Final submission prep: repo tidy (README with run instructions: `npm install`, Firebase config placement, `firebase deploy`), demo account seeded with a handful of activities for grading.

## Acceptance Criteria

- [ ] Deployed production rules reject every cross-user action (verified, recorded).
- [ ] QA matrix fully green or each gap explicitly accepted + documented.
- [ ] No secrets in client code or git history; no debug toggles left.
- [ ] Writeup covers every spec section 1–12 including the two documented fallbacks (background location, heatmap).
- [ ] A grader can clone → configure → run the app and see all features with the seeded demo account.

## Implementation Notes

- Do the rule change **last among code-affecting tasks** so QA runs against final rules; rerun the offline-sync + save paths once more after deploying tightened rules (rules changes can break the `aiSummary` update path — that's why the update-tightening is conditional).
- Seed the demo account through the real app (not raw inserts) so triggers/hooks populate aggregates correctly.
