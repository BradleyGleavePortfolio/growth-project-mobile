// Coach Command Center — root screen / tab host.
//
// This is the new top-level coach landing screen. It hosts a top-tab
// navigator with 5 tabs:
//   Overview | At risk | Streaks | Inbox | Actions
// QA-COACH-HOME-131: sentence-case 14 pt labels in theme colours (textMuted
// inactive, AA on bone; accentText active) on 44 pt tall tabs.
// COACH-HOME-134: the shared Screen owns the top inset (insets + 12 pt, iOS and Android alike).
//
// Navigation into client-level detail (ClientDetail, ClientMessages) is
// handled by navigating up to the ClientsStack in CoachNavigator via the
// onSelectClient / onOpenThread props passed to child screens.

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { spacing, typography } from '../../../theme/tokens';
import { Screen } from '../../../ui';
import { useTheme } from '../../../theme/useTheme';
import type { CoachTabParamList } from '../../../navigation/CoachNavigator';
import OverviewScreen from './OverviewScreen';
import AtRiskScreen from './AtRiskScreen';
import WinStreaksScreen from './WinStreaksScreen';
import InboxScreen from './InboxScreen';
import ActionQueueScreen from './ActionQueueScreen';
import CoachHomeCards from './CoachHomeCards';
import { coachHomeSources } from './coachHomeSources';

export type CommandCenterTab =
  | 'overview'
  | 'at-risk'
  | 'win-streaks'
  | 'inbox'
  | 'action-queue';

const TABS: { key: CommandCenterTab; label: string }[] = [
  { key: 'overview',      label: 'Overview' },
  { key: 'at-risk',       label: 'At risk' },
  { key: 'win-streaks',   label: 'Streaks' },
  { key: 'inbox',         label: 'Inbox' },
  { key: 'action-queue',  label: 'Actions' },
];

interface Props {
  /** Navigate to client detail screen (up to ClientsStack). */
  onSelectClient?: (userId: string, displayName: string) => void;
  /** Navigate to existing ClientMessages screen (up to ClientsStack). */
  onOpenThread?: (clientId: string, clientName: string) => void;
  /** Pre-select a tab on mount. Defaults to 'overview'. */
  initialTab?: CommandCenterTab;
}

export default function CommandCenterScreen({
  onSelectClient,
  onOpenThread,
  initialTab = 'overview',
}: Props) {
  const [activeTab, setActiveTab] = React.useState<CommandCenterTab>(initialTab);
  // AUDIT-13-125: the Overview tab mounts this screen with no props, so every
  // client row and inbox thread was a dead tap. Default to the Clients stack
  // (`initial: false` keeps the Clients list under it for Back).
  const navigation = useNavigation<BottomTabNavigationProp<CoachTabParamList>>();
  const { semanticColors: sc } = useTheme();
  const selectClient =
    onSelectClient ??
    ((clientId: string, clientName: string) =>
      navigation.navigate('ClientsStack', {
        screen: 'ClientDetail',
        params: { clientId, clientName },
        initial: false,
      }));
  const openThread =
    onOpenThread ??
    ((clientId: string, clientName: string) =>
      navigation.navigate('ClientsStack', {
        screen: 'ClientMessages',
        params: { clientId, clientName },
        initial: false,
      }));
  // Same Money route as the Home's Money card (B-332-7: `initial: false`).
  const openMoney = () =>
    navigation.navigate('SettingsStack', { screen: 'CoachMoney', params: { from: 'home' }, initial: false });
  const openClients = () => navigation.navigate('ClientsStack', { screen: 'ClientsList' });

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewScreen
            onNavigateToAtRisk={() => setActiveTab('at-risk')}
            onNavigateToWinStreaks={() => setActiveTab('win-streaks')}
            onNavigateToInbox={() => setActiveTab('inbox')}
            onNavigateToActionQueue={() => setActiveTab('action-queue')}
            onSelectClient={selectClient}
            onOpenThread={openThread}
            onOpenMoney={openMoney}
            onOpenClients={openClients}
            sources={coachHomeSources}
            header={<CoachHomeCards />}
          />
        );
      case 'at-risk':
        return <AtRiskScreen onSelectClient={selectClient} />;
      case 'win-streaks':
        return <WinStreaksScreen onSelectClient={selectClient} />;
      case 'inbox':
        return <InboxScreen onOpenThread={openThread} />;
      case 'action-queue':
        return <ActionQueueScreen onSelectClient={selectClient} />;
    }
  };

  return (
    <Screen edges={['top']} scroll={false} contentStyle={styles.content} testID="command-center-root">
      {/* Top tab bar. AUDIT-13-125: no header above this tab; Screen keeps
          the tab row out of the status bar / Dynamic Island. */}
      <View style={[styles.tabBarWrapper, { backgroundColor: sc.bgPrimary, borderBottomColor: sc.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tab, isActive && { borderBottomColor: sc.accent }]}
                accessibilityRole="tab"
                accessibilityLabel={`${tab.label} tab`}
                accessibilityState={{ selected: isActive }}
                testID={`command-center-tab-${tab.key}`}
              >
                <Text
                  style={[styles.tabLabel, { color: isActive ? sc.accentText : sc.textMuted }]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Screen content */}
      {renderContent()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabBarWrapper: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBar: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  tab: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,  // overlap the hairline divider when active
  },
  tabLabel: {
    ...typography.bodySmall,
  },
  content: {
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
});
