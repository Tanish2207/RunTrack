import { create } from 'zustand';

/**
 * Global ephemeral UI state (toasts). Consumed by the `Toast` component in
 * src/components — mount `<Toast />` once near the app root so any store can
 * raise non-blocking feedback (spec §6 "General UI/UX notes").
 */
export type ToastType = 'success' | 'error' | 'info';

interface UiState {
  toast: { message: string; type: ToastType; key: number } | null;
  showToast: (message: string, type?: ToastType) => void;
  clearToast: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  toast: null,
  showToast: (message, type = 'info') =>
    set({ toast: { message, type, key: Date.now() } }),
  clearToast: () => set({ toast: null }),
}));
