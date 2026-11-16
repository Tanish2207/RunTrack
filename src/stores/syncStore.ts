import { create } from 'zustand';

/**
 * Offline-sync indicator state (spec §7). Pure state — no Firebase, no I/O.
 *
 * Writers: the sync worker / repositories in #013 (queue length and in-flight
 * flag). Consumer: the pending-sync banner on the History screen (#017).
 */
interface SyncState {
  /** Activities saved locally but not yet pushed to Firestore. */
  pendingCount: number;
  syncInProgress: boolean;
  setPendingCount: (n: number) => void;
  setSyncInProgress: (b: boolean) => void;
}

export const useSyncStore = create<SyncState>()((set) => ({
  pendingCount: 0,
  syncInProgress: false,
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setSyncInProgress: (syncInProgress) => set({ syncInProgress }),
}));
