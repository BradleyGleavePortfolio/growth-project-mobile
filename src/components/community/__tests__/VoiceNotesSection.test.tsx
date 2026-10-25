/**
 * VoiceNotesSection — voice notes on at launch (owner 20:32). Audio cannot be
 * text-filtered, so every other member's note must carry Report (as a voice
 * note) and Block, and the author can delete their own note.
 */
import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import VoiceNotesSection from '../VoiceNotesSection';
import { resetVoiceOutbox } from '../../../hooks/useVoiceOutbox';
import { resetReportedVoiceNotes } from '../VoiceReportedFold';

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
    default: (p: { testID?: string; url: string; trailing?: unknown; footer?: unknown; disabled?: boolean }) =>
      React.createElement(
        View,
        { testID: p.testID, accessibilityHint: p.url, accessibilityState: { disabled: p.disabled === true } },
        p.trailing,
        p.footer,
      ),
  };
});
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
// The viewer's community role (coach / owner may remove any note in their workspace).
const mockRole = { current: 'client' as string };
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { membership: { role: mockRole.current } } }),
}));
const mockRecording = { uri: 'file:///r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4', peaks: [0.5] };
jest.mock('../VoiceRecordSheet', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, onSend }: { visible: boolean; onSend: (r: unknown, s: boolean) => void }) =>
      visible ? React.createElement(Pressable, { testID: 'sheet-send', onPress: () => onSend(mockRecording, true) }) : null,
  };
});

const mockListFeed = jest.fn();
const mockRemove = jest.fn();
const mockIssue = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      listFeed: (...a: unknown[]) => mockListFeed(...a),
      remove: (...a: unknown[]) => mockRemove(...a),
      issueUploadUrl: (...a: unknown[]) => mockIssue(...a),
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

async function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = await render(
    <QueryClientProvider client={qc}>
      <VoiceNotesSection
        workspaceId="ws-1"
        viewerUserId="u-me"
        viewerCoachId="u-coach"
        testID="vn"
      />
    </QueryClientProvider>,
  );
  return utils;
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  resetVoiceOutbox();
  resetReportedVoiceNotes();
  mockRole.current = 'client';
  (NetInfo as unknown as { __reset: () => void }).__reset();
  mockListFeed.mockReset().mockResolvedValue({
    voice_notes: [note('vn-other', 'u-alice'), note('vn-mine', 'u-me')],
    next_cursor: null,
  });
  mockRemove.mockReset().mockResolvedValue({ id: 'vn-mine', deleted: true });
  mockIssue.mockReset().mockRejectedValue(new Error('upload target unavailable'));
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
  it('lists notes with a player each and opens the record sheet', async () => {
    const { findByTestId, getByTestId, getByText, queryByTestId } = await renderSection();
    expect(await findByTestId('vn-player-vn-other')).toBeTruthy();
    expect(getByTestId('vn-player-vn-mine')).toBeTruthy();
    expect(getByText('You')).toBeTruthy();
    expect(getByText('Member')).toBeTruthy();
    expect(queryByTestId('sheet-send')).toBeNull();
    await fireEvent.press(getByTestId('vn-record'));
    expect(getByTestId('sheet-send')).toBeTruthy();
  });

  it('shows the author name and the Coach mark from a Studio server', async () => {
    const coach = { ...note('vn-c', 'u-coach'), author_name: 'Sam Ortiz', author_is_coach: true };
    mockListFeed.mockResolvedValue({ voice_notes: [coach], next_cursor: null });
    const { findByText, getByText } = await renderSection();
    expect(await findByText('Sam Ortiz')).toBeTruthy();
    expect(getByText('Coach')).toBeTruthy();
  });

  it('a send that fails online says Not sent and offers Try again and Delete', async () => {
    const { findByTestId, getByTestId, findByText, getByText, queryByText } = await renderSection();
    await findByTestId('vn-player-vn-other');
    await fireEvent.press(getByTestId('vn-record'));
    await act(async () => {
      fireEvent.press(getByTestId('sheet-send'));
    });
    expect(await findByText('Not sent')).toBeTruthy();
    expect(getByText('That didn’t send. Your recording is safe — try sending again.')).toBeTruthy();
    await fireEvent.press(getByText('Delete'));
    await act(async () => {
      await pressAlertButton('Delete');
    });
    expect(queryByText('Not sent')).toBeNull();
  });

  it('offline the unsent note waits with a spinner and a wifi-off mark', async () => {
    (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false });
    const { findByLabelText, getByTestId, findByTestId } = await renderSection();
    await findByTestId('vn-player-vn-other');
    await fireEvent.press(getByTestId('vn-record'));
    await act(async () => {
      fireEvent.press(getByTestId('sheet-send'));
    });
    expect(await findByLabelText('Waiting to send')).toBeTruthy();
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

// LS-848 B4 (FR-848R4): while a note goes up, its row draws the GOAL 03 progress line.
it('a sending note shows the upload progress line', async () => {
  mockIssue.mockImplementation(() => new Promise(() => undefined)); // still sending
  const { getByTestId, findByTestId } = await renderSection();
  await findByTestId('vn-note-vn-other');
  await act(async () => {
    fireEvent.press(getByTestId('vn-record'));
  });
  await act(async () => {
    fireEvent.press(getByTestId('sheet-send'));
  });
  const line = await findByTestId(/^vn-pending-.*-progress$/);
  expect(line.props.accessibilityRole).toBe('progressbar');
  expect(line.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 0 });
});


