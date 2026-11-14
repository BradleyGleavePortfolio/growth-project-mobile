/**
 * VOICE-SHEET-M (VN-LIST-W1, owner 10-26 items 4 and 8): when the Hall's voice notes list fails to load, its
 * error names the list, not one note. It shows the title "Voice notes not loaded" above the reason, and a
 * server problem reads "could not load voice notes". The page for one note keeps "load this voice note".
 * Mocks and renderSection follow VoiceNotesSection.test.tsx; the switch is on unless a case turns it off.
 */
import React from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import VoiceNotesSection from '../VoiceNotesSection';
import { resetVoiceOutbox } from '../../../hooks/useVoiceOutbox';
import { resetReportedVoiceNotes } from '../VoiceReportedFold';
import { describeCommunityFailure, type CommunityAction } from '../../../api/communityErrors';

const mockFlags = { communityVoiceNotes: true };
// Read when the section renders, so case g can turn the switch off.
jest.mock('../../../config/featureFlags', () => ({
  get featureFlags() {
    return mockFlags;
  },
}));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../HapticPressable', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ children, onPress, testID, accessibilityRole, disabled, accessibilityLabel }: {
      children: React.ReactNode; onPress?: () => void; testID?: string; accessibilityRole?: string;
      disabled?: boolean; accessibilityLabel?: string;
    }) => React.createElement(Pressable, { onPress, testID, accessibilityRole, disabled, accessibilityLabel }, children),
  };
});
jest.mock('../VoiceNotePlayer', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: (p: { testID?: string }) => React.createElement(View, { testID: p.testID }) };
});
jest.mock('../VoiceRecordSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../hooks/useCommunity', () => ({
  ...jest.requireActual('../../../hooks/useCommunity'),
  useCommunityMe: () => ({ data: { membership: { role: 'client' } } }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
const mockListFeed = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => {
  const actual = jest.requireActual('../../../api/communityVoiceApi');
  return {
    ...actual,
    communityVoiceApi: {
      listFeed: (...a: unknown[]) => mockListFeed(...a),
      remove: jest.fn(),
      issueUploadUrl: jest.fn(),
      uploadBytes: jest.fn(),
      create: jest.fn(),
    },
  };
});
jest.mock('../../../api/communitySafetyApi', () => {
  const actual = jest.requireActual('../../../api/communitySafetyApi');
  return { ...actual, communitySafetyApi: { report: jest.fn(), block: jest.fn() } };
});
const secure = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };

const TITLE = 'Voice notes not loaded';
const ONE_NOTE_TITLE = 'Voice note not loaded';
const LIST = 'The app could not load voice notes because of a server problem.';
const OLD = 'load this voice note';
const OFFLINE = 'You appear to be offline. Check your connection, then try again.';
const NO_ACCESS = 'You do not have access to this anymore. Contact your coach if you think this is a mistake.';
// Read through a plain string so this file type-checks before the action exists (case d then fails at run time).
const LIST_ACTION: string = 'load_voice_notes';

const answered = (status: number) => ({
  isAxiosError: true,
  response: { status, data: {}, headers: {} },
  config: { headers: {} },
});
const noAnswer = () => ({ isAxiosError: true, config: { headers: {} } });

const note = (id: string) => ({
  id,
  workspace_id: 'ws-1',
  cohort_id: null,
  conversation_id: null,
  author_id: 'u-alex',
  url: `https://storage.example.test/${id}`,
  duration_ms: 42000,
  bytes: 1000,
  mime_type: 'audio/mp4',
  created_at: new Date(Date.now() - 3_600_000).toISOString(),
});

async function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoiceNotesSection workspaceId="ws-1" viewerUserId="u-me" viewerCoachId="u-coach" testID="vn" />
    </QueryClientProvider>,
  );
}

/** Every line of text in the error state, in reading order. */
function errorLines(error: ReturnType<Awaited<ReturnType<typeof render>>['getByTestId']>): string[] {
  return error
    .queryAll((n) => n.type === 'Text')
    .map((t) => [t.props.children].flat().join(''));
}

