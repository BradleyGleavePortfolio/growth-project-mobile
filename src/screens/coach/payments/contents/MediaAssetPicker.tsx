/**
 * MediaAssetPicker — PDF / video step of ContentAttachForm (B-DROPS-125).
 * Lists the coach's own files of that kind, uploads a new one from the device
 * and selects it. Only `ready` files are selectable (the backend refuses to
 * deliver a file still processing); a new video shows as "Processing" until
 * Mux finishes.
 */
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useQuery } from '@tanstack/react-query';

import {
  coachMediaApi,
  CoachMediaKind,
  describeMediaUploadFailure,
  mediaTitleFromFile,
} from '../../../../api/coachMediaApi';
import { useTheme } from '../../../../theme/ThemeProvider';
import { describeProgramFailure } from '../../../../utils/programErrors';
import { Chip, FailureBox, LoadingRow } from '../../programs/ProgramUi';

export default function MediaAssetPicker({
  kind,
  selectedId,
  title,
  onSelect,
}: {
  kind: CoachMediaKind;
  selectedId: string;
  title: string; // the form's title, used as the file title when filled in
  onSelect: (id: string, name: string) => void;
}) {
  const { colors } = useTheme();
  const noun = kind === 'pdf' ? 'PDF' : 'video';
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const media = useQuery({
    queryKey: ['coach', 'media', kind],
    queryFn: async () => (await coachMediaApi.list(kind)).data.media ?? [],
  });

  const onUpload = useCallback(async () => {
    setMsg(null);
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type: kind === 'pdf' ? 'application/pdf' : 'video/*',
        copyToCacheDirectory: true,
      });
    } catch {
      setMsg({ text: `That ${noun} could not be read. Pick another file.`, error: true });
      return;
    }
    const file = picked.canceled ? undefined : picked.assets?.[0];
    if (!file) return;
    const name = mediaTitleFromFile(title.trim() || file.name, noun);
    setUploading(true);
    try {
      const id = await coachMediaApi.upload(kind, file, name);
      await media.refetch();
      if (kind === 'pdf') onSelect(id, name);
      setMsg({ text: kind === 'pdf' ? 'Uploaded and selected.' : VIDEO_PENDING, error: false });
    } catch (err) {
      setMsg({ text: describeMediaUploadFailure(err), error: true });
    } finally {
      setUploading(false);
    }
  }, [kind, noun, title, media, onSelect]);

  const rows = media.data ?? [];
  const ready = rows.filter((r) => r.status === 'ready');
  const pending = rows.filter((r) => r.status === 'uploading' || r.status === 'processing');

  const hint = (text: string, color = colors.textSecondary) => (
    <Text style={[styles.hint, { color }]}>{text}</Text>
  );
  return (
    <View testID={`media-picker-${kind}`}>
      {media.isLoading ? (
        <LoadingRow label={`Loading your ${noun} files`} />
      ) : media.error ? (
        <FailureBox
          failure={describeProgramFailure(media.error, `load your ${noun} files`)}
          onRetry={() => media.refetch()}
        />
      ) : ready.length === 0 ? (
        hint(`No ${noun} files ready yet. Upload one below.`)
      ) : (
        <View style={styles.row} accessibilityLabel={`Choose a ${noun}`}>
          {ready.map((r) => (
            <Chip
              key={r.id}
              label={r.title}
              selected={selectedId === r.id}
              onPress={() => onSelect(r.id, r.title)}
              accessibilityLabel={`${r.title}, ${noun}`}
            />
          ))}
        </View>
      )}
      {pending.length > 0 ? hint(`Processing: ${pending.map((p) => p.title).join(', ')}`) : null}
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.uploadBtn, { borderColor: colors.primary }]}
          onPress={onUpload}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={`Upload a ${noun}`}
          accessibilityState={{ disabled: uploading, busy: uploading }}
          testID={`media-upload-${kind}`}
        >
          {uploading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.btnText, { color: colors.primary }]}>{`Upload a ${noun}`}</Text>
          )}
        </TouchableOpacity>
        {kind === 'video' ? (
          <TouchableOpacity onPress={() => media.refetch()} accessibilityRole="button" style={styles.uploadBtn}>
            <Text style={[styles.btnText, { color: colors.textSecondary }]}>Refresh</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {kind === 'video' && Platform.OS === 'ios' ? hint(IOS_VIDEO_HINT) : null}
      {uploading ? hint(`Uploading the ${noun}. Keep the app open until it finishes.`) : null}
      {msg && !uploading ? hint(msg.text, msg.error ? colors.error : colors.textSecondary) : null}
    </View>
  );
}

const IOS_VIDEO_HINT = 'A video in Photos: tap Share, then Save to Files, then upload it here.';
const VIDEO_PENDING = 'Uploaded. The video can be attached once processing ends. Tap Refresh in a minute.';

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
  hint: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  uploadBtn: { borderWidth: 1, borderColor: 'transparent', borderRadius: 2, padding: 10, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '500' },
});
