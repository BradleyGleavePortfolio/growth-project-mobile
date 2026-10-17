/**
 * CoachBriefListScreen: the list a brief row such as "See weight logs" opens.
 * It holds exactly the clients the brief counted for that kind (passed in by
 * the brief, so the list always matches the row), and each row opens that
 * client the way the brief's single-client row does. Back returns to the brief.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Headline, QuietRow, Screen, ScreenTopBar } from '../../../ui';
import { useTheme } from '../../../theme/ThemeProvider';
import type { CoachBriefActionItem } from '../../../api/coachBriefApi';
import { actionTarget, briefFirstName, type BriefListKind, type BriefTarget } from './briefActions';

export type CoachBriefListParams = { kind: BriefListKind; items: CoachBriefActionItem[] };

const TITLE: Record<BriefListKind, string> = {
  messages: 'Messages',
  weight: 'Weight logs',
  checkins: 'Check-ins',
};

type ListNav = {
  goBack: () => void;
  navigate: (name: BriefTarget['tab'], params?: object) => void;
};

export default function CoachBriefListScreen({ route }: { route?: { params?: CoachBriefListParams } }) {
  const navigation = useNavigation<ListNav>();
  const { semanticColors: sc } = useTheme();
  const kind = route?.params?.kind;
  const title = kind ? TITLE[kind] : undefined;
  const rows = (route?.params?.items ?? []).flatMap((item) => {
    const target = actionTarget(item);
    if (!target) return [];
    const name = briefFirstName(item.client_name) ? item.client_name?.trim() : undefined;
    return [{ item, target, label: name ?? item.detail, detail: name ? item.detail : undefined }];
  });
  return (
    <Screen
      edges={['top']}
      header={<ScreenTopBar onBack={() => navigation.goBack()} testID="brief-list-top" />}
      testID="brief-list"
    >
      {title ? <Headline>{title}</Headline> : null}
      {rows.length > 0 ? (
        rows.map(({ item, target, label, detail }, i) => (
          <QuietRow
            key={`${item.client_id ?? item.type}-${i}`}
            label={label}
            detail={detail}
            onPress={() => navigation.navigate(target.tab, target.params)}
            accessibilityHint="Opens the screen for this item"
            testID={`brief-list-row-${item.client_id ?? i}`}
          />
        ))
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
});
