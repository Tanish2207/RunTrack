# 022 — Profile screen (stats, badge grid, settings, logout)

> **Milestone:** M6 · **Labels:** `ui`, `gamification` · **Depends on:** #007, #020, #021 · **Size:** M

## Summary

Spec §6 Profile: identity header with initials avatar, aggregate stats row, prominent
streak indicator, the full badge grid (unlocked vs greyed/locked), and Settings
(voice-coaching toggle, editable weight, Logout). Live-updates via `onSnapshot` so
badges/streaks appear immediately after saves.

## Tasks

- [ ] `src/screens/profile/ProfileScreen.tsx`:
  - Identity: initials avatar circle (first letters of name), name, email.
  - Stats row: total distance, total activities; streak card: "🔥 N-day streak" (flame icon accent-colored; grey at 0) + "Best: M days".
  - Badge grid (`src/components/BadgeGrid.tsx`): renders `BADGES` (#020) — unlocked in full color with unlock caption, locked greyed with a lock icon overlay; grid wraps 3 per row.
  - Settings section (Card):
    - Voice coaching: `Switch` bound to `settingsStore.voiceCoachingEnabled` (persisted #005) — same preference the Active Tracking mute icon (#012) controls.
    - Weight (`weightKg`): numeric TextField, default 70, on-blur validation (30–200) → `updateUserProfile(uid, { weightKg })`; used by the calorie formula (#009).
    - Logout: destructive button with confirm dialog ("Log out of RunTrack?") → `logout()` from #007.
  - `subscribeUserProfile` (`onSnapshot`) → live streak/badge updates without refocus; spinner while first load pending.
- [ ] Longest-streak display sourced from the same doc — no recomputation client-side.

## Acceptance Criteria

- [ ] All aggregate stats render correctly against Firestore data, including after a fresh save (live update).
- [ ] Badge grid shows every defined badge; newly unlocked ones appear in color with a toast (from #020) without app restart.
- [ ] Locked badges are visually unmistakable (lock icon + grey).
- [ ] Voice toggle persists and matches the Active Tracking mute state.
- [ ] Weight edit persists and immediately affects the next calorie computation.
- [ ] Logout confirms, then lands on Login with all stores cleared (#007 behavior).

## Implementation Notes

- This is the app's "identity" screen — spend the extra pass on visual polish here; it's graded.
- The streak indicator must be prominent per spec §3.7 ("🔥 4-day streak") — larger tile, accent flame.
- Keep Profile read-only except the two settings it owns; activities/users belong to their own tickets.
