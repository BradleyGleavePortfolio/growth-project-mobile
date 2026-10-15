import { createContext } from 'react';

/**
 * COACHTABS — true while CoachNavigator registers the Team route (a Team Mode
 * head coach). With featureFlags.coachTabsV2 Team is not a tab; the Clients
 * list reads this to show its one Team entry.
 */
export const CoachTeamEntryContext = createContext(false);
