/**
 * VoiceNotesSection — voice notes on at launch (owner 20:32). Audio cannot be
 * text-filtered, so every other member's note must carry Report (as a voice
 * note) and Block, and the author can delete their own note.
 */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VoiceNotesSection from '../VoiceNotesSection';

jest.mock('../../../config/featureFlags', () => ({
  featureFlags: { communityVoiceNotes: true },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return {
    useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      children,
      onPress,
      testID,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      testID?: string;
    }) => React.createElement(Pressable, { onPress, testID }, children),
  };
});
jest.mock('../VoiceNotePlayer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ testID, url }: { testID?: string; url: string }) =>
      React.createElement(View, { testID, accessibilityHint: url }),
  };
});
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));

const mockListFeed = jest.fn();
const mockRemove = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      listFeed: (...a: unknown[]) => mockListFeed(...a),
      remove: (...a: unknown[]) => mockRemove(...a),
    },
  };
});
const mockReport = jest.fn();
const mockBlock = jest.fn();
jest.mock('../../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../../api/communitySafetyApi');
  return {
    ...actual,
    communitySafetyApi: {
      report: (...a: unknown[]) => mockReport(...a),
      block: (...a: unknown[]) => mockBlock(...a),
    },
  };
});

const note = (id: string, author: string) => ({
  id,
  workspace_id: 'ws-1',
  cohort_id: null,
  conversation_id: null,
  author_id: author,
  url: `https://storage.example.test/${id}`,
  duration_ms: 42000,
  bytes: 1000,
  mime_type: 'audio/mp4',
  created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
});

async function renderSection(onRecord = jest.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = await render(
    <QueryClientProvider client={qc}>
      <VoiceNotesSection
        workspaceId="ws-1"
        viewerUserId="u-me"
        viewerCoachId="u-coach"
        onRecord={onRecord}
        testID="vn"
      />
    </QueryClientProvider>,
  );
  return { ...utils, onRecord };
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockListFeed.mockReset().mockResolvedValue({
    voice_notes: [note('vn-other', 'u-alice'), note('vn-mine', 'u-me')],
    next_cursor: null,
  });
  mockRemove.mockReset().mockResolvedValue({ id: 'vn-mine', deleted: true });
  mockReport.mockReset().mockResolvedValue(undefined);
  mockBlock.mockReset().mockResolvedValue(undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => alertSpy.mockRestore());

function pressAlertButton(text: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  const b = ((call[2] ?? []) as AlertButton[]).find((x) => x.text === text);
  if (!b?.onPress) throw new Error(`no alert button ${text}`);
  return b.onPress();
}

describe('VoiceNotesSection', () => {
  it('lists notes with a player each and opens the recorder', async () => {
    const { findByTestId, getByTestId, getByText, onRecord } = await renderSection();
    expect(await findByTestId('vn-player-vn-other')).toBeTruthy();
    expect(getByTestId('vn-player-vn-mine')).toBeTruthy();
    expect(getByText('You · 2h')).toBeTruthy();
    await fireEvent.press(getByTestId('vn-record'));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it('reports another member’s note as a voice note', async () => {
    const { findByTestId, getByTestId } = await renderSection();
    await fireEvent.press(await findByTestId('vn-menu-vn-other'));
    await fireEvent.press(getByTestId('vn-menu-vn-other-report'));
    await fireEvent.press(getByTestId('vn-menu-vn-other-reason-harassment'));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        target_type: 'voice_note',
        target_id: 'vn-other',
        reason: 'harassment',
      }),
    );
  });

  it('blocks the author of a note', async () => {
    const { findByTestId, getByTestId } = await renderSection();
    await fireEvent.press(await findByTestId('vn-menu-vn-other'));
    await fireEvent.press(getByTestId('vn-menu-vn-other-block'));
    await act(async () => {
      await pressAlertButton('Block');
    });
    expect(mockBlock).toHaveBeenCalledWith('u-alice');
  });

  it('the author deletes their own note (no Report on own content)', async () => {
    const { findByTestId, getByTestId, queryByTestId } = await renderSection();
    await fireEvent.press(await findByTestId('vn-menu-vn-mine'));
    expect(queryByTestId('vn-menu-vn-mine-report')).toBeNull();
    await fireEvent.press(getByTestId('vn-menu-vn-mine-delete'));
    expect(alertSpy.mock.calls[alertSpy.mock.calls.length - 1][0]).toBe('Delete this voice note?');
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(mockRemove).toHaveBeenCalledWith('vn-mine');
    await waitFor(() => expect(mockListFeed.mock.calls.length).toBeGreaterThan(1));
  });

  it('a load failure says what happened and retries', async () => {
    mockListFeed.mockReset().mockRejectedValue({
      isAxiosError: true,
      response: { status: 0 },
      config: { headers: {} },
    });
    const { findByTestId, getByTestId } = await renderSection();
    expect(await findByTestId('vn-error')).toBeTruthy();
    await fireEvent.press(getByTestId('vn-retry'));
    await waitFor(() => expect(mockListFeed.mock.calls.length).toBeGreaterThan(1));
  });
});
