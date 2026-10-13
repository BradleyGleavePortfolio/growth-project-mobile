/**
 * B-R1F (owner 22a, 57, 57w, 57x): the two Roman safety coach alerts.
 *
 *   - The card: line 1 is the server's sentence; line 2 is the client's own
 *     message on one muted line with a tail ellipsis; no name header.
 *   - Tapping the card opens the detail screen: name, time sent, the full
 *     message, the one fixed line, and "Message {first name}" to the chat.
 *   - A safety alert push or inbox row opens Command Center > Actions.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, waitFor, fireEvent } from '@testing-library/react-native';

jest.mock('../services/commandCenterApi', () => {
  const original = jest.requireActual('../services/commandCenterApi');
  return {
    ...original,
    __USING_MOCK_DATA: false,
    commandCenterApi: { getActionQueue: jest.fn(), dismissAlert: jest.fn() },
  };
});

import { commandCenterApi, type ActionQueueItem } from '../services/commandCenterApi';
import ActionQueueScreen from '../screens/coach/command-center/ActionQueueScreen';
import AlertRow from '../components/command-center/AlertRow';
import CoachSafetyAlertScreen, { formatSentAt } from '../screens/coach/CoachSafetyAlertScreen';
import {
  __resetPushTapRouterForTests,
  attachPushNavigator,
  routeInAppNotification,
  routePushTap,
  setPushSession,
  type PushNavigator,
} from '../services/pushTapRouter';
import { lightTokens } from '../theme/tokens';

const URGENT_LINE = 'Urgent: Roman sent Jane Doe a medical safety reply. Check in with them →';
const ED_LINE = 'Roman sent Sam Lee an eating-disorder safety reply. Check in with them →';
const QUOTE = 'A persistent-vomiting message,\nwritten over two lines and long enough to be cut off on the card.';
const SENT = '2026-10-12T16:41:00.000Z';

const urgent: ActionQueueItem = {
  alert_id: 'a1',
  client_id: 'client-1',
  client_name: 'Jane Doe',
  alert_type: 'roman_urgent_reply',
  message: URGENT_LINE,
  created_at: SENT,
  dismissed_at: null,
  quote: QUOTE,
  sent_at: SENT,
};
const ed: ActionQueueItem = {
  ...urgent,
  alert_id: 'a2',
  client_id: 'client-2',
  client_name: 'Sam Lee',
  alert_type: 'roman_eating_disorder_reply',
  message: ED_LINE,
  quote: null,
  sent_at: null,
};

describe('the safety alert card', () => {
  it('line 1 in full, line 2 the message on one muted line with a tail ellipsis, no name header', async () => {
    const { getByText, getByTestId, queryByText, getByRole } = await render(
      <AlertRow clientName="Jane Doe" message={URGENT_LINE} quote={QUOTE} hideClientName onPress={() => {}} />,
    );
    expect(getByText(URGENT_LINE)).toBeTruthy();
    expect(queryByText('Jane Doe')).toBeNull();
    const quote = getByTestId('command-center-alert-quote');
    expect(quote.props.children).toBe(QUOTE.replace(/\s+/g, ' '));
    expect(quote.props.numberOfLines).toBe(1);
    expect(quote.props.ellipsizeMode).toBe('tail');
    expect(StyleSheet.flatten(quote.props.style).color).toBe(lightTokens.textMuted);
    expect(getByRole('button', { name: /^Urgent: Roman sent Jane Doe a medical safety reply\. Check in with them\. A persistent/ })).toBeTruthy();
  });

  it('both alerts use the same card; a deleted message leaves line 1 only', async () => {
    (commandCenterApi.getActionQueue as jest.Mock).mockResolvedValue({ data: { items: [urgent, ed], total_pending: 2 } });
    const onOpen = jest.fn();
    const { getAllByTestId, getByText } = await render(
      <ActionQueueScreen onOpenSafetyAlert={onOpen} onSelectClient={jest.fn()} />,
    );
    await waitFor(() => expect(getAllByTestId('command-center-safety-alert-row')).toHaveLength(2));
    expect(getByText(ED_LINE)).toBeTruthy();
    expect(getAllByTestId('command-center-alert-quote')).toHaveLength(1);
    await fireEvent.press(getByText(ED_LINE));
    expect(onOpen).toHaveBeenCalledWith(ed);
  });
});

describe('the detail screen', () => {
  async function renderDetail(params: Record<string, unknown>) {
    const navigation = { navigate: jest.fn(), goBack: jest.fn() };
    const utils = await render(
      <CoachSafetyAlertScreen
        route={{ key: 'k', name: 'CoachSafetyAlert', params } as never}
        navigation={navigation as never}
      />,
    );
    return { navigation, utils };
  }

  it('urgent: name, time sent, the full message, the fixed line, and Message {first name}', async () => {
    const { navigation, utils } = await renderDetail({
      alertType: 'roman_urgent_reply',
      clientId: 'client-1',
      clientName: 'Jane Doe',
      quote: QUOTE,
      sentAt: SENT,
    });
    const { getByText, getByTestId, getByRole } = utils;
    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByTestId('coach-safety-alert-sent').props.children).toBe(formatSentAt(SENT));
    expect(getByText(QUOTE)).toBeTruthy();
    expect(
      getByText('Roman told them to contact their prescribing clinic today, and to call 911 if symptoms are severe.'),
    ).toBeTruthy();
    await fireEvent.press(getByRole('button', { name: 'Message Jane' }));
    expect(navigation.navigate).toHaveBeenCalledWith('ClientMessages', { clientId: 'client-1', clientName: 'Jane Doe' });
    await fireEvent.press(getByRole('button', { name: 'Back' }));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('eating disorder: its own fixed line; no quote block once the message is deleted', async () => {
    const { utils } = await renderDetail({
      alertType: 'roman_eating_disorder_reply',
      clientId: 'client-2',
      clientName: 'Sam Lee',
      quote: null,
      sentAt: SENT,
    });
    const { getByText, queryByTestId, getByRole } = utils;
    expect(getByText('Roman answered with eating-disorder safety guidance.')).toBeTruthy();
    expect(queryByTestId('coach-safety-alert-quote')).toBeNull();
    expect(getByRole('button', { name: 'Message Sam' })).toBeTruthy();
  });
});

describe('the push and inbox route', () => {
  afterEach(() => __resetPushTapRouterForTests());

  it('CoachActionQueue (push tap or inbox row) opens Command Center on the Actions tab', () => {
    const nav = {
      navigate: jest.fn(),
      isReady: () => true,
      getRootState: () => ({ routeNames: ['CommandCenter', 'ClientsStack', 'SettingsStack'] }),
    };
    attachPushNavigator(nav as unknown as PushNavigator);
    setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' });
    expect(routeInAppNotification('CoachActionQueue')).toBe(true);
    routePushTap('CoachActionQueue', undefined, 'push-1');
    expect(nav.navigate.mock.calls).toEqual([
      ['CommandCenter', { tab: 'action-queue' }],
      ['CommandCenter', { tab: 'action-queue' }],
    ]);
  });
});
