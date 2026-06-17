/**
 * CustomExerciseComposer — the coach-facing surface for AUTHORING a brand-new
 * move that is not in the fixed catalog: a free-text name, written instructions,
 * and an optional image/video the coach picks from their device.
 *
 * Behind EXPO_PUBLIC_FF_CUSTOM_EXERCISE (the host gates mounting). On save it
 * publishes the move into the coach's own reusable library via useAuthorExercise
 * (presign -> direct PUT -> durable create, the shipped voice-note media idiom),
 * then hands the KEPT CoachExercise back to the host so it can add a row to the
 * plan referencing it.
 *
 * Design: quiet-luxury — semantic theme tokens only (no raw hex), Roman's
 * straight butler register for every coach-facing string (sourced from
 * roman/copy, never inlined), no emoji. The media picker reuses
 * expo-document-picker (already a dependency, used by BulkInviteScreen) so no
 * new native module is added. The byte size + uri come straight off the picked
 * asset; the upload + persistence are the hook's job.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  CUSTOM_EXERCISE_MIME_ALLOWLIST,
  MAX_CUSTOM_EXERCISE_INSTRUCTIONS,
  MAX_CUSTOM_EXERCISE_NAME,
  type CoachExercise,
  type CustomExerciseMediaKind,
  type CustomExerciseMime,
} from '../../../api/coachExerciseApi';
import { useAuthorExercise } from '../../../hooks/useCoachExerciseLibrary';
import { track } from '../../../lib/analytics';
import { AnalyticsEvents } from '../../../analytics/events';
import { romanCustomExerciseComposer, romanGenericError } from '../../../lib/roman/copy';
import { spacing, typography } from '../../../theme/tokens';
import type { SemanticTokens } from '../../../theme/tokens';
import { useTheme } from '../../../theme/ThemeProvider';
import { errorMessage } from '../../../types/common';

/** A media asset the coach picked, normalised for the publish pipeline. */
interface PickedMedia {
  uri: string;
  bytes: number;
  mimeType: CustomExerciseMime;
  kind: Exclude<CustomExerciseMediaKind, 'none'>;
  label: string;
}

function mimeToKind(
  mime: string,
): Exclude<CustomExerciseMediaKind, 'none'> | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

function isAllowedMime(mime: string): mime is CustomExerciseMime {
  return (CUSTOM_EXERCISE_MIME_ALLOWLIST as readonly string[]).includes(mime);
}

export interface CustomExerciseComposerProps {
  /** Called with the KEPT library move once it is saved, so the host can use it. */
  onCreated: (exercise: CoachExercise) => void;
  /** Dismiss the composer without saving. */
  onCancel: () => void;
}

export default function CustomExerciseComposer({
  onCreated,
  onCancel,
}: CustomExerciseComposerProps) {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);

  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const authorMut = useAuthorExercise();
  const saving = authorMut.isPending;
  const canSave = name.trim().length > 0 && !saving;

  const onPickMedia = useCallback(async () => {
    setLocalError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: [...CUSTOM_EXERCISE_MIME_ALLOWLIST],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset) return;
    const mime = asset.mimeType ?? '';
    const kind = mimeToKind(mime);
    if (!isAllowedMime(mime) || !kind) {
      setLocalError('That file type is not supported. Pick an image or video.');
      return;
    }
    setMedia({
      uri: asset.uri,
      bytes: asset.size ?? 0,
      mimeType: mime,
      kind,
      label: asset.name ?? (kind === 'image' ? 'Image' : 'Video'),
    });
  }, []);

  const onSave = useCallback(async () => {
    setLocalError(null);
    try {
      const created = await authorMut.mutateAsync({
        name,
        instructions,
        mediaKind: media ? media.kind : 'none',
        ...(media
          ? { media: { uri: media.uri, bytes: media.bytes, mimeType: media.mimeType } }
          : {}),
      });
      track(AnalyticsEvents.CUSTOM_EXERCISE_CREATED, {
        media_kind: created.media_kind,
      });
      onCreated(created);
    } catch (err) {
      track(AnalyticsEvents.CUSTOM_EXERCISE_CREATE_FAILED, {
        reason: errorMessage(err),
      });
      setLocalError(romanGenericError({ mode: 'default' }));
    }
  }, [authorMut, name, instructions, media, onCreated]);

  return (
    <View
      accessibilityLabel="Author a custom move"
      style={[styles.card, { borderColor: sc.border, backgroundColor: sc.bgSurface }]}
    >
      <Text style={[typography.h4, { color: sc.textPrimary }]}>
        {romanCustomExerciseComposer.title}
      </Text>
      <Text style={[typography.caption, styles.prompt, { color: sc.textMuted }]}>
        {romanCustomExerciseComposer.prompt}
      </Text>

      <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
        Move name
      </Text>
      <TextInput
        accessibilityLabel="Custom move name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Standing forward fold"
        placeholderTextColor={sc.textMuted}
        style={[styles.input, { borderColor: sc.border, color: sc.textPrimary }]}
        maxLength={MAX_CUSTOM_EXERCISE_NAME}
      />

      <Text style={[typography.caption, styles.label, { color: sc.textMuted }]}>
        How it is performed
      </Text>
      <TextInput
        accessibilityLabel="Custom move instructions"
        value={instructions}
        onChangeText={setInstructions}
        placeholder="Describe the setup, the movement, and the breathing."
        placeholderTextColor={sc.textMuted}
        style={[styles.input, styles.multiline, { borderColor: sc.border, color: sc.textPrimary }]}
        multiline
        maxLength={MAX_CUSTOM_EXERCISE_INSTRUCTIONS}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Attach an image or video"
        onPress={() => {
          void onPickMedia();
        }}
        style={[styles.attachBtn, { borderColor: sc.border }]}
      >
        <Text style={[typography.body, { color: sc.accentText }]}>
          {media ? `Attached: ${media.label}` : 'Attach image or video (optional)'}
        </Text>
      </Pressable>

      {localError ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[typography.caption, styles.error, { color: sc.accentText }]}
        >
          {localError}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel custom move"
          onPress={onCancel}
          disabled={saving}
          style={[styles.secondaryBtn, { borderColor: sc.border }]}
        >
          <Text style={[typography.body, { color: sc.textMuted }]}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save custom move to library"
          onPress={() => {
            void onSave();
          }}
          disabled={!canSave}
          style={[
            styles.primaryBtn,
            { backgroundColor: canSave ? sc.accent : sc.disabledBg },
          ]}
        >
          <Text
            style={[
              typography.body,
              { color: canSave ? sc.textOnAccent : sc.textOnDisabled },
            ]}
          >
            {saving ? 'Saving...' : 'Save move'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      padding: spacing.md,
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    prompt: { marginBottom: spacing.sm },
    label: { marginTop: spacing.sm },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      ...typography.body,
    },
    multiline: { minHeight: 88, textAlignVertical: 'top' },
    attachBtn: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      marginTop: spacing.sm,
      alignItems: 'center',
    },
    error: { marginTop: spacing.xs },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    secondaryBtn: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 8,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    primaryBtn: {
      borderRadius: 8,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
  });
}
