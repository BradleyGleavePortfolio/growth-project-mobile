/**
 * CommunityComposerScreen — compose a Hall/Cohort post (title + body) or a DM.
 * Mode comes from the route param:
 *   - { mode: 'post' }                    → create a post (title 1..200, body 1..20000)
 *   - { mode: 'dm', recipientId }         → open/seed a DM and send the first line
 *
 * Posts use useCreatePost (optimistic insert + rollback); DMs use useSendDm.
 * On a successful post we surface the Roman `postPublished` line, then pop back
 * to the feed. Length caps mirror the backend DTOs and are enforced before the
 * round-trip. Standardized on semanticColors / tokens.ts.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, radius } from '../../theme/tokens';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  useCreatePost,
  useSendDm,
  useCommunityMe,
} from '../../hooks/useCommunity';
import { ThreadHeader } from '../../components/community';
import { romanCopy } from '../../components/community/romanVoice';
import type { CommunityNav, CommunityRoute } from './communityNavTypes';

const TITLE_MAX = 200; // mirror backend CreatePostDto.title (1..200)
const POST_BODY_MAX = 20000; // mirror backend CreatePostDto.body (1..20000)
const DM_MAX = 4000; // mirror backend SendDmDto.body (1..4000)

export default function CommunityComposerScreen(): React.ReactElement {
  const { semanticColors } = useTheme();
  const navigation = useNavigation<CommunityNav>();
  const route = useRoute<CommunityRoute<'CommunityComposer'>>();
  const params = route.params;
  const mode = params?.mode ?? 'post';
  const recipientId = params && 'recipientId' in params ? params.recipientId : '';
  const client = useCurrentUser();
  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? '';
  const firstName = client?.firstName ?? client?.name ?? null;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const createPost = useCreatePost(workspaceId, client?.id ?? '');
  const sendDm = useSendDm(workspaceId, recipientId, client?.id ?? '');

  const bodyMax = mode === 'dm' ? DM_MAX : POST_BODY_MAX;
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const sending = createPost.isPending || sendDm.isPending;
  const canSubmit =
    !sending &&
    trimmedBody.length > 0 &&
    (mode === 'dm' ? true : trimmedTitle.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    if (mode === 'dm') {
      sendDm.mutate(trimmedBody, {
        onSuccess: () => navigation.goBack(),
      });
      return;
    }
    createPost.mutate(
      { title: trimmedTitle, body: trimmedBody },
      {
        onSuccess: () => {
          setConfirmation(romanCopy('postPublished', { firstName }));
          // Brief Roman confirmation, then return to the feed.
          setTimeout(() => navigation.goBack(), 900);
        },
      },
    );
  };

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: semanticColors.bgPrimary }]}
      edges={['top']}
      testID="community-composer-screen"
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ThreadHeader
          title={mode === 'dm' ? 'New message' : 'New post'}
          testID="community-composer-header"
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {mode === 'post' ? (
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor={semanticColors.textMuted}
              maxLength={TITLE_MAX}
              accessibilityLabel="Post title"
              testID="community-composer-title"
              style={[
                styles.title,
                {
                  color: semanticColors.textPrimary,
                  borderColor: semanticColors.border,
                },
              ]}
            />
          ) : null}

          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={mode === 'dm' ? 'Write your message' : 'Share something'}
            placeholderTextColor={semanticColors.textMuted}
            maxLength={bodyMax}
            multiline
            accessibilityLabel={mode === 'dm' ? 'Message body' : 'Post body'}
            testID="community-composer-body"
            style={[
              styles.body,
              {
                color: semanticColors.textPrimary,
                borderColor: semanticColors.border,
              },
            ]}
          />

          {confirmation ? (
            <Text
              style={[styles.confirmation, { color: semanticColors.textMuted }]}
              testID="community-composer-confirmation"
            >
              {confirmation}
            </Text>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            {
              backgroundColor: semanticColors.bgSurface,
              borderTopColor: semanticColors.border,
            },
          ]}
        >
          <HapticPressable
            intent="success"
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel={mode === 'dm' ? 'Send message' : 'Publish post'}
            accessibilityState={{ disabled: !canSubmit }}
            testID="community-composer-submit"
            style={[
              styles.submit,
              {
                backgroundColor: canSubmit
                  ? semanticColors.accent
                  : semanticColors.disabledBg,
              },
            ]}
          >
            <Text
              style={[
                styles.submitLabel,
                {
                  color: canSubmit
                    ? semanticColors.textOnAccent
                    : semanticColors.textOnDisabled,
                },
              ]}
            >
              {mode === 'dm' ? 'Send' : 'Publish'}
            </Text>
          </HapticPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: {
    minHeight: 160,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  confirmation: {
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submit: {
    minHeight: 48,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
