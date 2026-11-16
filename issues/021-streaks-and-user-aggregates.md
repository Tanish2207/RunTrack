# 021 — Streak logic + user aggregate updates

> **Milestone:** M6 · **Labels:** `gamification` · **Depends on:** #013 · **Size:** M

## Summary

Spec §3.7 streaks + the user-document aggregates: on every activity save, update
`totalDistanceKm`, `totalActivities`, and the streak fields (`currentStreak`,
`longestStreak`, `lastActivityDate`) per the consecutive-calendar-days rule. Pure logic +
one Firestore writer, hooked into `saveActivityFlow` (#013) and the sync worker (#017).

## Tasks

- [ ] `src/services/gamification/streaks.ts`:
  - `toLocalDateKey(epochMs): "YYYY-MM-DD"` — device-local calendar day (date-fns `format`).
  - `computeStreakUpdate(profile, activityDateKey, todayKey): { currentStreak, longestStreak, lastActivityDate }` — pure:
    - `activityDateKey === profile.lastActivityDate` → streak unchanged (same-day re-log; still update totals);
    - `daysBetween(profile.lastActivityDate, activityDateKey) === 1` → `currentStreak + 1`;
    - gap > 1 day (or null last date) → reset to `1`;
    - `longestStreak = max(longestStreak, currentStreak)`.
  - `daysBetween` implemented on date keys (UTC-safe arithmetic on parsed dates, compared as local keys — document the device-timezone caveat).
- [ ] `applyUserAggregates(uid, activity, streakResult)` — one `updateDoc(users/uid, …)`:
  `{ totalDistanceKm: increment(activity.distanceKm), totalActivities: increment(1), currentStreak, longestStreak, lastActivityDate }`.
- [ ] Integrate as the first step of `recomputeUserAfterActivity` (badges #020 run after, consuming fresh totals + streak). Return the computed values to the badge evaluator.
- [ ] **Offline ordering guarantee (with #017):** the sync worker pushes in `createdAt ASC`, so multi-day offline saves evaluate streaks chronologically.
- [ ] Edge: an activity saved for "yesterday" after today's already logged (late offline sync) → `lastActivityDate` must not regress: apply `max(existing, activityDate)` semantics for the field while streak math uses chronological order (worker order makes this rare; handle it, test it).

## Acceptance Criteria

- [ ] Consecutive-day saves → streak 2, 3…; one skipped day → next save resets streak to 1.
- [ ] Same-day second activity does not inflate the streak.
- [ ] `longestStreak` never decreases.
- [ ] Totals match the sum of saved activities (verify against Firestore after several runs incl. offline batch sync).
- [ ] Unit tests cover: first-ever activity, consecutive, same-day, gap-reset, out-of-order late sync.

## Implementation Notes

- Increment-based totals survive client races better than read-modify-write; streak fields are read-modify-write on `users/{uid}` — acceptable per spec (single-user writes).
- Keep this module 100% pure except `applyUserAggregates`; #028's writeup references this file when explaining gamification.
