/**
 * R11-C2B (owner 2026-10-07 10:18, Roman memory on by default): the AI help sheet is the same Roman
 * consent as box 2 and Settings. While the server says memory is on and sends the pinned client-ai-v5
 * copy (`memory_copy`), the sheet shows that text and Allow grants v5 with its sha256; otherwise the
 * server's current copy exactly, as before.
 */
import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AiConsentSheet, { type AiConsentSheetApi } from '../AiConsentSheet';
import type { AiConsentOutcome, AiConsentStatusResponse } from '../../../api/aiConsentApi';
import { resetAiLedgerWritesForTests } from '../../../lib/consultation/aiConsent';
import {
  AI_CONSENT_CHECKBOX_LABEL,
  AI_CONSENT_COPY_SHA256,
  AI_CONSENT_MEMORY_COPY_SHA256,
  AI_CONSENT_PARAGRAPH,
} from '../../../lib/consultation/copy';
import { AI_CONSENT_VERSION } from '../../../lib/consultation/consentVersion';

jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const V5_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Roman may keep notes and summaries about your training, preferences and circumstances to personalise his replies. Deleting a chat removes its messages but not these notes; deleting your account removes them. Roman may also learn your coach's methods, including from your coach's private session notes, and information about your training may help with that without identifying you. Roman never quotes those notes or shows you another client's information. Your coach never sees your conversations with Roman or his notes about you. Your conversations with Roman are kept until you delete them or delete your account.";
const V5_COPY = {
  version: 'client-ai-v5',
  paragraph: { text: V5_PARAGRAPH, sha256: '768ae3451fd1fbd22c65fd7758b51604a9ee0696c6ae7fab694c8238a6584782' },
  box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: 'a'.repeat(64) },
  sha256: AI_CONSENT_MEMORY_COPY_SHA256,
};
const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';

function status(overrides: Partial<AiConsentStatusResponse> = {}): AiConsentStatusResponse {
  return {
    granted: false,
    state: 'withdrawn',
    version: AI_CONSENT_VERSION,
    granted_at: null,
    withdrawn_at: '2026-10-07T09:00:00Z',
    current_version: AI_CONSENT_VERSION,
    needs_reconsent: false,
    copy: {
      version: AI_CONSENT_VERSION,
      paragraph: { text: AI_CONSENT_PARAGRAPH, sha256: 'b'.repeat(64) },
      box_label: { text: AI_CONSENT_CHECKBOX_LABEL, sha256: 'a'.repeat(64) },
      sha256: AI_CONSENT_COPY_SHA256,
    },
    ...overrides,
  };
}
const LIVE_V5 = status({
  granted: true,
  state: 'granted',
  version: 'client-ai-v5',
  current_version: 'client-ai-v5',
  copy: V5_COPY,
  memory_on: true,
});

function makeApi(first: AiConsentStatusResponse, grant: AiConsentOutcome) {
  const api = {
    getStatus: jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'ok', status: first })),
    grantRoman: jest.fn(async (): Promise<AiConsentOutcome> => grant),
  };
  return api as typeof api & AiConsentSheetApi;
}

async function openSheet(api: AiConsentSheetApi, onGranted = jest.fn()) {
  const r = await render(
    <AiConsentSheet visible onGranted={onGranted} onClose={jest.fn()} api={api} sessionUserId={() => 'me'} testID="s" />,
  );
  await waitFor(() => expect(r.getByTestId('s-allow')).toBeTruthy());
  return { r, onGranted };
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAiLedgerWritesForTests();
  await AsyncStorage.clear();
});

describe('AiConsentSheet grants Roman memory while the server offers it (R11-C2B)', () => {
  it('memory on + pinned memory_copy: the v5 text, and Allow grants client-ai-v5 with the server sha256', async () => {
    const api = makeApi(status({ memory_on: true, memory_copy: V5_COPY }), { kind: 'ok', status: LIVE_V5 });
    const { r, onGranted } = await openSheet(api);
    expect(r.getByTestId('s-paragraph').props.children).toBe(V5_PARAGRAPH);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith({ version: 'client-ai-v5', copy_sha256: AI_CONSENT_MEMORY_COPY_SHA256, platform });
  });

  it.each([
    ['the current production server (no memory_copy)', status()],
    ['memory off', status({ memory_on: false, memory_copy: V5_COPY })],
    ['a v5 copy with another sha256', status({ memory_on: true, memory_copy: { ...V5_COPY, sha256: 'c'.repeat(64) } })],
  ])('%s: the server copy and client-ai-v4 exactly, as before', async (_l, first) => {
    const live = status({ granted: true, state: 'granted', withdrawn_at: null });
    const api = makeApi(first, { kind: 'ok', status: live });
    const { r, onGranted } = await openSheet(api);
    expect(r.getByTestId('s-paragraph').props.children).toBe(AI_CONSENT_PARAGRAPH);
    await fireEvent.press(r.getByTestId('s-allow'));
    await waitFor(() => expect(onGranted).toHaveBeenCalledTimes(1));
    expect(api.grantRoman).toHaveBeenCalledWith({ version: AI_CONSENT_VERSION, copy_sha256: AI_CONSENT_COPY_SHA256, platform });
  });
});
