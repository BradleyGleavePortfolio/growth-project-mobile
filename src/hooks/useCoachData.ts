import { useEffect } from 'react';
import { useCoachStore } from '../store/coachStore';
import { useCurrentUser } from './useCurrentUser';

export function useCoachData() {
  const currentUser = useCurrentUser();
  const store = useCoachStore();

  useEffect(() => {
    if (currentUser && currentUser.role === 'coach') {
      store.loadClients(currentUser.id);
    }
  }, [currentUser?.id]);

  return store;
}
