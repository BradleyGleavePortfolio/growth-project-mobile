import { create } from 'zustand';
import { FastingSession } from '../types';
import {
  startFast as dbStartFast,
  endFast as dbEndFast,
  getActiveFast,
  getFastingHistory,
} from '../db/fastingDb';

interface FastingState {
  activeFast: FastingSession | null;
  selectedProtocol: number;
  history: FastingSession[];
  isLoading: boolean;

  loadActiveFast: (userId: string) => Promise<void>;
  startFast: (userId: string, coachId: string, hours: number) => Promise<void>;
  endFast: (userId: string) => Promise<void>;
  loadHistory: (userId: string) => Promise<void>;
  setProtocol: (hours: number) => void;
  // Security: reset on logout so the next user doesn't inherit the previous
  // user's active fast or history in memory.
  reset: () => void;
}

const initialFastingState = {
  activeFast: null as FastingSession | null,
  selectedProtocol: 16,
  history: [] as FastingSession[],
  isLoading: false,
};

export const useFastingStore = create<FastingState>((set, get) => ({
  ...initialFastingState,

  reset: () => set({ ...initialFastingState }),

  loadActiveFast: async (userId: string) => {
    const fast = await getActiveFast(userId);
    set({ activeFast: fast });
  },

  startFast: async (userId: string, coachId: string, hours: number) => {
    await dbStartFast(userId, coachId, hours);
    const fast = await getActiveFast(userId);
    set({ activeFast: fast });
  },

  endFast: async (userId: string) => {
    const { activeFast } = get();
    if (!activeFast) return;
    await dbEndFast(activeFast.id, userId);
    set({ activeFast: null });
    await get().loadHistory(userId);
  },

  loadHistory: async (userId: string) => {
    set({ isLoading: true });
    const history = await getFastingHistory(userId);
    set({ history, isLoading: false });
  },

  setProtocol: (hours: number) => set({ selectedProtocol: hours }),
}));
