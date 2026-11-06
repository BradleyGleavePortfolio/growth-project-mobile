/**
 * LS-E4R2 B2: C3 Style B's consent sheet has a Roman portrait and cream
 * disclosure card on the sheet, not an uncarded paragraph with no portrait.
 * GOAL: planning/MOCKUP3/C3/style-b/B_consent_ios390_100.png.
 * Approved first-ask words replace text, not those elements.
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
import { colors, radius } from '../../../theme/tokens';
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

describe.each(['beforeAnswer', 'default'] as const)('LS-E4R2 B2: C3 consent (%s)', (variant) => {
  async function draw() {
    const api: AiConsentSheetApi = {
      getStatus: jest.fn(async () => ({ kind: 'ok' as const, status })),
      grantRoman: jest.fn(async () => ({ kind: 'ok' as const, status })),
    };
    const r = await render(
      <AiConsentSheet visible variant={variant} api={api} sessionUserId={() => 'u1'}
        onGranted={jest.fn()} onClose={jest.fn()} testID="goal-ai" />,
    );
    await waitFor(() => r.getByTestId('goal-ai-paragraph'));
    return r;
  }

  it('keeps the Roman portrait in the consent header', async () => {
    const r = await draw();
    expect(r.queryAllByLabelText(/^Roman\b/)).toHaveLength(1);
  });

  it('keeps the server disclosure inside a cream radius-16 card', async () => {
    const r = await draw();
    const styles: Record<string, unknown>[] = [];
    for (let n = r.getByTestId('goal-ai-paragraph').parent; n; n = n.parent) {
      styles.push(StyleSheet.flatten(n.props.style) ?? {});
    }
    expect(styles).toEqual(expect.arrayContaining([
      expect.objectContaining({ backgroundColor: colors.cream, borderRadius: radius.card }),
    ]));
  });
});
