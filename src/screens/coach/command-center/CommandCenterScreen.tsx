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
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { layout, spacing, typography } from '../../../theme/tokens';
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
import { isSafetyAlert, type ActionQueueItem } from '../../../services/commandCenterApi';
import { featureFlags } from '../../../config/featureFlags';
import { HapticService } from '../../../ui/haptics/haptics.service';

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
  /** The tab route: a safety alert push or inbox row opens `tab: 'action-queue'`. */
  route?: { params?: { tab?: 'action-queue' } };
}

export default function CommandCenterScreen({
  onSelectClient,
  onOpenThread,
  initialTab = 'overview',
  route,
}: Props) {
  const routeParams = route?.params;
  const [activeTab, setActiveTab] = React.useState<CommandCenterTab>(
    routeParams?.tab ?? initialTab,
  );
  // Each open of a safety alert push or inbox row switches to Actions, even
  // when Command Center is already mounted on another tab.
  React.useEffect(() => {
    if (routeParams?.tab === 'action-queue') setActiveTab('action-queue');
  }, [routeParams]);
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
  // COACHTABS: with the six tabs it switches to the Money tab's root.
  const openMoney = () =>
    featureFlags.coachTabsV2
      ? navigation.navigate('MoneyStack', { screen: 'CoachMoney', pop: true })
      : navigation.navigate('SettingsStack', { screen: 'CoachMoney', params: { from: 'home' }, initial: false });
  // COACHTABS: Settings is no longer a tab; it opens from this 44 pt gear at
  // the end of Overview's header row.
  const settingsGear = featureFlags.coachTabsV2 ? (
    <TouchableOpacity
      onPress={() => {
        HapticService.softImpact();
        navigation.navigate('SettingsStack', { screen: 'SettingsHome', pop: true });
      }}
      style={styles.gear}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      testID="command-center-settings"
    >
      <Ionicons name="settings-outline" size={22} color={sc.textPrimary} />
    </TouchableOpacity>
  ) : null;
  const openClients = () => navigation.navigate('ClientsStack', { screen: 'ClientsList' });
  const openSafetyAlert = (item: ActionQueueItem) => {
    if (!isSafetyAlert(item)) return;
    navigation.navigate('ClientsStack', {
      screen: 'CoachSafetyAlert',
      params: {
        alertType: item.alert_type,
        clientId: item.client_id,
        clientName: item.client_name,
        quote: item.quote ?? null,
        sentAt: item.sent_at ?? item.created_at,
      },
      initial: false,
    });
  };

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
        return <ActionQueueScreen onSelectClient={selectClient} onOpenSafetyAlert={openSafetyAlert} />;
    }
  };

  return (
    <Screen edges={['top']} scroll={false} contentStyle={styles.content} testID="command-center-root">
      {/* Top tab bar. AUDIT-13-125: no header above this tab; Screen keeps
          the tab row out of the status bar / Dynamic Island. */}
      <View style={[styles.tabBarWrapper, settingsGear && styles.tabBarWithGear, { backgroundColor: sc.bgPrimary, borderBottomColor: sc.border }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={settingsGear && styles.tabScroll}
          contentContainerStyle={[styles.tabBar, settingsGear && styles.tabBarBeforeGear]}
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
                  numberOfLines={1}
                  maxFontSizeMultiplier={settingsGear ? 1.1 : 1.2}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {settingsGear}
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
  // COACHTABS: the gear ends the row, its glyph 15 pt from the edge like a header button,
  // and the row starts 16 pt in to match. With the labels capped at 110% (the bar's K4 cap)
  // all five stay whole and at least 6 pt apart at 360 pt and any text size.
  tabBarWithGear: { flexDirection: 'row', alignItems: 'center' },
  tabScroll: { flex: 1 },
  tabBarBeforeGear: { paddingLeft: spacing.lg, paddingRight: 0, gap: 6 },
  gear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  // SHOTS-134B f: the five tabs share the content width (gutter to gutter) instead of
  // running off the right edge; it still scrolls at the largest text sizes.
  tabBar: {
    paddingHorizontal: layout.gutter,
    flexGrow: 1,
    justifyContent: 'space-between',
    flexDirection: 'row',
  },
  tab: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
