/**
 * CoachCommunityLabScreen — the coach's private scratch space for drafting
 * posts and DMs (v1-6). There is NO backend endpoint for this surface yet
 * (v2-4 ships AI triage); the draft persists to AsyncStorage only.
 *
 * Behaviour:
 *   - On mount, hydrate the saved draft from AsyncStorage.
 *   - The draft autosaves (debounced) on every edit, and on blur, so a coach
 *     never loses a half-written thought when they leave the tab.
 *   - When the draft is empty, the editor sits beneath the operator-locked
 *     Roman-voiced empty state (neutral crop). Once the coach types, the empty
 *     state is replaced by a saved-state line — there is never a bare spinner.
 *   - A "Clear" action wipes the draft (and the persisted copy) so the coach
 *     can start fresh.
 *
 * Persistence is local-only and failure-tolerant: an AsyncStorage read/write
 * error degrades to an in-memory draft for the session rather than crashing or
 * silently dropping the coach's text. No console noise is left behind.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import HapticPressable from '../../components/HapticPressable';
import { CoachEmptyState, COACH_EMPTY_COPY } from '../../components/community/coach';

/** AsyncStorage key for the coach's private lab draft. */
export const COACH_LAB_DRAFT_KEY = 'coachCommunity.lab.draft.v1';

type SaveState = 'idle' | 'saving' | 'saved';

export default function CoachCommunityLabScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate the saved draft once on mount.
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(COACH_LAB_DRAFT_KEY);
        if (mounted && stored != null) setDraft(stored);
      } catch {
        // Local read failed — start with an empty in-memory draft.
      } finally {
        if (mounted) setHydrated(true);
      }
    })();
    return () => {
      mounted = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const persist = useCallback(async (value: string) => {
    setSaveState('saving');
    try {
      await AsyncStorage.setItem(COACH_LAB_DRAFT_KEY, value);
      setSaveState('saved');
    } catch {
      // Keep the in-memory draft; surface a neutral idle state rather than an
      // error banner for a local-only convenience save.
      setSaveState('idle');
    }
  }, []);

  const onChange = useCallback(
    (value: string) => {
      setDraft(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void persist(value);
      }, 600);
    },
    [persist],
  );

  const onBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void persist(draft);
  }, [draft, persist]);

  const onClear = useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setDraft('');
    setSaveState('idle');
    try {
      await AsyncStorage.removeItem(COACH_LAB_DRAFT_KEY);
    } catch {
      // Local clear failed — the in-memory draft is already empty.
    }
  }, []);

  const hasDraft = draft.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: semanticColors.bgPrimary }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="coach-community-lab-screen"
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!hasDraft ? (
          <CoachEmptyState
            crop={COACH_EMPTY_COPY.lab.crop}
            copy={COACH_EMPTY_COPY.lab.copy}
            testID="coach-community-lab-empty"
          />
        ) : (
          <View style={styles.savedRow}>
            <Text style={[styles.savedText, { color: semanticColors.textMuted }]}>
              {saveState === 'saving'
                ? 'Saving your draft'
                : saveState === 'saved'
                  ? 'Draft saved on this device'
                  : 'Draft kept on this device'}
            </Text>
          </View>
        )}

        <TextInput
          value={draft}
          onChangeText={onChange}
          onBlur={onBlur}
          editable={hydrated}
          multiline
          placeholder="Draft a post or a message to a client"
          placeholderTextColor={semanticColors.textMuted}
          accessibilityLabel="Drafting lab editor"
          testID="coach-community-lab-input"
          style={[
            styles.input,
            {
              backgroundColor: semanticColors.bgSurface,
              borderColor: semanticColors.border,
              color: semanticColors.textPrimary,
            },
          ]}
        />

        {hasDraft ? (
          <HapticPressable
            intent="warning"
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel="Clear the draft"
            testID="coach-community-lab-clear"
            style={[styles.clear, { borderColor: semanticColors.border }]}
          >
            <Text style={[styles.clearLabel, { color: semanticColors.textPrimary }]}>
              Clear draft
            </Text>
          </HapticPressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  savedRow: {
    alignItems: 'center',
  },
  savedText: {
    fontSize: 13,
  },
  input: {
    minHeight: 200,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  clear: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-start',
  },
  clearLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
