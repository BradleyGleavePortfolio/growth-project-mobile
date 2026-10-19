/**
 * S-COACH — where each setup step opens, shared by the Home checklist (CoachHomeCards) and the UI-2 step tiles.
 * B-332-7 (Opus): `initial: false` keeps the Settings root under these screens. Without it a Settings stack that
 * was never opened is built with only the target screen, and the Settings tab can no longer reach sign out or
 * account deletion. Money opened from Home goes back to Home.
 * COACHTABS: with the six tabs Money is a tab; Money switches to its root.
 */
import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { ChecklistTarget } from '../../../components/coach/setup/CoachSetupChecklist';
import { featureFlags } from '../../../config/featureFlags';
import type { CoachTabParamList } from '../../../navigation/CoachNavigator';

export function useSetupOpener() {
  const navigation = useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  const openMoney = useCallback(
    () =>
      featureFlags.coachTabsV2
        ? navigation.navigate('MoneyStack', { screen: 'CoachMoney', pop: true })
        : navigation.navigate('SettingsStack', { screen: 'CoachMoney', params: { from: 'home' }, initial: false }),
    [navigation],
  );
  const open = useCallback(
    (target: ChecklistTarget) => {
      switch (target) {
        case 'get_paid':
        case 'invite':
          navigation.navigate('SettingsStack', { screen: 'CoachSetup', params: { section: target }, initial: false });
          return;
        case 'package':
          navigation.navigate('SettingsStack', { screen: 'CoachPackagesList', initial: false });
          return;
        case 'money':
          openMoney();
          return;
      }
    },
    [navigation, openMoney],
  );
  return { open, openMoney };
}
