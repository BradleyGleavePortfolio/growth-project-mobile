// Coach Command Center — root screen / tab host.
//
// This is the new top-level coach landing screen. It hosts a top-tab
// navigator with 5 tabs:
//   Overview | At-Risk | Win Streaks | Inbox | Action Queue
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
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../../../theme/tokens';
import OverviewScreen from './OverviewScreen';
import AtRiskScreen from './AtRiskScreen';
import WinStreaksScreen from './WinStreaksScreen';
import InboxScreen from './InboxScreen';
import ActionQueueScreen from './ActionQueueScreen';

export type CommandCenterTab =
  | 'overview'
  | 'at-risk'
  | 'win-streaks'
  | 'inbox'
  | 'action-queue';

const TABS: { key: CommandCenterTab; label: string }[] = [
  { key: 'overview',      label: 'Overview' },
  { key: 'at-risk',       label: 'At-Risk' },
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

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <OverviewScreen
            onNavigateToAtRisk={() => setActiveTab('at-risk')}
            onNavigateToWinStreaks={() => setActiveTab('win-streaks')}
            onNavigateToInbox={() => setActiveTab('inbox')}
            onNavigateToActionQueue={() => setActiveTab('action-queue')}
          />
        );
      case 'at-risk':
        return <AtRiskScreen onSelectClient={onSelectClient} />;
      case 'win-streaks':
        return <WinStreaksScreen onSelectClient={onSelectClient} />;
      case 'inbox':
        return <InboxScreen onOpenThread={onOpenThread} />;
      case 'action-queue':
        return <ActionQueueScreen onSelectClient={onSelectClient} />;
    }
  };

  return (
    <View style={styles.container} testID="command-center-root">
      {/* Top tab bar */}
      <View style={styles.tabBarWrapper}>
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
                style={[styles.tab, isActive && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityLabel={`${tab.label} tab`}
                accessibilityState={{ selected: isActive }}
                testID={`command-center-tab-${tab.key}`}
              >
                <Text
                  style={[styles.tabLabel, isActive && styles.tabLabelActive]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Screen content */}
      <View style={styles.content}>{renderContent()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  tabBarWrapper: {
    backgroundColor: colors.bone,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.camel,
    paddingTop: Platform.OS === 'ios' ? 0 : spacing.sm,
  },
  tabBar: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    flexDirection: 'row',
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,  // overlap the hairline divider when active
  },
  tabActive: {
    borderBottomColor: colors.forest,
  },
  tabLabel: {
    ...typography.caption,
    color: colors.stone,
  },
  tabLabelActive: {
    color: colors.forest,
  },
  content: {
    flex: 1,
  },
});
