# 026 — UX polish sweep (loading, toasts, empty states, consistency)

> **Milestone:** M9 · **Labels:** `ui`, `polish` · **Depends on:** most screens (#006–#015, #022, #025) · **Size:** M

## Summary

Spec §6 "General UI/UX notes" as a dedicated audit pass: every async operation shows a
loading state, every success/error gives non-blocking toast feedback, confirm dialogs are
reserved for destructive actions only, and the whole app reads as one deliberately
designed product.

## Tasks

- [ ] Audit matrix over every screen (walk each one, note fixes, apply):
  - **Loading:** Login/Signup submit, auth bootstrap, History first load, Detail load, Summary save, AI card, Heatmap fetch, Profile first load — an `ActivityIndicator` or button-level spinner for each; nothing silently frozen.
  - **Toasts:** saved / saved-offline / synced / badge unlocked / save failed / sync failed / network errors — all via `uiStore`-driven `Toast` (#002); none blocking input.
  - **Dialogs:** only Stop (#012), Discard (#014), Logout (#022) use `Alert.alert`. Verify no validation uses dialogs (inline field errors everywhere).
  - **Empty states:** History, Heatmap, badge grid (never empty — locked badges fill it), Detail "not found".
  - **Consistency:** grep for raw hex/spacings outside `src/theme` — all replaced with tokens; identical Card paddings, button heights, header styles app-wide.
- [ ] Transitions polish: screen headers consistent; tab bar styling consistent; safe areas respected on notched devices (check Track HUD bottom padding).
- [ ] Keyboard handling on auth screens: `KeyboardAvoidingView`, scroll-enabled so inline errors stay visible on small screens.
- [ ] Stretch (skip unless everything else is done): km/mi unit toggle — spec §12 optional; do not add unless the core audit is finished.

## Acceptance Criteria

- [ ] Full manual pass with zero findings left: no silent async, no blocking dialogs for non-destructive feedback, no off-token styling.
- [ ] Slow-network simulation (emulator network throttling) shows spinners rather than frozen UI on every fetch.
- [ ] App feels uniform: side-by-side screenshots of all 8 screens share identical spacing/typography/cards.
- [ ] Audit notes recorded in `docs/DECISIONS.md` (what was fixed where) for the writeup.

## Implementation Notes

- This ticket exists because polish scoped as "later" never happens — book a hard slot for it.
- New findings discovered during the audit get fixed inline here, not as new tickets (lab-project scale).
