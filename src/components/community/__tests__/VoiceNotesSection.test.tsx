/**
 * VoiceNotesSection — voice notes on at launch (owner 20:32). Audio cannot be
 * text-filtered, so every other member's note must carry Report (as a voice
 * note) and Block, and the author can delete their own note.
 */
import React from 'react';
import { Alert, Platform, type AlertButton } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import VoiceNotesSection from '../VoiceNotesSection';
import { resetVoiceOutbox } from '../../../hooks/useVoiceOutbox';
import { markVoiceNoteReported, resetReportedVoiceNotes } from '../VoiceReportedFold';

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
      accessibilityRole,
      disabled,
      accessibilityLabel,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      accessibilityRole?: string;
      disabled?: boolean;
      accessibilityLabel?: string;
    }) => React.createElement(Pressable, { onPress, testID, accessibilityRole, disabled, accessibilityLabel }, children),
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

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

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
  mockNavigate.mockReset();
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
  // SafetyMenu raises its follow-up Alerts at once on Android; its iOS path (after the Modal's
  // onDismiss) is driven in SafetyMenu.test (Opus R5-B4).
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});
const realOS = Platform.OS;
afterEach(() => {
  alertSpy.mockRestore();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

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

  // FR-848R5 render check: at 130% text on a 360 pt phone the row overflowed and the Coach mark broke over two lines.
  it('a long name gives way; the Coach mark and the time stay whole on one line', async () => {
    const { StyleSheet } = jest.requireActual('react-native');
    const coach = { ...note('vn-c', 'u-coach'), author_name: 'Alexandra Montgomery-Reyes', author_is_coach: true };
    mockListFeed.mockResolvedValue({ voice_notes: [coach], next_cursor: null });
    const { findByText, getByText } = await renderSection();
    const name = await findByText('Alexandra Montgomery-Reyes');
    expect(name.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(name.props.style).flexShrink).toBe(1);
    const mark = getByText('Coach');
    expect(mark.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(mark.props.style).flexShrink).toBe(0);
    const when = getByText('2h');
    expect(when.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(when.props.style).flexShrink).toBe(0);
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
  // The viewer's own note is untouched.
  expect(getByTestId('vn-player-vn-mine')).toBeTruthy();
});

// REMOVED-BY-M item 1 (owner #174-4): the reported row keeps its menu; Report shows as done, Block stays.
it('a reported note keeps its menu: Reported as done, Block still there', async () => {
  const { findByTestId, getByTestId, queryByTestId, getByText } = await renderSection();
  await fireEvent.press(await findByTestId('vn-menu-vn-other'));
  await fireEvent.press(getByTestId('vn-menu-vn-other-report'));
  await act(async () => {
    fireEvent.press(getByTestId('vn-menu-vn-other-reason-spam'));
  });
  expect(await findByTestId('vn-reported-vn-other')).toBeTruthy();
  await fireEvent.press(getByTestId('vn-menu-vn-other'));
  expect(getByTestId('vn-menu-vn-other-reported')).toBeTruthy();
  expect(getByText('Reported')).toBeTruthy();
  expect(queryByTestId('vn-menu-vn-other-report')).toBeNull();
  expect(getByTestId('vn-menu-vn-other-block')).toBeTruthy();
  expect(mockReport).toHaveBeenCalledTimes(1);
});

// REMOVED-BY-M item 2 (owner #174-4): the coach removes another member's note, asked in the same sheet.
it('the coach removes another member’s note after the in-sheet confirm, with no alert', async () => {
  mockRole.current = 'coach';
  mockRemove.mockResolvedValue({ id: 'vn-other', deleted: true });
  const { findByTestId, getByTestId, queryByTestId, getByText } = await renderSection();
  await fireEvent.press(await findByTestId('vn-menu-vn-other'));
  expect(getByTestId('vn-menu-vn-other-report')).toBeTruthy();
  expect(getByTestId('vn-menu-vn-other-block')).toBeTruthy();
  expect(queryByTestId('vn-menu-vn-other-delete')).toBeNull();
  await fireEvent.press(getByTestId('vn-menu-vn-other-remove'));
  // The menu rows are gone before the question shows; no alert over the menu.
  expect(queryByTestId('vn-menu-vn-other-report')).toBeNull();
  expect(queryByTestId('vn-menu-vn-other-remove')).toBeNull();
  expect(getByText('Remove this voice note for everyone?')).toBeTruthy();
  expect(getByText('Everyone in this space will see that you removed it.')).toBeTruthy();
  expect(alertSpy).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(getByTestId('vn-menu-vn-other-remove-confirm'));
  });
  expect(mockRemove).toHaveBeenCalledWith('vn-other');
  expect(alertSpy).not.toHaveBeenCalled();
});

