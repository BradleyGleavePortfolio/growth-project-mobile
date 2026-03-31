import { create } from 'zustand';
import { User } from '../types';
import { coachApi } from '../services/api';

interface CoachStore {
  clients: User[];
  isLoading: boolean;
  searchQuery: string;
  filterStatus: 'all' | 'active' | 'archived';

  loadClients: (coachId: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFilterStatus: (status: 'all' | 'active' | 'archived') => void;
  getFilteredClients: () => User[];
}

export const useCoachStore = create<CoachStore>((set, get) => ({
  clients: [],
  isLoading: false,
  searchQuery: '',
  filterStatus: 'all',

  loadClients: async (_coachId: string) => {
    try {
      set({ isLoading: true });
      const res = await coachApi.getClients();
      const raw: any[] = res.data || [];
      const clients: User[] = raw.map((u: any) => {
        const parts = (u.name || '').split(' ');
        return {
          id: u.id,
          role: u.role === 'student' ? 'client' : u.role,
          email: u.email || '',
          passwordHash: '',
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' ') || '',
          coachId: u.coach_id,
          status: 'active' as const,
          createdAt: u.created_at || new Date().toISOString(),
          updatedAt: u.created_at || new Date().toISOString(),
        };
      });
      set({ clients, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
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
