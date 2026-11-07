/**
 * LS-913R3 B2: C3 Style B keeps its small centred grip above the
 * Roman portrait/title row. Approved first-ask words do not remove it.
 * GOAL: planning/MOCKUP3/C3/style-b/B_consent_ios390_100.png.
 * This checks the visible element, not an unrequested swipe gesture.
 */
import React from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import AiConsentSheet, { type AiConsentSheetApi } from '../AiConsentSheet';
import type { AiConsentStatusResponse } from '../../../api/aiConsentApi';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
} from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const status: AiConsentStatusResponse = {
  granted: false,
  state: 'not_granted',
  version: null,
  granted_at: null,
  withdrawn_at: null,
  current_version: AI_CONSENT_VERSION,
  needs_reconsent: false,
  copy: {
    version: AI_CONSENT_VERSION,
    paragraph: { text: AI_CONSENT_PARAGRAPH, sha256: 'a'.repeat(64) },
    box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: 'b'.repeat(64) },
    sha256: AI_CONSENT_COPY_SHA256,
  },
};

it.each(['beforeAnswer', 'default'] as const)(
  'LS-913R3 B2: %s includes the C3 sheet grip',
  async (variant) => {
    const api: AiConsentSheetApi = {
      getStatus: jest.fn(async () => ({ kind: 'ok' as const, status })),
      grantRoman: jest.fn(async () => ({ kind: 'ok' as const, status })),
    };
    const r = await render(
      <AiConsentSheet visible variant={variant} api={api} sessionUserId={() => 'u1'}
        onGranted={jest.fn()} onClose={jest.fn()} testID="grip-sheet" />,
    );
    await waitFor(() => r.getByTestId('grip-sheet-paragraph'));
    // Allow ordinary platform rounding without coupling the proof to a test id
    // or requiring one exact width. A portrait, button or hairline cannot pass.
    const grips: unknown[] = [];
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== 'object') return;
      const n = node as { props?: { style?: unknown }; children?: unknown };
      const s = StyleSheet.flatten(n.props?.style as ViewStyle) ?? {};
      if (typeof s.width === 'number' && s.width >= 24 && s.width <= 64
        && typeof s.height === 'number' && s.height >= 2 && s.height <= 6
        && s.alignSelf === 'center' && !!s.backgroundColor) grips.push(node);
      visit(n.children);
    };
    visit(r.toJSON());
    expect(grips.length).toBeGreaterThan(0);
  },
);
