import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';

import FadeInView from '../../components/FadeInView';
import { fastingApi } from '../../services/api';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { scheduleFastEndAlert } from '../../utils/fastingAlert';
import { typography, spacing, radius } from '../../theme/tokens';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { Screen } from '../../ui';
import { errorStatus } from '../../types/common';

// Wave 5b: WidgetsScreen reduced to the actions that actually work today.
// Per the no-placeholder doctrine, "Coming Soon" widgets, wearables and
// barcode-scanner stubs are removed from the shipped surface. They will
// return when there's a real implementation behind them.

type QuickActionId = 'quick-log' | 'start-fast';

interface QuickAction {
  id: QuickActionId;
  title: string;
  description: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'quick-log',
    title: 'Quick log',
    description: 'Open the food log',
    icon: 'add-circle-outline',
  },
  {
    id: 'start-fast',
    title: 'Start fast',
    description: 'Begin a 16:8 fasting session',
    icon: 'play-circle-outline',
  },
];

const DEFAULT_FAST_PROTOCOL = '16:8';

export default function WidgetsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [startingFast, setStartingFast] = useState(false);
  const currentUser = useCurrentUser();

  const handleStartFast = useCallback(async () => {
    if (startingFast) return;
    Alert.alert(
      'Start 16:8 fast',
      'Begin a 16-hour fast now? Your fasting timer will start immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            setStartingFast(true);
            try {
              await fastingApi.start({ protocol: DEFAULT_FAST_PROTOCOL });
              // Same end alert as a fast started on the Fasting screen.
              if (currentUser) {
                const hours = Number(DEFAULT_FAST_PROTOCOL.split(':')[0]);
                await scheduleFastEndAlert(currentUser.id, hours);
              }
              navigation.navigate('Fast');
            } catch (err: unknown) {
              const status = errorStatus(err);
              const message = status === 400 || status === 409
                ? 'A fast is already running. Open Fasting to see it.'
                : 'The fast did not start. Check the connection and try again.';
              Alert.alert('Could not start fast', message);
            } finally {
              setStartingFast(false);
            }
          },
        },
      ],
    );
  }, [startingFast, navigation, currentUser]);

  const handlePress = useCallback(
    (id: QuickActionId) => {
      if (id === 'start-fast') {
        handleStartFast();
        return;
      }
      if (id === 'quick-log') {
        navigation.navigate('Log');
      }
    },
    [navigation, handleStartFast],
  );

  return (
    <Screen edges={['top']} contentStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Shortcuts</Text>
      </View>

      <FadeInView>
        <View style={styles.section}>
          <Text style={styles.eyebrow}>Quick actions</Text>
          {QUICK_ACTIONS.map((action) => {
            const isStartFast = action.id === 'start-fast';
            const isLoading = isStartFast && startingFast;

            return (
              <TouchableOpacity
                key={action.id}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => handlePress(action.id)}
                disabled={isLoading}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name={action.icon} size={22} color={colors.primary} />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{action.title}</Text>
                  <Text style={styles.cardDesc}>{action.description}</Text>
                </View>
                {isLoading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </FadeInView>
    </Screen>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  // Screen owns the inset top (insets.top + 12) and the page colour.
  content: {
    paddingHorizontal: 0,
    paddingBottom: spacing['2xl'],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
  },
  title: {
    fontFamily:    typography.h1.fontFamily,
    fontSize:      typography.h1.fontSize,
    lineHeight:    typography.h1.lineHeight,
    fontWeight:    typography.h1.fontWeight,
    letterSpacing: typography.h1.letterSpacing,
    color:         colors.textPrimary,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  eyebrow: {
    fontFamily:     typography.eyebrow.fontFamily,
    fontSize:       typography.eyebrow.fontSize,
    lineHeight:     typography.eyebrow.lineHeight,
    fontWeight:     typography.eyebrow.fontWeight,
    letterSpacing:  typography.eyebrow.letterSpacing,
    textTransform:  'uppercase',
    color:          colors.textSecondary,
    marginBottom:   spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.input,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.input,
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontFamily:    typography.bodyMd.fontFamily,
    fontSize:      typography.bodyMd.fontSize,
    lineHeight:    typography.bodyMd.lineHeight,
    fontWeight:    typography.bodyMd.fontWeight,
    letterSpacing: typography.bodyMd.letterSpacing,
    color:         colors.textPrimary,
    marginBottom:  2,
  },
  cardDesc: {
    fontFamily:    typography.bodySmall.fontFamily,
    fontSize:      typography.bodySmall.fontSize,
    lineHeight:    typography.bodySmall.lineHeight,
    color:         colors.textSecondary,
  },

  });
