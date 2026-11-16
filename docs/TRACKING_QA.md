# Tracking QA — #010–#014

**Manual acceptance is pending.** None of the device/simulator or real-backend
checks below has been performed. Leave boxes unchecked until evidence is recorded
(platform, device/build, date, result). Use [FIREBASE_SETUP.md](FIREBASE_SETUP.md)
for real configuration and [DECISIONS.md](DECISIONS.md) for scope decisions.

## Launch, permissions, and Start (#010–#011)

- [ ] Cold-launch signed out and signed in: the auth gate resolves to the correct
  routes; signed-out users cannot enter tracking or save an activity.
- [ ] Select **Run**, **Cycle**, and **Walk**, then Start each: the selected type
  reaches Active Tracking. Rapid taps do not create duplicate sessions/watches.
- [ ] Grant precise location; test denial and permanent blocking. No recording
  starts without adequate access, and the screen gives actionable guidance.
- [ ] Refuse Android coarse/no-accuracy access and iOS reduced accuracy. Use
  **Open Settings** to enable precise access; returning rechecks permission and
  permits Start without an unexpected additional prompt.

## GPS, pause, and Finish (#010–#012)

- [ ] Run a known emulator/simulator GPS route and a short real outdoor walk:
  the location/map updates, distance grows plausibly, and the segmented route
  matches the path. Poor-accuracy fixes (>20 m) and implausible jumps are excluded.
- [ ] Pause for **30 seconds while moving**: elapsed time and distance stay
  frozen. Resume starts a new segment, excludes the paused time/movement, and
  draws no connector across the gap.
- [ ] Make the app inactive and background it while recording: tracking
  auto-pauses. Returning to the foreground never auto-resumes; only an explicit
  **Resume** starts another segment.
- [ ] The screen stays awake during tracking. Stop/logout removes the GPS watch
  and tracking AppState listener once and releases the single tracking wake lock;
  no callbacks leak into a stopped or replacement session.
- [ ] Finish opens confirmation. Cancel preserves the live/paused session;
  confirm stops once and opens Summary. Hardware Back and swipe-back cannot
  bypass Finish confirmation or silently lose an activity awaiting review.

## Summary and persistence (#013–#014)

- [ ] The static summary map fits the **entire segmented route** with padding
  and no pause-gap connectors. Distance, duration, average pace, and calories
  match the frozen snapshot; pauses remain excluded.
- [ ] With real Firebase configured, Save creates one owner-attributed activity.
  Inspect `userId`, type, numeric stats, and route; `startTime`, `endTime`, and
  server-confirmed `createdAt` are Firestore Timestamp fields. Route-point
  `timestamp` values remain epoch-millisecond numbers.
- [ ] The owner query (`userId == uid`, `startTime` descending) works with the
  deployed `userId ASC / startTime DESC` composite index. Check two real accounts
  and verify deployed rules reject signed-out and other-owner access; UI guards
  alone are not backend enforcement.
- [ ] Successful Save clears the reviewed snapshot and lands on **History**.
  Offline Saves (#016) toast "Activity saved (offline — will sync)" and route the
  same way; the row waits in the local SQLite queue for the #017 sync worker.
- [ ] Duplicate Save taps share one in-flight write. A save that fails to reach
  Firestore still queues locally and resolves (#016); only a failed local write +
  failed fallback push keeps the snapshot on screen with an honest error, retry
  controls, and no false success.
- [ ] Missing/placeholder Firebase configuration: with the queue intact, Save now
  queues offline and toasts the offline message (no fabricated Firestore ID, no
  sync-state lie); the row retries via #017. Only when the local write also fails
  does Save fail visibly while retaining the snapshot.
- [ ] Offline Save (#016, needs device): with airplane mode ON, Save succeeds
  immediately, `pending_activities` holds the row with `synced = 0`, and Firestore
  has nothing; killing the app right after loses nothing.
- [ ] Online Save (#016, needs device + real Firebase): the row is written, pushed,
  and marked `synced = 1` with a `firestoreId`; the Firestore document matches the
  snapshot.
- [ ] Discard cancel keeps the review. Confirmed Discard clears it, makes **no
  Firestore write**, and returns to **Track only**, not History.
- [ ] Log out with a Finish/Discard dialog open and with Save pending. Late
  dialog callbacks/completions cannot revive the old session, clear a new
  owner's snapshot, or navigate a signed-out user into protected screens.
- [ ] Kill the process before Save and relaunch: the unsaved live session or
  review snapshot is lost, not presented as recovered or persisted.

## Verification limits

- Unit tests mock Expo/native modules and Firebase, and invoke React hooks with
  mocks rather than a native renderer. They exercise logic, not native UI,
  Expo Router/back-navigation integration, hardware GPS/permissions/wake locks,
  deployed indexes, or backend security-rule enforcement.
- An Android Hermes export is **bundling only**: it is not evidence of device
  launch, GPS behavior, native map rendering, or successful backend persistence.
- Tracking is foreground-only and unsaved state is in memory. Process death
  loses an *unsaved* live session/review. **#016 persists at Save time** to the
  local SQLite queue (not live-session checkpointing); unsynced queued rows wait
  for the #017 worker, so a completed offline Save survives process death.
- Logout cannot undo a backend write already accepted for the original owner;
  verify ownership and safe handling of its late completion instead.
