# RunTrack — Viva Preparation Notes

## 1. One-line pitch
> "RunTrack is a **local-first GPS activity-tracking Android/iOS app** built with **Expo (React Native)** that records runs/walks/cycles entirely on-device, queues them in **SQLite**, and syncs to **Firebase Firestore** when online — so tracking and history work fully offline."

## 2. Tech stack (be ready to justify each)
| Layer | Choice | Why (viva answer) |
|---|---|---|
| Framework | Expo SDK 58, React Native 0.88, React 19.3 | Cross-platform, fast dev, EAS cloud builds |
| Navigation | **Expo Router** (file-based, typed routes) | Routes = files in `src/app/`; declarative, type-safe |
| State | **Zustand** | Minimal boilerplate vs Redux; per-feature stores |
| Local DB | **SQLite (expo-sqlite)** + WAL mode | Structured, reliable local-first persistence |
| Backend | **Firebase Auth + Firestore** | Managed auth + realtime document DB, no server to host |
| Maps | `react-native-maps` (Google provider) | Route polyline rendering |
| Location | `expo-location` (foreground only) | GPS capture at high accuracy |
| Misc | `expo-speech` (voice coach), `expo-keep-awake`, `@react-native-community/netinfo`, `date-fns`, **vitest** | |

## 3. Architecture (draw this on the whiteboard)
```
UI (src/app routes + src/components)
        │
Zustand stores (trackingStore · authStore · syncStore · settingsStore · uiStore)
        │
Services layer (locationTracking engine · saveFlow · sync worker · voiceDemo · gamification)
        │                    │
SQLite (src/services/db.ts)   Firebase SDK (src/api/*)
pending_activities queue  →  Firestore push when online
```
Key principle: **layered separation** — `trackingStore` is a *pure state machine* (it never touches GPS, Firestore, or the filesystem); the *engine* (`locationTracking.ts`) feeds GPS points in via `appendPoint`; the *save flow* persists; the *sync worker* pushes. This is the answer to "why not put everything in one file?"

**Session flow:** Start → `recording` (GPS points filtered → appended to segments) → optional `pause/resume` (each resume opens a **new segment**, so the polyline visually breaks) → Stop → `computeSessionStats` → `pendingSummary` → Summary screen → Save → SQLite insert → background push to Firestore when online → row marked synced → old synced rows purged.

## 4. The four "star" modules (know these cold)

**① Tracking state machine** (`src/stores/trackingStore.ts`)
- States: `idle | recording | paused`. Illegal transitions are no-ops (e.g. can't pause while paused, can't start while a summary is pending).
- `totalPausedMs` accumulates pause spans; duration = `(end − start) − paused time`, so a trailing pause is folded in at stop.
- Route stored as **`segments: RoutePoint[][]`** — one polyline per recording stretch between pauses.

**② GPS filter** (`src/utils/locationFix.ts`) — reject bad fixes before they corrupt stats:
- accuracy > **20 m** → reject
- implied speed > **28 m/s** ("teleport" check: distance between consecutive fixes ÷ time gap)
- timestamp older than **15 s**, in future > 5 s, or non-increasing → reject
- Invalid lat/lng ranges → reject
- This is why distance doesn't jump when GPS drifts.

**③ Distance & stats math** (`src/utils/geo.ts`, `src/utils/stats.ts`)
- **Haversine formula** (Earth radius 6371 km) between consecutive WGS84 points, summed per segment (never across a pause gap). Uses `atan2` form with `a` clamped to [0,1] to avoid NaN at antipodes.
- Duration: wall-clock minus pause time.
- Pace: `durationSec / distanceKm` (mm:ss/km), suppressed when distance < 0.05 km.
- Calories: **MET-based estimate** `distanceKm × weightKg × 1.036` (default 70 kg).

**④ Offline queue + idempotent sync** (`src/services/db.ts`, `src/api/activities.ts`, `network.ts`)
- SQLite table `pending_activities`: route stored as **JSON string**, with `synced`, `retryCount`, `lastAttempt`, `firestoreId` columns.
- **Why `firestoreId`?** The spec is create-only with no server dedup, so storing the assigned Firestore ID makes retries **idempotent** — a retried push knows it already landed.
- Migration strategy: `PRAGMA user_version` (versioned migration list) + **WAL journal mode** so a Save-time insert stays fast while History is reading.
- Connectivity gate: pushes when `isInternetReachable !== false` — treat "unknown" as *attempt anyway*, because failure just leaves the row queued (fail-safe default).
- **Defensive parsing everywhere:** malformed JSON or bad points *degrade to a shorter route*, never crash a read; Firestore reads are whitelisted/normalized field-by-field before reaching the UI.

## 5. Design decisions worth mentioning unprompted
- **Foreground-only tracking** (deliberate, per app.json plugin config): when the app is backgrounded, the engine auto-pauses via `AppState` listener and toasts "keep RunTrack open". Avoids background-location permissions, battery drain, and Play Store background-location policy.
- **Generation tokens** in the engine: module-level resources (watch subscription, wake lock, AppState listener) survive screen re-mounts; incrementing a generation counter invalidates stale native callbacks so a stopped session can't be "revived."
- **Keep-awake** during a session so the screen doesn't sleep mid-run.
- **One-way summary handoff:** stop() produces a one-shot `pendingSummary`; Summary screen consumes it and resets — no zombie state if the user leaves.
- **Testing:** pure functions (geo, stats, locationFix, store transitions) take all inputs explicitly — no `Date.now()` inside them — making pause math deterministic and unit-testable with vitest.

## 6. Limitations / future work (viva loves this)
- No background tracking (foreground-only by design).
- AI summary is currently a **no-op extension point** — the plan is a server-side callable, never shipping a client API key (security answer).
- Calories are MET-based (no elevation/heart-rate data).
- No server-side dedup for duplicate pushes (handled client-side via `firestoreId`).

## 7. Rapid-fire Q&A drill

| Likely question | Your answer |
|---|---|
| Why local-first? | GPS runs must survive no-signal/offline; queue + retry gives eventual consistency with Firestore. |
| Why SQLite and not AsyncStorage? | Relational data (indexed queries by createdAt/synced), transactions, structured schema + migrations. |
| Why Zustand over Redux/Context? | Tiny API, no provider nesting, per-feature stores, works outside React for engine calls (`useTrackingStore.getState()`). |
| How is distance computed? | Sum of Haversine distances between consecutive accepted fixes, per segment. |
| How do you handle bad GPS data? | Multi-rule fix filter: accuracy ≤ 20 m, teleport (implied speed) check, timestamp sanity, coordinate bounds. |
| What if the app crashes mid-run? | Session state is in-memory (trade-off); synced activities persist in SQLite, unsynced ones persist from the point of Save. |
| How are duplicates avoided on retry? | Row stores its `firestoreId` after a successful push; retried pushes skip rows already marked synced. |
| Why WAL mode? | Concurrent reads (History screen) don't block the Save-time write. |
| How do pauses affect stats? | Pause time excluded from duration; distance never bridges across a pause (segments are summed independently). |
| Auth flow? | Firebase Auth; root layout uses `Stack.Protected` to gate `(tabs)` behind sign-in vs `(auth)` routes. |
