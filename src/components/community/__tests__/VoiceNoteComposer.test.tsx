/**
 * VoiceNoteComposer — orchestration tests for the v3-3 record→review→send glue.
 * The recorder port is injected (deterministic capture) and the upload hook is
 * mocked (no network). Pins the honest states the audit cares about:
 *   • unavailable build → calm notice, NO record button;
 *   • mic denied → a REAL recovery action (try again / open settings);
 *   • idle → privacy disclosure (real audience) + record button present;
 *   • recorded → preview + Send runs the upload pipeline with the recording;
 *   • a publish failure preserves the recording and offers a retry.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Linking } from 'react-native';

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

// Mock the upload hook so the composer's send path is observable without a net.
const mockMutate = jest.fn();
let mockUploadState = { mutate: mockMutate, isPending: false, isError: false };
jest.mock('../../../hooks/useVoiceUpload', () => ({
  useVoiceUpload: () => mockUploadState,
}));

import VoiceNoteComposer from '../VoiceNoteComposer';
import type {
  VoiceRecorderPort,
  VoiceRecordingResult,
  MicPermissionStatus,
} from '../../../hooks/voiceRecorderPort';

const WS = '11111111-1111-4111-8111-111111111111';
const RESULT: VoiceRecordingResult = {
  uri: 'file:///tmp/rec.m4a',
  durationMs: 4200,
  bytes: 50_000,
  mimeType: 'audio/mp4',
  peaks: [0.2, 0.6, 0.9],
};

function makePort(o: Partial<VoiceRecorderPort> = {}): VoiceRecorderPort {
  return {
    isAvailable: true,
    getPermissionStatus: jest
      .fn<Promise<MicPermissionStatus>, []>()
      .mockResolvedValue('granted'),
    requestPermission: jest
      .fn<Promise<MicPermissionStatus>, []>()
      .mockResolvedValue('granted'),
    start: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    stop: jest
      .fn<Promise<VoiceRecordingResult>, []>()
      .mockResolvedValue(RESULT),
    cancel: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    ...o,
  };
}

const target = { kind: 'cohort' as const, cohortName: 'Spring Block' };

beforeEach(() => {
  mockMutate.mockReset();
  mockUploadState = { mutate: mockMutate, isPending: false, isError: false };
});

describe('VoiceNoteComposer — honest states', () => {
  it('renders a calm notice and NO record button on an unavailable build', async () => {
    const port = makePort({ isAvailable: false });
    const { getByTestId, queryByTestId } = await render(
      <VoiceNoteComposer workspaceId={WS} target={target} recorder={port} />,
    );
    expect(getByTestId('voice-composer-unavailable')).toBeTruthy();
    expect(queryByTestId('voice-record-button')).toBeNull();
  });

  it('shows the privacy disclosure + record button when idle', async () => {
    const port = makePort();
    const { getByTestId } = await render(
      <VoiceNoteComposer workspaceId={WS} target={target} recorder={port} />,
    );
    expect(getByTestId('voice-privacy-copy').props.accessibilityLabel).toBe(
      'Everyone in Spring Block can hear this voice note.',
    );
    expect(getByTestId('voice-record-button')).toBeTruthy();
  });
});

describe('VoiceNoteComposer — mic denial recovery', () => {
  it('routes to Settings when the OS will no longer prompt', async () => {
    const openSettings = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined as unknown as void);
    const port = makePort({
      getPermissionStatus: jest.fn().mockResolvedValue('undetermined'),
      requestPermission: jest.fn().mockResolvedValue('denied'),
    });
    const { getByTestId } = await render(
      <VoiceNoteComposer workspaceId={WS} target={target} recorder={port} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('voice-record-button'));
    });
    await waitFor(() => expect(getByTestId('voice-composer-denied')).toBeTruthy());

    fireEvent.press(getByTestId('voice-composer-permission-action'));
    await waitFor(() => expect(openSettings).toHaveBeenCalled());
    openSettings.mockRestore();
  });
});

describe('VoiceNoteComposer — review + send', () => {
  async function recordTo(getByTestId: (id: string) => unknown) {
    await act(async () => {
      fireEvent.press(getByTestId('voice-record-button') as never);
    });
    await act(async () => {
      fireEvent.press(getByTestId('voice-record-button') as never);
    });
  }

  it('sends the recording through the upload pipeline', async () => {
    const port = makePort();
    const { getByTestId } = await render(
      <VoiceNoteComposer
        workspaceId={WS}
        target={target}
        cohortId="co-1"
        recorder={port}
      />,
    );
    await recordTo(getByTestId);
    await waitFor(() => expect(getByTestId('voice-composer-review')).toBeTruthy());

    fireEvent.press(getByTestId('voice-composer-send'));
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [input] = mockMutate.mock.calls[0];
    expect(input).toMatchObject({
      uri: 'file:///tmp/rec.m4a',
      durationMs: 4200,
      bytes: 50_000,
      mimeType: 'audio/mp4',
      cohortId: 'co-1',
    });
  });

  it('surfaces a calm retry while preserving the recording on a publish failure', async () => {
    mockUploadState = { mutate: mockMutate, isPending: false, isError: true };
    const port = makePort();
    const { getByTestId } = await render(
      <VoiceNoteComposer workspaceId={WS} target={target} recorder={port} />,
    );
    await recordTo(getByTestId);
    await waitFor(() => expect(getByTestId('voice-composer-review')).toBeTruthy());
    // The recording is still present (preview duration shown) and a retry-labelled
    // Send is offered — the user never loses the clip.
    expect(getByTestId('voice-composer-send-error')).toBeTruthy();
    expect(getByTestId('voice-composer-preview-duration').props.children).toBe(
      '0:04',
    );
    expect(getByTestId('voice-composer-send').props.accessibilityLabel).toBe(
      'Try sending the voice note again',
    );
  });
});
