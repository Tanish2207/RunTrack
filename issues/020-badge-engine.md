# 020 — Badge engine + badge definitions

> **Milestone:** M6 · **Labels:** `gamification` · **Depends on:** #013 · **Size:** M

## Summary

Spec §3.7: define the badge set and the pure evaluation engine that checks conditions
after each activity save, unlocking new badges on `users/{uid}.badges`. Client-side
evaluation (spec-sanctioned; the server-side `onCreate` trigger is optional stretch —
see Implementation Notes).

## Tasks

- [ ] `src/services/gamification/badges.ts` — definitions (single source, exported for Profile UI #022):
  ```ts
  export const BADGES = [
    { id: 'first_steps',   name: 'First Steps',      icon: 'shoe-print', description: 'Complete your first activity' },
    { id: 'five_k_club',   name: '5K Club',          icon: 'run-fast',   description: '5 km or more in a single activity' },
    { id: 'early_bird',    name: 'Early Bird',       icon: 'alarm',      description: 'Start an activity before 7 AM' },
    { id: 'consistency_3', name: 'Consistency',      icon: 'fire',       description: 'Log activities 3 days in a row' },
    { id: 'distance_10',   name: '10 km Lifetime',   icon: 'map-marker-distance', description: '10 km total distance' },
    { id: 'distance_50',   name: '50 km Lifetime',   icon: 'map-marker-distance', description: '50 km total distance' },
    { id: 'distance_100',  name: '100 km Lifetime',  icon: 'map-marker-distance', description: '100 km total distance' },
  ] as const;
  ```
  (Spec asks for 4–6 conditions; the tiered distance milestone family counts as one, rendering as three grid tiles.)
- [ ] `evaluateNewBadges({ profile, activity, currentStreak }): BadgeId[]` — pure:
  - `first_steps` ← `totalActivities >= 1` after increment; `five_k_club` ← `activity.distanceKm >= 5`;
  - `early_bird` ← local start hour < 7 (`new Date(activity.startTimeMs).getHours()`);
  - `consistency_3` ← `currentStreak >= 3` (post-#021 update);
  - `distance_10/50/100` ← lifetime `totalDistanceKm >= threshold` after increment.
- [ ] `applyBadges(uid, current: string[], unlocked: string[])` — filter out already-owned, `updateDoc(users/uid, { badges: arrayUnion(...new) })`; fire a toast "🏅 Badge unlocked: {name}" per new badge (non-blocking).
- [ ] Integrate into `recomputeUserAfterActivity` hook in `saveActivityFlow` (#013): run **after** streak/totals update (#021) so consistency/lifetime badges see fresh numbers. Also call from the sync worker (#017) for offline-synced activities.
- [ ] Idempotency: re-saving the same activity (worker retry) must not double-unlock or re-toast — guard by checking current badges first.

## Acceptance Criteria

- [ ] Each condition unit-tested (early-bird boundary 6:59/7:00, exactly-5.00km, exactly-threshold totals).
- [ ] Saving an activity that triggers multiple badges unlocks all of them at once.
- [ ] No duplicate toasts/locks on retry paths.
- [ ] Locked badges never appear in `users/{uid}.badges`.

## Implementation Notes

- Everything pure & testable: evaluation never touches Firestore; `applyBadges` is the only writer.
- Badge icons come from `MaterialCommunityIcons` names (validated in #022's grid).
- Server-side `onCreate` trigger remains documented as a stretch in #028 — don't build it now.
