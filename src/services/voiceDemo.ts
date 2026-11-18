import * as Speech from 'expo-speech';
import { useSettingsStore } from '../stores/settingsStore';
import { useTrackingStore } from '../stores/trackingStore';
import { useUiStore } from '../stores/uiStore';
import { computeElapsedMs } from '../utils/tracking';

export const VOICE_DEMO_DELAY_MS = 15_000;
export const VOICE_DEMO_MESSAGE =
  'You are doing great. You have completed 15 seconds of activity till now.';

/** Engine-owned: works without GPS movement and survives screen/tab changes. */
export function startVoiceDemo(isForeground: () => boolean): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let revision = 0;
  let speechRequested = false;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function cancelSpeech() {
    revision++;
    if (!speechRequested) return;
    speechRequested = false;
    try { void Speech.stop().catch(() => undefined); }
    catch { /* Native cleanup must not interrupt tracking. */ }
  }

  function canSpeak() {
    return !disposed && isForeground() &&
      useTrackingStore.getState().status === 'recording' &&
      useSettingsStore.getState().voiceCoachingEnabled;
  }

  function reportError() {
    if (canSpeak()) useUiStore.getState().showToast('Voice demo could not play. Check your device’s text-to-speech settings.', 'error');
  }

  function playDemo() {
    timer = null;
    const state = useTrackingStore.getState();
    if (disposed || state.status !== 'recording' || state.voiceDemoPlayed || !isForeground()) return;
    // Consume the milestone even when muted: unmuting must not replay old cues.
    state.markVoiceDemoPlayed();
    if (!canSpeak()) return;
    speechRequested = true;
    const token = ++revision;
    void (async () => {
      try {
        await Speech.stop();
        // Stop/pause/mute may arrive while native speech cleanup is pending.
        if (token !== revision || !canSpeak()) return;
        Speech.speak(VOICE_DEMO_MESSAGE, {
          language: 'en', rate: 1.0, pitch: 1.0,
          onError: () => { if (token === revision) reportError(); },
        });
      } catch { if (token === revision) reportError(); }
    })();
  }

  function schedule() {
    clearTimer();
    const state = useTrackingStore.getState();
    if (disposed || state.status !== 'recording') { cancelSpeech(); return; }
    if (state.voiceDemoPlayed) return;
    const remaining = VOICE_DEMO_DELAY_MS - computeElapsedMs(state, Date.now());
    timer = setTimeout(playDemo, Math.max(0, remaining));
  }

  const unsubscribeTracking = useTrackingStore.subscribe((state, previous) => {
    if (state.status !== previous.status || state.startedAt !== previous.startedAt ||
      state.totalPausedMs !== previous.totalPausedMs || state.voiceDemoPlayed !== previous.voiceDemoPlayed) schedule();
  });
  const unsubscribeSettings = useSettingsStore.subscribe((state) => {
    if (!state.voiceCoachingEnabled) cancelSpeech();
  });
  schedule();

  return () => {
    disposed = true;
    clearTimer();
    cancelSpeech();
    unsubscribeTracking();
    unsubscribeSettings();
  };
}
