/**
 * CoachBriefListScreen: the list a brief row such as "See weight logs" opens.
 * It holds exactly the clients the brief counted for that kind (passed in by
 * the brief, so the list always matches the row), and each row opens that
 * client the way the brief's single-client row does. Back returns to the brief.
 * ROMAN-EXTRAS-M: items whose detail names a group ("Check-in needs review",
 * "Has not checked in today", "Joined today") show under that group's header
 * with its count; every group shows ten rows at a time, then "Show more".
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Headline, QuietRow, Screen, ScreenTopBar } from '../../../ui';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography } from '../../../theme/tokens';
import type { CoachBriefActionItem } from '../../../api/coachBriefApi';
import type { CoachTabParamList } from '../../../navigation/CoachNavigator';
import { openTarget } from '../../../navigation/coachInbox';
import { actionTarget, briefFirstName, briefSections, type BriefListKind } from './briefActions';

export type CoachBriefListParams = { kind: BriefListKind; items: CoachBriefActionItem[] };

const TITLE: Record<BriefListKind, string> = {
  messages: 'Messages',
  weight: 'Weight logs',
  checkins: 'Check-ins',
  welcome: 'New clients',
};

/** Rows per group before "Show more". */
export const BRIEF_LIST_PAGE = 10;

export default function CoachBriefListScreen({ route }: { route?: { params?: CoachBriefListParams } }) {
  const navigation = useNavigation<NavigationProp<CoachTabParamList>>();
  const { semanticColors: sc } = useTheme();
  const [shown, setShown] = useState<Record<string, number>>({});
  const kind = route?.params?.kind;
  const title = kind ? TITLE[kind] : undefined;
  const sections = briefSections((route?.params?.items ?? []).filter((item) => actionTarget(item) !== null));
  return (
    <Screen
      edges={['top']}
      header={<ScreenTopBar onBack={() => navigation.goBack()} testID="brief-list-top" />}
      testID="brief-list"
    >
      {title ? <Headline>{title}</Headline> : null}
      {sections.length > 0 ? (
        sections.map((section) => {
          const key = section.title ?? '';
          const limit = shown[key] ?? BRIEF_LIST_PAGE;
          return (
            <View key={key} testID={`brief-list-section-${key || 'all'}`}>
              {section.title ? (
                <View
                  style={[styles.head, { borderBottomColor: sc.surface.sageLine }]}
                  accessible
                  accessibilityRole="header"
                  accessibilityLabel={`${section.title}, ${section.items.length}`}
                >
                  <Text style={[styles.headText, { color: sc.accentText }]}>{section.title}</Text>
                  <Text style={[styles.headText, { color: sc.accentText }]}>{section.items.length}</Text>
                </View>
              ) : null}
              {section.items.slice(0, limit).map((item, i) => {
                const target = actionTarget(item);
                const name = briefFirstName(item.client_name) ? item.client_name?.trim() : undefined;
                return target ? (
                  <QuietRow
                    key={`${item.type}-${item.client_id ?? i}`}
                    label={name ?? item.detail}
                    detail={name && !section.title ? item.detail : undefined}
                    onPress={() => openTarget(navigation, target)}
                    accessibilityHint="Opens the screen for this item"
                    testID={`brief-list-row-${item.client_id ?? i}`}
                  />
                ) : null;
              })}
              {section.items.length > limit ? (
                <Pressable
                  onPress={() => setShown((s) => ({ ...s, [key]: limit + BRIEF_LIST_PAGE }))}
                  accessibilityRole="button"
                  accessibilityLabel="Show more"
                  style={styles.more}
                  testID={`brief-list-more-${key || 'all'}`}
                >
                  <Text style={[styles.moreText, { color: sc.accentText }]}>Show more</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text style={[styles.empty, { color: sc.textMuted }]} testID="brief-list-empty">
          Nothing needs you right now.
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, marginTop: 16 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 22,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 20, fontVariant: ['tabular-nums'] },
  more: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  moreText: { ...typography.bodyMd, fontFamily: 'Inter_500Medium' },
});
