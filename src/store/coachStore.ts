import { create } from 'zustand';
import { User, FoodLog } from '../types';
import { getClientsByCoachId } from '../db/userDb';
import { getRecentFoodLogsForCoach } from '../db/foodLogDb';

interface CoachStore {
  clients: User[];
  recentLogs: (FoodLog & { firstName?: string; lastName?: string })[];
  isLoading: boolean;
  searchQuery: string;
  filterStatus: 'all' | 'active' | 'archived';

  loadClients: (coachId: string) => Promise<void>;
  loadRecentActivity: (coachId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFilterStatus: (status: 'all' | 'active' | 'archived') => void;
  getFilteredClients: () => User[];
}

export const useCoachStore = create<CoachStore>((set, get) => ({
  clients: [],
  recentLogs: [],
  isLoading: false,
  searchQuery: '',
  filterStatus: 'all',

  loadClients: async (coachId: string) => {
    try {
      set({ isLoading: true });
      const clients = await getClientsByCoachId(coachId);
      set({ clients, isLoading: false });
    } catch (err) {
      console.error('loadClients error:', err);
      set({ isLoading: false });
    }
  },

  loadRecentActivity: async (coachId: string) => {
    try {
      const logs = await getRecentFoodLogsForCoach(coachId);
      set({ recentLogs: logs });
    } catch (err) {
      console.error('loadRecentActivity error:', err);
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setFilterStatus: (status: 'all' | 'active' | 'archived') => set({ filterStatus: status }),

  getFilteredClients: () => {
    const { clients, searchQuery, filterStatus } = get();
    let filtered = clients;

    if (filterStatus !== 'all') {
      filtered = filtered.filter((c) => c.status === filterStatus);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.firstName.toLowerCase().includes(q) ||
          c.lastName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q)
      );
    }

    return filtered;
  },
}));
