/**
 * SPLIT-938C (agent 200): the KT-2 proofs of the space chat's box and mic (planning/KNOWN_TRAPS.md KT-2). Both hand
 * what the person wrote or recorded only to their own space (onSend: the screen's useSpaceChat and space voice outbox,
 * which refuse a closed space); a text the space refused as closed never comes back into the box.
 * memberContentAccess.test.tsx registers SpaceChatComposer and SpaceChatMic with these titles.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockDrafts: Record<string, string> = {};
jest.mock('../../../../lib/chatDrafts', () => {
  const ReactActual = jest.requireActual('react');
  return {
    useChatDraft: (key: string) => {
      const [, bump] = ReactActual.useState(0);
      return [mockDrafts[key] ?? '', (v: string) => { mockDrafts[key] = v; bump((n: number) => n + 1); }];
    },
  };
});
const mockRows: { localId: string; state: string; reason?: string; body: string }[] = [];
const mockDiscard = jest.fn();
jest.mock('../spaceChatOutbox', () => ({
  REJECTED_WORDS: { title: 'Not sent', message: 'Change it and send again.' },
  spaceOutbox: { discard: (id: string) => mockDiscard(id) },
  useSpaceOutbox: () => mockRows,
}));
jest.mock('../../../messaging/ReplyComposer', () => ({ ReplyComposer: () => null }));
const mockConsent = { known: true, needsCard: true, record: jest.fn() };
jest.mock('../SpaceVoiceFirstUse', () => {
  const ReactActual = jest.requireActual('react');
  return {
    __esModule: true,
    useSpaceVoiceConsent: () => mockConsent,
    default: (props: Record<string, unknown>) => ReactActual.createElement('SpaceVoiceFirstUseHost', { ...props, testID: 'first-use-card' }),
  };
});
jest.mock('../../VoiceRecordSheet', () => {
  const ReactActual = jest.requireActual('react');
  return { __esModule: true, default: (props: Record<string, unknown>) => ReactActual.createElement('VoiceRecordSheetHost', { ...props, testID: 'record-sheet' }) };
});

import { act } from '@testing-library/react-native';
import SpaceChatComposer from '../SpaceChatComposer';
import SpaceChatMic from '../SpaceChatMic';

beforeEach(() => {
  for (const k of Object.keys(mockDrafts)) delete mockDrafts[k];
  mockRows.length = 0;
  mockDiscard.mockReset();
});

describe('KT-2: the space chat box and mic', () => {
  it('KT-2: the space chat box keeps its words per space and hands them only to its own space (onSend)', async () => {
    const onSend = jest.fn();
    const r = await render(<SpaceChatComposer cohortId="space-1" onSend={onSend} />);
    await act(async () => fireEvent.changeText(r.getByTestId('space-chat-composer-field'), 'for space one'));
    await r.rerender(<SpaceChatComposer cohortId="space-2" onSend={onSend} />);
    expect(r.getByTestId('space-chat-composer-field').props.value).toBe('');
    await r.rerender(<SpaceChatComposer cohortId="space-1" onSend={onSend} />);
    await act(async () => fireEvent.press(r.getByTestId('space-chat-composer-send')));
    expect(onSend).toHaveBeenCalledWith('for space one');
    expect(onSend).toHaveBeenCalledTimes(1);
    await r.unmount();
  });

  it('KT-2: a text the space refused as closed never comes back into the box', async () => {
    mockRows.push({ localId: 'l-1', state: 'failed', reason: 'closed', body: 'words for a space I lost' });
    const r = await render(<SpaceChatComposer cohortId="space-1" onSend={jest.fn()} />);
    expect(r.getByTestId('space-chat-composer-field').props.value).toBe('');
    expect(mockDiscard).not.toHaveBeenCalled();
    await r.unmount();
  });

  it('KT-2: the mic opens no recorder until the first-use card is answered, and hands a recording only to its space (onSend)', async () => {
    const onSend = jest.fn();
    const r = await render(<SpaceChatMic cohortName="Morning crew" userId="viewer" coach={false} onSend={onSend} />);
    expect(r.queryByTestId('record-sheet', { includeHiddenElements: true })).toBeNull();
    await act(async () => fireEvent.press(r.getByTestId('space-chat-mic')));
    const card = r.getByTestId('first-use-card', { includeHiddenElements: true });
    expect(card.props.visible).toBe(true);
    expect(r.queryByTestId('record-sheet', { includeHiddenElements: true })).toBeNull();
    await act(async () => { (card.props.onRecord as () => void)(); (card.props.onDismiss as () => void)(); });
    const sheet = r.getByTestId('record-sheet', { includeHiddenElements: true });
    expect(sheet.props.target).toEqual({ kind: 'cohort', cohortName: 'Morning crew' });
    const recording = { uri: 'file:///note.m4a' };
    await act(async () => (sheet.props.onSend as (x: unknown) => void)(recording));
    expect(onSend).toHaveBeenCalledWith(recording);
    await r.unmount();
  });
});
