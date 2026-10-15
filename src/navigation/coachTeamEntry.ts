import { createContext } from 'react';

/**
 * COACHTABS — true when featureFlags.coachTabsV2 is on and CoachNavigator
 * registers the Team route (a Team Mode head coach). Team is then not a tab;
 * the Clients list reads this to show its one Team entry.
 */
export const CoachTeamEntryContext = createContext(false);
