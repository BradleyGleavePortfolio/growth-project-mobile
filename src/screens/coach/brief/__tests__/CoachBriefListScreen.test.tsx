/**
 * CoachBriefListScreen: the list behind "See messages", "See weight logs" and
 * "See check-ins". Every client the brief counted is a row; each row opens
 * that client exactly as the brief's single-client row does; Back returns to
 * the brief; a missing list never shows a blank page or the word "Client".
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { CoachBriefActionItem } from '../../../../api/coachBriefApi';

jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { coachBrief: true, coachBriefGate: true, teamMode: false, romanChat: false },
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

import CoachBriefListScreen from '../CoachBriefListScreen';
import { selectBriefActions } from '../briefActions';

const weight = (n: number, name?: string): CoachBriefActionItem => ({
  type: 'weight_flag',
  client_id: `w-${n}`,
  client_name: name,
  detail: `Weight change of ${n}.0 lbs needs review`,
  priority: 2,
});

const SIX = ['Maya Chen', 'Omar Haddad', 'Rita Gomez', 'Sam Wu', 'Tess Hale', 'Ugo Obi'].map((name, n) => weight(n, name));

beforeEach(() => jest.clearAllMocks());

describe('CoachBriefListScreen', () => {
  it('lists every client behind "See weight logs" and opens each one', async () => {
    const [row] = selectBriefActions(SIX);
    expect(row.label).toBe('See weight logs');
    if (row.opens !== 'list') throw new Error('expected a list row');
    const { getByText, getByTestId } = await render(
      <CoachBriefListScreen route={{ params: { kind: row.kind, items: row.items } }} />,
    );
    expect(getByText('Weight logs')).toBeTruthy();
    for (const [n, client] of SIX.entries()) {
      expect(getByText(client.client_name as string)).toBeTruthy();
      const press = getByTestId(`brief-list-row-w-${n}`);
      expect(press.props.accessibilityHint).toBe('Opens the screen for this item');
      await fireEvent.press(press);
      expect(mockNavigate).toHaveBeenLastCalledWith('ClientsStack', {
        screen: 'ClientDetail',
        params: { clientId: `w-${n}`, clientName: client.client_name },
        initial: false,
      });
    }
    expect(mockNavigate).toHaveBeenCalledTimes(6);
  });

  it('opens each conversation from the messages list', async () => {
    const items: CoachBriefActionItem[] = [
      { type: 'message_unread', client_id: 'm-1', client_name: 'Sarah Lin', detail: 'Can we move Thursday?', priority: 1 },
      { type: 'message_unread', client_id: 'm-2', client_name: 'Dana Ortiz', detail: '(voice message)', priority: 1 },
    ];
    const { getByText, getByTestId } = await render(
      <CoachBriefListScreen route={{ params: { kind: 'messages', items } }} />,
    );
    expect(getByText('Messages')).toBeTruthy();
    expect(getByText('Can we move Thursday?')).toBeTruthy();
    await fireEvent.press(getByTestId('brief-list-row-m-2'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', {
      screen: 'ClientMessages',
      params: { clientId: 'm-2', clientName: 'Dana Ortiz' },
      initial: false,
    });
  });

  it('shows the detail, not "Client", for a client with no name', async () => {
    const { getByText, queryByText } = await render(
      <CoachBriefListScreen route={{ params: { kind: 'checkins', items: [{ type: 'checkin_missing', client_id: 'c-1', client_name: 'Client', detail: 'Has not checked in today', priority: 3 }] } }} />,
    );
    expect(getByText('Check-ins')).toBeTruthy();
    expect(getByText('Has not checked in today')).toBeTruthy();
    expect(queryByText('Client')).toBeNull();
  });

  it('Back returns to the brief', async () => {
    const { getByTestId } = await render(<CoachBriefListScreen route={{ params: { kind: 'weight', items: SIX } }} />);
    await fireEvent.press(getByTestId('brief-list-top-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('a list with nothing to open says so instead of showing a blank page', async () => {
    const { getByTestId, getByText } = await render(<CoachBriefListScreen />);
    expect(getByTestId('brief-list-empty')).toBeTruthy();
    expect(getByText('Nothing needs you right now.')).toBeTruthy();
    expect(getByTestId('brief-list-top-back')).toBeTruthy();
  });
});