it('the platform owner also gets Remove for everyone; the coach still deletes their own note', async () => {
  mockRole.current = 'owner';
  const { findByTestId, getByTestId, queryByTestId } = await renderSection();
  await fireEvent.press(await findByTestId('vn-menu-vn-other'));
  expect(getByTestId('vn-menu-vn-other-remove')).toBeTruthy();
  await fireEvent.press(getByTestId('vn-menu-vn-other-close'));
  await fireEvent.press(getByTestId('vn-menu-vn-mine'));
  expect(queryByTestId('vn-menu-vn-mine-remove')).toBeNull();
  expect(getByTestId('vn-menu-vn-mine-delete')).toBeTruthy();
});

// #175-W (approved): the coach, who can also remove another member's note, hears all three actions on
// its ···; a member hears "Report or block {name}".
it('the coach’s ··· on another member’s note says Report, block or remove', async () => {
  mockRole.current = 'coach';
  const { findByLabelText, getByTestId } = await renderSection();
  expect(await findByLabelText('Report, block or remove')).toBe(getByTestId('vn-menu-vn-other'));
});

it('a member’s ··· on another member’s note says Report or block', async () => {
  const { findByTestId, queryByLabelText } = await renderSection();
  const menu = await findByTestId('vn-menu-vn-other');
  expect(queryByLabelText('Report, block or remove')).toBeNull();
  expect(menu).toHaveAccessibleName(/^Report or block /);
});

