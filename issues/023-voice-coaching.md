# 023 — Voice pace coaching (per-km TTS + mute)

> **Milestone:** M7 · **Labels:** `feature`, `tts` · **Depends on:** #012, #005 · **Size:** M

## Summary

Spec §3.8: during an active session, announce each completed kilometer via `expo-speech`
("Kilometer 3 complete. Current pace: 5 minutes 42 seconds per kilometer."). Mute/unmute
is the persisted preference from #012; never overlap utterances.

## Tasks

- [ ] `src/services/voiceCoach.ts`:
  - `announceKm(kmNumber, paceSecPerKm)` — `Speech.stop()` **then** `Speech.speak(...)` (spec-required single-utterance rule), options `{ language: 'en', rate: 1.0, pitch: 1.0 }`.
  - Phrase via `paceToSpeech` (#009): "Kilometer 3 complete. Current pace: 5 minutes 42 seconds per kilometer." Handle sub-hour paces and clamp absurd values silently.
  - No-op when `settingsStore.voiceCoachingEnabled` is false (checked at call time, so mid-run mute is instant).
- [ ] Trigger wiring in the tracking path (`trackingStore.appendPoint` consumer or the engine's point handler):
  - `const km = Math.floor(distanceKm)`; if `km > lastAnnouncedKm` → `announceKm(km, currentPace)`; update `lastAnnouncedKm`.
  - Distance fed to the trigger must be the pause-corrected accumulated distance (segments-based, same source as the HUD).
- [ ] Edge cases:
  - No announcement for km 0; resumed runs continue at the correct km count (`lastAnnouncedKm` lives in the store across pause/resume).
  - Fast cycling may skip whole km numbers between fixes (5s × 50km/h ≈ 70m/fix, fine — but if `km - lastAnnounced > 1`, announce only the latest km, not every intermediate).
- [ ] The mute icon (#012) already toggles the persisted setting; verify it stops announcements **immediately** (also `Speech.stop()` on toggle-to-mute).
- [ ] Restore-behavior check: announcements survive pause/resume and do not double-fire after a paused interval.

## Acceptance Criteria

- [ ] Crossing each km boundary on an emulator route produces exactly one announcement per km with the correct number and pace.
- [ ] Mute toggled mid-run stops speech instantly and persists across restarts; unmute resumes announcements at the next km.
- [ ] Rapid consecutive triggers never overlap audio (`Speech.stop()` before every speak).
- [ ] No announcements while paused; none after Stop.
- [ ] Behavior identical with the app's screen locked-but-awake (keep-awake path from #010/#012).

## Implementation Notes

- `expo-speech` needs no permissions (spec §8) — nothing to configure.
- Trigger check must be cheap (a comparison per GPS fix at 2–3 Hz — fine).
- TTS on Android emulator works; still validate on a physical Android device if available — record result in `docs/DECISIONS.md`.
