/**
 * ROMAN-ROOM-133 (operator 17:16, owner radius ruling 17:07): the AI consent
 * sheet's presentation only. Rounded sheet top corners from radius.sheet, the
 * shared forest PrimaryButton, quiet TextLink secondaries, a serif title, and
 * a bottom padding that clears the gesture bar from real insets. Copy and
 * consent logic are covered by the Ledger, Memory and SessionFence suites.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import AiConsentSheet, { AI_CONSENT_SHEET_COPY, type AiConsentSheetApi } from '../AiConsentSheet';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { AI_CONSENT_CHECKBOX_LABEL, AI_CONSENT_COPY_SHA256, AI_CONSENT_PARAGRAPH } from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';
import { lightTokens, radius, typography } from '../../../theme/tokens';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const status: AiConsentStatusResponse = {
  granted: false, state: 'withdrawn', version: AI_CONSENT_VERSION, granted_at: null,
  withdrawn_at: '2026-10-07T09:00:00Z', current_version: AI_CONSENT_VERSION, needs_reconsent: false,
  copy: {
    version: AI_CONSENT_VERSION,
    paragraph: { text: AI_CONSENT_PARAGRAPH, sha256: 'b'.repeat(64) },
    box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: 'a'.repeat(64) },
    sha256: AI_CONSENT_COPY_SHA256,
  },
};
const api: AiConsentSheetApi = {
  getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status })),
  grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status })),
};

it('rounded sheet, one forest button, quiet secondary, serif title, inset-aware bottom', async () => {
  const r = await render(
    <SafeAreaInsetsContext.Provider value={{ top: 47, bottom: 34, left: 0, right: 0 }}>
      <AiConsentSheet visible onGranted={jest.fn()} onClose={jest.fn()} api={api} sessionUserId={() => 'me'} testID="s" />
    </SafeAreaInsetsContext.Provider>,
  );
  await waitFor(() => expect(r.getByTestId('s-allow')).toBeTruthy());
  const sheet = StyleSheet.flatten(r.getByTestId('s').props.style);
  expect(sheet).toMatchObject({ borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingBottom: 42 });
  const allow = StyleSheet.flatten(r.getByTestId('s-allow').props.style);
  expect(allow).toMatchObject({ borderRadius: radius.button, backgroundColor: lightTokens.accent });
  expect(StyleSheet.flatten(r.getByTestId('s-not-now').props.style).backgroundColor).toBeUndefined();
  const title = r.getByRole('header', { name: AI_CONSENT_SHEET_COPY.title });
  expect(StyleSheet.flatten(title.props.style).fontFamily).toBe(typography.h2.fontFamily);
});