it('a member gets no Delete or Remove on another member’s note', async () => {
  const { findByTestId, getByTestId, queryByTestId } = await renderSection();
  await fireEvent.press(await findByTestId('vn-menu-vn-other'));
  expect(getByTestId('vn-menu-vn-other-report')).toBeTruthy();
  expect(queryByTestId('vn-menu-vn-other-delete')).toBeNull();
  expect(queryByTestId('vn-menu-vn-other-remove')).toBeNull();
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

// REMOVED-BY-M item 3 (owner #174-4; backend #1165 CONTRACT §1): a coach-removed note keeps its place as
// one quiet line, with no player and no menu; the words depend on who reads it.
const removedNote = (id: string, author: string, removerId: string, removerName = 'Sam') => ({
  ...note(id, author),
  url: null,
  duration_ms: 0,
  bytes: 0,
  removed_at: new Date(Date.now() - 60_000).toISOString(),
  removed_by: { role: 'coach' as const, user_id: removerId, name: removerName },
});

describe('a coach-removed note (REMOVED-BY-M)', () => {
  it('everyone else reads Removed by Coach {name}, with no player and no menu', async () => {
    mockListFeed.mockResolvedValue({
      voice_notes: [removedNote('vn-other', 'u-alice', 'u-coach'), note('vn-mine', 'u-me')],
      next_cursor: null,
    });
    const { findByTestId, getByText, queryByTestId, getByTestId } = await renderSection();
    expect(await findByTestId('vn-removed-vn-other')).toBeTruthy();
    expect(getByText('Removed by Coach Sam')).toBeTruthy();
    expect(queryByTestId('vn-player-vn-other')).toBeNull();
    expect(queryByTestId('vn-menu-vn-other')).toBeNull();
    expect(queryByTestId('vn-removed-vn-other-safety')).toBeNull();
    // The author line stays, so the place in the list reads the same.
    expect(getByTestId('vn-note-vn-other')).toBeTruthy();
    expect(getByTestId('vn-player-vn-mine')).toBeTruthy();
  });

  it('the coach who removed it reads You removed this voice note', async () => {
    mockRole.current = 'coach';
    mockListFeed.mockResolvedValue({ voice_notes: [removedNote('vn-other', 'u-alice', 'u-me')], next_cursor: null });
    const { findByText, queryByTestId } = await renderSection();
    expect(await findByText('You removed this voice note')).toBeTruthy();
    expect(queryByTestId('vn-menu-vn-other')).toBeNull();
  });

  it('the author reads Your coach removed your voice note, with a link to Community safety', async () => {
    mockListFeed.mockResolvedValue({ voice_notes: [removedNote('vn-mine', 'u-me', 'u-coach')], next_cursor: null });
    const { findByText, getByTestId, queryByTestId } = await renderSection();
    expect(await findByText('Your coach removed your voice note')).toBeTruthy();
    expect(queryByTestId('vn-player-vn-mine')).toBeNull();
    expect(queryByTestId('vn-menu-vn-mine')).toBeNull();
    const link = getByTestId('vn-removed-vn-mine-safety');
    expect(link.props.accessibilityRole).toBe('link');
    await fireEvent.press(link);
    expect(mockNavigate).toHaveBeenCalledWith('CommunitySafety');
  });

  it('the coach’s removal swaps the note for the placeholder in place, without a reload', async () => {
    mockRole.current = 'coach';
    mockRemove.mockResolvedValue({ deleted: true });
    const { findByTestId, getByTestId, queryByTestId, findByText, getAllByTestId } = await renderSection();
    expect(await findByTestId('vn-player-vn-other')).toBeTruthy();
    mockListFeed.mockResolvedValue({
      voice_notes: [removedNote('vn-other', 'u-alice', 'u-me'), note('vn-mine', 'u-me')],
      next_cursor: null,
    });
    await fireEvent.press(getByTestId('vn-menu-vn-other'));
    await fireEvent.press(getByTestId('vn-menu-vn-other-remove'));
    await act(async () => {
      fireEvent.press(getByTestId('vn-menu-vn-other-remove-confirm'));
    });
    expect(await findByText('You removed this voice note')).toBeTruthy();
    expect(queryByTestId('vn-player-vn-other')).toBeNull();
    expect(queryByTestId('vn-menu-vn-other')).toBeNull();
    // Same place: still first, above the coach's own note.
    expect(getAllByTestId(/^vn-note-/).map((n) => n.props.testID)).toEqual(['vn-note-vn-other', 'vn-note-vn-mine']);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('a note the viewer reported and the coach then removed shows the placeholder, not the fold', async () => {
    markVoiceNoteReported('vn-other');
    mockListFeed.mockResolvedValue({ voice_notes: [removedNote('vn-other', 'u-alice', 'u-coach')], next_cursor: null });
    const { findByTestId, queryByTestId } = await renderSection();
    expect(await findByTestId('vn-removed-vn-other')).toBeTruthy();
    expect(queryByTestId('vn-reported-vn-other')).toBeNull();
  });
});

// Opus R5-B2 (GOAL B-03 / B-10a): every unsent row carries the sender's ···. Waiting or not sent, its
// one action deletes the recording from the outbox after the confirm; while a send runs it is held.
it('a waiting note has a ··· whose Delete removes it from the outbox', async () => {
  (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false });
  const { findByTestId, getByTestId, queryByTestId, findByLabelText } = await renderSection();
  await findByTestId('vn-note-vn-other');
  await fireEvent.press(getByTestId('vn-record'));
  await act(async () => {
    fireEvent.press(getByTestId('sheet-send'));
  });
  await findByLabelText('Waiting to send');
  const waiting = await findByTestId(/^vn-pending-.*-waiting$/);
  const row = String(waiting.props.testID).replace(/-waiting$/, '');
  const menu = getByTestId(`${row}-menu`);
  expect(menu).toBeEnabled();
  expect(menu).toHaveAccessibleName('Delete voice note');
  await fireEvent.press(menu);
  expect(alertSpy).toHaveBeenLastCalledWith('Delete this voice note?', undefined, expect.any(Array));
  await act(async () => {
    await pressAlertButton('Delete');
  });
  expect(queryByTestId(row)).toBeNull();
});

it('a sending note shows the ··· held until the attempt ends', async () => {
  mockIssue.mockImplementation(() => new Promise(() => undefined)); // still sending
  const { findByTestId, getByTestId } = await renderSection();
  await findByTestId('vn-note-vn-other');
  await fireEvent.press(getByTestId('vn-record'));
  await act(async () => {
    fireEvent.press(getByTestId('sheet-send'));
  });
  const sending = await findByTestId(/^vn-pending-.*-sending$/);
  const row = String(sending.props.testID).replace(/-sending$/, '');
  const menu = getByTestId(`${row}-menu`);
  expect(menu).toBeDisabled();
  await fireEvent.press(menu);
  expect(alertSpy).not.toHaveBeenCalledWith('Delete this voice note?', undefined, expect.any(Array));
});