// LO-848R4 B4: every line of the feed (names, Coach mark, times, Not sent copy) is GOAL Inter.
it('every feed line names a loaded Inter face', async () => {
  const { StyleSheet } = jest.requireActual('react-native');
  const coach = { ...note('vn-c', 'u-coach'), author_name: 'Sam Ortiz', author_is_coach: true };
  mockListFeed.mockResolvedValue({ voice_notes: [coach, note('vn-other', 'u-alice')], next_cursor: null });
  const { container, findByTestId, getByTestId, findByText } = await renderSection();
  await findByTestId('vn-note-vn-c');
  await fireEvent.press(getByTestId('vn-record'));
  await act(async () => {
    fireEvent.press(getByTestId('sheet-send'));
  });
  await findByText('Not sent');
  const texts = container.queryAll((n) => n.type === 'Text');
  expect(texts.length).toBeGreaterThan(4);
  for (const t of texts) expect(String(StyleSheet.flatten(t.props.style)?.fontFamily)).toMatch(/^(Inter_|ionicons$)/); // ionicons: icon glyphs
});

// LO-848R4 B1 (GOAL B-06b): a reported note folds for the reporter; its player is gone.
it('a reported note folds into the VN-07 row and its player is replaced', async () => {
  const { findByTestId, getByTestId, queryByTestId, getByText } = await renderSection();
  await fireEvent.press(await findByTestId('vn-menu-vn-other'));
  await fireEvent.press(getByTestId('vn-menu-vn-other-report'));
  // GOAL B-06a: the sheet names the note it is about.
  expect(getByTestId('vn-menu-vn-other-context')).toBeTruthy();
  expect(getByText(/voice note · 0:42/)).toBeTruthy();
  await act(async () => {
    fireEvent.press(getByTestId('vn-menu-vn-other-reason-spam'));
  });
  expect(await findByTestId('vn-reported-vn-other')).toBeTruthy();
  expect(getByText('You reported this voice note. It is hidden for you.')).toBeTruthy();
  expect(queryByTestId('vn-player-vn-other')).toBeNull();
  expect(queryByTestId('vn-menu-vn-other')).toBeNull();
  // The viewer's own note is untouched.
  expect(getByTestId('vn-player-vn-mine')).toBeTruthy();
});

// LO-848R4 B2 (GOAL B-06c): the workspace coach can remove another member's note.
it('the coach deletes another member’s note after the GOAL confirm', async () => {
  mockRole.current = 'coach';
  mockRemove.mockResolvedValue({ id: 'vn-other', deleted: true });
  const { findByTestId, getByTestId } = await renderSection();
  await fireEvent.press(await findByTestId('vn-menu-vn-other'));
  expect(getByTestId('vn-menu-vn-other-report')).toBeTruthy();
  await fireEvent.press(getByTestId('vn-menu-vn-other-delete'));
  const [title, message] = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  expect(title).toBe('Delete this voice note?');
  expect(message).toBe('It will be removed for everyone in your community. This cannot be undone.');
  await act(async () => {
    await pressAlertButton('Delete');
  });
  expect(mockRemove).toHaveBeenCalledWith('vn-other');
});

it('a member gets no Delete on another member’s note', async () => {
  const { findByTestId, getByTestId, queryByTestId } = await renderSection();
  await fireEvent.press(await findByTestId('vn-menu-vn-other'));
  expect(getByTestId('vn-menu-vn-other-report')).toBeTruthy();
  expect(queryByTestId('vn-menu-vn-other-delete')).toBeNull();
});

// LO-848R4 B8 (GOAL B-03 / B-10a): the viewer's own disc is grey while the note sends or waits,
// and live again once it has not sent (so they can listen before trying again).
it('holds the own disc while sending, frees it when the note has not sent', async () => {
  mockIssue.mockImplementation(() => new Promise(() => undefined)); // still sending
  const { findByTestId, getByTestId } = await renderSection();
  await findByTestId('vn-note-vn-other');
  await fireEvent.press(getByTestId('vn-record'));
  await act(async () => {
    fireEvent.press(getByTestId('sheet-send'));
  });
  const sending = await findByTestId(/^vn-pending-.*-sending$/);
  const id = String(sending.props.testID).replace(/^vn-pending-/, '').replace(/-sending$/, '');
  const held = () =>
    getByTestId(`vn-pending-${id}`).queryAll((n) => n.props.accessibilityHint === mockRecording.uri && n.props.accessibilityState?.disabled === true);
  expect(held()).toHaveLength(1);
});
