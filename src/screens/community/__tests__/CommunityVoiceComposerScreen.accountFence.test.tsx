/**
 * BF-2 (LS-871X, VF-848B): Send on the voice composer screen queues the note in the shared outbox. A
 * sign-out before it is up drops it: the recording moved for it is deleted and nothing more goes out.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../../config/featureFlags', () => ({ featureFlags: { communityVoiceNotes: true } }));
jest.mock('../../../theme/useTheme', () => {
  const { lightTokens } = jest.requireActual('../../../theme/tokens');
  return { useTheme: () => ({ colorScheme: 'light', semanticColors: lightTokens }) };
});
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: { target: 'hall' } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ data: { workspace_id: 'ws-1' } }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u-me' }) }));
jest.mock('../../../components/community', () => ({ ThreadHeader: () => null }));
const mockRecording = { uri: 'file:///cache/r.m4a', durationMs: 3000, bytes: 10, mimeType: 'audio/mp4', peaks: [0.5] };
jest.mock('../../../components/community/VoiceNoteComposer', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    __esModule: true,
    default: ({ onSend }: { onSend: (r: unknown) => void }) =>
      React.createElement(Pressable, { testID: 'composer-send', onPress: () => onSend(mockRecording) }),
  };
});
const mockIssue = jest.fn();
const mockUploadBytes = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../../api/communityVoiceApi', () => ({
  ...jest.requireActual('../../../api/communityVoiceApi'),
  communityVoiceApi: {
    issueUploadUrl: (...a: unknown[]) => mockIssue(...a),
    uploadBytes: (...a: unknown[]) => mockUploadBytes(...a),
    create: (...a: unknown[]) => mockCreate(...a),
  },
}));
const mockMove = jest.fn();
const mockDelete = jest.fn();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...p: (string | { uri: string })[]) {
      this.uri = p.map((x) => (typeof x === 'string' ? x : x.uri)).join('/');
    }
    get name() {
      return this.uri.split('/').pop();
    }
    exists = true;
    move = (d: File) => mockMove(this.uri, d.uri);
    delete = () => mockDelete(this.uri);
  }
  class Directory extends File {
    create = () => undefined;
  }
  return { File, Directory, Paths: { document: 'file:///docs' } };
});

import CommunityVoiceComposerScreen from '../CommunityVoiceComposerScreen';
import { resetVoiceOutbox } from '../../../hooks/useVoiceOutbox';
import { authEvents } from '../../../utils/authEvents';

const secure = jest.requireMock('expo-secure-store') as { __store: Map<string, string> };
const TARGET = {
  upload_url: 'https://storage.example.test/put/k-1',
  storage_key: 'u-me/k-1.m4a',
  expires_at: '2026-10-28T10:10:00.000Z',
  expires_in_seconds: 600,
  bucket: 'community-voice',
};
const settle = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
});
function signOut(): void {
  secure.__store.delete('supabase_token');
  authEvents.emit('logout');
}
async function renderScreen() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceComposerScreen />
    </QueryClientProvider>,
  );
}

const realFetch = global.fetch;
beforeEach(async () => {
  resetVoiceOutbox();
  await AsyncStorage.clear();
  secure.__store.set('supabase_token', 'token-me');
  mockGoBack.mockReset();
  mockIssue.mockReset().mockResolvedValue(TARGET);
  mockUploadBytes.mockReset().mockResolvedValue(undefined);
  mockCreate.mockReset();
  mockMove.mockReset();
  mockDelete.mockReset();
  global.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = realFetch;
});

it('a note still being moved when its account signs out is deleted and never sent', async () => {
  let landed: () => void = () => undefined;
  mockMove.mockImplementationOnce(() => new Promise<void>((r) => {
    landed = r;
  }));
  const screen = await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('composer-send'));
  });
  expect(mockGoBack).toHaveBeenCalled();
  await act(async () => signOut());
  await act(async () => landed());
  await settle();
  expect(mockIssue).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledWith('file:///docs/voice-outbox/r.m4a');
});

it('a sign-out while its upload target is minted stops the send: no upload, no post', async () => {
  let answer: (t: unknown) => void = () => undefined;
  mockIssue.mockImplementationOnce(() => new Promise((r) => {
    answer = r;
  }));
  const screen = await renderScreen();
  await act(async () => {
    fireEvent.press(screen.getByTestId('composer-send'));
  });
  await waitFor(() => expect(mockIssue).toHaveBeenCalledTimes(1));
  await act(async () => signOut());
  await act(async () => answer(TARGET));
  await settle();
  expect(mockUploadBytes).not.toHaveBeenCalled();
  expect(mockCreate).not.toHaveBeenCalled();
});
