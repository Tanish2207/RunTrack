import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persisted user settings (spec §7) — the only store allowed I/O, via the
 * zustand persist middleware backed by AsyncStorage (key "runtrack-settings").
 *
 * Writers: the Profile screen (#022) for weightKg and the Settings / voice
 * coach mute toggle (#023) for voiceCoachingEnabled. Weight clamping and
 * validation live in the UI, not here.
 */
interface SettingsState {
  /** Voice-coach announcements enabled by default (#023). */
  voiceCoachingEnabled: boolean;
  /** Default 70 kg; used for the calorie estimate (spec §3.3). */
  weightKg: number;
  setVoiceCoachingEnabled: (v: boolean) => void;
  setWeightKg: (w: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      voiceCoachingEnabled: true,
      weightKg: 70,
      setVoiceCoachingEnabled: (voiceCoachingEnabled) =>
        set({ voiceCoachingEnabled }),
      setWeightKg: (weightKg) => set({ weightKg }),
    }),
    {
      name: 'runtrack-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
