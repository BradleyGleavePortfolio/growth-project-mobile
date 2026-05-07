/**
 * AIGatewayDisabledState — fail-closed UX for AI Gateway capabilities.
 *
 * Renders the right empty/error state for an `AIGatewayDraftDisabled` or
 * `AIGatewayDraftError` response. Companion to PR #100's `AINote` and
 * `SignoffStatusChip`: when those render an *approved* AI surface, this
 * renders the alternative when the gateway refuses or fails.
 *
 * Doctrine: never substitute a fabricated answer for a disabled response.
 * The component refuses to render a "result-shaped" treatment — it always
 * renders a clearly-non-content state with a recovery hint.
 *
 * Security: no provider keys, no PII, no raw AI output rendered here.
 * Token usage is tracked server-side; this component only displays
 * server-returned status codes and operator-owned copy.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Spacing, Radius, Typography } from '../../theme/index';
import type {
  AIGatewayDraftDisabled,
  AIGatewayDraftError,
} from '../../types/aiGateway';

export type AIGatewayFailClosedResponse =
  | AIGatewayDraftDisabled
  | AIGatewayDraftError;

interface Props {
  // The disabled/error response to render. Pass the raw response from
  // aiGatewayClient — the component matches on `status` + `reason`.
  response: AIGatewayFailClosedResponse;
  // Optional retry handler. Shown only for `error` responses; disabled
  // responses are never retryable from the UI (operator action required).
  onRetry?: () => void;
}

interface CopyVariant {
  title: string;
  body: string;
}

// Operator-friendly copy. No "AI is thinking" or "the assistant is working" —
// the doctrine forbids implying autonomy. Each line states what is missing
// and what the user can do.
export function copyForDisabled(r: AIGatewayDraftDisabled): CopyVariant {
  if (r.summary) {
    return { title: 'AI assist is off', body: r.summary };
  }
  switch (r.reason) {
    case 'kill_switch':
      return {
        title: 'AI assist is off',
        body: 'The team has paused AI drafting across the app. Coaches and admins are unaffected — they can still write drafts manually.',
      };
    case 'no_provider_key':
      return {
        title: 'AI assist is not configured',
        body: 'This build is not connected to a model provider. Drafts will return once configuration ships.',
      };
    case 'rate_limited':
      return {
        title: 'Slow down a moment',
        body: 'Too many draft requests in a short window. Try again in a minute.',
      };
    case 'role_denied':
      return {
        title: 'AI drafting is coach-only',
        body: 'Your role does not have access to this draft. Ask your coach or admin if you think this is wrong.',
      };
    case 'consent_missing':
      return {
        title: 'Consent required',
        body: "AI drafting needs your client's explicit consent. Open the privacy settings to grant or revoke it.",
      };
    case 'feature_flag_off':
      return {
        title: 'Not yet available',
        body: 'AI drafting is rolling out gradually. It will appear here once your account is opted in.',
      };
    default:
      return {
        title: 'Not available',
        body: 'AI drafting is unavailable right now.',
      };
  }
}

export function copyForError(r: AIGatewayDraftError): CopyVariant {
  switch (r.reason) {
    case 'provider_unavailable':
      return {
        title: "Couldn't reach the AI service",
        body: "The model provider didn't respond. Try again in a moment.",
      };
    case 'timeout':
      return {
        title: 'AI draft timed out',
        body: 'The request took too long. Try again, or write the draft manually.',
      };
    case 'content_blocked':
      return {
        title: "Couldn't draft this one",
        body: 'The model declined this request. Edit the input or write the draft manually.',
      };
    case 'invalid_input':
      return {
        title: "Couldn't draft this one",
        body: 'Some of the inputs were missing or malformed. Check the form and try again.',
      };
    default:
      return {
        title: 'Something went wrong',
        body: 'AI drafting failed. Try again, or write the draft manually.',
      };
  }
}

export default function AIGatewayDisabledState({ response, onRetry }: Props) {
  const { colors } = useTheme();
  const copy =
    response.status === 'disabled'
      ? copyForDisabled(response)
      : copyForError(response);
  const showRetry = response.status === 'error' && !!onRetry;
  const correlationId =
    response.status === 'error' ? response.correlationId : null;

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
      ]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${copy.title}. ${copy.body}`}
      testID={`ai-gateway-${response.status}-${response.reason}`}
    >
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        {copy.title}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {copy.body}
      </Text>
      {!!correlationId && (
        <Text
          style={[styles.correlation, { color: colors.textMuted }]}
          testID="ai-gateway-correlation-id"
        >
          ref: {correlationId}
        </Text>
      )}
      {showRetry && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onRetry}
          testID="ai-gateway-retry"
        >
          <Text style={[styles.retry, { color: colors.primary }]}>
            Try again
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.md,
  },
  title: {
    ...Typography.h3,
    marginBottom: Spacing.xs,
  },
  body: {
    ...Typography.body,
  },
  correlation: {
    ...Typography.caption,
    marginTop: Spacing.sm,
  },
  retry: {
    ...Typography.button,
    marginTop: Spacing.md,
  },
});
