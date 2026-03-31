import { useEffect } from 'react';
import { useClientStore } from '../store/clientStore';
import { useCurrentUser } from './useCurrentUser';
import { getTodayString } from '../utils/date';

export function useClientData() {
  const currentUser = useCurrentUser();
  const store = useClientStore();

  useEffect(() => {
    if (currentUser && currentUser.role === 'client') {
      store.loadDayData(currentUser.id, getTodayString());
      store.loadProfile(currentUser.id);
    }
  }, [currentUser?.id]);

  return store;
}
