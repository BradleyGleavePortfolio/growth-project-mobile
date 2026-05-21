// Phase 9 — Zustand store for foreground push notification banners.
//
// When a push arrives while the app is active, pushNotifications.ts writes
// the payload here. ForegroundNotificationBanner reads from here and renders
// a themed in-app banner at the top of the screen.

import { create } from 'zustand';

export interface BannerPayload {
  title: string;
  body: string;
  notificationId: string;
  /** Navigator screen name for deep-link routing on banner tap. */
  actionScreen?: string;
  /** Screen params for routing. */
  actionParams?: Record<string, string>;
}

interface ForegroundBannerState {
  banner: BannerPayload | null;
  showBanner: (payload: BannerPayload) => void;
  dismissBanner: () => void;
  // Security (Hunter #2 P1-7): clear any visible/in-flight banner on logout so
  // the next user on the same device never sees a previous user's push
  // payload flash through before the navigator tears down.
  reset: () => void;
}

const initialBannerState = {
  banner: null as BannerPayload | null,
};

export const foregroundBannerStore = create<ForegroundBannerState>((set) => ({
  ...initialBannerState,
  showBanner: (payload) => set({ banner: payload }),
  dismissBanner: () => set({ banner: null }),
  reset: () => set({ ...initialBannerState }),
}));

/** Hook alias for component use. */
export const useForegroundBanner = foregroundBannerStore;
