import { create } from 'zustand';
import { User } from '../types';
import { coachApi } from '../services/api';

interface CoachStore {
  clients: User[];
  isLoading: boolean;
  searchQuery: string;
  filterStatus: 'all' | 'active' | 'archived';

  loadClients: (coachId: string, status?: 'active' | 'archived' | 'all') => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFilterStatus: (status: 'all' | 'active' | 'archived') => void;
  getFilteredClients: () => User[];
  // Security: reset on logout so a new coach on the same device can't briefly
  // see the previous coach's clients list before a fresh load completes.
  reset: () => void;
}

const initialCoachState = {
  clients: [] as User[],
  isLoading: false,
  searchQuery: '',
  filterStatus: 'all' as const,
};

export const useCoachStore = create<CoachStore>((set, get) => ({
  ...initialCoachState,

  reset: () => set({ ...initialCoachState }),

  loadClients: async (_coachId: string, status?: 'active' | 'archived' | 'all') => {
    const { filterStatus } = get();
    const effectiveStatus = status ?? filterStatus ?? 'all';
    try {
      set({ isLoading: true });
      const res = await coachApi.getClients(effectiveStatus === 'all' ? undefined : effectiveStatus);
      // Backend coach-clients row shape. Field names mirror the
      // /v1/coach/me/clients DTO; `role` arrives as the wire `student`
      // string, normalized to the mobile `client` literal below.
      interface CoachClientRow {
        id: string;
        name?: string | null;
        email?: string | null;
        role?: string | null;
        coach_id?: string | null;
        archived_at?: string | null;
        created_at?: string | null;
      }
      const raw: CoachClientRow[] = res.data || [];
      const clients: User[] = raw.map((u) => {
        const parts = (u.name || '').split(' ');
        return {
          id: u.id,
          role: u.role === 'student' ? 'client' : (u.role as User['role']),
          email: u.email || '',
          passwordHash: '',
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' ') || '',
          coachId: u.coach_id ?? undefined,
          // Reflect backend archived_at on the status field
          status: u.archived_at ? 'archived' : 'active',
          createdAt: u.created_at || new Date().toISOString(),
          updatedAt: u.created_at || new Date().toISOString(),
        };
      });
      set({ clients, isLoading: false });
    } catch (err) {
      // Read-only client list load. Existing state stays; user can retry
      // via the coach-home pull-to-refresh.
      console.error('coachStore: loadClients failed', err);
      set({ isLoading: false });
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setFilterStatus: (status: 'all' | 'active' | 'archived') => set({ filterStatus: status }),

  getFilteredClients: () => {
    const { clients, searchQuery } = get();
    let filtered = clients;
    // Status filtering is now done server-side via loadClients; only apply search here

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
