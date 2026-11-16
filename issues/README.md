# RunTrack — Issue Ticket Index

Implementation-ready ticket breakdown for the build brief in
`RunTrack — Development Specification.md` (React Native / Expo + Firebase, Strava-style tracker).

Each ticket below is a standalone markdown file in this folder, written to be picked up
directly for implementation. Ticket numbers encode the intended build order — implement
them roughly top-to-bottom; tickets within a milestone can overlap once their
dependencies are done.

---

## Current implementation status

- **#001–#016 implemented** (2026-11-16). #016's local-first SQLite save queue is
  code-complete and unit-verified; **#017 (NetInfo sync worker + pending banner) is
  next**.
- Implementation is not the same as full acceptance: Firebase account/service
  setup, deployed rules/indexes, native Maps keys/build identifiers, and all
  device/simulator checks remain pending (#003/#008/#027/#028). Keep their
  acceptance boxes unchecked until evidence exists.
- Latest verification (2026-11-16, after #016): `npx expo lint` and strict
  `npx tsc --noEmit` pass; `npm test` passes **575 tests / 24 files**; `npx
  expo-doctor` is **20/20**. Automated/mocked checks and bundling, **not device
  boot, native rendering, or backend proof**. With #016, an offline Save now
  queues in `pending_activities` and resolves; the reserved `SyncBanner` slot is
  filled by #017.
- Generated Router types are produced by `npx expo export`/`expo start` and are
  git-ignored per Expo docs; regenerate before typechecking in a fresh clone.
- [Tracking QA](../docs/TRACKING_QA.md), [History/Detail QA](../docs/HISTORY_QA.md),
  [decisions](../docs/DECISIONS.md), and [Firebase/Maps setup](../docs/FIREBASE_SETUP.md)
  record the remaining work. All client configuration remains `PASTE_…`;
  development sign-in is navigation preview only. Unsaved tracking/review is lost
  on process death, but a **completed Save** is now persisted locally (#016).
- Dependency installation reports **14 vulnerabilities (10 moderate, 4 high)**;
  automatic audit fixes were not applied. No commit, push, or PR is reported.

---

## Milestones

| ID  | Milestone                  | Tickets   | Goal (maps to spec §11)                                    |
|-----|----------------------------|-----------|------------------------------------------------------------|
| M1  | Foundation & Auth          | 001–008   | Scaffold, theme, navigation shell, Firebase Auth end-to-end |
| M2  | Core GPS Tracking          | 009–012   | Tracking engine + Track / Active Tracking flow (no persistence) |
| M3  | Persistence & Core Screens | 013–015   | Firestore save, Activity Summary, History, Detail (online)  |
| M4  | Offline-First              | 016–017   | Local SQLite queue + NetInfo sync worker                    |
| M5  | AI Workout Summaries       | 018–019   | Callable Cloud Function + non-blocking client card          |
| M6  | Gamification               | 020–022   | Badges, streaks, Profile UI                                 |
| M7  | Voice Pace Coaching        | 023       | Per-km TTS announcements + mute preference                  |
| M8  | Route Heatmap              | 024–025   | Aggregated heatmap data + Heatmap tab (with polyline fallback) |
| M9  | Polish & Submission        | 026–028   | UX sweep, platform/permission config, rule hardening, writeup |

---

## Ticket Index

| #   | Title                                             | Depends on        | Size |
|-----|---------------------------------------------------|-------------------|------|
| 001 | Scaffold Expo project, dependencies, structure    | —                 | S    |
| 002 | Theme & shared UI kit                             | #001              | M    |
| 003 | Firebase project setup + client config module     | #001              | M    |
| 004 | Navigation shell (auth gate, tabs, nested stacks) | #001, #005        | M    |
| 005 | Global state stores (Zustand)                     | #001              | S    |
| 006 | Signup screen + `users/{uid}` doc creation        | #002, #003, #005  | M    |
| 007 | Login screen + session persistence + logout       | #002, #003, #005  | M    |
| 008 | Firestore security rules + composite index        | #003              | S    |
| 009 | Stats utilities (haversine, pace, calories)       | #001              | S    |
| 010 | Location permissions + GPS tracking engine        | #005, #009        | L    |
| 011 | Track screen (map, type selector, Start)          | #002, #010        | S    |
| 012 | Active Tracking screen (live map, controls, stop) | #010, #011        | L    |
| 013 | Data layer: Firestore repos + save pipeline       | #003, #005        | M    |
| 014 | Activity Summary screen (Save / Discard)          | #009, #012, #013  | M    |
| 015 | History + Activity Detail screens                 | #002, #013        | M    |
| 016 | Local-first save: SQLite `pending_activities`     | #013              | M    |
| 017 | Sync worker (NetInfo + backoff) + pending banner  | #015, #016        | L    |
| 018 | Cloud Function `generateWorkoutSummary`           | #003              | M    |
| 019 | Client AI-summary integration (non-blocking)      | #013, #014, #018  | M    |
| 020 | Badge engine + badge definitions                  | #013              | M    |
| 021 | Streak logic + user aggregate updates             | #013              | M    |
| 022 | Profile screen (stats, badges, settings, logout)  | #007, #020, #021  | M    |
| 023 | Voice pace coaching (per-km TTS + mute)           | #012, #005        | M    |
| 024 | Heatmap data layer (+ Cloud Function trigger)     | #003, #013        | M    |
| 025 | Heatmap screen (overlay + polyline fallback)      | #002, #024        | M    |
| 026 | UX polish sweep (loading, toasts, empty states)   | most screens      | M    |
| 027 | Platform config: permissions, Maps key, keep-awake| #010, #003        | S    |
| 028 | Rule hardening, final QA, project writeup         | all               | L    |

---

## Conventions

- **Branch naming:** `feat/<ticket#>-<short-slug>` (e.g. `feat/013-data-layer`).
- **One ticket = one PR** (or one commit batch if working without PRs).
- **Definition of Done (applies to every ticket, on top of each ticket's own acceptance criteria):**
  - TypeScript strict; no `any` leaks in new code.
  - No raw hex colors / ad-hoc spacing — only theme tokens from #002.
  - Every async operation shows an `ActivityIndicator` or skeleton; failures show non-blocking toasts (confirm dialogs only for destructive actions).
  - No server secrets in client code; keep real client configuration out of source until supplied, and restrict distributed Firebase/Maps identifiers appropriately.
  - Runs clean on an Android emulator (and iOS simulator where feasible), no red boxes, no console spam.
  - All of the ticket's acceptance criteria checked.

## Global out-of-scope (from spec §12)

Elevation/altitude anything · social features (kudos, friends, leaderboards) ·
wearable/health-app integration · km/mi unit toggle (stretch only).
Do **not** build these anywhere; tickets below restate it where relevant.

## Importing to GitHub (optional)

If the repo is later pushed to GitHub, each file maps 1:1 to an issue:
title = first heading, milestone/labels/dependencies = header line, task + acceptance
checkboxes = issue body checklists. Nothing in the files is repo-tooling-specific.
