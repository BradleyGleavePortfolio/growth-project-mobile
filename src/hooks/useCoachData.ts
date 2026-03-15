import { useEffect } from 'react';
import { useCoachStore } from '../store/coachStore';
import { useAuthStore } from '../store/authStore';

export function useCoachData() {
  const { currentUser } = useAuthStore();
  const store = useCoachStore();

  useEffect(() => {
    if (currentUser && currentUser.role === 'coach') {
      store.loadClients(currentUser.id);
      store.loadRecentActivity(currentUser.id);
    }
  }, [currentUser?.id]);

  return store;
}
