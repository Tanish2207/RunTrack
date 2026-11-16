# RunTrack — Decision Log

Records of choices made during implementation, with rationale. Referenced by the
project writeup (issue #028).

## 2026-11-15 — Project bootstrap and SDK compatibility (#001–#002)

- Scaffolded with `create-expo-app` and the blank TypeScript template. Current versions are **Expo SDK 58**, **React Native 0.88.1**, and **React / React DOM 19.3.0**, with strict TypeScript and Zustand.
- Use `npx expo install` for SDK-compatible dependencies and consult the [v58 reference](https://docs.expo.dev/versions/v58.0.0/) before using native APIs. This project uses npm (`package-lock.json`), not Bun.
- `expo-constants` supplies configuration, AsyncStorage supplies auth/settings persistence, and `expo-keep-awake` supports foreground tracking. `expo-font` is a direct dependency and config plugin because `@expo/vector-icons` requires its native module outside Expo Go.
- Routes live in `src/app/`; reusable code lives in `src/{api,stores,navigation,screens,hooks,services,components,theme,utils}`. Native projects use Continuous Native Generation: no hand-written `ios/` or `android/` files.
- No additional heatmap wrapper is installed. #025 may use the built-in heatmap or the accepted polyline fallback. Elevation, social, and wearable/health integrations remain out of scope.

## 2026-11-15 — Expo Router owns navigation (#004)

- **Supersedes the initial direct React Navigation choice.** Follow `AGENTS.md`: `expo-router/entry` is the entry point, and `src/app/_layout.tsx` owns the auth gate, navigation theme, toast host, and tracking lifecycle.
- File-based auth routes and four tabs preserve the intended Track / History / Heatmap / Profile structure. Track and History have nested `Stack` layouts. `src/navigation/theme.ts` holds styling only; direct React Navigation dependencies and old navigator/param-list files were removed.
- Use complete typed hrefs and Router hooks. The [SDK 58 migration guide](https://docs.expo.dev/router/migrate/sdk-57-to-58.md) replaces old nested `screen`/`params` navigation and `beforeRemove` patterns.
- Resolving review first calls `router.dismissTo('/(tabs)/track')`; successful Save then calls `router.navigate('/(tabs)/history')`. This unwinds the resolved Track stack before changing tabs. Keep the captured review rendered until navigation completes; disable removal prevention before leaving after resolution.

## 2026-11-15 — Configuration remains placeholders (#003, #013)

- Keep Firebase and Maps values in `app.json` as `PASTE_…` until the user supplies real configuration. Setup steps are in [FIREBASE_SETUP.md](FIREBASE_SETUP.md).
- Register a **Firebase web app** for the JS SDK configuration. Native Firebase service files are not consumed by this app. Missing `apiKey`/`projectId` get initialization-only placeholder strings; this does not create a working backend.
- `assertFirebaseConfigured()` rejects user/activity repository operations before Firestore requests when any required value is missing or contains `PASTE_`. Auth actions still call the Firebase SDK and surface its errors; do not describe every Auth path as guarded.
- `devSignIn()` / `devSignOut()` provide a `__DEV__`-only local identity for navigation preview, not an authenticated Firebase user or fake persistence. Remove the preview controls in #028.
- Android/iOS Google Maps keys are options of the **`react-native-maps` config plugin** (`androidGoogleMapsApiKey`, `iosGoogleMapsApiKey`). Native key changes require a rebuilt binary; web uses an informational map fallback.
- Firebase client identifiers and Maps keys are distributed with the app, not server secrets. Restrict their use and enforce Firestore rules. Never put Anthropic credentials in client configuration; #018 uses a server-side secret.

## 2026-11-15 — Auth and data boundaries (#003–#008, #013)

- Screens call `src/api/auth.ts`, `users.ts`, and `activities.ts`, never Firebase SDK functions directly. Auth bootstrap is idempotent and has an 8-second safety timer; logout clears local auth/tracking/sync state.
- Firebase 13.3.0 exposes `getReactNativePersistence` through its `react-native` runtime condition but omits it from the types barrel. A typed module augmentation in `src/api/firebase.ts` keeps AsyncStorage initialization strict-safe.
- `ensureUserProfile` uses a transaction to create defaults only when absent. Repositories validate writes, whitelist fields, normalize remote values, and convert Firestore Timestamps to epoch milliseconds at the boundary.
- Activities are immutable except an owner-only `aiSummary` update. Both the repository and `firestore.rules` restrict that mutation; deployed rule enforcement and two-account negative tests remain pending.
- `saveActivityFlow` persists first, awaits an isolated gamification hook, and launches an isolated non-blocking AI hook. Those hooks are no-ops until #020/#021 and #019; failed optional hooks cannot turn a successful save into failure.

## 2026-11-15 — Foreground-only tracking with engine-owned resources (#010–#012)

- A documentation-only feasibility review chose the accepted foreground fallback; no native background spike or dev-client build was performed. Background tracking would need a top-level task, appropriate permissions/config, and a development build. It is not implemented.
- Only `src/services/locationTracking.ts` owns `watchPositionAsync` and one tagged keep-awake lock (`activateKeepAwakeAsync` / `deactivateKeepAwake`). Screens must not acquire competing locks. Pause retains resources and drops fixes; Stop, logout, startup cancellation, and root cleanup dispose them safely.
- Inactive/background transitions **auto-pause**. Returning does **not** auto-resume: explicit Resume rechecks precise access/services and starts a new segment. Start/Resume requests coalesce, and generation tokens reject stale callbacks and late native subscriptions.
- Watch settings are `Location.Accuracy.Highest`, `timeInterval: 2000` (Android minimum interval only), and `distanceInterval: 5`. They are not a cross-platform promise of a fix every two seconds or an either-condition trigger.
- Reject inaccurate (>20 m), invalid, stale/out-of-order, and teleport (>28 m/s) fixes. Compute distance **within segments**, so paused movement never adds a connecting gap. `SessionSnapshot.segments` preserves breaks for review; the persisted spec route is a flat point array.
- `useElapsedMs()` uses a per-view cached external clock and timestamp-based pause math. It refreshes immediately on subscription, rather than accumulating ticks or exposing unstable `Date.now()` snapshots.
- Unsaved live sessions and review snapshots are in memory and are lost on process death. Planned SQLite #016 provides **Save-time** persistence, not live-session checkpointing or automatic recovery.

## 2026-11-15 — Review ownership and duplicate-save protection (#014)

- A `WeakMap<SessionSnapshot, Map<userId, Promise<activityId>>>` shares simultaneous saves of the same owner's snapshot. Discard cannot clear a snapshot with an in-flight save; failures retain it for retry.
- Late completion/dialog handlers check mounting, current owner, and snapshot identity. A write already accepted by Firebase cannot be undone by logout, but it must not clear a replacement review or navigate a signed-out user.
- Summary renders the frozen segmented route and snapshot stats. The reserved AI card is hidden until #019. History/Detail implementation is next (#015); SQLite/sync remain #016–#017.

## 2026-11-16 — History + Activity Detail read screens (#015)

- **Read-only owner data.** History subscribes via `subscribeHistory(uid, cb, onError?)`
  (newest-first, limit 50) only while focused; Detail reads `getActivity(id)` once per
  owner/ID/focus scope and refetches on refocus so a later `aiSummary` (#019) appears
  without a remount. Neither screen writes to Firestore; activities stay create-only.
- **Immutable scope keys mask stale data in-render.** Both hooks key their published
  state by owner/ID/focus/attempt generation, so a render that happens *before* passive
  effect cleanup already hides the previous owner's rows, recap, title, and Retry.
  Callbacks (row taps, Retry, back) additionally re-check the live generation,
  `navigation.isFocused()`, and the live auth store UID before acting.
- **Defense in depth, not authorization.** History filters foreign-owner rows and Detail
  rejects mismatched owner/ID results; Firestore rules remain the real enforcement, and
  permission-denied/not-found read failures collapse into the same non-revealing
  "Activity not found" state (no backend detail, no toast).
- **Interactive fitted maps.** `RouteMap` gained `interactive?: boolean`, separating
  gesture support from route fitting: Summary's fitted map stays static by default
  (`interactive` defaults to `!fitRoute`), while Detail passes `fitRoute interactive`
  with `showsUserLocation={false}` — pannable/zoomable history without any GPS watch,
  location callbacks, or permission request. The camera refits when the activity ID
  changes (`key={activity.id}`), never on unrelated parent rerenders.
- **Flat persisted route on Detail.** `Activity.route` is stored flat, so Detail maps it
  as a single segment without reconstructing pause boundaries; segmented snapshots
  remain Summary-only. Empty routes show an honest notice; one-point routes center via
  camera instead of a degenerate `fitToCoordinates`.
- **Native large title compatibility.** History's FlatList is the first child of a
  non-collapsible `SafeAreaView` (Router stack guidance) with
  `contentInsetAdjustmentBehavior="automatic"`; the themed large title is enabled on the
  History index and opted out on Detail. Device collapse behavior is still unverified.
- **Honest formatting.** `formatDate()` returns `"Date unavailable"` for invalid epoch
  values, and Detail's header does the same for its short date — a malformed stored
  timestamp can no longer crash a row or the screen.
- **Typed routes generated.** `npx expo customize tsconfig.json` plus
  `npx expo export` produced `.expo/types/router.d.ts` (git-ignored); strict typecheck
  now validates complete hrefs, including the required `activityId` param on
  `/history/[activityId]`. Regenerate in a fresh clone before typechecking.

## 2026-11-16 — Local-first SQLite save queue (#016)

- **Save contract changed.** `saveActivityFlow` now writes a `pending_activities` row
  first (`expo-sqlite`, `runtrack.db`, promise API, WAL, `PRAGMA user_version`-based
  migrations), bumps `syncStore.pendingCount`, and only then attempts the Firestore
  push when `isInternetLikelyReachable()` (NetInfo) is not explicitly `false`. The
  push runs in a try/catch: success → `markSynced(localId, firestoreId)` + the #013
  gamification/AI hooks; failure or offline → `markFailed(localId)` and the row stays
  queued for the #017 worker. Save never rejects because of the network anymore.
- **Spec deviation: additive `firestoreId` column.** Activities are create-only with
  no server-side dedup, so idempotent #017 retries need to know a push already
  landed. `firestoreId` is stored at acknowledge time; a row whose acknowledgement
  write failed stays unsynced and may push twice (accepted, rare local-failure edge).
- **`SaveOutcome` replaces the bare ID.** `saveActivityFlow`/`savePendingActivity`
  return `{ localId, firestoreId | null }`. The Summary screen toasts
  "Activity saved (offline — will sync)" when `firestoreId` is null, still resolving
  the review and navigating to History. Post-save hooks (gamification awaited, AI
  detached) run only when the push succeeded; offline rows receive them after #017
  syncs and #019 generates the recap.
- **Fallback when SQLite is unavailable** (e.g. web without the wasm/COOP-COEP
  setup): the flow degrades to the #013 direct push, whose failures still propagate
  so the UI retains the snapshot. This is the only path that can still reject a save.
- **Purge policy.** `purgeSyncedOlderThan(30)` runs fire-and-forget on app start
  (`src/app/_layout.tsx`) and will run after each #017 sync pass; synced rows older
  than 30 days are deleted so the table cannot grow forever. Unsynced rows are
  never purged.
- **Rows are trusted, snapshots are validated at push time.** Queue rows come from
  the app-generated snapshot and are inserted with light type checks only; the
  strict `prepareActivityInput` validation still runs inside `saveActivity` at push
  time. Malformed stored route JSON degrades to a shorter parsed route on read.

## 2026-11-15 — Verification evidence and limits (#010–#014)

- `npx expo lint`, `npx tsc --noEmit`, and `npm test` pass: **391 tests across 15 files**, including 70 engine, 37 permission, 34 review-service, 35 Summary-orchestration, and 8 elapsed-clock tests.
- `npx expo-doctor` passes **20/20** after adding the missing `expo-font` peer. `npx expo export --platform android --clear` exports the production Hermes bundle to `dist`.
- An export verifies **bundling, not boot**. Tests mock native/Firebase APIs; Summary tests use controlled hooks and JSX inspection, not native rendering or real Router transitions. No device GPS/maps/permissions/wake-lock, real Firebase persistence, deployed-index, or deployed-rule checks have been performed. See [TRACKING_QA.md](TRACKING_QA.md).
- Dependency installation reports **14 vulnerabilities (10 moderate, 4 high)**. No automatic audit fix or breaking dependency upgrade was applied; review remains part of hardening.
