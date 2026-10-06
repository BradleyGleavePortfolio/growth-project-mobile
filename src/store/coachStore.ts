import { create } from 'zustand';
import { coachApi } from '../services/api';
import { logger } from '../utils/logger';
import {
  matchesRosterSearch,
  rosterActivityFromWire,
  type RosterClient,
} from '../utils/coach/clientRoster';

// UX-COACHLOOKUP-124: GET /coach/clients answers one page (20 rows by default,
// at most 50, newest first). The roster reads every page so a coach with more
// than one page sees, searches and counts every client. The page cap only
// stops a runaway loop.
export const ROSTER_PAGE_SIZE = 50;
export const ROSTER_MAX_PAGES = 40;

interface CoachStore {
  clients: RosterClient[];
  isLoading: boolean;
  // null when the last load succeeded or has not yet run. Holds a non-empty
  // message after a failed load so callers can render an error/retry block
  // instead of the empty state.
  loadError: string | null;
  searchQuery: string;
  filterStatus: 'all' | 'active' | 'archived';

  /**
   * `status` omitted reads active clients (Home, Messages, the review delta),
   * whatever filter the Clients list was left on. The Clients list passes its
   * filter: 'all' reads active and archived together. `silent` keeps the
   * current list on screen while it reloads (pull to refresh, coming back).
   */
  loadClients: (
    coachId: string,
    status?: 'active' | 'archived' | 'all',
    opts?: { silent?: boolean },
  ) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFilterStatus: (status: 'all' | 'active' | 'archived') => void;
  getFilteredClients: () => RosterClient[];
  // Security: reset on logout so a new coach on the same device can't briefly
  // see the previous coach's clients list before a fresh load completes.
  reset: () => void;
}

const initialCoachState = {
  clients: [] as RosterClient[],
  isLoading: false,
  loadError: null as string | null,
  searchQuery: '',
  filterStatus: 'active' as 'all' | 'active' | 'archived',
};

// Backend coach-clients row shape (GET /coach/clients). `role` arrives as the
// wire `student` string, normalized to the mobile `client` literal below;
// `activity` is the at-a-glance block (absent on older servers).
interface CoachClientRow {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  coach_id?: string | null;
  archived_at?: string | null;
  created_at?: string | null;
  activity?: unknown;
}

export const useCoachStore = create<CoachStore>((set, get) => ({
  ...initialCoachState,

  reset: () => set({ ...initialCoachState }),

  loadClients: async (
    _coachId: string,
    status?: 'active' | 'archived' | 'all',
    opts?: { silent?: boolean },
  ) => {
    const wireStatus = status ?? 'active';
    try {
      set(opts?.silent ? { loadError: null } : { isLoading: true, loadError: null });
      const raw: CoachClientRow[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < ROSTER_MAX_PAGES; page += 1) {
        const res = await coachApi.getClients(wireStatus, cursor, ROSTER_PAGE_SIZE);
        const rows: unknown = res.data;
        if (!Array.isArray(rows)) {
          // A first reply that is not a list reads as an empty roster, as it
          // always has; a later one would leave the roster partial: fail.
          if (page === 0) break;
          throw new Error('roster page was not a list');
        }
        for (const row of rows as CoachClientRow[]) {
          if (!row || typeof row.id !== 'string' || seen.has(row.id)) continue;
          seen.add(row.id);
          raw.push(row);
        }
        const last = (rows as CoachClientRow[])[rows.length - 1];
        if (rows.length < ROSTER_PAGE_SIZE || !last || typeof last.id !== 'string') break;
        cursor = last.id;
      }
      const clients: RosterClient[] = raw.map((u) => {
        const parts = (u.name || '').trim().split(/\s+/);
        return {
          id: u.id,
          role: u.role === 'student' ? 'client' : (u.role as RosterClient['role']),
          email: u.email || '',
          passwordHash: '',
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' ') || '',
          coachId: u.coach_id ?? undefined,
          // Reflect backend archived_at on the status field
          status: u.archived_at ? 'archived' : 'active',
          createdAt: u.created_at || new Date().toISOString(),
          updatedAt: u.created_at || new Date().toISOString(),
          activity: rosterActivityFromWire(u.activity),
        };
      });
      set({ clients, isLoading: false, loadError: null });
    } catch (err) {
      // Read-only client list load. Existing state stays so the previous
      // roster remains visible if the user already loaded once; the new
      // loadError flag lets the screen render an error/retry block. A page
      // that fails fails the whole load: never a partial roster shown as whole.
      logger.error('CoachStore', 'loadClients failed', err);
      set({
        isLoading: false,
        loadError: 'Clients did not load. Check the connection and try again.',
      });
    }
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setFilterStatus: (status: 'all' | 'active' | 'archived') => set({ filterStatus: status }),

  getFilteredClients: () => {
    const { clients, searchQuery } = get();
    // Status filtering is done server-side via loadClients; only search here.
    // Every typed word must match the full name or email (UX-COACHLOOKUP-124).
    if (!searchQuery.trim()) return clients;
    return clients.filter((c) => matchesRosterSearch(c, searchQuery));
  },
}));
