import { featureFlags } from '../config/featureFlags';
import { __USING_MOCK_DATA } from '../services/commandCenterApi';

/**
 * COACHLAND: the tab a coach opens the app on (CoachNavigator's initialRouteName).
 * C-S-PUSH-3: the coach's deferred push ask renders on this tab's screen only,
 * so it moves with the landing and is never asked a second time on another tab.
 */
export const coachLandingTab = (): 'CommandCenter' | 'ClientsStack' =>
  __USING_MOCK_DATA || featureFlags.coachTabsV2 ? 'CommandCenter' : 'ClientsStack';
