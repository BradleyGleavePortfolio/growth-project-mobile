/**
 * VoiceNoteComposer — the Style B record sheet body. The recorder port is
 * injected (deterministic capture). Pins the honest states the audit cares about:
 *   • unavailable build → calm notice, NO record button;
 *   • mic denied → a REAL recovery action (try again / open settings);
 *   • idle → privacy disclosure (real audience) + record button present;
 *   • recorded → listen back + Send hands the recording to the outbox.
 */
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { Linking } from 'react-native';

type GetByTestId = Awaited<ReturnType<typeof render>>['getByTestId'];

jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});

import VoiceNoteComposer from '../VoiceNoteComposer';
import type {
  VoiceRecorderPort,
  VoiceRecordingResult,
  MicPermissionStatus,
} from '../../../hooks/voiceRecorderPort';

const mockSend = jest.fn();
const mockClose = jest.fn();
const props = { onSend: mockSend, onClose: mockClose };
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
  mockSend.mockReset();
  mockClose.mockReset();
});

describe('VoiceNoteComposer — honest states', () => {
  it('renders a calm notice and NO record button on an unavailable build', async () => {
    const port = makePort({ isAvailable: false });
    const { getByTestId, queryByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    expect(getByTestId('voice-composer-unavailable')).toBeTruthy();
    expect(queryByTestId('voice-record-button')).toBeNull();
  });

  it('shows the privacy disclosure + record button when idle', async () => {
    const port = makePort();
    const { getByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
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
      .mockImplementation(async () => {});
    const port = makePort({
      getPermissionStatus: jest.fn().mockResolvedValue('undetermined'),
      requestPermission: jest.fn().mockResolvedValue('denied'),
    });
    const { getByTestId } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
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
  async function recordTo(getByTestId: GetByTestId) {
    await act(async () => {
      fireEvent.press(getByTestId('voice-record-button'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('voice-record-button'));
    });
  }

  it('Send hands the recording to the outbox', async () => {
    const port = makePort();
    const { getByTestId } = await render(<VoiceNoteComposer {...props} target={target} recorder={port} />);
    await recordTo(getByTestId);
    await waitFor(() => expect(getByTestId('voice-composer-review')).toBeTruthy());
    expect(getByTestId('voice-composer-preview-duration', { includeHiddenElements: true }).props.children).toBe('0:04');
    expect(getByTestId('voice-composer-listen')).toBeTruthy();
    fireEvent.press(getByTestId('voice-composer-send'));
    expect(mockSend).toHaveBeenCalledWith(RESULT);
  });
});

describe('VoiceNoteComposer — recorder failure (B-314-7)', () => {
  it('a microphone that cannot start shows what happened, a Try again and a support reference', async () => {
    const port = makePort({ start: jest.fn().mockRejectedValue(new Error('session busy')) });
    const { getByTestId, findByTestId, getByText } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    fireEvent.press(getByTestId('voice-record-button'));
    const notice = await findByTestId('voice-composer-error');
    expect(notice).toBeTruthy();
    expect(getByText(/The microphone could not start recording\. Try again\./)).toBeTruthy();
    expect(getByText(/mention reference [A-Za-z0-9-]{8}/)).toBeTruthy();
    expect(getByText(/@/)).toBeTruthy();
    fireEvent.press(getByTestId('voice-composer-error-retry'));
    await waitFor(() => expect(getByTestId('voice-record-button')).toBeTruthy());
  });

  it('a permission read that fails says so instead of leaving an idle button', async () => {
    const port = makePort({
      getPermissionStatus: jest.fn().mockRejectedValue(new Error('perm read failed')),
    });
    const { getByTestId, findByText } = await render(
      <VoiceNoteComposer {...props} target={target} recorder={port} />,
    );
    fireEvent.press(getByTestId('voice-record-button'));
    expect(await findByText(/Microphone access could not be checked on this phone\./)).toBeTruthy();
  });
});
