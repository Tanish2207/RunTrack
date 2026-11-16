import { create } from 'zustand';
import type { AuthUser, UserProfile } from '../api/types';

/**
 * Auth/session state (spec §7). Pure state — no Firebase imports.
 *
 * Writers: the auth bootstrap in #007 (setUser + initializing via
 * onAuthStateChanged) and the profile repository/screens in #013/#022
 * (setProfile after reading users/{uid}). Sign-out calls clear().
 * Consumers: route guards (#006), Home HUD, Profile.
 */
interface AuthState {
  user: AuthUser | null;
  profile: UserProfile | null;
  /** True until the first onAuthStateChanged fires (#007). */
  initializing: boolean;
  setUser: (u: AuthUser | null) => void;
  setProfile: (p: UserProfile | null) => void;
  /** Sign-out: drop identity and profile, and report auth as resolved. */
  clear: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  profile: null,
  initializing: true,
  setUser: (user) => set({ user }),
  setProfile: (profile) => set({ profile }),
  clear: () => set({ user: null, profile: null, initializing: false }),
}));
