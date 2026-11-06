/**
 * FR-913R2 class-first (LS-E4R2 B2): on both client sheet variants (Roman's
 * first ask, and Insight / Guide's default) the sheet is white under the cream
 * card, and Not now is a centred underlined link with no frame or fill.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import AiConsentSheet, { type AiConsentSheetApi } from '../AiConsentSheet';
import {
  AI_CONSENT_PARAGRAPH,
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
} from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';
import { lightTokens } from '../../../theme/tokens';
import type { AiConsentStatusResponse } from '../../../api/aiConsentApi';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const status: AiConsentStatusResponse = {
  purpose: 'client_ai_processing',
  processor: 'anthropic',
  granted: false,
  state: 'not_granted',
  version: null,
  granted_at: null,
  withdrawn_at: null,
  current_version: AI_CONSENT_VERSION,
  needs_reconsent: false,
  copy: {
    version: AI_CONSENT_VERSION,
    paragraph: {
      text: AI_CONSENT_PARAGRAPH,
      sha256: '56d14fb96b9f7b6abdd43242f5ce9eaee419bc0d9fb4302bc283ecc1529d430b',
    },
    box_label: {
      text: AI_CONSENT_CHECKBOX_LABEL,
      sha256: '77da153df7f06a045e1abbbb83b771f8a33941d47268e276becc6b4ffe5e5eba',
    },
    sha256: AI_CONSENT_COPY_SHA256,
  },
};

it.each(['beforeAnswer', 'default'] as const)('%s: white sheet, Not now a plain centred link', async (variant) => {
  const api: AiConsentSheetApi = {
    getStatus: jest.fn(async () => ({ kind: 'ok' as const, status })),
    grantRoman: jest.fn(async () => ({ kind: 'ok' as const, status })),
  };
  const r = await render(
    <AiConsentSheet visible variant={variant} api={api} sessionUserId={() => 'u1'}
      onGranted={jest.fn()} onClose={jest.fn()} testID="s" />,
  );
  await waitFor(() => r.getByTestId('s-paragraph'));
  expect(StyleSheet.flatten(r.getByTestId('s').props.style).backgroundColor).toBe(lightTokens.bgSurface);
  const notNow = StyleSheet.flatten(r.getByTestId('s-not-now').props.style);
  expect(notNow.borderWidth ?? 0).toBe(0);
  expect(notNow.backgroundColor).toBeUndefined();
  expect(notNow.alignSelf).toBe('center');
});
