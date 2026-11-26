// Phase 9 — Zustand store for foreground push notification banners.
//
// When a push arrives while the app is active, pushNotifications.ts writes
// the payload here. ForegroundNotificationBanner reads from here and renders
// a themed in-app banner at the top of the screen.
//
// REFINE-966 (#203-E45 (1) to (3)): showBanner holds the three banner rules:
// no banner for the screen already open, a safety card stays, and pushes that
// arrive while a card shows become one card with a count.

import { create } from 'zustand';

export interface BannerPayload {
  title: string;
  body: string;
  notificationId: string;
  /** Navigator screen name for deep-link routing on banner tap. */
  actionScreen?: string;
  /** Screen params for routing. */
  actionParams?: Record<string, string>;
  deepLink?: string;
  /** REFINE-966: the push data's own kind, else its type (strings only). Picks the banner's mark; never drawn or spoken. */
  kind?: string;
}

/** The safety look and its rules key on the screen the push opens, only (never on kind coach_alert). */
export const isSafetyBanner = (b: BannerPayload | null | undefined): boolean => b?.actionScreen === 'CoachSafetyAlert';

interface ForegroundBannerState {
  banner: BannerPayload | null;
  /** B3: the pushes shown on this card (0 with no card). */
  count: number;
  showBanner: (payload: BannerPayload) => void;
  dismissBanner: () => void;
  // Security (Hunter #2 P1-7): clear any visible/in-flight banner on logout so
  // the next user on the same device never sees a previous user's push
  // payload flash through before the navigator tears down.
  reset: () => void;
}

const initialBannerState = {
  banner: null as BannerPayload | null,
  count: 0,
};

let opensOpenScreen: ((payload: BannerPayload) => boolean) | null = null;

/** B1: the mounted banner's read of the open screen (as RootNavigator attaches the router's navigator). */
export function attachOpenScreenCheck(check: (payload: BannerPayload) => boolean): () => void {
  opensOpenScreen = check;
  return () => {
    if (opensOpenScreen === check) opensOpenScreen = null;
  };
}

export const foregroundBannerStore = create<ForegroundBannerState>((set) => ({
  ...initialBannerState,
  showBanner: (payload) => {
    // B1: a push whose own tap would open the screen already open shows nothing and changes nothing.
    if (opensOpenScreen?.(payload)) return;
    set((s) => {
      // B2: an ordinary push never replaces a safety card (its record stays in Notifications).
      if (isSafetyBanner(s.banner) && !isSafetyBanner(payload)) return s;
      // B3: over an ordinary card, an ordinary push is the same card with one more; a safety push starts its own.
      const together = s.banner !== null && !isSafetyBanner(s.banner) && !isSafetyBanner(payload);
      return { banner: payload, count: together ? s.count + 1 : 1 };
    });
  },
  dismissBanner: () => set({ banner: null, count: 0 }),
  reset: () => set({ ...initialBannerState }),
}));

/** Hook alias for component use. */
export const useForegroundBanner = foregroundBannerStore;