beforeEach(() => {
  mockFlags.communityVoiceNotes = true;
  resetVoiceOutbox();
  resetReportedVoiceNotes();
  (NetInfo as unknown as { __reset: () => void }).__reset();
  secure.__store.set('supabase_token', 'token-me');
  mockListFeed.mockReset().mockResolvedValue({ voice_notes: [note('vn-1')], next_cursor: null });
});

describe('the Hall voice notes list error names the list (VN-LIST-W1)', () => {
  it('a. a server problem: the title, then "could not load voice notes", then one Try again that reads again', async () => {
    mockListFeed.mockReset().mockRejectedValue(answered(503));
    const { findByTestId, queryByText } = await renderSection();
    const error = await findByTestId('vn-error');
    const lines = errorLines(error);
    expect(lines[0]).toBe(TITLE);
    expect(lines[1]).toContain(LIST);
    expect(lines[2]).toBe('Try again');
    expect(lines).toHaveLength(3);
    expect(queryByText(new RegExp(OLD))).toBeNull();
    expect(queryByText(ONE_NOTE_TITLE)).toBeNull();
    const retry = within(error).getAllByRole('button', { name: 'Try again' });
    expect(retry).toHaveLength(1);
    const before = mockListFeed.mock.calls.length;
    await fireEvent.press(retry[0]);
    await waitFor(() => expect(mockListFeed.mock.calls.length).toBeGreaterThan(before));
  });

  it('b. no answer (offline): the title over the offline sentence', async () => {
    mockListFeed.mockReset().mockRejectedValue(noAnswer());
    const { findByTestId } = await renderSection();
    expect(errorLines(await findByTestId('vn-error'))).toEqual([TITLE, OFFLINE, 'Try again']);
  });

  it('c. a 403 answer: the title over the no-access sentence', async () => {
    mockListFeed.mockReset().mockRejectedValue(answered(403));
    const { findByTestId } = await renderSection();
    expect(errorLines(await findByTestId('vn-error'))).toEqual([TITLE, NO_ACCESS, 'Try again']);
  });

  it('d. the list action: title "Voice notes not loaded", "could not load voice notes" and a reference', () => {
    const failure = describeCommunityFailure(answered(500), LIST_ACTION as CommunityAction);
    expect(failure.title).toBe(TITLE);
    expect(failure.message).toContain(LIST);
    expect(failure.reference).toMatch(/^[0-9A-F]{8}$/);
    expect(failure.message).toContain(`quote reference ${failure.reference}`);
  });
});

describe('what stays as it was', () => {
  it('e. the one-note page keeps its words', () => {
    const failure = describeCommunityFailure(answered(500), 'load_voice');
    expect(failure.title).toBe(ONE_NOTE_TITLE);
    expect(failure.message).toContain('The app could not load this voice note because of a server problem.');
  });

  it('f. notes load: no error state and no title; an empty list keeps its line and no title', async () => {
    const first = await renderSection();
    expect(await first.findByTestId('vn-note-vn-1')).toBeTruthy();
    expect(first.queryByTestId('vn-error')).toBeNull();
    expect(first.queryByText(TITLE)).toBeNull();
    await first.unmount();

    mockListFeed.mockReset().mockResolvedValue({ voice_notes: [], next_cursor: null });
    const empty = await renderSection();
    expect(await empty.findByText('No voice notes yet. Tap Record to share one with your community.')).toBeTruthy();
    expect(empty.queryByTestId('vn-error')).toBeNull();
    expect(empty.queryByText(TITLE)).toBeNull();
  });

  it('g. the switch off: the section draws nothing and reads nothing', async () => {
    mockFlags.communityVoiceNotes = false;
    mockListFeed.mockReset().mockRejectedValue(answered(503));
    const { toJSON } = await renderSection();
    expect(toJSON()).toBeNull();
    expect(mockListFeed).not.toHaveBeenCalled();
  });
});
